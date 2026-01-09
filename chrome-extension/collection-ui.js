// 리뷰 수집 UI (페이지에 주입)
(function () {
  'use strict';

  console.log('[UI] ========== Collection UI 스크립트 실행 ==========');
  console.log('[UI] 현재 페이지 URL:', window.location.href);

  // 이미 UI가 주입되어 있는지 확인
  if (document.getElementById('coupang-review-collector-ui')) {
    console.log('[UI] UI가 이미 주입되어 있음');
    return;
  }

  // UI는 startScraping 메시지를 받았을 때만 생성
  // 초기에는 UI를 생성하지 않음
  console.log('[UI] UI 스크립트 로드 완료 (수집 시작 시 UI 생성됨)');

  let uiContainer = null;
  let overlay = null;
  let isUICreated = false;
  let statusDiv = null;
  let progressFill = null;
  let progressText = null;
  let logContainer = null;
  let stopButton = null;

  // UI 생성 함수
  function createUI() {
    if (isUICreated) {
      console.log('[UI] UI가 이미 생성되어 있음');
      return;
    }

    console.log('[UI] 새 UI 생성 시작...');

    // 배경 오버레이 생성 (투명하게, 클릭 이벤트만 처리)
    overlay = document.createElement('div');
    overlay.id = 'crc-ui-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      z-index: 9999;
      pointer-events: none;
    `;

    // UI 컨테이너 생성 (상단 우측 구석의 작은 창)
    uiContainer = document.createElement('div');
    uiContainer.id = 'coupang-review-collector-ui';
    uiContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      background: white;
      border: 2px solid #667eea;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      pointer-events: auto;
    `;

    // 헤더 (작게)
    const header = document.createElement('div');
    header.style.cssText = `
      background: #667eea;
      color: white;
      padding: 10px 12px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <span>🛒 리뷰 수집기</span>
      <button id="crc-ui-close" style="background: transparent; border: none; color: white; cursor: pointer; font-size: 18px; padding: 0; width: 20px; height: 20px; line-height: 1;">✕</button>
    `;

    // 상태 표시 영역 (작게)
    statusDiv = document.createElement('div');
    statusDiv.id = 'crc-ui-status';
    statusDiv.style.cssText = `
      padding: 8px 12px;
      background: #d1ecf1;
      color: #0c5460;
      border-bottom: 1px solid #bee5eb;
      font-size: 12px;
    `;
    statusDiv.textContent = '리뷰 수집 준비 중...';

    // 진행률 표시 (작게)
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      padding: 10px 12px;
      border-bottom: 1px solid #e0e0e0;
    `;
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 100%;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    `;
    progressFill = document.createElement('div');
    progressFill.id = 'crc-ui-progress-fill';
    progressFill.style.cssText = `
      height: 100%;
      background: #667eea;
      width: 0%;
      transition: width 0.3s;
    `;
    progressBar.appendChild(progressFill);
    progressText = document.createElement('div');
    progressText.id = 'crc-ui-progress-text';
    progressText.style.cssText = `
      text-align: center;
      font-size: 11px;
      color: #666;
      font-weight: 500;
    `;
    progressText.textContent = '0%';
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);

    // 로그 헤더 (작게)
    const logHeader = document.createElement('div');
    logHeader.style.cssText = `
      padding: 8px 12px;
      background: #e9ecef;
      border-top: 1px solid #e0e0e0;
      border-bottom: 1px solid #e0e0e0;
      font-size: 12px;
      font-weight: 600;
      color: #495057;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    logHeader.innerHTML = `
      <span>진행 로그</span>
      <button id="crc-ui-clear-log" style="background: transparent; border: none; color: #6c757d; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 4px;">지우기</button>
    `;

    // 로그 영역 (작게)
    logContainer = document.createElement('div');
    logContainer.id = 'crc-ui-logs';
    logContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      font-size: 12px;
      font-family: 'Courier New', monospace;
      max-height: 250px;
      min-height: 150px;
      background: #f8f9fa;
    `;

    // 중지 버튼 영역 (작게)
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      padding: 8px 12px;
      border-top: 1px solid #e0e0e0;
      background: white;
      display: flex;
      justify-content: center;
    `;
    stopButton = document.createElement('button');
    stopButton.id = 'crc-ui-stop-btn';
    stopButton.textContent = '⏹ 중지';
    stopButton.style.cssText = `
      padding: 6px 16px;
      background: #dc3545;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      min-width: 80px;
    `;
    stopButton.addEventListener('mouseenter', () => {
      stopButton.style.background = '#c82333';
    });
    stopButton.addEventListener('mouseleave', () => {
      stopButton.style.background = '#dc3545';
    });
    stopButton.addEventListener('click', () => {
      // content script에 중지 메시지 전달
      window.postMessage({
        type: 'COUPANG_REVIEW_COLLECTOR_STOP',
        data: { action: 'stopScraping' }
      }, '*');
      addLog('중지 요청을 전송했습니다...', 'warning');
      stopButton.disabled = true;
      stopButton.textContent = '중지 중...';
      stopButton.style.opacity = '0.6';
      stopButton.style.cursor = 'not-allowed';
    });
    buttonContainer.appendChild(stopButton);

    // 조립
    uiContainer.appendChild(header);
    uiContainer.appendChild(statusDiv);
    uiContainer.appendChild(progressContainer);
    uiContainer.appendChild(logHeader);
    uiContainer.appendChild(logContainer);
    uiContainer.appendChild(buttonContainer);
    // uiContainer를 직접 body에 추가 (상단 우측 구석에 위치)
    document.body.appendChild(uiContainer);
    console.log('[UI] UI 컨테이너가 페이지에 추가됨');

    // 닫기 버튼
    document.getElementById('crc-ui-close').addEventListener('click', () => {
      if (uiContainer) uiContainer.remove();
      if (overlay) overlay.remove();
      isUICreated = false;
    });

    // 로그 지우기 버튼
    document.getElementById('crc-ui-clear-log').addEventListener('click', () => {
      if (logContainer) {
        logContainer.innerHTML = '';
        // storage에서도 로그 삭제
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.remove('collectionLogs');
        }
        addLog('로그가 지워졌습니다.', 'info');
      }
    });

    // 배경 오버레이 클릭 시 닫기 기능 제거 (상단 구석 창이므로)

    isUICreated = true;
    addLog('리뷰 수집 UI가 준비되었습니다.', 'info');

    // storage에서 기존 로그 불러오기
    loadLogsFromStorage();
  }

  // 로그 추가 함수 (storage에서도 불러오기)
  function addLog(message, type = 'info') {
    // UI가 생성되지 않았으면 생성
    if (!isUICreated) {
      console.log('[UI] ⚠️ UI가 생성되지 않아 생성 중...');
      createUI();
      console.log('[UI] ✅ UI 생성 완료');
    }

    if (!logContainer) {
      logContainer = document.getElementById('crc-ui-logs');
      if (!logContainer) {
        return;
      }
    }

    const time = new Date().toLocaleTimeString('ko-KR');
    const logEntry = document.createElement('div');
    logEntry.style.cssText = `
      margin-bottom: 4px;
      padding: 4px 0;
      border-bottom: 1px solid #e9ecef;
      line-height: 1.4;
    `;

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'color: #6c757d; font-size: 11px; margin-right: 8px; font-weight: 500;';
    timeSpan.textContent = `[${time}]`;

    const messageSpan = document.createElement('span');
    const colors = {
      info: '#0c5460',
      success: '#155724',
      warning: '#856404',
      error: '#721c24'
    };
    messageSpan.style.color = colors[type] || colors.info;
    messageSpan.style.fontSize = '12px';
    messageSpan.textContent = message;

    logEntry.appendChild(timeSpan);
    logEntry.appendChild(messageSpan);
    logContainer.appendChild(logEntry);
    // 자동 스크롤
    logContainer.scrollTop = logContainer.scrollHeight;
    // 최대 200개 로그 유지
    while (logContainer.children.length > 200) {
      logContainer.removeChild(logContainer.firstChild);
    }
  }

  // storage에서 로그 불러오기
  function loadLogsFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['collectionLogs'], (result) => {
        if (result.collectionLogs && result.collectionLogs.length > 0) {
          // UI가 생성되지 않았으면 생성
          if (!isUICreated) {
            createUI();
          }

          if (logContainer) {
            logContainer.innerHTML = '';
            result.collectionLogs.forEach(log => {
              const time = log.time || new Date().toLocaleTimeString('ko-KR');
              const logEntry = document.createElement('div');
              logEntry.style.cssText = `
                margin-bottom: 4px;
                padding: 4px 0;
                border-bottom: 1px solid #e9ecef;
                line-height: 1.4;
              `;

              const timeSpan = document.createElement('span');
              timeSpan.style.cssText = 'color: #6c757d; font-size: 11px; margin-right: 8px; font-weight: 500;';
              timeSpan.textContent = `[${time}]`;

              const messageSpan = document.createElement('span');
              const colors = {
                info: '#0c5460',
                success: '#155724',
                warning: '#856404',
                error: '#721c24'
              };
              messageSpan.style.color = colors[log.type] || colors.info;
              messageSpan.style.fontSize = '12px';
              messageSpan.textContent = log.message;

              logEntry.appendChild(timeSpan);
              logEntry.appendChild(messageSpan);
              logContainer.appendChild(logEntry);
            });

            // 자동 스크롤
            logContainer.scrollTop = logContainer.scrollHeight;
          }
        }
      });
    }
  }

  // window.postMessage 리스너 (content script에서 직접 전달)
  // 주의: 이 스크립트는 page context에서 실행되므로 chrome.runtime API를 사용할 수 없습니다.
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'COUPANG_REVIEW_COLLECTOR') {
      handleUIMessage(event.data.data);
    }
  });

  // UI 메시지 처리 함수
  function handleUIMessage(request) {
    // UI가 생성되지 않았으면 생성
    if (!isUICreated) {
      createUI();
    }

    if (request.action === 'progress') {
      const percent = request.percent || 0;
      if (progressFill) progressFill.style.width = percent + '%';
      if (progressText) progressText.textContent = request.text || `${percent}%`;
      if (request.log) {
        addLog(request.log, request.logType || 'info');
      }
    } else if (request.action === 'log') {
      addLog(request.message, request.type || 'info');
    } else if (request.action === 'status') {
      if (statusDiv) {
        statusDiv.textContent = request.message;
        const statusColors = {
          info: '#d1ecf1',
          success: '#d4edda',
          warning: '#fff3cd',
          error: '#f8d7da'
        };
        statusDiv.style.background = statusColors[request.type] || statusColors.info;
      }
    } else if (request.action === 'complete') {
      const reviewCount = request.reviews?.length || 0;

      // 상태 업데이트
      if (statusDiv) {
        statusDiv.textContent = `✅ 수집 완료! 총 ${reviewCount}개의 리뷰가 수집되었습니다.`;
        statusDiv.style.background = '#d4edda';
        statusDiv.style.color = '#155724';
      }

      // 진행률 업데이트
      if (progressFill) progressFill.style.width = '100%';
      if (progressText) progressText.textContent = '100%';

      // 완료 로그 표시
      if (logContainer) {
        addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰가 수집되었습니다.`, 'success');
        addLog(`📊 수집된 리뷰 데이터가 저장되었습니다.`, 'info');
      } else {
        // logContainer를 다시 찾기 시도
        logContainer = document.getElementById('crc-ui-logs');
        if (logContainer) {
          addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰가 수집되었습니다.`, 'success');
          addLog(`📊 수집된 리뷰 데이터가 저장되었습니다.`, 'info');
        }
      }
    } else if (request.action === 'error') {
      if (statusDiv) {
        statusDiv.textContent = `오류: ${request.error}`;
        statusDiv.style.background = '#f8d7da';
        statusDiv.style.color = '#721c24';
      }
      addLog(`오류: ${request.error}`, 'error');
    } else if (request.action === 'stopped') {
      if (statusDiv) {
        statusDiv.textContent = '수집이 중지되었습니다.';
        statusDiv.style.background = '#fff3cd';
        statusDiv.style.color = '#856404';
      }
      addLog('수집이 중지되었습니다.', 'warning');
      // 중지 버튼 비활성화
      if (stopButton) {
        stopButton.disabled = true;
        stopButton.textContent = '중지됨';
        stopButton.style.opacity = '0.6';
        stopButton.style.cursor = 'not-allowed';
      }
    } else if (request.action === 'startScraping') {
      // 수집 시작 메시지를 받으면 UI 생성
      createUI();
      addLog('리뷰 수집을 시작합니다...', 'info');
    }
  }

  console.log('[UI] Collection UI 초기화 완료 (수집 시작 시 UI 생성됨)');
  console.log('[UI] window.postMessage 리스너 준비됨');
})();
