
const productUrlInput = document.getElementById('productUrl');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const progressDiv = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultsDiv = document.getElementById('results');
const resultInfo = document.getElementById('resultInfo');
const downloadJsonBtn = document.getElementById('downloadJson');
const downloadExcelBtn = document.getElementById('downloadExcel');
const copyTableBtn = document.getElementById('copyTableBtn');


let isCollecting = false;
let collectedReviews = null;
let productId = null;
let productName = null; // 다운로드 파일명용 제품명
let filteredReviews = null;
let currentPage = 1;
const itemsPerPage = 10;
let currentTabId = null;
let selectedRatingFilters = []; // 선택된 별점 필터 저장

/** 수집 데이터 정확성: reviews는 항상 배열로 유지 */
function ensureReviewsArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'object' && Array.isArray(value.reviews)) return value.reviews;
  return [];
}

function sanitizeFilenamePart(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

/**
 * Blob을 지정한 파일명으로 다운로드.
 * 파일명이 겹치면 덮어쓰기(conflictAction: 'overwrite').
 */
function triggerBlobDownload(blob, filename) {
  const name = filename || 'review.csv';
  const url = URL.createObjectURL(blob);
  if (chrome.downloads && typeof chrome.downloads.download === 'function') {
    chrome.downloads.download(
      { url, filename: name, conflictAction: 'overwrite', saveAs: false },
      () => {
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch (e) { }
        }, 1000);
      }
    );
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  const body = document.body;
  if (body) {
    body.appendChild(a);
    a.click();
    body.removeChild(a);
  } else {
    a.click();
  }
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch (e) { }
  }, 500);
}

