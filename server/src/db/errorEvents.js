export class ErrorEventDAO {
  constructor(db) {
    this.db = db;
    this.createStmt = db.prepare(`
      INSERT INTO error_events (
        project_id, raw_stack, user_agent, url, release, environment, dedupe_key, mapped, error_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare('SELECT * FROM error_events WHERE id = ?');
    this.updateMappedStmt = db.prepare('UPDATE error_events SET mapped = ? WHERE id = ?');
    this.updateGroupStmt = db.prepare(
      'UPDATE error_events SET error_group_id = ?, dedupe_key = ? WHERE id = ?'
    );
    this.listByGroupStmt = db.prepare(
      'SELECT * FROM error_events WHERE error_group_id = ? ORDER BY received_at DESC LIMIT ?'
    );
    this.countByGroupStmt = db.prepare(
      'SELECT COUNT(*) as count FROM error_events WHERE error_group_id = ?'
    );
  }

  /**
   * Create a new error event
   * Returns the created error event object
   */
  createErrorEvent(data) {
    const {
      projectId,
      rawStack,
      userAgent = null,
      url = null,
      release = null,
      environment = null,
      dedupeKey = null,
      mapped = false,
      errorGroupId = null,
    } = data;

    if (!projectId || !rawStack) {
      throw new Error('projectId and rawStack are required');
    }

    const result = this.createStmt.run(
      projectId,
      rawStack,
      userAgent,
      url,
      release,
      environment,
      dedupeKey,
      mapped ? 1 : 0,
      errorGroupId
    );

    return this.getByIdStmt.get(result.lastInsertRowid);
  }

  getById(id) {
    return this.getByIdStmt.get(id);
  }

  /**
   * Update the mapped status of an error event
   */
  updateMapped(id, mapped) {
    return this.updateMappedStmt.run(mapped ? 1 : 0, id);
  }

  /**
   * Update the error group association
   */
  updateGroup(id, errorGroupId, dedupeKey) {
    return this.updateGroupStmt.run(errorGroupId, dedupeKey, id);
  }

  /**
   * List error events for a group
   */
  listByGroup(errorGroupId, limit = 50) {
    return this.listByGroupStmt.all(errorGroupId, limit);
  }

  /**
   * Count error events in a group
   */
  countByGroup(errorGroupId) {
    const result = this.countByGroupStmt.get(errorGroupId);
    return result ? result.count : 0;
  }
}
