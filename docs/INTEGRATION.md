# Integration Guide - LLM & GitHub/GitLab

This guide walks you through connecting the Runtime Error Auto-Fixer to real external services.

## Prerequisites Checklist

| What you need | Used for | Required? |
|---------------|----------|-----------|
| Node.js 20+ | Running the server | Yes |
| `.env` file (copy from `.env.example`) | Configuration | Yes |
| LLM API key (DeepInfra or Together.ai) | Error analysis & patch suggestions | For real analysis |
| GitHub PAT **or** GitLab token | Creating PR/MR | For auto-fix PRs |
| A Git repository with CI | Testing the full loop | For end-to-end demo |
| Source map files from your build | Mapping minified stacks | Recommended |

---

## Part 1 - Local Setup (No External APIs)

Good for development and thesis demos without API costs.

```bash
npm install
cp .env.example .env
npm run dev
```

With no `LLM_API_KEY`, the server automatically uses the **mock LLM**.

Verify:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -d '{"projectKey":"demo","rawStack":"TypeError: test error"}'
curl -X POST http://localhost:3000/api/v1/analyze/1
```

---

## Part 2 - LLM Integration (DeepInfra or Together.ai)

### Step 1: Get an API key

**DeepInfra (recommended for cost/speed)**

1. Sign up at [deepinfra.com](https://deepinfra.com)
2. Go to Dashboard → API Keys → Create key
3. Copy the key

**Together.ai (alternative)**

1. Sign up at [together.ai](https://together.ai)
2. Settings → API Keys → Create key

### Step 2: Configure `.env`

```env
LLM_PROVIDER=deepinfra
LLM_API_KEY=your-api-key-here
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct
```

For Together.ai:

```env
LLM_PROVIDER=together
LLM_API_KEY=your-together-key
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
```

### Step 3: Restart and test

```bash
npm run dev
```

```bash
# Post a realistic error
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -d '{
    "projectKey": "demo",
    "rawStack": "TypeError: Cannot read properties of undefined (reading '\''length'\'')\n    at processData (app.js:42:10)",
    "url": "https://myapp.com/dashboard"
  }'

# Trigger analysis (uses real LLM now)
curl -X POST http://localhost:3000/api/v1/analyze/1

# Generate patch
curl -X POST http://localhost:3000/api/v1/analyze/1/patch
```

### What to expect

- Analysis returns `status: "analyzed"` with a structured suggestion
- Patch endpoint returns a unified diff (may flag `requiresManualReview: true` if original source isn't available locally)
- Typical cost: fractions of a cent per analysis with 8B models

### Troubleshooting LLM

| Problem | Fix |
|---------|-----|
| Still getting mock responses | Ensure `LLM_API_KEY` is set and server restarted |
| `401 Unauthorized` | Invalid API key |
| Timeout | Try a smaller model or check network |
| Poor suggestions | Use mapped stack (`GET /errors/:id/mapped`) before analyzing |

---

## Part 3 - GitHub Integration (Pull Requests)

### Step 1: Create a GitHub Personal Access Token

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained **or** classic
2. Required scopes:
   - `repo` (full repository access)
   - `workflow` (if your repo uses GitHub Actions)
3. Copy token (`ghp_...`)

### Step 2: Configure `.env`

```env
GITHUB_TOKEN=ghp_your_token_here
```

### Step 3: Create a test repository

Create a repo on GitHub (can be private). Add a simple file the auto-fixer can patch, e.g. `src/utils.js`:

```javascript
export function getLength(arr) {
  return arr.length; // bug: no null check
}
```

Push to `main` and enable GitHub Actions (the included `.github/workflows/ci.yml` template can be copied into your test repo).

### Step 4: Link the project to your repo

```bash
sqlite3 storage/data.sqlite \
  "UPDATE projects SET repo_url='https://github.com/YOUR_USER/YOUR_REPO', repo_provider='github', default_branch='main' WHERE project_key='demo';"
```

If the project doesn't exist yet, send one error first (creates project automatically), then run the UPDATE.

### Step 5: Run the full pipeline

```bash
# 1. Ingest error
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -d '{"projectKey":"demo","rawStack":"TypeError: Cannot read properties of undefined (reading '\''length'\'')\n    at getLength (src/utils.js:2:14)"}'

