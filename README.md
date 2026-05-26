# runtime-error-autofixer

A small system that catches runtime errors thrown by a web app in the user's
browser, walks the minified stack back to the original source files using the
project's source maps, asks a language model to read the broken code and
suggest a fix, then opens a Pull Request with that fix and watches the CI
checks. If the checks fail, it feeds the failure back to the model and tries
again, up to a configurable attempt limit.

This is a bachelor-thesis project. It is intentionally small (one server
process, one SQLite file, one browser SDK) so the whole pipeline fits in your
head. The goal was never to compete with a commercial error tracker; it was to
take the chain of steps a developer normally does by hand - read the stack,
open the file, understand the bug, write a patch, push a branch, open a PR -
and wire them together end to end so the loop can run without a human in the
middle for the easy cases.

The codebase is plain Node.js with ESM, no TypeScript, no framework on top of
Express, and no client-side bundler for the SDK itself (it ships as a single
ES module you can import directly). The browser demo under `examples/live-demo`
is bundled with esbuild only because it needs source maps to demonstrate the
mapping step.

## Prerequisites

- Node.js 20 or newer (ESM, native `--watch`)
- npm
- A GitHub repository you control (for the PR creation step)
- A fine-grained GitHub Personal Access Token with `contents:write` and
  `pull_requests:write` on that repo
- An API key for one of the supported LLM providers (or use the `mock`
  provider, which returns a canned response and is fine for local testing)

## Install

```bash
git clone https://github.com/<username>/runtime-error-autofixer.git
cd runtime-error-autofixer
npm install
```

## Configure

Copy the example env file and fill in the parts you need:

```bash
cp .env.example .env
```

The fields that matter on a first run:

- `GITHUB_TOKEN` - leave empty if you only want to see error ingestion and
  analysis; required to open PRs.
- `LLM_PROVIDER` - `mock` works without an API key. The real providers are
  `gapgpt`, `deepinfra`, and `together` / `togetherai`.
- `LLM_API_KEY` - the key for whichever provider you picked.
- `LLM_MODEL` - provider-specific model name.
- `PROJECT_DEFAULT_KEY` - the project key the SDK will send by default.

All other fields have sane defaults documented inline in `.env.example` and in
`docs/CONFIGURATION.md`.

## Run the server

```bash
npm run dev
```

The dev script uses Node's built-in `--watch` so edits restart the process.
The server listens on `PORT` (default `3000`) and creates `storage/data.sqlite`
on first boot. Health check:

```bash
curl http://localhost:3000/health
```

For production, `npm start` runs the same entry point without watch.

## Integrate the client SDK

The SDK is a single ES module under `client-sdk/src/index.js`. Drop it into a
page or import it from your app's entry point:

```html
<script type="module">
  import { init } from '/client-sdk/src/index.js';
  init({
    endpoint: 'http://localhost:3000',
    projectKey: 'my-project',
    release: '1.0.0',
  });
</script>
```

After `init` returns, uncaught errors and unhandled promise rejections are
forwarded to the server, deduplicated by stack signature, and grouped. You can
also report things manually with `captureError(err)` or `captureMessage(text)`.
The full SDK API and option list lives in `client-sdk/README.md`.

## Upload source maps

The server can only map a minified stack if it has the matching `.map` file
for that release. Upload your build artifacts after each deploy:

```bash
curl -X POST http://localhost:3000/api/v1/sourcemaps \
  -F "file=@dist/app.bundle.js.map" \
  -F "projectKey=my-project" \
  -F "version=1.0.0" \
  -F "artifactName=app.bundle.js"
```

`artifactName` has to match the filename that appears in the stack traces
your SDK is sending. `version` has to match the `release` value passed to
`init()`. Mismatches are the single most common reason mapping silently
fails, so worth double-checking.

## Try the live demo

There is a small frontend under `examples/live-demo` that intentionally
contains bugs and is wired to push real PRs to a GitHub repository you set up
for it. The walkthrough is in `docs/LIVE-DEMO-WALKTHROUGH.md`. The short
version:

