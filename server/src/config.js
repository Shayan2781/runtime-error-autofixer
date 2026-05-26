import { loadEnvFile } from './loadEnv.js';
import { resolve } from 'path';

loadEnvFile(resolve(process.cwd(), '.env'));

export function loadConfig() {
  const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || 'file:./storage/data.sqlite',
    storageDir: process.env.STORAGE_DIR || './storage',
    projectDefaultKey: process.env.PROJECT_DEFAULT_KEY || 'dev-project',
    githubToken: process.env.GITHUB_TOKEN || '',
    gitlabToken: process.env.GITLAB_TOKEN || '',
    llmProvider: process.env.LLM_PROVIDER || 'deepinfra',
    llmApiKey: process.env.LLM_API_KEY || '',
    llmModel: process.env.LLM_MODEL || '',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    maxPrAttempts: parseInt(process.env.MAX_PR_ATTEMPTS || '3', 10),
    ciPollIntervalMs: parseInt(process.env.CI_POLL_INTERVAL_MS || '60000', 10),
    ingestionAuthEnabled: process.env.INGESTION_AUTH_ENABLED === 'true',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    serverSampleRate: parseFloat(process.env.SERVER_SAMPLE_RATE || '1.0'),
    redactUrls: process.env.REDACT_URLS !== 'false',
    redactQueryParams: process.env.REDACT_QUERY_PARAMS !== 'false',
  };

  return config;
}
