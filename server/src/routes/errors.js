import express from 'express';
import { StackMapper, formatMappedStack } from '../services/stackMapper.js';
import { ErrorNormalizer } from '../services/normalizer.js';
import { createIngestionAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { redactErrorPayload, shouldSample } from '../services/redaction.js';

export function createErrorRoutes(db, projectDAO, errorEventDAO, sourceMapDAO, errorGroupDAO, config, logger) {
  const router = express.Router();
  const stackMapper = new StackMapper(sourceMapDAO, logger);
  const normalizer = new ErrorNormalizer();
  const ingestionAuth = createIngestionAuth(projectDAO, config);
  const rateLimiter = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
    keyFn: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
    logger,
  });

  /**
   * POST /api/v1/errors
   * Ingest a client-side error event
   */
  router.post('/', rateLimiter, ingestionAuth, (req, res) => {
    try {
      let { rawStack, userAgent, url } = req.body;
      const { projectKey, release, environment } = req.body;

      if (!projectKey || typeof projectKey !== 'string') {
        return res.status(400).json({
          error: 'projectKey is required and must be a string',
        });
      }

      if (!rawStack || typeof rawStack !== 'string') {
        return res.status(400).json({
          error: 'rawStack is required and must be a string',
        });
      }

      // Server-side sampling
      if (!shouldSample(config.serverSampleRate)) {
        return res.status(202).json({
          sampled: false,
          message: 'Error dropped by server sample rate',
        });
      }

      // Redact sensitive data before persistence
      const redacted = redactErrorPayload(
        { projectKey, rawStack, userAgent, url, release, environment },
        config
      );
      rawStack = redacted.rawStack;
      url = redacted.url;
      userAgent = redacted.userAgent;

      // Find or create project (skip auto-create when auth is enabled)
      const project = req.authenticatedProject || projectDAO.findOrCreateByKey(projectKey);

      // Normalize the error and compute dedupe key
      const normalized = normalizer.normalize(rawStack);

      // Find or create error group
      const { group, isNew } = errorGroupDAO.findOrCreate({
        projectId: project.id,
        dedupeKey: normalized.dedupeKey,
        errorType: normalized.errorType,
        errorMessage: normalized.errorMessage,
        fingerprint: normalized.fingerprint,
      });

      // Create error event
      const errorEvent = errorEventDAO.createErrorEvent({
        projectId: project.id,
        rawStack,
        userAgent: userAgent || null,
        url: url || null,
        release: release || null,
        environment: environment || null,
        dedupeKey: normalized.dedupeKey,
        mapped: false,
        errorGroupId: group.id,
      });

      logger.info(
        {
          errorId: errorEvent.id,
          groupId: group.id,
          isNewGroup: isNew,
          occurrences: group.occurrence_count,
        },
        'Error ingested'
      );

      // Return created error event
      res.status(201).json({
        id: errorEvent.id,
        projectId: errorEvent.project_id,
        receivedAt: errorEvent.received_at,
        rawStack: errorEvent.raw_stack,
        userAgent: errorEvent.user_agent,
        url: errorEvent.url,
        release: errorEvent.release,
        environment: errorEvent.environment,
        mapped: Boolean(errorEvent.mapped),
        dedupeKey: errorEvent.dedupe_key,
        errorGroupId: group.id,
        isNewError: isNew,
        occurrenceCount: group.occurrence_count,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error ingesting error event');
      res.status(500).json({
        error: 'Failed to ingest error event',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/errors/:id
   * Retrieve an error event by ID
   */
  router.get('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        return res.status(400).json({
          error: 'Invalid error event ID',
        });
      }

      const errorEvent = errorEventDAO.getById(id);

      if (!errorEvent) {
        return res.status(404).json({
          error: 'Error event not found',
        });
      }

      res.json({
        id: errorEvent.id,
        projectId: errorEvent.project_id,
        receivedAt: errorEvent.received_at,
        rawStack: errorEvent.raw_stack,
        userAgent: errorEvent.user_agent,
        url: errorEvent.url,
        release: errorEvent.release,
        environment: errorEvent.environment,
        dedupeKey: errorEvent.dedupe_key,
        errorGroupId: errorEvent.error_group_id,
        mapped: Boolean(errorEvent.mapped),
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error retrieving error event');
      res.status(500).json({
        error: 'Failed to retrieve error event',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/errors/:id/mapped
   * Get error event with mapped stack trace
   */
  router.get('/:id/mapped', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        return res.status(400).json({
          error: 'Invalid error event ID',
        });
      }

      const errorEvent = errorEventDAO.getById(id);

      if (!errorEvent) {
        return res.status(404).json({
          error: 'Error event not found',
        });
      }

      // Map the stack trace
      const mappingResult = await stackMapper.mapStackTrace(
        errorEvent.raw_stack,
        errorEvent.project_id,
        errorEvent.release
      );

      // Update mapped status if we successfully mapped frames
      if (mappingResult.mappedFrames > 0 && !errorEvent.mapped) {
        errorEventDAO.updateMapped(id, true);
      }

      res.json({
        id: errorEvent.id,
        projectId: errorEvent.project_id,
        receivedAt: errorEvent.received_at,
        rawStack: errorEvent.raw_stack,
        mappedStack: formatMappedStack(mappingResult.frames),
        frames: mappingResult.frames,
        totalFrames: mappingResult.totalFrames,
        mappedFrames: mappingResult.mappedFrames,
        fullyMapped: mappingResult.fullyMapped,
        userAgent: errorEvent.user_agent,
        url: errorEvent.url,
        release: errorEvent.release,
        environment: errorEvent.environment,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error mapping stack trace');
      res.status(500).json({
        error: 'Failed to map stack trace',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/errors/map
   * Map a stack trace without storing (utility endpoint)
   */
  router.post('/map', async (req, res) => {
    try {
      const { projectKey, rawStack, version } = req.body;

      if (!projectKey || typeof projectKey !== 'string') {
        return res.status(400).json({
          error: 'projectKey is required and must be a string',
        });
      }

      if (!rawStack || typeof rawStack !== 'string') {
        return res.status(400).json({
          error: 'rawStack is required and must be a string',
        });
      }

      const project = projectDAO.getByKeyStmt
        ? projectDAO.getByKeyStmt.get(projectKey)
        : null;

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
        });
      }

      const mappingResult = await stackMapper.mapStackTrace(rawStack, project.id, version);

      res.json({
        projectId: project.id,
        rawStack,
        mappedStack: formatMappedStack(mappingResult.frames),
        frames: mappingResult.frames,
        totalFrames: mappingResult.totalFrames,
        mappedFrames: mappingResult.mappedFrames,
        fullyMapped: mappingResult.fullyMapped,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error mapping stack trace');
      res.status(500).json({
        error: 'Failed to map stack trace',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/errors/groups/:projectKey
   * List error groups for a project
   */
  router.get('/groups/:projectKey', (req, res) => {
    try {
      const { projectKey } = req.params;
      const { status } = req.query;

      const project = projectDAO.getByKeyStmt
        ? projectDAO.getByKeyStmt.get(projectKey)
        : null;

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
        });
      }

      const groups = errorGroupDAO.listByProject(project.id, status || null);
      const stats = errorGroupDAO.getStats(project.id);

      res.json({
        projectId: project.id,
        projectKey: project.project_key,
        stats: {
          totalGroups: stats?.total_groups || 0,
          totalOccurrences: stats?.total_occurrences || 0,
          openCount: stats?.open_count || 0,
          resolvedCount: stats?.resolved_count || 0,
        },
        groups: groups.map((g) => ({
          id: g.id,
          dedupeKey: g.dedupe_key,
          errorType: g.error_type,
          errorMessage: g.error_message,
          fingerprint: g.fingerprint,
          firstSeenAt: g.first_seen_at,
          lastSeenAt: g.last_seen_at,
          occurrenceCount: g.occurrence_count,
          status: g.status,
        })),
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error listing error groups');
      res.status(500).json({
        error: 'Failed to list error groups',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/errors/group/:groupId
   * Get error group details with recent events
   */
  router.get('/group/:groupId', (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);

      if (isNaN(groupId)) {
        return res.status(400).json({
          error: 'Invalid group ID',
        });
      }

      const group = errorGroupDAO.getById(groupId);

      if (!group) {
        return res.status(404).json({
          error: 'Error group not found',
        });
      }

      const recentEvents = errorEventDAO.listByGroup(groupId, 10);

      res.json({
        id: group.id,
        projectId: group.project_id,
        dedupeKey: group.dedupe_key,
        errorType: group.error_type,
        errorMessage: group.error_message,
        fingerprint: group.fingerprint,
        firstSeenAt: group.first_seen_at,
        lastSeenAt: group.last_seen_at,
        occurrenceCount: group.occurrence_count,
        status: group.status,
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          receivedAt: e.received_at,
          url: e.url,
          userAgent: e.user_agent,
          release: e.release,
          environment: e.environment,
        })),
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error retrieving error group');
      res.status(500).json({
        error: 'Failed to retrieve error group',
        message: error.message,
      });
    }
  });

  /**
   * PATCH /api/v1/errors/group/:groupId/status
   * Update error group status
   */
  router.patch('/group/:groupId/status', (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);
      const { status } = req.body;

      if (isNaN(groupId)) {
        return res.status(400).json({
          error: 'Invalid group ID',
        });
      }

      const validStatuses = ['open', 'resolved', 'ignored'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }

      const group = errorGroupDAO.getById(groupId);

      if (!group) {
        return res.status(404).json({
          error: 'Error group not found',
        });
      }

      errorGroupDAO.updateStatus(groupId, status);

      res.json({
        id: groupId,
        status,
        message: `Group status updated to ${status}`,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error updating group status');
      res.status(500).json({
        error: 'Failed to update group status',
        message: error.message,
      });
    }
  });

  return router;
}
