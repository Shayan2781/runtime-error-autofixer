import express from 'express';
import { VCSService } from '../services/vcs.js';
import { CIMonitor } from '../services/ciMonitor.js';
import { extractTargetFileFromPatch } from '../services/patchGenerator.js';

export function createPRRoutes(analysisDAO, prDAO, projectDAO, errorEventDAO, sourceMapDAO, config, logger) {
  const router = express.Router();
  const vcsService = new VCSService(config, logger);

  // Initialize CI Monitor
  const ciMonitor = new CIMonitor(config, logger, {
    prDAO,
    analysisDAO,
    errorEventDAO,
    projectDAO,
    sourceMapDAO,
  });

  // =====================
  // STATIC ROUTES FIRST (must be before parameterized routes)
  // =====================

  /**
   * GET /api/v1/pr/monitor/status
   * Get CI monitor status
   */
  router.get('/monitor/status', (_req, res) => {
    const status = ciMonitor.getStatus();
    res.json(status);
  });

  /**
   * POST /api/v1/pr/monitor/start
   * Start CI monitoring (background polling)
   */
  router.post('/monitor/start', (_req, res) => {
    if (!vcsService.isConfigured()) {
      return res.status(400).json({
        error: 'GitHub token not configured',
        hint: 'Set GITHUB_TOKEN environment variable',
      });
    }

    ciMonitor.start();

    res.json({
      message: 'CI monitor started',
      status: ciMonitor.getStatus(),
    });
  });

  /**
   * POST /api/v1/pr/monitor/stop
   * Stop CI monitoring
   */
  router.post('/monitor/stop', (_req, res) => {
    ciMonitor.stop();

    res.json({
      message: 'CI monitor stopped',
      status: ciMonitor.getStatus(),
    });
  });

  /**
   * GET /api/v1/pr/project/:projectKey
   * List PRs for a project
   */
  router.get('/project/:projectKey', (req, res) => {
    try {
      const { projectKey } = req.params;

      const project = projectDAO.getByKeyStmt
        ? projectDAO.getByKeyStmt.get(projectKey)
        : null;

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
        });
      }

      const prs = prDAO.listByProject(project.id);

      res.json({
        projectId: project.id,
        projectKey: project.project_key,
        prs: prs.map((p) => ({
          id: p.id,
          analysisId: p.analysis_id,
          prNumber: p.pr_number,
          prUrl: p.pr_url,
          status: p.status,
          lastCiState: p.last_ci_state,
          attempts: p.attempts,
          createdAt: p.created_at,
        })),
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'List PRs failed');
      res.status(500).json({
        error: 'Failed to list PRs',
        message: error.message,
      });
    }
  });

  // =====================
  // PARAMETERIZED ROUTES
  // =====================

  /**
   * POST /api/v1/pr/:analysisId
   * Create a PR from an analysis
   */
  router.post('/:analysisId', async (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId, 10);

      if (isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID',
        });
      }

      // Check if VCS is configured
      if (!vcsService.isConfigured()) {
        return res.status(400).json({
          error: 'GitHub token not configured',
          hint: 'Set GITHUB_TOKEN environment variable',
        });
      }

      // Get analysis
      const analysis = analysisDAO.getById(analysisId);
      if (!analysis) {
        return res.status(404).json({
          error: 'Analysis not found',
        });
      }

      if (!analysis.patch_unified_diff) {
        return res.status(400).json({
          error: 'No patch available for this analysis',
          hint: 'POST to /api/v1/analyze/:analysisId/patch first',
        });
      }

      // Check for existing PR
      const existingPR = prDAO.getByAnalysisId(analysisId);
      if (existingPR && existingPR.status !== 'closed') {
        return res.json({
          id: existingPR.id,
          analysisId: existingPR.analysis_id,
          prNumber: existingPR.pr_number,
          prUrl: existingPR.pr_url,
          status: existingPR.status,
          alreadyGenerated: true,
          message: 'Fix already generated for this error',
          cached: true,
        });
      }

      // Get error event
      const errorEvent = errorEventDAO.getById(analysis.error_event_id);
      if (!errorEvent) {
        return res.status(404).json({
          error: 'Error event not found',
        });
      }

      // Get project
      const project = projectDAO.getByIdStmt
        ? projectDAO.getByIdStmt.get(errorEvent.project_id)
        : null;

      if (!project) {
        return res.status(404).json({
          error: 'Project not found',
        });
      }

      if (!project.repo_url) {
        return res.status(400).json({
          error: 'Project has no repository URL configured',
          hint: 'Update project with repo_url',
        });
      }

      const targetFile =
        extractTargetFileFromPatch(analysis.patch_unified_diff) || 'unknown-file.js';

      // Create PR title
      const title = `fix: ${analysis.suggestion_summary || 'Auto-fix for runtime error'}`.substring(
        0,
        72
      );

      // Create PR
      const prResult = await vcsService.createPR({
        repoUrl: project.repo_url,
        branch: project.default_branch || 'main',
        patch: analysis.patch_unified_diff,
        fixedFileContent: analysis.patch_fixed_content,
        targetFile,
        title,
        description: analysis.suggestion_full || analysis.suggestion_summary,
        errorId: analysis.error_event_id,
        analysisId: analysis.id,
        provider: project.repo_provider,
      });

      // Save PR record
      const pr = prDAO.create({
        analysisId: analysis.id,
        projectId: project.id,
        provider: prResult.provider,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        branchName: prResult.branchName,
        status: 'opened',
        lastCiState: 'pending',
      });

      logger.info(
        {
          prId: pr.id,
          prNumber: prResult.prNumber,
          prUrl: prResult.prUrl,
        },
        'PR created'
      );

      res.status(201).json({
        id: pr.id,
        analysisId: pr.analysis_id,
        prNumber: pr.pr_number,
        prUrl: pr.pr_url,
        branchName: pr.branch_name,
        status: pr.status,
        cached: false,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'PR creation failed');

      // Handle specific GitHub errors
      if (error.status === 401) {
        return res.status(401).json({
          error: 'GitHub authentication failed',
          message: 'Invalid or expired GitHub token',
        });
      }

      if (error.status === 404) {
        return res.status(404).json({
          error: 'Repository not found',
          message: 'Check that the repository exists and the token has access',
        });
      }

      res.status(500).json({
        error: 'PR creation failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/pr/:prId/status
   * Get PR status including CI state
   */
  router.get('/:prId/status', async (req, res) => {
    try {
      const prId = parseInt(req.params.prId, 10);

      if (isNaN(prId)) {
        return res.status(400).json({
          error: 'Invalid PR ID',
        });
      }

      const pr = prDAO.getById(prId);
      if (!pr) {
        return res.status(404).json({
          error: 'PR not found',
        });
      }

      // Get project for repo URL
      const project = projectDAO.getByIdStmt
        ? projectDAO.getByIdStmt.get(pr.project_id)
        : null;

      if (!project || !project.repo_url) {
        return res.status(400).json({
          error: 'Project repository not configured',
        });
      }

      // Get live status from GitHub
      const status = await vcsService.getPRStatus(
        project.repo_url,
        pr.pr_number,
        pr.provider || project.repo_provider
      );

      // Update stored CI state if changed
      if (status.ciState !== pr.last_ci_state) {
        prDAO.updateCIState(pr.id, status.ciState);
      }

      // Update status if merged or closed
      if (status.merged && pr.status !== 'merged') {
        prDAO.updateStatus(pr.id, 'merged');
      } else if (status.state === 'closed' && !status.merged && pr.status !== 'closed') {
        prDAO.updateStatus(pr.id, 'closed');
      }

      res.json({
        id: pr.id,
        prNumber: pr.pr_number,
        prUrl: pr.pr_url,
        status: status.state,
        merged: status.merged,
        mergeable: status.mergeable,
        ciState: status.ciState,
        attempts: pr.attempts,
        statusChecks: status.statusChecks,
        checkRuns: status.checkRuns,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get PR status failed');
      res.status(500).json({
        error: 'Failed to get PR status',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/pr/:prId/check
   * Manually check a PR status and potentially iterate
   */
  router.post('/:prId/check', async (req, res) => {
    try {
      const prId = parseInt(req.params.prId, 10);

      if (isNaN(prId)) {
        return res.status(400).json({
          error: 'Invalid PR ID',
        });
      }

      const pr = prDAO.getById(prId);
      if (!pr) {
        return res.status(404).json({
          error: 'PR not found',
        });
      }

      if (!vcsService.isConfigured()) {
        return res.status(400).json({
          error: 'GitHub token not configured',
        });
      }

      const result = await ciMonitor.checkPR(pr);

      logger.info({ prId, action: result.action }, 'PR checked');

      res.json({
        prId: pr.id,
        action: result.action,
        currentStatus: pr.status,
        attempts: pr.attempts,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'PR check failed');
      res.status(500).json({
        error: 'Failed to check PR',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/pr/:prId/iterate
   * Manually trigger iteration for a PR (re-analyze and push new commit)
   */
  router.post('/:prId/iterate', async (req, res) => {
    try {
      const prId = parseInt(req.params.prId, 10);

      if (isNaN(prId)) {
        return res.status(400).json({
          error: 'Invalid PR ID',
        });
      }

      if (!vcsService.isConfigured()) {
        return res.status(400).json({
          error: 'GitHub token not configured',
        });
      }

      const result = await ciMonitor.triggerIteration(prId);

      logger.info({ prId, action: result.action }, 'Iteration triggered');

      res.json({
        prId,
        action: result.action,
        attempt: result.attempt,
        message: 'Iteration triggered successfully',
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Iteration failed');
      res.status(500).json({
        error: 'Failed to trigger iteration',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/pr/:prId/history
   * Get iteration history for a PR
   */
  router.get('/:prId/history', async (req, res) => {
    try {
      const prId = parseInt(req.params.prId, 10);

      if (isNaN(prId)) {
        return res.status(400).json({
          error: 'Invalid PR ID',
        });
      }

      const pr = prDAO.getById(prId);
      if (!pr) {
        return res.status(404).json({
          error: 'PR not found',
        });
      }

      // Get analysis for iteration details
      const analysis = analysisDAO.getById(pr.analysis_id);

      res.json({
        prId: pr.id,
        prNumber: pr.pr_number,
        prUrl: pr.pr_url,
        currentStatus: pr.status,
        lastCiState: pr.last_ci_state,
        attempts: pr.attempts,
        maxAttempts: config.maxPrAttempts || 3,
        analysis: analysis
          ? {
              id: analysis.id,
              status: analysis.status,
              suggestionSummary: analysis.suggestion_summary,
              updatedAt: analysis.updated_at,
            }
          : null,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get history failed');
      res.status(500).json({
        error: 'Failed to get PR history',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/pr/:prId
   * Get PR details
   */
  router.get('/:prId', (req, res) => {
    try {
      const prId = parseInt(req.params.prId, 10);

      if (isNaN(prId)) {
        return res.status(400).json({
          error: 'Invalid PR ID',
        });
      }

      const pr = prDAO.getById(prId);
      if (!pr) {
        return res.status(404).json({
          error: 'PR not found',
        });
      }

      res.json({
        id: pr.id,
        analysisId: pr.analysis_id,
        projectId: pr.project_id,
        provider: pr.provider,
        prNumber: pr.pr_number,
        prUrl: pr.pr_url,
        branchName: pr.branch_name,
        status: pr.status,
        lastCiState: pr.last_ci_state,
        attempts: pr.attempts,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get PR failed');
      res.status(500).json({
        error: 'Failed to get PR',
        message: error.message,
      });
    }
  });

  return router;
}
