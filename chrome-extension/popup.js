// DOM 요소
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
// 로그는 새 탭의 모달 창에만 표시됨

let isCollecting = false;
let collectedReviews = null;
let productId = null;
let filteredReviews = null;
let currentPage = 1;
const itemsPerPage = 20;
let currentTabId = null; // 현재 탭 ID 저장

// 로그 추가 함수 (storage에만 저장, UI는 새 탭의 모달 창에 표시됨)
function addLog(message, type = 'info') {
  // storage에 로그 저장 (팝업이 닫혀도 유지)
  saveLogToStorage(message, type, new Date().toLocaleTimeString('ko-KR'));
}

// 로그를 storage에 저장
function saveLogToStorage(message, type, time) {
  chrome.storage.local.get(['collectionLogs'], (result) => {
    const logs = result.collectionLogs || [];
    logs.push({ message, type, time, timestamp: Date.now() });

    // 최대 200개 로그 유지
    if (logs.length > 200) {
      logs.shift(); // 가장 오래된 로그 제거
    }

    chrome.storage.local.set({ collectionLogs: logs });
  });
}

// storage에서 로그 불러오기 (팝업에서는 표시하지 않음, 새 탭의 모달 창에서 표시됨)
function loadLogsFromStorage() {
  // 로그는 새 탭의 모달 창에서만 표시됨
  // storage에 저장된 로그는 새 탭의 모달 창에서 불러옴
}

// 현재 페이지 URL 및 탭 ID 자동 추출
async function loadCurrentPageUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      // 탭 ID 저장
      currentTabId = tab.id;

      // 항상 현재 탭의 URL을 설정
      productUrlInput.value = tab.url;

      // URL input을 disabled 처리
      productUrlInput.disabled = true;
    }
  } catch (error) {
    // 오류 처리
  }
}

// 리뷰 수집 시작
if (startBtn) {
  startBtn.addEventListener('click', async () => {
    const url = productUrlInput.value.trim();

    if (!url) {
      showStatus('쿠팡 상품 URL을 입력해주세요.', 'error');
      return;
    }

    if (!url.includes('coupang.com/vp/products/')) {
      showStatus('유효한 쿠팡 상품 URL이 아닙니다.', 'error');
      return;
    }

    // URL에서 상품 ID 추출
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

    // 선택된 별점 필터 가져오기
    const ratingFilterSelect = document.getElementById('ratingFilter');
    const selectedRating = ratingFilterSelect ? ratingFilterSelect.value : '';
    const selectedRatings = selectedRating ? [selectedRating] : null;

    // UI 업데이트
    startBtn.disabled = true;
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    progressDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    statusDiv.classList.remove('hidden');
    // 로그는 새 탭의 모달 창에 표시됨
    if (selectedRatings && selectedRatings.length > 0) {
      addLog(`리뷰 수집을 시작합니다... (${selectedRatings[0]}점만 수집)`, 'info');
      showStatus(`리뷰 수집을 시작합니다... (${selectedRatings[0]}점만 수집)`, 'info');
    } else {
      addLog('리뷰 수집을 시작합니다...', 'info');
      showStatus('리뷰 수집을 시작합니다...', 'info');
    }
    updateProgress(0, '초기화 중...');

    // 진행 상황 수신 리스너 설정 (먼저 설정)
    setupMessageListener();

    // Background Script에 즉시 메시지 전송 (새 탭 생성은 Background에서 처리)
    addLog('Background Script에 수집 요청 전송 중...', 'info');
    addLog(`URL: ${url}`, 'info');
    addLog(`상품 ID: ${productId}`, 'info');

    // 현재 활성 탭의 ID 가져오기
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        addLog(`현재 탭 ID 가져오기 실패: ${chrome.runtime.lastError.message}`, 'error');
      }

      const currentTabId = tabs && tabs[0] ? tabs[0].id : null;

      if (!currentTabId) {
        addLog('현재 탭 ID를 가져올 수 없습니다. 새로고침 후 다시 시도해주세요.', 'warning');
      }

      try {
        chrome.runtime.sendMessage(
          {
            action: 'startCollection',
            url: url,
            productId: productId,
            originalTabId: currentTabId, // 현재 활성 탭 ID 전달
            ratingFilter: selectedRatings && selectedRatings.length > 0 ? selectedRatings : null // 별점 필터 전달
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
              addLog('수집 작업이 시작되었습니다.', 'success');
              showStatus('수집이 시작되었습니다. 새 탭에서 진행됩니다...', 'success');
            } else if (bgResponse && !bgResponse.success) {
              addLog(`수집 시작 실패: ${bgResponse.error || '알 수 없는 오류'}`, 'error');
              showStatus('오류: ' + (bgResponse.error || '수집을 시작할 수 없습니다.'), 'error');
              resetUI();
            } else {
              addLog('Background Script 응답이 없습니다. 수집이 시작되었을 수 있습니다.', 'warning');
              showStatus('수집이 시작되었을 수 있습니다. 새 탭을 확인하세요.', 'info');
            }
          }
        );
      } catch (error) {
        addLog(`메시지 전송 실패: ${error.message}`, 'error');
        showStatus('오류: 메시지 전송 실패', 'error');
        resetUI();
        return;
      }
    }); // chrome.tabs.query 콜백 종료
  });
}

