

const collectionsByTab = new Map();
const debuggerQueuesByTab = new Map();
// 로컬 디버그 서버(HTTP ingest) 사용 여부: 기본은 끔 (Fetch failed 콘솔 에러 방지)
const DEBUG_HTTP_INGEST_ENABLED = false;

function enqueueDebuggerTask(tabId, task) {
  const prev = debuggerQueuesByTab.get(tabId) || Promise.resolve();
  const next = prev
    .catch(() => { })
    .then(task)
    .catch(() => { })
    .finally(() => { });
  debuggerQueuesByTab.set(tabId, next);
  return next;
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(true);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.debugger.detach({ tabId }, () => {
        // lastError를 읽어 "Unchecked runtime.lastError" 콘솔 스팸을 방지
        const err = chrome.runtime.lastError;
        resolve(!err);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// 탭이 있는 창을 닫는 헬퍼 함수
function closeWindowByTabId(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve(false);
      return;
    }

    chrome.tabs.get(tabId)
      .then((tab) => {
        if (tab && tab.windowId) {
          return chrome.windows.remove(tab.windowId);
        }
        return Promise.resolve(false);
      })
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        // 탭이 이미 닫혔거나 없는 경우, 창도 이미 닫혔을 수 있음
        resolve(false);
      });
  });
}

function sendDebuggerCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}