/** 다운로드 파일명에 쓸 문자열(제품명, 사이트 구분) 반환. 저장된 수집 데이터(productName·source)를 우선 사용하고, 없으면 현재 탭 제품명·탭 제목·'review' 순. */
async function getDownloadFilenameBase() {
  let nameBase = 'review';
  let source = '';

  try {
    const storageKey = currentTabId ? `collection_${currentTabId}` : null;
    const keysToGet = storageKey ? [storageKey, 'lastCollection'] : ['lastCollection'];
    const st = await chrome.storage.local.get(keysToGet).catch(() => ({}));
    const collection = (storageKey && st[storageKey]) ? st[storageKey] : (st.lastCollection || null);
    if (collection) {
      if (collection.productName != null && String(collection.productName).trim()) {
        nameBase = sanitizeFilenamePart(String(collection.productName).trim());
      }
      if (collection.source != null && String(collection.source).trim() && String(collection.source).trim() !== 'unknown') {
        source = String(collection.source).trim();
      }
    }
  } catch (e) { }

  if (nameBase === 'review' && productName && String(productName).trim()) {
    nameBase = sanitizeFilenamePart(productName);
  }
  if (nameBase === 'review') {
    try {
      const tabId = currentTabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabId) {
        const name = await new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(tabId, { action: 'getProductName' }, (response) => {
              if (chrome.runtime?.lastError) { resolve(''); return; }
              resolve((response && response.productName) ? String(response.productName).trim() : '');
            });
          } catch (e) { resolve(''); }
        });
        if (name) nameBase = sanitizeFilenamePart(name);
      }
    } catch (e) { }
  }
  if (nameBase === 'review') {
    try {
      if (currentTabId) {
        const tab = await chrome.tabs.get(currentTabId).catch(() => null);
        if (tab?.title?.trim()) nameBase = sanitizeFilenamePart(tab.title);
      }
      if (nameBase === 'review') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        if (tab?.title?.trim()) nameBase = sanitizeFilenamePart(tab.title);
      }
    } catch (e) { }
  }

  if (!source || source === 'unknown') {
    try {
      const st = await chrome.storage.local.get(['lastCollection']).catch(() => ({}));
      source = (st.lastCollection && st.lastCollection.source) ? String(st.lastCollection.source).trim() : '';
    } catch (e) { }
  }
  if (!source || source === 'unknown') {
    try {
      const tabIdForUrl = currentTabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabIdForUrl) {
        const tab = await chrome.tabs.get(tabIdForUrl).catch(() => null);
        const url = (tab && tab.url) ? String(tab.url) : '';
        if (/coupang\.com/.test(url) && (/\/vp\/products\//.test(url) || /\/products\//.test(url))) source = 'coupang';
        else if (/smartstore\.naver\.com/.test(url) && /\/products\//.test(url)) source = 'smartstore';
        else if (/brand\.naver\.com/.test(url) && /\/products\//.test(url)) source = 'brand';
      }
    } catch (e) { }
  }

  return { nameBase: nameBase || 'review', source: source || 'unknown' };
}


function addLog(message, type = 'info') {
  saveLogToStorage(message, type, new Date().toLocaleTimeString('ko-KR'), currentTabId);
}

function saveLogToStorage(message, type, time, tabId = null) {
  const logKey = tabId ? `collectionLogs_${tabId}` : 'collectionLogs';
  chrome.storage.local.get([logKey], (result) => {
    const logs = result[logKey] || [];
    logs.push({ message, type, time, timestamp: Date.now() });
    if (logs.length > 200) logs.shift();
    chrome.storage.local.set({ [logKey]: logs });
  });
}


function loadLogsFromStorage() {
  const logKey = currentTabId ? `collectionLogs_${currentTabId}` : 'collectionLogs';
  chrome.storage.local.get([logKey], (result) => {
    const logs = result[logKey] || [];
    if (logs.length === 0) return;
    // 필요 시 로그 UI에 반영 (현재는 저장만 탭별 격리)
  });
}


/**
 * 쿠팡 상품 URL에서 쿼리 파라미터를 제거하고 기본 상품 URL만 반환
 * @param {string} url - 원본 쿠팡 상품 URL
 * @returns {string} - 정규화된 URL (쿼리 파라미터 제거)
 */
function normalizeCoupangUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  // 쿠팡 상품 URL 패턴: https://www.coupang.com/vp/products/{상품ID}?...
  const urlPattern = /^(https?:\/\/[^/]+\/vp\/products\/\d+)/;
  const match = urlPattern.exec(url);
  if (match) {
    return match[1];
  }

  // 매칭되지 않으면 원본 반환
  return url;
}

/**
 * 네이버 스마트스토어/브랜드스토어 상품 URL을 정규화 (쿼리 제거 등)
 * @param {string} url - 원본 네이버 상품 URL
 * @returns {string} - 정규화된 URL (smartstore 또는 brand + /{store}/products/{productId})
 */
function normalizeNaverUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  // smartstore.naver.com/{store}/products/{productId}?...
  let match = url.match(/^(https?:\/\/smartstore\.naver\.com\/[^/]+\/products\/\d+)/);
  if (match) return match[1];
  // brand.naver.com/{store}/products/{productId}?...
  match = url.match(/^(https?:\/\/brand\.naver\.com\/[^/]+\/products\/\d+)/);
  if (match) return match[1];
  return url;
}


async function loadCurrentPageUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabId = tab.id;
      const u = tab.url;
      let normalizedUrl = u;
      if (u.includes('coupang.com')) {
        normalizedUrl = normalizeCoupangUrl(u);
      } else if ((u.includes('smartstore.naver.com') || u.includes('brand.naver.com')) && u.includes('/products/')) {
        normalizedUrl = normalizeNaverUrl(u);
      }
      productUrlInput.value = normalizedUrl;
      productUrlInput.disabled = true;
    }
  } catch (error) {
  }
}


