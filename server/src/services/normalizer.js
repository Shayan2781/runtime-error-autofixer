import { createHash } from 'crypto';
import { parseStackTrace, extractArtifactName } from './stackMapper.js';

export function extractErrorInfo(rawStack) {
  const lines = rawStack.split('\n');
  const firstLine = lines[0]?.trim() || '';

  // Strip the browser-added "Uncaught" / "Uncaught (in promise)" prefix
  // so the first capture group can match just the error class.
  const cleaned = firstLine.replace(/^Uncaught\s+(\(in promise\)\s+)?/i, '');

  const match = cleaned.match(/^(\w+Error|\w+Exception|Error):\s*(.*)$/);

  if (match) {
    return {
      errorType: match[1],
      errorMessage: match[2] || '',
    };
  }

  return {
    errorType: 'Error',
    errorMessage: cleaned,
  };
}

function normalizeFrame(frame) {
  const artifact = extractArtifactName(frame.fileName);

  // Column is intentionally excluded - it shifts with minifier settings even
  // when the underlying source location is the same.
  const fn = frame.functionName || '<anonymous>';

  return `${fn}@${artifact}:${frame.lineNumber}`;
}

export function computeDedupeKey(rawStack, options = {}) {
  const { frameCount = 5 } = options;

  const { errorType, errorMessage } = extractErrorInfo(rawStack);

  const normalizedMessage = normalizeMessage(errorMessage);

  const frames = parseStackTrace(rawStack);
  const topFrames = frames.slice(0, frameCount);
  const normalizedFrames = topFrames.map(normalizeFrame);

  const signature = [
    `type:${errorType}`,
    `msg:${normalizedMessage}`,
    `frames:${normalizedFrames.join('|')}`,
  ].join('\n');

  return createHash('sha256').update(signature).digest('hex').substring(0, 32);
}

function normalizeMessage(message) {
  return (
    message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\b\d{5,}\b/g, '<ID>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g, '<TIMESTAMP>')
      .replace(/https?:\/\/[^\s]+\?[^\s]*/g, '<URL>')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<EMAIL>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function generateFingerprint(rawStack) {
  const { errorType, errorMessage } = extractErrorInfo(rawStack);
  const frames = parseStackTrace(rawStack);
  const topFrame = frames[0];

  const parts = [errorType];

  if (errorMessage) {
    const shortMessage =
      errorMessage.length > 50 ? errorMessage.substring(0, 47) + '...' : errorMessage;
    parts.push(shortMessage);
  }

  if (topFrame) {
    const artifact = extractArtifactName(topFrame.fileName);
    parts.push(`at ${topFrame.functionName || '<anonymous>'} (${artifact}:${topFrame.lineNumber})`);
  }

  return parts.join(' | ');
}

export class ErrorNormalizer {
  constructor(options = {}) {
    this.frameCount = options.frameCount || 5;
  }

  normalize(rawStack) {
    const { errorType, errorMessage } = extractErrorInfo(rawStack);
    const dedupeKey = computeDedupeKey(rawStack, { frameCount: this.frameCount });
    const fingerprint = generateFingerprint(rawStack);
    const frames = parseStackTrace(rawStack);

    return {
      errorType,
      errorMessage,
      dedupeKey,
      fingerprint,
      frameCount: frames.length,
      topFrame: frames[0] || null,
    };
  }
}

