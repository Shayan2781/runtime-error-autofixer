# Configuration Guide

Complete guide to configuring the Runtime Error Auto-Fixer.

## Environment Variables

Create a `.env` file in the project root (copy from `.env.example`).

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment (`development`, `production`) |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Pino log level |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./storage/data.sqlite` | SQLite database path |
| `STORAGE_DIR` | `./storage` | Directory for file storage |

### Project

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_DEFAULT_KEY` | `dev-project` | Default project key for development |

### VCS Integration (GitHub)

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | *(empty)* | GitHub Personal Access Token |

**Required scopes for GitHub token:**
- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows (if using Actions)

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `deepinfra` | LLM provider (`gapgpt`, `deepinfra`, `togetherai`, `mock`) |
| `LLM_API_KEY` | *(empty)* | API key for the LLM provider |
| `LLM_MODEL` | *(provider default)* | Model to use |
| `LLM_BASE_URL` | *(provider default)* | Optional API base URL override |

**Default models by provider:**
- `gapgpt`: `gemini-2.5-flash-lite` (base URL: `https://api.gapgpt.app/v1`)
- `deepinfra`: `meta-llama/Meta-Llama-3.1-8B-Instruct`
- `togetherai`: `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo`
- `mock`: N/A (returns placeholder response)

### CI Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PR_ATTEMPTS` | `3` | Maximum iteration attempts per PR |
| `CI_POLL_INTERVAL_MS` | `60000` | CI status poll interval (ms) |

## Example Configuration

### Development

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=file:./storage/data.sqlite
STORAGE_DIR=./storage
PROJECT_DEFAULT_KEY=my-dev-project
LOG_LEVEL=debug

# LLM (mock for testing)
LLM_PROVIDER=mock

# GitHub (optional for local testing)
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Production

```env
PORT=8080
NODE_ENV=production
DATABASE_URL=file:./storage/data.sqlite
STORAGE_DIR=./storage
PROJECT_DEFAULT_KEY=my-production-project
LOG_LEVEL=info

# LLM
LLM_PROVIDER=deepinfra
LLM_API_KEY=your-deepinfra-api-key
LLM_MODEL=meta-llama/Meta-Llama-3.1-70B-Instruct

# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# CI Monitor
MAX_PR_ATTEMPTS=3
CI_POLL_INTERVAL_MS=60000
```

## LLM Provider Setup

### DeepInfra

1. Sign up at [deepinfra.com](https://deepinfra.com)
2. Generate API key from dashboard
3. Set environment variables:

```env
LLM_PROVIDER=deepinfra
LLM_API_KEY=your-api-key
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct
```

**Available models:**
- `meta-llama/Meta-Llama-3.1-8B-Instruct` (fast, cheap)
- `meta-llama/Meta-Llama-3.1-70B-Instruct` (better quality)
- `codellama/CodeLlama-34b-Instruct-hf` (code-focused)

### Together.ai

1. Sign up at [together.ai](https://together.ai)
2. Generate API key from settings
3. Set environment variables:

```env
LLM_PROVIDER=togetherai
LLM_API_KEY=your-api-key
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
```

### GapGPT

OpenAI-compatible API at [api.gapgpt.app](https://api.gapgpt.app).

```env
LLM_PROVIDER=gapgpt
LLM_API_KEY=your-gapgpt-api-key
LLM_MODEL=gemini-2.5-flash-lite
# LLM_BASE_URL=https://api.gapgpt.app/v1   # optional, this is the default
```

### Mock Provider (Testing)

For development without LLM costs:

```env
LLM_PROVIDER=mock
```

Returns a placeholder response with generic fix suggestions.

## GitHub Token Setup

### Creating a Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (required)
   - `workflow` (optional, for Actions)
4. Copy the token

### Token Permissions

| Scope | Required | Purpose |
|-------|----------|---------|
| `repo` | Yes | Create branches, commits, PRs |
| `workflow` | No | Update GitHub Actions workflows |
| `read:org` | No | Access organization repos |

### Fine-Grained Tokens

For better security, use fine-grained tokens:

1. Go to GitHub → Settings → Developer settings → Fine-grained tokens
2. Select repositories to grant access
3. Set permissions:
   - Contents: Read and Write
   - Pull requests: Read and Write
   - Metadata: Read-only

## Client SDK Configuration

### Initialization Options

```javascript
ErrorCapture.init({
  // Required
  endpoint: 'http://localhost:3000/api/v1/errors',
  projectKey: 'my-project',
  
  // Optional
  release: '1.2.3',           // App version
  environment: 'production',   // Environment name
  sampleRate: 1.0,            // Error sampling (0.0 - 1.0)
  maxBreadcrumbs: 50,         // Max breadcrumb history
  
  // Callbacks
  beforeSend: (error) => {    // Filter/modify errors
    if (error.message.includes('ignored')) {
      return null; // Don't send
    }
    return error;
  }
});
```

### Script Tag Installation

```html
<script src="https://your-cdn.com/error-capture.min.js"></script>
<script>
  ErrorCapture.init({
    endpoint: 'https://your-server.com/api/v1/errors',
    projectKey: 'my-project'
  });
</script>
```

### NPM Installation

```bash
npm install @your-org/error-capture
```

```javascript
import { ErrorCapture } from '@your-org/error-capture';

ErrorCapture.init({
  endpoint: 'https://your-server.com/api/v1/errors',
  projectKey: 'my-project'
});
```

## Project Configuration

Projects are auto-created on first error. To configure repository settings:

### Via API

```bash
# Update project (you'll need to add this endpoint)
curl -X PATCH http://localhost:3000/api/v1/projects/my-project \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo",
    "defaultBranch": "main",
    "repoProvider": "github"
  }'
```

### Via Database

```sql
UPDATE projects 
SET 
  repo_url = 'https://github.com/user/repo',
  default_branch = 'main',
  repo_provider = 'github'
WHERE project_key = 'my-project';
```

## Source Map Upload

### During Build

```bash
# Upload source maps after build
for map in dist/*.map; do
  curl -X POST http://localhost:3000/api/v1/sourcemaps \
    -F "file=@$map" \
    -F "projectKey=my-project" \
    -F "version=$(git describe --tags)" \
    -F "artifactName=$(basename ${map%.map})"
done
```

### CI/CD Integration

**GitHub Actions:**

```yaml
- name: Upload Source Maps
  run: |
    for map in dist/*.map; do
      curl -X POST ${{ secrets.ERROR_FIXER_URL }}/api/v1/sourcemaps \
        -F "file=@$map" \
        -F "projectKey=${{ github.repository }}" \
        -F "version=${{ github.sha }}" \
        -F "artifactName=$(basename ${map%.map})"
    done
```

## Logging

### Log Levels

| Level | Description |
|-------|-------------|
| `trace` | Very detailed debugging |
| `debug` | Debugging information |
| `info` | General information |
| `warn` | Warnings |
| `error` | Errors |
| `fatal` | Fatal errors |

### Pretty Logs (Development)

In development, logs are pretty-printed with colors via `pino-pretty`.

### JSON Logs (Production)

In production, logs are output as JSON for log aggregation:

```json
{"level":30,"time":1705318500000,"msg":"Server started","port":3000}
```

### External Log Aggregation

Pipe logs to your preferred service:

```bash
npm run dev | npx pino-elasticsearch
npm run dev | npx pino-datadog
```

## Health Checks

### Liveness Probe

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Docker Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/health || exit 1
```

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
```