if (startBtn) {
  startBtn.addEventListener('click', async () => {
    let url = productUrlInput.value.trim();

    if (!url) {
      showStatus('쿠팡 또는 네이버 스마트스토어/브랜드스토어 상품 URL을 입력해주세요.', 'error');
      return;
    }

    const isCoupang = url.includes('coupang.com') && (url.includes('/vp/products/') || url.includes('/products/'));
    const isNaver = (url.includes('smartstore.naver.com') || url.includes('brand.naver.com')) && url.includes('/products/');

    if (isCoupang) {
      url = normalizeCoupangUrl(url);
    } else if (isNaver) {
      url = normalizeNaverUrl(url);
    }

    if (!isCoupang && !isNaver) {
      showStatus('유효한 쿠팡 또는 네이버 스마트스토어/브랜드스토어 상품 URL이 아닙니다.', 'error');
      return;
    }

    let tempProductId = null;
    const match = url.match(/\/products\/(\d+)/);
    if (match) {
      tempProductId = match[1];
    }

    if (!tempProductId) {
      showStatus('상품 ID를 찾을 수 없습니다.', 'error');
      return;
    }

    productId = tempProductId;
    isCollecting = true;

    startBtn.disabled = true;
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    progressDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    statusDiv.classList.remove('hidden');
    addLog('리뷰 수집을 시작합니다...', 'info');
    showStatus('리뷰 수집을 시작합니다...', 'info');
    updateProgress(0, '초기화 중...');

    setupMessageListener();

    addLog('Background Script에 수집 요청 전송 중...', 'info');
    addLog(`URL: ${url}`, 'info');
    addLog(`상품 ID: ${productId}`, 'info');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        addLog(`현재 탭 ID 가져오기 실패: ${chrome.runtime.lastError.message}`, 'error');
      }

      const currentTabId = tabs && tabs[0] ? tabs[0].id : null;

      if (!currentTabId) {
        addLog('현재 탭 ID를 가져올 수 없습니다. 새로고침 후 다시 시도해주세요.', 'info');
      }

      try {
        // 체크박스에서 선택된 별점 필터 가져오기
        const ratingCheckboxes = document.querySelectorAll('input[name="ratingFilter"]:checked');
        let ratingFilters = [];

        // "모든 별점"이 선택되어 있거나 아무것도 선택되지 않았으면 'all'
        if (ratingCheckboxes.length === 0 ||
          Array.from(ratingCheckboxes).some(cb => cb.value === 'all')) {
          ratingFilters = ['all'];
        } else {
          // 선택된 별점들을 배열로 저장 (all 제외)
          ratingFilters = Array.from(ratingCheckboxes)
            .map(cb => cb.value)
            .filter(val => val !== 'all');
        }

        // 여러 별점이 선택된 경우 순차적으로 처리
        if (ratingFilters.length === 0) {
          showStatus('별점을 선택해주세요.', 'error');
          resetUI();
          return;
        }

        // 여러 필터를 배열로 한 번에 전달하여 하나의 페이지에서 순차 처리
        const ratingNames = {
          'all': '모든 별점',
          '5': '최고(5)',
          '4': '좋음(4)',
          '3': '보통(3)',
          '2': '별로(2)',
          '1': '나쁨(1)'
        };

        if (ratingFilters.length > 1) {
          const filterNames = ratingFilters.map(f => ratingNames[f] || f).join(', ');
          addLog(`다중 필터 수집 시작: ${filterNames}`, 'info');
          showStatus(`${ratingFilters.length}개 별점 필터링 후 순차 수집 시작...`, 'info');
        } else {
          const filterName = ratingNames[ratingFilters[0]] || ratingFilters[0];
          addLog(`${filterName} 필터링 후 추출 시작...`, 'info');
          showStatus(`${filterName} 필터링 후 추출 시작...`, 'info');
        }

        const isNaverUrl = url.includes('smartstore.naver.com') || url.includes('brand.naver.com');
        chrome.runtime.sendMessage(
          {
            action: 'startCollection',
            url: url,
            productId: productId,
            originalTabId: currentTabId,
            ratingFilters: ratingFilters, // 배열로 전달
            isMultiFilter: ratingFilters.length > 1,
            tabId: isNaverUrl ? currentTabId : undefined
          },
          (bgResponse) => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message;
              addLog(`Background Script 오류: ${errorMsg}`, 'error');
              showStatus('오류: ' + errorMsg, 'error');
              resetUI();
              return;
            }

            if (bgResponse && bgResponse.success) {
              if (ratingFilters.length > 1) {
                addLog(`총 ${ratingFilters.length}개 별점 필터링 후 순차 수집이 시작되었습니다.`, 'success');
                showStatus(`총 ${ratingFilters.length}개 별점 필터링 후 순차 수집이 시작되었습니다.`, 'success');
              } else if (isNaverUrl) {
                showStatus('수집이 시작되었습니다. 이 탭에서 진행됩니다...', 'success');
              } else {
                showStatus('수집이 시작되었습니다. 새 창에서 진행됩니다...', 'success');
              }
            } else if (bgResponse && !bgResponse.success) {
              const errorMsg = bgResponse.error || '알 수 없는 오류';
              addLog(`수집 시작 실패: ${errorMsg}`, 'error');
              showStatus('오류: ' + errorMsg, 'error');
              resetUI();
            } else {
              addLog('Background Script 응답이 없습니다. 수집이 시작되었을 수 있습니다.', 'info');
              showStatus('수집이 시작되었을 수 있습니다. 새 창을 확인하세요.', 'info');
            }
          }
        );
      } catch (error) {
        addLog(`메시지 전송 실패: ${error.message}`, 'error');
        showStatus('오류: 메시지 전송 실패', 'error');
        resetUI();
        return;
      }
    });
  });
}


