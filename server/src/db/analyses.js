export class AnalysisDAO {
  constructor(db) {
    this.db = db;

    this.createStmt = db.prepare(`
      INSERT INTO analyses (
        error_event_id, error_group_id, status, llm_model, llm_provider,
        suggestion_summary, suggestion_full, patch_unified_diff, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM analyses WHERE id = ?');

    this.getByErrorEventIdStmt = db.prepare(
      'SELECT * FROM analyses WHERE error_event_id = ? ORDER BY created_at DESC LIMIT 1'
    );

    this.getByErrorGroupIdStmt = db.prepare(
      'SELECT * FROM analyses WHERE error_group_id = ? ORDER BY created_at DESC LIMIT 1'
    );

    this.getLatestFixByGroupIdStmt = db.prepare(`
      SELECT
        a.*,
        p.id AS pr_id,
        p.pr_url,
        p.pr_number,
        p.status AS pr_status
      FROM analyses a
      INNER JOIN prs p ON p.analysis_id = a.id
      WHERE a.error_group_id = ?
        AND a.patch_unified_diff IS NOT NULL
        AND p.status != 'closed'
      ORDER BY a.created_at DESC
      LIMIT 1
    `);

    this.updateStatusStmt = db.prepare(`
      UPDATE analyses 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.updateSuggestionStmt = db.prepare(`
      UPDATE analyses 
      SET status = ?, suggestion_summary = ?, suggestion_full = ?, 
          duration_ms = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.updatePatchStmt = db.prepare(`
      UPDATE analyses 
      SET status = ?, patch_unified_diff = ?, patch_fixed_content = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.listByProjectStmt = db.prepare(`
      SELECT a.*, e.project_id, e.raw_stack, g.error_type, g.error_message
      FROM analyses a
      JOIN error_events e ON a.error_event_id = e.id
      LEFT JOIN error_groups g ON a.error_group_id = g.id
      WHERE e.project_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `);
  }

  /**
   * Create a new analysis
   */
  create(data) {
    const {
      errorEventId,
      errorGroupId = null,
      status = 'pending',
      llmModel = null,
      llmProvider = null,
      suggestionSummary = null,
      suggestionFull = null,
      patchUnifiedDiff = null,
      durationMs = null,
    } = data;

    const result = this.createStmt.run(
      errorEventId,
      errorGroupId,
      status,
      llmModel,
      llmProvider,
      suggestionSummary,
      suggestionFull,
      patchUnifiedDiff,
      durationMs
    );

    return this.getByIdStmt.get(result.lastInsertRowid);
  }

  /**
   * Get analysis by ID
   */
  getById(id) {
    return this.getByIdStmt.get(id);
  }

  /**
   * Get latest analysis for an error event
   */
  getByErrorEventId(errorEventId) {
    return this.getByErrorEventIdStmt.get(errorEventId);
  }

  /**
   * Get latest analysis for an error group
   */
  getByErrorGroupId(errorGroupId) {
    return this.getByErrorGroupIdStmt.get(errorGroupId);
  }

  getLatestFixByGroupId(errorGroupId) {
    return this.getLatestFixByGroupIdStmt.get(errorGroupId);
  }

  /**
   * Update analysis status
   */
  updateStatus(id, status) {
    return this.updateStatusStmt.run(status, id);
  }

  /**
   * Update analysis with suggestion
   */
  updateSuggestion(id, status, summary, full, durationMs) {
    return this.updateSuggestionStmt.run(status, summary, full, durationMs, id);
  }

  /**
   * Update analysis with patch
   */
  updatePatch(id, status, patch, fixedContent = null) {
    return this.updatePatchStmt.run(status, patch, fixedContent, id);
  }

  /**
   * List analyses for a project
   */
  listByProject(projectId, limit = 50) {
    return this.listByProjectStmt.all(projectId, limit);
  }
}

