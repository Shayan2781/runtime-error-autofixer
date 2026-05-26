import { createLLMProvider, MockLLMProvider } from './llm/providers.js';
import { formatMappedStack } from './stackMapper.js';
import { normalizeRepoPath } from './repoPath.js';

function resolveTargetFileContent(targetFrame, sourceFiles = {}) {
  if (!targetFrame || !sourceFiles || Object.keys(sourceFiles).length === 0) {
    return null;
  }

  const targetPath = normalizeRepoPath(targetFrame.originalFileName || targetFrame.fileName);
  if (sourceFiles[targetPath]) {
    return { path: targetPath, content: sourceFiles[targetPath] };
  }

  const match = Object.entries(sourceFiles).find(
    ([filePath]) => normalizeRepoPath(filePath) === targetPath
  );
  if (!match) {
    return null;
  }

  return { path: normalizeRepoPath(match[0]), content: match[1] };
}

function resolveFunctionNameFromSource(sourceCode, lineNumber) {
  if (!sourceCode || !lineNumber) {
    return null;
  }

  const lines = sourceCode.split('\n');
  let index = Math.max(0, lineNumber - 1);

  while (index >= 0) {
    const match = lines[index].match(/function\s+([A-Za-z_$][\w$]*)/);
    if (match) {
      return match[1];
    }
    index--;
  }

  return null;
}

const SYSTEM_PROMPT = `You are an expert JavaScript developer and debugging assistant. Your task is to analyze runtime errors from web applications and suggest fixes.

Important rules:
- Stack traces may show minified function names (for example "o"). Use the mapped source file and "Current Target File" to find the real function name. Never invent or import minified names.
- Fix ONLY the primary fix target file and ONLY the function that causes the error.
- In "## Suggested Fix", provide ONE JavaScript code block containing the COMPLETE corrected source file.
- Every \`export function\` in the file must appear exactly once. Never duplicate functions.
- Preserve all unrelated functions byte-for-byte except for the one function you are fixing.
- Preserve existing function names, exports, and imports. Do not rename functions.
- Do not move functions between files.
- Do not add placeholder comments like "// ... other code" or "// ... rest unchanged".
- Do not invent imports, helper functions, or new exports.
- Do not re-output snippets from other files unless they belong to the target file.

When analyzing errors, you should:
1. Identify the root cause of the error
2. Explain why the error occurred
3. Provide a specific code fix
4. Suggest best practices to prevent similar errors

Format your response as follows:
## Root Cause
[Explain what caused the error]

## Suggested Fix
\`\`\`javascript
[Provide the complete corrected source file for the target file only]
\`\`\`

## Explanation
[Explain the fix and why it works]

## Prevention Tips
[List best practices to prevent similar errors]

Be concise but thorough. Focus on practical, actionable fixes.`;

function buildUserPrompt(errorContext) {
  const {
    errorType,
    errorMessage,
    rawStack,
    mappedStack,
    frames,
    url,
    sourceSnippets,
    targetFrame,
    sourceFiles,
  } = errorContext;

  const targetFile = resolveTargetFileContent(targetFrame, sourceFiles);
  const resolvedFunctionName = targetFile
    ? resolveFunctionNameFromSource(
        targetFile.content,
        targetFrame?.originalLineNumber || targetFrame?.lineNumber
      )
    : null;

  let prompt = `# Error Analysis Request

## Error Details
- **Type**: ${errorType || 'Unknown'}
- **Message**: ${errorMessage || 'No message'}
- **URL**: ${url || 'Unknown'}

## Stack Trace (Original/Minified)
\`\`\`
${rawStack}
\`\`\`
`;

  if (mappedStack) {
    prompt += `
## Mapped Stack Trace (Source)
\`\`\`
${mappedStack}
\`\`\`
`;
  }

  if (frames && frames.length > 0) {
    prompt += `
## Stack Frames
`;
    frames.slice(0, 5).forEach((frame, i) => {
      if (frame.mapped) {
        prompt += `${i + 1}. \`${frame.originalFunctionName || '<anonymous>'}\` in \`${frame.originalFileName}\` at line ${frame.originalLineNumber}\n`;
      } else {
        prompt += `${i + 1}. \`${frame.functionName || '<anonymous>'}\` in \`${frame.fileName}\` at line ${frame.lineNumber}\n`;
      }
    });
  }

  if (targetFrame) {
    prompt += `
## Primary Fix Target
- **File**: \`${targetFrame.originalFileName || targetFrame.fileName}\`
- **Function to fix**: \`${resolvedFunctionName || targetFrame.originalFunctionName || targetFrame.functionName || '<anonymous>'}\`
- **Line**: ${targetFrame.originalLineNumber || targetFrame.lineNumber}
`;
  }

  if (targetFile) {
    prompt += `
## Current Target File
This is the full current contents of the file you must rewrite. Copy every unchanged function exactly as shown. Modify only the function that causes the error.

### ${targetFile.path}
\`\`\`javascript
${targetFile.content}
\`\`\`
`;
  } else if (sourceSnippets && sourceSnippets.length > 0) {
    prompt += `
## Source Code Context
`;
    sourceSnippets.forEach((snippet) => {
      prompt += `
### ${snippet.fileName} (lines ${snippet.startLine}-${snippet.endLine})
\`\`\`javascript
${snippet.code}
\`\`\`
`;
    });
  }

  prompt += `
Please analyze this error and return the COMPLETE corrected version of the primary fix target file.
Change only the failing function. Do not duplicate any function. Do not omit any existing export.`;

  return prompt;
}