stopBtn.addEventListener('click', async () => {
  isCollecting = false;
  showStatus('수집 중지 요청 중... 현재까지 수집한 데이터를 처리합니다.', 'info');

  stopBtn.disabled = true;
  stopBtn.textContent = '중지 중...';

  try {
    chrome.runtime.sendMessage({
      action: 'stopCollection',
      originalTabId: currentTabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('중지 요청 중 오류가 발생했습니다: ' + chrome.runtime.lastError.message, 'error');
        stopBtn.disabled = false;
        stopBtn.textContent = '중지';
      } else {
        setTimeout(() => {
          if (isCollecting) {
            isCollecting = false;
            resetUI();
            showStatus('수집이 중지되었습니다.', 'info');
          }
        }, 2000);
      }
    });
  } catch (error) {
    showStatus('중지 요청 중 오류가 발생했습니다: ' + error.message, 'error');
    stopBtn.disabled = false;
    stopBtn.textContent = '중지';
  }
});


downloadJsonBtn.addEventListener('click', async () => {
  const reviews = ensureReviewsArray(filteredReviews);
  if (reviews.length === 0) {
    showStatus('다운로드할 리뷰가 없습니다.', 'error');
    return;
  }
  try {
    const { nameBase, source } = await getDownloadFilenameBase();
    const filename = `review_${nameBase}_${source}.json`;
    const jsonData = JSON.stringify(reviews, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    triggerBlobDownload(blob, filename);
    showStatus('JSON 파일 다운로드 완료.', 'success');
  } catch (e) {
    showStatus('다운로드 실패: ' + (e?.message || String(e)), 'error');
  }
});


downloadExcelBtn.addEventListener('click', async () => {
  const reviews = ensureReviewsArray(filteredReviews);
  if (reviews.length === 0) {
    showStatus('다운로드할 리뷰가 없습니다.', 'error');
    return;
  }
  try {
    const { nameBase, source } = await getDownloadFilenameBase();
    // CSV 변환 함수
    function escapeCsvValue(value) {
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      // 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 이스케이프
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
      }
      return stringValue;
    }

    // 헤더 정의
    const headers = ['날짜', '작성자', '별점', '제목', '내용', '상품평가'];

    // CSV 데이터 생성
    const csvRows = [];

    // 헤더 추가
    csvRows.push(headers.map(escapeCsvValue).join(','));

    // 데이터 행 추가
    reviews.forEach(review => {
      const row = [
        review && review.date != null ? String(review.date) : '',
        review && review.author != null ? String(review.author) : '',
        review && review.rating != null ? String(review.rating) : '',
        review && review.title != null ? String(review.title) : '',
        review && review.content != null ? String(review.content) : '',
        review && review.productEvaluation != null ? String(review.productEvaluation) : ''
      ];
      csvRows.push(row.map(escapeCsvValue).join(','));
    });

    // CSV 문자열 생성
    const csvContent = csvRows.join('\n');

    // UTF-8 BOM 추가 (한글 깨짐 방지)
    const BOM = '\uFEFF';
    const csvWithBom = BOM + csvContent;

    // Blob 생성 (CSV 형식)
    const blob = new Blob([csvWithBom], {
      type: 'text/csv;charset=utf-8;'
    });
    const filename = `review_${nameBase}_${source}.csv`;

    triggerBlobDownload(blob, filename);
    showStatus('CSV 파일 다운로드가 시작되었습니다.', 'success');
  } catch (error) {
    showStatus('CSV 변환 실패: ' + (error?.message || String(error)), 'error');
  }
});


