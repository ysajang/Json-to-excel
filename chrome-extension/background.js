// Background Service Worker
console.log('[Background] ========== Background Service Worker 시작 ==========');

let currentCollection = null;
let collectionTabId = null;
let originalTabId = null; // 수집 시작한 원래 탭 ID 저장

// 메시지 리스너
console.log('[Background] 메시지 리스너 등록 중...');
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] ========== 메시지 수신 ==========');
  console.log('[Background] Action:', request.action);
  console.log('[Background] Sender:', sender);
  console.log('[Background] Request:', request);

  if (request.action === 'startCollection') {
    console.log('[Background] ========== startCollection 요청 수신 ==========');
    console.log('[Background] URL:', request.url);
    console.log('[Background] Tab ID:', request.tabId);
    console.log('[Background] Product ID:', request.productId);
    console.log('[Background] Original Tab ID (요청에서):', request.originalTabId);
    console.log('[Background] 현재 currentCollection:', currentCollection);
    console.log('[Background] Sender Tab ID:', sender.tab?.id);

    // 원래 탭 ID 저장 (요청에서 전달된 탭 ID 우선, 없으면 sender.tab.id 사용)
    if (request.originalTabId) {
      originalTabId = request.originalTabId;
      console.log('[Background] ✅ 원래 탭 ID 저장 (요청에서):', originalTabId);
    } else if (sender.tab && sender.tab.id) {
      originalTabId = sender.tab.id;
      console.log('[Background] ✅ 원래 탭 ID 저장 (sender에서):', originalTabId);
    } else {
      console.warn('[Background] ⚠️ 원래 탭 ID를 가져올 수 없습니다. (originalTabId: null)');
      // 현재 활성 탭을 대신 사용 시도
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          originalTabId = tabs[0].id;
          console.log('[Background] ✅ 원래 탭 ID 저장 (현재 활성 탭에서):', originalTabId);
        } else {
          console.warn('[Background] ⚠️ 현재 활성 탭 ID도 가져올 수 없습니다.');
        }
      });
    }

    // 중복 실행 방지
    if (currentCollection) {
      const errorMsg = '이미 수집 중입니다.';
      console.warn('[Background]', errorMsg);
      try {
        sendResponse({ success: false, error: errorMsg });
      } catch (e) {
        console.error('[Background] 응답 전송 실패:', e);
      }
      return false;
    }

    // Tab ID가 없으면 새 탭 생성
    if (!request.tabId) {
      console.log('[Background] Tab ID가 없어 새 탭을 생성합니다...');
      console.log('[Background] URL:', request.url);

      // 즉시 응답 (비동기 작업 시작 확인)
      try {
        sendResponse({ success: true, message: '새 탭 생성 중...' });
        console.log('[Background] 응답 전송 완료: 새 탭 생성 시작');
      } catch (e) {
        console.debug('[Background] 응답 전송 실패 (무시 가능):', e);
      }

      // 새 탭 생성 후 수집 시작
      chrome.tabs.create({
        url: request.url,
        active: true
      }).then(newTab => {
        console.log('[Background] 새 탭 생성 완료, 탭 ID:', newTab.id);
        // 페이지 로드 대기 후 수집 시작
        setTimeout(() => {
          startCollection(request.url, newTab.id, request.productId, request.ratingFilter)
            .catch(error => {
              console.error('[Background] startCollection 실패:', error);
              currentCollection = null;
              chrome.storage.local.remove('collectionStatus');
              if (collectionTabId) {
                chrome.tabs.remove(collectionTabId).catch(() => {});
                collectionTabId = null;
              }
            });
        }, 3000);
      }).catch(error => {
        console.error('[Background] 새 탭 생성 실패:', error);
        currentCollection = null;
        chrome.storage.local.remove('collectionStatus');
      });

      return true; // 비동기 응답
    }

    console.log('[Background] startCollection 함수 호출 시작...');
    startCollection(request.url, request.tabId, request.productId, request.ratingFilter)
      .then(() => {
        console.log('[Background] startCollection 완료');
        try {
          sendResponse({ success: true });
          console.log('[Background] 응답 전송 완료: success=true');
        } catch (e) {
          console.debug('[Background] 응답 전송 실패 (무시 가능):', e);
        }
      })
      .catch(error => {
        console.error('[Background] startCollection 실패:', error);
        console.error('[Background] 에러 스택:', error.stack);
        // 수집 실패 시 상태 초기화
        currentCollection = null;
        chrome.storage.local.remove('collectionStatus');
        // 탭도 닫기
        if (collectionTabId) {
          chrome.tabs.remove(collectionTabId).catch(() => {});
          collectionTabId = null;
        }
        try {
          sendResponse({ success: false, error: error.message });
          console.log('[Background] 오류 응답 전송:', error.message);
        } catch (e) {
          console.debug('[Background] 오류 응답 전송 실패 (무시 가능):', e);
        }
      });
    return true;
  } else if (request.action === 'stopCollection') {
    stopCollection();
    sendResponse({ success: true });
  } else if (request.action === 'convertToExcel') {
    // CSV 문자열 생성하여 popup.js로 전달
    try {
      const csvContent = convertToExcel(request.reviews);
      sendResponse({ success: true, csvContent: csvContent });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === 'progress' || request.action === 'log') {
    // 진행 상황을 storage에 저장 (progress만)
    if (request.action === 'progress') {
      chrome.storage.local.set({
        collectionProgress: {
          percent: request.percent,
          text: request.text,
          timestamp: Date.now()
        }
      });
    }

    // 로그를 storage에 저장 (팝업이 닫혀도 유지)
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

        // 최대 200개 로그 유지
        if (logs.length > 200) {
          logs.shift();
        }

        chrome.storage.local.set({ collectionLogs: logs });
      });
    }

    // 진행 상황 및 로그를 popup에 전달 (popup이 열려있을 때만)
    try {
      chrome.runtime.sendMessage(request).catch((err) => {
        // 모든 오류를 조용히 무시 (popup이 닫혀있거나 context가 무효화된 경우)
        console.debug('메시지 전달 실패 (무시 가능):', err?.message || err);
      });
    } catch (err) {
      // 모든 예외를 조용히 무시
      console.debug('메시지 전달 중 예외 (무시 가능):', err?.message || err);
    }

    // 새 탭의 content script에도 메시지 전달 (페이지 UI에 표시)
    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, request).catch((err) => {
          console.debug('새 탭 메시지 전달 실패 (무시 가능):', err?.message || err);
        });
      } catch (err) {
        console.debug('새 탭 메시지 전달 중 예외 (무시 가능):', err?.message || err);
      }
    }
  } else if (request.action === 'complete') {
    // 수집 상태 초기화
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    // 완료 메시지를 popup에 전달 및 storage에 저장 (탭 ID별로 저장)
    const collectionData = {
      reviews: request.reviews,
      timestamp: Date.now(),
      stopped: request.stopped || false,
      originalTabId: originalTabId || null
    };

    // 탭 ID별로 저장
    if (originalTabId) {
      const storageKey = `collection_${originalTabId}`;
      chrome.storage.local.set({
        [storageKey]: collectionData,
        lastCollection: collectionData // 호환성을 위해 유지
      });
      console.log(`[Background] 리뷰를 탭 ID별로 저장: ${storageKey}, 리뷰 수: ${request.reviews.length}`);
    } else {
      // originalTabId가 없으면 기존 방식으로 저장
      chrome.storage.local.set({
        lastCollection: collectionData
      });
      console.log('[Background] originalTabId가 없어 lastCollection에 저장');
    }

    // popup에 전달 (중지 여부 포함)
    try {
      chrome.runtime.sendMessage({
        action: 'complete',
        reviews: request.reviews,
        stopped: request.stopped || false
      }).catch((err) => {
        // 모든 오류를 조용히 무시 (popup이 닫혀있거나 context가 무효화된 경우)
        console.debug('완료 메시지 전달 실패 (무시 가능):', err?.message || err);
      });
    } catch (err) {
      // 모든 예외를 조용히 무시
      console.debug('완료 메시지 전달 중 예외 (무시 가능):', err?.message || err);
    }

    // 새 탭의 content script에도 완료 메시지 전달 (페이지 UI에 표시)
    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, {
          action: 'complete',
          reviews: request.reviews,
          stopped: request.stopped || false
        }).catch((err) => {
          console.debug('새 탭 완료 메시지 전달 실패 (무시 가능):', err?.message || err);
        });
      } catch (err) {
        console.debug('새 탭 완료 메시지 전달 중 예외 (무시 가능):', err?.message || err);
      }
    }

    // 수집 완료 후 탭 닫기
    if (collectionTabId) {
      console.log('[수집 완료] 수집 탭 닫기:', collectionTabId);
      // popup에 탭 닫기 알림 전송
      try {
        chrome.runtime.sendMessage({
          action: 'log',
          message: '리뷰 수집 완료. 새 탭을 닫습니다...',
          type: 'info'
        }).catch(() => {});
      } catch (e) {}

      // 잠시 대기 후 탭 닫기 (이미 원래 탭으로 포커스는 수집 시작 시 이동했음)
      console.log('[수집 완료] ========== 탭 닫기 시작 ==========');
      console.log('[수집 완료] collectionTabId:', collectionTabId);

      setTimeout(() => {
        console.log('[수집 완료] 수집 탭 닫기 시작... (탭 ID:', collectionTabId, ')');
        chrome.tabs.remove(collectionTabId).then(() => {
          console.log('[수집 완료] ✅ 탭 닫기 성공 (탭 ID:', collectionTabId, ')');
          console.log('[수집 완료] collectionTabId 및 originalTabId 초기화');
          // popup에 탭 닫기 완료 알림
          try {
            chrome.runtime.sendMessage({
              action: 'log',
              message: '새 탭이 닫혔습니다.',
              type: 'success'
            }).catch(() => {});
          } catch (e) {}
          collectionTabId = null;
          originalTabId = null;
          console.log('[수집 완료] ========== 탭 닫기 완료 ==========');
        }).catch(err => {
          console.error('[수집 완료] ❌ 탭 닫기 실패:', err);
          console.debug('[수집 완료] 탭 닫기 실패 (무시 가능):', err);
          collectionTabId = null;
          originalTabId = null;
        });
      }, 2000); // 2초 대기 후 탭 닫기
    }
  } else if (request.action === 'stopped') {
    // 중지 메시지 수신 (즉시 중지)
    console.log('[수집 중지] 중지 메시지 수신');
    console.log('[수집 중지] 리뷰 수:', request.reviews ? request.reviews.length : 0);
    console.log('[수집 중지] collectionTabId:', collectionTabId);
    console.log('[수집 중지] originalTabId:', originalTabId);
    console.log('[수집 중지] sender.tab.id:', sender.tab?.id);

    // 수집 상태 초기화
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    // collectionTabId가 없으면 sender.tab.id를 사용 (별점 필터로 인한 종료 시)
    if (!collectionTabId && sender.tab && sender.tab.id) {
      collectionTabId = sender.tab.id;
      console.log('[수집 중지] collectionTabId를 sender.tab.id로 설정:', collectionTabId);
    }

    // 리뷰가 있으면 저장 (별점 필터로 인한 종료 시 리뷰 0개 포함)
    if (request.reviews !== undefined) {
      const collectionData = {
        reviews: request.reviews || [],
        timestamp: Date.now(),
        stopped: true,
        originalTabId: originalTabId || null
      };

      // 탭 ID별로 저장
      if (originalTabId) {
        const storageKey = `collection_${originalTabId}`;
        chrome.storage.local.set({
          [storageKey]: collectionData,
          lastCollection: collectionData // 호환성을 위해 유지
        });
        console.log(`[Background] 중지된 리뷰를 탭 ID별로 저장: ${storageKey}, 리뷰 수: ${request.reviews.length}`);
      } else {
        chrome.storage.local.set({
          lastCollection: collectionData
        });
        console.log('[Background] originalTabId가 없어 lastCollection에 저장');
      }
    }

    // popup에 전달
    try {
      chrome.runtime.sendMessage({
        action: 'stopped',
        message: request.message || '수집이 중지되었습니다.',
        reviews: request.reviews || [] // 리뷰 데이터 포함
      }).catch((err) => {
        console.debug('중지 메시지 전달 실패 (무시 가능):', err?.message || err);
      });
    } catch (err) {
      console.debug('중지 메시지 전달 중 예외 (무시 가능):', err?.message || err);
    }

    // 새 탭의 content script에도 중지 메시지 전달 (페이지 UI에 표시)
    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, {
          action: 'stopped',
          message: request.message || '수집이 중지되었습니다.'
        }).catch((err) => {
          console.debug('새 탭 중지 메시지 전달 실패 (무시 가능):', err?.message || err);
        });
      } catch (err) {
        console.debug('새 탭 중지 메시지 전달 중 예외 (무시 가능):', err?.message || err);
      }
    }

    // 중지 시 탭 닫기
    if (collectionTabId) {
      console.log('[수집 중지] 수집 탭 닫기:', collectionTabId);
      // popup에 탭 닫기 알림 전송
      try {
        chrome.runtime.sendMessage({
          action: 'log',
          message: '수집 중지. 새 탭을 닫습니다...',
          type: 'warning'
        }).catch(() => {});
      } catch (e) {}

      // 탭 닫기 (이미 원래 탭으로 포커스는 수집 시작 시 이동했음)
      console.log('[수집 중지] ========== 탭 닫기 시작 ==========');
      console.log('[수집 중지] collectionTabId:', collectionTabId);

      setTimeout(() => {
        console.log('[수집 중지] 수집 탭 닫기 시작... (탭 ID:', collectionTabId, ')');
        chrome.tabs.remove(collectionTabId).then(() => {
          console.log('[수집 중지] ✅ 탭 닫기 성공 (탭 ID:', collectionTabId, ')');
          console.log('[수집 중지] collectionTabId 및 originalTabId 초기화');
          // popup에 탭 닫기 완료 알림
          try {
            chrome.runtime.sendMessage({
              action: 'log',
              message: '새 탭이 닫혔습니다.',
              type: 'success'
            }).catch(() => {});
          } catch (e) {}
          collectionTabId = null;
          originalTabId = null;
          console.log('[수집 중지] ========== 탭 닫기 완료 ==========');
        }).catch(err => {
          console.error('[수집 중지] ❌ 탭 닫기 실패:', err);
          console.debug('[수집 중지] 탭 닫기 실패 (무시 가능):', err);
          collectionTabId = null;
          originalTabId = null;
        });
      }, 500); // 0.5초 대기 후 탭 닫기
    }
  } else if (request.action === 'error') {
    // 오류 발생 시 수집 상태 초기화
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    // 오류 발생 시에도 탭 닫기
    if (collectionTabId) {
      // 탭 닫기 (이미 원래 탭으로 포커스는 수집 시작 시 이동했음)
      console.log('[수집 오류] ========== 탭 닫기 시작 ==========');
      console.log('[수집 오류] collectionTabId:', collectionTabId);
      console.log('[수집 오류] 수집 탭 닫기:', collectionTabId);

      setTimeout(() => {
        console.log('[수집 오류] 수집 탭 닫기 시작... (탭 ID:', collectionTabId, ')');
        chrome.tabs.remove(collectionTabId).then(() => {
          console.log('[수집 오류] ✅ 탭 닫기 성공 (탭 ID:', collectionTabId, ')');
          console.log('[수집 오류] collectionTabId 및 originalTabId 초기화');
        }).catch(err => {
          console.error('[수집 오류] ❌ 탭 닫기 실패:', err);
          console.debug('[수집 오류] 탭 닫기 실패 (무시 가능):', err);
        });
        collectionTabId = null;
        originalTabId = null;
        console.log('[수집 오류] ========== 탭 닫기 완료 ==========');
      }, 500); // 0.5초 대기 후 탭 닫기
    }

    // 오류 메시지를 popup에 전달
    try {
      chrome.runtime.sendMessage(request).catch((err) => {
        // 모든 오류를 조용히 무시 (popup이 닫혀있거나 context가 무효화된 경우)
        console.debug('오류 메시지 전달 실패 (무시 가능):', err?.message || err);
      });
    } catch (err) {
      // 모든 예외를 조용히 무시
      console.debug('오류 메시지 전달 중 예외 (무시 가능):', err?.message || err);
    }

    // 새 탭의 content script에도 오류 메시지 전달 (페이지 UI에 표시)
    if (collectionTabId) {
      try {
        chrome.tabs.sendMessage(collectionTabId, request).catch((err) => {
          console.debug('새 탭 오류 메시지 전달 실패 (무시 가능):', err?.message || err);
        });
      } catch (err) {
        console.debug('새 탭 오류 메시지 전달 중 예외 (무시 가능):', err?.message || err);
      }
    }
  } else if (request.action === 'getCollectionStatus') {
    // popup에서 수집 상태 조회 요청
    if (currentCollection) {
      sendResponse({
        isCollecting: true,
        url: currentCollection.url,
        tabId: currentCollection.tabId,
        productId: currentCollection.productId,
        startTime: currentCollection.startTime
      });
    } else {
      // storage에서 확인
      chrome.storage.local.get(['collectionStatus'], (result) => {
        if (result.collectionStatus && result.collectionStatus.isCollecting) {
          sendResponse(result.collectionStatus);
        } else {
          sendResponse({ isCollecting: false });
        }
      });
      return true; // 비동기 응답
    }
    return true;
  }
});

