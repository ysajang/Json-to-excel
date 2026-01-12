
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
let filteredReviews = null;
let currentPage = 1;
const itemsPerPage = 10;
let currentTabId = null;
let selectedRatingFilters = []; // 선택된 별점 필터 저장


function addLog(message, type = 'info') {
  saveLogToStorage(message, type, new Date().toLocaleTimeString('ko-KR'));
}


function saveLogToStorage(message, type, time) {
  chrome.storage.local.get(['collectionLogs'], (result) => {
    const logs = result.collectionLogs || [];
    logs.push({ message, type, time, timestamp: Date.now() });

    if (logs.length > 200) {
      logs.shift();
    }

    chrome.storage.local.set({ collectionLogs: logs });
  });
}


function loadLogsFromStorage() {
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


async function loadCurrentPageUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabId = tab.id;

      // URL 정규화: 쿼리 파라미터 제거
      const normalizedUrl = normalizeCoupangUrl(tab.url);
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
      showStatus('쿠팡 상품 URL을 입력해주세요.', 'error');
      return;
    }

    // URL 정규화: 쿼리 파라미터 제거
    url = normalizeCoupangUrl(url);

    if (!url.includes('coupang.com/vp/products/')) {
      showStatus('유효한 쿠팡 상품 URL이 아닙니다.', 'error');
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

        chrome.runtime.sendMessage(
          {
            action: 'startCollection',
            url: url,
            productId: productId,
            originalTabId: currentTabId,
            ratingFilters: ratingFilters, // 배열로 전달
            isMultiFilter: ratingFilters.length > 1
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
  if (!collectedReviews) return;

  let tabTitle = 'review';
  try {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    }
  } catch (error) {
  }

  const jsonData = JSON.stringify(collectedReviews, null, 2);
  const blob = new Blob([jsonData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = `review_${tabTitle}.json`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      showStatus('다운로드 실패: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('JSON 파일 다운로드 완료.', 'success');
    }
  });
});


downloadExcelBtn.addEventListener('click', async () => {
  if (!collectedReviews) return;

  let tabTitle = 'review';
  try {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    }
  } catch (error) {
  }

  chrome.runtime.sendMessage({
    action: 'convertToExcel',
    reviews: collectedReviews,
    productId: productId
  }, (response) => {
    if (response && response.success && response.csvContent) {
      const blob = new Blob([response.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const filename = `review_${tabTitle}.csv`;

      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 500);

        if (chrome.runtime.lastError) {
          showStatus('다운로드 실패: ' + chrome.runtime.lastError.message, 'error');
        } else {
          showStatus('Excel 파일 다운로드가 시작되었습니다. (CSV 형식)', 'success');
        }
      });
    } else {
      showStatus('Excel 변환 실패: ' + (response?.error || '알 수 없는 오류'), 'error');
    }
  });
});