// 테이블 복사 기능
if (copyTableBtn) {
  copyTableBtn.addEventListener('click', async () => {
    const list = ensureReviewsArray(filteredReviews);
    if (list.length === 0) {
      showStatus('복사할 리뷰가 없습니다.', 'error');
      return;
    }

    const headers = ['번호', '날짜', '작성자', '평점', '제목', '내용', '상품평가'];

    const rows = list.map((review, index) => {
      const date = review && review.date != null ? String(review.date) : '';
      const author = review && review.author != null ? String(review.author) : '';
      const rating = Number.parseInt(String(review?.rating ?? ''), 10) || 0;
      const title = review && review.title != null ? String(review.title) : '';
      const content = review && review.content != null ? String(review.content) : '';
      const productEvaluation = review && review.productEvaluation != null ? String(review.productEvaluation) : '';

      // 탭으로 구분된 텍스트 형식
      return [
        (index + 1).toString(),
        date,
        author,
        `${rating}점`,
        title.replace(/\t/g, ' ').replace(/\n/g, ' '),
        content.replace(/\t/g, ' ').replace(/\n/g, ' '),
        productEvaluation.replace(/\t/g, ' ').replace(/\n/g, ' ')
      ].join('\t');
    });

    // 헤더와 데이터 결합
    const tableText = [
      headers.join('\t'),
      ...rows
    ].join('\n');

    try {
      // 클립보드에 복사
      await navigator.clipboard.writeText(tableText);

      // 성공 메시지 표시
      const originalText = copyTableBtn.textContent;
      copyTableBtn.textContent = '✓ 복사됨';
      copyTableBtn.disabled = true;
      showStatus(`테이블이 클립보드에 복사되었습니다. (${list.length}개 리뷰)`, 'success');

      // 2초 후 원래 텍스트로 복원
      setTimeout(() => {
        copyTableBtn.textContent = originalText;
        copyTableBtn.disabled = false;
      }, 2000);
    } catch (error) {
      console.error('복사 실패:', error);

      // 대체 방법: 텍스트 영역 사용
      try {
        const textArea = document.createElement('textarea');
        textArea.value = tableText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          const originalText = copyTableBtn.textContent;
          copyTableBtn.textContent = '✓ 복사됨';
          copyTableBtn.disabled = true;
          showStatus(`테이블이 클립보드에 복사되었습니다. (${filteredReviews.length}개 리뷰, 대체 방법)`, 'success');

          setTimeout(() => {
            copyTableBtn.textContent = originalText;
            copyTableBtn.disabled = false;
          }, 2000);
        } else {
          showStatus('복사 실패: 클립보드 접근 권한이 필요합니다.', 'error');
        }
      } catch (fallbackError) {
        console.error('대체 복사 방법 실패:', fallbackError);
        showStatus('복사 실패: 클립보드 접근 권한이 필요합니다.', 'error');
      }
    }
  });
}


function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');
}


function updateProgress(percent, text) {
  progressFill.style.width = percent + '%';
  progressText.textContent = text || `${percent}%`;
}


function updatePagination() {
  const list = ensureReviewsArray(filteredReviews);
  if (list.length === 0) {
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = '1 / 1';
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));
  const pageInfo = document.getElementById('pageInfo');
  if (pageInfo) {
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
  }

  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  if (prevBtn) prevBtn.disabled = currentPage === 1;
  if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
}