// 수집 시작
async function startCollection(url, tabId, productId, ratingFilter = null) {
  console.log('[Background] ========== startCollection 함수 시작 ==========');
  console.log('[Background] URL:', url);
  console.log('[Background] Tab ID:', tabId);
  console.log('[Background] Product ID:', productId);
  console.log('[Background] Rating Filter:', ratingFilter);

  // 중복 실행 방지 (이미 체크했지만 이중 체크)
  if (currentCollection) {
    console.error('[Background] 이미 수집 중입니다!');
    throw new Error('이미 수집 중입니다.');
  }

  currentCollection = {
    url,
    tabId,
    productId,
    startTime: Date.now()
  };

  // 탭 ID 저장 (완료 후 탭 닫기용)
  collectionTabId = tabId;
  console.log('[Background] 탭 ID 저장:', tabId);

  // 수집 상태를 storage에 저장
  chrome.storage.local.set({
    collectionStatus: {
      isCollecting: true,
      url,
      tabId,
      productId,
      startTime: currentCollection.startTime
    }
  });

  // Content Script가 준비될 때까지 대기 (최대 10초)
  console.log('[Background] Content Script 준비 상태 확인 시작...');
  let scriptReady = false;
  let pingRetries = 10;
  console.log('[Background] Content Script 준비 상태 확인 시작...');
  while (pingRetries > 0 && !scriptReady) {
    try {
      console.log(`[Background] ping 메시지 전송 시도 (${11 - pingRetries}/10), 탭 ID: ${tabId}`);
      const pingResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'ping'
      });
      console.log('[Background] ping 응답 수신:', pingResponse);
      if (pingResponse && pingResponse.success) {
        scriptReady = true;
        console.log('[Background] ✅ Content Script 준비 확인됨');
        break;
      } else {
        console.warn('[Background] ping 응답이 성공이 아님:', pingResponse);
      }
    } catch (pingError) {
      pingRetries--;
      console.warn(`[Background] ❌ ping 실패 (${pingRetries}회 남음):`, pingError.message);
      console.warn('[Background] ping 에러 상세:', pingError);
      if (pingRetries > 0) {
        console.log(`[Background] Content Script 준비 대기 중... (${10 - pingRetries}/10)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.warn('[Background] ⚠️ Content Script 준비 확인 실패, 계속 진행...');
      }
    }
  }

  if (!scriptReady) {
    console.warn('[Background] Content Script 준비 확인 실패했지만 계속 진행합니다.');
  }

  // Content Script에 수집 시작 메시지 전송 (재시도 로직 추가)
  console.log('[Background] Content Script에 startScraping 메시지 전송 시작...');
  let startScrapingSuccess = false;
  let startScrapingRetries = 5;
  let lastError = null;

  while (startScrapingRetries > 0 && !startScrapingSuccess) {
    try {
      console.log(`[Background] startScraping 메시지 전송 시도 (${6 - startScrapingRetries}/5)`);
      console.log(`[Background] 탭 ID: ${tabId}, URL: ${url}`);

      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'startScraping',
        url,
        originalTabId: originalTabId, // originalTabId 전달
        ratingFilter: ratingFilter // 별점 필터 전달
      });

      console.log('[Background] startScraping 응답 수신:', response);

      // 응답 확인
      if (response && response.success) {
        startScrapingSuccess = true;
        console.log('[Background] startScraping 메시지 전송 성공');

        // 수집이 정상적으로 시작되면 원래 탭으로 포커스 이동
        if (originalTabId) {
          console.log('[Background] ========== 수집 시작 성공, 원래 탭으로 포커스 이동 ==========');
          console.log('[Background] 원래 탭 ID:', originalTabId);
          console.log('[Background] 수집 탭 ID:', tabId);

          chrome.tabs.update(originalTabId, { active: true }).then(() => {
            console.log('[Background] ✅ 원래 탭으로 포커스 이동 성공:', originalTabId);
          }).catch(err => {
            console.error('[Background] ❌ 원래 탭 포커스 이동 실패:', err);
            console.debug('[Background] 원래 탭 포커스 이동 실패 (무시 가능):', err);
          });
        }

        break;
      } else if (response && !response.success) {
        lastError = new Error(response.error || '수집을 시작할 수 없습니다.');
        console.error('[Background] startScraping 응답 실패:', response.error);
        break; // 응답이 있으면 재시도하지 않음
      } else {
        console.warn('[Background] startScraping 응답이 없거나 형식이 잘못됨:', response);
      }
    } catch (error) {
      lastError = error;
      startScrapingRetries--;
      console.warn(`[Background] startScraping 메시지 전송 실패 (${startScrapingRetries}회 남음):`, error.message);
      console.warn('[Background] 에러 상세:', error);

      if (startScrapingRetries > 0) {
        // Extension context invalidated 오류는 재시도하지 않음
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.error('[Background] Extension context invalidated - 재시도 중단');
          break;
        }
        console.log(`[Background] 1초 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.log('[Background] startScraping 메시지 전송 결과:', startScrapingSuccess ? '성공' : '실패');

  if (!startScrapingSuccess) {
    currentCollection = null;
    chrome.storage.local.remove('collectionStatus');

    if (lastError) {
      // Extension context invalidated 오류인지 확인
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

// 수집 중지
async function stopCollection() {
  if (currentCollection) {
    // Content Script에 중지 메시지 전송
    try {
      await chrome.tabs.sendMessage(currentCollection.tabId, {
        action: 'stopScraping'
      });

      // Content Script가 중지 후 현재까지 수집한 데이터를 반환할 때까지 대기
      // (complete 메시지가 자동으로 전송됨)
      console.log('수집 중지 요청 전송됨. 현재까지 수집한 데이터를 기다리는 중...');
    } catch (error) {
      // 모든 오류를 조용히 처리하고 상태 초기화
      console.debug('중지 메시지 전송 실패 (무시 가능):', error?.message || error);
      // 탭이 닫혔거나 접근할 수 없는 경우에도 상태 초기화
      currentCollection = null;
      chrome.storage.local.remove('collectionStatus');
    }
  } else {
    // currentCollection이 없어도 storage에서 상태 확인
    chrome.storage.local.get(['collectionStatus'], (result) => {
      if (result.collectionStatus && result.collectionStatus.isCollecting) {
        // 저장된 상태가 있으면 Content Script에 중지 메시지 전송 시도
        const status = result.collectionStatus;
        chrome.tabs.sendMessage(status.tabId, {
          action: 'stopScraping'
        }).catch(() => {
          // 탭이 없으면 상태만 초기화
          chrome.storage.local.remove('collectionStatus');
        });
      }
    });
  }
}

// Excel 변환 (CSV 형식으로 변환)
function convertToExcel(reviews) {
  try {
    // CSV 형식으로 변환 (author 필드 제거)
    const headers = ['내용', '평점', '날짜'];
    const rows = reviews.map(review => {
      const content = (review.content || '').replace(/"/g, '""').replace(/  /g, '\n'); // 공백 2개를 줄바꿈으로, 따옴표 이스케이프
      return [
        content,
        review.rating || '',
        review.date || ''
      ];
    });

    // CSV 문자열 생성
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // BOM 추가 (Excel에서 한글 깨짐 방지)
    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;

    return csvWithBOM;
  } catch (error) {
    throw new Error('Excel 변환 실패: ' + error.message);
  }
}

// 설치 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('쿠팡 리뷰 수집기 확장 프로그램이 설치되었습니다.');
});
