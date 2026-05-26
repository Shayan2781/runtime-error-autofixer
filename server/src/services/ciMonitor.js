import { VCSService } from './vcs.js';
import { AnalysisService } from './analysis.js';
import { PatchGenerator } from './patchGenerator.js';
import { extractErrorInfo } from './normalizer.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 60000;

export class CIMonitor {
  constructor(config, logger, daos) {
    this.config = config;
    this.logger = logger;
    this.prDAO = daos.prDAO;
    this.analysisDAO = daos.analysisDAO;
    this.errorEventDAO = daos.errorEventDAO;
    this.projectDAO = daos.projectDAO;
    this.sourceMapDAO = daos.sourceMapDAO;

    this.vcsService = new VCSService(config, logger);
    this.analysisService = new AnalysisService(config, logger);
    this.patchGenerator = new PatchGenerator(config, logger);

    this.maxAttempts = config.maxPrAttempts || DEFAULT_MAX_ATTEMPTS;
    this.isRunning = false;
    this.pollTimer = null;

    this.analysisService.initialize();
  }

  start() {
    if (this.isRunning) {
      this.logger.warn('CI Monitor already running');
      return;
    }

    if (!this.vcsService.isConfigured()) {
      this.logger.warn('VCS not configured, CI Monitor not starting');
      return;
    }

    this.isRunning = true;
    this.logger.info({ interval: POLL_INTERVAL_MS }, 'CI Monitor started');

    // Fire one poll immediately so we don't wait a full interval on boot.
    this.pollOpenPRs();
    this.pollTimer = setInterval(() => this.pollOpenPRs(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    this.logger.info('CI Monitor stopped');
  }

  async pollOpenPRs() {
    try {
      const openPRs = this.prDAO.listByStatus('opened', 100);

      this.logger.debug({ count: openPRs.length }, 'Polling open PRs');

      for (const pr of openPRs) {
        try {
          await this.checkPR(pr);
        } catch (error) {
          this.logger.error(
            { prId: pr.id, error: error.message },
            'Error checking PR'
          );
        }
      }
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error polling PRs');
    }
  }

  async checkPR(pr) {
    const project = this.projectDAO.getByIdStmt?.get(pr.project_id);
    if (!project?.repo_url) {
      this.logger.warn({ prId: pr.id }, 'PR project has no repo URL');
      return;
    }

    const status = await this.vcsService.getPRStatus(
      project.repo_url,
      pr.pr_number,
      pr.provider || project.repo_provider
    );

    this.logger.debug(
      {
        prId: pr.id,
        prNumber: pr.pr_number,
        ciState: status.ciState,
        merged: status.merged,
      },
      'PR status checked'
    );

    if (status.ciState !== pr.last_ci_state) {
      this.prDAO.updateCIState(pr.id, status.ciState);
    }

    if (status.merged) {
      this.prDAO.updateStatus(pr.id, 'merged');
      this.logger.info({ prId: pr.id, prNumber: pr.pr_number }, 'PR merged');
      return { action: 'merged' };
    }

    if (status.state === 'closed' && !status.merged) {
      this.prDAO.updateStatus(pr.id, 'closed');
      this.logger.info({ prId: pr.id, prNumber: pr.pr_number }, 'PR closed');
      return { action: 'closed' };
    }

    if (status.ciState === 'failed') {
      if (pr.attempts >= this.maxAttempts) {
        this.logger.warn(
          { prId: pr.id, attempts: pr.attempts, max: this.maxAttempts },
          'Max attempts reached, not iterating'
        );
        return { action: 'max_attempts_reached' };
      }

      this.logger.info(
        { prId: pr.id, attempts: pr.attempts },
        'CI failed, triggering iteration'
      );

      return await this.iteratePR(pr, status);
    }

    if (status.ciState === 'success') {
      this.logger.info({ prId: pr.id, prNumber: pr.pr_number }, 'CI passed');
      return { action: 'ci_success' };
    }

    return { action: 'pending' };
  }

  async iteratePR(pr, ciStatus) {
    const analysis = this.analysisDAO.getById(pr.analysis_id);
    if (!analysis) {
      throw new Error('Analysis not found for PR');
    }

    const errorEvent = this.errorEventDAO.getById(analysis.error_event_id);
    if (!errorEvent) {
      throw new Error('Error event not found');
    }

    const project = this.projectDAO.getByIdStmt?.get(pr.project_id);
    if (!project?.repo_url) {
      throw new Error('Project has no repo URL');
    }

    const failureContext = this.buildFailureContext(ciStatus);

    const { errorType, errorMessage } = extractErrorInfo(errorEvent.raw_stack);

    const reanalysisContext = {
      errorType,
      errorMessage,
      rawStack: errorEvent.raw_stack,
      url: errorEvent.url,
      previousSuggestion: analysis.suggestion_full,
      previousPatch: analysis.patch_unified_diff,
      ciFailure: failureContext,
    };

    const result = await this.reanalyzeWithFailure(reanalysisContext);

    if (!result.success) {
      this.logger.error({ error: result.error }, 'Re-analysis failed');
      return { action: 'reanalysis_failed', error: result.error };
    }

    const patchResult = await this.patchGenerator.generatePatch(
      result.suggestion,
      { errorType, errorMessage, rawStack: errorEvent.raw_stack },
      { repoUrl: project.repo_url, branch: project.default_branch }
    );

    if (!patchResult.success) {
      this.logger.error({ error: patchResult.error }, 'Patch generation failed');
      return { action: 'patch_failed', error: patchResult.error };
    }

    this.analysisDAO.updateSuggestion(
      analysis.id,
      'proposed',
      this.analysisService.extractSummary(result.suggestion),
      result.suggestion,
      result.duration
    );
    this.analysisDAO.updatePatch(
      analysis.id,
      'proposed',
      patchResult.patch,
      patchResult.fixedContent || null
    );

    await this.pushIterationCommit(pr, project, patchResult);

    this.prDAO.incrementAttempts(pr.id);

    await this.vcsService.addComment(
      project.repo_url,
      pr.pr_number,
      `## Iteration ${pr.attempts + 1}

CI failed on the previous attempt. I've analyzed the failure and pushed a new fix.

### Changes
- Updated: \`${patchResult.targetFile}\`

### New Patch
\`\`\`diff
${patchResult.patch}
\`\`\`
`,
      pr.provider || project.repo_provider
    );

    this.logger.info(
      { prId: pr.id, attempt: pr.attempts + 1 },
      'PR iteration completed'
    );

    return { action: 'iterated', attempt: pr.attempts + 1 };
  }

  buildFailureContext(ciStatus) {
    const failedChecks = ciStatus.checkRuns
      ?.filter((c) => c.conclusion === 'failure')
      .map((c) => c.name) || [];

    const failedStatuses = ciStatus.statusChecks
      ?.filter((s) => s.state === 'failure')
      .map((s) => s.context) || [];

    return {
      failedChecks,
      failedStatuses,
      summary: `CI failed. Failed checks: ${[...failedChecks, ...failedStatuses].join(', ') || 'unknown'}`,
    };
  }

  async reanalyzeWithFailure(context) {
    const systemPrompt = `You are an expert JavaScript developer. Your previous fix for a runtime error failed CI tests.

Analyze the failure and provide an improved fix.

Previous suggestion that failed:
${context.previousSuggestion}

Previous patch:
\`\`\`diff
${context.previousPatch}
\`\`\`

CI Failure: ${context.ciFailure.summary}

Provide an improved fix that addresses the CI failure.`;

    const userPrompt = `# Iteration Request

## Original Error
- Type: ${context.errorType}
- Message: ${context.errorMessage}

## Stack Trace
\`\`\`
${context.rawStack}
\`\`\`

## CI Failure Information
${context.ciFailure.summary}

Please provide an improved fix that will pass CI.`;

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const startTime = Date.now();
      const suggestion = await this.analysisService.provider.chat(messages);
      const duration = Date.now() - startTime;

      return {
        success: true,
        suggestion,
        duration,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async pushIterationCommit(pr, project, patchResult) {
    const commitMessage = `fix: Iteration ${pr.attempts + 1} - Updated fix based on CI feedback`;

    await this.vcsService.pushCommitToBranch({
      repoUrl: project.repo_url,
      branchName: pr.branch_name,
      targetFile: patchResult.targetFile,
      patch: patchResult.patch,
      fixedFileContent: patchResult.fixedContent,
      commitMessage,
      provider: pr.provider || project.repo_provider,
    });
  }

  async triggerIteration(prId) {
    const pr = this.prDAO.getById(prId);
    if (!pr) {
      throw new Error('PR not found');
    }

    if (pr.status !== 'opened') {
      throw new Error(`PR is ${pr.status}, cannot iterate`);
    }

    if (pr.attempts >= this.maxAttempts) {
      throw new Error(`Max attempts (${this.maxAttempts}) reached`);
    }

    const project = this.projectDAO.getByIdStmt?.get(pr.project_id);
    if (!project?.repo_url) {
      throw new Error('Project has no repo URL');
    }

    const status = await this.vcsService.getPRStatus(
      project.repo_url,
      pr.pr_number,
      pr.provider || project.repo_provider
    );

    return await this.iteratePR(pr, status);
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      maxAttempts: this.maxAttempts,
      pollInterval: POLL_INTERVAL_MS,
      vcsConfigured: this.vcsService.isConfigured(),
    };
  }
}

