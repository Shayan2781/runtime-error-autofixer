#!/usr/bin/env bash
# Link the live-demo project to your GitHub repo in SQLite
#
# Usage: ./scripts/setup-live-demo-github.sh https://github.com/YOU/REPO

set -euo pipefail

REPO_URL="${1:-}"
DB="${2:-storage/data.sqlite}"

if [ -z "$REPO_URL" ]; then
  echo "Usage: $0 https://github.com/YOUR_USER/YOUR_REPO"
  exit 1
fi

sqlite3 "$DB" <<SQL
INSERT INTO projects (name, project_key, repo_provider, repo_url, default_branch)
VALUES ('Live Demo', 'live-demo', 'github', '$REPO_URL', 'master')
ON CONFLICT(project_key) DO UPDATE SET
  repo_url = excluded.repo_url,
  repo_provider = excluded.repo_provider,
  default_branch = excluded.default_branch;
SQL

echo "Project 'live-demo' linked to: $REPO_URL"
sqlite3 "$DB" "SELECT id, project_key, repo_url, repo_provider FROM projects WHERE project_key='live-demo';"
