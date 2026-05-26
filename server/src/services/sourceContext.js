import { readFileSync } from 'fs';
import { normalizeRepoPath } from './repoPath.js';
import { extractArtifactName } from './stackMapper.js';

export function selectBestFrame(frames = []) {
  if (!frames.length) {
    return null;
  }

  const mapped = frames.filter((frame) => frame.mapped && frame.originalFileName);
  const userFrames = mapped.filter((frame) => {
    const file = normalizeRepoPath(frame.originalFileName);
    return /(^|\/)src\//.test(file) || file.startsWith('src/');
  });

  if (userFrames.length > 0) {
    return userFrames[0];
  }

  if (mapped.length > 0) {
    return mapped[0];
  }

  return frames[0];
}

export function extractSourceSnippets(mappingResult, sourceMapPath, contextLines = 8) {
  if (!mappingResult?.frames?.length || !sourceMapPath) {
    return [];
  }

  let sourceMap;
  try {
    sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf-8'));
  } catch {
    return [];
  }

  const snippets = [];
  const seen = new Set();

  for (const frame of mappingResult.frames) {
    if (!frame.mapped || !frame.originalFileName) {
      continue;
    }

    const fileName = normalizeRepoPath(frame.originalFileName);
    if (seen.has(fileName)) {
      continue;
    }

    const sourceIndex = sourceMap.sources?.indexOf(frame.originalFileName);
    const sourceContent = sourceIndex >= 0 ? sourceMap.sourcesContent?.[sourceIndex] : null;
    if (!sourceContent) {
      continue;
    }

    seen.add(fileName);
    const lines = sourceContent.split('\n');
    const line = frame.originalLineNumber || 1;
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(lines.length, line + contextLines);

    snippets.push({
      fileName,
      startLine,
      endLine,
      errorLine: line,
      functionName: frame.originalFunctionName || frame.functionName,
      code: lines.slice(startLine - 1, endLine).join('\n'),
    });
  }

  return snippets;
}

export function extractSourceFiles(sourceMapPath) {
  if (!sourceMapPath) {
    return {};
  }

  try {
    const sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf-8'));
    const files = {};

    sourceMap.sources?.forEach((source, index) => {
      const content = sourceMap.sourcesContent?.[index];
      if (content) {
        files[normalizeRepoPath(source)] = content;
      }
    });

    return files;
  } catch {
    return {};
  }
}

export async function buildAnalysisContext(stackMapper, sourceMapDAO, rawStack, projectId, version = null) {
  const mappingResult = await stackMapper.mapStackTrace(rawStack, projectId, version);
  const snippets = [];
  let sourceFiles = {};

  if (mappingResult.frames.length > 0) {
    const artifactName = extractArtifactName(mappingResult.frames[0].fileName);
    const mapArtifactName = artifactName.endsWith('.map') ? artifactName : `${artifactName}.map`;

    let sourceMapRecord = null;
    if (version) {
      sourceMapRecord = sourceMapDAO.getByProjectVersionAndArtifact(
        projectId,
        version,
        mapArtifactName
      );
    }
    if (!sourceMapRecord) {
      sourceMapRecord = sourceMapDAO.getByProjectAndArtifact(projectId, mapArtifactName);
    }

    if (sourceMapRecord?.local_path) {
      snippets.push(...extractSourceSnippets(mappingResult, sourceMapRecord.local_path));
      sourceFiles = extractSourceFiles(sourceMapRecord.local_path);
    }
  }

  return {
    mappingResult,
    snippets,
    sourceFiles,
    targetFrame: selectBestFrame(mappingResult.frames),
  };
}
