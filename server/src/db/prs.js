export class PRDAO {
  constructor(db) {
    this.db = db;

    this.createStmt = db.prepare(`
      INSERT INTO prs (
        analysis_id, project_id, provider, pr_number, pr_url, 
        branch_name, status, last_ci_state, attempts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM prs WHERE id = ?');

    this.getByAnalysisIdStmt = db.prepare(
      'SELECT * FROM prs WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1'
    );

    this.updateStatusStmt = db.prepare(`
      UPDATE prs 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.updateCIStateStmt = db.prepare(`
      UPDATE prs 
      SET last_ci_state = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.incrementAttemptsStmt = db.prepare(`
      UPDATE prs 
      SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.listByProjectStmt = db.prepare(`
      SELECT p.*, a.suggestion_summary, e.raw_stack
      FROM prs p
      JOIN analyses a ON p.analysis_id = a.id
      JOIN error_events e ON a.error_event_id = e.id
      WHERE p.project_id = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `);

    this.listByStatusStmt = db.prepare(`
      SELECT * FROM prs 
      WHERE status = ? 
      ORDER BY updated_at ASC
      LIMIT ?
    `);
  }

  /**
   * Create a new PR record
   */
  create(data) {
    const {
      analysisId,
      projectId,
      provider = 'github',
      prNumber = null,
      prUrl = null,
      branchName = null,
      status = 'opened',
      lastCiState = 'pending',
      attempts = 1,
    } = data;

    const result = this.createStmt.run(
      analysisId,
      projectId,
      provider,
      prNumber,
      prUrl,
      branchName,
      status,
      lastCiState,
      attempts
    );

    return this.getByIdStmt.get(result.lastInsertRowid);
  }

  /**
   * Get PR by ID
   */
  getById(id) {
    return this.getByIdStmt.get(id);
  }

  /**
   * Get PR by analysis ID
   */
  getByAnalysisId(analysisId) {
    return this.getByAnalysisIdStmt.get(analysisId);
  }

  /**
   * Update PR status
   */
  updateStatus(id, status) {
    return this.updateStatusStmt.run(status, id);
  }

  /**
   * Update CI state
   */
  updateCIState(id, ciState) {
    return this.updateCIStateStmt.run(ciState, id);
  }

  /**
   * Increment attempts counter
   */
  incrementAttempts(id) {
    return this.incrementAttemptsStmt.run(id);
  }

  /**
   * List PRs for a project
   */
  listByProject(projectId, limit = 50) {
    return this.listByProjectStmt.all(projectId, limit);
  }

  /**
   * List PRs by status (for monitoring/iteration)
   */
  listByStatus(status, limit = 100) {
    return this.listByStatusStmt.all(status, limit);
  }
}