function renderReviewTable() {
  const list = ensureReviewsArray(filteredReviews);
  if (list.length === 0) {
    const tbody = document.getElementById('reviewTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">표시할 리뷰가 없습니다.</td></tr>';
    }
    updatePagination();
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageReviews = list.slice(startIndex, endIndex);

  const tbody = document.getElementById('reviewTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  pageReviews.forEach((review, index) => {
    const row = document.createElement('tr');
    const globalIndex = startIndex + index + 1;

    const date = review && review.date != null ? String(review.date) : '날짜 없음';
    const author = review && review.author != null ? String(review.author) : '작성자 없음';
    const rating = Number.parseInt(String(review?.rating ?? ''), 10) || 0;
    const title = review && review.title != null ? String(review.title) : '(제목 없음)';
    const content = review && review.content != null ? String(review.content) : '(내용 없음)';
    const productEvaluation = review && review.productEvaluation != null ? String(review.productEvaluation) : '(평가 없음)';

    const truncatedTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
    const truncatedContent = content.length > 50 ? content.substring(0, 50) + '...' : content;
    const truncatedEvaluation = productEvaluation.length > 50 ? productEvaluation.substring(0, 50) + '...' : productEvaluation;

    row.innerHTML = `
      <td>${globalIndex}</td>
      <td>${date}</td>
      <td>${author}</td>
      <td><span class="rating-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span> (${rating})</td>
      <td class="review-content-cell" title="${title.replace(/"/g, '&quot;')}">${truncatedTitle}</td>
      <td class="review-content-cell" title="${content.replace(/"/g, '&quot;')}">${truncatedContent}</td>
      <td class="review-content-cell" title="${productEvaluation.replace(/"/g, '&quot;')}">${truncatedEvaluation}</td>
    `;

    tbody.appendChild(row);
  });

  updatePagination();
}


function showResults(count, isStopped = false) {
  const n = Number(count);
  const safeCount = Number.isFinite(n) && n >= 0 ? n : 0;
  const statusText = isStopped
    ? '<strong>수집 중지됨</strong><br>'
    : '<strong>수집 완료!</strong><br>';

  if (resultInfo) {
    resultInfo.innerHTML = `${statusText}총 <strong>${safeCount}개</strong>의 리뷰가 수집되었습니다.`;
  }
  if (resultsDiv) {
    resultsDiv.classList.remove('hidden');
  }

  filterReviewsByCurrentTab();
  currentPage = 1;
  renderReviewTable();
}


function filterReviewsByCurrentTab() {
  const reviews = ensureReviewsArray(collectedReviews);
  if (reviews.length === 0) {
    filteredReviews = [];
    return;
  }

  if (currentTabId != null) {
    const tabStr = String(currentTabId);
    filteredReviews = reviews.filter(review => review && review.originalTabId != null && String(review.originalTabId) === tabStr);
  } else {
    filteredReviews = [...reviews];
  }
}


async function loadReviewsForCurrentTab() {
  if (!currentTabId) {
    return;
  }

  const storageKey = `collection_${currentTabId}`;
  chrome.storage.local.get([storageKey, 'lastCollection'], (result) => {
    if (!result || typeof result !== 'object') return;
    if (result[storageKey] && result[storageKey].reviews) {
      const collectionData = result[storageKey];
      collectedReviews = ensureReviewsArray(collectionData.reviews);
      productName = collectionData.productName != null ? String(collectionData.productName) : productName;

      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review && review.rating != null ? String(review.rating) : '';
          return selectedRatingFilters.includes(reviewRating);
        });
      }

      filteredReviews = [...collectedReviews];
      showResults(collectedReviews.length, Boolean(collectionData.stopped));
    } else if (result.lastCollection && result.lastCollection.reviews) {
      collectedReviews = ensureReviewsArray(result.lastCollection.reviews);
      productName = result.lastCollection.productName != null ? String(result.lastCollection.productName) : productName;

      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review && review.rating != null ? String(review.rating) : '';
          return selectedRatingFilters.includes(reviewRating);
        });
      }

      filterReviewsByCurrentTab();
      showResults(filteredReviews ? filteredReviews.length : 0, Boolean(result.lastCollection.stopped));
    }
  });
}


function updateTabIdFilter() {
  const reviews = ensureReviewsArray(collectedReviews);
  if (reviews.length === 0) return;

  const tabIdFilter = document.getElementById('tabIdFilter');
  if (!tabIdFilter) return;

  tabIdFilter.innerHTML = '<option value="all">모든 탭</option>';

  const uniqueTabIds = [...new Set(reviews.map(r => r && r.originalTabId).filter(id => id !== null && id !== undefined))];

  uniqueTabIds.forEach(tabId => {
    const option = document.createElement('option');
    option.value = tabId;
    option.textContent = `탭 ID: ${tabId}`;
    tabIdFilter.appendChild(option);
  });
}


function resetUI() {
  isCollecting = false;
  startBtn.disabled = false;
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
}


