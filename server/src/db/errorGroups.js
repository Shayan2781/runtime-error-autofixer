export class ErrorGroupDAO {
  constructor(db) {
    this.db = db;

    this.findByDedupeKeyStmt = db.prepare(
      'SELECT * FROM error_groups WHERE dedupe_key = ?'
    );

    this.createStmt = db.prepare(`
      INSERT INTO error_groups (
        project_id, dedupe_key, error_type, error_message, fingerprint, occurrence_count
      ) VALUES (?, ?, ?, ?, ?, 1)
    `);

    this.incrementCountStmt = db.prepare(`
      UPDATE error_groups 
      SET occurrence_count = occurrence_count + 1, 
          last_seen_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    this.getByIdStmt = db.prepare('SELECT * FROM error_groups WHERE id = ?');

    this.listByProjectStmt = db.prepare(`
      SELECT * FROM error_groups 
      WHERE project_id = ? 
      ORDER BY last_seen_at DESC
    `);

    this.listByProjectWithStatusStmt = db.prepare(`
      SELECT * FROM error_groups 
      WHERE project_id = ? AND status = ?
      ORDER BY last_seen_at DESC
    `);

    this.updateStatusStmt = db.prepare(
      'UPDATE error_groups SET status = ? WHERE id = ?'
    );

    this.getStatsStmt = db.prepare(`
      SELECT 
        COUNT(*) as total_groups,
        SUM(occurrence_count) as total_occurrences,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
      FROM error_groups 
      WHERE project_id = ?
    `);
  }

  /**
   * Find or create an error group by dedupe key
   * Returns { group, isNew }
   */
  findOrCreate(data) {
    const { projectId, dedupeKey, errorType, errorMessage, fingerprint } = data;

    // Try to find existing group
    let group = this.findByDedupeKeyStmt.get(dedupeKey);

    if (group) {
      // Increment occurrence count
      this.incrementCountStmt.run(group.id);
      // Refresh the group data
      group = this.getByIdStmt.get(group.id);
      return { group, isNew: false };
    }

    // Create new group
    const result = this.createStmt.run(
      projectId,
      dedupeKey,
      errorType,
      errorMessage,
      fingerprint
    );

    group = this.getByIdStmt.get(result.lastInsertRowid);
    return { group, isNew: true };
  }

  /**
   * Get error group by ID
   */
  getById(id) {
    return this.getByIdStmt.get(id);
  }

  /**
   * Get error group by dedupe key
   */
  getByDedupeKey(dedupeKey) {
    return this.findByDedupeKeyStmt.get(dedupeKey);
  }

  /**
   * List error groups for a project
   */
  listByProject(projectId, status = null) {
    if (status) {
      return this.listByProjectWithStatusStmt.all(projectId, status);
    }
    return this.listByProjectStmt.all(projectId);
  }

  /**
   * Update error group status
   */
  updateStatus(id, status) {
    return this.updateStatusStmt.run(status, id);
  }

  /**
   * Get stats for a project
   */
  getStats(projectId) {
    return this.getStatsStmt.get(projectId);
  }
}