// 테이블 복사 기능
if (copyTableBtn) {
  copyTableBtn.addEventListener('click', async () => {
    if (!filteredReviews || filteredReviews.length === 0) {
      showStatus('복사할 리뷰가 없습니다.', 'error');
      return;
    }

    // 테이블 헤더 생성
    const headers = ['번호', '날짜', '작성자', '평점', '제목', '내용', '상품평가'];

    // 모든 리뷰 데이터를 텍스트로 변환 (현재 페이지가 아닌 전체)
    const rows = filteredReviews.map((review, index) => {
      const date = review.date || '';
      const author = review.author || '';
      const rating = parseInt(review.rating) || 0;
      const title = review.title || '';
      const content = review.content || '';
      const productEvaluation = review.productEvaluation || '';

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
      showStatus(`테이블이 클립보드에 복사되었습니다. (${filteredReviews.length}개 리뷰)`, 'success');

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
  if (!filteredReviews) return;

  const totalPages = Math.ceil(filteredReviews.length / itemsPerPage);
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
  if (!filteredReviews || filteredReviews.length === 0) {
    const tbody = document.getElementById('reviewTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">표시할 리뷰가 없습니다.</td></tr>';
    }
    updatePagination();
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageReviews = filteredReviews.slice(startIndex, endIndex);

  const tbody = document.getElementById('reviewTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  pageReviews.forEach((review, index) => {
    const row = document.createElement('tr');
    const globalIndex = startIndex + index + 1;

    const date = review.date || '날짜 없음';
    const author = review.author || '작성자 없음';
    const rating = parseInt(review.rating) || 0;
    const title = review.title || '(제목 없음)';
    const content = review.content || '(내용 없음)';
    const productEvaluation = review.productEvaluation || '(평가 없음)';

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
  const statusText = isStopped
    ? '<strong>수집 중지됨</strong><br>'
    : '<strong>수집 완료!</strong><br>';

  resultInfo.innerHTML = `
    ${statusText}
    총 <strong>${count}개</strong>의 리뷰가 수집되었습니다.
  `;
  resultsDiv.classList.remove('hidden');

  filterReviewsByCurrentTab();
  currentPage = 1;
  renderReviewTable();
}


function filterReviewsByCurrentTab() {
  if (!collectedReviews) {
    filteredReviews = [];
    return;
  }

  if (currentTabId) {
    filteredReviews = collectedReviews.filter(review => {
      return review.originalTabId && review.originalTabId.toString() === currentTabId.toString();
    });
  } else {
    filteredReviews = [...collectedReviews];
  }
}


async function loadReviewsForCurrentTab() {
  if (!currentTabId) {
    return;
  }

  const storageKey = `collection_${currentTabId}`;
  chrome.storage.local.get([storageKey, 'lastCollection'], (result) => {
    // 현재 탭의 데이터를 우선적으로 확인
    if (result[storageKey] && result[storageKey].reviews) {
      const collectionData = result[storageKey];
      collectedReviews = collectionData.reviews;

      // 선택된 별점 필터가 있으면 필터링 적용
      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review.rating ? review.rating.toString() : '';
          return selectedRatingFilters.includes(reviewRating);
        });
      }

      const isStopped = collectionData.stopped || false;
      filteredReviews = [...collectedReviews];
      showResults(collectedReviews.length, isStopped);
    }
    // 현재 탭에 데이터가 없으면 lastCollection 확인
    else if (result.lastCollection && result.lastCollection.reviews) {
      collectedReviews = result.lastCollection.reviews;

      // 선택된 별점 필터가 있으면 필터링 적용
      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review.rating ? review.rating.toString() : '';
          return selectedRatingFilters.includes(reviewRating);
        });
      }

      const isStopped = result.lastCollection.stopped || false;
      filterReviewsByCurrentTab();
      const displayCount = filteredReviews ? filteredReviews.length : 0;
      showResults(displayCount, isStopped);
    }
  });
}


function updateTabIdFilter() {
  if (!collectedReviews) return;

  const tabIdFilter = document.getElementById('tabIdFilter');
  if (!tabIdFilter) return;

  tabIdFilter.innerHTML = '<option value="all">모든 탭</option>';

  const uniqueTabIds = [...new Set(collectedReviews.map(r => r.originalTabId).filter(id => id !== null && id !== undefined))];

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
              collectedReviews = collectionData.reviews;

              // 선택된 별점 필터가 있으면 필터링 적용
              if (selectedRatingFilters.length > 0) {
                collectedReviews = collectedReviews.filter(review => {
                  const reviewRating = review.rating ? review.rating.toString() : '';
                  return selectedRatingFilters.includes(reviewRating);
                });
              }

              const isStopped = collectionData.stopped || false;
              filteredReviews = [...collectedReviews];
              showResults(collectedReviews.length, isStopped);
            }
            // 현재 탭에 데이터가 없으면 lastCollection 확인
            else if (result.lastCollection && result.lastCollection.reviews) {
              collectedReviews = result.lastCollection.reviews;

              // 선택된 별점 필터가 있으면 필터링 적용
              if (selectedRatingFilters.length > 0) {
                collectedReviews = collectedReviews.filter(review => {
                  const reviewRating = review.rating ? review.rating.toString() : '';
                  return selectedRatingFilters.includes(reviewRating);
                });
              }

              const isStopped = result.lastCollection.stopped || false;
              filterReviewsByCurrentTab();
              const displayCount = filteredReviews ? filteredReviews.length : 0;
              showResults(displayCount, isStopped);
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
      collectedReviews = message.reviews;
      const isStopped = message.stopped || false;

      // 선택된 별점 필터가 있으면 필터링 적용
      if (selectedRatingFilters.length > 0) {
        collectedReviews = collectedReviews.filter(review => {
          const reviewRating = review.rating ? review.rating.toString() : '';
          return selectedRatingFilters.includes(reviewRating);
        });
        addLog(`수집 완료: 총 ${message.reviews.length}개 중 선택한 별점(${selectedRatingFilters.join(',')}점) ${collectedReviews.length}개 리뷰`, 'success');
      } else {
        addLog(`수집 완료: 총 ${message.reviews.length}개의 리뷰가 수집되었습니다.`, 'success');
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
        collectedReviews = message.reviews || [];
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
