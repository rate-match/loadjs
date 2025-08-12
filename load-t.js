(function () {
  const ERROR_LOG_URL = 'https://loadjs.rate-match.com/api/log/error';
  const API_LOG_URL = 'https://loadjs.rate-match.com/api/log/api';

  let apiLogBatch = [];
  const BATCH_SIZE = 5;
  const BATCH_INTERVAL = 5000;

  function getOrCreateUserId() {
    let uid = localStorage.getItem('waf_token');
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem('waf_token', uid);
    }
    return uid;
  }

  function sendBatchLogs() {
    if (apiLogBatch.length === 0) return;
    const payload = JSON.stringify(apiLogBatch);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_LOG_URL, payload);
    } else {
      fetch(API_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(e => console.warn('Fallback api failed', e));
    }
    apiLogBatch = [];
  }

  setInterval(sendBatchLogs, BATCH_INTERVAL);

  function batchApiLog(log) {
    apiLogBatch.push(log);
    if (apiLogBatch.length >= BATCH_SIZE) {
      sendBatchLogs();
    }
  }

  // ✅ 1. Add window.onerror for extra Safari coverage
  window.onerror = function (message, url, lineNumber, columnNumber, error) {
    const log = {
      type: 'runtimeError',
      message: message || '',
      stack: error && error.stack ? error.stack : `${url}:${lineNumber}:${columnNumber}`,
      source: url || '',
      lineno: lineNumber || 0,
      colno: columnNumber || 0,
      url: window.location.href,
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      token: getOrCreateUserId()
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
    } else {
      fetch(ERROR_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log)
      }).catch(e => console.warn('Fallback error failed', e));
    }
  };

  // ✅ 2. Capture standard JS errors
  window.addEventListener('error', function (event) {
    if (event.target && event.target !== window) {
      // Resource load error (img/script/css)
      const log = {
        type: 'resourceError',
        message: `Failed to load ${event.target.tagName}`,
        source: event.target.src || event.target.href || '',
        url: window.location.href,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        token: getOrCreateUserId()
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
      } else {
        fetch(ERROR_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log)
        }).catch(e => console.warn('Fallback resource error failed', e));
      }
    } else {
      // Already covered by window.onerror
    }
  }, true);

  // ✅ 3. Capture unhandled Promise rejections
  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason || {};
    const log = {
      type: 'unhandledRejection',
      message: reason.message || String(reason),
      stack: reason.stack || 'No stack available',
      url: window.location.href,
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      token: getOrCreateUserId()
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
    } else {
      fetch(ERROR_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log)
      }).catch(e => console.warn('Fallback error failed', e));
    }
  });

  // ✅ 4. Patch all console methods, not just console.error
  ['error', 'warn', 'log'].forEach(method => {
    const original = console[method];
    console[method] = function (...args) {
      original.apply(console, args);

      const stringify = (value) => {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.message + '\n' + value.stack;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      const message = args.map(stringify).join(' | ');
      const log = {
        type: `console.${method}`,
        message,
        url: window.location.href,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        token: getOrCreateUserId()
      };

      if (navigator.sendBeacon) {
        navigator.sendBeacon(ERROR_LOG_URL, JSON.stringify(log));
      } else {
        fetch(ERROR_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log)
        }).catch(console.warn);
      }
    };
  });

  // ✅ 5. Fetch override
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [input, init] = args;
    const method = (init && init.method) || 'GET';
    const url = typeof input === 'string' ? input : input.url;

    const start = performance.now();
    try {
      const response = await originalFetch(...args);
      const duration = performance.now() - start;

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

  // ✅ 6. XHR override
  (function () {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._logData = { method, url };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const xhr = this;
      const start = performance.now();

      xhr.addEventListener('loadend', function () {
        const duration = performance.now() - start;

        if (duration > 500) {
          const log = {
            type: 'xhrRequest',
            method: xhr._logData.method,
            url: xhr._logData.url,
            status: xhr.status,
            response_time_ms: parseFloat(duration.toFixed(2)),
            user_agent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            token: getOrCreateUserId()
          };
          batchApiLog(log);
        }
      });

      return originalSend.apply(this, arguments);
    };
  })();

})();
