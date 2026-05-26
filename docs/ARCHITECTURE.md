# System Architecture

Overview of the Runtime Error Auto-Fixer architecture.

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT APPLICATION                             │
│  ┌──────────────┐                                                        │
│  │ Client SDK   │ ─── Captures window.onerror / unhandledrejection ───┐ │
│  └──────────────┘                                                      │ │
└────────────────────────────────────────────────────────────────────────┼─┘
                                                                         │
                                                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                      │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ Error Ingest │ ─► │ Normalizer   │ ─► │ Error Groups │               │
│  │ API          │    │ (dedupe)     │    │ (aggregate)  │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│         │                                       │                        │
│         ▼                                       ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ Source Map   │ ─► │ Stack Mapper │ ─► │ Mapped Trace │               │
│  │ Storage      │    │ Service      │    │              │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌──────────────┐               │
│                                          │ LLM Analysis │               │
│                                          │ Service      │               │
│                                          └──────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌──────────────┐               │
│                                          │ Patch        │               │
│                                          │ Generator    │               │
│                                          └──────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌──────────────┐               │
│                                          │ VCS Service  │               │
│                                          │ (GitHub)     │               │
│                                          └──────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌──────────────┐               │
│                                          │ CI Monitor   │◄─── Polling   │
│                                          │ (iterate)    │               │
│                                          └──────────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │   GitHub     │
                                          │   (PRs)      │
                                          └──────────────┘
```

## Components

### Client SDK (`client-sdk/`)

Lightweight JavaScript SDK for capturing runtime errors.

- **Error Capture**: Listens to `window.onerror` and `unhandledrejection`
- **Batching**: Collects errors and sends in batches
- **Deduplication**: Prevents duplicate error reports
- **Context**: Captures URL, user agent, custom metadata

### Server (`server/`)

Express.js backend handling all API operations.

#### Directory Structure

```
server/
├── src/
│   ├── index.js          # Entry point, Express app setup
│   ├── config.js         # Environment configuration
│   ├── db/
│   │   ├── index.js      # SQLite initialization & migrations
│   │   ├── projects.js   # Project DAO
│   │   ├── errorEvents.js # Error event DAO
│   │   ├── errorGroups.js # Error group DAO
│   │   ├── sourceMaps.js # Source map DAO
│   │   ├── analyses.js   # Analysis DAO
│   │   └── prs.js        # Pull request DAO
│   ├── routes/
│   │   ├── errors.js     # Error ingestion & mapping
│   │   ├── sourcemaps.js # Source map upload
│   │   ├── analyze.js    # LLM analysis & patches
│   │   └── pr.js         # PR creation & CI monitoring
│   └── services/
│       ├── stackMapper.js    # Source map trace mapping
│       ├── normalizer.js     # Error normalization & deduping
│       ├── analysis.js       # LLM interaction
│       ├── patchGenerator.js # Diff generation
│       ├── github.js         # GitHub API client
│       ├── ciMonitor.js      # CI polling & iteration
│       └── llm/
│           └── providers.js  # LLM provider abstraction
```

### Database

SQLite with WAL mode for concurrent access.

#### Tables

| Table | Purpose |
|-------|---------|
| `projects` | Project configuration (name, repo URL, branch) |
| `error_events` | Raw error events from clients |
| `error_groups` | Deduplicated error aggregations |
| `source_maps` | Uploaded source map metadata |
| `analyses` | LLM analysis results |
| `prs` | Created pull requests |

#### Entity Relationships

```
projects (1) ──────┬──── (N) error_events
                   │
                   ├──── (N) error_groups ────── (N) error_events
                   │
                   ├──── (N) source_maps
                   │
                   └──── (N) prs

error_events (1) ──── (N) analyses

