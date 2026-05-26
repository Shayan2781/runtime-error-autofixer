export function redactUrl(url, options = {}) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  const { redactQuery = true, redactHash = true } = options;

  try {
    const parsed = new URL(url);
    if (redactQuery && parsed.search) {
      parsed.search = '?[redacted]';
    }
    if (redactHash && parsed.hash) {
      parsed.hash = '#[redacted]';
    }
    return parsed.toString();
  } catch {
    // URL constructor failed (relative or malformed) - fall back to a
    // regex strip so we still don't leak query strings.
    if (redactQuery) {
      return url.replace(/\?[^#]*/, '?[redacted]');
    }
    return url;
  }
}

export function redactStack(rawStack) {
  if (!rawStack || typeof rawStack !== 'string') {
    return rawStack;
  }

  return rawStack
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
    .replace(/ghp_[A-Za-z0-9]{20,}/g, 'ghp_[redacted]')
    .replace(/glpat-[A-Za-z0-9\-_]{20,}/g, 'glpat-[redacted]')
    .replace(/api[_-]?key[=:]\s*['"]?[^\s'"]+/gi, 'api_key=[redacted]');
}

export function redactErrorPayload(body, config) {
  const result = { ...body };

  if (config.redactUrls && result.url) {
    result.url = redactUrl(result.url, { redactQuery: config.redactQueryParams });
  }

  if (result.rawStack) {
    result.rawStack = redactStack(result.rawStack);
  }

  return result;
}

export function shouldSample(sampleRate) {
  if (sampleRate >= 1) {
    return true;
  }
  if (sampleRate <= 0) {
    return false;
  }
  return Math.random() <= sampleRate;
}
