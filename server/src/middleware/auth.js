export function createIngestionAuth(projectDAO, config) {
  return (req, res, next) => {
    if (!config.ingestionAuthEnabled) {
      return next();
    }

    const { projectKey } = req.body || {};
    const headerKey =
      req.headers['x-project-key'] ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

    if (!projectKey || typeof projectKey !== 'string') {
      return res.status(400).json({ error: 'projectKey is required and must be a string' });
    }

    if (!headerKey || headerKey !== projectKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        hint: 'Send X-Project-Key header matching the projectKey in the request body',
      });
    }

    const project = projectDAO.getByKeyStmt.get(projectKey);
    if (!project) {
      return res.status(403).json({
        error: 'Unknown project',
        hint: 'Register the project before sending errors when INGESTION_AUTH_ENABLED=true',
      });
    }

    req.authenticatedProject = project;
    return next();
  };
}
