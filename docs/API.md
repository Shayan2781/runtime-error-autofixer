# API Reference

Complete API documentation for the Runtime Error Auto-Fixer.

## Base URL

```
http://localhost:3000/api/v1
```

## Authentication

Currently, the API uses project keys for identification. Include the project key in the request body or as a query parameter where required.

---

## Health Check

### `GET /health`

Check if the server is running.

**Response**
```json
{
  "status": "ok"
}
```

---

## Error Ingestion

### `POST /api/v1/errors`

Ingest a client-side runtime error.

**Request Body**
```json
{
  "projectKey": "my-project",
  "message": "Cannot read property 'foo' of undefined",
  "stack": "TypeError: Cannot read property 'foo' of undefined\n    at Button.onClick (app.bundle.js:1:2345)",
  "url": "https://example.com/dashboard",
  "userAgent": "Mozilla/5.0...",
  "release": "1.2.3",
  "environment": "production"
}
```

**Response** `201 Created`
```json
{
  "id": 1,
  "projectId": 1,
  "dedupeKey": "a1b2c3...",
  "errorGroupId": 1,
  "isNew": true,
  "occurrenceCount": 1
}
```

### `GET /api/v1/errors/:id`

Get error event details.

**Response**
```json
{
  "id": 1,
  "projectId": 1,
  "rawStack": "TypeError: Cannot read...",
  "url": "https://example.com/dashboard",
  "userAgent": "Mozilla/5.0...",
  "release": "1.2.3",
  "environment": "production",
  "dedupeKey": "a1b2c3...",
  "mapped": false,
  "errorGroupId": 1,
  "receivedAt": "2024-01-15T10:30:00Z"
}
```

### `GET /api/v1/errors/:id/mapped`

Get mapped stack trace for an error.

**Response**
```json
{
  "errorId": 1,
  "mapped": true,
  "frames": [
    {
      "original": "at Button.onClick (app.bundle.js:1:2345)",
      "mapped": {
        "source": "src/components/Button.tsx",
        "line": 42,
        "column": 15,
        "name": "handleClick"
      }
    }
  ]
}
```

### `POST /api/v1/errors/map`

Map a raw stack trace to original sources.

**Request Body**
```json
{
  "projectKey": "my-project",
  "stack": "Error: Something failed\n    at app.bundle.js:1:2345",
  "release": "1.2.3"
}
```

**Response**
```json
{
  "frames": [
    {
      "original": "at app.bundle.js:1:2345",
      "mapped": {
        "source": "src/utils/api.ts",
        "line": 15,
        "column": 8,
        "name": "fetchData"
      }
    }
  ]
}
```

---

## Error Groups

### `GET /api/v1/errors/groups/:projectKey`

List error groups for a project.

**Query Parameters**
- `status` (optional): Filter by status (`open`, `resolved`, `ignored`)
- `limit` (optional): Max results (default: 50)