function restoreState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'getCollectionStatus',
      originalTabId: currentTabId
    }, async (response) => {
      if (chrome.runtime.lastError) {
        await loadCurrentPageUrl();
        resolve();
        return;
      }

      if (response && response.isCollecting) {
        isCollecting = true;
        productId = response.productId;

        await loadCurrentPageUrl();

        startBtn.disabled = true;
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        progressDiv.classList.remove('hidden');
        statusDiv.classList.remove('hidden');

        showStatus('수집이 진행 중입니다. 중지 버튼을 눌러 중지할 수 있습니다.', 'info');

        loadLogsFromStorage();

        const progressStorageKey = currentTabId ? `collectionProgress_${currentTabId}` : 'collectionProgress';
        chrome.storage.local.get([progressStorageKey], (progressResult) => {
          const progress = progressResult[progressStorageKey];
          if (progress) {
            updateProgress(progress.percent, progress.text);
          } else {
            updateProgress(0, '수집 중...');
          }
        });

        setupMessageListener();
        resolve();
      } else {
        await loadCurrentPageUrl();

        chrome.storage.local.get(['lastUrl'], async (result) => {

          // 현재 탭의 데이터와 lastCollection 모두 확인
          const storageKey = currentTabId ? `collection_${currentTabId}` : null;
          const keysToGet = storageKey ? [storageKey, 'lastCollection'] : ['lastCollection'];

          chrome.storage.local.get(keysToGet, (result) => {
            // 현재 탭의 데이터를 우선적으로 확인
            if (storageKey && result[storageKey] && result[storageKey].reviews) {
              const collectionData = result[storageKey];
              collectedReviews = ensureReviewsArray(collectionData.reviews);
              productName = collectionData.productName != null ? String(collectionData.productName) : productName;

              if (selectedRatingFilters.length > 0) {
                collectedReviews = collectedReviews.filter(review => {
                  const reviewRating = review && review.rating != null ? String(review.rating) : '';
                  return selectedRatingFilters.includes(reviewRating);
                });
              }

              filteredReviews = [...collectedReviews];
              showResults(collectedReviews.length, Boolean(collectionData.stopped));
            } else if (result.lastCollection && result.lastCollection.reviews) {
              collectedReviews = ensureReviewsArray(result.lastCollection.reviews);
              productName = result.lastCollection.productName != null ? String(result.lastCollection.productName) : productName;

              if (selectedRatingFilters.length > 0) {
                collectedReviews = collectedReviews.filter(review => {
                  const reviewRating = review && review.rating != null ? String(review.rating) : '';
                  return selectedRatingFilters.includes(reviewRating);
                });
              }

              filterReviewsByCurrentTab();
              showResults(filteredReviews ? filteredReviews.length : 0, Boolean(result.lastCollection.stopped));
            }
            resolve();
          });
        });
      }
      return true;
    });
  });
}


