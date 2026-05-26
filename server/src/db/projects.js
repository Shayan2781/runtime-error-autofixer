export class ProjectDAO {
  constructor(db) {
    this.db = db;
    this.getByKeyStmt = db.prepare('SELECT * FROM projects WHERE project_key = ?');
    this.createStmt = db.prepare(`
      INSERT INTO projects (name, project_key, repo_provider, repo_url, default_branch)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  }

  /**
   * Find or create a project by project key
   * Returns the project object
   */
  findOrCreateByKey(projectKey, defaults = {}) {
    let project = this.getByKeyStmt.get(projectKey);

    if (!project) {
      const name = defaults.name || projectKey;
      const repoProvider = defaults.repoProvider || null;
      const repoUrl = defaults.repoUrl || null;
      const defaultBranch = defaults.defaultBranch || 'main';

      const result = this.createStmt.run(name, projectKey, repoProvider, repoUrl, defaultBranch);
      project = this.getByIdStmt.get(result.lastInsertRowid);
    }

    return project;
  }

  getById(id) {
    return this.getByIdStmt.get(id);
  }
}