export class AnalysisService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.provider = null;
  }

  initialize() {
    if (!this.config.llmApiKey) {
      this.logger.warn('No LLM_API_KEY configured, using mock provider');
      this.provider = new MockLLMProvider();
      return;
    }

    try {
      this.provider = createLLMProvider({
        provider: this.config.llmProvider,
        apiKey: this.config.llmApiKey,
        model: this.config.llmModel,
        options: {
          timeout: 30000,
          maxTokens: 2048,
          temperature: 0.3,
          baseUrl: this.config.llmBaseUrl || undefined,
        },
      });
      this.logger.info(
        { provider: this.config.llmProvider, model: this.config.llmModel },
        'LLM provider initialized'
      );
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to initialize LLM provider');
      this.provider = new MockLLMProvider();
    }
  }

  async analyze(errorContext, mappingResult = null) {
    if (!this.provider) {
      this.initialize();
    }

    const startTime = Date.now();

    try {
      const context = {
        errorType: errorContext.errorType,
        errorMessage: errorContext.errorMessage,
        rawStack: errorContext.rawStack,
        url: errorContext.url,
        userAgent: errorContext.userAgent,
      };

      if (mappingResult) {
        context.mappedStack = formatMappedStack(mappingResult.frames);
        context.frames = mappingResult.frames;
      }

      if (errorContext.sourceSnippets) {
        context.sourceSnippets = errorContext.sourceSnippets;
      }

      if (errorContext.sourceFiles) {
        context.sourceFiles = errorContext.sourceFiles;
      }

      if (errorContext.targetFrame) {
        context.targetFrame = errorContext.targetFrame;
      }

      const userPrompt = buildUserPrompt(context);

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      this.logger.debug({ promptLength: userPrompt.length }, 'Sending analysis request to LLM');

      const suggestion = await this.provider.chat(messages);

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          duration,
          suggestionLength: suggestion.length,
          model: this.config.llmModel || 'mock',
        },
        'LLM analysis completed'
      );

      return {
        success: true,
        suggestion,
        model: this.config.llmModel || 'mock',
        duration,
        promptTokens: userPrompt.length, // rough proxy, not a real token count
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(
        { error: error.message, duration },
        'LLM analysis failed'
      );

      return {
        success: false,
        error: error.message,
        model: this.config.llmModel || 'mock',
        duration,
      };
    }
  }

  extractCodeBlocks(suggestion) {
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\n([\s\S]*?)```/g;
    const blocks = [];
    let match;

    while ((match = codeBlockRegex.exec(suggestion)) !== null) {
      blocks.push(match[1].trim());
    }

    return blocks;
  }

  extractSummary(suggestion) {
    const rootCauseMatch = suggestion.match(/## Root Cause\n([\s\S]*?)(?=\n##|$)/);
    if (rootCauseMatch) {
      return rootCauseMatch[1].trim().substring(0, 200);
    }

    const firstParagraph = suggestion.split('\n\n')[0];
    return firstParagraph.substring(0, 200);
  }
}

