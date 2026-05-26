export class SourceMapDAO {
  constructor(db) {
    this.db = db;
    this.createStmt = db.prepare(`
      INSERT INTO source_maps (
        project_id, artifact_name, version, file_url, local_path
      ) VALUES (?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare('SELECT * FROM source_maps WHERE id = ?');
    this.getByProjectAndArtifactStmt = db.prepare(`
      SELECT * FROM source_maps 
      WHERE project_id = ? AND artifact_name = ? 
      ORDER BY uploaded_at DESC 
      LIMIT 1
    `);
    this.getByProjectAndVersionStmt = db.prepare(`
      SELECT * FROM source_maps 
      WHERE project_id = ? AND version = ? AND artifact_name = ?
    `);
    this.listByProjectStmt = db.prepare(`
      SELECT * FROM source_maps 
      WHERE project_id = ? 
      ORDER BY uploaded_at DESC
    `);
  }

  /**
   * Create a new source map record
   * @param {Object} data - Source map data
   * @returns {Object} Created source map record
   */
  create(data) {
    const {
      projectId,
      artifactName,
      version = null,
      fileUrl = null,
      localPath,
    } = data;

    if (!projectId || !artifactName || !localPath) {
      throw new Error('projectId, artifactName, and localPath are required');
    }

    const result = this.createStmt.run(
      projectId,
      artifactName,
      version,
      fileUrl,
      localPath
    );

    return this.getByIdStmt.get(result.lastInsertRowid);
  }

  /**
   * Get source map by ID
   */
  getById(id) {
    return this.getByIdStmt.get(id);
  }

  /**
   * Get the latest source map for a project and artifact name
   */
  getByProjectAndArtifact(projectId, artifactName) {
    return this.getByProjectAndArtifactStmt.get(projectId, artifactName);
  }

  /**
   * Get source map by project, version, and artifact name
   */
  getByProjectVersionAndArtifact(projectId, version, artifactName) {
    return this.getByProjectAndVersionStmt.get(projectId, version, artifactName);
  }

  /**
   * List all source maps for a project
   */
  listByProject(projectId) {
    return this.listByProjectStmt.all(projectId);
  }
}