analyses (1) ──── (1) prs
```

### Services

#### Stack Mapper (`stackMapper.js`)

Maps minified stack traces to original source using `@jridgewell/trace-mapping`.

```javascript
// Input: "at app.bundle.js:1:2345"
// Output: { source: "src/Button.tsx", line: 42, column: 15, name: "handleClick" }
```

#### Normalizer (`normalizer.js`)

- Extracts error type and message
- Generates SHA256 dedupe key from normalized stack
- Groups identical errors together

#### Analysis Service (`analysis.js`)

Interacts with LLM providers to generate fix suggestions.

Supported providers:
- **DeepInfra** (default)
- **Together.ai**
- **Mock** (for testing)

#### Patch Generator (`patchGenerator.js`)

- Extracts code blocks from LLM suggestions
- Generates unified diff format patches
- Validates patches before applying

#### GitHub Service (`github.js`)

- `GitHubClient`: Low-level API operations
- `VCSService`: High-level PR creation workflow

Operations:
- Create branches
- Read/write file contents
- Create pull requests
- Get PR status and CI checks

#### CI Monitor (`ciMonitor.js`)

Background service that:
1. Polls open PRs for CI status
2. Detects CI failures
3. Re-prompts LLM with failure context
4. Pushes iteration commits
5. Tracks attempt count (bounded retries)

## Data Flow

### 1. Error Ingestion

```
Client Error → POST /api/v1/errors
  → Validate project key
  → Parse stack trace
  → Compute dedupe key
  → Find/create error group
  → Store error event
  → Return event ID
```

### 2. Source Map Upload

```
Build Pipeline → POST /api/v1/sourcemaps
  → Validate project
  → Store file in storage/sourcemaps/{project}/{version}/
  → Save metadata to DB
```

### 3. Stack Mapping

```
GET /api/v1/errors/:id/mapped
  → Load error event
  → Parse stack frames
  → For each frame:
    → Find matching source map
    → Map to original source
  → Return mapped frames
```

### 4. LLM Analysis

```
POST /api/v1/analyze/:errorId
  → Load error + mapped stack
  → Build prompt with error context
  → Call LLM provider
  → Parse response
  → Store analysis
```

### 5. Patch Generation

```
POST /api/v1/analyze/:analysisId/patch
  → Load analysis suggestion
  → Extract code blocks
  → Identify target file
  → Generate unified diff
  → Store patch
```

### 6. PR Creation

```
POST /api/v1/pr/:analysisId
  → Load analysis + patch
  → Get repo details from project
  → Create branch on GitHub
  → Apply patch to file
  → Commit changes
  → Create pull request
  → Store PR record
```

### 7. CI Monitoring

```
CI Monitor (background)
  → Poll open PRs every 60s
  → For each PR:
    → Get CI status from GitHub
    → If failed and attempts < max:
      → Re-analyze with failure context
      → Generate new patch
      → Push iteration commit
      → Increment attempts
```

## Storage

### File Storage (`storage/`)

```
storage/
├── data.sqlite       # SQLite database
├── data.sqlite-wal   # WAL journal
├── sourcemaps/       # Uploaded source maps
│   └── {projectKey}/
│       └── {version}/
│           └── {artifact}.map
└── README.md
```

### Environment Variables

See [CONFIGURATION.md](./CONFIGURATION.md) for complete list.

## Security Considerations

1. **Project Keys**: Used for basic project identification
2. **GitHub Token**: Stored in environment, never logged
3. **LLM API Keys**: Stored in environment, never logged
4. **Source Maps**: Stored locally, not exposed publicly
5. **CORS**: Enabled for client SDK communication

## Scalability

Current design is suitable for:
- Single server deployment
- Low-to-medium error volume
- Small team projects

For production scaling:
- Replace SQLite with PostgreSQL
- Add Redis for caching
- Use job queue for async processing
- Deploy multiple server instances
- Use cloud storage for source maps

## Extension Points

### Adding New LLM Providers

1. Add provider class in `server/src/services/llm/providers.js`
2. Implement `chat(messages)` method
3. Register in `AnalysisService.initialize()`

### Adding GitLab Support

1. Create `server/src/services/gitlab.js`
2. Implement same interface as `GitHubClient`
3. Update `VCSService` to route by provider

### Custom Error Processing

1. Add middleware in error routes
2. Extend `ErrorNormalizer` for custom rules
3. Add custom fields to error_events table