// 중지 버튼
stopBtn.addEventListener('click', async () => {
  isCollecting = false;
  showStatus('수집 중지 요청 중... 현재까지 수집한 데이터를 처리합니다.', 'info');

  // 즉시 UI 업데이트
  stopBtn.disabled = true;
  stopBtn.textContent = '중지 중...';

  try {
    // Background Script에 중지 요청
    chrome.runtime.sendMessage({ action: 'stopCollection' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('중지 요청 중 오류가 발생했습니다: ' + chrome.runtime.lastError.message, 'error');
        stopBtn.disabled = false;
        stopBtn.textContent = '중지';
      } else {
        // complete 메시지가 올 때까지 대기 (messageListener에서 처리)
        // 타임아웃 설정 (10초 후 강제 중지)
        setTimeout(() => {
          if (isCollecting) {
            isCollecting = false;
            resetUI();
            showStatus('수집이 중지되었습니다.', 'info');
          }
        }, 10000);
      }
    });
  } catch (error) {
    showStatus('중지 요청 중 오류가 발생했습니다: ' + error.message, 'error');
    stopBtn.disabled = false;
    stopBtn.textContent = '중지';
  }
});

// JSON 다운로드
downloadJsonBtn.addEventListener('click', async () => {
  if (!collectedReviews) return;

  // 현재 탭의 title 가져오기
  let tabTitle = 'review';
  try {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab && tab.title) {
        // 파일명으로 사용할 수 없는 문자 제거 및 대체
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_') // 파일명으로 사용할 수 없는 문자를 _로 대체
          .replace(/\s+/g, '_') // 공백을 _로 대체
          .substring(0, 100); // 최대 100자로 제한
      }
    } else {
      // currentTabId가 없으면 현재 활성 탭 가져오기
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    }
  } catch (error) {
    // 오류 발생 시 기본값 사용
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

// Excel 다운로드 (CSV 형식)
downloadExcelBtn.addEventListener('click', async () => {
  if (!collectedReviews) return;

  // 현재 탭의 title 가져오기
  let tabTitle = 'review';
  try {
    if (currentTabId) {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab && tab.title) {
        // 파일명으로 사용할 수 없는 문자 제거 및 대체
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_') // 파일명으로 사용할 수 없는 문자를 _로 대체
          .replace(/\s+/g, '_') // 공백을 _로 대체
          .substring(0, 100); // 최대 100자로 제한
      }
    } else {
      // currentTabId가 없으면 현재 활성 탭 가져오기
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.title) {
        tabTitle = tab.title
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .substring(0, 100);
      }
    }
  } catch (error) {
    // 오류 발생 시 기본값 사용
  }

  // Excel 변환 요청
  chrome.runtime.sendMessage({
    action: 'convertToExcel',
    reviews: collectedReviews,
    productId: productId
  }, (response) => {
    if (response && response.success && response.csvContent) {
      // CSV 문자열을 Blob으로 변환
      const blob = new Blob([response.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const filename = `review_${tabTitle}.csv`;

      // 다운로드
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        // Blob URL 정리
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);

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

// 상태 표시
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');
}

// 진행률 업데이트
function updateProgress(percent, text) {
  progressFill.style.width = percent + '%';
  progressText.textContent = text || `${percent}%`;
}

// 페이지네이션 업데이트
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

// 리뷰 테이블 렌더링
function renderReviewTable() {
  if (!filteredReviews || filteredReviews.length === 0) {
    const tbody = document.getElementById('reviewTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">표시할 리뷰가 없습니다.</td></tr>';
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
    const rating = review.rating || 0;
    const content = review.content || '(내용 없음)';
    const truncatedContent = content.length > 50 ? content.substring(0, 50) + '...' : content;

    row.innerHTML = `
      <td>${globalIndex}</td>
      <td>${date}</td>
      <td><span class="rating-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span> (${rating})</td>
      <td class="review-content-cell" title="${content.replace(/"/g, '&quot;')}">${truncatedContent}</td>
    `;

    tbody.appendChild(row);
  });

  updatePagination();
}

// 결과 표시
function showResults(count, isStopped = false) {
  const statusText = isStopped
    ? '<strong>수집 중지됨</strong><br>'
    : '<strong>수집 완료!</strong><br>';

  resultInfo.innerHTML = `
    ${statusText}
    총 <strong>${count}개</strong>의 리뷰가 수집되었습니다.
  `;
  resultsDiv.classList.remove('hidden');

  // 현재 탭 ID로 리뷰 필터링
  filterReviewsByCurrentTab();
  currentPage = 1;
  renderReviewTable();
}

// 현재 탭 ID로 리뷰 필터링
function filterReviewsByCurrentTab() {
  if (!collectedReviews) {
    filteredReviews = [];
    return;
  }

  // 현재 탭 ID가 있으면 해당 탭의 리뷰만 필터링
  if (currentTabId) {
    filteredReviews = collectedReviews.filter(review => {
      return review.originalTabId && review.originalTabId.toString() === currentTabId.toString();
    });
  } else {
    // 현재 탭 ID가 없으면 모든 리뷰 표시
    filteredReviews = [...collectedReviews];
  }
}

// 현재 탭 ID의 리뷰 불러오기
async function loadReviewsForCurrentTab() {
  if (!currentTabId) {
    return;
  }

  const storageKey = `collection_${currentTabId}`;
  chrome.storage.local.get([storageKey], (result) => {
    if (result[storageKey] && result[storageKey].reviews) {
      const collectionData = result[storageKey];
      const timeDiff = Date.now() - collectionData.timestamp;

      // 5분 이내의 데이터면 표시
      if (timeDiff < 5 * 60 * 1000) {
        collectedReviews = collectionData.reviews;
        const isStopped = collectionData.stopped || false;
        filteredReviews = [...collectedReviews];
        showResults(collectedReviews.length, isStopped);
      }
    }
  });
}

// 탭 ID 필터 업데이트
function updateTabIdFilter() {
  if (!collectedReviews) return;

  const tabIdFilter = document.getElementById('tabIdFilter');
  if (!tabIdFilter) return;

  // 기존 옵션 제거 (모든 탭 제외)
  tabIdFilter.innerHTML = '<option value="all">모든 탭</option>';

  // 고유한 originalTabId 추출
  const uniqueTabIds = [...new Set(collectedReviews.map(r => r.originalTabId).filter(id => id !== null && id !== undefined))];

  uniqueTabIds.forEach(tabId => {
    const option = document.createElement('option');
    option.value = tabId;
    option.textContent = `탭 ID: ${tabId}`;
    tabIdFilter.appendChild(option);
  });
}

// UI 리셋
function resetUI() {
  isCollecting = false;
  startBtn.disabled = false;
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  // 로그 컨테이너는 유지 (사용자가 확인할 수 있도록)
}

// 페이지 로드 시 저장된 상태 복원
function restoreState() {
  return new Promise((resolve) => {
    // 수집 상태 확인
    chrome.runtime.sendMessage({ action: 'getCollectionStatus' }, async (response) => {
      if (chrome.runtime.lastError) {
        // 오류가 발생해도 현재 페이지 URL은 가져오기
        await loadCurrentPageUrl();
        resolve();
        return;
      }

      if (response && response.isCollecting) {
      // 수집 중인 상태로 복원
      isCollecting = true;
      productId = response.productId;

      // 항상 현재 탭의 URL 사용
      await loadCurrentPageUrl();

      // UI를 수집 중 상태로 변경
      startBtn.disabled = true;
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      progressDiv.classList.remove('hidden');
      statusDiv.classList.remove('hidden');
      // 로그는 새 탭의 모달 창에 표시됨

      showStatus('수집이 진행 중입니다. 중지 버튼을 눌러 중지할 수 있습니다.', 'info');

      // 저장된 로그 불러오기
      loadLogsFromStorage();

      // 저장된 진행 상황 복원
      chrome.storage.local.get(['collectionProgress'], (progressResult) => {
        if (progressResult.collectionProgress) {
          const progress = progressResult.collectionProgress;
          updateProgress(progress.percent, progress.text);
        } else {
          updateProgress(0, '수집 중...');
        }
      });

      // 메시지 리스너 재설정
      setupMessageListener();
      resolve();
      } else {
      // 수집 중이 아니면 완료된 데이터 확인
      // 먼저 현재 탭 ID를 가져온 후 해당 탭의 리뷰만 불러오기
      // 항상 현재 탭의 URL 사용
      await loadCurrentPageUrl();

      chrome.storage.local.get(['lastUrl'], async (result) => {

        // 현재 탭 ID로 해당 탭의 리뷰만 불러오기
        if (currentTabId) {
          const storageKey = `collection_${currentTabId}`;
          chrome.storage.local.get([storageKey], (tabResult) => {
            if (tabResult[storageKey] && tabResult[storageKey].reviews) {
              const collectionData = tabResult[storageKey];
              const timeDiff = Date.now() - collectionData.timestamp;
              // 5분 이내의 데이터면 표시
              if (timeDiff < 5 * 60 * 1000) {
                collectedReviews = collectionData.reviews;
                const isStopped = collectionData.stopped || false;
                // 현재 탭의 리뷰만 표시 (이미 해당 탭의 리뷰만 불러왔으므로 필터링 불필요)
                filteredReviews = [...collectedReviews];
                showResults(collectedReviews.length, isStopped);
              }
            }
            resolve();
          });
        } else {
          // 현재 탭 ID가 없으면 기존 방식으로 lastCollection 확인
          chrome.storage.local.get(['lastCollection'], (result) => {
            if (result.lastCollection && result.lastCollection.reviews) {
              const timeDiff = Date.now() - result.lastCollection.timestamp;
              if (timeDiff < 5 * 60 * 1000) {
                collectedReviews = result.lastCollection.reviews;
                const isStopped = result.lastCollection.stopped || false;
                filterReviewsByCurrentTab();
                const displayCount = filteredReviews ? filteredReviews.length : 0;
                showResults(displayCount, isStopped);
              }
            }
            resolve();
          });
        }
      });
      }
      return true; // 비동기 응답
    });
  });
}

// 메시지 리스너 설정 함수
function setupMessageListener() {
  // 기존 리스너 제거 (중복 방지)
  if (window.messageListener) {
    chrome.runtime.onMessage.removeListener(window.messageListener);
  }

  window.messageListener = (message, sender, sendResponse) => {
    if (message.action === 'progress') {
      updateProgress(message.percent, message.text);
      if (message.log) {
        addLog(message.log, message.logType || 'info');
      }
    } else if (message.action === 'log') {
      // 로그 메시지 수신
      addLog(message.message, message.type || 'info');
    } else if (message.action === 'complete') {
      collectedReviews = message.reviews;
      const isStopped = message.stopped || false;
      addLog(`수집 완료: 총 ${message.reviews.length}개의 리뷰가 수집되었습니다.`, 'success');
      if (isStopped) {
        showStatus(`수집이 중지되었습니다. 현재까지 ${message.reviews.length}개의 리뷰가 수집되었습니다.`, 'info');
      } else {
        showStatus(`수집 완료! 총 ${message.reviews.length}개의 리뷰가 수집되었습니다.`, 'success');
      }
      // 현재 탭 ID로 필터링하여 표시
      filterReviewsByCurrentTab();
      const displayCount = filteredReviews ? filteredReviews.length : 0;
      showResults(displayCount, isStopped);
      resetUI();
      chrome.runtime.onMessage.removeListener(window.messageListener);
      window.messageListener = null;
    } else if (message.action === 'stopped') {
      // 즉시 중지 메시지 (별점 필터로 인한 종료 포함)
      if (message.reviews !== undefined) {
        // 리뷰 데이터가 포함된 경우 (별점 필터로 인한 종료)
        collectedReviews = message.reviews || [];
        addLog(`수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'warning');
        showStatus(message.message || `수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'info');
        // 현재 탭 ID로 필터링하여 표시
        filterReviewsByCurrentTab();
        const displayCount = filteredReviews ? filteredReviews.length : 0;
        showResults(displayCount, true); // isStopped = true
      } else {
        // 일반적인 중지 (리뷰 데이터 없음)
        addLog('수집이 중지되었습니다.', 'warning');
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

// 페이지 로드 시 상태 복원
restoreState().then(() => {
  // 상태 복원 후 현재 탭의 리뷰 불러오기 (수집 중이 아닐 때만)
  if (!isCollecting) {
    // loadCurrentPageUrl이 완료된 후 리뷰 불러오기
    setTimeout(() => {
      loadReviewsForCurrentTab();
    }, 100);
  }
}).catch(err => {
  // 오류 처리
});

// 로그는 새 탭의 모달 창에서만 표시됨

// URL 변경 시 저장
productUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ lastUrl: productUrlInput.value });
});

// popup이 닫힐 때 리스너 정리
window.addEventListener('beforeunload', () => {
  if (window.messageListener) {
    chrome.runtime.onMessage.removeListener(window.messageListener);
    window.messageListener = null;
  }
});

// 탭 전환
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;

    // 탭 버튼 활성화
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 탭 컨텐츠 표시
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabName}Tab`).classList.add('active');
  });
});

// 이전 페이지
const prevPageBtn = document.getElementById('prevPage');
if (prevPageBtn) {
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderReviewTable();
    }
  });
}

// 다음 페이지
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

// 검색 기능
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (!collectedReviews) return;

    // 현재 탭 ID로 필터링된 리뷰를 기준으로 검색
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

// 정렬 기능
const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    if (!collectedReviews) return;

    const sortValue = e.target.value;

    // 현재 탭 ID로 필터링
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
}