**Response**
```json
{
  "projectId": 1,
  "groups": [
    {
      "id": 1,
      "dedupeKey": "a1b2c3...",
      "errorType": "TypeError",
      "errorMessage": "Cannot read property 'foo' of undefined",
      "occurrenceCount": 42,
      "status": "open",
      "firstSeenAt": "2024-01-10T08:00:00Z",
      "lastSeenAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `GET /api/v1/errors/group/:groupId`

Get error group details with recent events.

**Response**
```json
{
  "group": {
    "id": 1,
    "errorType": "TypeError",
    "errorMessage": "Cannot read property 'foo' of undefined",
    "occurrenceCount": 42,
    "status": "open"
  },
  "recentEvents": [
    {
      "id": 5,
      "url": "https://example.com/page",
      "receivedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `PATCH /api/v1/errors/group/:groupId/status`

Update error group status.

**Request Body**
```json
{
  "status": "resolved"
}
```

**Response**
```json
{
  "id": 1,
  "status": "resolved",
  "updated": true
}
```

---

## Source Maps

### `POST /api/v1/sourcemaps`

Upload a source map file.

**Request** `multipart/form-data`
- `file`: The source map file (.map)
- `projectKey`: Project identifier
- `version`: Release version
- `artifactName`: Name of the bundled file (e.g., `app.bundle.js`)
- `fileUrl` (optional): URL where the artifact is served

**Response** `201 Created`
```json
{
  "id": 1,
  "projectId": 1,
  "artifactName": "app.bundle.js",
  "version": "1.2.3",
  "localPath": "storage/sourcemaps/my-project/1.2.3/app.bundle.js.map"
}
```

### `GET /api/v1/sourcemaps/:projectKey`

List source maps for a project.

**Query Parameters**
- `version` (optional): Filter by version

**Response**
```json
{
  "projectId": 1,
  "sourceMaps": [
    {
      "id": 1,
      "artifactName": "app.bundle.js",
      "version": "1.2.3",
      "uploadedAt": "2024-01-15T09:00:00Z"
    }
  ]
}
```

---

## Analysis (LLM)

### `POST /api/v1/analyze/:errorId`

Trigger LLM analysis for an error event.

**Request Body** (optional)
```json
{
  "force": true
}
```

**Response** `201 Created`
```json
{
  "id": 1,
  "errorEventId": 1,
  "status": "analyzed",
  "llmProvider": "deepinfra",
  "llmModel": "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "suggestionSummary": "Add null check before accessing property",
  "suggestionFull": "The error occurs because...",
  "durationMs": 2340
}
```

### `GET /api/v1/analyze/:analysisId`

Get analysis details.

**Response**
```json
{
  "id": 1,
  "errorEventId": 1,
  "status": "analyzed",
  "llmProvider": "deepinfra",
  "llmModel": "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "suggestionSummary": "Add null check before accessing property",
  "suggestionFull": "The error occurs because...",
  "patchUnifiedDiff": null,
  "durationMs": 2340,
  "createdAt": "2024-01-15T10:35:00Z"
}
```

### `POST /api/v1/analyze/:analysisId/patch`

Generate a unified diff patch from the analysis.

**Request Body** (optional)
```json
{
  "repoUrl": "https://github.com/user/repo",
  "branch": "main"
}
```

**Response**
```json
{
  "analysisId": 1,
  "status": "proposed",
  "patch": "--- a/src/components/Button.tsx\n+++ b/src/components/Button.tsx\n@@ -40,3 +40,5 @@...",
  "targetFile": "src/components/Button.tsx"
}
```

### `GET /api/v1/analyze/:analysisId/patch`

Get the generated patch for an analysis.

**Response**
```json
{
  "analysisId": 1,
  "patch": "--- a/src/components/Button.tsx\n+++ b/src/components/Button.tsx\n...",
  "status": "proposed"
}
```

### `GET /api/v1/analyze/error/:errorId`

List all analyses for an error event.

**Response**
```json
{
  "errorEventId": 1,
  "analyses": [
    {
      "id": 1,
      "status": "proposed",
      "suggestionSummary": "Add null check",
      "createdAt": "2024-01-15T10:35:00Z"
    }
  ]
}
```

---

## Pull Requests

### `POST /api/v1/pr/:analysisId`

Create a Pull Request from an analysis.

**Prerequisites**
- Analysis must have a patch (`POST /api/v1/analyze/:analysisId/patch`)
- Project must have `repo_url` configured
- `GITHUB_TOKEN` environment variable must be set

**Response** `201 Created`
```json
{
  "id": 1,
  "analysisId": 1,
  "prNumber": 42,
  "prUrl": "https://github.com/user/repo/pull/42",
  "branchName": "auto-fix/error-1-1705318500000",
  "status": "opened",
  "cached": false
}
```

### `GET /api/v1/pr/:prId`

Get PR details.

**Response**
```json
{
  "id": 1,
  "analysisId": 1,
  "projectId": 1,
  "provider": "github",
  "prNumber": 42,
  "prUrl": "https://github.com/user/repo/pull/42",
  "branchName": "auto-fix/error-1-1705318500000",
  "status": "opened",
  "lastCiState": "pending",
  "attempts": 1,
  "createdAt": "2024-01-15T10:40:00Z",
  "updatedAt": "2024-01-15T10:40:00Z"
}
```

### `GET /api/v1/pr/:prId/status`

Get live PR status from GitHub (includes CI checks).

**Response**
```json
{
  "id": 1,
  "prNumber": 42,
  "prUrl": "https://github.com/user/repo/pull/42",
  "status": "open",
  "merged": false,
  "mergeable": true,
  "ciState": "success",
  "attempts": 1,
  "statusChecks": [
    { "context": "ci/test", "state": "success" }
  ],
  "checkRuns": [
    { "name": "build", "status": "completed", "conclusion": "success" }
  ]
}
```

### `GET /api/v1/pr/:prId/history`

Get iteration history for a PR.

**Response**
```json
{
  "prId": 1,
  "prNumber": 42,
  "prUrl": "https://github.com/user/repo/pull/42",
  "currentStatus": "opened",
  "lastCiState": "success",
  "attempts": 2,
  "maxAttempts": 3,
  "analysis": {
    "id": 1,
    "status": "proposed",
    "suggestionSummary": "Add null check",
    "updatedAt": "2024-01-15T11:00:00Z"
  }
}
```

### `POST /api/v1/pr/:prId/check`

Manually check PR status and trigger iteration if CI failed.

**Response**
```json
{
  "prId": 1,
  "action": "pending",
  "currentStatus": "opened",
  "attempts": 1
}
```

Possible `action` values:
- `pending` - CI still running
- `ci_success` - CI passed
- `iterated` - CI failed, new fix pushed
- `merged` - PR was merged
- `closed` - PR was closed
- `max_attempts_reached` - No more retries

### `POST /api/v1/pr/:prId/iterate`

Manually trigger iteration (re-analyze and push new commit).

**Response**
```json
{
  "prId": 1,
  "action": "iterated",
  "attempt": 2,
  "message": "Iteration triggered successfully"
}
```

### `GET /api/v1/pr/project/:projectKey`

List all PRs for a project.

**Response**
```json
{
  "projectId": 1,
  "projectKey": "my-project",
  "prs": [
    {
      "id": 1,
      "analysisId": 1,
      "prNumber": 42,
      "prUrl": "https://github.com/user/repo/pull/42",
      "status": "opened",
      "lastCiState": "pending",
      "attempts": 1,
      "createdAt": "2024-01-15T10:40:00Z"
    }
  ]
}
```

---

## CI Monitor

### `GET /api/v1/pr/monitor/status`

Get CI monitor status.

**Response**
```json
{
  "isRunning": false,
  "maxAttempts": 3,
  "pollInterval": 60000,
  "vcsConfigured": true
}
```

### `POST /api/v1/pr/monitor/start`

Start background CI monitoring.

**Response**
```json
{
  "message": "CI monitor started",
  "status": {
    "isRunning": true,
    "maxAttempts": 3,
    "pollInterval": 60000,
    "vcsConfigured": true
  }
}
```

### `POST /api/v1/pr/monitor/stop`

Stop background CI monitoring.

**Response**
```json
{
  "message": "CI monitor stopped",
  "status": {
    "isRunning": false,
    "maxAttempts": 3,
    "pollInterval": 60000,
    "vcsConfigured": true
  }
}
```

---

## Error Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid token) |
| 404 | Not Found |
| 500 | Internal Server Error |

## Common Error Response

```json
{
  "error": "Error description",
  "message": "Detailed error message",
  "hint": "Helpful suggestion (optional)"
}
```

