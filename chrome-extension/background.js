

let currentCollection = null;
let collectionTabId = null;
let originalTabId = null; 


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'startCollection') {
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

    if (currentCollection) {
      const errorMsg = '이미 수집 중입니다.';
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
          startCollection(request.url, newTab.id, request.productId)
            .catch(error => {
              currentCollection = null;
              chrome.storage.local.remove('collectionStatus');
              if (collectionTabId) {
              }
            });
        }, 3000);
      }).catch(error => {
        currentCollection = null;
        chrome.storage.local.remove('collectionStatus');
      });

      return true; 
    }

    startCollection(request.url, request.tabId, request.productId)
      .then(() => {
        try {
          sendResponse({ success: true });
        } catch (e) {
        }
      })
      .catch(error => {
        currentCollection = null;
        chrome.storage.local.remove('collectionStatus');
        if (collectionTabId) {
        }
        try {
          sendResponse({ success: false, error: error.message });
        } catch (e) {
        }
      });
    return true;
  } else if (request.action === 'stopCollection') {
    stopCollection();
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
      chrome.storage.local.set({
        collectionProgress: {
          percent: request.percent,
          text: request.text,
          timestamp: Date.now()
        }
      });
    }

    if (request.action === 'log') {
      const time = new Date().toLocaleTimeString('ko-KR');
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

    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, request).catch((err) => {
        });
      } catch (err) {
      }
    }
  } else if (request.action === 'complete') {
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    const collectionData = {
      reviews: request.reviews,
      timestamp: Date.now(),
      stopped: request.stopped || false,
      originalTabId: originalTabId || null
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
        stopped: request.stopped || false
      }).catch((err) => {
      });
    } catch (err) {
    }

    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, {
          action: 'complete',
          reviews: request.reviews,
          stopped: request.stopped || false
        }).catch((err) => {
        });
      } catch (err) {
      }
    }

    if (collectionTabId) {
      try {
        chrome.runtime.sendMessage({
          action: 'log',
          message: '리뷰 수집 완료. 새 탭을 닫습니다...',
          type: 'info'
        }).catch(() => {});
      } catch (e) {}

      setTimeout(() => {
        chrome.tabs.remove(collectionTabId).then(() => {
          try {
            chrome.runtime.sendMessage({
              action: 'log',
              message: '새 탭이 닫혔습니다.',
              type: 'success'
            }).catch(() => {});
          } catch (e) {}
          collectionTabId = null;
          originalTabId = null;
        }).catch(err => {
          collectionTabId = null;
          originalTabId = null;
        });
      }, 2000); 
    }
  } else if (request.action === 'stopped') {
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    if (!collectionTabId && sender.tab && sender.tab.id) {
      collectionTabId = sender.tab.id;
    }

    if (request.reviews !== undefined) {
      const collectionData = {
        reviews: request.reviews || [],
        timestamp: Date.now(),
        stopped: true,
        originalTabId: originalTabId || null
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
        reviews: request.reviews || [] 
      }).catch((err) => {
      });
    } catch (err) {
    }

    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, {
          action: 'stopped',
          message: request.message || '수집이 중지되었습니다.'
        }).catch((err) => {
        });
      } catch (err) {
      }
    }

    if (collectionTabId) {
      try {
        chrome.runtime.sendMessage({
          action: 'log',
          message: '수집 중지. 새 탭을 닫습니다...',
          type: 'warning'
        }).catch(() => {});
      } catch (e) {}

      setTimeout(() => {
        chrome.tabs.remove(collectionTabId).then(() => {
          try {
            chrome.runtime.sendMessage({
              action: 'log',
              message: '새 탭이 닫혔습니다.',
              type: 'success'
            }).catch(() => {});
          } catch (e) {}
          collectionTabId = null;
          originalTabId = null;
        }).catch(err => {
          collectionTabId = null;
          originalTabId = null;
        });
      }, 500); 
    }
  } else if (request.action === 'error') {
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    if (collectionTabId) {
      setTimeout(() => {
        chrome.tabs.remove(collectionTabId).then(() => {
          collectionTabId = null;
          originalTabId = null;
        }).catch(err => {
          collectionTabId = null;
          originalTabId = null;
        });
      }, 500); 
    }

    try {
      chrome.runtime.sendMessage(request).catch((err) => {
      });
    } catch (err) {
    }

    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, request).catch((err) => {
        });
      } catch (err) {
      }
    }
  } else if (request.action === 'getCollectionStatus') {
    if (currentCollection) {
      sendResponse({
        isCollecting: true,
        url: currentCollection.url,
        tabId: currentCollection.tabId,
        productId: currentCollection.productId,
        startTime: currentCollection.startTime
      });
    } else {
      chrome.storage.local.get(['collectionStatus'], (result) => {
        if (result.collectionStatus && result.collectionStatus.isCollecting) {
          sendResponse(result.collectionStatus);
        } else {
          sendResponse({ isCollecting: false });
        }
      });
      return true; 
    }
    return true;
  }
});


async function startCollection(url, tabId, productId) {
  if (currentCollection) {
    throw new Error('이미 수집 중입니다.');
  }

  currentCollection = {
    url,
    tabId,
    productId,
    startTime: Date.now()
  };

  collectionTabId = tabId;

  chrome.storage.local.set({
    collectionStatus: {
      isCollecting: true,
      url,
      tabId,
      productId,
      startTime: currentCollection.startTime
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
        await new Promise(resolve => setTimeout(resolve, 1000));
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
        originalTabId: originalTabId 
      });

      if (response && response.success) {
        startScrapingSuccess = true;

        if (originalTabId) {
          chrome.tabs.update(originalTabId, { active: true }).then(() => {
          }).catch(err => {
          });
        }

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
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  if (!startScrapingSuccess) {
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

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


async function stopCollection() {
  if (currentCollection) {
    try {
      await chrome.tabs.sendMessage(currentCollection.tabId, {
        action: 'stopScraping'
      });

    } catch (error) {
      currentCollection = null;
      chrome.storage.local.remove('collectionStatus');
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
    const headers = ['내용', '평점', '날짜'];
    const rows = reviews.map(review => {
      const content = (review.content || '').replace(/"/g, '""').replace(/  /g, '\n'); 
      return [
        content,
        review.rating || '',
        review.date || ''
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
