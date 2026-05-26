import { applyPatch as applyUnifiedDiff } from 'diff';

export function applyPatch(originalContent, patch) {
  const result = applyUnifiedDiff(originalContent, patch);

  if (result === false) {
    throw new Error('Failed to apply unified diff patch to file content');
  }

  return result;
}

export function extractNewContentFromPatch(patch) {
  const lines = patch.split('\n');
  const content = [];

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      content.push(line.substring(1));
    }
  }

  return content.join('\n');
}
