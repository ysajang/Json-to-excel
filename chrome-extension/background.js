

const collectionsByTab = new Map();


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'startCollection') {
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

    if (originalTabId && collectionsByTab.has(originalTabId)) {
      const errorMsg = '이 탭에서 이미 수집 중입니다.';
      try {
        sendResponse({ success: false, error: errorMsg });
      } catch (e) {
      }
      return false;
    }

    if (!request.tabId) {
      try {
        sendResponse({ success: true, message: '새 탭 생성 중...' });
      } catch (e) {
      }

      chrome.tabs.create({
        url: request.url,
        active: true
      }).then(newTab => {
        setTimeout(() => {
          startCollection(request.url, newTab.id, request.productId, request.ratingFilter || 'all', originalTabId)
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

    startCollection(request.url, request.tabId, request.productId, request.ratingFilter || 'all', originalTabId)
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
    if (request.action === 'progress') {
      const originalTabId = request.originalTabId || null;
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

      // 서비스 워커 콘솔에 출력
      if (request.type === 'error') {
        console.error(logMessage);
      } else if (request.type === 'warning') {
        console.warn(logMessage);
      } else if (request.type === 'success') {
        console.log(`%c${logMessage}`, 'color: green; font-weight: bold');
      } else {
        console.log(logMessage);
      }

      chrome.storage.local.get(['collectionLogs'], (result) => {
        const logs = result.collectionLogs || [];
        logs.push({
          message: request.message,
          type: request.type || 'info',
          time: time,
          timestamp: Date.now()
        });

        if (logs.length > 200) {
          logs.shift();
        }

        chrome.storage.local.set({ collectionLogs: logs });
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
    const originalTabId = request.originalTabId || null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      collectionsByTab.delete(originalTabId);
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.remove(storageKey);
    }

    const collectionData = {
      reviews: request.reviews,
      timestamp: Date.now(),
      stopped: request.stopped || false,
      originalTabId: originalTabId
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
        reviews: request.reviews,
        stopped: request.stopped || false,
        originalTabId: originalTabId
      }).catch((err) => {
      });
    } catch (err) {
    }

    if (collection && collection.collectionTabId) {
      // 알림만 표시하고 바로 탭 닫기 (진행률 표시 없음)
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

      // 알림 표시를 위한 짧은 대기 후 바로 탭 닫기
      setTimeout(() => {
        chrome.tabs.remove(collection.collectionTabId).then(() => {
          // 새 탭이 닫힐 때 현재 탭이 original tab이 아니라면 original tab으로 이동
          if (originalTabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                chrome.tabs.update(originalTabId, { active: true }).catch(() => {});
              }
            });
          }
        }).catch(err => {
        });
      }, 500); // 알림 표시를 위한 최소 대기 시간 (0.5초)
    }
  } else if (request.action === 'stopped') {
    const originalTabId = request.originalTabId || null;
    const collection = originalTabId ? collectionsByTab.get(originalTabId) : null;

    if (collection) {
      collectionsByTab.delete(originalTabId);
      const storageKey = `collectionStatus_${originalTabId}`;
      chrome.storage.local.remove(storageKey);
    }

    if (request.reviews !== undefined) {
      const collectionData = {
        reviews: request.reviews || [],
        timestamp: Date.now(),
        stopped: true,
        originalTabId: originalTabId
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
    }

    try {
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: request.message || '수집이 중지되었습니다.',
        reviews: request.reviews || [],
        originalTabId: originalTabId
      }).catch((err) => {
      });
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

      try {
        chrome.runtime.sendMessage({
          action: 'log',
          message: '수집 중지. 새 탭을 닫습니다...',
          type: 'warning'
        }).catch(() => {});
      } catch (e) {}

      setTimeout(() => {
        chrome.tabs.remove(collection.collectionTabId).then(() => {
          try {
            chrome.runtime.sendMessage({
              action: 'log',
              message: '새 탭이 닫혔습니다.',
              type: 'success'
            }).catch(() => {});
          } catch (e) {}

          // 새 탭이 닫힐 때 현재 탭이 original tab이 아니라면 original tab으로 이동
          if (originalTabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id !== originalTabId) {
                chrome.tabs.update(originalTabId, { active: true }).catch(() => {});
              }
            });
          }
        }).catch(err => {
        });
      }, 500);
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
      setTimeout(() => {
        chrome.tabs.remove(collection.collectionTabId).then(() => {
        }).catch(err => {
        });
      }, 500);
    }

    try {
      chrome.runtime.sendMessage(request).catch((err) => {
      });
    } catch (err) {
    }

    if (collection && collection.collectionTabId) {
      try {
        chrome.tabs.sendMessage(collection.collectionTabId, request).catch((err) => {
        });
      } catch (err) {
      }
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


async function startCollection(url, tabId, productId, ratingFilter = 'all', originalTabId = null) {
  if (originalTabId && collectionsByTab.has(originalTabId)) {
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

  if (originalTabId) {
    collectionsByTab.set(originalTabId, collection);
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
  while (pingRetries > 0 && !scriptReady) {
    try {
      const pingResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'ping'
      });
      if (pingResponse && pingResponse.success) {
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
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'startScraping',
        url,
        originalTabId: originalTabId,
        ratingFilter: ratingFilter
      });

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
