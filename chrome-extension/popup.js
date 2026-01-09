
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


let isCollecting = false;
let collectedReviews = null;
let productId = null;
let filteredReviews = null;
let currentPage = 1;
const itemsPerPage = 20;
let currentTabId = null; 


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


async function loadCurrentPageUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabId = tab.id;

      productUrlInput.value = tab.url;

      productUrlInput.disabled = true;
    }
  } catch (error) {
  }
}


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
        addLog('현재 탭 ID를 가져올 수 없습니다. 새로고침 후 다시 시도해주세요.', 'warning');
      }

      try {
        chrome.runtime.sendMessage(
          {
            action: 'startCollection',
            url: url,
            productId: productId,
            originalTabId: currentTabId 
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
    }); 
  });
}


stopBtn.addEventListener('click', async () => {
  isCollecting = false;
  showStatus('수집 중지 요청 중... 현재까지 수집한 데이터를 처리합니다.', 'info');

  stopBtn.disabled = true;
  stopBtn.textContent = '중지 중...';

  try {
    chrome.runtime.sendMessage({ action: 'stopCollection' }, (response) => {
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
        }, 10000);
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
  chrome.storage.local.get([storageKey], (result) => {
    if (result[storageKey] && result[storageKey].reviews) {
      const collectionData = result[storageKey];
      const timeDiff = Date.now() - collectionData.timestamp;

      if (timeDiff < 5 * 60 * 1000) {
        collectedReviews = collectionData.reviews;
        const isStopped = collectionData.stopped || false;
        filteredReviews = [...collectedReviews];
        showResults(collectedReviews.length, isStopped);
      }
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
    chrome.runtime.sendMessage({ action: 'getCollectionStatus' }, async (response) => {
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

      chrome.storage.local.get(['collectionProgress'], (progressResult) => {
        if (progressResult.collectionProgress) {
          const progress = progressResult.collectionProgress;
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

        if (currentTabId) {
          const storageKey = `collection_${currentTabId}`;
          chrome.storage.local.get([storageKey], (tabResult) => {
            if (tabResult[storageKey] && tabResult[storageKey].reviews) {
              const collectionData = tabResult[storageKey];
              const timeDiff = Date.now() - collectionData.timestamp;
              if (timeDiff < 5 * 60 * 1000) {
                collectedReviews = collectionData.reviews;
                const isStopped = collectionData.stopped || false;
                filteredReviews = [...collectedReviews];
                showResults(collectedReviews.length, isStopped);
              }
            }
            resolve();
          });
        } else {
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
      return true; 
    });
  });
}


function setupMessageListener() {
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
      filterReviewsByCurrentTab();
      const displayCount = filteredReviews ? filteredReviews.length : 0;
      showResults(displayCount, isStopped);
      resetUI();
      chrome.runtime.onMessage.removeListener(window.messageListener);
      window.messageListener = null;
    } else if (message.action === 'stopped') {
      if (message.reviews !== undefined) {
        collectedReviews = message.reviews || [];
        addLog(`수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'warning');
        showStatus(message.message || `수집 종료: 총 ${collectedReviews.length}개의 리뷰가 수집되었습니다.`, 'info');
        filterReviewsByCurrentTab();
        const displayCount = filteredReviews ? filteredReviews.length : 0;
        showResults(displayCount, true); 
      } else {
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


const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
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
}
