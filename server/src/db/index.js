import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';

export function initDatabase(databaseUrl, _storageDir) {
  let dbPath = databaseUrl.replace(/^file:/, '');

  if (!dbPath.startsWith('/')) {
    dbPath = resolve(process.cwd(), dbPath);
  }

  const dbDir = dirname(dbPath);

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  runMigrations(db);

  return db;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      project_key TEXT UNIQUE NOT NULL,
      repo_provider TEXT,
      repo_url TEXT,
      default_branch TEXT DEFAULT 'main',
      vcs_auth_token_ref TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS error_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      raw_stack TEXT NOT NULL,
      user_agent TEXT,
      url TEXT,
      release TEXT,
      environment TEXT,
      dedupe_key TEXT,
      mapped BOOLEAN DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_error_events_dedupe_key 
    ON error_events(dedupe_key)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_error_events_project_id 
    ON error_events(project_id)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS source_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      artifact_name TEXT NOT NULL,
      version TEXT,
      file_url TEXT,
      local_path TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_source_maps_project_artifact 
    ON source_maps(project_id, artifact_name)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_source_maps_version 
    ON source_maps(project_id, version)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS error_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      dedupe_key TEXT UNIQUE NOT NULL,
      error_type TEXT,
      error_message TEXT,
      fingerprint TEXT,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      occurrence_count INTEGER DEFAULT 1,
      status TEXT DEFAULT 'open',
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_error_groups_project_id 
    ON error_groups(project_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_error_groups_status 
    ON error_groups(status)
  `);

  // SQLite has no ALTER TABLE ADD CONSTRAINT, so we add the FK column only if missing.
  const columns = db.prepare("PRAGMA table_info(error_events)").all();
  const hasGroupId = columns.some(col => col.name === 'error_group_id');
  if (!hasGroupId) {
    db.exec(`ALTER TABLE error_events ADD COLUMN error_group_id INTEGER REFERENCES error_groups(id)`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_event_id INTEGER NOT NULL,
      error_group_id INTEGER,
      status TEXT DEFAULT 'pending',
      llm_model TEXT,
      llm_provider TEXT,
      suggestion_summary TEXT,
      suggestion_full TEXT,
      patch_unified_diff TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (error_event_id) REFERENCES error_events(id),
      FOREIGN KEY (error_group_id) REFERENCES error_groups(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_error_event_id 
    ON analyses(error_event_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_error_group_id 
    ON analyses(error_group_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_status 
    ON analyses(status)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      provider TEXT DEFAULT 'github',
      pr_number INTEGER,
      pr_url TEXT,
      branch_name TEXT,
      status TEXT DEFAULT 'opened',
      last_ci_state TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prs_analysis_id 
    ON prs(analysis_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prs_project_id 
    ON prs(project_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prs_status 
    ON prs(status)
  `);

  const analysisColumns = db.prepare('PRAGMA table_info(analyses)').all();
  if (!analysisColumns.some((col) => col.name === 'patch_fixed_content')) {
    db.exec('ALTER TABLE analyses ADD COLUMN patch_fixed_content TEXT');
  }
}