// 여러 탭 병렬 처리: collection/진행/로그는 originalTabId(또는 collectionTabId)별 키로 격리해 탭 간 간섭 없이 속도·정확성 유지
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'debug-click' && request.payload) {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      try { sendResponse({ ok: false, error: 'No sender tab id' }); } catch (e) { }
      return false;
    }

    const { x, y } = request.payload;
    console.log(`[리뷰 수집기] debug-click requested: tabId=${tabId}, x=${x}, y=${y}`);

    enqueueDebuggerTask(tabId, async () => {
      let attached = false;
      try {
        await attachDebugger(tabId);
        attached = true;
        await sendDebuggerCommand(tabId, 'Page.bringToFront', {});
        await sendDebuggerCommand(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true });
        // 실제 클릭 주입
        await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
          button: 'left',
          buttons: 1,
          pointerType: 'mouse',
          modifiers: 0,
          clickCount: 1
        });
        await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          buttons: 1,
          pointerType: 'mouse',
          modifiers: 0,
          clickCount: 1
        });
        await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          buttons: 0,
          pointerType: 'mouse',
          modifiers: 0,
          clickCount: 1
        });
        console.log(`[리뷰 수집기] debug-click ok: tabId=${tabId}`);
        try { sendResponse({ ok: true }); } catch (e) { }
      } catch (e) {
        console.warn(`[리뷰 수집기] debug-click failed: tabId=${tabId}, err=${e?.message || String(e)}`);
        try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch (e2) { }
      } finally {
        // attach 실패한 경우 detach는 오히려 lastError를 더 만들 수 있어 생략
        if (attached) {
          await detachDebugger(tabId);
        }
      }
    });

    return true;
  }

  if (request.action === 'agent-log' && request.payload) {
    // Fetch failed loading: POST ... 콘솔 에러 방지를 위해 기본은 비활성화
    if (DEBUG_HTTP_INGEST_ENABLED) {
      try {
        fetch('http://127.0.0.1:7242/ingest/3fa54cf1-c4ff-4575-a8dc-81fa9718116d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.payload)
        }).catch(() => { });
      } catch (e) { }
    }
    try { sendResponse({ ok: true }); } catch (e) { }
    return false;
  }

  if (request.action === 'startCollection') {
    const isNaverStore = request.url && (String(request.url).includes('smartstore.naver.com') || String(request.url).includes('brand.naver.com'));
    if (isNaverStore) {
      console.log('[리뷰 수집기] [네이버 스마트스토어/브랜드스토어] 수집 요청', {
        url: request.url,
        productId: request.productId,
        tabId: request.tabId,
        useCurrentTab: !!request.tabId
      });
    }

    let originalTabId = null;
    if (request.originalTabId) {
      originalTabId = request.originalTabId;
    } else if (sender.tab && sender.tab.id) {
      originalTabId = sender.tab.id;
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          originalTabId = tabs[0].id;
        }
      });
    }

    // 여러 별점 필터링인 경우 각 필터별로 고유한 키 생성
    const isMultiFilter = request.isMultiFilter === true;
    let collectionKey = originalTabId;
    if (isMultiFilter && request.filterIndex !== undefined) {
      // 여러 필터인 경우 originalTabId + ratingFilter 조합으로 고유 키 생성
      collectionKey = `${originalTabId}_${request.ratingFilter}_${request.filterIndex}`;
    }

    if (collectionKey && collectionsByTab.has(collectionKey) && !isMultiFilter) {
      const errorMsg = '이 탭에서 이미 수집 중입니다.';
      try {
        sendResponse({ success: false, error: errorMsg });
      } catch (e) {
      }
      return false;
    }

    if (!request.tabId) {
      try {
        sendResponse({ success: true, message: '새 창 생성 중...' });
      } catch (e) {
      }

      chrome.windows.create({
        url: request.url,
        focused: true,
        type: 'normal'
      }).then(newWindow => {
        // 새 창의 첫 번째 탭 ID 가져오기
        const newTabId = newWindow.tabs && newWindow.tabs[0] ? newWindow.tabs[0].id : null;

        if (!newTabId) {
          // 탭 ID를 가져올 수 없으면 재시도
          setTimeout(() => {
            chrome.tabs.query({ windowId: newWindow.id }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id) {
                const tabId = tabs[0].id;
                setTimeout(() => {
                  // 여러 필터인 경우 배열로 전달, 단일 필터인 경우 문자열로 전달
                  const ratingFilter = request.ratingFilters && Array.isArray(request.ratingFilters)
                    ? request.ratingFilters
                    : (request.ratingFilter || 'all');
                  startCollection(request.url, tabId, request.productId, ratingFilter, originalTabId, request.isMultiFilter || false, originalTabId)
                    .catch(error => {
                      if (originalTabId) {
                        collectionsByTab.delete(originalTabId);
                      }
                      const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
                      chrome.storage.local.remove(storageKey);
                    });
                }, 500);
              } else {
                // 탭을 찾을 수 없으면 에러 처리
                if (originalTabId) {
                  collectionsByTab.delete(originalTabId);
                }
                const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
                chrome.storage.local.remove(storageKey);
              }
            });
          }, 100);
          return;
        }

        setTimeout(() => {
          // 여러 필터인 경우 배열로 전달, 단일 필터인 경우 문자열로 전달
          const ratingFilter = request.ratingFilters && Array.isArray(request.ratingFilters)
            ? request.ratingFilters
            : (request.ratingFilter || 'all');
          startCollection(request.url, newTabId, request.productId, ratingFilter, originalTabId, request.isMultiFilter || false, originalTabId)
            .catch(error => {
              if (originalTabId) {
                collectionsByTab.delete(originalTabId);
              }
              const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
              chrome.storage.local.remove(storageKey);
            });
        }, 500);
      }).catch(error => {
        if (originalTabId) {
          collectionsByTab.delete(originalTabId);
        }
        const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
        chrome.storage.local.remove(storageKey);
      });

      return true;
    }

    // 네이버 현재 탭 수집: content script가 없을 수 있으므로 먼저 주입 후 수집 시작
    const ratingFilter = request.ratingFilters && Array.isArray(request.ratingFilters)
      ? request.ratingFilters
      : (request.ratingFilter || 'all');
    const runStartCollection = () => {
      startCollection(request.url, request.tabId, request.productId, ratingFilter, originalTabId, request.isMultiFilter || false, originalTabId)
        .then(() => {
          try {
            sendResponse({ success: true });
          } catch (e) {
          }
        })
        .catch(error => {
          if (originalTabId) {
            collectionsByTab.delete(originalTabId);
          }
          const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
          chrome.storage.local.remove(storageKey);
          try {
            sendResponse({ success: false, error: error.message });
          } catch (e) {
          }
        });
    };

    if (request.tabId && request.url && (String(request.url).includes('smartstore.naver.com') || String(request.url).includes('brand.naver.com'))) {
      chrome.scripting.executeScript({
        target: { tabId: request.tabId },
        files: ['content.js']
      }).then(() => {
        console.log('[리뷰 수집기] [네이버 스마트스토어/브랜드스토어] content script 주입 완료, 수집 시작');
        return new Promise(r => setTimeout(r, 400));
      }).then(() => {
        runStartCollection();
      }).catch((err) => {
        console.warn('[리뷰 수집기] [네이버 스마트스토어/브랜드스토어] content script 주입 실패:', err?.message || String(err));
        runStartCollection();
      });
    } else {
      runStartCollection();
    }
    return true;
  } else if (request.action === 'stopCollection') {
    let originalTabId = null;
    if (request.originalTabId) {
      originalTabId = request.originalTabId;
    } else if (sender.tab && sender.tab.id) {
      originalTabId = sender.tab.id;
    }
    stopCollection(originalTabId);
    sendResponse({ success: true });
  } else if (request.action === 'convertToExcel') {
    try {
      const csvContent = convertToExcel(request.reviews);
      sendResponse({ success: true, csvContent: csvContent });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === 'progress' || request.action === 'log') {
    // 여러 탭 병렬 처리: progress/로그는 originalTabId별 키로 격리해 속도·정확성 유지
    const originalTabId = request.originalTabId || null;

    if (request.action === 'progress') {
      const storageKey = originalTabId ? `collectionProgress_${originalTabId}` : 'collectionProgress';
      chrome.storage.local.set({
        [storageKey]: {
          percent: request.percent,
          text: request.text,
          timestamp: Date.now(),
          originalTabId: originalTabId
        }
      });
    }

    if (request.action === 'log') {
      const time = new Date().toLocaleTimeString('ko-KR');
      const logMessage = `[리뷰 수집기] ${request.message}`;

      if (request.type === 'error') {
        console.error(logMessage);
      } else if (request.type === 'warning') {
        console.warn(logMessage);
      } else if (request.type === 'success') {
        console.log(`%c${logMessage}`, 'color: green; font-weight: bold');
      } else {
        console.log(logMessage);
      }

      const logStorageKey = originalTabId ? `collectionLogs_${originalTabId}` : (sender?.tab?.id ? `collectionLogs_${sender.tab.id}` : 'collectionLogs');
      chrome.storage.local.get([logStorageKey], (result) => {
        const logs = result[logStorageKey] || [];
        logs.push({
          message: request.message,
          type: request.type || 'info',
          time: time,
          timestamp: Date.now()
        });
        if (logs.length > 200) logs.shift();
        chrome.storage.local.set({ [logStorageKey]: logs });
      });
    }

    try {
      chrome.runtime.sendMessage(request).catch((err) => {
      });
    } catch (err) {
    }

    const collection = request.originalTabId ? collectionsByTab.get(request.originalTabId) : null;
    if (collection && collection.collectionTabId) {
      try {
        chrome.tabs.sendMessage(collection.collectionTabId, request).catch((err) => {
        });
      } catch (err) {
      }
    }
  } else if (request.action === 'complete') {
    const originalTabId = request.originalTabId ?? null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      collectionsByTab.delete(originalTabId);
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.remove(storageKey);
    }

    const reviews = Array.isArray(request.reviews) ? request.reviews : [];
    const collectionData = {
      reviews,
      timestamp: Date.now(),
      stopped: Boolean(request.stopped),
      originalTabId,
      productName: request.productName != null ? String(request.productName) : '',
      source: request.source != null ? String(request.source) : ''
    };

    if (originalTabId) {
      const storageKey = `collection_${originalTabId}`;
      chrome.storage.local.set({
        [storageKey]: collectionData,
        lastCollection: collectionData
      });
    } else {
      chrome.storage.local.set({
        lastCollection: collectionData
      });
    }

    try {
      chrome.runtime.sendMessage({
        action: 'complete',
        reviews,
        stopped: collectionData.stopped,
        originalTabId,
        productName: collectionData.productName,
        source: collectionData.source
      }).catch(() => {});
    } catch (err) {
      // popup이 닫혀 있으면 무시
    }

    // closeTab 플래그가 있으면 수집 탭이 있는 창 닫기
    if (request.closeTab && collection && collection.collectionTabId) {
      try {
        closeWindowByTabId(collection.collectionTabId).then(() => {
          // closeTab 플래그로 닫을 때도 원래 탭으로 복귀
          if (originalTabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                chrome.tabs.update(originalTabId, { active: true }).catch(() => { });
              }
            });
          }
        }).catch((err) => {
        });
      } catch (err) {
      }
    }

    if (collection && collection.collectionTabId) {
      // 알림만 표시 (현재 탭에서 수집한 경우 창 닫기 생략)
      try {
        chrome.tabs.sendMessage(collection.collectionTabId, {
          action: 'complete',
          reviews: request.reviews,
          stopped: request.stopped || false,
          showNotificationOnly: true // 알림만 표시 플래그
        }).catch((err) => {
        });
      } catch (err) {
      }

      // 새 창에서 수집한 경우에만 창 닫기 (현재 탭에서 수집한 경우 닫지 않음)
      const isCollectionInNewWindow = collection.collectionTabId !== originalTabId;
      if (isCollectionInNewWindow) {
        setTimeout(() => {
          closeWindowByTabId(collection.collectionTabId).then(() => {
            if (originalTabId) {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                  chrome.tabs.update(originalTabId, { active: true }).catch(() => { });
                }
              });
            }
          }).catch(err => {
          });
        }, 500);
      }
    }
  } else if (request.action === 'stopped') {
    const originalTabId = request.originalTabId || null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      collectionsByTab.delete(originalTabId);
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.remove(storageKey);
    }

    const reviews = request.reviews !== undefined && Array.isArray(request.reviews) ? request.reviews : [];
    const collectionData = {
      reviews,
      timestamp: Date.now(),
      stopped: true,
      originalTabId,
      productName: request.productName != null ? String(request.productName) : '',
      source: request.source != null ? String(request.source) : ''
    };

    if (request.reviews !== undefined) {
      if (originalTabId) {
        const storageKey = `collection_${originalTabId}`;
        chrome.storage.local.set({
          [storageKey]: collectionData,
          lastCollection: collectionData
        });
      } else {
        chrome.storage.local.set({
          lastCollection: collectionData
        });
      }
    }

    try {
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: request.message || '수집이 중지되었습니다.',
        reviews,
        originalTabId,
        productName: collectionData.productName,
        source: collectionData.source
      }).catch(() => {});
    } catch (err) {
    }

    if (collection && collection.collectionTabId) {
      try {
        chrome.tabs.sendMessage(collection.collectionTabId, {
          action: 'stopped',
          message: request.message || '수집이 중지되었습니다.'
        }).catch((err) => {
        });
      } catch (err) {
      }

      const isCollectionInNewWindow = collection.collectionTabId !== originalTabId;
      if (isCollectionInNewWindow) {
        try {
          chrome.runtime.sendMessage({
            action: 'log',
            message: '수집 중지. 새 창을 닫습니다...',
            type: 'warning'
          }).catch(() => { });
        } catch (e) { }

        setTimeout(() => {
          closeWindowByTabId(collection.collectionTabId).then(() => {
            try {
              chrome.runtime.sendMessage({
                action: 'log',
                message: '새 창이 닫혔습니다.',
                type: 'success'
              }).catch(() => { });
            } catch (e) { }

            if (originalTabId) {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                  chrome.tabs.update(originalTabId, { active: true }).catch(() => { });
                }
              });
            }
          }).catch(err => {
          });
        }, 500);
      }
    }
  } else if (request.action === 'error') {
    const originalTabId = request.originalTabId || null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      collectionsByTab.delete(originalTabId);
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.remove(storageKey);
    }

    if (collection && collection.collectionTabId) {
      try {
        chrome.tabs.sendMessage(collection.collectionTabId, request).catch((err) => {
        });
      } catch (err) {
      }

      setTimeout(() => {
        closeWindowByTabId(collection.collectionTabId).then(() => {
          // 에러 발생 시에도 원래 탭으로 복귀
          if (originalTabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                chrome.tabs.update(originalTabId, { active: true }).catch(() => { });
              }
            });
          }
        }).catch(err => {
        });
      }, 500);
    }

    try {
      chrome.runtime.sendMessage(request).catch((err) => {
      });
    } catch (err) {
    }
  } else if (request.action === 'getCollectionStatus') {
    const originalTabId = request.originalTabId || null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      sendResponse({
        isCollecting: true,
        url: collection.url,
        tabId: collection.tabId,
        productId: collection.productId,
        startTime: collection.startTime,
        originalTabId: originalTabId
      });
      return true;
    } else {
      const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
      chrome.storage.local.get([storageKey], (result) => {
        if (result[storageKey] && result[storageKey].isCollecting) {
          sendResponse(result[storageKey]);
        } else {
          sendResponse({ isCollecting: false, originalTabId: originalTabId });
        }
      });
      return true;
    }
  }
});


