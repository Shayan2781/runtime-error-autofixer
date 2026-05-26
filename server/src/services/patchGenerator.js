import { createTwoFilesPatch } from 'diff';
import { simpleGit } from 'simple-git';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { selectBestFrame } from './sourceContext.js';
import { normalizeRepoPath } from './repoPath.js';

/**
 * Extract code blocks from markdown suggestion
 * Returns array of { language, code, filename? }
 */
export function extractCodeBlocks(suggestion) {
  const codeBlockRegex = /```(?:([\w.]+))?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;

  while ((match = codeBlockRegex.exec(suggestion)) !== null) {
    const language = match[1] || 'javascript';
    const code = match[2].trim();

    // Try to extract filename from comment at start of code
    const filenameMatch = code.match(/^\/\/\s*(?:file:?\s*)?([^\n]+\.(?:js|ts|jsx|tsx|mjs|cjs))/i);

    blocks.push({
      language,
      code,
      filename: filenameMatch ? filenameMatch[1].trim() : null,
    });
  }

  return blocks;
}

/**
 * Normalize a file path for use in the GitHub/GitLab repo (strip ../, a/ prefixes)
 */
export { normalizeRepoPath, extractTargetFileFromPatch } from './repoPath.js';

/**
 * Try to identify the target file from the suggestion and error context
 */
export function identifyTargetFile(suggestion, errorContext) {
  const bestFrame = selectBestFrame(errorContext?.frames);
  if (bestFrame) {
    return normalizeRepoPath(bestFrame.originalFileName || bestFrame.fileName);
  }

  const filePatterns = [
    /(?:in|at|file|modify|update|fix)\s+[`'"]?([^\s`'"]+\.(?:js|ts|jsx|tsx))[`'"]?/gi,
  ];

  for (const pattern of filePatterns) {
    const matches = [...suggestion.matchAll(pattern)];
    if (matches.length > 0) {
      return normalizeRepoPath(matches[0][1]);
    }
  }

  return null;
}

/**
 * Apply a code fix suggestion to determine the patch
 * This is a simplified version that works with explicit code blocks
 */
export function generatePatchFromCodeBlock(originalCode, fixedCode, filename) {
  return createTwoFilesPatch(`a/${filename}`, `b/${filename}`, originalCode, fixedCode);
}

/**
 * Parse a unified diff to extract changes
 */
export function parsePatch(patchText) {
  const lines = patchText.split('\n');
  const hunks = [];
  let currentHunk = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -start,count +start,count @@
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newLines: parseInt(match[4] || '1', 10),
          lines: [],
        };
        hunks.push(currentHunk);
      }
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line);
    }
  }

  return { hunks };
}

/**
 * PatchGenerator class
 */
export class PatchGenerator {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.tempDir = join(config.storageDir, 'temp');
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Clone a repository to a temporary directory
   */
  async cloneRepo(repoUrl, branch = 'main') {
    this.ensureTempDir();

    const repoId = randomUUID();
    const repoPath = join(this.tempDir, repoId);

    this.logger.info({ repoUrl, branch, repoPath }, 'Cloning repository');

    try {
      const git = simpleGit();
      await git.clone(repoUrl, repoPath, ['--depth', '1', '--branch', branch]);

      return {
        path: repoPath,
        cleanup: () => {
          try {
            rmSync(repoPath, { recursive: true, force: true });
          } catch (err) {
            this.logger.warn({ error: err.message }, 'Failed to cleanup temp repo');
          }
        },
      };
    } catch (error) {
      this.logger.error({ error: error.message, repoUrl }, 'Failed to clone repository');
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * Read a file from a cloned repository
   */
  readRepoFile(repoPath, filePath) {
    const fullPath = join(repoPath, filePath);
    if (!existsSync(fullPath)) {
      return null;
    }
    return readFileSync(fullPath, 'utf-8');
  }

  /**
   * Generate a patch from an LLM suggestion
   */
  async generatePatch(suggestion, errorContext, repoInfo = null) {
    // Extract code blocks from suggestion
    const codeBlocks = extractCodeBlocks(suggestion);

    if (codeBlocks.length === 0) {
      this.logger.warn('No code blocks found in suggestion');
      return {
        success: false,
        error: 'No code blocks found in suggestion',
      };
    }

    // Find the suggested fix (usually labeled as the fix)
    const fixBlock = codeBlocks.find(
      (b) => b.language === 'javascript' || b.language === 'js' || b.language === 'typescript'
    );

    if (!fixBlock) {
      return {
        success: false,
        error: 'No JavaScript/TypeScript code block found',
      };
    }

    // Identify target file
    const targetFile = identifyTargetFile(suggestion, errorContext);

    if (!targetFile) {
      this.logger.warn('Could not identify target file for patch');
      return {
        success: false,
        error: 'Could not identify target file',
        suggestedCode: fixBlock.code,
      };
    }

    // If we have repo info, try to fetch the original file
    let originalCode = null;
    let cleanup = null;

    if (repoInfo?.repoUrl) {
      try {
        const repo = await this.cloneRepo(repoInfo.repoUrl, repoInfo.branch || 'main');
        cleanup = repo.cleanup;

        originalCode = this.readRepoFile(repo.path, targetFile);

        if (!originalCode) {
          this.logger.warn({ targetFile }, 'Target file not found in repository');
        }
      } catch (error) {
        this.logger.warn({ error: error.message }, 'Failed to fetch original file from repo');
      } finally {
        if (cleanup) cleanup();
      }
    }

    if (!originalCode && errorContext?.sourceFiles?.[targetFile]) {
      originalCode = errorContext.sourceFiles[targetFile];
      this.logger.info({ targetFile }, 'Using original file from uploaded source map');
    }

    // If we don't have original code, create a placeholder patch
    if (!originalCode) {
      // Create a "suggested change" format without the original
      const suggestedPatch = `--- a/${targetFile}
+++ b/${targetFile}
@@ -1,1 +1,${fixBlock.code.split('\n').length} @@
-// Original code not available - manual review required
${fixBlock.code
  .split('\n')
  .map((line) => '+' + line)
  .join('\n')}
`;

      return {
        success: true,
        patch: suggestedPatch,
        targetFile,
        suggestedCode: fixBlock.code,
      };
    }

    const patch = generatePatchFromCodeBlock(originalCode, fixBlock.code, targetFile);

    return {
      success: true,
      patch,
      targetFile,
      suggestedCode: fixBlock.code,
      fixedContent: fixBlock.code,
    };
  }

  /**
   * Apply a patch to a file and return the result
   */
  applyPatch(originalCode, patch) {
    // This is a simplified implementation
    // In production, use a proper patch application library
    const parsed = parsePatch(patch);
    let result = originalCode;

    // Apply hunks in reverse order to maintain line numbers
    for (const hunk of parsed.hunks.reverse()) {
      const lines = result.split('\n');
      const newLines = [];

      // Add lines before the hunk
      for (let i = 0; i < hunk.oldStart - 1; i++) {
        newLines.push(lines[i]);
      }

      // Apply hunk changes
      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          newLines.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          newLines.push(line.substring(1));
        }
        // Skip lines starting with '-' (removed)
      }

      // Add remaining lines
      for (let i = hunk.oldStart - 1 + hunk.oldLines; i < lines.length; i++) {
        newLines.push(lines[i]);
      }

      result = newLines.join('\n');
    }

    return result;
  }
}