# 2. Analyze
curl -X POST http://localhost:3000/api/v1/analyze/1

# 3. Generate patch
curl -X POST http://localhost:3000/api/v1/analyze/1/patch

# 4. Create PR
curl -X POST http://localhost:3000/api/v1/pr/1

# 5. Check PR status + CI
curl http://localhost:3000/api/v1/pr/1/status

# 6. Start CI monitor (polls every 60s, retries on failure)
curl -X POST http://localhost:3000/api/v1/pr/monitor/start
```

### What to expect

- A new branch `auto-fix/error-1-<timestamp>` is created
- A PR opens on GitHub with the patch and analysis description
- CI runs on the PR; monitor tracks success/failure
- On CI failure (up to `MAX_PR_ATTEMPTS`), the system re-prompts the LLM and pushes an updated commit

---

## Part 4 - GitLab Integration (Merge Requests)

### Step 1: Create a GitLab Personal Access Token

1. GitLab → Preferences → Access Tokens
2. Scopes: `api`, `read_repository`, `write_repository`
3. Copy token (`glpat-...`)

### Step 2: Configure `.env`

```env
GITLAB_TOKEN=glpat_your_token_here
# For self-hosted GitLab:
# GITLAB_API_URL=https://gitlab.yourcompany.com/api/v4
```

### Step 3: Link project to GitLab repo

```bash
sqlite3 storage/data.sqlite \
  "UPDATE projects SET repo_url='https://gitlab.com/YOUR_GROUP/YOUR_PROJECT', repo_provider='gitlab', default_branch='main' WHERE project_key='demo';"
```

### Step 4: Create MR (same API as GitHub PR)

```bash
curl -X POST http://localhost:3000/api/v1/pr/1
```

The system detects GitLab from the URL and creates a Merge Request instead of a PR.

---

## Part 5 - Client SDK in Your Web App

```html
<script type="module">
  import { init } from 'http://localhost:8080/client-sdk/src/index.js';

  init({
    endpoint: 'http://localhost:3000',
    projectKey: 'demo',
    release: '1.0.0',
    environment: 'development',
    sampleRate: 1.0,
  });
</script>
```

Serve your app over HTTP (not `file://`). Try the included demo:

```bash
npx serve . -p 8080
# Open http://localhost:8080/client-sdk/demo/index.html
```

When `INGESTION_AUTH_ENABLED=true`, the SDK automatically sends `X-Project-Key`.

---

## Part 6 - Source Maps

Upload after each build. The `artifactName` must match the minified bundle name in stack traces:

```bash
curl -X POST http://localhost:3000/api/v1/sourcemaps \
  -F "file=@dist/app.bundle.js.map" \
  -F "projectKey=demo" \
  -F "version=1.0.0" \
  -F "artifactName=app.bundle.js"
```

Verify mapping:

```bash
curl http://localhost:3000/api/v1/errors/1/mapped
```

---

## Part 7 - Docker Deployment

```bash
cp .env.example .env
# Edit .env with your tokens

docker compose up --build -d
```

Verify:

```bash
curl http://localhost:3000/health
docker compose logs -f error-fixer
```

Data persists in the Docker volume `error-fixer-data`.

Stop:

```bash
docker compose down
```

---

## Part 8 - Production Hardening

Enable in `.env` for production:

```env
NODE_ENV=production
INGESTION_AUTH_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=60
SERVER_SAMPLE_RATE=1.0
REDACT_URLS=true
REDACT_QUERY_PARAMS=true
LOG_LEVEL=info
```

When auth is enabled, pre-register projects:

```bash
sqlite3 storage/data.sqlite \
  "INSERT INTO projects (name, project_key, repo_provider, repo_url, default_branch) \
   VALUES ('My App', 'my-secret-project-key', 'github', 'https://github.com/user/repo', 'main');"
```

Only send errors with matching `projectKey` and `X-Project-Key` header.

---

## Quick Reference - Full Workflow

```
Browser error → POST /errors → GET /errors/:id/mapped
  → POST /analyze/:id → POST /analyze/:id/patch
  → POST /pr/:analysisId → GET /pr/:id/status
  → POST /pr/monitor/start
```

See also: [API Reference](API.md) | [Configuration](CONFIGURATION.md) | [Quick Start](QUICKSTART.md)
