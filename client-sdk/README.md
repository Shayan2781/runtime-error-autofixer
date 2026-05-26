# Error Fixer Client SDK

Browser SDK to capture runtime errors, run the auto-fix pipeline, and read error history from the Error Fixer server.

## Quick start

```html
<script type="module">
  import { init, createClient, runAutoFix } from './client-sdk/src/index.js';

  const client = createClient({
    endpoint: 'http://localhost:3000',
    projectKey: 'live-demo',
  });

  init({
    endpoint: 'http://localhost:3000',
    projectKey: 'live-demo',
    release: '1.0.0',
    onErrorSent: ({ id }) => runAutoFix(client, id, {
      onStep: ({ step, detail }) => console.log(step, detail),
    }),
  });
</script>
```

See the full live demo at `examples/live-demo/`.

## Installation

Include the SDK in your HTML page:

```html
<script type="module">
  import { init } from './path/to/client-sdk/src/index.js';

  init({
    endpoint: 'https://your-server.com',
    projectKey: 'your-project-key',
    release: '1.0.0',
    environment: 'production'
  });
</script>
```

Or use the global `ErrorFixer` object:

```html
<script type="module" src="./path/to/client-sdk/src/index.js"></script>
<script>
  ErrorFixer.init({
    endpoint: 'https://your-server.com',
    projectKey: 'your-project-key'
  });
</script>
```

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `endpoint` | string | Yes | - | Server URL (e.g., `https://api.example.com`) |
| `projectKey` | string | Yes | - | Your project API key |
| `release` | string | No | `''` | Release/version identifier |
| `environment` | string | No | `'production'` | Environment name |
| `sampleRate` | number | No | `1.0` | Sample rate (0.0-1.0) |
| `debug` | boolean | No | `false` | Enable debug logging |
| `beforeSend` | function | No | `null` | Callback to modify/filter errors |
| `onErrorSent` | function | No | `null` | Called after error is stored on the server |
| `maxBreadcrumbs` | number | No | `20` | Max breadcrumbs to keep |

## Error capture API

### `init(options)`

Initialize the SDK. Must be called before any other methods.

### `captureError(error, context)`

Manually capture an error:

```javascript
try {
  riskyOperation();
} catch (err) {
  ErrorFixer.captureError(err, { userId: '123' });
}
```

### `captureMessage(message, context)`

Capture a message as an error:

```javascript
ErrorFixer.captureMessage('Something unexpected happened', { level: 'warning' });
```

### `addBreadcrumb(breadcrumb)`

Add context breadcrumbs:

```javascript
ErrorFixer.addBreadcrumb({
  category: 'navigation',
  message: 'User navigated to /dashboard'
});
```

### `setUser(user)`

Set user context:

```javascript
ErrorFixer.setUser({
  id: '123',
  email: 'user@example.com',
  name: 'John Doe'
});
```

## Auto-fix API

### `createClient({ endpoint, projectKey })`

Create an API client for the backend pipeline and dashboard:

```javascript
const client = createClient({
  endpoint: 'http://localhost:3000',
  projectKey: 'live-demo',
});
```

### `client.uploadSourceMap({ file, version, artifactName, bundleName })`

Upload a source map file for stack trace mapping.

### `client.analyzeError(errorId)`

Run LLM analysis for a captured error. Returns cached result if the error group was already fixed.

### `client.generatePatch(analysisId)`

Generate a unified diff patch from an analysis.

### `client.createPullRequest(analysisId)`

Create a GitHub pull request from an analysis patch.

### `client.getErrorGroups()`

Fetch deduplicated error groups and occurrence stats for the project.

### `runAutoFix(client, errorId, { onStep })`

Run the full pipeline: analyze → patch → PR. Skips LLM/patch when a fix already exists for the error group.

```javascript
const result = await runAutoFix(client, errorId, {
  onStep: ({ step, detail }) => {
    // step: 'analyze' | 'patch' | 'pr' | 'done'
    console.log(step, detail);
  },
});

console.log(result.prData.prUrl);
```

## Demo

- Live demo: `examples/live-demo/` (auto-fix on crash)
- Dashboard: `examples/live-demo/dashboard/` (error history via `client.getErrorGroups()`)
- Basic capture demo: `client-sdk/demo/`

## Automatic Captures

The SDK automatically captures:
- `window.onerror` events (runtime errors)
- `unhandledrejection` events (unhandled Promise rejections)
- Click events as breadcrumbs
- `console.error` calls as breadcrumbs
