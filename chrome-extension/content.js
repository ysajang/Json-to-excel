(function () {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('collection-ui.js');
  script.onload = function () {
    this.remove();
  };
  script.onerror = function () {
  };
  (document.head || document.documentElement).appendChild(script);
})();

let isScraping = false;
let stopScraping = false;
let currentOriginalTabId = null;
let currentCollectedReviews = [];

function sendToUI(message) {
  if (message.action === 'stopped' || message.action === 'startScraping' || message.action === 'complete') {
    try {
      window.postMessage({
        type: 'COUPANG_REVIEW_COLLECTOR',
        data: message
      }, '*');
    } catch (error) {
    }
  }
}


window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'COUPANG_REVIEW_COLLECTOR_STOP') {
    stopScraping = true;
    isScraping = false;
    sendToUI({
      action: 'stopped',
      message: '수집 중지 요청이 처리되었습니다.'
    });

    try {
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: '수집이 중지되었습니다.',
        reviews: currentCollectedReviews.length > 0 ? currentCollectedReviews : [] 
      }).catch(() => {
      });
    } catch (e) {
    }

    try {
      chrome.runtime.sendMessage({
        action: 'stopScraping'
      }).catch(() => { });
    } catch (e) { }
  }
});


if (!window.__coupangReviewScraperLoaded) {
  window.__coupangReviewScraperLoaded = true;

  (function () {
    'use strict';


    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
          if (isScraping) {
            isScraping = false;
            stopScraping = false;
          }
        }, 1000);
      });
    } else {
      if (isScraping) {
        isScraping = false;
        stopScraping = false;
      }
    }

    function isExtensionContextValid() {
      try {
        return chrome.runtime && chrome.runtime.id !== undefined;
      } catch (e) {
        return false;
      }
    }

    function safeSendMessage(message, callback) {

      return new Promise((resolve, reject) => {
        if (!isExtensionContextValid()) {
          resolve(null);
          return;
        }

        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError;
              if (error.message && error.message.includes('Extension context invalidated')) {
                resolve(null);
              } else if (error.message && error.message.includes('message port closed')) {
                resolve(null);
              } else {
                resolve(null);
              }
            } else {
              if (callback) callback(response);
              resolve(response);
            }
          });
        } catch (error) {
          if (error.message && (
            error.message.includes('Extension context invalidated') ||
            error.message.includes('message port closed')
          )) {
            resolve(null);
          } else {
            resolve(null);
          }
        }
      });
    }

    if (!window.__coupangReviewScraperListenerAdded) {
      window.__coupangReviewScraperListenerAdded = true;

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!isExtensionContextValid()) {
          try {
            sendResponse({ success: false, error: 'Extension context invalidated' });
          } catch (e) {
          }
          return false;
        }
        if (request.action === 'complete') {
          sendToUI({
            action: 'complete',
            reviews: request.reviews || [],
            stopped: request.stopped || false
          });
        }

        if (request.action === 'ping') {
          try {
            sendResponse({ success: true, message: 'Content Script 활성', url: window.location.href });
          } catch (e) {
          }
          return true;
        }

        if (request.action === 'startScraping') {
          if (request.originalTabId) {
            currentOriginalTabId = request.originalTabId;
          }


          sendToUI({
            action: 'startScraping',
            message: '리뷰 수집을 시작합니다...'
          });

          if (isScraping) {
            const errorMsg = '이미 수집 중입니다. 잠시 후 다시 시도해주세요.';
            isScraping = false;
            stopScraping = false;

            try {
              sendResponse({ success: false, error: errorMsg });
            } catch (e) {
            }
            return false;
          }

          let responseSent = false;
          try {
            sendResponse({ success: true, message: '수집 시작됨' });
            responseSent = true;
          } catch (e) {
          }

          startScraping(request.url)
            .then(result => {
            })
            .catch(error => {
            });

          return true; 
        } else if (request.action === 'stopScraping') {
          stopScraping = true;
          isScraping = false;
          safeSendMessage({
            action: 'stopped',
            message: '수집이 중지되었습니다.',
            reviews: currentCollectedReviews.length > 0 ? currentCollectedReviews : [] 
          }).then(() => {
          }).catch(err => {
          });

          try {
            sendResponse({ success: true, message: '수집 중지됨' });
          } catch (e) {
          }
          return true;
        } else if (request.action === 'resetState') {
          isScraping = false;
          stopScraping = false;
          if (isExtensionContextValid()) {
            sendResponse({ success: true });
          }
          return true;
        }

        return false;
      });
    }

    async function startScraping(url) {
      if (isScraping) {
        throw new Error('이미 수집 중입니다.');
      }

      isScraping = true;
      stopScraping = false;
      currentCollectedReviews = []; 
      try {
        const currentUrl = window.location.href;
        if (!currentUrl.includes('/vp/products/')) {
          window.location.href = url;
          await waitForPageLoad();
        } else {
        }

        await waitForPageReady();
        safeSendMessage({
          action: 'log',
          message: '리뷰 탭을 찾고 클릭합니다...',
          type: 'info'
        });
        await clickReviewTab();
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }
        safeSendMessage({
          action: 'log',
          message: '리뷰 탭 클릭 완료',
          type: 'success'
        });
        await waitForReviewsSection();
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }
        await sleep(1000);
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }
        safeSendMessage({
          action: 'log',
          message: '리뷰 수집을 시작합니다...',
          type: 'info'
        });
        const allReviews = await collectAllReviews();
        safeSendMessage({
          action: 'log',
          message: `리뷰 수집 완료: 총 ${allReviews.length}개 리뷰 수집됨`,
          type: 'success'
        });
        if (allReviews.length === 0) {
          const errorMsg = '리뷰를 찾을 수 없습니다. 리뷰 추출을 종료합니다.';
          safeSendMessage({
            action: 'log',
            message: '리뷰를 찾지 못했습니다.',
            type: 'warning'
          });
          safeSendMessage({
            action: 'log',
            message: '리뷰 추출을 종료합니다.',
            type: 'warning'
          });

          safeSendMessage({
            action: 'stopped',
            message: errorMsg,
            reviews: [] 
          }).then(() => {
          }).catch(err => {
          });

          isScraping = false;
          return { reviews: [], stopped: true };
        }

        const isStopped = stopScraping;

        if (!isStopped) {
          safeSendMessage({
            action: 'complete',
            reviews: allReviews,
            stopped: false
          });
        }

        isScraping = false;
        return { reviews: allReviews, stopped: isStopped };
      } catch (error) {
        isScraping = false;
        const errorMessage = error instanceof DOMException
          ? `DOM 오류: ${error.name} - ${error.message || '알 수 없는 DOM 오류'}`
          : error.message || String(error);

        safeSendMessage({
          action: 'error',
          error: errorMessage
        }).then(() => {
        }).catch(err => {
        });
        throw new Error(errorMessage);
      }
    }

    function waitForPageLoad() {
      return new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve, { once: true });
        }
      });
    }

    function waitForPageReady() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        if (document.readyState === 'complete' && document.body) {
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (stopScraping || Date.now() - startTime >= 1000) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          return;
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            if (stopScraping) {
              resolve();
              return;
            }
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
              if (stopScraping || Date.now() - startTime >= 1000) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
          }, { once: true });
        } else {
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (stopScraping || Date.now() - startTime >= 1000) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        }
      });
    }

    function waitForReviewsSection() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview && sdpReview.children.length > 0) {
          resolve();
          return;
        }

        const observer = new MutationObserver((mutations, obs) => {
          if (stopScraping) {
            obs.disconnect();
            resolve();
            return;
          }

          const reviewSection = document.querySelector('#sdpReview');
          if (reviewSection && reviewSection.children.length > 0) {
            obs.disconnect();
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
              if (stopScraping || Date.now() - startTime >= 500) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
          }
        });

        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }

        const startTime = Date.now();
        const timeoutInterval = setInterval(() => {
          if (stopScraping || Date.now() - startTime >= 5000) {
            clearInterval(timeoutInterval);
            observer.disconnect();
            resolve();
          }
        }, 100);
      });
    }


    async function clickReviewTab() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        try {
          if (!document.body) {
            setTimeout(() => {
              if (stopScraping) {
                resolve();
                return;
              }
              clickReviewTab().then(resolve).catch(() => resolve());
            }, 1000);
            return;
          }

          const reviewTabSelectors = [
            '[data-value="review"]',
            'button[data-value="review"]',
            'a[data-value="review"]',
            'div[data-value="review"]'
          ];

          let reviewTabs = [];
          for (const selector of reviewTabSelectors) {
            try {
              reviewTabs = Array.from(document.querySelectorAll(selector));
              if (reviewTabs.length > 0) break;
            } catch (e) {
            }
          }

          if (reviewTabs.length === 0) {
            try {
              const allButtons = Array.from(document.querySelectorAll('button, a'));
              reviewTabs = allButtons.filter(el => {
                try {
                  const text = (el.textContent || '').toLowerCase().trim();
                  return text.includes('리뷰') && !text.includes('이미지') && !text.includes('image');
                } catch (e) {
                  return false;
                }
              });
            } catch (e) {
            }
          }

          for (const tab of reviewTabs) {
            if (stopScraping) {
              resolve();
              return;
            }

            try {
              const text = (tab.textContent || '').toLowerCase().trim();
              if (text.includes('리뷰') && !text.includes('이미지') && !text.includes('image')) {
                if (tab.offsetParent !== null && !tab.disabled) {
                  try {
                    tab.click();
                    const startTime = Date.now();
                    const checkInterval = setInterval(() => {
                      if (stopScraping || Date.now() - startTime >= 1000) {
                        clearInterval(checkInterval);
                        resolve();
                      }
                    }, 100);
                    return;
                  } catch (clickError) {
                  }
                }
              }
            } catch (e) {
            }
          }

          resolve();
        } catch (error) {
          resolve(); 
        }
      });
    }

    async function collectAllReviews() {
      const allReviews = [];
      currentCollectedReviews = allReviews;
      let currentPage = 1;
      let consecutiveFailures = 0;
      const maxFailures = 3;
      let hasNoReviewsMessage = false;
      const noReviewMessages = [
        '등록된 상품평이 없습니다',
        '등록된 리뷰가 없습니다',
        '상품평이 없습니다'
      ];

      let firstPageReviews = extractReviewsFromPage();
      if (firstPageReviews.length === 0) {
        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview) {
          const reviewText = sdpReview.textContent || '';
          const hasNoReviewInSection = noReviewMessages.some(msg => {
            const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return regex.test(reviewText);
          });

          if (hasNoReviewInSection) {
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              hasNoReviewsMessage = true;
            } else {
              firstPageReviews = extractReviewsFromPage();
            }
          }
        }
      }

      if (firstPageReviews.length > 0) {
        for (const review of firstPageReviews) {
          isDuplicateReview(review, allReviews);
          allReviews.push(review);

          const reviewContent = (review.content || '').substring(0, 30);
          const reviewDate = review.date || '날짜 없음';
          const reviewRating = review.rating || 0;
          safeSendMessage({
            action: 'log',
            message: `리뷰 수집: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} ${reviewContent}${reviewContent.length >= 30 ? '...' : ''}`,
            type: 'info'
          });
        }
        currentPage = 2;
      } else {
        currentPage = 1;
      }

      while (!stopScraping && !hasNoReviewsMessage && consecutiveFailures < maxFailures) {
        if (stopScraping) {
          safeSendMessage({
            action: 'log',
            message: `중지 요청 감지: 수집을 중지합니다. (현재까지 ${allReviews.length}개 수집됨)`,
            type: 'warning'
          });
          break;
        }
        safeSendMessage({
          action: 'log',
          message: `페이지 ${currentPage} 리뷰 수집 시작...`,
          type: 'info'
        });

        const reviews = extractReviewsFromPage();
        if (stopScraping) {
          break;
        }

        if (reviews.length === 0) {
          const sdpReview = document.querySelector('#sdpReview');
          if (sdpReview) {
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              const reviewText = sdpReview.textContent || '';
              const hasNoReviewInSection = noReviewMessages.some(msg => {
                const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                return regex.test(reviewText);
              });

              if (hasNoReviewInSection) {
                hasNoReviewsMessage = true;
                break;
              }
            } else {
            }
          }

          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            safeSendMessage({
              action: 'log',
              message: '리뷰를 찾지 못했습니다.',
              type: 'warning'
            });
            safeSendMessage({
              action: 'log',
              message: '리뷰 추출을 종료합니다.',
              type: 'warning'
            });
            break;
          }

          await sleep(1000);
          if (stopScraping) {
            break;
          }
          continue;
        }

        for (const review of reviews) {
          if (stopScraping) {
            break;
          }

          isDuplicateReview(review, allReviews);
          allReviews.push(review);

          const reviewContent = (review.content || '').substring(0, 30);
          const reviewDate = review.date || '날짜 없음';
          const reviewRating = review.rating || 0;
          safeSendMessage({
            action: 'log',
            message: `리뷰 수집: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} ${reviewContent}${reviewContent.length >= 30 ? '...' : ''}`,
            type: 'info'
          });
        }

        if (stopScraping) {
          break;
        }

        const progressPercent = Math.min(90, (currentPage * 10));
        const progressText = `${allReviews.length}개 리뷰 수집 중... (페이지 ${currentPage})`;
        safeSendMessage({
          action: 'progress',
          percent: progressPercent,
          text: progressText,
          log: `페이지 ${currentPage}: ${reviews.length}개 리뷰 발견, 총 ${allReviews.length}개 수집됨`,
          logType: 'info'
        }).then(() => {
        }).catch(err => {
        });

        if (stopScraping) {
          break;
        }

        if (stopScraping) {
          break;
        }

        safeSendMessage({
          action: 'log',
          message: `다음 페이지로 이동 시도...`,
          type: 'info'
        });
        const hasNext = await goToNextPage();

        if (stopScraping) {
          break;
        }
        if (!hasNext) {
          safeSendMessage({
            action: 'log',
            message: '더 이상 수집할 페이지가 없습니다.',
            type: 'info'
          });
          break;
        } else {
          safeSendMessage({
            action: 'log',
            message: `페이지 ${currentPage + 1}로 이동 완료`,
            type: 'success'
          });
        }

        currentPage++;
        consecutiveFailures = 0;
        await sleep(2000); 
      }

      if (allReviews.length === 0) {
        if (hasNoReviewsMessage) {
          safeSendMessage({
            action: 'error',
            error: '이 상품에는 등록된 리뷰가 없습니다.'
          }).then(() => {
          }).catch(err => {
          });
        } else {
          safeSendMessage({
            action: 'log',
            message: '리뷰를 찾지 못했습니다.',
            type: 'warning'
          });
          safeSendMessage({
            action: 'log',
            message: '리뷰 추출을 종료합니다.',
            type: 'warning'
          });
          safeSendMessage({
            action: 'stopped',
            message: '리뷰를 찾지 못했습니다. 리뷰 추출을 종료합니다.',
            reviews: [] 
          });
        }
      }

      return allReviews;
    }

    function extractReviewsFromPage() {
      const reviews = [];
      try {
        const noReviewMessages = [
          '등록된 상품평이 없습니다',
          '등록된 리뷰가 없습니다',
          '상품평이 없습니다',
          '리뷰가 없습니다',
          'no reviews',
          'no registered'
        ];

        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview) {
          const reviewText = sdpReview.textContent || '';
          const hasNoReviewMessage = noReviewMessages.some(msg => {
            const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return regex.test(reviewText);
          });

          if (hasNoReviewMessage) {
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              return reviews; 
            } else {
            }
          }
        }

        if (sdpReview) {
        }

        const reviewSelectors = [
          '#sdpReview article',
          '#sdpReview div[class*="review"]',
          '#sdpReview div[class*="Review"]',
          '#sdpReview div[class*="REVIEW"]',
          'article[class*="sdp-review"]',
          'article[class*="sdp-Review"]',
          'div[class*="sdp-review"]',
          'div[class*="sdp-Review"]',
          '#sdpReview > div > article',
          '#sdpReview > div > div[class*="review"]',
          '#sdpReview section article',
          '#sdpReview section div[class*="review"]',
          'div[class*="review"]',
          'article[class*="review"]'
        ];

        let reviewElements = [];
        for (const selector of reviewSelectors) {
          if (stopScraping) {
            break;
          }

          try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              reviewElements = elements;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (reviewElements.length === 0) {
          try {
            if (sdpReview) {
              const reviewText = sdpReview.textContent || '';
              const hasNoReviewInSection = noReviewMessages.some(msg => {
                const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                return regex.test(reviewText);
              });

              if (hasNoReviewInSection) {
                const checkElements = sdpReview.querySelectorAll('article, div, section');
                if (checkElements.length === 0 || checkElements.length < 3) {
                  return reviews; 
                } else {
                }
              }

              const fallbackSelectors = [
                'article',
                'div[class*="review"]',
                'div[class*="comment"]',
                'div[class*="Review"]',
                'div[class*="item"]',
                'li[class*="review"]',
                'li[class*="item"]'
              ];

              for (const selector of fallbackSelectors) {
                if (stopScraping) {
                  break;
                }

                try {
                  const elements = sdpReview.querySelectorAll(selector);
                  if (elements.length > 0) {
                    const filtered = Array.from(elements).filter(el => {
                      const text = el.textContent || '';
                      return text.length > 50 && text.length < 5000; 
                    });
                    if (filtered.length > 0) {
                      reviewElements = filtered;
                      break;
                    }
                  }
                } catch (e) {
                }
              }
            } else {
            }
          } catch (e) {
          }
        }
        for (let i = 0; i < reviewElements.length; i++) {
          if (stopScraping) {
            break; 
          }

          const element = reviewElements[i];
          try {
            const elementText = element.textContent || '';
            const isNoReviewMessage = noReviewMessages.some(msg =>
              elementText.includes(msg) && elementText.length < 100 
            );

            if (isNoReviewMessage) {
              continue; 
            }

            if (elementText.length < 20 || elementText.length > 10000) {
              continue;
            }

            if (stopScraping) {
              break;
            }

            const review = extractReviewData(element);
            if (review) {
              const content = review.content ? review.content.trim() : '';


              review.content = content || '';
              reviews.push(review);
            }
          } catch (error) {
          }
        }
        if (reviews.length === 0) {
          const sdpReview = document.querySelector('#sdpReview');
          let debugInfo = '리뷰를 찾지 못했습니다.\n';

          if (sdpReview) {
            debugInfo += `#sdpReview 섹션 존재 (요소 ${sdpReview.children.length}개)\n`;
          } else {
            debugInfo += '#sdpReview 섹션을 찾을 수 없습니다.\n';
          }

          const pageText = document.body ? document.body.textContent || '' : '';
          const reviewKeywords = ['리뷰', '상품평', 'review', '평점', '별점'];
          const hasReviewKeywords = reviewKeywords.some(keyword => pageText.includes(keyword));
          debugInfo += `리뷰 관련 키워드 존재: ${hasReviewKeywords}\n`;
          debugInfo += `발견된 리뷰 요소 수: ${reviewElements.length}개`;

          safeSendMessage({
            action: 'log',
            message: debugInfo,
            type: 'warning'
          });
          safeSendMessage({
            action: 'log',
            message: '리뷰 추출을 종료합니다.',
            type: 'warning'
          });
        }
      } catch (error) {
      }

      return reviews;
    }

    function extractReviewData(element) {
      if (!element) {
        return null;
      }

      let content = '';
      let rating = '';
      let date = '';

      try {
        try {
          const contentSelectors = [
            'div.twc-text-\\[14px\\]\\/\\[19px\\].twc-text-bluegray-900.twc-break-all',
            'div[class*="text"][class*="bluegray-900"][class*="break-all"]',
            'div[class*="text-14px"][class*="text-bluegray-900"]',
            'div[class*="break-all"]',
            'div[class*="content"]',
            'div[class*="text-bluegray-900"]',
            'div[class*="review-content"]',
            'div[class*="comment-content"]'
          ];

          let contentEl = null;
          for (const selector of contentSelectors) {
            try {
              contentEl = element.querySelector(selector);
              if (contentEl && (contentEl.textContent || '').trim().length > 10) {
                break;
              }
            } catch (e) {
              continue;
            }
          }

          if (contentEl) {
            content = (contentEl.textContent || '').trim();
          }

          if (!content || content.length < 10) {
            const alternativeSelectors = [
            const alternativeSelectors = [
              'div[class*="text"][class*="bluegray-900"]',
              'div[class*="break-all"]',
              'div[class*="content"]',
              'div[class*="text"]',
              'p',
              'span[class*="text"]',
              'div[class*="review"]',
              'div[class*="comment"]'
            ];

            for (const selector of alternativeSelectors) {
              try {
                const altEl = element.querySelector(selector);
                if (altEl) {
                  const candidateContent = (altEl.textContent || '').trim();
                  if (candidateContent && candidateContent.length > content.length && candidateContent.length > 10) {
                    content = candidateContent;
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }

          if (!content || content.length < 10) {
            const directText = (element.textContent || '').trim();

            if (directText.length > 20) {
            if (directText.length > 20) {
              const allDivs = element.querySelectorAll('div');
              let longestText = '';
              for (const div of allDivs) {
                const divText = (div.textContent || '').trim();
                if (divText.length > longestText.length && divText.length >= 20 && divText.length < 2000) {
                  const hasRatingPattern = /별점|평점|점|★|⭐|rating|star/i.test(divText);
                  const hasDatePattern = /\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}/.test(divText);
                  const hasUserNamePattern = /^\*+$|^[가-힣]\*+[가-힣]?$/.test(divText);

                  if (!hasRatingPattern && !hasDatePattern && !hasUserNamePattern) {
                    longestText = divText;
                  }
                }
              }

              if (longestText.length > content.length && longestText.length >= 20) {
                content = longestText;
              } else {
                const lines = directText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length > 2) {
                  const middleContent = lines.slice(1, -1).join(' ').trim();
                  if (middleContent && middleContent.length > content.length && middleContent.length > 10) {
                    content = middleContent;
                  }
                } else if (directText.length > 20) {
                  content = directText;
                }
              }
            }
          }
        } catch (e) {
        }

        try {
          const ratingSelectors = [
            'div.twc-flex.twc-gap-\\[12px\\] > div.twc-flex.twc-flex-col.twc-gap-\\[6px\\] > div.twc-flex.twc-items-center.twc-gap-\\[6px\\] > div.twc-inline-flex.twc-items-center.twc-gap-\\[2px\\]',
            'div[class*="inline-flex"][class*="items-center"][class*="gap"]',
            'div[class*="flex"][class*="items-center"][class*="gap-2px"]',
            'div[class*="rating"]',
            'div[class*="star"]',
            'div[aria-label*="별점"]',
            'div[aria-label*="rating"]'
          ];

          let ratingEl = null;
          for (const selector of ratingSelectors) {
            try {
              ratingEl = element.querySelector(selector);
              if (ratingEl) {
                const starElements = ratingEl.querySelectorAll('i');
                if (starElements && starElements.length > 0) {
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }

          if (ratingEl) {
            const starElements = ratingEl.querySelectorAll('i');
            if (starElements && starElements.length > 0) {
              let filledStarCount = 0;
              const starDetails = [];
              for (const star of starElements) {
                const starClass = star.className || '';
                const starStyle = star.getAttribute('style') || '';
                const starAria = star.getAttribute('aria-label') || '';
                const starHTML = star.outerHTML.substring(0, 200);

                const svgFill = star.querySelector('svg [fill]') || star.querySelector('svg path[fill]');
                const hasSvgFill = svgFill && svgFill.getAttribute('fill') && svgFill.getAttribute('fill') !== 'none' && svgFill.getAttribute('fill') !== 'transparent';

                const hasFillClass = starClass.includes('fill') || starClass.includes('filled') ||
                                   starClass.includes('active') || starClass.includes('selected') ||
                                   starClass.includes('checked') || starClass.includes('on');

                const hasColorStyle = starStyle.includes('color') && !starStyle.includes('color:transparent') && !starStyle.includes('color:none');
                const hasFillStyle = starStyle.includes('fill') && !starStyle.includes('fill:none') && !starStyle.includes('fill:transparent');

                const hasAriaStar = starAria.includes('별') || starAria.includes('star') || starAria.includes('점');

                const starText = star.textContent || '';
                const hasStarChar = starText.includes('★') || starText.includes('⭐');

                const isFilled = hasSvgFill || hasFillClass || hasColorStyle || hasFillStyle || (hasAriaStar && hasStarChar);

                starDetails.push({
                  index: filledStarCount + 1,
                  className: starClass.substring(0, 100),
                  style: starStyle.substring(0, 100),
                  ariaLabel: starAria,
                  hasSvgFill: !!hasSvgFill,
                  hasFillClass,
                  hasColorStyle,
                  hasFillStyle,
                  hasAriaStar,
                  hasStarChar,
                  isFilled,
                  htmlPreview: starHTML
                });

                if (isFilled) {
                  filledStarCount++;
                }
              }

              if (filledStarCount > 0) {
              if (filledStarCount > 0) {
                rating = filledStarCount.toString();
              } else {
                rating = Math.min(starElements.length, 5).toString();
              }
            } else {
              const ariaLabel = ratingEl.getAttribute('aria-label') || '';
              let match = ariaLabel.match(/(\d+)/);
              if (match) {
                rating = match[1];
              } else {
                const className = ratingEl.className || '';
                match = className.match(/(?:star|rating)[-_]?(\d+)/i);
                if (match) {
                  rating = match[1];
                } else {
                  const text = ratingEl.textContent || '';
                  match = text.match(/(\d+)\s*(?:점|별|star|rating)/i);
                  if (match) {
                    rating = match[1];
                  }
                }
              }
            }
          } else {
            const allText = element.textContent || '';
            const starPattern = /[★⭐]+/g;
            const starMatches = allText.match(starPattern);
            if (starMatches && starMatches.length > 0) {
              const longestMatch = starMatches.reduce((a, b) => a.length > b.length ? a : b);
              const filledStars = (longestMatch.match(/[★⭐]/g) || []).length;
              if (filledStars > 0 && filledStars <= 5) {
                rating = filledStars.toString();
              }
            }

            if (!rating) {
              const allIElements = element.querySelectorAll('i');
              if (allIElements && allIElements.length > 0) {
                for (const iEl of allIElements) {
                  const iClass = iEl.className || '';
                  const iStyle = iEl.getAttribute('style') || '';
                  const isFilled = iClass.includes('fill') || iClass.includes('filled') ||
                                   iStyle.includes('color') || iStyle.includes('fill');
                  if (isFilled) {
                    let filledCount = 0;
                    for (const i of allIElements) {
                      const ic = i.className || '';
                      const is = i.getAttribute('style') || '';
                      if (ic.includes('fill') || ic.includes('filled') || is.includes('color') || is.includes('fill')) {
                        filledCount++;
                      }
                    }
                    if (filledCount > 0 && filledCount <= 5) {
                      rating = filledCount.toString();
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
        }

        try {
          const dateSelectors = [
            '.twc-text-\\[14px\\]\\/\\[15px\\].twc-text-bluegray-700',
            'div[class*="text-14px"][class*="text-bluegray-700"]',
            'div[class*="text-bluegray-700"]',
            'time',
            '[datetime]',
            'div[class*="date"]',
            'span[class*="date"]'
          ];

          let dateEl = null;
          for (const selector of dateSelectors) {
            try {
              dateEl = element.querySelector(selector);
              if (dateEl && (dateEl.textContent || dateEl.getAttribute('datetime'))) {
                break;
              }
            } catch (e) {
              continue;
            }
          }

          if (dateEl) {
            date = dateEl.getAttribute('datetime') || '';
            if (date) {
              const dateMatch = date.match(/(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                date = dateMatch[1];
              }
            } else {
              const dateText = (dateEl.textContent || '').trim();
              if (dateText) {
                const dateMatch = dateText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
                if (dateMatch) {
                  date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
                } else {
                  date = dateText;
                }
              }
            }
          }
        } catch (e) {
        }
      } catch (error) {
      }

      const review = {
        content: content || '',
        rating: rating || '',
        date: date || new Date().toISOString().split('T')[0],
        originalTabId: currentOriginalTabId || null 
      };

      if (!content || content.length < 10) {
        const contentPreview = content ? (content.substring(0, 30) + (content.length > 30 ? '...' : '')) : '(비어있음)';
      }

      return review;
    }

    function isDuplicateReview(review, existingReviews) {
      const duplicateIndex = existingReviews.findIndex(existing =>
        existing.content === review.content
      );

      if (duplicateIndex !== -1) {
        existingReviews.splice(duplicateIndex, 1);
        return false; 
      }

      return false; 
    }

    async function goToNextPage() {
      return new Promise((resolve) => {
        const paginationButtons = document.querySelectorAll(
          '#sdpReview button, #sdpReview [class*="pagination"] button, [aria-label*="다음"]'
        );

        let nextButton = null;
        for (const button of paginationButtons) {
          const text = button.textContent?.trim() || '';
          const ariaLabel = button.getAttribute('aria-label') || '';

          if (text === '다음' || ariaLabel.includes('다음') ||
            (text.match(/^\d+$/) && parseInt(text) > getCurrentPageNumber())) {
            if (!button.disabled && button.offsetParent !== null) {
              nextButton = button;
              break;
            }
          }
        }

        if (!nextButton) {
          const currentPage = getCurrentPageNumber();
          const nextPageNum = currentPage + 1;

          for (const button of paginationButtons) {
            const text = button.textContent?.trim() || '';
            if (text === String(nextPageNum) && !button.disabled) {
              nextButton = button;
              break;
            }
          }
        }

        if (nextButton) {
          try {
            nextButton.click();
            setTimeout(() => resolve(true), 3000); 
          } catch (clickError) {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });
    }

    function getCurrentPageNumber() {
      const activeButton = document.querySelector(
        '#sdpReview button[aria-current="page"], #sdpReview button[class*="active"]'
      );
      if (activeButton) {
        const text = activeButton.textContent?.trim() || '';
        const num = parseInt(text);
        if (!isNaN(num)) return num;
      }
      return 1;
    }

    function sleep(ms) {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const checkInterval = 100; 

        const interval = setInterval(() => {
          if (stopScraping) {
            clearInterval(interval);
            resolve();
            return;
          }

          if (Date.now() - startTime >= ms) {
            clearInterval(interval);
            resolve();
          }
        }, checkInterval);
      });
    }

  })(); 
} 
