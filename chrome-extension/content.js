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

// ==================== 전역 변수 ====================
let isScraping = false;
let stopScraping = false;
let currentOriginalTabId = null;
let currentCollectedReviews = [];
let currentRatingFilter = 'all';
let targetProductId = null;
let targetUrl = null;

// ==================== 상수 정의 ====================
const CONSTANTS = {
  // 대기 시간 (ms)
  WAIT_TIMES: {
    SHORT: 100,
    MEDIUM: 150,
    LONG: 200,
    PAGE_LOAD: 300,
    FILTER_APPLY: 150
  },
  // 최대 재시도 횟수
  MAX_RETRIES: {
    PAGE_ELEMENTS: 3,
    CONSECUTIVE_FAILURES: 3,
    PING: 10
  },
  // 페이지네이션
  PAGINATION: {
    START_BUTTON_INDEX: 2,
    MAX_BUTTON_INDEX: 12
  },
  // 리뷰 추출 조건
  REVIEW: {
    MIN_CONTENT_LENGTH: 10,
    MAX_CONTENT_LENGTH: 15000,
    MIN_ELEMENT_TEXT_LENGTH: 10,
    MAX_ELEMENT_TEXT_LENGTH: 5000,
    MIN_REVIEW_ELEMENTS: 5
  },
  // 메시지
  NO_REVIEW_MESSAGES: [
    '등록된 상품평이 없습니다',
    '등록된 리뷰가 없습니다',
    '상품평이 없습니다',
    '리뷰가 없습니다',
    'no reviews',
    'no registered'
  ]
};

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
      const finalReviews = currentCollectedReviews.length > 0 ? currentCollectedReviews : [];
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: `수집이 중지되었습니다. (현재까지 ${finalReviews.length}개 수집됨)`,
        reviews: finalReviews,
        originalTabId: currentOriginalTabId
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

          if (request.ratingFilter) {
            currentRatingFilter = request.ratingFilter;
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

          startScraping(request.url, request.ratingFilter || 'all')
            .then(result => {
            })
            .catch(error => {
            });

          return true;
        } else if (request.action === 'stopScraping') {
          stopScraping = true;
          isScraping = false;

          const finalReviews = currentCollectedReviews.length > 0 ? currentCollectedReviews : [];
          safeSendMessage({
            action: 'stopped',
            message: `수집이 중지되었습니다. (현재까지 ${finalReviews.length}개 수집됨)`,
            reviews: finalReviews,
            originalTabId: currentOriginalTabId
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

    async function startScraping(url, ratingFilter = 'all') {
      if (isScraping) {
        throw new Error('이미 수집 중입니다.');
      }

      isScraping = true;
      stopScraping = false;
      currentCollectedReviews = [];
      currentRatingFilter = ratingFilter;
      targetUrl = url.trim();
      const extractedProductId = targetUrl.match(/\/products\/(\d+)/)?.[1];
      targetProductId = extractedProductId;

      try {
        await waitForPageReady();

        const currentUrl = window.location.href;

        safeSendMessage({
          action: 'log',
          message: `현재 URL: ${currentUrl}`,
          type: 'info'
        });
        safeSendMessage({
          action: 'log',
          message: `목표 URL: ${targetUrl}`,
          type: 'info'
        });

        const currentProductId = currentUrl.match(/\/products\/(\d+)/)?.[1];
        const targetProductId = targetUrl.match(/\/products\/(\d+)/)?.[1];

        const isProductPage = currentUrl.includes('/vp/products/') || currentUrl.includes('/products/');
        const productIdMatches = currentProductId && targetProductId && currentProductId === targetProductId;

        const urlMatches = currentUrl === targetUrl ||
          currentUrl.replace(/\/$/, '') === targetUrl.replace(/\/$/, '') ||
          productIdMatches;

        if (!isProductPage || !productIdMatches) {
          safeSendMessage({
            action: 'log',
            message: `올바른 상품 페이지로 이동합니다... (현재 상품 ID: ${currentProductId || '없음'}, 목표 상품 ID: ${targetProductId || '없음'})`,
            type: 'info'
          });
          window.location.href = targetUrl;
          await waitForPageLoad();
          await waitForPageReady();
        } else {
          safeSendMessage({
            action: 'log',
            message: `이미 올바른 상품 페이지에 있습니다. (상품 ID: ${currentProductId})`,
            type: 'info'
          });
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
        await sleep(300);
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }

        if (ratingFilter && ratingFilter !== 'all') {
          console.log(`[리뷰 수집기] 별점 필터 적용 중: ${ratingFilter}점`);
          safeSendMessage({
            action: 'log',
            message: `별점 필터 적용 중: ${ratingFilter}점`,
            type: 'info'
          });
          const filterApplied = await clickRatingFilter(ratingFilter);
          if (filterApplied) {
            console.log(`[리뷰 수집기] 별점 필터 적용 완료: ${ratingFilter}점 - 필터링된 리뷰만 수집합니다.`);
            safeSendMessage({
              action: 'log',
              message: `별점 필터 적용 완료: ${ratingFilter}점 - 필터링된 리뷰만 수집합니다.`,
              type: 'success'
            });
            // 필터 적용 후 페이지 업데이트 대기
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
            await waitForPageReady();
            await waitForReviewsSection();
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
          } else {
            console.warn(`[리뷰 수집기] 별점 필터를 찾을 수 없습니다. 모든 리뷰를 수집합니다.`);
            safeSendMessage({
              action: 'log',
              message: '별점 필터를 찾을 수 없습니다. 모든 리뷰를 수집합니다.',
              type: 'warning'
            });
          }
          if (stopScraping) {
            throw new Error('수집이 중지되었습니다.');
          }
        } else {
          console.log(`[리뷰 수집기] 별점 필터 없음 - 모든 별점의 리뷰를 수집합니다.`);
        }

        safeSendMessage({
          action: 'log',
          message: '리뷰 수집을 시작합니다...',
          type: 'info'
        });
        safeSendMessage({
          action: 'progress',
          percent: 5,
          text: '리뷰 수집 준비 중...',
          originalTabId: currentOriginalTabId
        });
        const allReviews = await collectAllReviews();
        currentCollectedReviews = allReviews;
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
            reviews: [],
            originalTabId: currentOriginalTabId
          }).then(() => {
          }).catch(err => {
          });

          isScraping = false;
          return { reviews: [], stopped: true };
        }

        const isStopped = stopScraping;
        currentCollectedReviews = allReviews;

        if (isStopped) {
          safeSendMessage({
            action: 'stopped',
            message: `수집이 중지되었습니다. (현재까지 ${allReviews.length}개 수집됨)`,
            reviews: allReviews,
            originalTabId: currentOriginalTabId
          });
        } else {
          safeSendMessage({
            action: 'complete',
            reviews: allReviews,
            stopped: false,
            originalTabId: currentOriginalTabId
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
          error: errorMessage,
          originalTabId: currentOriginalTabId
        }).then(() => {
        }).catch(err => {
        });
        throw new Error(errorMessage);
      }
    }

    /**
     * 페이지 로드 완료 대기
     * @returns {Promise<void>}
     */
    function waitForPageLoad() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        if (document.readyState === 'complete') {
          resolve();
        } else {
          const handler = () => {
            if (!stopScraping) resolve();
          };
          window.addEventListener('load', handler, { once: true });

          // 타임아웃 설정 (10초)
          setTimeout(() => {
            window.removeEventListener('load', handler);
            resolve();
          }, 10000);
        }
      });
    }

    /**
     * 페이지 준비 완료 대기 (최적화)
     * @returns {Promise<void>}
     */
    function waitForPageReady() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        const maxWaitTime = CONSTANTS.WAIT_TIMES.PAGE_LOAD;
        const checkInterval = 50;

        const checkReady = () => {
          if (stopScraping) {
            resolve();
            return;
          }

          if (document.readyState === 'complete' && document.body) {
            resolve();
            return;
          }
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            if (!stopScraping) {
              setTimeout(checkReady, checkInterval);
            } else {
              resolve();
            }
          }, { once: true });
        } else {
          checkReady();
        }

        // 타임아웃 보호
        setTimeout(() => {
          if (!stopScraping) resolve();
        }, maxWaitTime);
      });
    }

    /**
     * 리뷰 섹션 로드 대기 (최적화)
     * @returns {Promise<void>}
     */
    function waitForReviewsSection() {
      return new Promise((resolve) => {
        if (stopScraping) {
          resolve();
          return;
        }

        const sdpReview = safeQuerySelector('#sdpReview');
        if (sdpReview && sdpReview.children.length > 0) {
          resolve();
          return;
        }

        let observer = null;
        const maxWaitTime = 5000;
        const checkInterval = 50;
        const startTime = Date.now();

        const cleanup = () => {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
        };

        const checkSection = () => {
          if (stopScraping) {
            cleanup();
            resolve();
            return;
          }

          const reviewSection = safeQuerySelector('#sdpReview');
          if (reviewSection && reviewSection.children.length > 0) {
            cleanup();
            setTimeout(() => resolve(), CONSTANTS.WAIT_TIMES.LONG);
            return;
          }

          if (Date.now() - startTime >= maxWaitTime) {
            cleanup();
            resolve();
            return;
          }
        };

        if (document.body) {
          observer = new MutationObserver(checkSection);
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }

        // 주기적 체크
        const interval = setInterval(() => {
          checkSection();
          if (Date.now() - startTime >= maxWaitTime) {
            clearInterval(interval);
            cleanup();
            resolve();
          }
        }, checkInterval);
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

    async function clickRatingFilter(ratingValue) {
      return new Promise(async (resolve) => {
        if (stopScraping) {
          resolve(false);
          return;
        }

        try {
          if (!document.body) {
            setTimeout(() => {
              if (stopScraping) {
                resolve(false);
                return;
              }
              clickRatingFilter(ratingValue).then(resolve).catch(() => resolve(false));
            }, 1000);
            return;
          }

          const filterSelector = '#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div.twc-flex.max-md\\:twc-flex-wrap.twc-items-center.twc-gap-y-\\[12px\\] > div.twc-flex.twc-items-center.twc-justify-between.twc-gap-\\[8px\\].twc-w-full.twc-h-\\[40px\\].twc-px-\\[14px\\].twc-border.twc-border-bluegray-300.twc-rounded-\\[4px\\].twc-bg-white.twc-cursor-pointer.desktop-hover\\:twc-bg-bluegray-800\\/20.active\\:twc-bg-bluegray-800\\/30.focus\\:twc-outline-none.twc-flex-\\[0_0_142px\\].twc-ml-\\[8px\\]';

          let filterDropdown = null;
          try {
            filterDropdown = document.querySelector(filterSelector);
          } catch (e) {
          }

          if (!filterDropdown) {
            const alternativeSelectors = [
              '#sdpReview div[class*="cursor-pointer"][class*="border-bluegray-300"]',
              '#sdpReview div[class*="flex"][class*="items-center"][class*="border"]',
              '#sdpReview select',
              '#sdpReview button[class*="filter"]'
            ];

            for (const selector of alternativeSelectors) {
              try {
                filterDropdown = document.querySelector(selector);
                if (filterDropdown && filterDropdown.offsetParent !== null) {
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          }

          if (!filterDropdown || filterDropdown.offsetParent === null) {
            resolve(false);
            return;
          }

          try {
            if (!safeClick(filterDropdown)) {
              resolve(false);
              return;
            }
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);

            // 쿠팡 필터 순서: 모든 별점, 최고(5), 좋음(4), 보통(3), 별로(2), 나쁨(1)
            const ratingTextMap = {
              'all': ['모든 별점'],
              '5': ['최고', '5'],
              '4': ['좋음', '4'],
              '3': ['보통', '3'],
              '2': ['별로', '2'],
              '1': ['나쁨', '1']
            };

            const searchTerms = ratingTextMap[ratingValue] || [ratingValue];

            let optionFound = false;

            // #radix-_r_0_ > div 부분에서 인덱스로 선택
            // 쿠팡 필터 순서: 모든 별점(인덱스 0), 최고(5점, 인덱스 1), 좋음(4점, 인덱스 2), 보통(3점, 인덱스 3), 별로(2점, 인덱스 4), 나쁨(1점, 인덱스 5)
            const listbox = safeQuerySelector('div[role="listbox"]') || safeQuerySelector('#radix-_r_0_');
            if (listbox) {
              const options = Array.from(
                safeQuerySelectorAll('div[role="option"]', listbox).length > 0
                  ? safeQuerySelectorAll('div[role="option"]', listbox)
                  : safeQuerySelectorAll('div > div', listbox)
              );

              // 필터 값에 따른 인덱스 매핑
              const ratingIndexMap = {
                'all': 0,
                '5': 1,
                '4': 2,
                '3': 3,
                '2': 4,
                '1': 5
              };

              const targetIndex = ratingIndexMap[ratingValue];

              if (targetIndex !== undefined && options[targetIndex]) {
                const option = options[targetIndex];
                if (stopScraping) {
                  resolve(false);
                  return;
                }

                if (option.offsetParent !== null) {
                  try {
                    // 옵션 클릭
                    if (safeClick(option)) {
                      optionFound = true;
                      await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                      await waitForPageReady();
                      await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                    }
                  } catch (e) {
                    // 옵션 내부의 클릭 가능한 요소 찾기
                    try {
                      if (safeClick(option, 'div[class*="cursor-pointer"]')) {
                        optionFound = true;
                        await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                        await waitForPageReady();
                        await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                      }
                    } catch (e2) {
                      // 인덱스로 찾지 못한 경우 텍스트 매칭으로 fallback
                      optionFound = false;
                    }
                  }
                }
              }
            }

            // 인덱스로 찾지 못한 경우 텍스트 매칭으로 fallback
            if (!optionFound) {
              const listboxFallback = safeQuerySelector('div[role="listbox"]') || safeQuerySelector('#radix-_r_0_');
              if (listboxFallback) {
                const options = Array.from(
                  safeQuerySelectorAll('div[role="option"]', listboxFallback).length > 0
                    ? safeQuerySelectorAll('div[role="option"]', listboxFallback)
                    : safeQuerySelectorAll('div > div', listboxFallback)
                );

                for (const option of options) {
                  if (stopScraping) {
                    resolve(false);
                    return;
                  }

                  // 옵션 내부의 텍스트 요소 찾기
                  const textElement = safeQuerySelector('div[class*="flex"][class*="items-center"]', option);
                  let optionText = '';
                  if (textElement) {
                    const firstDiv = safeQuerySelector('div[class*="flex-[1_1_0]"]', textElement);
                    if (firstDiv) {
                      optionText = safeGetText(firstDiv);
                    } else {
                      const firstChild = safeQuerySelector('div:first-child', textElement);
                      optionText = firstChild ? safeGetText(firstChild) : safeGetText(textElement);
                    }
                  } else {
                    optionText = safeGetText(option);
                  }

                  // 정확한 매칭 확인
                  let isMatch = false;
                  for (const term of searchTerms) {
                    const normalizedOptionText = optionText.replace(/\s+/g, ' ').trim();
                    const normalizedTerm = term.trim();
                    if (normalizedOptionText.includes(normalizedTerm) || normalizedOptionText.startsWith(normalizedTerm)) {
                      isMatch = true;
                      break;
                    }
                  }

                  if (isMatch && option.offsetParent !== null) {
                    if (safeClick(option)) {
                      optionFound = true;
                      await sleep(CONSTANTS.WAIT_TIMES.LONG);
                      break;
                    }
                  }
                }
              }
            }

            // listbox를 찾지 못한 경우 기존 방식으로 찾기
            if (!optionFound) {
              const allClickableElements = safeQuerySelectorAll('div[role="option"], div[class*="option"], button, a, div[class*="cursor-pointer"]');

              for (const element of allClickableElements) {
                if (stopScraping) {
                  resolve(false);
                  return;
                }

                if (!element || element.nodeType !== Node.ELEMENT_NODE) continue;

                const text = safeGetText(element);
                const isMatch = searchTerms.some(term => text.includes(term));

                if (isMatch && safeClick(element)) {
                  optionFound = true;
                  await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                  await waitForPageReady();
                  await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                  break;
                }
              }
            }

            if (!optionFound) {
              const selectElements = safeQuerySelectorAll('select');
              for (const select of selectElements) {
                if (stopScraping) {
                  resolve(false);
                  return;
                }

                if (!select || select.nodeType !== Node.ELEMENT_NODE) continue;

                for (let i = 0; i < select.options.length; i++) {
                  const option = select.options[i];
                  if (!option) continue;

                  const optionText = safeGetText(option);
                  const isMatch = searchTerms.some(term => optionText.includes(term));

                  if (isMatch) {
                    try {
                      select.value = option.value;
                      select.dispatchEvent(new Event('change', { bubbles: true }));
                      optionFound = true;
                      await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                      await waitForPageReady();
                      await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                      break;
                    } catch (e) {
                      continue;
                    }
                  }
                }
                if (optionFound) break;
              }
            }

            resolve(optionFound);
          } catch (clickError) {
            resolve(false);
          }
        } catch (error) {
          resolve(false);
        }
      });
    }

    async function collectAllReviews() {
      const allReviews = [];
      currentCollectedReviews = allReviews;
      let currentPage = 1;
      let consecutiveFailures = 0;
      const maxFailures = CONSTANTS.MAX_RETRIES.CONSECUTIVE_FAILURES;
      let hasNoReviewsMessage = false;
      let buttonIndex = CONSTANTS.PAGINATION.START_BUTTON_INDEX;
      const maxButtonIndex = CONSTANTS.PAGINATION.MAX_BUTTON_INDEX;

      const updateCurrentCollectedReviews = () => {
        currentCollectedReviews = [...allReviews];
      };
      const noReviewMessages = CONSTANTS.NO_REVIEW_MESSAGES;

      // 첫 페이지 리뷰 추출 (필터링 후에는 이미 필터링된 첫 페이지 리뷰가 표시됨)
      safeSendMessage({
        action: 'progress',
        percent: 10,
        text: '첫 페이지 리뷰 추출 중...',
        originalTabId: currentOriginalTabId
      });

      // 첫 페이지 리뷰 추출 (한 번만 수행)
      let firstPageReviews = await extractReviewsFromPage();

      // 첫 페이지에서 리뷰를 찾지 못한 경우에만 재시도 (한 번만)
      if (firstPageReviews.length === 0) {
        const sdpReview = safeQuerySelector('#sdpReview');
        if (sdpReview) {
          const reviewText = safeGetText(sdpReview);
          const hasNoReviewInSection = noReviewMessages.some(msg => {
            try {
              const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
              return regex.test(reviewText);
            } catch (e) {
              return false;
            }
          });

          if (hasNoReviewInSection) {
            const reviewElements = safeQuerySelectorAll('article, div[class*="review"], div[class*="comment"]', sdpReview);
            if (reviewElements.length === 0) {
              hasNoReviewsMessage = true;
            } else {
              // 한 번만 재시도
              await sleep(CONSTANTS.WAIT_TIMES.LONG);
              firstPageReviews = await extractReviewsFromPage();
            }
          }
        }
      }

      // 첫 페이지 리뷰 수집 플래그
      let firstPageCollected = false;

      if (firstPageReviews.length > 0) {
        safeSendMessage({
          action: 'progress',
          percent: 15,
          text: `첫 페이지: ${firstPageReviews.length}개 리뷰 발견`,
          originalTabId: currentOriginalTabId
        });
        for (const review of firstPageReviews) {
          const isDuplicate = isDuplicateReview(review, allReviews);
          if (!isDuplicate) {
            allReviews.push(review);
            updateCurrentCollectedReviews();

            const reviewContent = review.content || '';
            const reviewDate = review.date || '날짜 없음';
            const reviewRating = parseInt(review.rating) || 0;
            const contentPreview = reviewContent.length > 50 ? reviewContent.substring(0, 50) + '...' : reviewContent;
            console.log(`[리뷰 수집기] 수집됨 #${allReviews.length}: ${reviewRating}점 - ${contentPreview}`);

            // 진행률 업데이트 (첫 페이지 리뷰 수집 시마다)
            const reviewProgressPercent = Math.min(20, 15 + Math.floor((allReviews.length / Math.max(firstPageReviews.length, 1)) * 5));
            safeSendMessage({
              action: 'progress',
              percent: reviewProgressPercent,
              text: `첫 페이지: ${allReviews.length}/${firstPageReviews.length}개 수집 중...`,
              originalTabId: currentOriginalTabId
            });

            safeSendMessage({
              action: 'log',
              message: `수집됨 #${allReviews.length}: ${reviewRating}점 - ${contentPreview}`,
              type: 'info'
            });
            safeSendMessage({
              action: 'log',
              message: `리뷰 수집 #${allReviews.length}: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} (${reviewRating}점) - ${contentPreview}`,
              type: 'info'
            });
          } else {
            // 중복 리뷰는 로그만 출력 (디버깅용)
            const reviewContent = review.content || '';
            const reviewRating = parseInt(review.rating) || 0;
            const contentPreview = reviewContent.length > 50 ? reviewContent.substring(0, 50) + '...' : reviewContent;
            safeSendMessage({
              action: 'log',
              message: `중복 리뷰 건너뜀: ${reviewRating}점 - ${contentPreview}`,
              type: 'info'
            });
          }
        }
        // 첫 페이지 리뷰 수집 완료
        firstPageCollected = true;
        // 첫 페이지 리뷰 수집 완료 후 다음 페이지로 이동
        // 필터링 후에는 이미 필터링된 첫 페이지 리뷰를 수집했으므로 2페이지부터 시작
        currentPage = 1;

        // 첫 페이지 수집 후 즉시 다음 페이지로 이동 (중복 추출 방지)
        if (buttonIndex <= maxButtonIndex) {
          const hasNext = await goToNextPage(buttonIndex);
          if (hasNext) {
            buttonIndex++;
            await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          } else {
            // 다음 페이지가 없으면 종료
            updateCurrentCollectedReviews();
            safeSendMessage({
              action: 'progress',
              percent: 95,
              text: `수집 완료: 총 ${allReviews.length}개 리뷰`,
              originalTabId: currentOriginalTabId
            });
            return allReviews;
          }
        }
      } else {
        // 첫 페이지에 리뷰가 없으면 1페이지부터 시작 (페이지 이동 후 리뷰 확인)
        currentPage = 1;
      }


      while (!stopScraping && !hasNoReviewsMessage && consecutiveFailures < maxFailures) {
        if (stopScraping) {
          updateCurrentCollectedReviews();
          safeSendMessage({
            action: 'log',
            message: `중지 요청 감지: 수집을 중지합니다. (현재까지 ${allReviews.length}개 수집됨)`,
            type: 'warning'
          });
          break;
        }

        // 첫 페이지는 이미 수집했으므로 건너뛰고 다음 페이지로 이동
        // (while 루프 진입 전에 이미 다음 페이지로 이동했으므로 이 조건은 거의 실행되지 않음)
        if (currentPage === 1 && firstPageCollected) {
          safeSendMessage({
            action: 'log',
            message: `첫 페이지는 이미 수집했으므로 다음 페이지로 이동합니다.`,
            type: 'info'
          });
          // 다음 페이지로 이동
          if (buttonIndex > maxButtonIndex) {
            break;
          }
          const hasNext = await goToNextPage(buttonIndex);
          if (hasNext) {
            buttonIndex++;
            currentPage = 2;
            await sleep(CONSTANTS.WAIT_TIMES.SHORT);
            continue;
          } else {
            break;
          }
        }

        safeSendMessage({
          action: 'log',
          message: `페이지 ${currentPage} 리뷰 수집 시작...`,
          type: 'info'
        });

        const baseProgress = 15 + Math.min(75, (currentPage - 1) * 5);
        safeSendMessage({
          action: 'progress',
          percent: baseProgress,
          text: `페이지 ${currentPage} 리뷰 추출 중...`,
          originalTabId: currentOriginalTabId
        });

        const reviews = await extractReviewsFromPage();
        if (stopScraping) {
          updateCurrentCollectedReviews();
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

          await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          if (stopScraping) {
            updateCurrentCollectedReviews();
            break;
          }
          continue;
        }

        // 다음 페이지 존재 여부를 먼저 확인 (마지막 페이지 판단용)
        let isLastPage = false;
        if (buttonIndex > maxButtonIndex) {
          isLastPage = true;
        } else {
          const hasNext = await goToNextPage(buttonIndex, true); // 확인만 하고 이동하지 않음
          if (!hasNext) {
            isLastPage = true;
          }
        }

        // 마지막 페이지인 경우 마지막 리뷰 제외
        if (isLastPage && reviews.length > 0) {
          reviews.pop();
          safeSendMessage({
            action: 'log',
            message: `마지막 페이지의 마지막 리뷰를 제외합니다.`,
            type: 'info'
          });
        }

        // 리뷰 수집
        for (const review of reviews) {
          if (stopScraping) {
            break;
          }

          const isDuplicate = isDuplicateReview(review, allReviews);
          if (!isDuplicate) {
            allReviews.push(review);
            updateCurrentCollectedReviews();

            const reviewContent = review.content || '';
            const reviewDate = review.date || '날짜 없음';
            const reviewRating = parseInt(review.rating) || 0;
            const contentPreview = reviewContent.length > 50 ? reviewContent.substring(0, 50) + '...' : reviewContent;
            console.log(`[리뷰 수집기] 수집됨 #${allReviews.length}: ${reviewRating}점 - ${contentPreview}`);

            // 진행률 업데이트 (리뷰 수집 시마다)
            const reviewProgressPercent = Math.min(90, 15 + Math.floor((allReviews.length / Math.max(allReviews.length + 10, 1)) * 75));
            safeSendMessage({
              action: 'progress',
              percent: reviewProgressPercent,
              text: `${allReviews.length}개 리뷰 수집 중...`,
              originalTabId: currentOriginalTabId
            });

            safeSendMessage({
              action: 'log',
              message: `수집됨 #${allReviews.length}: ${reviewRating}점 - ${contentPreview}`,
              type: 'info'
            });
            safeSendMessage({
              action: 'log',
              message: `리뷰 수집 #${allReviews.length}: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} (${reviewRating}점) - ${contentPreview}`,
              type: 'info'
            });
          } else {
            // 중복 리뷰는 로그만 출력 (디버깅용)
            const reviewContent = review.content || '';
            const reviewRating = parseInt(review.rating) || 0;
            const contentPreview = reviewContent.length > 50 ? reviewContent.substring(0, 50) + '...' : reviewContent;
            safeSendMessage({
              action: 'log',
              message: `중복 리뷰 건너뜀: ${reviewRating}점 - ${contentPreview}`,
              type: 'info'
            });
          }
        }

        if (stopScraping) {
          updateCurrentCollectedReviews();
          break;
        }

        const progressPercent = Math.min(90, 15 + (currentPage * 5));
        const progressText = `${allReviews.length}개 리뷰 수집 중... (페이지 ${currentPage})`;
        safeSendMessage({
          action: 'progress',
          percent: progressPercent,
          text: progressText,
          log: `페이지 ${currentPage}: ${reviews.length}개 리뷰 발견, 총 ${allReviews.length}개 수집됨`,
          logType: 'info',
          originalTabId: currentOriginalTabId
        }).then(() => {
        }).catch(err => {
        });

        if (stopScraping) {
          break;
        }

        // button:nth-child 인덱스가 최대값을 초과하면 중지
        if (buttonIndex > maxButtonIndex) {
          safeSendMessage({
            action: 'log',
            message: `최대 페이지 수(${maxButtonIndex})에 도달했습니다.`,
            type: 'info'
          });
          break;
        }

        safeSendMessage({
          action: 'log',
          message: `다음 페이지로 이동 시도... (button:nth-child(${buttonIndex}))`,
          type: 'info'
        });
        const hasNext = await goToNextPage(buttonIndex);

        if (stopScraping) {
          updateCurrentCollectedReviews();
          break;
        }

        const currentUrlAfterPageMove = window.location.href;
        const currentProductIdAfter = currentUrlAfterPageMove.match(/\/products\/(\d+)/)?.[1];

        if (targetProductId && currentProductIdAfter !== targetProductId) {
          safeSendMessage({
            action: 'log',
            message: `오류: 다른 상품 페이지로 이동했습니다. 수집을 중지합니다.`,
            type: 'error'
          });
          break;
        }

        if (!hasNext) {
          safeSendMessage({
            action: 'log',
            message: `button:nth-child(${buttonIndex})를 찾을 수 없습니다. 더 이상 수집할 페이지가 없습니다.`,
            type: 'info'
          });
          break;
        } else {
          safeSendMessage({
            action: 'log',
            message: `페이지 ${currentPage + 1}로 이동 완료 (button:nth-child(${buttonIndex}))`,
            type: 'success'
          });
        }

        currentPage++;
        buttonIndex++; // 다음 button:nth-child 인덱스로 증가
        consecutiveFailures = 0;
        await sleep(100);
      }

      updateCurrentCollectedReviews();

      safeSendMessage({
        action: 'progress',
        percent: 95,
        text: `수집 완료: 총 ${allReviews.length}개 리뷰`,
        originalTabId: currentOriginalTabId
      });

      if (allReviews.length === 0) {
        if (hasNoReviewsMessage) {
          safeSendMessage({
            action: 'error',
            error: '이 상품에는 등록된 리뷰가 없습니다.',
            originalTabId: currentOriginalTabId
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
            reviews: [],
            originalTabId: currentOriginalTabId
          });
        }
      }

      return allReviews;
    }

    /**
     * 페이지에서 리뷰 추출 (최적화 및 에러 처리 강화)
     * @returns {Promise<Array>} - 추출된 리뷰 배열
     */
    async function extractReviewsFromPage() {
      const reviews = [];
      try {
        if (stopScraping) {
          return reviews;
        }

        const noReviewMessages = CONSTANTS.NO_REVIEW_MESSAGES;
        const sdpReview = safeQuerySelector('#sdpReview');
        // 리뷰 없음 메시지 확인
        if (sdpReview) {
          const reviewText = safeGetText(sdpReview);
          const hasNoReviewMessage = noReviewMessages.some(msg => {
            try {
              const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
              return regex.test(reviewText);
            } catch (e) {
              return false;
            }
          });

          if (hasNoReviewMessage) {
            const reviewElements = safeQuerySelectorAll('article, div[class*="review"], div[class*="comment"]', sdpReview);
            if (reviewElements.length === 0) {
              return reviews;
            }
          }
        }

        const reviewSelectors = [
          // 정확한 셀렉터 (우선순위 1) - 사용자 지정 article 클래스
          'article.twc-pt-\\[16px\\].xl\\:twc-pt-\\[24px\\].twc-border-b-\\[1px\\].twc-border-bluegray-200.twc-border-solid',
          'article[class*="twc-pt-[16px]"][class*="twc-border-b-[1px]"][class*="twc-border-bluegray-200"]',
          // 대체 셀렉터들
          '#sdpReview article[class*="twc-pt-"]',
          '#sdpReview article[class*="twc-border-b-"]',
          '#sdpReview article',
          'article[class*="review"]',
          // 더 넓은 범위의 셀렉터
          '#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden article',
          '#sdpReview article[class*="border"]'
        ];

        // 페이지 로딩 대기 (최적화)
        await sleep(CONSTANTS.WAIT_TIMES.SHORT);
        await waitForReviewsSection();
        await sleep(CONSTANTS.WAIT_TIMES.SHORT);

        // 리뷰 요소 렌더링 대기 (최적화)
        let waitCount = 0;
        while (waitCount < CONSTANTS.MAX_RETRIES.PAGE_ELEMENTS) {
          if (stopScraping) break;

          const tempElements = sdpReview ? safeQuerySelectorAll('article', sdpReview) : [];
          if (tempElements.length >= CONSTANTS.REVIEW.MIN_REVIEW_ELEMENTS) {
            break;
          }
          await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          waitCount++;
        }

        let reviewElements = [];
        let maxFoundCount = 0;
        let bestSelector = '';
        let allFoundElements = new Set();

        // 모든 셀렉터를 시도하고 모든 요소를 수집 (중복 제거, 최적화)
        for (const selector of reviewSelectors) {
          if (stopScraping) break;

          try {
            const elements = safeQuerySelectorAll(selector);
            if (elements.length > 0) {
              // 모든 요소를 Set에 추가 (중복 제거)
              elements.forEach(el => {
                if (el && el.nodeType === Node.ELEMENT_NODE) {
                  allFoundElements.add(el);
                }
              });

              if (elements.length > maxFoundCount) {
                maxFoundCount = elements.length;
                bestSelector = selector;
              }
            }
          } catch (e) {
            continue;
          }
        }

        // Set을 배열로 변환
        reviewElements = Array.from(allFoundElements);

        // 가장 많은 요소를 찾은 셀렉터로 로그 출력
        if (reviewElements.length > 0) {
          safeSendMessage({
            action: 'log',
            message: `리뷰 요소 발견: ${reviewElements.length}개 (최고 셀렉터: ${bestSelector.substring(0, 50)}...)`,
            type: 'info'
          });
        }

        // 추가 대기 후 다시 확인 (누락 방지)
        if (reviewElements.length === 0 || reviewElements.length < CONSTANTS.REVIEW.MIN_REVIEW_ELEMENTS) {
          await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          await waitForReviewsSection();

          let retryAllFoundElements = new Set();

          for (const selector of reviewSelectors) {
            if (stopScraping) break;

            try {
              const elements = safeQuerySelectorAll(selector);
              if (elements.length > 0) {
                elements.forEach(el => {
                  if (el && el.nodeType === Node.ELEMENT_NODE) {
                    retryAllFoundElements.add(el);
                  }
                });
              }
            } catch (e) {
              continue;
            }
          }

          // 재확인에서 더 많은 요소를 찾았으면 사용
          if (retryAllFoundElements.size > reviewElements.length) {
            reviewElements = Array.from(retryAllFoundElements);
            safeSendMessage({
              action: 'log',
              message: `리뷰 요소 재확인: ${reviewElements.length}개 (모든 셀렉터 통합)`,
              type: 'info'
            });
          }
        }

        // 리뷰 요소를 찾지 못한 경우 대체 셀렉터 시도
        if (reviewElements.length === 0 && sdpReview) {
          try {
            const reviewText = safeGetText(sdpReview);
            const hasNoReviewInSection = noReviewMessages.some(msg => {
              try {
                const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                return regex.test(reviewText);
              } catch (e) {
                return false;
              }
            });

            if (hasNoReviewInSection) {
              const checkElements = safeQuerySelectorAll('article, div, section', sdpReview);
              if (checkElements.length === 0 || checkElements.length < 3) {
                return reviews;
              }
            }

            // 대체 셀렉터 시도
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
              if (stopScraping) break;

              try {
                const elements = safeQuerySelectorAll(selector, sdpReview);
                if (elements.length > 0) {
                  const filtered = Array.from(elements).filter(el => {
                    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                    const text = safeGetText(el);
                    return text.length > CONSTANTS.REVIEW.MIN_ELEMENT_TEXT_LENGTH &&
                      text.length < CONSTANTS.REVIEW.MAX_ELEMENT_TEXT_LENGTH;
                  });
                  if (filtered.length > 0) {
                    reviewElements = filtered;
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            // 에러 발생 시 빈 배열 반환
          }
        }
        for (let i = 0; i < reviewElements.length; i++) {
          if (stopScraping) {
            break;
          }

          const element = reviewElements[i];
          if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            continue;
          }

          try {
            const elementText = safeGetText(element);
            const isNoReviewMessage = noReviewMessages.some(msg =>
              elementText.includes(msg) && elementText.length < 100
            );

            if (isNoReviewMessage) {
              continue;
            }

            // 필터링 조건 (상수 사용)
            if (elementText.length < CONSTANTS.REVIEW.MIN_CONTENT_LENGTH ||
              elementText.length > CONSTANTS.REVIEW.MAX_CONTENT_LENGTH) {
              continue;
            }

            if (stopScraping) break;

            const review = extractReviewData(element);
            if (review) {
              // content가 없어도 다른 정보(작성자, 날짜, 별점)가 있으면 포함
              const hasContent = review.content && review.content.trim().length > 0;
              const hasAuthor = review.author && review.author.trim().length > 0;
              const hasDate = review.date && review.date.trim().length > 0;
              const hasRating = review.rating && review.rating.trim().length > 0;
              const hasTitle = review.title && review.title.trim().length > 0;

              // 더 관대한 조건: 작성자만 있어도 포함, 또는 내용/제목이 있으면 포함
              if (hasContent || hasTitle || hasAuthor || (hasDate && hasRating)) {
                if (hasContent) {
                  const content = review.content.trim();
                  review.content = content;
                } else {
                  review.content = review.content || '';
                }
                reviews.push(review);

                // 디버깅: 각 리뷰 추출 로그
                safeSendMessage({
                  action: 'log',
                  message: `리뷰 추출 #${reviews.length}: 작성자=${review.author || '없음'}, 내용=${(review.content || review.title || '').substring(0, 30)}...`,
                  type: 'info'
                });
              } else {
                // 추출 실패한 리뷰 로그
                safeSendMessage({
                  action: 'log',
                  message: `리뷰 추출 실패: 작성자=${review.author || '없음'}, 내용길이=${(review.content || '').length}, 날짜=${review.date || '없음'}, 별점=${review.rating || '없음'}`,
                  type: 'warning'
                });
              }
            }
          } catch (error) {
          }
        }
        // 추출된 리뷰 수 로그 출력
        safeSendMessage({
          action: 'log',
          message: `리뷰 추출 완료: ${reviews.length}개 (발견된 요소: ${reviewElements.length}개)`,
          type: 'info'
        });

        // 누락 가능성 경고
        if (reviewElements.length > reviews.length) {
          safeSendMessage({
            action: 'log',
            message: `경고: 발견된 요소(${reviewElements.length}개)보다 추출된 리뷰(${reviews.length}개)가 적습니다. 일부 리뷰가 누락되었을 수 있습니다.`,
            type: 'warning'
          });
        }

        // 리뷰를 찾지 못한 경우 디버그 정보 제공
        if (reviews.length === 0) {
          const debugSdpReview = safeQuerySelector('#sdpReview');
          let debugInfo = '리뷰를 찾지 못했습니다.\n';

          if (debugSdpReview) {
            debugInfo += `#sdpReview 섹션 존재 (요소 ${debugSdpReview.children.length}개)\n`;
          } else {
            debugInfo += '#sdpReview 섹션을 찾을 수 없습니다.\n';
          }

          const pageText = document.body ? safeGetText(document.body) : '';
          const reviewKeywords = ['리뷰', '상품평', 'review', '평점', '별점'];
          const hasReviewKeywords = reviewKeywords.some(keyword => pageText.includes(keyword));
          debugInfo += `리뷰 관련 키워드 존재: ${hasReviewKeywords}\n`;
          debugInfo += `발견된 리뷰 요소 수: ${reviewElements.length}개`;

          safeSendMessage({
            action: 'log',
            message: debugInfo,
            type: 'warning'
          });
        }
      } catch (error) {
        // 에러 발생 시 로그 출력
        safeSendMessage({
          action: 'log',
          message: `리뷰 추출 중 오류 발생: ${error.message || String(error)}`,
          type: 'error'
        });
      }

      return reviews;
    }

    function extractReviewData(element) {
      if (!element) {
        return null;
      }

      let content = '';
      let title = '';
      let rating = '';
      let date = '';
      let author = '';
      let productEvaluation = '';

      try {
        // 1. 날짜 추출
        try {
          const dateSelector = 'div.twc-text-\\[14px\\]\\/\\[15px\\].twc-text-bluegray-700';
          const dateEl = safeQuerySelector(dateSelector, element);
          if (dateEl) {
            const dateText = safeGetText(dateEl);
            if (dateText) {
              const dateMatch = dateText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
              if (dateMatch && dateMatch.length >= 4) {
                try {
                  date = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
                } catch (e) {
                  date = dateText;
                }
              } else {
                date = dateText;
              }
            }
          }
        } catch (e) {
          // Date extraction error - 무시하고 계속
        }

        // 2. 작성자 추출
        try {
          const authorSelectors = [
            'span.twc-text-\\[16px\\]\\/\\[19px\\].twc-font-bold.twc-text-bluegray-900[data-member-id]',
            'span[data-member-id]',
            'span.twc-text-\\[16px\\]\\/\\[19px\\].twc-font-bold.twc-text-bluegray-900',
            'span[class*="font-bold"][class*="text-bluegray-900"]',
            'div[class*="font-bold"][class*="text-bluegray-900"]'
          ];

          for (const authorSelector of authorSelectors) {
            try {
              const authorEl = safeQuerySelector(authorSelector, element);
              if (authorEl) {
                const authorText = safeGetText(authorEl);
                // 작성자 이름 패턴 확인 (한글 + * 포함)
                if (authorText && (authorText.includes('*') || /^[가-힣]/.test(authorText) || authorText === '쿠팡실구매자')) {
                  author = authorText;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // Author extraction error
        }

        // 3. 별점 추출 (full-star 클래스 기반)
        try {
          const ratingContainerSelector = 'div.twc-inline-flex.twc-items-center.twc-gap-\\[2px\\]';
          const ratingContainer = safeQuerySelector(ratingContainerSelector, element);
          if (ratingContainer) {
            const fullStarElements = safeQuerySelectorAll('i[class*="twc-bg-full-star"]', ratingContainer);
            if (fullStarElements && fullStarElements.length > 0) {
              rating = String(fullStarElements.length);
            } else {
              // 대체: 모든 i 요소 중 full-star가 포함된 것 찾기
              const allIElements = safeQuerySelectorAll('i', ratingContainer);
              let fullStarCount = 0;
              for (const iEl of allIElements) {
                if (!iEl) continue;
                try {
                  const iClass = iEl.className || '';
                  if (iClass.includes('twc-bg-full-star') || iClass.includes('full-star')) {
                    fullStarCount++;
                  }
                } catch (e) {
                  continue;
                }
              }
              if (fullStarCount > 0) {
                rating = String(fullStarCount);
              }
            }
          }
        } catch (e) {
          // Rating extraction error - 무시하고 계속
        }

        // 4. 댓글 제목 추출
        try {
          const titleSelector = 'div.twc-mb-\\[8px\\].twc-text-\\[14px\\]\\/\\[19px\\].twc-font-bold.twc-text-bluegray-900';
          const titleEl = safeQuerySelector(titleSelector, element);
          if (titleEl) {
            title = safeGetText(titleEl);
          }
        } catch (e) {
          // Title extraction error - 무시하고 계속
        }

        // 5. 댓글 내용 추출
        try {
          const contentSelector = 'div.twc-text-\\[14px\\]\\/\\[19px\\].twc-text-bluegray-900.twc-break-all';
          const contentEl = safeQuerySelector(contentSelector, element);
          if (contentEl) {
            content = safeGetText(contentEl);
          }
        } catch (e) {
          // Content extraction error - 무시하고 계속
        }

        // 6. 상품 평가 추출
        try {
          const evaluationSelector = 'div.twc-mt-\\[16px\\].twc-flex.twc-flex-col.twc-gap-\\[6px\\]';
          const evaluationEl = safeQuerySelector(evaluationSelector, element);
          if (evaluationEl) {
            const rawEvaluation = safeGetText(evaluationEl);
            if (rawEvaluation) {
              productEvaluation = parseProductEvaluation(rawEvaluation);
            }
          }
        } catch (e) {
          // Product evaluation extraction error - 무시하고 계속
        }

        // 대체 셀렉터 (정확한 셀렉터로 찾지 못한 경우)
        // 제목이나 평가 내용이 이미 추출되었는지 확인하여 내용으로 사용하지 않도록 함
        const extractedTitle = title || '';
        const extractedEvaluation = productEvaluation || '';

        if (!content || content.length < 10) {
          const contentSelectors = [
            'div[class*="text"][class*="bluegray-900"][class*="break-all"]',
            'div[class*="text-14px"][class*="text-bluegray-900"]',
            'div[class*="break-all"]',
            'div[class*="content"]',
            'div[class*="text-bluegray-900"]'
          ];

          let contentEl = null;
          for (const selector of contentSelectors) {
            try {
              contentEl = safeQuerySelector(selector, element);
              if (contentEl) {
                const candidateText = safeGetText(contentEl);
                // 제목이나 평가 내용과 동일하지 않은지 확인
                if (candidateText.length > CONSTANTS.REVIEW.MIN_CONTENT_LENGTH &&
                  candidateText !== extractedTitle &&
                  candidateText !== extractedEvaluation &&
                  !candidateText.includes(extractedTitle) &&
                  !candidateText.includes(extractedEvaluation)) {
                  break;
                } else {
                  contentEl = null;
                }
              }
            } catch (e) {
              continue;
            }
          }

          if (contentEl) {
            const candidateText = safeGetText(contentEl);
            if (candidateText !== extractedTitle && candidateText !== extractedEvaluation) {
              content = candidateText;
            }
          }
        }

        if (!content || content.length < 10) {
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
              const altEl = safeQuerySelector(selector, element);
              if (altEl) {
                const candidateContent = safeGetText(altEl);
                // 제목이나 평가 내용과 동일하지 않은지 확인
                if (candidateContent &&
                  candidateContent.length > content.length &&
                  candidateContent.length > CONSTANTS.REVIEW.MIN_CONTENT_LENGTH &&
                  candidateContent !== extractedTitle &&
                  candidateContent !== extractedEvaluation &&
                  !candidateContent.includes(extractedTitle) &&
                  !candidateContent.includes(extractedEvaluation)) {
                  content = candidateContent;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        }

        if (!content || content.length < CONSTANTS.REVIEW.MIN_CONTENT_LENGTH) {
          const directText = safeGetText(element);

          if (directText.length > 20) {
            const allDivs = safeQuerySelectorAll('div', element);
            let longestText = '';
            for (const div of allDivs) {
              if (!div || div.nodeType !== Node.ELEMENT_NODE) continue;

              const divText = safeGetText(div);
              if (divText.length > longestText.length && divText.length >= 20 && divText.length < 2000) {
                const hasRatingPattern = /별점|평점|점|★|⭐|rating|star/i.test(divText);
                const hasDatePattern = /\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}|\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4}/.test(divText);
                const hasUserNamePattern = /^\*+$|^[가-힣]\*+[가-힣]?$/.test(divText);
                // 작성자 이름 패턴 확인 (Kim******** 같은 패턴)
                const hasAuthorPattern = /^[A-Za-z가-힣]+\*+$/.test(divText);
                // 제목이나 평가 내용과 동일하지 않은지 확인
                const isTitleOrEvaluation = divText === extractedTitle ||
                  divText === extractedEvaluation ||
                  divText.includes(extractedTitle) ||
                  divText.includes(extractedEvaluation);

                if (!hasRatingPattern && !hasDatePattern && !hasUserNamePattern && !hasAuthorPattern && !isTitleOrEvaluation) {
                  longestText = divText;
                }
              }
            }

            if (longestText.length > content.length && longestText.length >= 20) {
              content = longestText;
            } else {
              const lines = directText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              if (lines.length > 2) {
                // 작성자 이름이 포함된 라인 제외, 제목이나 평가 내용도 제외
                const filteredLines = lines.filter(line => {
                  const hasAuthorPattern = /^[A-Za-z가-힣]+\*+$/.test(line);
                  const hasUserNamePattern = /^\*+$|^[가-힣]\*+[가-힣]?$/.test(line);
                  const isTitleOrEvaluation = line === extractedTitle ||
                    line === extractedEvaluation ||
                    line.includes(extractedTitle) ||
                    line.includes(extractedEvaluation);
                  return !hasAuthorPattern && !hasUserNamePattern && !isTitleOrEvaluation;
                });

                if (filteredLines.length > 0) {
                  const middleContent = filteredLines.slice(1, -1).join(' ').trim();
                  if (middleContent && middleContent.length > content.length &&
                    middleContent.length > CONSTANTS.REVIEW.MIN_CONTENT_LENGTH) {
                    content = middleContent;
                  }
                }
              } else if (directText.length > 20) {
                // 작성자 이름 패턴이 아니고, 제목이나 평가 내용도 아닌 경우에만 사용
                const hasAuthorPattern = /^[A-Za-z가-힣]+\*+$/.test(directText);
                const isTitleOrEvaluation = directText === extractedTitle ||
                  directText === extractedEvaluation ||
                  directText.includes(extractedTitle) ||
                  directText.includes(extractedEvaluation);
                if (!hasAuthorPattern && !isTitleOrEvaluation) {
                  content = directText;
                }
              }
            }
          }
        }

        // 내용에서 작성자 이름 제거 (Kim******** 같은 패턴)
        if (content && author) {
          const authorPattern = new RegExp(author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          content = content.replace(authorPattern, '').trim();
        }

        // 내용에서 작성자 이름 패턴 제거 (Kim******** 같은 패턴)
        if (content) {
          content = content.replace(/^[A-Za-z가-힣]+\*+\s*/g, '').trim();
          content = content.replace(/\s*[A-Za-z가-힣]+\*+$/g, '').trim();
        }
      } catch (e) {
        // Content extraction error
      }

      // 필터링된 경우 필터 값으로 평점 설정, 그렇지 않으면 추출한 평점 사용
      const finalRating = (currentRatingFilter && currentRatingFilter !== 'all') ? currentRatingFilter : (rating || '');

      // 제목만 있고 내용이 없을 경우 내용을 제목과 동일하게 하지 않음
      // (내용은 그대로 빈 문자열로 유지)
      const finalContent = content || '';

      const review = {
        content: finalContent,
        title: title || '',
        rating: finalRating,
        date: date || new Date().toISOString().split('T')[0],
        author: author || '',
        productEvaluation: productEvaluation || '',
        originalTabId: currentOriginalTabId
      };

      return review;
    }

    // 상품 평가 파싱 함수
    function parseProductEvaluation(rawText) {
      if (!rawText || rawText.trim().length === 0) {
        return '';
      }

      // 일반적인 상품 평가 항목명 리스트 (긴 것부터 정렬하여 "재질 만족도"가 "재질"보다 먼저 매칭되도록)
      const evaluationItems = [
        '재질 만족도',
        '사이즈',
        '디자인',
        '편리성',
        '재질',
        '색상',
        '품질',
        '가격',
        '배송',
        '포장',
        '내구성',
        '기능',
        '사용성',
        '만족도',
        '추천도'
      ];

      const result = [];
      let text = rawText;
      let currentIndex = 0;

      // 항목명과 평가 내용을 찾아서 분리
      while (currentIndex < text.length) {
        let foundItem = null;
        let foundIndex = -1;

        // 현재 위치에서 가장 먼저 나타나는 항목명 찾기
        for (const item of evaluationItems) {
          const index = text.indexOf(item, currentIndex);
          if (index !== -1 && (foundIndex === -1 || index < foundIndex)) {
            foundIndex = index;
            foundItem = item;
          }
        }

        if (foundItem && foundIndex !== -1) {
          // 이전 항목의 평가 내용이 있다면 이전 항목에 추가
          if (foundIndex > currentIndex && result.length > 0) {
            const prevEvaluation = text.substring(currentIndex, foundIndex).trim();
            if (prevEvaluation) {
              result[result.length - 1].evaluation = prevEvaluation;
            }
          }

          // 새 항목명 추가
          result.push({ item: foundItem, evaluation: '' });
          currentIndex = foundIndex + foundItem.length;
        } else {
          // 더 이상 항목명이 없으면 마지막 항목의 평가 내용으로 처리
          if (currentIndex < text.length && result.length > 0) {
            const lastEvaluation = text.substring(currentIndex).trim();
            if (lastEvaluation) {
              result[result.length - 1].evaluation = lastEvaluation;
            }
          }
          break;
        }
      }

      // 결과 포맷팅: 항목명 | 평가 내용 형태로 변환
      if (result.length === 0) {
        return rawText;
      }

      return result
        .map(r => r.evaluation ? `${r.item} | ${r.evaluation}` : r.item)
        .join('\n');
    }

    function isDuplicateReview(review, existingReviews) {
      // content, date, author를 조합하여 고유성 확인 (작성자가 다르면 다른 리뷰로 처리)
      const reviewContent = (review.content || '').trim();
      const reviewDate = (review.date || '').trim();
      const reviewAuthor = (review.author || '').trim();
      const reviewKey = `${reviewContent}_${reviewDate}_${reviewAuthor}`;

      const duplicateIndex = existingReviews.findIndex(existing => {
        const existingContent = (existing.content || '').trim();
        const existingDate = (existing.date || '').trim();
        const existingAuthor = (existing.author || '').trim();
        const existingKey = `${existingContent}_${existingDate}_${existingAuthor}`;
        return existingKey === reviewKey;
      });

      if (duplicateIndex !== -1) {
        // 중복 발견 시 기존 리뷰 제거하고 true 반환 (중복임을 표시)
        existingReviews.splice(duplicateIndex, 1);
        return true; // 중복임을 표시
      }

      return false; // 중복 아님
    }

    async function goToNextPage(buttonIndex, checkOnly = false) {
      return new Promise(async (resolve) => {
        const currentUrlBeforeClick = window.location.href;
        const currentProductIdBefore = currentUrlBeforeClick.match(/\/products\/(\d+)/)?.[1];

        if (targetProductId && currentProductIdBefore !== targetProductId) {
          safeSendMessage({
            action: 'log',
            message: `경고: 현재 페이지가 목표 상품과 다릅니다. (현재: ${currentProductIdBefore}, 목표: ${targetProductId})`,
            type: 'warning'
          });
          if (targetUrl) {
            safeSendMessage({
              action: 'log',
              message: `목표 상품 페이지로 복구합니다...`,
              type: 'warning'
            });
            window.location.href = targetUrl;
            await waitForPageLoad();
            await waitForPageReady();
            resolve(false);
            return;
          }
        }

        // 특정 셀렉터의 button:nth-child 사용
        const baseSelector = '#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div:nth-child(6) > div > button';
        const selector = `${baseSelector}:nth-child(${buttonIndex})`;

        let nextButton = null;
        try {
          nextButton = document.querySelector(selector);
          if (nextButton && nextButton.offsetParent !== null && !nextButton.disabled) {
            safeSendMessage({
              action: 'log',
              message: `페이지네이션 버튼 발견: button:nth-child(${buttonIndex})`,
              type: 'info'
            });
          } else {
            nextButton = null;
          }
        } catch (e) {
          nextButton = null;
        }

        // 특정 셀렉터로 찾지 못한 경우 기존 방식으로 fallback
        if (!nextButton) {
          const sdpReview = safeQuerySelector('#sdpReview');
          if (!sdpReview) {
            resolve(false);
            return;
          }

          const paginationButtons = safeQuerySelectorAll(
            'button, [class*="pagination"] button',
            sdpReview
          );

          for (const button of paginationButtons) {
            const text = button.textContent?.trim() || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            const buttonParent = button.closest('#sdpReview');

            if (!buttonParent) {
              continue;
            }

            if (text === '다음' || ariaLabel.includes('다음')) {
              if (!button.disabled && button.offsetParent !== null) {
                const href = button.getAttribute('href');
                if (href && !href.includes('/products/')) {
                  nextButton = button;
                  break;
                } else if (!href) {
                  nextButton = button;
                  break;
                }
              }
            }
          }

          if (!nextButton) {
            const currentPage = getCurrentPageNumber();
            const nextPageNum = currentPage + 1;

            for (const button of paginationButtons) {
              const text = button.textContent?.trim() || '';
              const buttonParent = button.closest('#sdpReview');
              if (!buttonParent) {
                continue;
              }
              if (text === String(nextPageNum) && !button.disabled) {
                const href = button.getAttribute('href');
                if (href && !href.includes('/products/')) {
                  nextButton = button;
                  break;
                } else if (!href) {
                  nextButton = button;
                  break;
                }
              }
            }
          }
        }

        if (nextButton) {
          if (checkOnly) {
            // 확인만 하고 클릭하지 않음
            resolve(true);
            return;
          }

          try {
            nextButton.click();
            await sleep(CONSTANTS.WAIT_TIMES.SHORT);
            await waitForPageLoad();
            await waitForPageReady();
            await waitForReviewsSection();
            await sleep(CONSTANTS.WAIT_TIMES.SHORT);

            const currentUrlAfterClick = window.location.href;
            const currentProductIdAfter = currentUrlAfterClick.match(/\/products\/(\d+)/)?.[1];

            if (targetProductId && currentProductIdAfter !== targetProductId) {
              safeSendMessage({
                action: 'log',
                message: `오류: 다른 상품 페이지로 이동했습니다. (현재: ${currentProductIdAfter}, 목표: ${targetProductId})`,
                type: 'error'
              });
              if (targetUrl) {
                safeSendMessage({
                  action: 'log',
                  message: `목표 상품 페이지로 복구합니다...`,
                  type: 'warning'
                });
                window.location.href = targetUrl;
                await waitForPageLoad();
                await waitForPageReady();
                resolve(false);
                return;
              }
            }

            resolve(true);
          } catch (clickError) {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });
    }

    /**
     * 현재 페이지 번호 가져오기
     * @returns {number} - 현재 페이지 번호 (기본값: 1)
     */
    function getCurrentPageNumber() {
      try {
        const sdpReview = safeQuerySelector('#sdpReview');
        if (!sdpReview) return 1;

        const activeButton = safeQuerySelector(
          'button[aria-current="page"], button[class*="active"]',
          sdpReview
        );
        if (activeButton) {
          const text = safeGetText(activeButton);
          const num = Number.parseInt(text, 10);
          if (!Number.isNaN(num) && num > 0) return num;
        }
      } catch (e) {
        // 에러 발생 시 기본값 반환
      }
      return 1;
    }

    // ==================== 유틸리티 함수 ====================

    /**
     * 지정된 시간만큼 대기 (중지 요청 체크 포함)
     * @param {number} ms - 대기 시간 (밀리초)
     * @returns {Promise<void>}
     */
    function sleep(ms) {
      return new Promise((resolve) => {
        if (ms <= 0) {
          resolve();
          return;
        }

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

    /**
     * 안전한 요소 클릭 (에러 처리 포함)
     * @param {HTMLElement} element - 클릭할 요소
     * @param {string} fallbackSelector - 대체 셀렉터
     * @returns {boolean} - 클릭 성공 여부
     */
    function safeClick(element, fallbackSelector = null) {
      if (!element) {
        if (fallbackSelector) {
          const fallbackEl = document.querySelector(fallbackSelector);
          if (fallbackEl) {
            try {
              fallbackEl.click();
              return true;
            } catch (e) {
              return false;
            }
          }
        }
        return false;
      }

      try {
        if (element.offsetParent === null || element.disabled) {
          return false;
        }
        element.click();
        return true;
      } catch (e) {
        // 대체 방법 시도
        try {
          const clickableElement = element.querySelector('div[class*="cursor-pointer"]') || element;
          if (clickableElement && clickableElement !== element) {
            clickableElement.click();
            return true;
          }
        } catch (e2) {
          return false;
        }
        return false;
      }
    }

    /**
     * 안전한 텍스트 추출
     * @param {HTMLElement} element - 요소
     * @param {string} defaultValue - 기본값
     * @returns {string}
     */
    function safeGetText(element, defaultValue = '') {
      if (!element) return defaultValue;
      try {
        const text = (element.textContent || '').trim();
        return text || defaultValue;
      } catch (e) {
        return defaultValue;
      }
    }

    /**
     * 안전한 쿼리 셀렉터
     * @param {string} selector - CSS 셀렉터
     * @param {HTMLElement} context - 컨텍스트 요소
     * @returns {HTMLElement|null}
     */
    function safeQuerySelector(selector, context = document) {
      if (!selector) return null;
      try {
        return context.querySelector(selector);
      } catch (e) {
        return null;
      }
    }

    /**
     * 안전한 쿼리 셀렉터 All
     * @param {string} selector - CSS 셀렉터
     * @param {HTMLElement} context - 컨텍스트 요소
     * @returns {NodeList|Array}
     */
    function safeQuerySelectorAll(selector, context = document) {
      if (!selector) return [];
      try {
        return context.querySelectorAll(selector);
      } catch (e) {
        return [];
      }
    }

  })();
}
