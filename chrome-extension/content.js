// 쿠팡 리뷰 수집 Content Script
try {
  console.log('[Content] ========== Content Script 로드됨 ==========');
  console.log('[Content] 현재 페이지 URL:', window.location.href);
  console.log('[Content] 확장 프로그램 ID:', chrome.runtime.id);
  console.log('[Content] document.readyState:', document.readyState);
  console.log('[Content] window.__coupangReviewScraperLoaded:', window.__coupangReviewScraperLoaded);
} catch (e) {
  console.error('[Content] 초기 로그 출력 실패:', e);
}

// UI 스크립트 주입
(function () {
  console.log('[Content] UI 스크립트 주입 시작...');
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('collection-ui.js');
  script.onload = function () {
    console.log('[Content] UI 스크립트 로드 완료');
    this.remove();
  };
  script.onerror = function () {
    console.error('[Content] UI 스크립트 로드 실패');
  };
  (document.head || document.documentElement).appendChild(script);
  console.log('[Content] UI 스크립트 주입 완료');
})();

// 전역 변수 선언 (함수보다 먼저 선언)
let isScraping = false;
let stopScraping = false;
let currentOriginalTabId = null; // 현재 수집 작업의 originalTabId 저장
let currentRatingFilter = null; // 현재 수집 작업의 별점 필터 저장
let currentCollectedReviews = []; // 현재까지 수집한 리뷰 저장 (중지 시 전달용)

// UI에 메시지 전달 헬퍼 함수
function sendToUI(message) {
  // 즉시 처리 필요한 메시지만 직접 전달 (stopped, startScraping, complete)
  if (message.action === 'stopped' || message.action === 'startScraping' || message.action === 'complete') {
    try {
      window.postMessage({
        type: 'COUPANG_REVIEW_COLLECTOR',
        data: message
      }, '*');
    } catch (error) {
      console.error('[Content] window.postMessage 실패:', error);
    }
  }
}

// UI에서 중지 요청 수신 리스너
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'COUPANG_REVIEW_COLLECTOR_STOP') {
    console.log('[수집 중지] UI에서 중지 요청 수신 - 즉시 중지 처리');
    console.log('[수집 중지] 현재 상태 - isScraping:', isScraping, ', stopScraping:', stopScraping);

    // 즉시 중지 플래그 설정 (isScraping 체크 없이 무조건 설정)
    stopScraping = true;
    isScraping = false;

    console.log('[수집 중지] stopScraping=true, isScraping=false 설정 완료');

    // UI에 즉시 피드백 전달
    sendToUI({
      action: 'stopped',
      message: '수집 중지 요청이 처리되었습니다.'
    });

    // Background에 메시지 전달 (현재까지 수집한 리뷰 포함)
    try {
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: '수집이 중지되었습니다.',
        reviews: currentCollectedReviews.length > 0 ? currentCollectedReviews : [] // 현재까지 수집한 리뷰 포함
      }).catch(() => {
        // 오류 무시
      });
    } catch (e) {
      // 오류 무시
    }

    // chrome.runtime.onMessage로도 중지 메시지 전송 (더 확실하게)
    try {
      chrome.runtime.sendMessage({
        action: 'stopScraping'
      }).catch(() => { });
    } catch (e) { }
  }
});

