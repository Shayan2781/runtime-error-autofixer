import express from 'express';
import { StackMapper } from '../services/stackMapper.js';
import { AnalysisService } from '../services/analysis.js';
import { extractErrorInfo } from '../services/normalizer.js';
import { PatchGenerator, extractTargetFileFromPatch } from '../services/patchGenerator.js';
import { buildAnalysisContext } from '../services/sourceContext.js';
import {
  buildExistingFixPayload,
  findExistingFixForGroup,
} from '../services/existingFix.js';

export function createAnalyzeRoutes(
  errorEventDAO,
  errorGroupDAO,
  sourceMapDAO,
  analysisDAO,
  projectDAO,
  config,
  logger
) {
  const router = express.Router();
  const stackMapper = new StackMapper(sourceMapDAO, logger);
  const analysisService = new AnalysisService(config, logger);
  const patchGenerator = new PatchGenerator(config, logger);

  // Initialize the analysis service
  analysisService.initialize();

  /**
   * POST /api/v1/analyze/:errorId
   * Trigger LLM analysis for an error event
   */
  router.post('/:errorId', async (req, res) => {
    try {
      const errorId = parseInt(req.params.errorId, 10);

      if (isNaN(errorId)) {
        return res.status(400).json({
          error: 'Invalid error ID',
        });
      }

      const errorEvent = errorEventDAO.getById(errorId);

      if (!errorEvent) {
        return res.status(404).json({
          error: 'Error event not found',
        });
      }

      const existingFix = findExistingFixForGroup(
        analysisDAO,
        errorGroupDAO,
        errorEvent.error_group_id
      );
      if (existingFix) {
        logger.info(
          {
            errorId,
            errorGroupId: errorEvent.error_group_id,
            analysisId: existingFix.analysis.id,
            occurrenceCount: existingFix.group?.occurrence_count,
          },
          'Duplicate error - returning existing fix'
        );
        return res.json(buildExistingFixPayload(existingFix, errorId));
      }

      // Check for existing analysis on this exact error event
      const existingAnalysis = analysisDAO.getByErrorEventId(errorId);
      if (existingAnalysis && existingAnalysis.status === 'analyzed') {
        return res.json({
          id: existingAnalysis.id,
          errorEventId: existingAnalysis.error_event_id,
          status: existingAnalysis.status,
          suggestionSummary: existingAnalysis.suggestion_summary,
          suggestionFull: existingAnalysis.suggestion_full,
          model: existingAnalysis.llm_model,
          cached: true,
          createdAt: existingAnalysis.created_at,
        });
      }

      // Create analysis record
      const analysis = analysisDAO.create({
        errorEventId: errorId,
        errorGroupId: errorEvent.error_group_id,
        status: 'pending',
        llmProvider: config.llmProvider,
        llmModel: config.llmModel,
      });

      // Map the stack trace and load source snippets
      let mappingResult = null;
      let sourceSnippets = [];
      let targetFrame = null;
      let sourceFiles = {};
      try {
        const analysisContext = await buildAnalysisContext(
          stackMapper,
          sourceMapDAO,
          errorEvent.raw_stack,
          errorEvent.project_id,
          errorEvent.release
        );
        mappingResult = analysisContext.mappingResult;
        sourceSnippets = analysisContext.snippets;
        targetFrame = analysisContext.targetFrame;
        sourceFiles = analysisContext.sourceFiles;
      } catch (err) {
        logger.warn({ error: err.message }, 'Failed to map stack trace for analysis');
      }

      // Extract error info
      const { errorType, errorMessage } = extractErrorInfo(errorEvent.raw_stack);

      // Build error context
      const errorContext = {
        errorType,
        errorMessage,
        rawStack: errorEvent.raw_stack,
        url: errorEvent.url,
        userAgent: errorEvent.user_agent,
        sourceSnippets,
        targetFrame,
        sourceFiles,
      };

      // Run analysis
      analysisDAO.updateStatus(analysis.id, 'analyzing');

      const result = await analysisService.analyze(errorContext, mappingResult);

      if (result.success) {
        const summary = analysisService.extractSummary(result.suggestion);

        analysisDAO.updateSuggestion(
          analysis.id,
          'analyzed',
          summary,
          result.suggestion,
          result.duration
        );

        logger.info(
          {
            analysisId: analysis.id,
            errorId,
            duration: result.duration,
          },
          'Analysis completed'
        );

        res.status(201).json({
          id: analysis.id,
          errorEventId: errorId,
          status: 'analyzed',
          suggestionSummary: summary,
          suggestionFull: result.suggestion,
          model: result.model,
          duration: result.duration,
          cached: false,
          createdAt: analysis.created_at,
        });
      } else {
        analysisDAO.updateStatus(analysis.id, 'failed');

        res.status(500).json({
          id: analysis.id,
          errorEventId: errorId,
          status: 'failed',
          error: result.error,
        });
      }
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Analysis request failed');
      res.status(500).json({
        error: 'Analysis failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/analyze/:analysisId
   * Get analysis result
   */
  router.get('/:analysisId', (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId, 10);

      if (isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID',
        });
      }

      const analysis = analysisDAO.getById(analysisId);

      if (!analysis) {
        return res.status(404).json({
          error: 'Analysis not found',
        });
      }

      res.json({
        id: analysis.id,
        errorEventId: analysis.error_event_id,
        errorGroupId: analysis.error_group_id,
        status: analysis.status,
        llmModel: analysis.llm_model,
        llmProvider: analysis.llm_provider,
        suggestionSummary: analysis.suggestion_summary,
        suggestionFull: analysis.suggestion_full,
        patchUnifiedDiff: analysis.patch_unified_diff,
        durationMs: analysis.duration_ms,
        createdAt: analysis.created_at,
        updatedAt: analysis.updated_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get analysis failed');
      res.status(500).json({
        error: 'Failed to get analysis',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/analyze/error/:errorId
   * Get analysis for an error event
   */
  router.get('/error/:errorId', (req, res) => {
    try {
      const errorId = parseInt(req.params.errorId, 10);

      if (isNaN(errorId)) {
        return res.status(400).json({
          error: 'Invalid error ID',
        });
      }

      const analysis = analysisDAO.getByErrorEventId(errorId);

      if (!analysis) {
        return res.status(404).json({
          error: 'No analysis found for this error',
        });
      }

      res.json({
        id: analysis.id,
        errorEventId: analysis.error_event_id,
        errorGroupId: analysis.error_group_id,
        status: analysis.status,
        llmModel: analysis.llm_model,
        suggestionSummary: analysis.suggestion_summary,
        suggestionFull: analysis.suggestion_full,
        createdAt: analysis.created_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get analysis by error failed');
      res.status(500).json({
        error: 'Failed to get analysis',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/analyze/group/:groupId
   * Get analysis for an error group
   */
  router.get('/group/:groupId', (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId, 10);

      if (isNaN(groupId)) {
        return res.status(400).json({
          error: 'Invalid group ID',
        });
      }

      const analysis = analysisDAO.getByErrorGroupId(groupId);

      if (!analysis) {
        return res.status(404).json({
          error: 'No analysis found for this error group',
        });
      }

      res.json({
        id: analysis.id,
        errorEventId: analysis.error_event_id,
        errorGroupId: analysis.error_group_id,
        status: analysis.status,
        llmModel: analysis.llm_model,
        suggestionSummary: analysis.suggestion_summary,
        suggestionFull: analysis.suggestion_full,
        createdAt: analysis.created_at,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get analysis by group failed');
      res.status(500).json({
        error: 'Failed to get analysis',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/analyze/:analysisId/patch
   * Generate a patch from an analysis
   */
  router.post('/:analysisId/patch', async (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId, 10);

      if (isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID',
        });
      }

      const analysis = analysisDAO.getById(analysisId);

      if (!analysis) {
        return res.status(404).json({
          error: 'Analysis not found',
        });
      }

      if (analysis.patch_unified_diff) {
        const existingFix = findExistingFixForGroup(
          analysisDAO,
          errorGroupDAO,
          analysis.error_group_id
        );
        return res.json({
          analysisId: analysis.id,
          patch: analysis.patch_unified_diff,
          targetFile: extractTargetFileFromPatch(analysis.patch_unified_diff),
          alreadyGenerated: true,
          message: 'Patch already generated for this error',
          prUrl: existingFix?.pr.url || null,
          prNumber: existingFix?.pr.number || null,
          cached: true,
        });
      }

      if (analysis.status !== 'analyzed') {
        return res.status(400).json({
          error: 'Analysis not ready for patch generation',
          status: analysis.status,
        });
      }

      if (!analysis.suggestion_full) {
        return res.status(400).json({
          error: 'No suggestion available for patch generation',
        });
      }

      const errorEvent = errorEventDAO.getById(analysis.error_event_id);
      if (!errorEvent) {
        return res.status(404).json({
          error: 'Error event not found',
        });
      }

      const existingFix = findExistingFixForGroup(
        analysisDAO,
        errorGroupDAO,
        errorEvent.error_group_id
      );
      if (existingFix) {
        return res.json({
          analysisId: existingFix.analysis.id,
          patch: existingFix.analysis.patch_unified_diff,
          targetFile: extractTargetFileFromPatch(existingFix.analysis.patch_unified_diff),
          alreadyGenerated: true,
          message: 'Patch already generated for this error',
          prUrl: existingFix.pr.url,
          prNumber: existingFix.pr.number,
          cached: true,
        });
      }

      // Get project for repo info
      const project = projectDAO.getByIdStmt
        ? projectDAO.getByIdStmt.get(errorEvent.project_id)
        : null;

      // Map stack trace for context
      let mappingResult = null;
      let sourceSnippets = [];
      let targetFrame = null;
      let sourceFiles = {};
      try {
        const analysisContext = await buildAnalysisContext(
          stackMapper,
          sourceMapDAO,
          errorEvent.raw_stack,
          errorEvent.project_id,
          errorEvent.release
        );
        mappingResult = analysisContext.mappingResult;
        sourceSnippets = analysisContext.snippets;
        targetFrame = analysisContext.targetFrame;
        sourceFiles = analysisContext.sourceFiles;
      } catch (err) {
        logger.warn({ error: err.message }, 'Failed to map stack trace for patch');
      }

      // Build error context
      const { errorType, errorMessage } = extractErrorInfo(errorEvent.raw_stack);
      const errorContext = {
        errorType,
        errorMessage,
        rawStack: errorEvent.raw_stack,
        frames: mappingResult?.frames || [],
        sourceSnippets,
        targetFrame,
        sourceFiles,
      };

      // Get repo info if available
      const repoInfo = project?.repo_url
        ? {
            repoUrl: project.repo_url,
            branch: project.default_branch || 'main',
          }
        : null;

      // Generate patch
      const result = await patchGenerator.generatePatch(
        analysis.suggestion_full,
        errorContext,
        repoInfo
      );

      if (result.success) {
        analysisDAO.updatePatch(analysisId, 'proposed', result.patch, result.fixedContent || null);

        logger.info(
          {
            analysisId,
            targetFile: result.targetFile,
            requiresManualReview: result.requiresManualReview,
          },
          'Patch generated'
        );

        res.json({
          analysisId,
          patch: result.patch,
          targetFile: result.targetFile,
          suggestedCode: result.suggestedCode,
          requiresManualReview: result.requiresManualReview || false,
          message: result.message,
          cached: false,
        });
      } else {
        res.status(400).json({
          analysisId,
          error: result.error,
          suggestedCode: result.suggestedCode,
        });
      }
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Patch generation failed');
      res.status(500).json({
        error: 'Patch generation failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/analyze/:analysisId/patch
   * Get the patch for an analysis
   */
  router.get('/:analysisId/patch', (req, res) => {
    try {
      const analysisId = parseInt(req.params.analysisId, 10);

      if (isNaN(analysisId)) {
        return res.status(400).json({
          error: 'Invalid analysis ID',
        });
      }

      const analysis = analysisDAO.getById(analysisId);

      if (!analysis) {
        return res.status(404).json({
          error: 'Analysis not found',
        });
      }

      if (!analysis.patch_unified_diff) {
        return res.status(404).json({
          error: 'No patch generated for this analysis',
          hint: 'POST to /:analysisId/patch to generate a patch',
        });
      }

      res.json({
        analysisId: analysis.id,
        status: analysis.status,
        patch: analysis.patch_unified_diff,
      });
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Get patch failed');
      res.status(500).json({
        error: 'Failed to get patch',
        message: error.message,
      });
    }
  });

  return router;
}