```bash
npm run demo:live          # bundles examples/live-demo and prints next steps
npm run dev                # terminal 1, the backend
npm run serve:live-demo    # terminal 2, the static file server
```

Then open `http://localhost:8080/examples/live-demo/` and click the buttons
that throw errors. The dashboard inside the demo polls the server for the
analysis and PR status.

## Docker

A `Dockerfile` and `docker-compose.yml` are included. The compose file maps
the `./storage` directory as a volume so the SQLite database survives container
restarts.

```bash
docker compose up --build -d
```

You still need a populated `.env` file in the project root; compose passes it
through to the container.

## API surface

The HTTP routes are versioned under `/api/v1`. The full reference is in
`docs/API.md`. Grouped by concern:

- Errors: `POST /errors`, `GET /errors/:id`, `GET /errors/:id/mapped`,
  `GET /errors/groups/:projectKey`, `PATCH /errors/group/:groupId/status`
- Source maps: `POST /sourcemaps`, `GET /sourcemaps/:projectKey`
- Analysis: `POST /analyze/:errorId`, `GET /analyze/:analysisId`,
  `POST /analyze/:analysisId/patch`
- Pull requests: `POST /pr/:analysisId`, `GET /pr/:prId/status`
- CI monitor: `GET /pr/monitor/status`, `POST /pr/monitor/start`,
  `POST /pr/monitor/stop`

A typical end-to-end run with curl, assuming an error has already been
ingested as `id=1`:

```bash
curl -X POST http://localhost:3000/api/v1/analyze/1
curl -X POST http://localhost:3000/api/v1/analyze/1/patch
curl -X POST http://localhost:3000/api/v1/pr/1
curl http://localhost:3000/api/v1/pr/1/status
curl -X POST http://localhost:3000/api/v1/pr/monitor/start
```

## How it works

The SDK normalizes the browser error into a JSON payload and posts it to
`/api/v1/errors`. The server hashes the stack to deduplicate, groups
recurring instances, and stores the raw event. When `/api/v1/analyze/:id` is
called, the server looks up the project's source maps, maps each frame back
to its original file and line, reads a window of surrounding source, and
sends that context to the configured LLM with a fix-this-bug prompt. The
LLM response is parsed into a structured suggestion, turned into a unified
diff, applied to a temporary clone of the repository, committed on a fresh
branch, and pushed. A PR is opened against the default branch. From that
point the CI monitor polls the PR's check runs; if they go red, the failure
output is added to the context and the loop runs again until either the
checks pass or `MAX_PR_ATTEMPTS` is reached.

## Project structure

```
client-sdk/             browser SDK (single ES module + a small demo page)
server/                 Express backend, all source under server/src
  src/db/                 SQLite DAO layer (better-sqlite3)
  src/routes/             HTTP route handlers
  src/services/           normalization, mapping, LLM client, VCS, CI monitor
  src/middleware/         auth and rate limiting
examples/
  live-demo/              buggy frontend used in the thesis demo
  sdk-demo/               minimal SDK smoke test
scripts/                build and setup helpers
docs/                   architecture, API, configuration, integration, quickstart
storage/                runtime state (SQLite file, uploaded source maps)
.github/workflows/      CI for this repo
```

## Documentation

- `docs/INTEGRATION.md` - the LLM, GitHub, and GitLab setup, start here
- `docs/QUICKSTART.md` - a 5-minute local walkthrough
- `docs/API.md` - every endpoint with request and response shapes
- `docs/ARCHITECTURE.md` - the data flow and component diagram
- `docs/CONFIGURATION.md` - every environment variable
- `docs/LIVE-DEMO-WALKTHROUGH.md` - the script for the live demo

## Development

```bash
npm run lint           # eslint
npm run format         # prettier --write
npm run format:check   # prettier --check
```

## License

MIT. See `LICENSE`.
