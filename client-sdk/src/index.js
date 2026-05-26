export { createClient, ErrorFixerClient } from './client.js';
export { runAutoFix } from './autofix.js';

import { createClient } from './client.js';
import { runAutoFix } from './autofix.js';

let config = {
  endpoint: '',
  projectKey: '',
  release: '',
  environment: 'production',
  maxBreadcrumbs: 20,
  sampleRate: 1.0, // 1.0 = 100% of errors captured
  debug: false,
  beforeSend: null, // Optional callback to modify/filter errors
};

let initialized = false;
const breadcrumbs = [];

function debugLog(...args) {
  if (config.debug) {
    console.log('[ErrorFixer]', ...args);
  }
}

export function addBreadcrumb(breadcrumb) {
  if (!initialized) return;

  const crumb = {
    timestamp: new Date().toISOString(),
    ...breadcrumb,
  };

  breadcrumbs.push(crumb);

  while (breadcrumbs.length > config.maxBreadcrumbs) {
    breadcrumbs.shift();
  }

  debugLog('Breadcrumb added:', crumb);
}

function extractStack(error) {
  if (error && error.stack) {
    return error.stack;
  }

  if (error && error.message) {
    return `Error: ${error.message}`;
  }

  return String(error);
}

function buildPayload(error, context = {}) {
  return {
    projectKey: config.projectKey,
    rawStack: extractStack(error),
    userAgent: navigator.userAgent,
    url: window.location.href,
    release: config.release || null,
    environment: config.environment,
    timestamp: new Date().toISOString(),
    breadcrumbs: [...breadcrumbs],
    context: {
      ...context,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    },
  };
}

async function sendError(payload) {
  if (Math.random() > config.sampleRate) {
    debugLog('Error skipped due to sample rate');
    return;
  }

  if (typeof config.beforeSend === 'function') {
    const result = config.beforeSend(payload);
    if (result === null || result === false) {
      debugLog('Error filtered by beforeSend');
      return;
    }
    if (typeof result === 'object') {
      payload = result;
    }
  }

  debugLog('Sending error:', payload);

  const url = `${config.endpoint}/api/v1/errors`;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Project-Key': config.projectKey,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: true, // Allow request to complete even if page is closing
    });

    if (response.ok) {
      const data = await response.json();
      debugLog('Error sent successfully, id:', data.id);
      if (typeof config.onErrorSent === 'function') {
        config.onErrorSent(data);
      }
      return data;
    } else {
      debugLog('Error sending failed:', response.status);
    }
  } catch (err) {
    debugLog('Fetch failed, trying sendBeacon:', err.message);

    // Fallback to sendBeacon for page unload scenarios
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      });
      const sent = navigator.sendBeacon(url, blob);
      debugLog('sendBeacon result:', sent);
    }
  }
}

function handleError(message, source, lineno, colno, error) {
  debugLog('Caught error event:', { message, source, lineno, colno });

  const payload = buildPayload(error || new Error(message), {
    type: 'error',
    source,
    lineno,
    colno,
  });

  sendError(payload);

  // Returning false lets the browser's default handler still run.
  return false;
}

function handleUnhandledRejection(event) {
  debugLog('Caught unhandled rejection:', event.reason);

  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

  const payload = buildPayload(error, {
    type: 'unhandledrejection',
  });

  sendError(payload);
}

/**
 * Initialize the SDK
 * @param {Object} options Configuration options
 * @param {string} options.endpoint - Server endpoint URL (required)
 * @param {string} options.projectKey - Project API key (required)
 * @param {string} options.release - Release version (optional)
 * @param {string} options.environment - Environment name (optional, default: 'production')
 * @param {number} options.sampleRate - Sample rate 0.0-1.0 (optional, default: 1.0)
 * @param {boolean} options.debug - Enable debug logging (optional, default: false)
 * @param {Function} options.beforeSend - Callback to modify/filter errors (optional)
 */
export function init(options = {}) {
  if (initialized) {
    console.warn('[ErrorFixer] SDK already initialized');
    return;
  }

  if (!options.endpoint) {
    throw new Error('[ErrorFixer] endpoint is required');
  }

  if (!options.projectKey) {
    throw new Error('[ErrorFixer] projectKey is required');
  }

  config = {
    ...config,
    ...options,
  };

  config.endpoint = config.endpoint.replace(/\/$/, '');

  window.onerror = handleError;
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  // Resource load failures (script, link, img) only fire in the capture phase.
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (!target || target === window) {
        return;
      }

      const tagName = target.tagName?.toLowerCase();
      if (!['script', 'link', 'img'].includes(tagName)) {
        return;
      }

      const src = target.src || target.href || 'unknown';
      const message = `ResourceLoadError: Failed to load ${tagName} resource: ${src}`;
      const error = new Error(message);
      error.name = 'ResourceLoadError';

      const payload = buildPayload(error, {
        type: 'resource',
        tagName,
        resourceUrl: src,
      });

      sendError(payload);
    },
    true
  );

  window.addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName) {
      addBreadcrumb({
        category: 'ui.click',
        message: `Clicked ${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}${target.className ? '.' + target.className.split(' ').join('.') : ''}`,
      });
    }
  });

  const originalConsoleError = console.error;
  console.error = (...args) => {
    addBreadcrumb({
      category: 'console',
      level: 'error',
      message: args.map((a) => String(a)).join(' '),
    });
    originalConsoleError.apply(console, args);
  };

  initialized = true;
  debugLog('SDK initialized with config:', {
    endpoint: config.endpoint,
    projectKey: config.projectKey,
    release: config.release,
    environment: config.environment,
    sampleRate: config.sampleRate,
  });
}

/**
 * Manually capture an error
 * @param {Error} error - Error object to capture
 * @param {Object} context - Additional context
 */
export function captureError(error, context = {}) {
  if (!initialized) {
    console.warn('[ErrorFixer] SDK not initialized, call init() first');
    return;
  }

  const payload = buildPayload(error, {
    type: 'manual',
    ...context,
  });

  return sendError(payload);
}

/**
 * Manually capture a message as an error
 * @param {string} message - Error message
 * @param {Object} context - Additional context
 */
export function captureMessage(message, context = {}) {
  if (!initialized) {
    console.warn('[ErrorFixer] SDK not initialized, call init() first');
    return;
  }

  const error = new Error(message);
  error.name = 'CapturedMessage';

  const payload = buildPayload(error, {
    type: 'message',
    ...context,
  });

  return sendError(payload);
}

export function setUser(user) {
  if (!initialized) {
    console.warn('[ErrorFixer] SDK not initialized, call init() first');
    return;
  }

  addBreadcrumb({
    category: 'user',
    message: 'User context set',
    data: user,
  });
}

if (typeof window !== 'undefined') {
  window.ErrorFixer = {
    init,
    captureError,
    captureMessage,
    addBreadcrumb,
    setUser,
    createClient,
    runAutoFix,
  };
}

export default {
  init,
  captureError,
  captureMessage,
  addBreadcrumb,
  setUser,
  createClient,
  runAutoFix,
};
