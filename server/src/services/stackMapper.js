import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { readFileSync } from 'fs';
import { basename } from 'path';

export function parseStackTrace(rawStack) {
  const frames = [];
  const lines = rawStack.split('\n');

  for (const line of lines) {
    const frame = parseStackFrame(line);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

// Supports Chrome/Node ("at fn (file:line:col)"), Firefox/Safari
// ("fn@file:line:col"), and the no-function-name variants.
function parseStackFrame(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('Error:') || trimmed.startsWith('at ') === false && !trimmed.includes('@')) {
    if (!trimmed.startsWith('at ') && !trimmed.includes('@')) {
      return null;
    }
  }

  const chromeMatch = trimmed.match(/^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (chromeMatch) {
    return {
      functionName: chromeMatch[1] || '<anonymous>',
      fileName: chromeMatch[2],
      lineNumber: parseInt(chromeMatch[3], 10),
      columnNumber: parseInt(chromeMatch[4], 10),
      raw: trimmed,
    };
  }

  const firefoxMatch = trimmed.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
  if (firefoxMatch) {
    return {
      functionName: firefoxMatch[1] || '<anonymous>',
      fileName: firefoxMatch[2],
      lineNumber: parseInt(firefoxMatch[3], 10),
      columnNumber: parseInt(firefoxMatch[4], 10),
      raw: trimmed,
    };
  }

  const simpleMatch = trimmed.match(/^at\s+(.+?):(\d+):(\d+)$/);
  if (simpleMatch) {
    return {
      functionName: '<anonymous>',
      fileName: simpleMatch[1],
      lineNumber: parseInt(simpleMatch[2], 10),
      columnNumber: parseInt(simpleMatch[3], 10),
      raw: trimmed,
    };
  }

  return null;
}

export function extractArtifactName(fileNameOrUrl) {
  try {
    const url = new URL(fileNameOrUrl);
    return basename(url.pathname);
  } catch {
    return basename(fileNameOrUrl);
  }
}

export function loadSourceMap(sourceMapPath) {
  const content = readFileSync(sourceMapPath, 'utf-8');
  const sourceMapData = JSON.parse(content);
  return new TraceMap(sourceMapData);
}

export function mapFrame(frame, traceMap) {
  const original = originalPositionFor(traceMap, {
    line: frame.lineNumber,
    column: frame.columnNumber,
  });

  if (original.source) {
    return {
      ...frame,
      originalFileName: original.source,
      originalLineNumber: original.line,
      originalColumnNumber: original.column,
      originalFunctionName: original.name || frame.functionName,
      mapped: true,
    };
  }

  return {
    ...frame,
    mapped: false,
  };
}

export class StackMapper {
  constructor(sourceMapDAO, logger) {
    this.sourceMapDAO = sourceMapDAO;
    this.logger = logger;
    this.cache = new Map();
  }

  async loadSourceMapForArtifact(projectId, artifactName, version = null) {
    const cacheKey = `${projectId}:${artifactName}:${version || 'latest'}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Source maps are conventionally named "{artifact}.map", so we normalize
    // here in case the caller passed the JS artifact name.
    const mapArtifactName = artifactName.endsWith('.map')
      ? artifactName
      : `${artifactName}.map`;

    let sourceMapRecord;
    if (version) {
      sourceMapRecord = this.sourceMapDAO.getByProjectVersionAndArtifact(
        projectId,
        version,
        mapArtifactName
      );
    }

    if (!sourceMapRecord) {
      sourceMapRecord = this.sourceMapDAO.getByProjectAndArtifact(
        projectId,
        mapArtifactName
      );
    }

    if (!sourceMapRecord) {
      this.logger.debug(
        { projectId, artifactName, version },
        'No source map found for artifact'
      );
      return null;
    }

    try {
      const traceMap = loadSourceMap(sourceMapRecord.local_path);
      this.cache.set(cacheKey, traceMap);
      return traceMap;
    } catch (error) {
      this.logger.error(
        { error: error.message, path: sourceMapRecord.local_path },
        'Failed to load source map'
      );
      return null;
    }
  }

  async mapStackTrace(rawStack, projectId, version = null) {
    const frames = parseStackTrace(rawStack);
    const mappedFrames = [];
    let mappedCount = 0;

    for (const frame of frames) {
      const artifactName = extractArtifactName(frame.fileName);
      const traceMap = await this.loadSourceMapForArtifact(
        projectId,
        artifactName,
        version
      );

      if (traceMap) {
        const mappedFrame = mapFrame(frame, traceMap);
        mappedFrames.push(mappedFrame);
        if (mappedFrame.mapped) {
          mappedCount++;
        }
      } else {
        mappedFrames.push({
          ...frame,
          mapped: false,
        });
      }
    }

    return {
      originalStack: rawStack,
      frames: mappedFrames,
      totalFrames: frames.length,
      mappedFrames: mappedCount,
      fullyMapped: mappedCount === frames.length && frames.length > 0,
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

export function formatMappedStack(frames) {
  return frames
    .map((frame) => {
      if (frame.mapped) {
        const fn = frame.originalFunctionName || '<anonymous>';
        return `    at ${fn} (${frame.originalFileName}:${frame.originalLineNumber}:${frame.originalColumnNumber})`;
      }
      return `    at ${frame.functionName} (${frame.fileName}:${frame.lineNumber}:${frame.columnNumber}) [unmapped]`;
    })
    .join('\n');
}

