const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LLMProvider {
  constructor(apiKey, model, options = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
    this.maxTokens = options.maxTokens || 2048;
    this.temperature = options.temperature || 0.3;
  }

  async chat(_messages) {
    throw new Error('chat() must be implemented by subclass');
  }

  async withRetry(fn) {
    let lastError;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // 401/403 are auth failures - retrying just burns the rate limit.
        if (error.status === 401 || error.status === 403) {
          throw error;
        }

        const delay = RETRY_DELAY * Math.pow(2, attempt);
        await sleep(delay);
      }
    }

    throw lastError;
  }
}

export class OpenAICompatibleProvider extends LLMProvider {
  constructor(apiKey, model, options = {}) {
    super(apiKey, model, options);
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.providerName = options.providerName || 'OpenAI-compatible';
  }

  async chat(messages) {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(`${this.providerName} API error: ${response.status}`);
          error.status = response.status;
          error.body = await response.text();
          throw error;
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}

export class GapGPTProvider extends OpenAICompatibleProvider {
  constructor(apiKey, model, options = {}) {
    super(apiKey, model, {
      ...options,
      baseUrl: options.baseUrl || 'https://api.gapgpt.app/v1',
      providerName: 'GapGPT',
    });
  }
}

export class DeepInfraProvider extends LLMProvider {
  constructor(apiKey, model, options = {}) {
    super(apiKey, model, options);
    this.baseUrl = 'https://api.deepinfra.com/v1/openai';
  }

  async chat(messages) {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(`DeepInfra API error: ${response.status}`);
          error.status = response.status;
          error.body = await response.text();
          throw error;
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}

export class TogetherProvider extends LLMProvider {
  constructor(apiKey, model, options = {}) {
    super(apiKey, model, options);
    this.baseUrl = 'https://api.together.xyz/v1';
  }

  async chat(messages) {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(`Together API error: ${response.status}`);
          error.status = response.status;
          error.body = await response.text();
          throw error;
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }
}

export function createLLMProvider(config) {
  const { provider, apiKey, model, options = {} } = config;

  if (!apiKey && provider?.toLowerCase() !== 'mock') {
    throw new Error('LLM_API_KEY is required');
  }

  const resolvedModel = model || getDefaultModel(provider);

  if (!resolvedModel && provider?.toLowerCase() !== 'mock') {
    throw new Error('LLM_MODEL is required');
  }

  switch (provider?.toLowerCase()) {
    case 'deepinfra':
      return new DeepInfraProvider(apiKey, resolvedModel, options);
    case 'together':
    case 'togetherai':
      return new TogetherProvider(apiKey, resolvedModel, options);
    case 'gapgpt':
      return new GapGPTProvider(apiKey, resolvedModel, options);
    case 'openai':
      return new OpenAICompatibleProvider(apiKey, resolvedModel, {
        ...options,
        baseUrl: options.baseUrl || 'https://api.openai.com/v1',
        providerName: 'OpenAI',
      });
    case 'mock':
      return new MockLLMProvider();
    default:
      throw new Error(
        `Unknown LLM provider: ${provider}. Supported: deepinfra, together, gapgpt, openai, mock`
      );
  }
}

function getDefaultModel(provider) {
  switch (provider?.toLowerCase()) {
    case 'gapgpt':
      return 'gapgpt-qwen-3.6';
    case 'deepinfra':
      return 'meta-llama/Meta-Llama-3.1-8B-Instruct';
    case 'together':
    case 'togetherai':
      return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
    default:
      return '';
  }
}

export class MockLLMProvider extends LLMProvider {
  constructor() {
    super('mock-key', 'mock-model');
  }

  async chat(_messages) {
    return `## Analysis

Based on the error stack trace, this appears to be a common JavaScript error.

## Suggested Fix

\`\`\`javascript
// Add null check before accessing properties
if (obj && obj.property) {
  // Safe to access obj.property
}
\`\`\`

## Explanation

The error occurs because the code attempts to access a property on an undefined or null value. 
Adding a null check prevents this error.

## Additional Recommendations

1. Consider using optional chaining (\`?.\`) for safer property access
2. Add input validation at function boundaries
3. Use TypeScript for better type safety
`;
  }
}

