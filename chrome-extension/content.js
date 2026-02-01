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

// 네이버 등에서 scripting.executeScript로 재주입 시 중복 선언 방지 (IIFE로 감싸서 return 가능하게)
(function () {
  if (typeof window !== 'undefined' && window.__coupangReviewContentLoaded) return;
  window.__coupangReviewContentLoaded = true;

// ==================== 전역 변수 ====================
let isScraping = false;
let stopScraping = false;
let currentOriginalTabId = null;
let currentCollectedReviews = [];
let currentRatingFilter = 'all';
let targetProductId = null;
let targetUrl = null;
let currentStage = 'idle';
/** 수집 시작 시점에 읽어 둔 제품명 (다운로드 파일명용, 새로 고침 후에도 storage에 저장됨) */
let cachedProductName = '';
// CDP(debug-click)는 환경(다른 확장/보안정책)에 따라 콘솔 에러가 발생할 수 있어 기본은 끔.
// 필요 시 true로 바꾸면 CDP click을 우선 시도합니다.
const ENABLE_CDP_CLICK = false;
// CDP(debug-click) 실패가 반복될 때 콘솔 lastError 스팸 방지를 위해 런타임 중 자동 비활성화
let cdpClickDisabled = !ENABLE_CDP_CLICK;

// ==================== 상수 정의 ====================
const CONSTANTS = {
  // 대기 시간 (ms)
  WAIT_TIMES: {
    // 전체 대기시간 단축(빠른 모드)
    SHORT: 100,
    MEDIUM: 150,
    LONG: 200,
    // readyState/DOM 준비 확인용 (짧게)
    PAGE_LOAD: 500,
    // window.load 대기(하드 타임아웃)
    PAGE_LOAD_HARD: 1000,
    // 리뷰 섹션(#sdpReview) 대기 최대시간
    REVIEWS_SECTION: 1000,
    // 페이지 이동 감지 폴링 최대시간
    PAGE_MOVE_POLL_TIMEOUT: 2000,
    // 필터 적용 후 추가 대기
    FILTER_APPLY: 120,
    // 페이지 이동 후 필터 드롭다운 렌더링 대기 (300ms로 증가)
    FILTER_DROPDOWN_RENDER: 300,
    // 페이지/블록 이동 후 추가 안정화 대기 (0이면 추가 대기 없음)
    AFTER_PAGE_NAVIGATION: 0,
    AFTER_BLOCK_NAVIGATION: 0
  },
  // 최대 재시도 횟수
  MAX_RETRIES: {
    PAGE_ELEMENTS: 3,
    CONSECUTIVE_FAILURES: 3,
    PING: 10
  },
  // 페이지네이션
  PAGINATION: {
    START_BUTTON_INDEX: 3,
    MAX_BUTTON_INDEX: 12
  },
  // 리뷰 추출 조건
  REVIEW: {
    MIN_CONTENT_LENGTH: 10,
    MAX_CONTENT_LENGTH: 15000,
    MIN_ELEMENT_TEXT_LENGTH: 10,
    MAX_ELEMENT_TEXT_LENGTH: 5000,
    MIN_REVIEW_ELEMENTS: 5,
    // 수집 개수 제한: null = 무제한, 숫자면 해당 개수에서 수집 중단 (제한 해제 = null)
    MAX_COLLECTION_REVIEWS: null
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

// 사이트 감지 (content script가 주입된 페이지 기준)
const SITE_HREF = typeof window !== 'undefined' && window.location ? (window.location.href || '') : '';
const isCoupang = /coupang\.com/.test(SITE_HREF) && (/\/vp\/products\//.test(SITE_HREF) || /\/products\//.test(SITE_HREF));
const isNaverSmart = /smartstore\.naver\.com/.test(SITE_HREF) && /\/products\//.test(SITE_HREF);
const isNaverBrand = /brand\.naver\.com/.test(SITE_HREF) && /\/products\//.test(SITE_HREF);
const isNaver = isNaverSmart || isNaverBrand;

// 사이트별 셀렉터 (스마트스토어: HTT4L8U0CU/L2CTE05CX2, 브랜드스토어: JHZoCyHfg7, 공통 ul RR2FSL9wTc)
const SITE_SELECTORS = {
  coupang: {},
  naver: {
    reviewSection: 'div[class*="HTT4L8U0CU"]',
    reviewList: 'ul[class*="RR2FSL9wTc"]',
    reviewCard: 'ul[class*="RR2FSL9wTc"] > li, div[class*="HTT4L8U0CU"] li',
    pagination: 'div[class*="L2CTE05CX2"]',
    nextPage: 'div[class*="L2CTE05CX2"] a'
  },
  naverSmart: {
    reviewSection: 'div[class*="HTT4L8U0CU"]',
    reviewList: 'ul[class*="RR2FSL9wTc"]',
    reviewCard: 'ul[class*="RR2FSL9wTc"] > li[class]',
    pagination: 'div[class*="L2CTE05CX2"]',
    nextPage: 'div[class*="L2CTE05CX2"] a'
  },
  naverBrand: {
    reviewSection: 'div[class*="JHZoCyHfg7"]',
    reviewList: 'ul[class*="RR2FSL9wTc"]',
    reviewCard: 'ul[class*="RR2FSL9wTc"] > li, div[class*="JHZoCyHfg7"] li',
    rating: 'span[class*="_rvQSUB5wU"], span[class*="t7PPhhAQtT"]',
    authorDate: 'div[class*="Db9Dtnf7gY"]',
    author: 'strong[class*="MX91DFZo2F"]',
    date: 'span[class*="MX91DFZo2F"]',
    content: 'div[class*="HakaEZ240l"]',
    contentInner: 'div[class*="KqJ8Qqw082"] span[class*="rnrf6Xo7x2"], span[class*="MX91DFZo2F"]',
    nextPage: 'a[data-shp-area="revlist.pgn"], a[class*="JY2WGJ4hXh"]'
  }
};

/**
 * 현재 페이지에서 제품명 추출 (다운로드 파일명용)
 * @returns {string}
 */
function getProductNameFromPage() {
  try {
    if (isNaver) {
      const t = document.title || '';
      const cleaned = t
        .replace(/\s*[-|:]\s*네이버\s*스마트스토어\s*$/i, '')
        .replace(/\s*[-|:]\s*NAVER\s*SMARTSTORE\s*$/i, '')
        .replace(/\s*[-|:]\s*네이버\s*브랜드스토어\s*$/i, '')
        .replace(/\s*[-|:]\s*NAVER\s*BRAND(STORE)?\s*$/i, '')
        .trim();
      if (cleaned) return cleaned.substring(0, 100);
      return (document.title || '').substring(0, 100);
    }
    // 쿠팡 상품 페이지 제품명
    const selectors = ['h1.product-title', '.product-title', '[class*="product-title"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) return text.replace(/\s+/g, ' ').substring(0, 100);
      }
    }
    const t = document.title || '';
    const cleaned = t
      .replace(/\s*[-|:]\s*쿠팡!?\s*$/i, '')
      .replace(/\s*[-|:]\s*Coupang\s*$/i, '')
      .trim();
    if (cleaned) return cleaned.substring(0, 100);
  } catch (e) { }
  return '';
}

function sendToUI(message) {
  if (message.action === 'progress' || message.action === 'stopped' || message.action === 'startScraping' || message.action === 'complete') {
    try {
      window.postMessage({
        type: 'COUPANG_REVIEW_COLLECTOR',
        data: message
      }, '*');
    } catch (error) {
    }
  }
}

// 전역 안전 전송 헬퍼 (outer scope) - actionLog 등 초기 구간에서 사용
function safeSendMessage(message, callback) {
  try {
    return chrome.runtime.sendMessage(message, callback);
  } catch (e) {
    return Promise.resolve(null);
  }
}

function actionLog(message, type = 'info') {
  safeSendMessage({
    action: 'log',
    message,
    type,
    originalTabId: currentOriginalTabId
  });
}

// 내부용: 비동기/예외 무시 로그 (goToNextPage 등에서 사용)
function logToBackground(message, type = 'info') {
  try {
    chrome.runtime.sendMessage({ action: 'log', message, type, originalTabId: currentOriginalTabId });
  } catch (e) { }
}

// 디버그 로그 (NDJSON) - 필요 시 끌 수 있도록 단일 헬퍼로 관리
function debugLog(message, data = {}, hypothesisId = 'H?') {
  // #region agent log
  const payload = {
    sessionId: 'debug-session',
    runId: 'pre-fix-3',
    hypothesisId,
    location: 'content.js',
    message,
    data,
    timestamp: Date.now()
  };
  try {
    chrome.runtime.sendMessage({ action: 'agent-log', payload }).catch(() => { });
  } catch (e) { }
  // #endregion
}

function setStage(stage, data = {}) {
  currentStage = stage;
  debugLog('stage', { stage, ...data }, 'STAGE');
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
        originalTabId: currentOriginalTabId,
        productName: cachedProductName || getProductNameFromPage(),
        source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
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

// 전역 에러/미처리 예외 로깅
window.addEventListener('error', (e) => {
  debugLog('window error', {
    message: e?.message || (e?.error && e.error.message) || '',
    filename: e?.filename || '',
    lineno: e?.lineno || 0,
    colno: e?.colno || 0,
    errorName: e?.error && e.error.name,
    errorMessage: e?.error && e.error.message,
    errorToString: e?.error ? String(e.error) : '',
    targetTag: e?.target && e.target.tagName,
    type: e?.type,
    stage: currentStage,
    stack: e?.error && e.error.stack ? String(e.error.stack).substring(0, 800) : ''
  }, 'ERR');
}, true);

window.addEventListener('unhandledrejection', (e) => {
  debugLog('unhandled rejection', {
    reason: e?.reason ? String(e.reason) : '',
    stage: currentStage,
    stack: e?.reason && e.reason.stack ? String(e.reason.stack).substring(0, 800) : ''
  }, 'ERR');
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
            stopped: request.stopped || false,
            showNotificationOnly: request.showNotificationOnly
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
          debugLog('startScraping received', { url: request.url, ratingFilter: request.ratingFilter, ratingFilters: request.ratingFilters || [] }, 'H1');
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

          // 여러 필터가 있는 경우 순차 처리, 없으면 단일 필터 처리
          if (request.ratingFilters && Array.isArray(request.ratingFilters) && request.ratingFilters.length > 1) {
            startMultiFilterScraping(request.url, request.ratingFilters)
              .then(result => {
                debugLog('startMultiFilterScraping resolved', { filters: request.ratingFilters, resultSummary: { reviews: result?.reviews?.length, stopped: result?.stopped } }, 'H0');
              })
              .catch(error => {
                debugLog('startMultiFilterScraping rejected', { filters: request.ratingFilters, msg: error?.message || String(error) }, 'ERR');
              });
          } else {
            const ratingFilter = request.ratingFilters && request.ratingFilters.length > 0
              ? request.ratingFilters[0]
              : (request.ratingFilter || 'all');
            startScraping(request.url, ratingFilter)
              .then(result => {
                debugLog('startScraping resolved', { rating: ratingFilter, resultSummary: { reviews: result?.reviews?.length, stopped: result?.stopped } }, 'H0');
              })
              .catch(error => {
                debugLog('startScraping rejected', { rating: ratingFilter, msg: error?.message || String(error) }, 'ERR');
              });
          }

          return true;
        } else if (request.action === 'stopScraping') {
          stopScraping = true;
          isScraping = false;

          const finalReviews = currentCollectedReviews.length > 0 ? currentCollectedReviews : [];
          safeSendMessage({
            action: 'stopped',
            message: `수집이 중지되었습니다. (현재까지 ${finalReviews.length}개 수집됨)`,
            reviews: finalReviews,
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
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
        } else if (request.action === 'getProductName') {
          try {
            const name = getProductNameFromPage();
            sendResponse({ productName: name || '' });
          } catch (e) {
            sendResponse({ productName: '' });
          }
          return true;
        }

        return false;
      });
    }

    /**
     * 여러 필터를 순차적으로 처리하는 함수
     * @param {string} url - 상품 URL
     * @param {Array<string>} ratingFilters - 별점 필터 배열
     * @returns {Promise<Object>}
     */
    async function startMultiFilterScraping(url, ratingFilters) {
      if (isNaver) {
        return startScraping(url, 'all');
      }
      const allCollectedReviews = [];
      const ratingNames = {
        'all': '모든 별점',
        '5': '최고(5)',
        '4': '좋음(4)',
        '3': '보통(3)',
        '2': '별로(2)',
        '1': '나쁨(1)'
      };

      try {
        // 페이지 준비 (한 번만)
        await waitForPageReady();
        actionLog(`멀티 필터 수집 시작 (${ratingFilters.join(',')})`);
        const currentUrl = window.location.href;
        const targetUrl = url.trim();
        const extractedProductId = targetUrl.match(/\/products\/(\d+)/)?.[1];
        targetProductId = extractedProductId;

        const currentProductId = currentUrl.match(/\/products\/(\d+)/)?.[1];
        const targetProductIdFromUrl = targetUrl.match(/\/products\/(\d+)/)?.[1];

        const isProductPage = currentUrl.includes('/vp/products/') || currentUrl.includes('/products/');
        const productIdMatches = currentProductId && targetProductIdFromUrl && currentProductId === targetProductIdFromUrl;

        if (!isProductPage || !productIdMatches) {
          safeSendMessage({
            action: 'log',
            message: `올바른 상품 페이지로 이동합니다...`,
            type: 'info',
            originalTabId: currentOriginalTabId
          });
          window.location.href = targetUrl;
          await waitForPageLoad();
          await waitForPageReady();
        }

        await waitForPageReady();
        debugLog('waitForPageReady done', { step: 'initial' }, 'H1');
        cachedProductName = getProductNameFromPage();
        setTimeout(() => { cachedProductName = getProductNameFromPage() || cachedProductName; }, 800);
        safeSendMessage({
          action: 'log',
          message: '리뷰 탭을 찾고 클릭합니다...',
          type: 'info',
          originalTabId: currentOriginalTabId
        });
        actionLog('리뷰 탭 클릭 시도');
        await clickReviewTab();
        await waitForReviewsSection();
        await sleep(300);

        // 각 필터별로 순차 처리
        for (let i = 0; i < ratingFilters.length; i++) {
          if (stopScraping) {
            throw new Error('수집이 중지되었습니다.');
          }

          const ratingFilter = ratingFilters[i];
          const ratingName = ratingNames[ratingFilter] || ratingFilter;

          safeSendMessage({
            action: 'log',
            message: `${ratingName} 필터링 후 리뷰 수집 시작... (${i + 1}/${ratingFilters.length})`,
            type: 'info',
            originalTabId: currentOriginalTabId
          });

          // 필터 적용
          if (ratingFilter && ratingFilter !== 'all') {
            safeSendMessage({
              action: 'log',
              message: `별점 필터 적용 중: ${ratingFilter}점`,
              type: 'info',
              originalTabId: currentOriginalTabId
            });
            actionLog(`필터 적용 시도: ${ratingFilter}점`);
            const filterApplied = await clickRatingFilter(ratingFilter);
            if (filterApplied) {
              safeSendMessage({
                action: 'log',
                message: `별점 필터 적용 완료: ${ratingFilter}점`,
                type: 'success',
                originalTabId: currentOriginalTabId
              });
              actionLog(`필터 적용 완료: ${ratingFilter}점`);
              await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
              await waitForPageReady();
              await waitForReviewsSection();
              await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
            }
            if (stopScraping) {
              throw new Error('수집이 중지되었습니다.');
            }
          }

          // 리뷰 수집
          currentRatingFilter = ratingFilter;
          isScraping = true;
          currentCollectedReviews = [];

          // 멀티 필터 진행률 계산: 각 필터는 전체의 일정 비율을 차지
          const filterProgress = Math.floor(((i + 1) / ratingFilters.length) * 90); // 90%까지는 필터별 진행률
          const progressMsg = { action: 'progress', percent: filterProgress, text: `${ratingName} 필터링 후 리뷰 수집 중... (${i + 1}/${ratingFilters.length})`, originalTabId: currentOriginalTabId };
          safeSendMessage(progressMsg);
          sendToUI(progressMsg);

          const reviews = await collectAllReviews();
          actionLog(`필터 ${ratingFilter} 수집 완료: ${reviews.length}개`);

          // 수집된 리뷰에 필터 정보 추가
          const reviewsWithFilter = reviews.map(review => ({
            ...review,
            filterRating: ratingFilter
          }));

          allCollectedReviews.push(...reviewsWithFilter);
          currentCollectedReviews = allCollectedReviews;

          safeSendMessage({
            action: 'log',
            message: `${ratingName} 필터링 후 리뷰 수집 완료: ${reviews.length}개 (누적: ${allCollectedReviews.length}개)`,
            type: 'success',
            originalTabId: currentOriginalTabId
          });

          // 마지막 필터가 아니면 다음 필터로 넘어가기 전 대기
          if (i < ratingFilters.length - 1) {
            await sleep(500);
          }
        }

        // 모든 필터 수집 완료
        safeSendMessage({
          action: 'log',
          message: `모든 필터 수집 완료: 총 ${allCollectedReviews.length}개 리뷰 수집됨`,
          type: 'success',
          originalTabId: currentOriginalTabId
        });
        actionLog(`멀티 필터 종료: 총 ${allCollectedReviews.length}개`);

        // 프로그레스바를 100%로 업데이트
        const completeProgressMsg = { action: 'progress', percent: 100, text: `수집 완료: 총 ${allCollectedReviews.length}개 리뷰`, originalTabId: currentOriginalTabId };
        safeSendMessage(completeProgressMsg);
        sendToUI(completeProgressMsg);

        safeSendMessage({
          action: 'complete',
          reviews: allCollectedReviews,
          stopped: false,
          originalTabId: currentOriginalTabId,
          closeTab: true, // 페이지 닫기 플래그
          productName: cachedProductName || getProductNameFromPage(),
          source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
        });

        isScraping = false;

        // 페이지 닫기
        setTimeout(() => {
          window.close();
        }, 1000);

        return { reviews: allCollectedReviews, stopped: false };
      } catch (error) {
        isScraping = false;
        const errorMessage = error instanceof DOMException
          ? `DOM 오류: ${error.name} - ${error.message || '알 수 없는 DOM 오류'}`
          : error.message || String(error);
        debugLog('startScraping error', { msg: errorMessage }, 'H1');

        safeSendMessage({
          action: 'error',
          error: errorMessage,
          originalTabId: currentOriginalTabId
        });

        // 에러 발생 시에도 수집된 리뷰 전송
        if (allCollectedReviews.length > 0) {
          safeSendMessage({
            action: 'stopped',
            message: `오류 발생: ${errorMessage} (현재까지 ${allCollectedReviews.length}개 수집됨)`,
            reviews: allCollectedReviews,
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
          });
        }

        throw new Error(errorMessage);
      }
    }

    async function startScraping(url, ratingFilter = 'all') {
      debugLog('startScraping invoked pre-check', { url, ratingFilter, isScraping, stopScraping }, 'H0');
      setStage('startScraping invoked', { url, ratingFilter, isScraping, stopScraping });
      if (isScraping) {
        throw new Error('이미 수집 중입니다.');
      }

      isScraping = true;
      stopScraping = false;
      cachedProductName = '';
      currentCollectedReviews = [];
      currentRatingFilter = ratingFilter;
      targetUrl = url.trim();
      const extractedProductId = targetUrl.match(/\/products\/(\d+)/)?.[1];
      targetProductId = extractedProductId;
      const sendMsg = (typeof safeSendMessage === 'function')
        ? safeSendMessage
        : (message, callback) => {
          try {
            return chrome.runtime.sendMessage(message, callback);
          } catch (e) {
            return Promise.resolve(null);
          }
        };

      try {
        setStage('startScraping enter', { url: targetUrl, rating: ratingFilter });
        await waitForPageReady();
        setStage('after waitForPageReady start', { readyState: document.readyState, url: window.location.href });
        cachedProductName = getProductNameFromPage();
        setTimeout(() => { cachedProductName = getProductNameFromPage() || cachedProductName; }, 800);
        actionLog(`단일 수집 시작 rating=${ratingFilter}`);
        setStage('after actionLog start', { rating: ratingFilter });

        try {
          try {
            const currentUrl = window.location.href;

            sendMsg({
              action: 'log',
              message: `현재 URL: ${currentUrl}`,
              type: 'info',
              originalTabId: currentOriginalTabId
            });
            sendMsg({
              action: 'log',
              message: `목표 URL: ${targetUrl}`,
              type: 'info',
              originalTabId: currentOriginalTabId
            });
            debugLog('url info sent', { currentUrl, targetUrl }, 'H1');
            let currentProductId = null;
            let targetProductId = null;
            try {
              currentProductId = currentUrl.match(/\/products\/(\d+)/)?.[1];
            } catch (e) {
            }
            try {
              targetProductId = targetUrl.match(/\/products\/(\d+)/)?.[1];
            } catch (e) {
            }

            const isProductPage = isNaver
              ? ((currentUrl.includes('smartstore.naver.com') || currentUrl.includes('brand.naver.com')) && currentUrl.includes('/products/'))
              : (currentUrl.includes('/vp/products/') || currentUrl.includes('/products/'));
            const productIdMatches = currentProductId && targetProductId && currentProductId === targetProductId;

            const urlMatches = currentUrl === targetUrl ||
              currentUrl.replace(/\/$/, '') === targetUrl.replace(/\/$/, '') ||
              productIdMatches;
            setStage('url match result', { currentUrl, targetUrl, isProductPage, productIdMatches, urlMatches });

            if (urlMatches && isProductPage) {
              debugLog('stay on page (url ok)', { currentUrl, targetUrl }, 'H1');
            } else if (!isProductPage || !productIdMatches) {
              debugLog('navigate to targetUrl', { currentUrl, targetUrl, isProductPage, productIdMatches }, 'H1');
              sendMsg({
                action: 'log',
                message: `올바른 상품 페이지로 이동합니다... (현재 상품 ID: ${currentProductId || '없음'}, 목표 상품 ID: ${targetProductId || '없음'})`,
                type: 'info',
                originalTabId: currentOriginalTabId
              });
              window.location.href = targetUrl;
              await waitForPageLoad();
              await waitForPageReady();
              setStage('after navigation wait', { url: window.location.href });
              debugLog('after navigation wait', { url: window.location.href }, 'H1');
            } else {
              debugLog('stay on page (ids match)', { currentProductId, targetProductId }, 'H1');
              sendMsg({
                action: 'log',
                message: `이미 올바른 상품 페이지에 있습니다. (상품 ID: ${currentProductId})`,
                type: 'info',
                originalTabId: currentOriginalTabId
              });
            }
          } catch (fatalBlock) {
            debugLog('fatal in url/product block', {
              msg: fatalBlock?.message || String(fatalBlock),
              stack: fatalBlock?.stack ? String(fatalBlock.stack).substring(0, 500) : ''
            }, 'ERR');
          }
        } catch (fatalEarly) {
          debugLog('fatal before clickReviewTab', {
            msg: fatalEarly?.message || String(fatalEarly),
            stack: fatalEarly?.stack ? String(fatalEarly.stack).substring(0, 500) : ''
          }, 'ERR');
        }

        await waitForPageReady();
        setStage('before clickReviewTab', { rating: ratingFilter });
        debugLog('before clickReviewTab', { rating: ratingFilter }, 'H3');
        sendMsg({
          action: 'log',
          message: '리뷰 탭을 찾고 클릭합니다...',
          type: 'info',
          originalTabId: currentOriginalTabId
        });
        debugLog('clickReviewTab start', { rating: ratingFilter }, 'H3');
        actionLog('리뷰 탭 클릭 시도');
        try {
          await clickReviewTab();
        } catch (errClick) {
          debugLog('clickReviewTab error', {
            msg: errClick?.message || String(errClick),
            stack: errClick?.stack ? String(errClick.stack).substring(0, 500) : ''
          }, 'ERR');
          throw errClick;
        }
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }
        sendMsg({
          action: 'log',
          message: '리뷰 탭 클릭 완료',
          type: 'success',
          originalTabId: currentOriginalTabId
        });
        debugLog('clickReviewTab done', { rating: ratingFilter }, 'H3');
        await waitForReviewsSection();
        debugLog('after waitForReviewsSection', { rating: ratingFilter }, 'H3');
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }
        await sleep(300);
        if (stopScraping) {
          throw new Error('수집이 중지되었습니다.');
        }

        if (!isNaver && ratingFilter && ratingFilter !== 'all') {
          sendMsg({
            action: 'log',
            message: `별점 필터 적용 중: ${ratingFilter}점`,
            type: 'info',
            originalTabId: currentOriginalTabId
          });
          actionLog(`필터 적용 시도: ${ratingFilter}점`);
          debugLog('filter apply start', { rating: ratingFilter }, 'H4');
          try {
            const filterApplied = await clickRatingFilter(ratingFilter);
            if (filterApplied) {
              sendMsg({
                action: 'log',
                message: `별점 필터 적용 완료: ${ratingFilter}점 - 필터링된 리뷰만 수집합니다.`,
                type: 'success',
                originalTabId: currentOriginalTabId
              });
              actionLog(`필터 적용 완료: ${ratingFilter}점`);
              debugLog('filter apply done', { rating: ratingFilter }, 'H4');
              // 필터 적용 후 페이지 업데이트 대기
              await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
              await waitForPageReady();
              await waitForReviewsSection();
              await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
            } else {
              sendMsg({
                action: 'log',
                message: '별점 필터를 찾을 수 없습니다. 모든 리뷰를 수집합니다.',
                type: 'warning',
                originalTabId: currentOriginalTabId
              });
            }
          } catch (errFilter) {
            debugLog('filter apply error', {
              msg: errFilter?.message || String(errFilter),
              stack: errFilter?.stack ? String(errFilter.stack).substring(0, 500) : ''
            }, 'ERR');
            throw errFilter;
          }
          if (stopScraping) {
            throw new Error('수집이 중지되었습니다.');
          }
        }
        debugLog('filter branch completed', { rating: ratingFilter }, 'H4');

        sendMsg({
          action: 'log',
          message: '리뷰 수집을 시작합니다...',
          type: 'info',
          originalTabId: currentOriginalTabId
        });
        const prepMsg = { action: 'progress', percent: 5, text: '리뷰 수집 준비 중...', originalTabId: currentOriginalTabId };
        sendMsg(prepMsg);
        sendToUI(prepMsg);
        debugLog('collectAllReviews call', { rating: ratingFilter }, 'H2');
        const allReviews = await collectAllReviews();
        debugLog('collectAllReviews done', { rating: ratingFilter, count: allReviews.length }, 'H2');
        actionLog(`단일 필터 종료: 총 ${allReviews.length}개`);
        currentCollectedReviews = allReviews;
        sendMsg({
          action: 'log',
          message: `리뷰 수집 완료: 총 ${allReviews.length}개 리뷰 수집됨`,
          type: 'success',
          originalTabId: currentOriginalTabId
        });
        if (allReviews.length === 0) {
          const errorMsg = '리뷰를 찾을 수 없습니다. 리뷰 추출을 종료합니다.';
          sendMsg({
            action: 'log',
            message: '리뷰를 찾지 못했습니다.',
            type: 'warning'
          });
          sendMsg({
            action: 'log',
            message: '리뷰 추출을 종료합니다.',
            type: 'warning'
          });

          sendMsg({
            action: 'stopped',
            message: errorMsg,
            reviews: [],
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
          }).then(() => {
          }).catch(err => {
          });

          isScraping = false;
          return { reviews: [], stopped: true };
        }

        const isStopped = stopScraping;
        currentCollectedReviews = allReviews;

        if (isStopped) {
          sendMsg({
            action: 'stopped',
            message: `수집이 중지되었습니다. (현재까지 ${allReviews.length}개 수집됨)`,
            reviews: allReviews,
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
          });
        } else {
          // 프로그레스바를 100%로 업데이트
          const doneMsg = { action: 'progress', percent: 100, text: `수집 완료: 총 ${allReviews.length}개 리뷰`, originalTabId: currentOriginalTabId };
          sendMsg(doneMsg);
          sendToUI(doneMsg);

          sendMsg({
            action: 'complete',
            reviews: allReviews,
            stopped: false,
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
          });
        }

        isScraping = false;
        return { reviews: allReviews, stopped: isStopped };
      } catch (error) {
        isScraping = false;
        const errorMessage = error instanceof DOMException
          ? `DOM 오류: ${error.name} - ${error.message || '알 수 없는 DOM 오류'}`
          : error.message || String(error);

        sendMsg({
          action: 'error',
          error: errorMessage,
          originalTabId: currentOriginalTabId
        }).then(() => {
        }).catch(err => {
        });
        throw new Error(errorMessage);
      } finally {
        setStage('startScraping finally', { isScraping, stopScraping });
        isScraping = false;
        stopScraping = false;
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

          // 타임아웃 설정 (상수: PAGE_LOAD_HARD)
          setTimeout(() => {
            window.removeEventListener('load', handler);
            resolve();
          }, CONSTANTS.WAIT_TIMES.PAGE_LOAD_HARD);
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

        if (isNaver) {
          const sectionSel = isNaverBrand ? 'div[class*="JHZoCyHfg7"]' : 'div[class*="HTT4L8U0CU"]';
          const naverReviewEl = document.querySelector(sectionSel) || document.querySelector('ul[class*="RR2FSL9wTc"]');
          if (naverReviewEl) {
            resolve();
            return;
          }
          let observer = null;
          const maxWaitTime = CONSTANTS.WAIT_TIMES.REVIEWS_SECTION;
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
            const el = document.querySelector(sectionSel) || document.querySelector('ul[class*="RR2FSL9wTc"]');
            if (el) {
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
            observer.observe(document.body, { childList: true, subtree: true });
          }
          const interval = setInterval(() => {
            checkSection();
            if (Date.now() - startTime >= maxWaitTime) {
              clearInterval(interval);
              cleanup();
              resolve();
            }
          }, checkInterval);
          return;
        }

        const sdpReview = safeQuerySelector('#sdpReview');
        if (sdpReview && sdpReview.children.length > 0) {
          resolve();
          return;
        }

        let observer = null;
        const maxWaitTime = CONSTANTS.WAIT_TIMES.REVIEWS_SECTION;
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
        if (isNaver) {
          (async () => {
            try {
              let toClick = null;
              if (isNaverSmart) {
                const smartStoreTabSelector = 'a[data-name="REVIEW"][data-shp-area="tab.select"]';
                const maxWaitMs = 15000;
                const pollIntervalMs = 350;
                let waited = 0;
                while (waited < maxWaitMs && !stopScraping) {
                  const el = document.querySelector(smartStoreTabSelector);
                  if (el && (el.offsetParent !== null || el.getBoundingClientRect().height > 0)) {
                    toClick = el;
                    break;
                  }
                  await sleep(pollIntervalMs);
                  waited += pollIntervalMs;
                }
                if (!toClick) {
                  const smartStoreReviewTabSelectors = [
                    'a[data-name="REVIEW"][data-shp-area="tab.select"][role="menuitem"]',
                    'a[href="#"][data-name="REVIEW"][data-shp-area="tab.select"]'
                  ];
                  for (const sel of smartStoreReviewTabSelectors) {
                    const el = document.querySelector(sel);
                    if (el && (el.offsetParent !== null || el.getBoundingClientRect().height > 0)) {
                      toClick = el;
                      break;
                    }
                  }
                }
                if (!toClick) {
                  const menubar = document.querySelector('ul[class*="ercOWA57kn"][role="menubar"]') || document.querySelector('ul.ercOWA57kn') || document.querySelector('ul[role="menubar"]');
                  if (menubar) {
                    menubar.scrollIntoView({ block: 'center', behavior: 'smooth' }).catch(() => {});
                    await sleep(400);
                    const lis = menubar.querySelectorAll('li[class*="yg0fOdRhWZ"], li.yg0fOdRhWZ, li');
                    for (const li of lis) {
                      const a = li.querySelector('a[data-name="REVIEW"]');
                      if (a && (li.offsetParent !== null || a.offsetParent !== null)) {
                        toClick = a;
                        break;
                      }
                    }
                  }
                }
                if (!toClick) {
                  const byDataName = document.querySelectorAll('a[data-name="REVIEW"]');
                  for (const el of byDataName) {
                    if (el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true') {
                      toClick = el;
                      break;
                    }
                  }
                }
                if (!toClick) {
                  const reviewTabSelectors = [
                    'a[data-shp-area="tab.select"][data-name="REVIEW"]',
                    'li a[data-name="REVIEW"]',
                    'li.yg0fOdRhWZ a',
                    'li[role="presentation"] a[href="#"]',
                    '[role="tab"]'
                  ];
                  for (const sel of reviewTabSelectors) {
                    const els = document.querySelectorAll(sel);
                    for (const el of els) {
                      const text = (el.textContent || '').trim();
                      if ((text === '리뷰' || text === 'REVIEW' || text.startsWith('리뷰')) && el.offsetParent !== null) {
                        toClick = el;
                        break;
                      }
                    }
                    if (toClick) break;
                  }
                }
                if (!toClick) {
                  const allLinks = document.querySelectorAll('a[href="#"], a[role="tab"], li a, button');
                  for (const a of allLinks) {
                    const text = (a.textContent || '').trim();
                    if ((text === '리뷰' || text.startsWith('리뷰')) && a.offsetParent !== null) {
                      toClick = a;
                      break;
                    }
                  }
                }
              }
              if (!toClick && !isNaverSmart) {
                const byDataName = document.querySelectorAll('a[data-name="REVIEW"]');
                for (const el of byDataName) {
                  if (el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true') {
                    toClick = el;
                    break;
                  }
                }
              }
              if (!toClick && isNaver) {
                const reviewTabSelectors = [
                  'li a[data-name="REVIEW"]',
                  'li.yg0fOdRhWZ a',
                  'a[data-shp-area="tab.select"][data-name="REVIEW"]',
                  'li[role="presentation"] a[href="#"]'
                ];
                for (const sel of reviewTabSelectors) {
                  const els = document.querySelectorAll(sel);
                  for (const el of els) {
                    const text = (el.textContent || '').trim();
                    if ((text === '리뷰' || text.startsWith('리뷰')) && el.offsetParent !== null) {
                      toClick = el;
                      break;
                    }
                  }
                  if (toClick) break;
                }
              }
              if (!toClick && isNaver) {
                const allLinks = document.querySelectorAll('li a, a[href="#"]');
                for (const a of allLinks) {
                  const text = (a.textContent || '').trim();
                  if ((text === '리뷰' || text.startsWith('리뷰')) && a.offsetParent !== null) {
                    toClick = a;
                    break;
                  }
                }
              }
              if (toClick) {
                toClick.scrollIntoView({ block: 'center', behavior: 'smooth' }).catch(() => {});
                await sleep(400);
                toClick.focus?.();
                toClick.click();
                await sleep(500);
                await new Promise(r => setTimeout(r, 500));
                if (isNaverSmart) {
                  const sectionSelector = 'div[class*="HTT4L8U0CU"], ul[class*="RR2FSL9wTc"]';
                  let sectionEl = document.querySelector(sectionSelector);
                  let sectionWaited = 0;
                  const sectionMaxWaitMs = 8000;
                  while (!sectionEl && sectionWaited < sectionMaxWaitMs && !stopScraping) {
                    await sleep(400);
                    sectionWaited += 400;
                    sectionEl = document.querySelector(sectionSelector);
                  }
                  if (sectionEl) {
                    sectionEl.scrollIntoView({ block: 'start', behavior: 'smooth' }).catch(() => {});
                    await sleep(500);
                  }
                }
              }
            } catch (e) { }
            resolve();
          })();
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

    function findRatingFilterDropdown() {
      const filterSelector = '#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div.twc-flex.max-md\\:twc-flex-wrap.twc-items-center.twc-gap-y-\\[12px\\] > div.twc-flex.twc-items-center.twc-justify-between.twc-gap-\\[8px\\].twc-w-full.twc-h-\\[40px\\].twc-px-\\[14px\\].twc-border.twc-border-bluegray-300.twc-rounded-\\[4px\\].twc-bg-white.twc-cursor-pointer.desktop-hover\\:twc-bg-bluegray-800\\/20.active\\:twc-bg-bluegray-800\\/30.focus\\:twc-outline-none.twc-flex-\\[0_0_142px\\].twc-ml-\\[8px\\]';

      let filterDropdown = safeQuerySelector(filterSelector);

      if (!filterDropdown) {
        const alternativeSelectors = [
          '#sdpReview div[class*="cursor-pointer"][class*="border-bluegray-300"]',
          '#sdpReview div[class*="flex"][class*="items-center"][class*="border"]',
          '#sdpReview select',
          '#sdpReview button[class*="filter"]'
        ];

        for (const selector of alternativeSelectors) {
          const candidate = safeQuerySelector(selector);
          if (candidate && candidate.offsetParent !== null) {
            filterDropdown = candidate;
            break;
          }
        }
      }

      return filterDropdown;
    }

    function detectCurrentRatingFilterValue() {
      const dropdown = findRatingFilterDropdown();
      if (!dropdown) return null;

      const labelText = (safeGetText(dropdown) || '').replace(/\s+/g, ' ').trim();
      if (!labelText) return null;

      const detectionMap = {
        'all': ['모든', '전체'],
        '5': ['5점', '5 ', '최고', '★★★★★', '별 5'],
        '4': ['4점', '4 ', '좋음', '★★★★☆', '별 4'],
        '3': ['3점', '3 ', '보통', '★★★☆☆', '별 3'],
        '2': ['2점', '2 ', '별로', '★★☆☆☆', '별 2'],
        '1': ['1점', '1 ', '나쁨', '★☆☆☆☆', '별 1']
      };

      for (const [rating, terms] of Object.entries(detectionMap)) {
        for (const term of terms) {
          if (labelText.includes(term)) {
            return rating;
          }
        }
      }

      return null;
    }

    async function ensureRatingFilterApplied(ratingValue) {
      if (!ratingValue || ratingValue === 'all') return true;
      const active = detectCurrentRatingFilterValue();
      if (active === ratingValue) return true;
      const applied = await clickRatingFilter(ratingValue);
      return applied;
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

          let filterDropdown = findRatingFilterDropdown();

          if (!filterDropdown || filterDropdown.offsetParent === null) {
            resolve(false);
            return;
          }

          try {
            actionLog('필터 드롭다운 클릭');
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

    async function goToNextPageNaver() {
      try {
        if (isNaverBrand) {
          const paginationContainer = document.querySelector('div[class*="LiT9lKOVbw"][class*="q0sLM3XjRQ"]') ||
            document.querySelector('div[class*="LiT9lKOVbw"]');
          if (!paginationContainer) return false;
          const pageButtonCandidates = Array.from(paginationContainer.querySelectorAll('a[class*="hyY6CXtbcn"], div[class*="hyY6CXtbcn"]')).filter(el => {
            if (!el || el.offsetParent === null) return false;
            const text = (el.textContent || '').trim();
            return /^\d+$/.test(text);
          });
          const pageButtons = pageButtonCandidates.length > 0 ? pageButtonCandidates : Array.from(paginationContainer.querySelectorAll('[class*="hyY6CXtbcn"]')).filter(el => {
            if (!el || el.offsetParent === null) return false;
            const text = (el.textContent || '').trim();
            return /^\d+$/.test(text);
          });
          pageButtons.sort((a, b) => {
            const numA = parseInt((a.textContent || '').trim(), 10);
            const numB = parseInt((b.textContent || '').trim(), 10);
            return (numA - numB);
          });
          let toClick = null;
          let currentIndex = -1;
          for (let i = 0; i < pageButtons.length; i++) {
            const btn = pageButtons[i];
            const isCurrent = btn.getAttribute('aria-current') === 'true' || btn.getAttribute('aria-current') === 'page' ||
              (btn.classList && (btn.classList.contains('active') || btn.getAttribute('aria-selected') === 'true'));
            if (isCurrent) {
              currentIndex = i;
              break;
            }
          }
          if (currentIndex < 0 && pageButtons.length > 0) {
            currentIndex = 0;
          }
          if (currentIndex >= 0 && currentIndex < pageButtons.length - 1) {
            toClick = pageButtons[currentIndex + 1];
          }
          if (!toClick) {
            const nextBtn = paginationContainer.querySelector('a[class*="JY2WGJ4hXh"][class*="I3i1NSoFdB"]') ||
              paginationContainer.querySelector('div[class*="JY2WGJ4hXh"][class*="I3i1NSoFdB"]') ||
              document.querySelector('a[class*="JY2WGJ4hXh"][class*="I3i1NSoFdB"]') ||
              document.querySelector('div[class*="JY2WGJ4hXh"][class*="I3i1NSoFdB"]');
            if (nextBtn && nextBtn.offsetParent !== null && nextBtn.getAttribute('aria-hidden') !== 'true' && !nextBtn.disabled) {
              toClick = nextBtn;
            }
          }
          if (!toClick) return false;
          try {
            toClick.scrollIntoView({ block: 'center', behavior: 'instant' });
          } catch (_) {}
          await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          toClick.click();
          await sleep(CONSTANTS.WAIT_TIMES.LONG);
          await waitForPageReady();
          await waitForReviewsSection();
          await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
          return true;
        }

        const paginationEl = document.querySelector('div[class*="L2CTE05CX2"]');
        const searchRoot = paginationEl || document;
        let nextLink = null;
        const links = searchRoot.querySelectorAll('a[href="#"], a[data-shp-area="revlist.pgn"], a');
        for (const a of links) {
          const text = (a.textContent || '').trim();
          if (text === '다음' && a.offsetParent !== null && a.getAttribute('aria-hidden') !== 'true' && !a.disabled) {
            nextLink = a;
            break;
          }
        }
        if (!nextLink && searchRoot.querySelectorAll) {
          const allLinks = Array.from(searchRoot.querySelectorAll('a'));
          for (const a of allLinks) {
            const text = (a.textContent || '').trim();
            if (text === '다음' && a.offsetParent !== null && a.getAttribute('aria-hidden') !== 'true') {
              nextLink = a;
              break;
            }
          }
        }
        if (!nextLink || nextLink.disabled) return false;
        nextLink.click();
        await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
        await waitForPageReady();
        await waitForReviewsSection();
        await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
        return true;
      } catch (e) {
        return false;
      }
    }

    async function collectAllReviews() {
      const allReviews = [];
      debugLog('collectAllReviews start', { rating: currentRatingFilter }, 'H2');
      currentCollectedReviews = allReviews;

      if (isNaver) {
        const naverFirstMsg = { action: 'progress', percent: 10, text: '첫 페이지 리뷰 추출 중... (네이버)', originalTabId: currentOriginalTabId };
        safeSendMessage(naverFirstMsg);
        sendToUI(naverFirstMsg);
        let pageReviews = await extractReviewsFromPage();
        for (const r of pageReviews) {
          if (stopScraping) break;
          const safe = {
            content: r.content != null ? String(r.content) : '',
            title: r.title != null ? String(r.title) : '',
            rating: r.rating != null ? String(r.rating) : '',
            date: r.date != null ? String(r.date) : '',
            author: r.author != null ? String(r.author) : '',
            productEvaluation: r.productEvaluation != null ? String(r.productEvaluation) : '',
            originalTabId: r.originalTabId != null ? r.originalTabId : currentOriginalTabId
          };
          if (!isDuplicateReview(safe, allReviews)) allReviews.push(safe);
        }
        currentCollectedReviews = [...allReviews];
        let pageNum = 1;
        while (!stopScraping && (await goToNextPageNaver())) {
          pageNum++;
          const naverPageMsg = { action: 'progress', percent: Math.min(90, 15 + pageNum * 5), text: `${allReviews.length}개 리뷰 수집 중... (네이버 페이지 ${pageNum})`, originalTabId: currentOriginalTabId };
          safeSendMessage(naverPageMsg);
          sendToUI(naverPageMsg);
          pageReviews = await extractReviewsFromPage();
          for (const r of pageReviews) {
            if (stopScraping) break;
            const safe = {
              content: r.content != null ? String(r.content) : '',
              title: r.title != null ? String(r.title) : '',
              rating: r.rating != null ? String(r.rating) : '',
              date: r.date != null ? String(r.date) : '',
              author: r.author != null ? String(r.author) : '',
              productEvaluation: r.productEvaluation != null ? String(r.productEvaluation) : '',
              originalTabId: r.originalTabId != null ? r.originalTabId : currentOriginalTabId
            };
            if (!isDuplicateReview(safe, allReviews)) allReviews.push(safe);
          }
          currentCollectedReviews = [...allReviews];
          const maxReviews = CONSTANTS.REVIEW.MAX_COLLECTION_REVIEWS;
          if (maxReviews != null && typeof maxReviews === 'number' && allReviews.length >= maxReviews) {
            safeSendMessage({
              action: 'log',
              message: `수집 개수 제한 도달: ${maxReviews}개 → 수집 종료`,
              type: 'info'
            });
            break;
          }
        }
        const naverDoneMsg = { action: 'progress', percent: 100, text: `수집 완료: 총 ${allReviews.length}개 리뷰`, originalTabId: currentOriginalTabId };
        safeSendMessage(naverDoneMsg);
        sendToUI(naverDoneMsg);
        return allReviews;
      }

      let logicalPage = 1; // 논리적 페이지(우리가 추적), DOM 페이지와 분리
      let hasNoReviewsMessage = false;
      const visitedPageSignatures = new Set(); // 중복 페이지 방지 (article 요소 기반 + rating)
      const buildPageSignatureFromExtracted = (reviews, fallbackDomSig) => {
        try {
          const pageNum = getCurrentPageNumber();
          const top = Array.isArray(reviews) ? reviews.slice(0, 3) : [];
          const parts = top.map(r => {
            const rid = (r.reviewId || r.id || '').toString().substring(0, 40);
            const au = (r.author || '').toString().substring(0, 20);
            const dt = (r.date || '').toString().substring(0, 20);
            const rt = (r.rating || '').toString();
            const ct = (r.content || '').toString().substring(0, 60);
            return `${rid}|${au}|${dt}|${rt}|${ct}`;
          });
          const count = Array.isArray(reviews) ? reviews.length : 0;
          const dom = (fallbackDomSig || '').substring(0, 120);
          return `p=${pageNum || 'na'};c=${count};${parts.join('||')};dom=${dom}`;
        } catch (e) {
          return fallbackDomSig || '';
        }
      };

      const updateCurrentCollectedReviews = () => {
        currentCollectedReviews = [...allReviews];
      };
      const noReviewMessages = CONSTANTS.NO_REVIEW_MESSAGES;

      // 첫 페이지 리뷰 추출 (필터링 후에는 이미 필터링된 첫 페이지 리뷰가 표시됨)
      const firstMsg = { action: 'progress', percent: 10, text: '첫 페이지 리뷰 추출 중...', originalTabId: currentOriginalTabId };
      safeSendMessage(firstMsg);
      sendToUI(firstMsg);

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

      if (firstPageReviews.length > 0) {
        const firstFoundMsg = { action: 'progress', percent: 15, text: `첫 페이지: ${firstPageReviews.length}개 리뷰 발견`, originalTabId: currentOriginalTabId };
        safeSendMessage(firstFoundMsg);
        sendToUI(firstFoundMsg);
        for (const review of firstPageReviews) {
          const isDuplicate = isDuplicateReview(review, allReviews);
          if (!isDuplicate) {
            allReviews.push(review);
            updateCurrentCollectedReviews();
          } else {
            // 사용자 요청: 리뷰 단위 로그는 제외 (중복 리뷰도 조용히 스킵)
          }
        }
        // 다음 이동은 2페이지부터 시작
        logicalPage = 2;

        // 첫 페이지 수집 후 즉시 다음 페이지로 이동 (중복 추출 방지)
        // 첫 페이지의 article 요소 시그니처를 rating 포함 형식으로 저장
        const firstDomSig = getFirstReviewSignatureFromDom();
        if (firstPageReviews.length > 0 && firstDomSig) {
          visitedPageSignatures.add(`${currentRatingFilter}|${firstDomSig}`);
        }

      } else {
        // 첫 페이지에 리뷰가 없으면 1페이지부터 시작 (페이지 이동 후 리뷰 확인)
        logicalPage = 1;
      }


      // 핵심 흐름: (페이지 이동) -> (필터 확인/재적용) -> (리뷰 추출)
      // 첫 페이지는 위에서 이미 처리했으므로 여기서는 logicalPage=2부터 "이동 후 추출"만 수행
      let currentBlockIndex = 0; // 1~10: 0블록, 11~20: 1블록 ...

      while (!stopScraping && !hasNoReviewsMessage) {
        if (stopScraping) break;

        const targetPage = logicalPage;
        // 1) 목표 페이지로 이동 (먼저 이동!)
        const desiredBlockIndex = Math.floor((targetPage - 1) / 10);
        const posInBlock = ((targetPage - 1) % 10) + 1; // 1..10
        const buttonIndexForPage = posInBlock + 1; // page1->2, page2->3 ... page10->11

        const prevSig = getFirstReviewSignatureFromDom();
        const paginationBefore = getPaginationInfo();
        const prevPageNum = paginationBefore.activePage;
        // DOM 기준 현재 블록(1~10, 11~20, 21~30...)을 매 루프 동기화
        // currentBlockIndex가 실제보다 앞서가면(예: 2로 고정) 21페이지 진입 시 next(12)를 안 눌러서
        // button:nth-child(2)=11을 클릭하게 되고, 결국 11~20이 반복되는 루프가 발생한다.
        if (paginationBefore.blockStart !== null) {
          currentBlockIndex = Math.floor((paginationBefore.blockStart - 1) / 10);
        } else if (prevPageNum !== null) {
          currentBlockIndex = Math.floor((prevPageNum - 1) / 10);
        }

        // 블록 전환이 필요하면(11,21,31,...) 고정 순서: button:nth-child(11) -> button:nth-child(2) -> button:nth-child(12)
        if (desiredBlockIndex > currentBlockIndex) {
          safeSendMessage({
            action: 'log',
            message: `페이지 ${targetPage} 진입 전 블록 전환: currentBlock=${currentBlockIndex} -> desiredBlock=${desiredBlockIndex} (고정 순서: buttonIndex=11 -> buttonIndex=2 -> buttonIndex=12)`,
            type: 'info'
          });

          const desiredBlockStart = (desiredBlockIndex * 10) + 1;

          // 1단계: 먼저 button:nth-child(11) 클릭 (현재 블록의 마지막 페이지로 이동: 10, 20, 30 등)
          const movedToLast = await goToNextPage(11);
          if (!movedToLast) {
            safeSendMessage({
              action: 'log',
              message: `buttonIndex=11 클릭 실패. 블록 전환 불가능하여 종료합니다.`,
              type: 'warning'
            });
            break;
          }
          await waitForPageReady();
          await waitForReviewsSection();
          await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);

          // 2단계: button:nth-child(2) 클릭 (현재 블록의 첫 페이지로 이동: 1, 11, 21 등)
          const movedToFirst = await goToNextPage(2);
          if (!movedToFirst) {
            safeSendMessage({
              action: 'log',
              message: `buttonIndex=2 클릭 실패. 블록 전환 불가능하여 종료합니다.`,
              type: 'warning'
            });
            break;
          }
          await waitForPageReady();
          await waitForReviewsSection();
          await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);

          // 3단계: button:nth-child(12) 클릭 (다음 블록으로 이동)
          const beforeBlockStart = paginationBefore.blockStart;
          const beforePageNum = paginationBefore.activePage;
          let blockMoved = false;
          for (let attempt = 0; attempt < 3 && !blockMoved; attempt++) {
            const movedBlock = await goToNextPage(12);
            if (!movedBlock) {
              if (attempt === 0) {
                safeSendMessage({
                  action: 'log',
                  message: `buttonIndex=12 클릭 실패`,
                  type: 'warning'
                });
              }
              break;
            }
            await waitForPageReady();
            await waitForReviewsSection();
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
            await sleep(CONSTANTS.WAIT_TIMES.AFTER_BLOCK_NAVIGATION || CONSTANTS.WAIT_TIMES.LONG);

            const afterInfo = getPaginationInfo();
            const afterBlockStart = afterInfo.blockStart;
            const afterPageNum = afterInfo.activePage;

            // 목표 블록 시작(11,21,31...)이 보이면 성공으로 간주
            if (afterBlockStart !== null && afterBlockStart >= desiredBlockStart) {
              blockMoved = true;
              currentBlockIndex = Math.floor((afterBlockStart - 1) / 10);
              safeSendMessage({
                action: 'log',
                message: `블록 전환 성공: 블록 ${currentBlockIndex} (시작 페이지: ${afterBlockStart})`,
                type: 'success'
              });
              break;
            }

            // 페이지 번호가 증가했거나 블록이 변경되었으면 성공으로 간주
            if (afterPageNum !== null && beforePageNum !== null && afterPageNum > beforePageNum) {
              if (afterBlockStart !== null) {
                blockMoved = true;
                currentBlockIndex = Math.floor((afterBlockStart - 1) / 10);
                safeSendMessage({
                  action: 'log',
                  message: `블록 전환 성공: 페이지 ${beforePageNum} -> ${afterPageNum}, 블록 ${currentBlockIndex}`,
                  type: 'success'
                });
                break;
              }
            }

            // 블록 변화 감지 (목표와 다를 수 있음)
            if (beforeBlockStart !== null && afterBlockStart !== null && afterBlockStart !== beforeBlockStart) {
              currentBlockIndex = Math.floor((afterBlockStart - 1) / 10);
            }

            // 변화가 없으면 재시도
            if (attempt < 2) {
              await sleep(CONSTANTS.WAIT_TIMES.LONG);
            }
          }

          if (!blockMoved) {
            safeSendMessage({
              action: 'log',
              message: `다음 블록(>) 버튼이 없거나 블록 전환이 불가능하여 마지막 페이지로 판단하고 종료합니다. (targetPage=${targetPage})`,
              type: 'warning'
            });
            break;
          }

          await waitForReviewsSection();
        }

        safeSendMessage({
          action: 'log',
          message: `페이지 이동: targetPage=${targetPage}, button:nth-child(${buttonIndexForPage}), prevPage=${prevPageNum}, prevSig=${(prevSig || '').substring(0, 80)}`,
          type: 'info'
        });

        // 페이지 이동 시도 (최대 2회 재시도)
        let clicked = false;
        for (let retry = 0; retry < 2 && !clicked; retry++) {
          clicked = await goToPageNumber(targetPage, buttonIndexForPage);
          if (!clicked && retry < 1) {
            safeSendMessage({
              action: 'log',
              message: `페이지 버튼 클릭 실패. 재시도 중... (targetPage=${targetPage}, 시도 ${retry + 1}/2)`,
              type: 'warning'
            });
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
          }
        }

        if (!clicked) {
          safeSendMessage({
            action: 'log',
            message: `페이지 버튼을 찾지 못했습니다. (targetPage=${targetPage}, buttonIndex=${buttonIndexForPage}) 수집 종료`,
            type: 'warning'
          });
          break;
        }

        await waitForPageReady();
        await waitForReviewsSection();
        await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
        // 페이지간 이동 후 추가 안정화 대기 (전체 단축: 기본 0ms)
        await sleep(CONSTANTS.WAIT_TIMES.AFTER_PAGE_NAVIGATION);

        let afterSig = getFirstReviewSignatureFromDom();
        let afterPageNum = getCurrentPageNumber();
        let moved =
          // 1) 페이지 번호가 목표값으로 맞춰졌으면 이동 성공
          (afterPageNum !== null && afterPageNum === targetPage) ||
          // 2) 페이지 번호가 바뀌었으면 이동 성공
          (afterPageNum !== null && prevPageNum !== null && afterPageNum !== prevPageNum) ||
          // 3) 페이지 번호를 못 읽는 경우 대비: 리뷰 카드 시그니처가 바뀌면 이동 성공
          (afterSig && prevSig && afterSig !== prevSig);

        // 이동 감지 실패 시: 즉시 종료하지 말고, 로딩 지연을 감안해 최대 5초까지 재확인(추가 클릭 없음)
        let movementUnconfirmed = false;
        if (!moved) {
          const start = Date.now();
          const timeoutMs = CONSTANTS.WAIT_TIMES.PAGE_MOVE_POLL_TIMEOUT;
          const pollMs = 200;
          while (!stopScraping && !moved && (Date.now() - start) < timeoutMs) {
            await sleep(pollMs);
            await waitForReviewsSection();
            afterSig = getFirstReviewSignatureFromDom();
            afterPageNum = getCurrentPageNumber();
            moved =
              (afterPageNum !== null && afterPageNum === targetPage) ||
              (afterPageNum !== null && prevPageNum !== null && afterPageNum !== prevPageNum) ||
              (afterSig && prevSig && afterSig !== prevSig);
          }
        }

        if (!moved) {
          movementUnconfirmed = true;
          safeSendMessage({
            action: 'log',
            message: `페이지 이동 확인 불가: targetPage=${targetPage}, prevPage=${prevPageNum}, afterPage=${afterPageNum}, prevSig=${(prevSig || '').substring(0, 40)}, afterSig=${(afterSig || '').substring(0, 40)} → 추출로 확인`,
            type: 'warning'
          });
        }

        // DOM 페이지 번호는 오탐/지연이 잦아 logicalPage를 동기화하면 "홀수만 수집" 같은 스킵이 발생할 수 있음.
        // 따라서 logicalPage는 "목표 페이지(targetPage)" 흐름을 그대로 유지하고, dom 값은 참고 로그만 남긴다.
        if (afterPageNum !== null && afterPageNum !== targetPage) {
          safeSendMessage({
            action: 'log',
            message: `페이지 번호 불일치(참고): target=${targetPage}, dom=${afterPageNum} (logical 유지)`,
            type: 'warning'
          });
        }

        // 2) 필터 확인/재적용 (이동 후!)
        if (currentRatingFilter && currentRatingFilter !== 'all') {
          // 페이지 이동 후 필터 드롭다운이 렌더링될 때까지 대기 (300ms로 증가)
          await sleep(CONSTANTS.WAIT_TIMES.FILTER_DROPDOWN_RENDER);

          // 필터 감지 재시도 로직 (최대 3회)
          let activeFilter = null;
          let retryCount = 0;
          const maxRetries = 3;

          while (retryCount < maxRetries && !activeFilter) {
            activeFilter = detectCurrentRatingFilterValue();
            if (!activeFilter && retryCount < maxRetries - 1) {
              await sleep(CONSTANTS.WAIT_TIMES.FILTER_DROPDOWN_RENDER);
              retryCount++;
            } else {
              break;
            }
          }

          // 필터가 해제되었거나 감지되지 않은 경우 재적용
          if (activeFilter !== currentRatingFilter) {
            safeSendMessage({
              action: 'log',
              message: `필터 상태 확인: 현재='${activeFilter || '감지 실패'}', 목표='${currentRatingFilter}' → 재적용`,
              type: 'info'
            });

            let applied = false;
            let filterRetryCount = 0;
            const maxFilterRetries = 3;

            // 필터 재적용 재시도 로직 (최대 3회)
            while (filterRetryCount < maxFilterRetries && !applied) {
              applied = await ensureRatingFilterApplied(currentRatingFilter);
              if (!applied && filterRetryCount < maxFilterRetries - 1) {
                await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                filterRetryCount++;
              } else {
                break;
              }
            }

            if (applied) {
              // 필터 재적용 후 검증
              await waitForPageReady();
              await waitForReviewsSection();
              await sleep(CONSTANTS.WAIT_TIMES.FILTER_DROPDOWN_RENDER);

              // 재적용 후 필터 상태 재확인 (최대 3회)
              let verifiedFilter = null;
              let verifyRetryCount = 0;
              const maxVerifyRetries = 3;

              while (verifyRetryCount < maxVerifyRetries && !verifiedFilter) {
                verifiedFilter = detectCurrentRatingFilterValue();
                if (!verifiedFilter && verifyRetryCount < maxVerifyRetries - 1) {
                  await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                  verifyRetryCount++;
                } else {
                  break;
                }
              }

              if (verifiedFilter === currentRatingFilter) {
                safeSendMessage({
                  action: 'log',
                  message: `필터 재적용 완료: '${currentRatingFilter}' 확인됨`,
                  type: 'success'
                });
              } else {
                // 필터 재적용 검증 실패 → 수집 중단
                const errorMsg = `필터 재적용 검증 실패: 현재='${verifiedFilter || '감지 실패'}', 목표='${currentRatingFilter}' → 이 페이지 수집 건너뜀`;
                safeSendMessage({
                  action: 'log',
                  message: errorMsg,
                  type: 'error'
                });
                throw new Error(errorMsg);
              }
            } else {
              // 필터 재적용 자체 실패 → 수집 중단
              const errorMsg = `필터 재적용 실패: '${currentRatingFilter}' 적용 불가 → 이 페이지 수집 건너뜀`;
              safeSendMessage({
                action: 'log',
                message: errorMsg,
                type: 'error'
              });
              throw new Error(errorMsg);
            }
          } else {
            // 필터 상태 정상 유지 확인
            safeSendMessage({
              action: 'log',
              message: `필터 상태 유지 확인: '${currentRatingFilter}' (재적용 불필요)`,
              type: 'success'
            });
          }
        }

        // 3) 리뷰 추출
        safeSendMessage({
          action: 'log',
          message: `페이지 ${logicalPage} 리뷰 추출 시작 (sig=${(afterSig || '').substring(0, 80)})`,
          type: 'info'
        });

        const reviews = await extractReviewsFromPage();
        if (stopScraping) break;

        // 페이지 단위 중복 방지(이동 실패/렌더 반복 시 안전장치)
        // "이동 직후 DOM 1개"로 만든 afterSig는 렌더 지연/고정 리뷰로 중복 오판이 나서,
        // 실제 추출 결과(상위 N개 + 개수 + 페이지번호)로 시그니처를 다시 만든다.
        const finalSig = buildPageSignatureFromExtracted(reviews, afterSig);
        const pageSigKey = `${currentRatingFilter}|${finalSig || ''}`;
        if (finalSig && visitedPageSignatures.has(pageSigKey)) {
          safeSendMessage({
            action: 'log',
            message: `동일 페이지 반복 감지: ${pageSigKey.substring(0, 120)} (수집 종료 로직 비활성화됨 - 계속 진행)`,
            type: 'warning'
          });
          // 사용자 요청: 동일 페이지 반복 시 수집 종료(break) 로직 주석 처리
          // break;
        }
        if (finalSig) visitedPageSignatures.add(pageSigKey);

        // 이동은 되었는데 리뷰가 0개면 다음 페이지 이동을 시도해보고, 실패하면 종료
        if (!reviews || reviews.length === 0) {
          safeSendMessage({
            action: 'log',
            message: `리뷰가 0개입니다. (페이지 ${logicalPage}) 다음 페이지 이동 시도 중...`,
            type: 'warning'
          });

          // 다음 페이지로 이동 시도
          const nextPage = logicalPage + 1;
          const nextButtonIndex = nextPage <= 10 ? nextPage + 2 : 12; // 1~10페이지는 직접 버튼, 11+는 블록 이동

          // 다음 페이지 이동 시도 (최대 2회)
          let nextPageMoved = false;
          for (let retry = 0; retry < 2 && !nextPageMoved; retry++) {
            await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
            const nextClicked = await goToPageNumber(nextPage, nextButtonIndex);
            if (nextClicked) {
              await waitForPageReady();
              await waitForReviewsSection();
              await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);

              // 다음 페이지에서 리뷰가 있는지 확인
              const nextPageReviews = await extractReviewsFromPage();
              if (nextPageReviews && nextPageReviews.length > 0) {
                nextPageMoved = true;
                safeSendMessage({
                  action: 'log',
                  message: `다음 페이지(${nextPage})에서 리뷰 ${nextPageReviews.length}개 발견. 계속 수집합니다.`,
                  type: 'info'
                });
                // 다음 페이지 리뷰를 수집
                for (const review of nextPageReviews) {
                  if (stopScraping) break;
                  const isDuplicate = isDuplicateReview(review, allReviews);
                  if (!isDuplicate) {
                    allReviews.push(review);
                    updateCurrentCollectedReviews();
                  }
                }
                logicalPage = nextPage;
                continue; // while 루프 계속
              }
            }
          }

          // 다음 페이지 이동 실패 또는 다음 페이지에도 리뷰가 없으면 종료
          if (!nextPageMoved) {
            safeSendMessage({
              action: 'log',
              message: `더 이상 리뷰가 없습니다. (페이지 ${logicalPage}) 수집 종료`,
              type: 'info'
            });
            break;
          }
        }

        // 이동 확인이 안 됐는데도 추출 결과가 나왔다면(로딩 지연 케이스), 이후부터는 정상 흐름으로 계속 진행
        if (movementUnconfirmed) {
          safeSendMessage({
            action: 'log',
            message: `페이지 이동은 미확인 상태였지만 리뷰 추출 성공: ${reviews.length}개 (페이지 ${logicalPage})`,
            type: 'info'
          });
        }

        // 리뷰 수집
        let addedCount = 0;
        let duplicateCount = 0;
        for (const review of reviews) {
          if (stopScraping) break;
          const isDuplicate = isDuplicateReview(review, allReviews);
          if (!isDuplicate) {
            allReviews.push(review);
            updateCurrentCollectedReviews();
            addedCount++;
          } else {
            duplicateCount++;
          }
        }

        // 수집 통계 로그
        if (duplicateCount > 0) {
          safeSendMessage({
            action: 'log',
            message: `페이지 ${logicalPage}: ${addedCount}개 추가, ${duplicateCount}개 중복 제외`,
            type: 'info'
          });
        }

        const pageMsg = { action: 'progress', percent: Math.min(90, 15 + (logicalPage * 5)), text: `${allReviews.length}개 리뷰 수집 중... (페이지 ${logicalPage})`, originalTabId: currentOriginalTabId };
        safeSendMessage(pageMsg);
        sendToUI(pageMsg);

        const maxReviews = CONSTANTS.REVIEW.MAX_COLLECTION_REVIEWS;
        if (maxReviews != null && typeof maxReviews === 'number' && allReviews.length >= maxReviews) {
          safeSendMessage({
            action: 'log',
            message: `수집 개수 제한 도달: ${maxReviews}개 → 수집 종료`,
            type: 'info'
          });
          break;
        }

        logicalPage += 1; // 다음 페이지로
        await sleep(CONSTANTS.WAIT_TIMES.SHORT);
      }

      updateCurrentCollectedReviews();

      // 프로그레스바를 100%로 업데이트
      const finalMsg = { action: 'progress', percent: 100, text: `수집 완료: 총 ${allReviews.length}개 리뷰`, originalTabId: currentOriginalTabId };
      safeSendMessage(finalMsg);
      sendToUI(finalMsg);

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
            originalTabId: currentOriginalTabId,
            productName: cachedProductName || getProductNameFromPage(),
            source: isCoupang ? 'coupang' : (isNaverBrand ? 'brand' : (isNaverSmart ? 'smartstore' : 'unknown'))
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

        if (isNaver) {
          await sleep(CONSTANTS.WAIT_TIMES.SHORT);
          await waitForReviewsSection();
          const sectionClass = isNaverBrand ? 'JHZoCyHfg7' : 'HTT4L8U0CU';
          const listEl = document.querySelector('ul[class*="RR2FSL9wTc"]');
          let reviewElements = [];
          if (listEl) {
            if (isNaverSmart) {
              reviewElements = Array.from(listEl.querySelectorAll(':scope > li[class]')).filter(el => el && el.nodeType === Node.ELEMENT_NODE);
              if (reviewElements.length === 0) {
                reviewElements = Array.from(listEl.querySelectorAll(':scope > li')).filter(el => el && el.nodeType === Node.ELEMENT_NODE);
              }
            } else {
              reviewElements = Array.from(listEl.querySelectorAll(':scope > li')).filter(el => el && el.nodeType === Node.ELEMENT_NODE);
            }
          }
          if (reviewElements.length === 0) {
            const sectionEl = document.querySelector(`div[class*="${sectionClass}"]`);
            if (sectionEl) {
              const lis = isNaverSmart
                ? sectionEl.querySelectorAll('ul[class*="RR2FSL9wTc"] > li[class], ul[class*="RR2FSL9wTc"] > li')
                : sectionEl.querySelectorAll('ul[class*="RR2FSL9wTc"] li, li');
              reviewElements = Array.from(lis).filter(el => el && el.nodeType === Node.ELEMENT_NODE);
            }
          }
          if (reviewElements.length === 0) {
            const fallback = isNaverSmart
              ? document.querySelectorAll('ul[class*="RR2FSL9wTc"] > li[class], ul[class*="RR2FSL9wTc"] > li')
              : document.querySelectorAll(`div[class*="${sectionClass}"] li, ul[class*="RR2FSL9wTc"] li`);
            reviewElements = Array.from(fallback).filter(el => el && el.nodeType === Node.ELEMENT_NODE);
          }
          for (const element of reviewElements) {
            if (stopScraping) break;
            if (!element || element.nodeType !== Node.ELEMENT_NODE) continue;
            const review = extractReviewData(element);
            if (review) {
              const safe = {
                content: review.content != null ? String(review.content) : '',
                title: review.title != null ? String(review.title) : '',
                rating: review.rating != null ? String(review.rating) : '',
                date: review.date != null ? String(review.date) : '',
                author: review.author != null ? String(review.author) : '',
                productEvaluation: review.productEvaluation != null ? String(review.productEvaluation) : '',
                originalTabId: review.originalTabId != null ? review.originalTabId : currentOriginalTabId
              };
              if (safe.content || safe.author || safe.date || safe.rating) {
                reviews.push(safe);
              }
            }
          }
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

        // article 요소를 우선적으로 찾기 (최우선)
        if (sdpReview) {
          try {
            const articleElements = safeQuerySelectorAll('article', sdpReview);
            if (articleElements.length > 0) {
              articleElements.forEach(el => {
                if (el && el.nodeType === Node.ELEMENT_NODE) {
                  allFoundElements.add(el);
                }
              });
              if (articleElements.length > maxFoundCount) {
                maxFoundCount = articleElements.length;
                bestSelector = 'article (우선 검색)';
              }
            }
          } catch (e) {
            // article 요소를 찾지 못한 경우 계속 진행
          }
        }

        // article 요소를 찾지 못한 경우에만 다른 셀렉터 시도
        if (allFoundElements.size === 0) {
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

        // 히스토그램/요약 카드 제거 (data-review-id 없는 요소 중 별점 분포 텍스트)
        const histogramPattern = /(최고\s*\d+%.*좋음\s*\d+%.*보통\s*\d+%.*별로\s*\d+%.*나쁨\s*\d+%)/;
        reviewElements = reviewElements.filter((el) => {
          if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
          const hasReviewId =
            el.hasAttribute('data-review-id') ||
            el.hasAttribute('data-reviewid') ||
            !!safeQuerySelector('[data-review-id],[data-reviewid]', el);
          if (hasReviewId) return true;
          const text = safeGetText(el).replace(/\s+/g, ' ');
          if (histogramPattern.test(text)) {
            safeSendMessage({
              action: 'log',
              message: '요약/히스토그램 요소를 건너뜁니다.',
              type: 'info'
            });
            return false;
          }
          return true;
        });
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

            // 필터링 조건 (상수 사용) - 최소 길이 조건 완화 (0자 이상 허용)
            // elementText가 너무 짧거나 길면 스킵하되, 최소 길이를 0으로 완화하여 더 많은 리뷰 수집
            if (elementText.length > CONSTANTS.REVIEW.MAX_CONTENT_LENGTH) {
              continue;
            }
            // MIN_CONTENT_LENGTH 체크는 제거하여 짧은 리뷰도 수집 가능하도록 함

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
                const safe = {
                  content: review.content != null ? String(review.content) : '',
                  title: review.title != null ? String(review.title) : '',
                  rating: review.rating != null ? String(review.rating) : '',
                  date: review.date != null ? String(review.date) : '',
                  author: review.author != null ? String(review.author) : '',
                  productEvaluation: review.productEvaluation != null ? String(review.productEvaluation) : '',
                  originalTabId: review.originalTabId != null ? review.originalTabId : currentOriginalTabId
                };
                reviews.push(safe);
              } else {
                // 사용자 요청: 리뷰 단위 로그는 제외 (추출 실패도 조용히 스킵)
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

      if (isNaver) {
        try {
          if (isNaverBrand) {
            const ratingWrap = element.querySelector('span[class*="_rvQSUB5wU"]');
            if (ratingWrap) {
              const inner = ratingWrap.querySelector('span[class*="t7PPhhAQtT"]');
              const w = (inner && inner.style && inner.style.width) ? inner.style.width : '';
              const pct = parseInt(w, 10);
              if (!isNaN(pct) && pct >= 20 && pct <= 100) rating = String(Math.round(pct / 20));
            }
            const authorDateDiv = element.querySelector('div[class*="Db9Dtnf7gY"]');
            if (authorDateDiv) {
              const strongEl = authorDateDiv.querySelector('strong[class*="MX91DFZo2F"]');
              if (strongEl) author = (strongEl.textContent || '').trim();
              const dateSpans = authorDateDiv.querySelectorAll('span[class*="MX91DFZo2F"]');
              for (const span of dateSpans) {
                const t = (span.textContent || '').trim();
                const m = t.match(/^(\d{2})\.(\d{2})\.(\d{2})\.?$/);
                if (m) {
                  const y = parseInt(m[1], 10) >= 50 ? '19' + m[1] : '20' + m[1];
                  date = `${y}-${m[2]}-${m[3]}`;
                  break;
                }
                if (/^\d{4}[.\-]\d{1,2}[.\-]\d{1,2}/.test(t)) {
                  date = t.replace(/\s+/g, ' ').trim().substring(0, 20);
                  break;
                }
              }
            }
            const contentDiv = element.querySelector('div[class*="HakaEZ240l"]');
            if (contentDiv) {
              const parts = [];
              const innerSpans = contentDiv.querySelectorAll('span[class*="rnrf6Xo7x2"], span[class*="MX91DFZo2F"]');
              for (const s of innerSpans) {
                const t = (s.textContent || '').trim();
                if (t) parts.push(t);
              }
              content = parts.join(' ').trim() || (contentDiv.textContent || '').trim();
            }
          } else {
            const ratingEl = element.querySelector('em') || element.querySelector('[class*="rating"]');
            if (ratingEl) {
              const rText = (ratingEl.textContent || '').trim().replace(/\D/g, '');
              if (/^[1-5]$/.test(rText)) rating = rText;
            }
            const authorEl = element.querySelector('strong') || element.querySelector('b');
            if (authorEl) author = (authorEl.textContent || '').trim();
            const allSpans = element.querySelectorAll('span');
            for (const span of allSpans) {
              const t = (span.textContent || '').trim();
              if (/^\d{4}[.\-]\d{1,2}[.\-]\d{1,2}$/.test(t) || /^\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\s/.test(t)) {
                date = t.replace(/\s+/g, ' ').trim().substring(0, 20);
                break;
              }
            }
            const contentDiv = element.querySelector('div[class*="HakaEZ240l"]');
            if (contentDiv) {
              const spans = contentDiv.querySelectorAll('span[class*="MX91DFZo2F"]');
              const parts = [];
              for (const s of spans) {
                const t = (s.textContent || '').trim();
                if (t) parts.push(t);
              }
              content = parts.join(' ').trim() || (contentDiv.textContent || '').trim();
            }
            if (!content) {
              content = (element.textContent || '').trim().replace(/\s+/g, ' ').trim();
            }
          }
          return {
            date: date || '',
            author: author || '',
            rating: rating || '',
            title: title || '',
            content: content || '',
            productEvaluation: productEvaluation || '',
            originalTabId: currentOriginalTabId
          };
        } catch (e) {
          return null;
        }
      }

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
                // 작성자 이름 패턴 확인 (한글, 영어, * 포함)
                // 영어 이름도 허용: 영문자로 시작하거나, * 포함, 또는 한글로 시작
                if (authorText && (
                  authorText.includes('*') ||
                  /^[가-힣]/.test(authorText) ||
                  /^[A-Za-z]/.test(authorText) ||
                  authorText === '쿠팡실구매자'
                )) {
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
      const parsedRating = (rating && `${rating}`.trim()) || '';
      const activeFilterValue = detectCurrentRatingFilterValue();
      const finalRating = parsedRating || ((activeFilterValue === currentRatingFilter && currentRatingFilter !== 'all') ? currentRatingFilter : '');

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
      // 별점, 작성자, 날짜, 리뷰 내용이 모두 같을 때만 중복으로 처리
      const reviewRating = (review.rating || '').trim();
      const reviewAuthor = (review.author || '').trim();
      const reviewDate = (review.date || '').trim();
      const reviewContent = (review.content || '').trim();

      const duplicateIndex = existingReviews.findIndex(existing => {
        const existingRating = (existing.rating || '').trim();
        const existingAuthor = (existing.author || '').trim();
        const existingDate = (existing.date || '').trim();
        const existingContent = (existing.content || '').trim();
        return existingRating === reviewRating &&
          existingAuthor === reviewAuthor &&
          existingDate === reviewDate &&
          existingContent === reviewContent;
      });

      if (duplicateIndex !== -1) {
        return true; // 중복임을 표시
      }

      return false; // 중복 아님
    }

    // 다음 페이지로 이동하는 함수 (버튼 인덱스, checkOnly 모드 지원)
    async function goToPageNumber(targetPage, fallbackButtonIndex = null, checkOnly = false) {
      logToBackground(`goToPageNumber 진입: targetPage=${targetPage}, fallbackButtonIndex=${fallbackButtonIndex}, checkOnly=${checkOnly}`, 'info');

      try {
        const targetText = String(targetPage);
        const candidates = [
          '#sdpReview div[data-page]',
          '#sdpReview nav',
          '#sdpReview div.twc-overflow-hidden div:nth-child(5) > div',
          '#sdpReview div.twc-overflow-hidden',
          '#sdpReview'
        ];

        let container = null;
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (!el) continue;
          // 해당 컨테이너 안에 목표 숫자 버튼이 하나라도 있으면 우선 채택
          const hasTarget = Array.from(el.querySelectorAll('button, a, div[role="button"]')).some(btn => {
            const t = (btn.textContent || '').trim();
            return t === targetText;
          });
          if (hasTarget) {
            container = el;
            break;
          }
        }
        // 그래도 못 찾으면 getPaginationInfo의 컨테이너를 사용
        if (!container) {
          const pageInfo = getPaginationInfo();
          container = pageInfo.container || document.querySelector('#sdpReview');
        }

        if (!container) {
          logToBackground(`goToPageNumber 실패: 페이지네이션 컨테이너를 찾지 못했습니다. (targetPage=${targetPage})`, 'warning');
          if (fallbackButtonIndex !== null) return await goToNextPage(fallbackButtonIndex, checkOnly);
          return false;
        }

        const buttons = Array.from(container.querySelectorAll('button, a, div[role="button"]'))
          .filter(btn => ((btn.textContent || '').trim() === targetText));

        if (!buttons.length) {
          logToBackground(`goToPageNumber 실패: targetPage=${targetPage} 버튼을 찾지 못했습니다.`, 'warning');
          if (fallbackButtonIndex !== null) return await goToNextPage(fallbackButtonIndex, checkOnly);
          return false;
        }

        // 이미 활성화된 페이지면 클릭 없이 성공 처리
        const isActive = (btn) =>
          btn?.classList?.contains('twc-font-bold') ||
          btn?.getAttribute?.('aria-current') === 'page' ||
          btn?.getAttribute?.('aria-current') === 'true';

        if (buttons.some(isActive)) {
          logToBackground(`goToPageNumber noop: 이미 ${targetPage}페이지(활성)`, 'info');
          return true;
        }

        if (checkOnly) {
          logToBackground(`goToPageNumber checkOnly: targetPage=${targetPage} 버튼 존재`, 'info');
          return true;
        }

        // 클릭 대상: 활성/비활성/비가시 여부 등을 고려해 첫 번째 후보 사용
        const btn = buttons[0];
        try {
          btn.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        } catch (e) { }

        // 클릭 시도 (DOMException 대비)
        try {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {
          try { btn.click(); } catch (e2) { }
        }

        logToBackground(`goToPageNumber 완료: targetPage=${targetPage}`, 'info');
        return true;
      } catch (e) {
        logToBackground(`goToPageNumber 최상위 예외: ${e?.message || String(e)}`, 'warning');
        if (fallbackButtonIndex !== null) return await goToNextPage(fallbackButtonIndex, checkOnly);
        return false;
      }
    }

    async function goToNextPage(buttonIndex, checkOnly = false) {
      logToBackground(`goToNextPage 진입: buttonIndex=${buttonIndex}, checkOnly=${checkOnly}`, 'info');

      // 맨 마지막 페이지: 다음 페이지(화살표) 버튼이 disabled 또는 twc-cursor-not-allowed 이면 수집 종료
      if (buttonIndex === 12) {
        try {
          const pageInfo = getPaginationInfo();
          const container =
            pageInfo.container ||
            document.querySelector('#sdpReview div[data-page]') ||
            document.querySelector('#sdpReview div.twc-overflow-hidden div:nth-child(5) > div') ||
            document.querySelector('#sdpReview div.twc-overflow-hidden') ||
            document.querySelector('#sdpReview');
          const buttons = container ? Array.from(container.querySelectorAll('button, a')) : [];
          for (const btn of buttons) {
            const hasArrow = btn.querySelector && btn.querySelector('svg');
            const isPrevArrow = btn.querySelector && btn.querySelector('svg.twc-rotate-\\[180deg\\]');
            if (hasArrow && !isPrevArrow) {
              const isLastPage =
                btn.disabled === true ||
                (btn.getAttribute && btn.getAttribute('disabled') !== null) ||
                (btn.classList && btn.classList.contains('twc-cursor-not-allowed'));
              if (isLastPage) {
                logToBackground('goToNextPage: 마지막 페이지(다음 버튼 비활성) → 수집 종료', 'info');
                return false;
              }
              break;
            }
          }
        } catch (e) { }
      }

      // 이미 목표 페이지(라벨)인 경우에는 다시 클릭하지 않음 (재시도 루프에서 페이지가 밀리는 현상 방지)
      try {
        if (!checkOnly && buttonIndex >= 2 && buttonIndex <= 11) {
          const pageInfo = getPaginationInfo();
          const expectedLabel =
            pageInfo.blockStart !== null
              ? (pageInfo.blockStart + (buttonIndex - 2))
              : (buttonIndex - 1); // 폴백(초기 블록 가정)
          const cur = getCurrentPageNumber();
          if (cur !== null && cur === expectedLabel) {
            logToBackground(`goToNextPage noop: 이미 ${cur}페이지 (buttonIndex=${buttonIndex})`, 'info');
            return true;
          }
        }
      } catch (e) { }
      // 내부 헬퍼: 버튼 탐색 (여러 셀렉터 + 텍스트/아이콘 매칭)
      const selectPaginationButton = () => {
        const strictSelector = `#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div:nth-child(5) > div > button:nth-child(${buttonIndex}), #sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div:nth-child(5) > div > a:nth-child(${buttonIndex})`;
        // prev/next 화살표가 1칸을 차지하는 경우 대비한 +1 오프셋 셀렉터
        const strictSelectorPlusOne = `#sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div:nth-child(5) > div > button:nth-child(${buttonIndex + 1}), #sdpReview > div > div > div.xl\\:twc-flex.xl\\:twc-gap-\\[24px\\] > div.twc-relative.xl\\:twc-flex-\\[1_1_0\\].xl\\:twc-overflow-hidden > div:nth-child(5) > div > a:nth-child(${buttonIndex + 1})`;
        const relaxedSelectors = [
          `#sdpReview div[data-page] > button:nth-child(${buttonIndex})`,
          `#sdpReview div[data-page] > a:nth-child(${buttonIndex})`,
          `#sdpReview div.twc-overflow-hidden div:nth-child(5) > div > button:nth-child(${buttonIndex})`,
          `#sdpReview div.twc-overflow-hidden div:nth-child(5) > div > a:nth-child(${buttonIndex})`,
          `#sdpReview div.twc-overflow-hidden button:nth-child(${buttonIndex})`,
          `#sdpReview div.twc-overflow-hidden a:nth-child(${buttonIndex})`
        ];
        const relaxedSelectorsPlusOne = [
          `#sdpReview div[data-page] > button:nth-child(${buttonIndex + 1})`,
          `#sdpReview div[data-page] > a:nth-child(${buttonIndex + 1})`,
          `#sdpReview div.twc-overflow-hidden div:nth-child(5) > div > button:nth-child(${buttonIndex + 1})`,
          `#sdpReview div.twc-overflow-hidden div:nth-child(5) > div > a:nth-child(${buttonIndex + 1})`,
          `#sdpReview div.twc-overflow-hidden button:nth-child(${buttonIndex + 1})`,
          `#sdpReview div.twc-overflow-hidden a:nth-child(${buttonIndex + 1})`
        ];

        const findByLabelOrIcon = () => {
          const pageInfo = getPaginationInfo();
          const container =
            pageInfo.container ||
            document.querySelector('#sdpReview div[data-page]') ||
            document.querySelector('#sdpReview div.twc-overflow-hidden div:nth-child(5) > div') ||
            document.querySelector('#sdpReview div.twc-overflow-hidden') ||
            document.querySelector('#sdpReview');
          const buttons = container ? Array.from(container.querySelectorAll('button, a, div[role="button"]')) : [];

          // 숫자 페이지 버튼은 현재 블록 시작 숫자 기준으로 찾는다.
          if (buttonIndex >= 2 && buttonIndex <= 11 && pageInfo.blockStart !== null) {
            const expectedAbsLabel = pageInfo.blockStart + (buttonIndex - 2);
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim();
              if (text === String(expectedAbsLabel)) {
                const isActive =
                  btn.classList?.contains('twc-font-bold') ||
                  btn.getAttribute('aria-current') === 'page' ||
                  btn.getAttribute('aria-current') === 'true';
                if (!isActive) return btn;
              }
            }
          }

          // next(12) 화살표 버튼
          if (buttonIndex === 12) {
            for (const btn of buttons) {
              const arrow = btn.querySelector && btn.querySelector('svg');
              // Tailwind arbitrary value class(예: twc-rotate-[180deg])는 CSS selector에서 [] 이스케이프가 필요함
              const isPrevArrow = btn.querySelector && btn.querySelector('svg.twc-rotate-\\[180deg\\]');
              if (arrow && !isPrevArrow) return btn;
            }
          }

          // 폴백: 기존 nth-child 셀렉터로 처리
          return null;
        };

        // 라벨/아이콘 매칭을 우선적으로 선택하고, 이후 셀렉터 후보를 순차적으로 사용
        const candidatesRaw = [
          findByLabelOrIcon(),
          document.querySelector(strictSelector),
          ...relaxedSelectors.map(sel => document.querySelector(sel)),
          document.querySelector(strictSelectorPlusOne),
          ...relaxedSelectorsPlusOne.map(sel => document.querySelector(sel))
        ];
        const candidates = candidatesRaw.filter((btn) => {
          if (!btn) return false;
          // 활성화된 페이지 버튼(굵은/파란색)과 이전 화살표 제외
          // Tailwind arbitrary value class(예: twc-rotate-[180deg])는 CSS selector에서 [] 이스케이프가 필요함
          const isPrevArrow = btn.querySelector && btn.querySelector('svg.twc-rotate-\\[180deg\\]');
          const isActive =
            btn.classList?.contains('twc-font-bold') ||
            btn.getAttribute('aria-current') === 'page' ||
            btn.getAttribute('aria-current') === 'true';
          return !isPrevArrow && !isActive;
        });

        return candidates[0] || null;
      };

      // 짧게 재시도하여 렌더 지연 대응
      const tryFindWithRetry = async (retries = 3) => {
        for (let i = 0; i <= retries; i++) {
          const btn = selectPaginationButton();
          if (btn) return btn;
          await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
        }
        return null;
      };

      return (async () => {
        try {
          logToBackground(`goToNextPage 단계: tryFindWithRetry 시작 (buttonIndex=${buttonIndex})`, 'info');
          const btn = await tryFindWithRetry(buttonIndex === 12 ? 8 : 3);
          if (!btn) {
            logToBackground(`goToNextPage 실패: 버튼 찾기 실패 (buttonIndex=${buttonIndex})`, 'warning');
            return false;
          }
          logToBackground(
            `goToNextPage 단계: 버튼 찾음 tag=${btn?.tagName || 'unknown'}, text='${(btn?.textContent || '').trim()}', class='${btn?.className || ''}'`,
            'info'
          );
          let style = null;
          try {
            style = getComputedStyle(btn);
          } catch (e) {
          }
          const visible = style ? (style.visibility !== 'hidden' && style.display !== 'none' && btn.offsetParent !== null) : true;
          if (btn.disabled || !visible) {
            logToBackground(`goToNextPage 실패: 버튼 비활성/비가시 (buttonIndex=${buttonIndex})`, 'warning');
            return false;
          }
          try {
            btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
          } catch (e) {
          }
          if (!checkOnly) {
            // 다음 페이지(화살표) 이동 전에 해당 줄의 첫 번째 요소(현재 페이지 버튼 등)를 먼저 클릭
            if (buttonIndex === 12) {
              const pageInfo = getPaginationInfo();
              const rowContainer =
                pageInfo.container ||
                document.querySelector('#sdpReview div[data-page]') ||
                document.querySelector('#sdpReview div.twc-overflow-hidden div:nth-child(5) > div') ||
                document.querySelector('#sdpReview div.twc-overflow-hidden') ||
                document.querySelector('#sdpReview');
              const firstInRow = rowContainer?.firstElementChild;
              if (firstInRow && firstInRow !== btn && (firstInRow.tagName === 'BUTTON' || firstInRow.tagName === 'A')) {
                try {
                  firstInRow.scrollIntoView({ block: 'center', behavior: 'instant' });
                  await sleep(CONSTANTS.WAIT_TIMES.SHORT);
                  firstInRow.click();
                  await sleep(CONSTANTS.WAIT_TIMES.MEDIUM);
                } catch (e) { }
              }
            }
            // 쿠팡은 합성 클릭을 무시할 수 있어 background의 chrome.debugger로 "진짜 클릭"을 주입
            try {
              if (cdpClickDisabled) {
                logToBackground(`debug-click 비활성화 상태: fallback click만 수행 (buttonIndex=${buttonIndex})`, 'warning');
                try { btn.click(); } catch (e) { }
              } else {
                const hasRectFn = typeof btn?.getBoundingClientRect === 'function';
                if (!hasRectFn) {
                  logToBackground(`debug-click 좌표 계산 불가: getBoundingClientRect 없음 (tag=${btn?.tagName})`, 'warning');
                  try { btn.click(); } catch (e) { }
                } else {
                  const rect = btn.getBoundingClientRect();
                  const x = Math.floor(rect.left + rect.width / 2);
                  const y = Math.floor(rect.top + rect.height / 2);

                  // debug-click 요청/응답을 반드시 로그로 남김 (원인 분기용)
                  logToBackground(
                    `debug-click 요청: idx=${buttonIndex}, text='${(btn.textContent || '').trim()}', x=${x}, y=${y}, rect=(${Math.floor(rect.left)},${Math.floor(rect.top)},${Math.floor(rect.width)},${Math.floor(rect.height)})`,
                    'info'
                  );

                  const resp = await safeSendMessage({ action: 'debug-click', payload: { x, y } });
                  if (!resp || resp.ok !== true) {
                    logToBackground(
                      `debug-click 실패/미응답: ok=${resp?.ok}, error=${resp?.error || 'none'} (fallback click)`,
                      'warning'
                    );
                    // 특정 에러(확장프로그램 URL 접근 불가)가 반복되면 CDP 클릭을 런타임 중 끔
                    const errMsg = String(resp?.error || '');
                    if (errMsg.includes('chrome-extension://') || errMsg.includes('Cannot access')) {
                      cdpClickDisabled = true;
                      logToBackground(`debug-click 자동 비활성화: error='${errMsg}'`, 'warning');
                    }
                    // 폴백: 일반 클릭 시도
                    try { btn.click(); } catch (e) { }
                  } else {
                    logToBackground(`debug-click 성공: x=${x}, y=${y}`, 'info');
                  }
                }
              }
            } catch (e) {
              logToBackground(`debug-click 처리 중 예외: ${e?.message || e}`, 'warning');
              const msg = String(e?.message || e || '');
              if (msg.includes('chrome-extension://') || msg.includes('Cannot access')) {
                cdpClickDisabled = true;
                logToBackground(`debug-click 자동 비활성화(예외): error='${msg}'`, 'warning');
              }
              try { btn.click(); } catch (e2) { }
            }
          }
          logToBackground(`goToNextPage 완료: buttonIndex=${buttonIndex}, checkOnly=${checkOnly}`, 'info');
          return true;
        } catch (error) {
          logToBackground(`goToNextPage 최상위 예외: ${error?.message || String(error)}`, 'warning');
          // DOMException은 무시하고 계속 진행 (콘솔 경고도 남기지 않음)
          if (error instanceof DOMException) {
            return true;
          }
          // 콘솔 오염 방지: background 로그로만 남김
          logToBackground(`다음 페이지 이동 중 오류(콘솔 억제): ${error?.message || String(error)}`, 'warning');
          // Fallback: 라벨 기반으로 한 번 더 클릭 시도
          try {
            const expectedLabel = buttonIndex - 1;
            const container =
              document.querySelector('#sdpReview div[data-page]') ||
              document.querySelector('#sdpReview div.twc-overflow-hidden div:nth-child(5) > div') ||
              document.querySelector('#sdpReview div.twc-overflow-hidden') ||
              document.querySelector('#sdpReview');
            const buttons = container ? Array.from(container.querySelectorAll('button')) : [];
            const fallbackBtn = buttons.find(b => {
              const text = (b.textContent || '').trim();
              return text === String(expectedLabel) && !b.disabled;
            });
            if (fallbackBtn) {
              try {
                fallbackBtn.click();
                return true;
              } catch (e) {
              }
            }
          } catch (e) {
          }
          return false;
        }
      })();
    }

    /**
     * 현재 페이지 번호 가져오기
     * @returns {number|null} - 현재 페이지 번호 (파악 불가 시 null)
     */
    function getPaginationInfo() {
      try {
        const sdpReview = safeQuerySelector('#sdpReview');
        if (!sdpReview) {
          return { container: null, numbers: [], blockStart: null, blockEnd: null, activePage: null };
        }

        const rectIntersects = (a, b) => {
          if (!a || !b) return false;
          return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
        };

        const isVisible = (el, clipRect = null) => {
          try {
            if (!el) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            if (clipRect && !rectIntersects(rect, clipRect)) return false;
            const style = getComputedStyle(el);
            if (!style) return true;
            const opacity = Number.parseFloat(style.opacity || '1');
            return style.display !== 'none' && style.visibility !== 'hidden' && opacity !== 0;
          } catch (e) {
            // getComputedStyle 실패 시에는 일단 보이는 것으로 취급
            return true;
          }
        };

        const isNumericButton = (btn) => {
          const t = (btn?.textContent || '').trim();
          return /^\d{1,4}$/.test(t);
        };

        const candidateContainers = [
          // 페이지네이션 래퍼(가장 우선)
          safeQuerySelector('#sdpReview div[data-page]'),
          safeQuerySelector('#sdpReview nav'),
          safeQuerySelector('#sdpReview div.twc-overflow-hidden div:nth-child(5) > div'),
          safeQuerySelector('#sdpReview div.twc-overflow-hidden'),
          // 최후 폴백
          sdpReview
        ].filter(Boolean);

        const getVisibleNumericButtons = (container) => {
          try {
            const clipRect = container?.getBoundingClientRect?.() || null;
            return Array.from(container.querySelectorAll('button, a'))
              .filter(isNumericButton)
              // overflow-hidden/transform 등으로 "실제로는 안 보이는" 숫자 버튼을 제외하기 위해
              // 컨테이너 rect와의 교차 여부까지 체크한다.
              .filter((el) => isVisible(el, clipRect));
          } catch (e) {
            return [];
          }
        };

        // 가장 "페이지네이션"에 가까운 컨테이너를 선택:
        // (1) 우선순위 컨테이너 중 "숫자 버튼"이 존재하는 첫 번째
        // (2) 없으면 최후 폴백(#sdpReview)
        let bestContainer = sdpReview;
        let bestButtons = getVisibleNumericButtons(bestContainer);
        for (const c of candidateContainers) {
          const btns = getVisibleNumericButtons(c);
          if (btns.length >= 2) {
            bestContainer = c;
            bestButtons = btns;
            break;
          }
        }

        const numbers = bestButtons
          .map(b => Number.parseInt((b.textContent || '').trim(), 10))
          .filter(n => !Number.isNaN(n));
        const unique = Array.from(new Set(numbers)).sort((a, b) => a - b);
        const blockStart = unique.length ? unique[0] : null;
        const blockEnd = unique.length ? unique[unique.length - 1] : null;

        // active page는 "보이는 숫자 버튼" 중에서만 판별
        const activeBtn =
          bestButtons.find(b => b.getAttribute('aria-current') === 'page' || b.getAttribute('aria-current') === 'true') ||
          // classList.contains는 실제 class 문자열을 사용해야 함 (이스케이프 문자열 사용 금지)
          bestButtons.find(b => b.classList?.contains('twc-font-bold') && b.classList?.contains('twc-text-[#346aff]')) ||
          bestButtons.find(b => b.classList?.contains('twc-font-bold')) ||
          null;
        const activePage = activeBtn ? Number.parseInt((activeBtn.textContent || '').trim(), 10) : null;

        return { container: bestContainer, numbers: unique, blockStart, blockEnd, activePage: Number.isNaN(activePage) ? null : activePage };
      } catch (e) {
        return { container: null, numbers: [], blockStart: null, blockEnd: null, activePage: null };
      }
    }

    function getCurrentPageNumber() {
      try {
        const info = getPaginationInfo();
        return info.activePage;
      } catch (e) {
      }
      return null;
    }

    /**
     * 첫 리뷰 기반 DOM 시그니처 (페이지 이동 감지용)
     * @returns {string}
     */
    function getFirstReviewSignatureFromDom() {
      try {
        const container = safeQuerySelector('#sdpReview') || document;
        // 상단 안내/요약(article로 렌더되는 경우 포함)을 시그니처에 쓰면 페이지 이동 감지가 깨짐.
        // data-review-id가 있는 "실제 리뷰 카드"만 대상으로 시그니처를 만든다.
        const candidates = Array.from(safeQuerySelectorAll('article, div[class*="review"], div[class*="comment"]', container));
        const reviewCards = candidates.filter((el) => {
          if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
          const hasReviewId =
            el.hasAttribute('data-review-id') ||
            el.hasAttribute('data-reviewid') ||
            !!safeQuerySelector('[data-review-id],[data-reviewid]', el);
          // 일부 페이지/로딩 상태에서는 data-review-id가 늦게 붙거나 없을 수 있어, 작성자/날짜 기반으로도 리뷰로 인정
          const hasMember = !!safeQuerySelector('[data-member-id]', el);
          const hasTime = !!safeQuerySelector('time', el);
          return hasReviewId || (hasMember && hasTime);
        });
        const topCards = reviewCards.slice(0, 3);
        if (!topCards.length) return '';

        const pageNum = getCurrentPageNumber();
        const parts = topCards.map(a => {
          const rid =
            a.getAttribute('data-review-id') ||
            a.getAttribute('data-reviewid') ||
            (safeQuerySelector('[data-review-id],[data-reviewid]', a)?.getAttribute('data-review-id') ||
              safeQuerySelector('[data-review-id],[data-reviewid]', a)?.getAttribute('data-reviewid')) ||
            '';
          const authorText = safeGetText(safeQuerySelector('[data-member-id]', a)).substring(0, 30);
          const dateText = safeGetText(safeQuerySelector('time', a)).substring(0, 30);
          const key = `${rid}|${authorText}|${dateText}`;
          return key;
        });

        return `p=${pageNum || 'na'};n=${topCards.length};${parts.join('||')}`;
      } catch (e) {
        return '';
      }
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

})();