// 중복 주입 방지: 이미 실행된 경우 재실행 방지
if (!window.__coupangReviewScraperLoaded) {
  console.log('[Content] ✅ Content Script 초기화 시작...');
  window.__coupangReviewScraperLoaded = true;

  // 즉시 실행 함수로 감싸서 변수 스코프 격리
  (function () {
    'use strict';

    // 변수는 이미 전역으로 선언됨 (위에서 선언)

    // 페이지 로드 시 상태 초기화 (안전장치)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // 페이지 로드 완료 후 잠시 대기 후 상태 확인
        setTimeout(() => {
          if (isScraping) {
            console.warn('[상태 초기화] 페이지 로드 후 isScraping이 true로 남아있어 초기화합니다.');
            isScraping = false;
            stopScraping = false;
          }
        }, 1000);
      });
    } else {
      // 이미 로드된 경우 즉시 확인
      if (isScraping) {
        console.warn('[상태 초기화] Content Script 재로드 시 isScraping이 true로 남아있어 초기화합니다.');
        isScraping = false;
        stopScraping = false;
      }
    }

    // Extension context 유효성 확인 헬퍼 함수
    function isExtensionContextValid() {
      try {
        // chrome.runtime.id가 존재하면 context가 유효함
        return chrome.runtime && chrome.runtime.id !== undefined;
      } catch (e) {
        return false;
      }
    }

    // 안전한 메시지 전송 함수 (에러 무시 버전)
    function safeSendMessage(message, callback) {
      // background가 이미 UI와 popup에 메시지를 전달하므로 여기서는 전달하지 않음
      // (중복 방지)

      return new Promise((resolve, reject) => {
        if (!isExtensionContextValid()) {
          // Extension context가 무효화된 경우 조용히 실패 처리
          console.debug('Extension context invalidated: 메시지 전송 건너뜀');
          resolve(null);
          return;
        }

        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError;
              // Extension context invalidated 오류는 조용히 처리
              if (error.message && error.message.includes('Extension context invalidated')) {
                console.debug('Extension context invalidated: 메시지 전송 건너뜀');
                resolve(null);
              } else if (error.message && error.message.includes('message port closed')) {
                // 메시지 포트가 닫힌 경우도 조용히 처리
                console.debug('Message port closed: 메시지 전송 건너뜀');
                resolve(null);
              } else {
                // 다른 오류는 로그만 남기고 조용히 처리
                console.debug('메시지 전송 실패 (무시):', error.message);
                resolve(null);
              }
            } else {
              if (callback) callback(response);
              resolve(response);
            }
          });
        } catch (error) {
          // 모든 예외를 조용히 처리
          if (error.message && (
            error.message.includes('Extension context invalidated') ||
            error.message.includes('message port closed')
          )) {
            console.debug('메시지 전송 중 예외 (무시):', error.message);
            resolve(null);
          } else {
            console.debug('메시지 전송 중 예외 (무시):', error);
            resolve(null);
          }
        }
      });
    }

    // 메시지 리스너 (중복 등록 방지)
    console.log('[Content] 메시지 리스너 등록 체크 시작...');
    console.log('[Content] window.__coupangReviewScraperListenerAdded:', window.__coupangReviewScraperListenerAdded);
    if (!window.__coupangReviewScraperListenerAdded) {
      console.log('[Content] ✅ 메시지 리스너 등록 시작...');
      window.__coupangReviewScraperListenerAdded = true;

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('[Content] ========== 메시지 수신 ==========');
        console.log('[Content] Action:', request.action);
        console.log('[Content] 현재 페이지 URL:', window.location.href);
        console.log('[Content] 요청 URL:', request.url);
        console.log('[Content] Sender:', sender);

        // Extension context 유효성 확인
        if (!isExtensionContextValid()) {
          console.error('[Content] Extension context invalidated: 메시지를 처리할 수 없습니다.');
          try {
            sendResponse({ success: false, error: 'Extension context invalidated' });
          } catch (e) {
            console.error('[Content] 응답 전송 실패:', e);
          }
          return false;
        }

        console.log('[Content] Extension context 유효함');

        // background에서 받은 complete 메시지는 UI에 직접 전달
        if (request.action === 'complete') {
          sendToUI({
            action: 'complete',
            reviews: request.reviews || [],
            stopped: request.stopped || false
          });
        }

        // ping 메시지 처리 (테스트용)
        if (request.action === 'ping') {
          try {
            sendResponse({ success: true, message: 'Content Script 활성', url: window.location.href });
          } catch (e) {
            console.debug('ping 응답 실패:', e);
          }
          return true;
        }

        if (request.action === 'startScraping') {
          console.log('[Content] ========== startScraping 메시지 수신 ==========');
          console.log('[Content] startScraping 요청 상세:', request);
          console.log('[Content] 요청 URL:', request.url);
          console.log('[Content] Original Tab ID:', request.originalTabId);
          console.log('[Content] 현재 isScraping:', isScraping);
          console.log('[Content] 현재 stopScraping:', stopScraping);

          // originalTabId 저장
          if (request.originalTabId) {
            currentOriginalTabId = request.originalTabId;
            console.log('[Content] ✅ Original Tab ID 저장:', currentOriginalTabId);
          }

          // ratingFilter 저장
          if (request.ratingFilter) {
            currentRatingFilter = request.ratingFilter;
            console.log('[Content] ✅ Rating Filter 저장:', currentRatingFilter);
          } else {
            currentRatingFilter = null;
            console.log('[Content] Rating Filter 없음 (모든 별점 수집)');
          }

          // UI에 수집 시작 알림 (UI 생성 트리거)
          sendToUI({
            action: 'startScraping',
            message: '리뷰 수집을 시작합니다...'
          });

          // 중복 실행 방지
          if (isScraping) {
            const errorMsg = '이미 수집 중입니다. 잠시 후 다시 시도해주세요.';
            console.warn('[수집 시작]', errorMsg);

            // 상태가 이상하게 남아있는 경우 강제 리셋
            console.warn('[수집 시작] isScraping이 true로 남아있어 강제 리셋합니다.');
            isScraping = false;
            stopScraping = false;

            try {
              sendResponse({ success: false, error: errorMsg });
            } catch (e) {
              // sendResponse가 이미 호출되었거나 포트가 닫힌 경우 무시
              console.debug('응답 전송 실패 (무시 가능):', e);
            }
            return false;
          }

          // 즉시 응답 (비동기 작업 시작 확인)
          let responseSent = false;
          try {
            sendResponse({ success: true, message: '수집 시작됨' });
            responseSent = true;
            console.log('[디버그] 응답 전송 완료: success=true');
          } catch (e) {
            // sendResponse 실패는 무시 (비동기 응답이므로)
            console.debug('초기 응답 전송 실패 (무시 가능):', e);
          }

          // 비동기 처리 시작 (응답은 이미 전송됨)
          console.log('[디버그] startScraping 함수 호출 시작...');
          startScraping(request.url, request.ratingFilter)
            .then(result => {
              console.log('[디버그] startScraping 완료:', result);
              // 완료 메시지는 startScraping 내부에서 safeSendMessage로 전송됨
            })
            .catch(error => {
              console.error('[디버그] startScraping 실패:', error);
              console.error('[디버그] 에러 스택:', error.stack);
              // 오류 메시지는 startScraping 내부에서 safeSendMessage로 전송됨
            });

          return true; // 비동기 응답
        } else if (request.action === 'stopScraping') {
          console.log('[수집 중지] stopScraping 메시지 수신 - 즉시 중지');
          stopScraping = true;
          // 중지 시 isScraping도 리셋 (다음 수집을 위해)
          isScraping = false;
          console.log('[수집 중지] 수집 중지 요청 수신, 상태 리셋됨');

          // 즉시 중지 메시지 전송 (현재까지 수집한 데이터 포함)
          console.log('[수집 중지] 현재까지 수집한 리뷰 수:', currentCollectedReviews.length);
          safeSendMessage({
            action: 'stopped',
            message: '수집이 중지되었습니다.',
            reviews: currentCollectedReviews.length > 0 ? currentCollectedReviews : [] // 현재까지 수집한 리뷰 포함
          }).then(() => {
            console.log('[수집 중지] 중지 메시지 전송 완료');
          }).catch(err => {
            console.debug('[수집 중지] 중지 메시지 전송 실패 (무시 가능):', err);
          });

          // 즉시 응답
          try {
            sendResponse({ success: true, message: '수집 중지됨' });
          } catch (e) {
            console.debug('[수집 중지] 응답 전송 실패 (무시 가능):', e);
          }
          return true;
        } else if (request.action === 'resetState') {
          // 상태 리셋 요청 (디버깅용)
          isScraping = false;
          stopScraping = false;
          console.log('[상태 리셋] 수집 상태 초기화됨');
          if (isExtensionContextValid()) {
            sendResponse({ success: true });
          }
          return true;
        }

        return false;
      });
    }

    // 리뷰 수집 시작
    async function startScraping(url, ratingFilter = null) {
      console.log('[디버그] ========== startScraping 호출 시작 ==========');
      console.log('[디버그] URL:', url);
      console.log('[디버그] 현재 페이지 URL:', window.location.href);
      console.log('[디버그] isScraping 상태:', isScraping);
      console.log('[디버그] Rating Filter:', ratingFilter);

      // 중복 실행 방지 (이미 체크했지만 이중 체크)
      if (isScraping) {
        console.error('[디버그] 이미 수집 중입니다!');
        throw new Error('이미 수집 중입니다.');
      }

      isScraping = true;
      stopScraping = false;
      currentCollectedReviews = []; // 수집 시작 시 리뷰 배열 초기화
      console.log('[디버그] 수집 상태 설정 완료: isScraping=true, stopScraping=false');

      try {
        // 현재 페이지가 상품 페이지인지 확인
        const currentUrl = window.location.href;
        if (!currentUrl.includes('/vp/products/')) {
          console.log('상품 페이지로 이동:', url);
          // 상품 페이지로 이동
          window.location.href = url;
          await waitForPageLoad();
        } else {
          console.log('이미 상품 페이지에 있음');
        }

        // 페이지가 완전히 로드될 때까지 대기
        await waitForPageReady();
        console.log('[수집 시작] 페이지 로드 완료');

        // 리뷰 탭 클릭 (스크롤 없이)
        console.log('[수집 시작] 리뷰 탭 클릭 중...');
        safeSendMessage({
          action: 'log',
          message: '리뷰 탭을 찾고 클릭합니다...',
          type: 'info'
        });
        await clickReviewTab();
        if (stopScraping) {
          console.log('[수집 시작] 중지 요청으로 인해 수집을 중단합니다.');
          throw new Error('수집이 중지되었습니다.');
        }
        safeSendMessage({
          action: 'log',
          message: '리뷰 탭 클릭 완료',
          type: 'success'
        });
        console.log('[수집 시작] 리뷰 탭 클릭 완료');

        // 리뷰 섹션 로드 대기 (중지 가능)
        console.log('[수집 시작] 리뷰 섹션 로드 대기 중...');
        await waitForReviewsSection();
        if (stopScraping) {
          console.log('[수집 시작] 중지 요청으로 인해 수집을 중단합니다.');
          throw new Error('수집이 중지되었습니다.');
        }
        console.log('[수집 시작] 리뷰 섹션 로드 대기 완료');

        // 추가 대기 (동적 콘텐츠 로드) - 중지 가능하게, 시간 단축
        await sleep(1000);
        if (stopScraping) {
          console.log('[수집 시작] 중지 요청으로 인해 수집을 중단합니다.');
          throw new Error('수집이 중지되었습니다.');
        }
        console.log('[수집 시작] 동적 콘텐츠 로드 대기 완료');

        // 모든 페이지 리뷰 수집
        console.log('[디버그] ========== collectAllReviews 호출 전 ==========');
        console.log('[수집 시작] 리뷰 수집 시작...');
        safeSendMessage({
          action: 'log',
          message: '리뷰 수집을 시작합니다...',
          type: 'info'
        });
        console.log('[디버그] collectAllReviews 함수 호출...');
        const allReviews = await collectAllReviews();
        console.log('[디버그] collectAllReviews 완료, 수집된 리뷰 수:', allReviews.length);
        safeSendMessage({
          action: 'log',
          message: `리뷰 수집 완료: 총 ${allReviews.length}개 리뷰 수집됨`,
          type: 'success'
        });
        console.log(`[수집 완료] 총 ${allReviews.length}개 리뷰 수집됨`);

        // 리뷰가 없는 경우 처리
        let isRatingFilterStopped = false;
        if (allReviews.length === 0) {
          if (currentRatingFilter && currentRatingFilter.length > 0) {
            // 별점 필터가 적용된 경우: 수집 종료 (리뷰 0개)
            console.log('[수집 종료] 별점 필터로 인해 리뷰가 없음:', currentRatingFilter);
            safeSendMessage({
              action: 'log',
              message: `선택한 별점(${currentRatingFilter.join(', ')}점)의 리뷰가 없습니다. 수집을 종료합니다.`,
              type: 'warning'
            });
            isRatingFilterStopped = true; // 별점 필터로 인한 종료 플래그
            // 에러를 던지지 않고 수집 종료 처리
          } else {
            // 일반적인 경우: 리뷰를 찾지 못함 - 수집 종료 및 탭 닫기
            const errorMsg = '리뷰를 찾을 수 없습니다. 리뷰 추출을 종료합니다.';
            console.log('[수집 완료]', errorMsg);
            console.log('[수집 완료] 리뷰 추출을 종료합니다.');

            // 로그 메시지 전송
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

            // 중지 메시지 전송 (리뷰 0개 포함, 탭 닫기용)
            safeSendMessage({
              action: 'stopped',
              message: errorMsg,
              reviews: [] // 리뷰 0개 포함
            }).then(() => {
              console.log('[수집 완료] 중지 메시지 전송 완료 (리뷰 없음)');
            }).catch(err => {
              console.debug('중지 메시지 전송 중 오류 (무시):', err);
            });

            isScraping = false;
            // 에러를 던지지 않고 수집 종료 처리 (탭 닫기 위해)
            return { reviews: [], stopped: true };
          }
        }

        // 중지 여부 확인
        const isStopped = stopScraping || isRatingFilterStopped;

        // 중지된 경우 완료 메시지 전송하지 않음 (이미 중지 메시지 전송됨)
        if (!isStopped) {
          // 완료 메시지 전송 (background.js가 content script에 전달하고, content.js가 UI에 전달함)
          console.log('[수집 완료] 총', allReviews.length, '개 리뷰 수집됨');
          safeSendMessage({
            action: 'complete',
            reviews: allReviews,
            stopped: false
          });
        } else if (isRatingFilterStopped) {
          // 별점 필터로 인한 종료: 중지 메시지 전송 (리뷰 0개 포함)
          console.log('[수집 종료] 별점 필터로 인해 수집 종료, 리뷰 0개');
          safeSendMessage({
            action: 'stopped',
            message: `선택한 별점(${currentRatingFilter.join(', ')}점)의 리뷰가 없어 수집을 종료합니다.`,
            reviews: allReviews // 리뷰 0개 포함
          });
        }

        isScraping = false;
        return { reviews: allReviews, stopped: isStopped };
      } catch (error) {
        isScraping = false;
        // 오류 메시지 상세화
        const errorMessage = error instanceof DOMException
          ? `DOM 오류: ${error.name} - ${error.message || '알 수 없는 DOM 오류'}`
          : error.message || String(error);

        // 오류 메시지 전송
        safeSendMessage({
          action: 'error',
          error: errorMessage
        }).then(() => {
          // 성공적으로 전송됨 (또는 무시됨)
        }).catch(err => {
          // safeSendMessage는 이제 reject하지 않으므로 이 블록은 실행되지 않을 수 있음
          console.debug('오류 메시지 전송 중 오류 (무시):', err);
        });
        throw new Error(errorMessage);
      }
    }

    // 페이지 로드 대기
    function waitForPageLoad() {
      return new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve, { once: true });
        }
      });
    }

    // 페이지가 완전히 준비될 때까지 대기 (중지 가능)
    function waitForPageReady() {
      return new Promise((resolve) => {
        // 중지 요청 확인
        if (stopScraping) {
          resolve();
          return;
        }

        // 이미 로드 완료된 경우
        if (document.readyState === 'complete' && document.body) {
          // 추가 대기 (동적 콘텐츠 로드) - 중지 가능하게
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (stopScraping || Date.now() - startTime >= 1000) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          return;
        }

        // DOMContentLoaded 대기
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

    // 리뷰 섹션이 로드될 때까지 대기 (MutationObserver 사용, 중지 가능)
    function waitForReviewsSection() {
      return new Promise((resolve) => {
        // 중지 요청 확인
        if (stopScraping) {
          resolve();
          return;
        }

        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview && sdpReview.children.length > 0) {
          // 이미 리뷰 섹션이 있으면 즉시 반환
          resolve();
          return;
        }

        // MutationObserver로 리뷰 섹션 감시
        const observer = new MutationObserver((mutations, obs) => {
          if (stopScraping) {
            obs.disconnect();
            resolve();
            return;
          }

          const reviewSection = document.querySelector('#sdpReview');
          if (reviewSection && reviewSection.children.length > 0) {
            obs.disconnect();
            console.log('[리뷰 섹션 대기] 리뷰 섹션 로드 완료');
            // 추가 대기 (중지 가능하게)
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
              if (stopScraping || Date.now() - startTime >= 500) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
          }
        });

        // body를 감시
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }

        // 최대 5초 대기 (중지 가능하게)
        const startTime = Date.now();
        const timeoutInterval = setInterval(() => {
          if (stopScraping || Date.now() - startTime >= 5000) {
            clearInterval(timeoutInterval);
            observer.disconnect();
            console.log('[리뷰 섹션 대기] 타임아웃 - 계속 진행');
            resolve();
          }
        }, 100);
      });
    }

    // 리뷰 탭 클릭 (스크롤 없이)
    async function clickReviewTab() {
      return new Promise((resolve) => {
        // 중지 요청 확인
        if (stopScraping) {
          resolve();
          return;
        }

        try {
          // DOM이 준비되었는지 확인
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

          // 리뷰 탭 클릭 시도 (표준 CSS 선택자 사용)
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
              console.debug('[리뷰 탭] 선택자 오류:', selector, e);
            }
          }

          // 텍스트로 리뷰 탭 찾기 (button, a 태그)
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
              console.debug('[리뷰 탭] 버튼 찾기 오류:', e);
            }
          }

          // 리뷰 탭 클릭 (스크롤 없이)
          for (const tab of reviewTabs) {
            if (stopScraping) {
              resolve();
              return;
            }

            try {
              const text = (tab.textContent || '').toLowerCase().trim();
              if (text.includes('리뷰') && !text.includes('이미지') && !text.includes('image')) {
                // 요소가 보이는지 확인
                if (tab.offsetParent !== null && !tab.disabled) {
                  // 스크롤 없이 바로 클릭
                  try {
                    tab.click();
                    console.log('[리뷰 탭] 리뷰 탭 클릭 완료');
                    // 페이지 로드 대기 (중지 가능하게, 시간 단축)
                    const startTime = Date.now();
                    const checkInterval = setInterval(() => {
                      if (stopScraping || Date.now() - startTime >= 1000) {
                        clearInterval(checkInterval);
                        resolve();
                      }
                    }, 100);
                    return;
                  } catch (clickError) {
                    console.debug('[리뷰 탭] 클릭 오류:', clickError);
                    // 클릭 실패해도 계속 진행
                  }
                }
              }
            } catch (e) {
              console.debug('[리뷰 탭] 탭 처리 오류:', e);
            }
          }

          // 리뷰 탭을 찾지 못한 경우에도 계속 진행
          console.log('[리뷰 탭] 리뷰 탭을 찾지 못했지만 계속 진행');
          resolve();
        } catch (error) {
          console.error('[리뷰 탭] clickReviewTab 오류:', error);
          resolve(); // 오류가 발생해도 계속 진행
        }
      });
    }

    // 모든 리뷰 수집
    async function collectAllReviews() {
      console.log('[디버그] ========== collectAllReviews 함수 시작 ==========');
      console.log('[디버그] 현재 페이지 URL:', window.location.href);
      console.log('[디버그] stopScraping 상태:', stopScraping);

      const allReviews = [];
      // 전역 변수에 참조 저장 (중지 시 현재까지 수집한 리뷰 접근용)
      currentCollectedReviews = allReviews;
      let currentPage = 1;
      let consecutiveFailures = 0;
      const maxFailures = 3;
      let hasNoReviewsMessage = false;

      console.log('[디버그] 초기화 완료: currentPage=1, maxFailures=3');

      // 리뷰 없음 메시지 (정확한 확인을 위해)
      const noReviewMessages = [
        '등록된 상품평이 없습니다',
        '등록된 리뷰가 없습니다',
        '상품평이 없습니다'
      ];

      // 첫 페이지에서 리뷰 요소를 먼저 찾아보기
      console.log('[수집 시작] 첫 페이지 리뷰 확인 중...');
      if (currentRatingFilter && currentRatingFilter.length > 0) {
        console.log(`[수집 시작] 별점 필터 적용: ${currentRatingFilter.join(', ')}점만 수집`);
      }
      let firstPageReviews = extractReviewsFromPage();
      console.log(`[수집 시작] 첫 페이지에서 ${firstPageReviews.length}개 리뷰 발견 (필터 적용 후)`);

      // 리뷰가 없을 때만 리뷰 섹션에서 리뷰 없음 메시지 확인
      if (firstPageReviews.length === 0) {
        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview) {
          const reviewText = sdpReview.textContent || '';
          // 리뷰 섹션 내에서만 정확하게 확인
          const hasNoReviewInSection = noReviewMessages.some(msg => {
            // 정확한 매칭 (단순 includes가 아닌 더 정확한 확인)
            const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return regex.test(reviewText);
          });

          if (hasNoReviewInSection) {
            // 리뷰 섹션에 실제로 리뷰 요소가 있는지 다시 확인
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              hasNoReviewsMessage = true;
              console.log('[수집 시작] 리뷰 섹션에서 리뷰 없음 메시지 확인: 수집을 종료합니다.');
            } else {
              console.log(`[수집 시작] 리뷰 없음 메시지가 있지만 ${reviewElements.length}개 리뷰 요소 발견, 계속 진행`);
              // 리뷰 요소가 있으면 다시 추출 시도
              firstPageReviews = extractReviewsFromPage();
              console.log(`[수집 시작] 재추출 결과: ${firstPageReviews.length}개 리뷰 발견`);
            }
          }
        }
      }

      // 첫 페이지 리뷰 추가
      if (firstPageReviews.length > 0) {
        // 첫 페이지 리뷰들을 하나씩 추가하면서 로그 전송
        for (const review of firstPageReviews) {
          // 별점 필터 적용 (이미 extractReviewsFromPage에서 필터링되었지만 이중 체크)
          if (currentRatingFilter && currentRatingFilter.length > 0) {
            const reviewRating = review.rating ? review.rating.toString() : '';
            if (!currentRatingFilter.includes(reviewRating)) {
              console.log(`[리뷰 수집] 별점 필터에 의해 제외됨 (별점: ${reviewRating}, 필터: ${currentRatingFilter.join(', ')})`);
              continue;
            }
          }
          isDuplicateReview(review, allReviews);
          allReviews.push(review);

          // 각 리뷰 수집 로그 전송
          const reviewContent = (review.content || '').substring(0, 30);
          const reviewDate = review.date || '날짜 없음';
          const reviewRating = review.rating || 0;
          safeSendMessage({
            action: 'log',
            message: `리뷰 수집: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} ${reviewContent}${reviewContent.length >= 30 ? '...' : ''}`,
            type: 'info'
          });
        }
        console.log(`[수집 시작] 첫 페이지 리뷰 ${firstPageReviews.length}개 추가됨`);
        // 첫 페이지는 이미 처리했으므로 다음 페이지부터 시작
        currentPage = 2;
      } else {
        // 첫 페이지에서 리뷰를 찾지 못했지만 리뷰 없음 메시지도 없는 경우
        // while 루프에서 첫 페이지를 다시 시도
        currentPage = 1;
        console.log('[수집 시작] 첫 페이지에서 리뷰를 찾지 못했지만 계속 시도합니다.');
      }

      while (!stopScraping && !hasNoReviewsMessage && consecutiveFailures < maxFailures) {
        // 중지 요청 확인 (루프 시작 시) - 더 명확하게
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다.');
          console.log('[수집 진행] 현재까지 수집한 리뷰:', allReviews.length, '개');
          safeSendMessage({
            action: 'log',
            message: `중지 요청 감지: 수집을 중지합니다. (현재까지 ${allReviews.length}개 수집됨)`,
            type: 'warning'
          });
          break;
        }

        console.log(`[수집 진행] 페이지 ${currentPage} 리뷰 수집 시작...`);
        safeSendMessage({
          action: 'log',
          message: `페이지 ${currentPage} 리뷰 수집 시작...`,
          type: 'info'
        });

        // 현재 페이지 리뷰 수집
        const reviews = extractReviewsFromPage();
        console.log(`[수집 진행] 페이지 ${currentPage}에서 ${reviews.length}개 리뷰 발견`);

        // 중지 요청 확인 (수집 후)
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다.');
          break;
        }

        if (reviews.length === 0) {
          console.log(`[수집 진행] 페이지 ${currentPage}에서 리뷰를 찾지 못함`);

          // 리뷰가 없는 경우 추가 확인 (리뷰 섹션 내에서만 정확하게 확인)
          const sdpReview = document.querySelector('#sdpReview');
          if (sdpReview) {
            // 리뷰 요소가 실제로 있는지 먼저 확인
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              // 리뷰 요소가 없을 때만 리뷰 없음 메시지 확인
              const reviewText = sdpReview.textContent || '';
              const hasNoReviewInSection = noReviewMessages.some(msg => {
                // 정확한 매칭
                const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                return regex.test(reviewText);
              });

              if (hasNoReviewInSection) {
                hasNoReviewsMessage = true;
                console.log('[수집 진행] 리뷰 섹션에서 리뷰 없음 확인: 수집을 종료합니다.');
                break;
              }
            } else {
              console.log(`[수집 진행] 리뷰 요소 ${reviewElements.length}개 발견했지만 추출 실패, 재시도...`);
            }
          }

          consecutiveFailures++;
          console.log(`[수집 진행] 연속 실패 횟수: ${consecutiveFailures}/${maxFailures}`);

          if (consecutiveFailures >= maxFailures) {
            console.log('[수집 진행] 연속 실패로 인해 수집을 종료합니다.');
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

          // 리뷰를 찾지 못한 경우 추가 대기 후 재시도 (중지 가능, 시간 단축)
          console.log('[수집 진행] 1초 대기 후 재시도...');
          await sleep(1000);
          if (stopScraping) {
            break;
          }
          continue;
        }

        // 중복 제거 (중지 가능)
        for (const review of reviews) {
          // 중지 요청 확인 (각 리뷰 처리 전)
          if (stopScraping) {
            console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다.');
            break;
          }

          // 별점 필터 적용
          if (currentRatingFilter && currentRatingFilter.length > 0) {
            const reviewRating = review.rating ? review.rating.toString() : '';
            if (!currentRatingFilter.includes(reviewRating)) {
              console.log(`[리뷰 수집] 별점 필터에 의해 제외됨 (별점: ${reviewRating}, 필터: ${currentRatingFilter.join(', ')})`);
              continue;
            }
          }
          // 중복 리뷰 확인 및 덮어쓰기 처리 (isDuplicateReview 내부에서 이미 처리됨)
          isDuplicateReview(review, allReviews);
          allReviews.push(review);

          // 각 리뷰 수집 로그 전송
          const reviewContent = (review.content || '').substring(0, 30);
          const reviewDate = review.date || '날짜 없음';
          const reviewRating = review.rating || 0;
          safeSendMessage({
            action: 'log',
            message: `리뷰 수집: [${reviewDate}] ${'★'.repeat(reviewRating)}${'☆'.repeat(5 - reviewRating)} ${reviewContent}${reviewContent.length >= 30 ? '...' : ''}`,
            type: 'info'
          });
        }

        // 중지 요청 확인 (중복 제거 후)
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다. 현재까지 수집한 리뷰:', allReviews.length, '개');
          break;
        }

        // 진행 상황 전송
        const progressPercent = Math.min(90, (currentPage * 10));
        const progressText = `${allReviews.length}개 리뷰 수집 중... (페이지 ${currentPage})`;
        safeSendMessage({
          action: 'progress',
          percent: progressPercent,
          text: progressText,
          log: `페이지 ${currentPage}: ${reviews.length}개 리뷰 발견, 총 ${allReviews.length}개 수집됨`,
          logType: 'info'
        }).then(() => {
          // 성공적으로 전송됨 (또는 무시됨)
        }).catch(err => {
          // safeSendMessage는 이제 reject하지 않으므로 이 블록은 실행되지 않을 수 있음
          console.debug('진행 상황 전송 중 오류 (무시):', err);
        });

        // 중지 요청 확인 (진행 상황 전송 후)
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다. 현재까지 수집한 리뷰:', allReviews.length, '개');
          break;
        }

        // 중지 요청 확인 (다음 페이지 이동 전)
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다. 현재까지 수집한 리뷰:', allReviews.length, '개');
          break;
        }

        // 다음 페이지로 이동 시도
        safeSendMessage({
          action: 'log',
          message: `다음 페이지로 이동 시도...`,
          type: 'info'
        });
        const hasNext = await goToNextPage();

        // 중지 요청 확인 (다음 페이지 이동 후)
        if (stopScraping) {
          console.log('[수집 진행] 중지 요청 감지: 수집을 중지합니다.');
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
        await sleep(2000); // 페이지 로드 대기
      }

      // 리뷰가 없는 경우 메시지 전송
      if (allReviews.length === 0) {
        if (currentRatingFilter && currentRatingFilter.length > 0) {
          // 별점 필터가 적용된 경우
          console.log(`[수집 완료] 별점 필터(${currentRatingFilter.join(', ')}점)로 인해 리뷰가 없음`);
          safeSendMessage({
            action: 'log',
            message: `선택한 별점(${currentRatingFilter.join(', ')}점)의 리뷰가 없습니다.`,
            type: 'warning'
          });
        } else if (hasNoReviewsMessage) {
          // 리뷰 없음 메시지가 있는 경우
          console.log('[수집 완료] 리뷰 없음 메시지 확인됨');
          safeSendMessage({
            action: 'error',
            error: '이 상품에는 등록된 리뷰가 없습니다.'
          }).then(() => {
            // 성공적으로 전송됨 (또는 무시됨)
          }).catch(err => {
            // safeSendMessage는 이제 reject하지 않으므로 이 블록은 실행되지 않을 수 있음
            console.debug('오류 메시지 전송 중 오류 (무시):', err);
          });
        } else {
          // 리뷰 없음 메시지도 없고 리뷰도 없는 경우 (추출 실패)
          console.log('[수집 완료] 리뷰를 찾지 못했습니다. DOM 구조를 확인하세요.');
          console.log('[수집 완료] 리뷰 추출을 종료합니다.');
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
          // 리뷰를 찾지 못한 경우 중지 메시지 전송 (탭 닫기용)
          safeSendMessage({
            action: 'stopped',
            message: '리뷰를 찾지 못했습니다. 리뷰 추출을 종료합니다.',
            reviews: [] // 리뷰 0개 포함
          });
        }
      }

      return allReviews;
    }

    // 현재 페이지에서 리뷰 추출
    function extractReviewsFromPage() {
      console.log('[디버그] ========== extractReviewsFromPage 함수 시작 ==========');
      const reviews = [];
      console.log('[리뷰 추출 시작] 현재 URL:', window.location.href);

      try {
        // 리뷰가 없다는 메시지 확인
        const noReviewMessages = [
          '등록된 상품평이 없습니다',
          '등록된 리뷰가 없습니다',
          '상품평이 없습니다',
          '리뷰가 없습니다',
          'no reviews',
          'no registered'
        ];

        // 리뷰 섹션 내에서만 리뷰 없음 메시지 확인 (페이지 전체가 아닌)
        const sdpReview = document.querySelector('#sdpReview');
        if (sdpReview) {
          const reviewText = sdpReview.textContent || '';
          const hasNoReviewMessage = noReviewMessages.some(msg => {
            // 정확한 매칭 (단순 includes가 아닌)
            const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return regex.test(reviewText);
          });

          if (hasNoReviewMessage) {
            // 리뷰 요소가 실제로 있는지 확인
            const reviewElements = sdpReview.querySelectorAll('article, div[class*="review"], div[class*="comment"]');
            if (reviewElements.length === 0) {
              console.log('[리뷰 추출] 리뷰 섹션에서 리뷰 없음 메시지 감지됨');
              return reviews; // 빈 배열 반환
            } else {
              console.log(`[리뷰 추출] 리뷰 없음 메시지가 있지만 ${reviewElements.length}개 리뷰 요소 발견, 계속 진행`);
            }
          }
        }

        // sdpReview 섹션 확인 (이미 위에서 선언됨, 재사용)
        console.log('[리뷰 추출] #sdpReview 존재:', !!sdpReview);
        if (sdpReview) {
          console.log('[리뷰 추출] #sdpReview 내부 요소 수:', sdpReview.children.length);
          console.log('[리뷰 추출] #sdpReview HTML 일부:', sdpReview.innerHTML.substring(0, 500));
        }

        // 리뷰 선택자들 (더 다양한 선택자 추가)
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
          // 중지 요청 확인
          if (stopScraping) {
            console.log('[리뷰 추출] 중지 요청으로 인해 선택자 검색을 중단합니다.');
            break;
          }

          try {
            const elements = document.querySelectorAll(selector);
            console.log(`[리뷰 추출] 선택자 "${selector}": ${elements.length}개 요소 발견`);
            if (elements.length > 0) {
              reviewElements = elements;
              console.log(`[리뷰 추출] 선택자 "${selector}" 사용하여 ${elements.length}개 리뷰 요소 찾음`);
              break;
            }
          } catch (e) {
            console.debug('[리뷰 추출] 선택자 오류:', selector, e);
            continue;
          }
        }

        // 리뷰 요소가 없으면 sdpReview 내부에서 더 광범위하게 찾기
        if (reviewElements.length === 0) {
          console.log('[리뷰 추출] 기본 선택자로 리뷰를 찾지 못함. 추가 검색 시도...');
          try {
            if (sdpReview) {
              // sdpReview 내부에서 리뷰 없음 메시지 확인 (정확한 매칭)
              const reviewText = sdpReview.textContent || '';
              const hasNoReviewInSection = noReviewMessages.some(msg => {
                const regex = new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                return regex.test(reviewText);
              });

              if (hasNoReviewInSection) {
                // 리뷰 요소가 정말 없는지 다시 확인
                const checkElements = sdpReview.querySelectorAll('article, div, section');
                if (checkElements.length === 0 || checkElements.length < 3) {
                  console.log('[리뷰 추출] 리뷰 섹션에서 리뷰 없음 메시지 감지됨');
                  return reviews; // 빈 배열 반환
                } else {
                  console.log(`[리뷰 추출] 리뷰 없음 메시지가 있지만 ${checkElements.length}개 요소 발견, 계속 검색`);
                }
              }

              // 더 광범위한 선택자 시도
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
                // 중지 요청 확인
                if (stopScraping) {
                  console.log('[리뷰 추출] 중지 요청으로 인해 대체 선택자 검색을 중단합니다.');
                  break;
                }

                try {
                  const elements = sdpReview.querySelectorAll(selector);
                  console.log(`[리뷰 추출] 대체 선택자 "${selector}": ${elements.length}개 요소 발견`);
                  if (elements.length > 0) {
                    // 요소가 실제 리뷰인지 확인 (텍스트 길이로 필터링)
                    const filtered = Array.from(elements).filter(el => {
                      const text = el.textContent || '';
                      return text.length > 50 && text.length < 5000; // 리뷰로 보이는 길이
                    });
                    if (filtered.length > 0) {
                      reviewElements = filtered;
                      console.log(`[리뷰 추출] 대체 선택자 "${selector}" 사용하여 ${filtered.length}개 리뷰 요소 찾음`);
                      break;
                    }
                  }
                } catch (e) {
                  console.debug('[리뷰 추출] 대체 선택자 오류:', selector, e);
                }
              }
            } else {
              console.log('[리뷰 추출] #sdpReview 섹션을 찾을 수 없습니다.');
            }
          } catch (e) {
            console.error('[리뷰 추출] sdpReview 내부 검색 오류:', e);
          }
        }

        console.log(`[리뷰 추출] 총 ${reviewElements.length}개 리뷰 요소 발견`);

        // 실제 리뷰 데이터가 있는 요소만 필터링
        for (let i = 0; i < reviewElements.length; i++) {
          // 중지 요청 확인 (각 요소 처리 전)
          if (stopScraping) {
            console.log(`[리뷰 추출] 중지 요청으로 인해 리뷰 추출을 중단합니다. (${i}/${reviewElements.length} 처리됨)`);
            break; // 즉시 루프 종료
          }

          const element = reviewElements[i];
          try {
            // 요소가 리뷰 없음 메시지를 포함하는지 확인
            const elementText = element.textContent || '';
            const isNoReviewMessage = noReviewMessages.some(msg =>
              elementText.includes(msg) && elementText.length < 100 // 짧은 텍스트만 (메시지일 가능성)
            );

            if (isNoReviewMessage) {
              console.log(`[리뷰 추출] 요소 ${i + 1}: 리뷰 없음 메시지로 판단되어 건너뜀`);
              continue; // 리뷰 없음 메시지 요소는 건너뛰기
            }

            // 요소가 너무 작거나 큰 경우 건너뛰기
            if (elementText.length < 20 || elementText.length > 10000) {
              console.log(`[리뷰 추출] 요소 ${i + 1}: 텍스트 길이가 비정상적 (${elementText.length}자) - 건너뜀`);
              continue;
            }

            // 중지 요청 확인 (데이터 추출 전)
            if (stopScraping) {
              console.log(`[리뷰 추출] 중지 요청으로 인해 리뷰 추출을 중단합니다.`);
              break;
            }

            const review = extractReviewData(element);
            if (review && review.content && review.content.trim().length > 0) {
              // 리뷰 내용이 실제 리뷰인지 확인 (너무 짧거나 메시지가 아닌지)
              const content = review.content.trim();
              if (content.length > 10 && !noReviewMessages.some(msg => content.includes(msg))) {
                // 별점 필터 적용
                if (currentRatingFilter && currentRatingFilter.length > 0) {
                  const reviewRating = review.rating ? review.rating.toString() : '';
                  if (!currentRatingFilter.includes(reviewRating)) {
                    console.log(`[리뷰 추출] 요소 ${i + 1}: 별점 필터에 의해 제외됨 (별점: ${reviewRating}, 필터: ${currentRatingFilter.join(', ')})`);
                    continue; // 필터에 맞지 않으면 건너뛰기
                  }
                }
                console.log(`[리뷰 추출] 요소 ${i + 1}: 리뷰 추출 성공 - 내용 길이: ${content.length}자, 별점: ${review.rating}`);
                reviews.push(review);
              } else {
                console.log(`[리뷰 추출] 요소 ${i + 1}: 리뷰 내용이 너무 짧거나 메시지로 판단됨 (${content.length}자)`);
              }
            } else {
              // extractReviewData 내부에서 이미 경고 로그를 출력하므로 여기서는 간단히만 로그
              if (i < 3) { // 처음 3개만 상세 로그
                console.debug(`[리뷰 추출] 요소 ${i + 1}: 리뷰 데이터 추출 실패 - 내용 없음`);
                console.debug(`[리뷰 추출] 요소 ${i + 1} HTML 일부:`, element.innerHTML.substring(0, 300));
              }
            }
          } catch (error) {
            console.error(`[리뷰 추출] 요소 ${i + 1} 처리 중 오류:`, error);
          }
        }

        console.log(`[리뷰 추출 완료] 총 ${reviews.length}개 리뷰 추출 성공`);

        // 리뷰를 찾지 못한 경우 상세 정보 출력 및 UI에 표시
        if (reviews.length === 0) {
          console.log('[리뷰 추출] 리뷰를 찾지 못했습니다. 디버깅 정보:');
          const sdpReview = document.querySelector('#sdpReview');
          let debugInfo = '리뷰를 찾지 못했습니다.\n';

          if (sdpReview) {
            console.log('[리뷰 추출] #sdpReview 섹션 존재, 내부 요소 수:', sdpReview.children.length);
            console.log('[리뷰 추출] #sdpReview 내부 HTML 일부:', sdpReview.innerHTML.substring(0, 1000));
            debugInfo += `#sdpReview 섹션 존재 (요소 ${sdpReview.children.length}개)\n`;
          } else {
            console.log('[리뷰 추출] #sdpReview 섹션을 찾을 수 없습니다.');
            debugInfo += '#sdpReview 섹션을 찾을 수 없습니다.\n';
          }

          // 페이지에 리뷰 관련 텍스트가 있는지 확인
          const pageText = document.body ? document.body.textContent || '' : '';
          const reviewKeywords = ['리뷰', '상품평', 'review', '평점', '별점'];
          const hasReviewKeywords = reviewKeywords.some(keyword => pageText.includes(keyword));
          console.log('[리뷰 추출] 페이지에 리뷰 관련 키워드 존재:', hasReviewKeywords);
          debugInfo += `리뷰 관련 키워드 존재: ${hasReviewKeywords}\n`;
          debugInfo += `발견된 리뷰 요소 수: ${reviewElements.length}개`;

          // UI에 디버깅 정보 표시
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
        console.error('[리뷰 추출] extractReviewsFromPage 오류:', error);
      }

      return reviews;
    }

    // 리뷰 데이터 추출
    function extractReviewData(element) {
      if (!element) {
        return null;
      }

      let content = '';
      let rating = '';
      let date = '';

      try {
        // 리뷰 내용 - 특정 CSS 선택자 사용 (요소 내에서 상대적으로 찾기)
        try {
          const contentEl = element.querySelector('div.twc-text-\\[14px\\]\\/\\[19px\\].twc-text-bluegray-900.twc-break-all');
          if (contentEl) {
            content = (contentEl.textContent || '').trim();
          }

          // 특정 선택자로 찾지 못한 경우 대체 방법 시도
          if (!content || content.length < 10) {
            // 더 일반적인 선택자들 시도
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
                  // 더 긴 내용을 우선 선택
                  if (candidateContent && candidateContent.length > content.length && candidateContent.length > 10) {
                    content = candidateContent;
                    console.debug(`[리뷰 데이터 추출] 대체 선택자로 내용 추출 성공: ${selector}, 길이: ${content.length}자`);
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }

          // 여전히 내용을 찾지 못한 경우, 요소의 직접 텍스트에서 추출 시도
          if (!content || content.length < 10) {
            const directText = (element.textContent || '').trim();
            // 평점과 날짜를 제외한 나머지 텍스트를 내용으로 사용
            // 평점은 보통 숫자나 별표, 날짜는 날짜 형식
            const lines = directText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            // 첫 번째와 마지막 줄은 보통 평점/날짜일 가능성이 높으므로 제외
            if (lines.length > 2) {
              // 중간 부분을 내용으로 사용
              const middleContent = lines.slice(1, -1).join(' ').trim();
              if (middleContent && middleContent.length > content.length && middleContent.length > 10) {
                content = middleContent;
                console.debug(`[리뷰 데이터 추출] 직접 텍스트에서 내용 추출 성공, 길이: ${content.length}자`);
              }
            } else if (directText.length > 20) {
              // 줄이 적으면 전체 텍스트 사용 (너무 짧지 않은 경우)
              content = directText;
              console.debug(`[리뷰 데이터 추출] 전체 텍스트를 내용으로 사용, 길이: ${content.length}자`);
            }
          }
        } catch (e) {
          console.debug('[리뷰 데이터 추출] content 선택자 오류:', e);
        }

        // 평점 - 특정 CSS 선택자 사용 (요소 내에서 상대적으로 찾기)
        try {
          const ratingEl = element.querySelector('div.twc-flex.twc-gap-\\[12px\\] > div.twc-flex.twc-flex-col.twc-gap-\\[6px\\] > div.twc-flex.twc-items-center.twc-gap-\\[6px\\] > div.twc-inline-flex.twc-items-center.twc-gap-\\[2px\\]');
          if (ratingEl) {
            // ratingEl 내부의 i 요소 개수를 세어서 별점으로 사용
            const starElements = ratingEl.querySelectorAll('i');
            if (starElements && starElements.length > 0) {
              rating = starElements.length.toString();
            } else {
              // i 요소가 없으면 aria-label에서 숫자 추출 시도
              const ariaLabel = ratingEl.getAttribute('aria-label') || '';
              let match = ariaLabel.match(/(\d+)/);
              if (match) {
                rating = match[1];
              } else {
                // class 이름에서 숫자 추출 시도
                const className = ratingEl.className || '';
                match = className.match(/(?:star|rating)[-_]?(\d+)/i);
                if (match) {
                  rating = match[1];
                } else {
                  // 텍스트에서 숫자 추출 시도
                  const text = ratingEl.textContent || '';
                  match = text.match(/(\d+)\s*(?:점|별|star|rating)/i);
                  if (match) {
                    rating = match[1];
                  }
                }
              }
            }
          }
        } catch (e) {
          console.debug('[리뷰 데이터 추출] rating 선택자 오류:', e);
        }

        // 날짜 - CSS 클래스 선택자 사용 (요소 내에서 상대적으로 찾기)
        try {
          const dateEl = element.querySelector('.twc-text-\\[14px\\]\\/\\[15px\\].twc-text-bluegray-700');
          if (dateEl) {
            // datetime 속성 우선
            date = dateEl.getAttribute('datetime') || '';
            if (date) {
              // ISO 형식에서 날짜만 추출
              const dateMatch = date.match(/(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                date = dateMatch[1];
              }
            } else {
              // 텍스트에서 날짜 추출
              const dateText = (dateEl.textContent || '').trim();
              if (dateText) {
                // YYYY-MM-DD 형식 찾기
                const dateMatch = dateText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
                if (dateMatch) {
                  date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
                } else {
                  // 다른 형식도 시도
                  date = dateText;
                }
              }
            }
          }
        } catch (e) {
          console.debug('[리뷰 데이터 추출] date 선택자 오류:', e);
        }
      } catch (error) {
        console.error('[리뷰 데이터 추출] extractReviewData 오류:', error);
      }

      const review = {
        content: content || '',
        rating: rating || '',
        date: date || new Date().toISOString().split('T')[0],
        originalTabId: currentOriginalTabId || null // originalTabId 추가
      };

      // 디버깅: 추출된 데이터 로그 (내용이 비어있을 때만)
      if (!content || content.length < 10) {
        const contentPreview = content ? (content.substring(0, 50) + (content.length > 50 ? '...' : '')) : '(비어있음)';
        console.warn(
          `[리뷰 데이터 추출] 리뷰 내용이 비어있거나 너무 짧음 - 내용: "${contentPreview}", 길이: ${content ? content.length : 0}자, 평점: ${rating || '(없음)'}, 날짜: ${date || '(없음)'}`
        );
      }

      return review;
    }

    // 중복 리뷰 확인 및 덮어쓰기 처리
    function isDuplicateReview(review, existingReviews) {
      const duplicateIndex = existingReviews.findIndex(existing =>
        existing.content === review.content
      );

      if (duplicateIndex !== -1) {
        // 중복 리뷰 발견 - 기존 것을 제거하고 새 것으로 교체 (덮어쓰기)
        console.log(`[중복 리뷰 처리] 중복 리뷰 발견, 기존 항목을 새 것으로 교체합니다.`);
        existingReviews.splice(duplicateIndex, 1);
        return false; // 새 리뷰로 추가하도록 false 반환
      }

      return false; // 중복이 아니면 false 반환 (추가 가능)
    }

    // 다음 페이지로 이동
    async function goToNextPage() {
      return new Promise((resolve) => {
        // 페이지네이션 버튼 찾기
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
          // 숫자 버튼 찾기
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
          // 스크롤 없이 바로 클릭
          try {
            nextButton.click();
            console.log('[페이지네이션] 다음 페이지 버튼 클릭 완료');
            setTimeout(() => resolve(true), 3000); // 페이지 로드 대기
          } catch (clickError) {
            console.debug('[페이지네이션] 클릭 오류:', clickError);
            resolve(false);
          }
        } else {
          console.log('[페이지네이션] 다음 페이지 버튼을 찾을 수 없음');
          resolve(false);
        }
      });
    }

    // 현재 페이지 번호 가져오기
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

    // 유틸리티: 대기
    // 중단 가능한 sleep 함수
    function sleep(ms) {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const checkInterval = 100; // 100ms마다 체크

        const interval = setInterval(() => {
          // 중지 요청 확인
          if (stopScraping) {
            clearInterval(interval);
            resolve();
            return;
          }

          // 시간이 지났으면 종료
          if (Date.now() - startTime >= ms) {
            clearInterval(interval);
            resolve();
          }
        }, checkInterval);
      });
    }

  })(); // 즉시 실행 함수 종료
} // 중복 주입 방지 종료