async function startCollection(url, tabId, productId, ratingFilter = 'all', originalTabId = null, isMultiFilter = false, collectionKey = null) {
  // collectionKey가 제공되지 않으면 originalTabId 사용
  const key = collectionKey || originalTabId;

  // 여러 별점 필터링인 경우 중복 체크 건너뛰기
  if (key && collectionsByTab.has(key) && !isMultiFilter) {
    throw new Error('이 탭에서 이미 수집 중입니다.');
  }

  const collection = {
    url,
    tabId,
    productId,
    ratingFilter,
    collectionTabId: tabId,
    originalTabId: originalTabId,
    startTime: Date.now()
  };

  if (key) {
    collectionsByTab.set(key, collection);
  }

  const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
  chrome.storage.local.set({
    [storageKey]: {
      isCollecting: true,
      url,
      tabId,
      productId,
      originalTabId: originalTabId,
      startTime: collection.startTime
    }
  });

  let scriptReady = false;
  let pingRetries = 10;
  try {
    const tabExists = await chrome.tabs.get(tabId).then(() => true).catch(() => false);
    if (!tabExists) {
      if (originalTabId) collectionsByTab.delete(originalTabId);
      chrome.storage.local.remove(originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus');
      throw new Error('수집 탭이 닫혔거나 찾을 수 없습니다.');
    }
  } catch (e) {
    if (e?.message?.includes('수집 탭이')) throw e;
    if (originalTabId) collectionsByTab.delete(originalTabId);
    chrome.storage.local.remove(originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus');
    throw new Error('수집 탭을 확인할 수 없습니다: ' + (e?.message || String(e)));
  }

  while (pingRetries > 0 && !scriptReady) {
    try {
      const pingResponse = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (pingResponse?.success) {
        scriptReady = true;
        break;
      }
    } catch (pingError) {
      pingRetries--;
      if (pingRetries > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  let startScrapingSuccess = false;
  let startScrapingRetries = 5;
  let lastError = null;

  while (startScrapingRetries > 0 && !startScrapingSuccess) {
    try {
      // ratingFilter가 배열이면 ratingFilters로 전달, 아니면 ratingFilter로 전달
      const message = {
        action: 'startScraping',
        url,
        originalTabId: originalTabId
      };

      if (Array.isArray(ratingFilter)) {
        message.ratingFilters = ratingFilter;
      } else {
        message.ratingFilter = ratingFilter;
      }

      const response = await chrome.tabs.sendMessage(tabId, message);

      if (response && response.success) {
        startScrapingSuccess = true;
        break;
      } else if (response && !response.success) {
        lastError = new Error(response.error || '수집을 시작할 수 없습니다.');
        break;
      }
    } catch (error) {
      lastError = error;
      startScrapingRetries--;

      if (startScrapingRetries > 0) {
        if (error.message && error.message.includes('Extension context invalidated')) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  if (!startScrapingSuccess) {
    if (originalTabId) {
      collectionsByTab.delete(originalTabId);
    }
    const storageKey = originalTabId ? `collectionStatus_${originalTabId}` : 'collectionStatus';
    chrome.storage.local.remove(storageKey);

    if (lastError) {
      if (lastError.message && lastError.message.includes('Extension context invalidated')) {
        throw new Error('확장 프로그램이 재로드되었습니다. 페이지를 새로고침하고 다시 시도해주세요.');
      } else if (lastError.message && lastError.message.includes('message port closed')) {
        throw new Error('페이지가 닫혔거나 새로고침되었습니다. 다시 시도해주세요.');
      } else {
        throw new Error('Content Script와 통신할 수 없습니다: ' + lastError.message);
      }
    } else {
      throw new Error('Content Script에 수집 시작 메시지를 전송할 수 없습니다.');
    }
  }
}


async function stopCollection(originalTabId = null) {
  if (originalTabId) {
    const collection = collectionsByTab.get(originalTabId);
    if (collection) {
      try {
        await chrome.tabs.sendMessage(collection.tabId, {
          action: 'stopScraping'
        });
      } catch (error) {
        collectionsByTab.delete(originalTabId);
        const storageKey = `collectionStatus_${originalTabId}`;
        chrome.storage.local.remove(storageKey);
      }
    } else {
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.get([storageKey], (result) => {
        if (result[storageKey] && result[storageKey].isCollecting) {
          const status = result[storageKey];
          chrome.tabs.sendMessage(status.tabId, {
            action: 'stopScraping'
          }).catch(() => {
            chrome.storage.local.remove(storageKey);
          });
        }
      });
    }
  } else {
    chrome.storage.local.get(['collectionStatus'], (result) => {
      if (result.collectionStatus && result.collectionStatus.isCollecting) {
        const status = result.collectionStatus;
        chrome.tabs.sendMessage(status.tabId, {
          action: 'stopScraping'
        }).catch(() => {
          chrome.storage.local.remove('collectionStatus');
        });
      }
    });
  }
}


function convertToExcel(reviews) {
  try {
    const headers = ['날짜', '작성자', '별점', '제목', '내용', '상품평가'];
    const rows = reviews.map(review => {
      const date = (review.date || '').replace(/"/g, '""');
      const author = (review.author || '').replace(/"/g, '""');
      const rating = (review.rating || '').replace(/"/g, '""');
      const title = (review.title || '').replace(/"/g, '""').replace(/\n/g, ' ');
      const content = (review.content || '').replace(/"/g, '""').replace(/\n/g, ' ');
      const productEvaluation = (review.productEvaluation || '').replace(/"/g, '""').replace(/\n/g, ' ');
      return [
        date,
        author,
        rating,
        title,
        content,
        productEvaluation
      ];
    });

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;

    return csvWithBOM;
  } catch (error) {
    throw new Error('Excel 변환 실패: ' + error.message);
  }
}


chrome.runtime.onInstalled.addListener(() => {
});