function setupMessageListener() {
  if (window.messageListener) {
    chrome.runtime.onMessage.removeListener(window.messageListener);
  }

  window.messageListener = (message, sender, sendResponse) => {
    if (message.originalTabId && message.originalTabId !== currentTabId) {
      return;
    }

    if (message.action === 'progress') {
      updateProgress(message.percent, message.text);
      if (message.log) {
        addLog(message.log, message.logType || 'info');
      }
    } else if (message.action === 'log') {
      addLog(message.message, message.type || 'info');
    } else if (message.action === 'complete') {
      collectedReviews = ensureReviewsArray(message.reviews);
      productName = message.productName != null ? String(message.productName) : productName;
      const isStopped = Boolean(message.stopped);

      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review && review.rating != null ? String(review.rating) : '';
          return selectedRatingFilters.includes(reviewRating);
        });
        addLog(`수집 완료: 총 ${collectedReviews.length}개 중 선택한 별점(${selectedRatingFilters.join(',')}점) ${collectedReviews.length}개 리뷰`, 'success');
      } else {
        addLog(`수집 완료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'success');
      }

      if (isStopped) {
        showStatus(`수집이 중지되었습니다. 현재까지 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'info');
      } else {
        showStatus(`수집 완료! 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'success');
      }
      filterReviewsByCurrentTab();
      const displayCount = filteredReviews ? filteredReviews.length : 0;
      showResults(displayCount, isStopped);
      resetUI();
      chrome.runtime.onMessage.removeListener(window.messageListener);
      window.messageListener = null;
    } else if (message.action === 'stopped') {
      if (message.reviews !== undefined) {
        collectedReviews = ensureReviewsArray(message.reviews);
        productName = message.productName != null ? String(message.productName) : productName;
        addLog(`수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'info');
        showStatus(message.message || `수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'info');
        filterReviewsByCurrentTab();
        const displayCount = filteredReviews ? filteredReviews.length : 0;
        showResults(displayCount, true);
      } else {
        addLog('수집이 중지되었습니다.', 'info');
        showStatus(message.message || '수집이 중지되었습니다.', 'info');
      }
      resetUI();
      chrome.runtime.onMessage.removeListener(window.messageListener);
      window.messageListener = null;
    } else if (message.action === 'error') {
      addLog(`오류: ${message.error}`, 'error');
      showStatus('오류: ' + message.error, 'error');
      resetUI();
      chrome.runtime.onMessage.removeListener(window.messageListener);
      window.messageListener = null;
    }
  };

  chrome.runtime.onMessage.addListener(window.messageListener);
}


// 별점 필터 체크박스 상호작용 로직
const ratingCheckboxes = document.querySelectorAll('input[name="ratingFilter"]');
if (ratingCheckboxes.length > 0) {
  ratingCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const clickedCheckbox = e.target;

      if (clickedCheckbox.value === 'all') {
        // "모든 별점"이 선택되면 다른 체크박스 모두 해제
        if (clickedCheckbox.checked) {
          ratingCheckboxes.forEach(cb => {
            if (cb.value !== 'all') {
              cb.checked = false;
            }
          });
        }
      } else {
        // 다른 체크박스가 선택되면 "모든 별점" 해제
        if (clickedCheckbox.checked) {
          const allCheckbox = document.getElementById('ratingAll');
          if (allCheckbox) {
            allCheckbox.checked = false;
          }
        }
      }
    });
  });
}

restoreState().then(() => {
  if (!isCollecting) {
    setTimeout(() => {
      loadReviewsForCurrentTab();
    }, 100);
  }
}).catch(err => {
});




productUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ lastUrl: productUrlInput.value });
});


window.addEventListener('beforeunload', () => {
  if (window.messageListener) {
    chrome.runtime.onMessage.removeListener(window.messageListener);
    window.messageListener = null;
  }
});


document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabName}Tab`).classList.add('active');
  });
});


const prevPageBtn = document.getElementById('prevPage');
if (prevPageBtn) {
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderReviewTable();
    }
  });
}


const nextPageBtn = document.getElementById('nextPage');
if (nextPageBtn) {
  nextPageBtn.addEventListener('click', () => {
    if (!filteredReviews) return;
    const totalPages = Math.ceil(filteredReviews.length / itemsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderReviewTable();
    }
  });
}


const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (!collectedReviews) return;

    filterReviewsByCurrentTab();
    let baseReviews = filteredReviews || [];

    if (searchTerm === '') {
      filteredReviews = baseReviews;
    } else {
      filteredReviews = baseReviews.filter(review => {
        const content = (review.content || '').toLowerCase();
        const date = (review.date || '').toLowerCase();
        return content.includes(searchTerm) || date.includes(searchTerm);
      });
    }

    currentPage = 1;
    renderReviewTable();
  });
}


// 정렬 기준 라디오 버튼 이벤트 리스너
const sortRadioButtons = document.querySelectorAll('input[name="sortSelect"]');
if (sortRadioButtons.length > 0) {
  sortRadioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (!collectedReviews) return;

      const sortValue = e.target.value;

      filterReviewsByCurrentTab();

      filteredReviews.sort((a, b) => {
        switch (sortValue) {
          case 'date-desc':
            return new Date(b.date || 0) - new Date(a.date || 0);
          case 'date-asc':
            return new Date(a.date || 0) - new Date(b.date || 0);
          case 'rating-desc':
            return (b.rating || 0) - (a.rating || 0);
          case 'rating-asc':
            return (a.rating || 0) - (b.rating || 0);
          default:
            return 0;
        }
      });

      currentPage = 1;
      renderReviewTable();
    });
  });
}
