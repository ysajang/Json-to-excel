(function () {
  'use strict';

  if (document.getElementById('coupang-review-collector-ui')) {
    return;
  }

  let uiContainer = null;
  let overlay = null;
  let isUICreated = false;
  let statusDiv = null;
  let progressFill = null;
  let progressText = null;
  let logContainer = null;
  let stopButton = null;

  function createUI() {
    if (isUICreated) {
      return;
    }

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

    uiContainer.appendChild(header);
    uiContainer.appendChild(statusDiv);
    uiContainer.appendChild(progressContainer);
    uiContainer.appendChild(logHeader);
    uiContainer.appendChild(logContainer);
    uiContainer.appendChild(buttonContainer);
    document.body.appendChild(uiContainer);

    document.getElementById('crc-ui-close').addEventListener('click', () => {
      if (uiContainer) uiContainer.remove();
      if (overlay) overlay.remove();
      isUICreated = false;
    });

    document.getElementById('crc-ui-clear-log').addEventListener('click', () => {
      if (logContainer) {
        logContainer.innerHTML = '';
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.remove('collectionLogs');
        }
        addLog('로그가 지워졌습니다.', 'info');
      }
    });


    isUICreated = true;
    addLog('리뷰 수집 UI가 준비되었습니다.', 'info');

    loadLogsFromStorage();
  }

  function addLog(message, type = 'info') {
    if (!isUICreated) {
      createUI();
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
    logContainer.scrollTop = logContainer.scrollHeight;
    while (logContainer.children.length > 200) {
      logContainer.removeChild(logContainer.firstChild);
    }
  }

  function loadLogsFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['collectionLogs'], (result) => {
        if (result.collectionLogs && result.collectionLogs.length > 0) {
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

            logContainer.scrollTop = logContainer.scrollHeight;
          }
        }
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'COUPANG_REVIEW_COLLECTOR') {
      handleUIMessage(event.data.data);
    }
  });

  function handleUIMessage(request) {
    if (!isUICreated) {
      createUI();
    }

    if (request.action === 'progress') {
      // 알림만 표시 모드인 경우 진행률 업데이트하지 않음
      if (request.showNotificationOnly) {
        // 진행률은 표시하지 않고 로그만 추가
        if (request.log) {
          addLog(request.log, request.logType || 'info');
        }
        return;
      }

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

      // 알림만 표시 모드인 경우 진행률 표시하지 않음
      if (request.showNotificationOnly) {
        // 진행률 바 숨기기
        const progressContainer = uiContainer ? uiContainer.querySelector('div:nth-child(3)') : null;
        if (progressContainer) {
          progressContainer.style.display = 'none';
        }

        // 알림만 표시
        if (statusDiv) {
          statusDiv.textContent = `✅ 수집 완료! 총 ${reviewCount}개의 리뷰가 수집되었습니다.`;
          statusDiv.style.background = '#d4edda';
          statusDiv.style.color = '#155724';
          statusDiv.style.fontSize = '14px';
          statusDiv.style.fontWeight = '600';
          statusDiv.style.padding = '12px';
        }

        // 로그에 간단한 알림만 추가
        if (logContainer) {
          addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰`, 'success');
        } else {
          logContainer = document.getElementById('crc-ui-logs');
          if (logContainer) {
            addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰`, 'success');
          }
        }

        // UI를 자동으로 닫기 (3초 후)
        setTimeout(() => {
          if (uiContainer) uiContainer.remove();
          if (overlay) overlay.remove();
          isUICreated = false;
        }, 3000);
      } else {
        // 기존 동작 (진행률 표시 포함)
        if (statusDiv) {
          statusDiv.textContent = `✅ 수집 완료! 총 ${reviewCount}개의 리뷰가 수집되었습니다.`;
          statusDiv.style.background = '#d4edda';
          statusDiv.style.color = '#155724';
        }

        if (progressFill) progressFill.style.width = '100%';
        if (progressText) progressText.textContent = '100%';

        if (logContainer) {
          addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰가 수집되었습니다.`, 'success');
          addLog(`📊 수집된 리뷰 데이터가 저장되었습니다.`, 'info');
        } else {
          logContainer = document.getElementById('crc-ui-logs');
          if (logContainer) {
            addLog(`✅ 수집 완료: 총 ${reviewCount}개 리뷰가 수집되었습니다.`, 'success');
            addLog(`📊 수집된 리뷰 데이터가 저장되었습니다.`, 'info');
          }
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
      if (stopButton) {
        stopButton.disabled = true;
        stopButton.textContent = '중지됨';
        stopButton.style.opacity = '0.6';
        stopButton.style.cursor = 'not-allowed';
      }
    } else if (request.action === 'startScraping') {
      createUI();
      addLog('리뷰 수집을 시작합니다...', 'info');
    }
  }
})();
