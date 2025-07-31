// https://cdn.jsdelivr.net/gh/samadikom/loadjs@main/load-min.js
(function() {
    const ERROR_LOG_URL = 'https://loadjs.rate-match.com/api/log/error';
    const API_LOG_URL = 'https://loadjs.rate-match.com/api/log/api';
  
    let apiLogBatch = [];
    const BATCH_SIZE = 5;
    const BATCH_INTERVAL = 5000; // 5 seconds
  
    function sendBatchLogs() {
      if (apiLogBatch.length === 0) return;
      const payload = JSON.stringify(apiLogBatch);
      console.log('Sending batch logs:', apiLogBatch);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_LOG_URL, payload);
      } else {
        fetch(API_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }).catch(e => console.warn('Fallback log send failed', e));
      }
      apiLogBatch = [];
    }
  
    // Send batch every interval
    setInterval(sendBatchLogs, BATCH_INTERVAL);
  
    function batchApiLog(log) {
      apiLogBatch.push(log);
      console.log('Added API log to batch:', log);
      if (apiLogBatch.length >= BATCH_SIZE) {
        sendBatchLogs();
      }
    }
  
    // Runtime JS Errors
    window.addEventListener('error', function(event) {
      const e = event;
      const log = {
        type: 'runtimeError',
        message: e.message || '',
        stack: e.error?.stack || 'No stack available',
        source: e.filename || '',
        lineno: e.lineno || 0,
        colno: e.colno || 0,
        url: window.location.href,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      };
      console.error('Runtime error caught:', log);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
      } else {
        fetch(ERROR_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log)
        }).catch(e => console.warn('Fallback error send failed', e));
      }
    });
  
    // Unhandled Promise Rejections
    window.addEventListener('unhandledrejection', function(event) {
      const reason = event.reason || {};
      const log = {
        type: 'unhandledRejection',
        message: reason.message || String(reason),
        stack: reason.stack || 'No stack available',
        url: window.location.href,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      };
      console.error('Unhandled rejection caught:', log);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
      } else {
        fetch(ERROR_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log)
        }).catch(e => console.warn('Fallback error send failed', e));
      }
    });
  
    // Override fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const [input, init] = args;
      const method = (init && init.method) || 'GET';
      const url = typeof input === 'string' ? input : input.url;
  
      const start = performance.now();
      try {
        const response = await originalFetch(...args);
        const duration = performance.now() - start;
  
        // Log only slow requests (> 500ms)
        if (duration > 500) {
          const log = {
            type: 'apiRequest',
            method,
            url,
            status: response.status,
            response_time_ms: parseFloat(duration.toFixed(2)),
            user_agent: navigator.userAgent,
            timestamp: new Date().toISOString()
          };
          batchApiLog(log);
        }
        return response;
      } catch (error) {
        const duration = performance.now() - start;
        const log = {
          type: 'apiError',
          method,
          url,
          error: error.message,
          response_time_ms: parseFloat(duration.toFixed(2)),
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString()
        };
        batchApiLog(log);
        throw error;
      }
    };
  
    // Override XMLHttpRequest
    (function() {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
  
      XMLHttpRequest.prototype.open = function(method, url) {
        this._logData = { method, url };
        return originalOpen.apply(this, arguments);
      };
  
      XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        const start = performance.now();
  
        xhr.addEventListener('loadend', function() {
          const duration = performance.now() - start;
  
          if (duration > 500) { // Log only slow XHR calls
            const log = {
              type: 'xhrRequest',
              method: xhr._logData.method,
              url: xhr._logData.url,
              status: xhr.status,
              response_time_ms: parseFloat(duration.toFixed(2)),
              user_agent: navigator.userAgent,
              timestamp: new Date().toISOString()
            };
            batchApiLog(log);
          }
        });
  
        return originalSend.apply(this, arguments);
      };
    })();
  
  })();
  
