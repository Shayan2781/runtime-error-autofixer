import express from 'express';
import multer from 'multer';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

export function createSourceMapRoutes(projectDAO, sourceMapDAO, config, logger) {
  const router = express.Router();

  // Memory storage so we can move the buffer to the right path once we've
  // parsed the project/version fields out of the body.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
      if (
        file.originalname.endsWith('.map') ||
        file.mimetype === 'application/json'
      ) {
        cb(null, true);
      } else {
        cb(new Error('Only .map files are allowed'), false);
      }
    },
  });

  /**
   * POST /api/v1/sourcemaps
   * Upload a source map file
   *
   * Body (multipart/form-data):
   * - file: The source map file (.map)
   * - projectKey: string (required) - Project identifier
   * - version: string (optional) - Release version
   * - fileUrl: string (optional) - URL of the original minified file
   */
  router.post('/', upload.single('file'), async (req, res) => {
    try {
      const { projectKey, version, fileUrl, artifactName } = req.body;

      // Validation
      if (!projectKey || typeof projectKey !== 'string') {
        return res.status(400).json({
          error: 'projectKey is required and must be a string',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded. Please upload a .map file.',
        });
      }

      // Find or create project
      const project = projectDAO.findOrCreateByKey(projectKey);

      // Build storage path: storage/sourcemaps/{projectKey}/{version}/
      const versionDir = version || 'latest';
      const uploadDir = resolve(config.storageDir, 'sourcemaps', projectKey, versionDir);

      // Ensure directory exists
      if (!existsSync(uploadDir)) {
        mkdirSync(uploadDir, { recursive: true });
      }

      // Write file to disk
      // Determine stored filename: use artifactName if provided (e.g. app.bundle.js → app.bundle.js.map)
      let storedFileName = req.file.originalname;
      if (artifactName && typeof artifactName === 'string') {
        storedFileName = artifactName.endsWith('.map') ? artifactName : `${artifactName}.map`;
      }

      const filePath = join(uploadDir, storedFileName);
      writeFileSync(filePath, req.file.buffer);

      const sourceMap = sourceMapDAO.create({
        projectId: project.id,
        artifactName: storedFileName,
        version: version || null,
        fileUrl: fileUrl || null,
        localPath: filePath,
      });

      logger.info(
        {
          sourceMapId: sourceMap.id,
          projectId: project.id,
          artifact: sourceMap.artifact_name,
          version: sourceMap.version,
          path: filePath,
        },
        'Source map uploaded'
      );

      // Return created source map record
      res.status(201).json({
        id: sourceMap.id,
        projectId: sourceMap.project_id,
        artifactName: sourceMap.artifact_name,
        version: sourceMap.version,
        fileUrl: sourceMap.file_url,
        localPath: sourceMap.local_path,
        uploadedAt: sourceMap.uploaded_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error uploading source map');
      res.status(500).json({
        error: 'Failed to upload source map',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/sourcemaps/:id
   * Get source map by ID
   */
  router.get('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        return res.status(400).json({
          error: 'Invalid source map ID',
        });
      }

      const sourceMap = sourceMapDAO.getById(id);

      if (!sourceMap) {
        return res.status(404).json({
          error: 'Source map not found',
        });
      }

      res.json({
        id: sourceMap.id,
        projectId: sourceMap.project_id,
        artifactName: sourceMap.artifact_name,
        version: sourceMap.version,
        fileUrl: sourceMap.file_url,
        localPath: sourceMap.local_path,
        uploadedAt: sourceMap.uploaded_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error retrieving source map');
      res.status(500).json({
        error: 'Failed to retrieve source map',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/sourcemaps/project/:projectKey
   * List all source maps for a project
   */
  router.get('/project/:projectKey', (req, res) => {
    try {
      const { projectKey } = req.params;

      // Find project
      const project = projectDAO.getByKeyStmt
        ? projectDAO.getByKeyStmt.get(projectKey)
        : null;

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
        });
      }

      const sourceMaps = sourceMapDAO.listByProject(project.id);

      res.json({
        projectId: project.id,
        projectKey: project.project_key,
        sourceMaps: sourceMaps.map((sm) => ({
          id: sm.id,
          artifactName: sm.artifact_name,
          version: sm.version,
          fileUrl: sm.file_url,
          uploadedAt: sm.uploaded_at,
        })),
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error listing source maps');
      res.status(500).json({
        error: 'Failed to list source maps',
        message: error.message,
      });
    }
  });

  // Error handling for multer
  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large. Maximum size is 50MB.',
        });
      }
      return res.status(400).json({
        error: err.message,
      });
    }
    if (err) {
      return res.status(400).json({
        error: err.message,
      });
    }
    next();
  });

  return router;
}
