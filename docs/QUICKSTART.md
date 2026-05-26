# Quick Start Guide

Get the Runtime Error Auto-Fixer running in 5 minutes.

## Prerequisites

- Node.js 20+
- npm
- (Optional) GitHub token for PR creation
- (Optional) LLM API key for analysis

## Step 1: Install & Run Server

```bash
# Clone and install
cd runtime-error-auto-fixer
npm install

# Start server (uses mock LLM by default)
npm run dev
```

Server is now running at `http://localhost:3000`

Verify:
```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Step 2: Test Error Ingestion

Send a test error:

```bash
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -d '{
    "projectKey": "demo",
    "rawStack": "TypeError: Cannot read property '\''foo'\'' of undefined\n    at Button.onClick (app.bundle.js:1:2345)\n    at HTMLButtonElement.dispatch (vendor.js:1:5678)",
    "url": "https://example.com/dashboard"
  }'
```

Response:
```json
{
  "id": 1,
  "projectId": 1,
  "dedupeKey": "abc123...",
  "errorGroupId": 1,
  "isNew": true,
  "occurrenceCount": 1
}
```

## Step 3: View Error

```bash
curl http://localhost:3000/api/v1/errors/1
```

## Step 4: Analyze Error (Mock LLM)

```bash
curl -X POST http://localhost:3000/api/v1/analyze/1
```

Response:
```json
{
  "id": 1,
  "status": "analyzed",
  "suggestionSummary": "Add null check before property access",
  "llmProvider": "mock"
}
```

## Step 5: Generate Patch

```bash
curl -X POST http://localhost:3000/api/v1/analyze/1/patch
```

## Step 6: View Analysis

```bash
curl http://localhost:3000/api/v1/analyze/1
```

---

## Full Setup (with Real LLM & GitHub)

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
# LLM (DeepInfra)
LLM_PROVIDER=deepinfra
LLM_API_KEY=your-deepinfra-key
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct

# GitHub
GITHUB_TOKEN=ghp_your-github-token
```

### Restart Server

```bash
npm run dev
```

### Create a PR

First, update project with your repo URL:

```bash
# Via SQLite
sqlite3 storage/data.sqlite "UPDATE projects SET repo_url='https://github.com/user/repo', default_branch='main' WHERE project_key='demo'"
```

Then create PR:

```bash
curl -X POST http://localhost:3000/api/v1/pr/1
```

---

## Client SDK Integration

### Option 1: Script Tag

```html
<script type="module">
  import { init, captureError } from '/path/to/client-sdk/src/index.js';
  
  init({
    endpoint: 'http://localhost:3000/api/v1/errors',
    projectKey: 'demo'
  });
</script>
```

### Option 2: Try the Demo

1. Start the server: `npm run dev`
2. Open `client-sdk/demo/index.html` in a browser
3. Click the error buttons to generate test errors
4. Check server logs to see errors being received

---

## Source Map Upload

Upload after your build:

```bash
# Single file
curl -X POST http://localhost:3000/api/v1/sourcemaps \
  -F "file=@dist/app.bundle.js.map" \
  -F "projectKey=demo" \
  -F "version=1.0.0" \
  -F "artifactName=app.bundle.js"

# Multiple files
for map in dist/*.map; do
  curl -X POST http://localhost:3000/api/v1/sourcemaps \
    -F "file=@$map" \
    -F "projectKey=demo" \
    -F "version=1.0.0" \
    -F "artifactName=$(basename ${map%.map})"
done
```

---

## Common Commands

```bash
# Check server health
curl http://localhost:3000/health

# List error groups
curl http://localhost:3000/api/v1/errors/groups/demo

# Get mapped stack trace
curl http://localhost:3000/api/v1/errors/1/mapped

# Trigger analysis
curl -X POST http://localhost:3000/api/v1/analyze/1

# Generate patch
curl -X POST http://localhost:3000/api/v1/analyze/1/patch

# Create PR
curl -X POST http://localhost:3000/api/v1/pr/1

# Get PR status
curl http://localhost:3000/api/v1/pr/1/status

# Start CI monitor
curl -X POST http://localhost:3000/api/v1/pr/monitor/start

# Stop CI monitor
curl -X POST http://localhost:3000/api/v1/pr/monitor/stop
```

---

## Troubleshooting

### "GitHub token not configured"

Set the `GITHUB_TOKEN` environment variable:
```bash
export GITHUB_TOKEN=ghp_your-token
npm run dev
```

### "Project has no repository URL"

Update the project in the database:
```bash
sqlite3 storage/data.sqlite "UPDATE projects SET repo_url='https://github.com/user/repo' WHERE project_key='your-key'"
```

### "Analysis failed"

Check the LLM configuration:
```bash
# Use mock provider for testing
export LLM_PROVIDER=mock
npm run dev
```

### Source maps not working

1. Check the artifact name matches the URL in the stack trace
2. Verify the version matches the `release` in error events
3. Check file was uploaded successfully:
   ```bash
   curl http://localhost:3000/api/v1/sourcemaps/demo
   ```

---

## Next Steps

1. Read the [API Reference](API.md) for all endpoints
2. Review [Architecture](ARCHITECTURE.md) for system design
3. Configure [Settings](CONFIGURATION.md) for production

