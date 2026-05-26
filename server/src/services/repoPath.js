export function normalizeRepoPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return filePath;
  }

  let path = filePath
    .replace(/^---\s+[ab]\//, '')
    .replace(/^[ab]\//, '')
    .split('\t')[0]
    .replace(/\s+(original|fixed)$/i, '')
    .trim();
  const resolved = [];

  for (const part of path.split('/')) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }

  return resolved.join('/');
}

export function extractTargetFileFromPatch(patchText) {
  if (!patchText || typeof patchText !== 'string') {
    return null;
  }

  const lines = patchText.split('\n');

  for (const prefix of ['+++ b/', '--- a/']) {
    const line = lines.find((entry) => entry.startsWith(prefix));
    if (line) {
      return normalizeRepoPath(line.slice(prefix.length));
    }
  }

  const minusLine = lines.find(
    (entry) => entry.startsWith('--- ') && !entry.startsWith('--- /dev/null')
  );
  if (minusLine) {
    return normalizeRepoPath(minusLine.replace(/^---\s+(?:a\/)?/, ''));
  }

  return null;
}
