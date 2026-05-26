import { GitHubClient } from './github.js';
import { GitLabClient } from './gitlab.js';
import { applyPatch, extractNewContentFromPatch } from './patchApply.js';

function detectProvider(repoUrl, explicitProvider) {
  if (explicitProvider === 'github' || explicitProvider === 'gitlab') {
    return explicitProvider;
  }
  if (/gitlab\.com/i.test(repoUrl)) {
    return 'gitlab';
  }
  if (/github\.com/i.test(repoUrl)) {
    return 'github';
  }
  throw new Error(`Cannot detect VCS provider from URL: ${repoUrl}`);
}

export class VCSService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.github = config.githubToken ? new GitHubClient(config.githubToken, logger) : null;
    this.gitlab = config.gitlabToken ? new GitLabClient(config.gitlabToken, logger) : null;

    if (this.github) {
      this.logger.info('GitHub client initialized');
    }
    if (this.gitlab) {
      this.logger.info('GitLab client initialized');
    }
  }

  isConfigured() {
    return !!(this.github || this.gitlab);
  }

  isProviderConfigured(provider) {
    if (provider === 'gitlab') {
      return !!this.gitlab;
    }
    return !!this.github;
  }

  async createPR(options) {
    const {
      repoUrl,
      branch = 'main',
      patch,
      targetFile,
      fixedFileContent = null,
      title,
      description,
      errorId,
      analysisId,
      provider: explicitProvider,
    } = options;

    const provider = detectProvider(repoUrl, explicitProvider);

    if (provider === 'gitlab') {
      return this.createGitLabMR({
        repoUrl,
        branch,
        patch,
        targetFile,
        fixedFileContent,
        title,
        description,
        errorId,
        analysisId,
      });
    }

    return this.createGitHubPR({
      repoUrl,
      branch,
      patch,
      targetFile,
      fixedFileContent,
      title,
      description,
      errorId,
      analysisId,
    });
  }

  resolveFileContent(existingFile, patch, fixedFileContent) {
    if (fixedFileContent) {
      return fixedFileContent;
    }

    if (existingFile) {
      return applyPatch(existingFile.content, patch);
    }

    return extractNewContentFromPatch(patch);
  }

  async createGitHubPR(options) {
    const {
      repoUrl,
      branch,
      patch,
      targetFile,
      fixedFileContent,
      title,
      description,
      errorId,
      analysisId,
    } = options;

    if (!this.github) {
      throw new Error('GitHub token not configured');
    }

    const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
    this.logger.info({ owner, repo, targetFile }, 'Creating GitHub PR');

    const baseRef = await this.github.getRef(owner, repo, branch);
    const branchName = `auto-fix/error-${errorId}-${Date.now()}`;
    await this.github.createBranch(owner, repo, branchName, baseRef.object.sha);

    const existingFile = await this.github.getFileContent(owner, repo, targetFile, branch);
    const newContent = this.resolveFileContent(existingFile, patch, fixedFileContent);

    const commitMessage = `fix: Auto-fix for error #${errorId}\n\nApplied automated fix from analysis #${analysisId}\n\n${title}`;

    await this.github.createOrUpdateFile(
      owner,
      repo,
      targetFile,
      newContent,
      commitMessage,
      branchName,
      existingFile?.sha
    );

    const prBody = buildPRBody(description, errorId, analysisId, targetFile, patch);
    const pr = await this.github.createPullRequest(owner, repo, title, prBody, branchName, branch);

    return {
      provider: 'github',
      prNumber: pr.number,
      prUrl: pr.html_url,
      branchName,
      state: pr.state,
    };
  }

  async createGitLabMR(options) {
    const {
      repoUrl,
      branch,
      patch,
      targetFile,
      fixedFileContent,
      title,
      description,
      errorId,
      analysisId,
    } = options;

    if (!this.gitlab) {
      throw new Error('GitLab token not configured');
    }

    const { encodedPath } = GitLabClient.parseRepoUrl(repoUrl);
    this.logger.info({ projectPath: encodedPath, targetFile }, 'Creating GitLab MR');

    const baseBranch = await this.gitlab.getBranch(encodedPath, branch);
    if (!baseBranch) {
      throw new Error(`Base branch not found: ${branch}`);
    }

    const branchName = `auto-fix/error-${errorId}-${Date.now()}`;
    await this.gitlab.createBranch(encodedPath, branchName, branch);

    const existingFile = await this.gitlab.getFileContent(encodedPath, targetFile, branch);
    const newContent = this.resolveFileContent(existingFile, patch, fixedFileContent);

    const commitMessage = `fix: Auto-fix for error #${errorId}\n\nApplied automated fix from analysis #${analysisId}\n\n${title}`;

    await this.gitlab.createOrUpdateFile(
      encodedPath,
      targetFile,
      newContent,
      commitMessage,
      branchName,
      existingFile
    );

    const mrBody = buildPRBody(description, errorId, analysisId, targetFile, patch);
    const mr = await this.gitlab.createMergeRequest(encodedPath, title, mrBody, branchName, branch);

    return {
      provider: 'gitlab',
      prNumber: mr.iid,
      prUrl: mr.web_url,
      branchName,
      state: mr.state,
    };
  }

  async getPRStatus(repoUrl, prNumber, provider = null) {
    const resolvedProvider = detectProvider(repoUrl, provider);

    if (resolvedProvider === 'gitlab') {
      return this.getGitLabMRStatus(repoUrl, prNumber);
    }

    return this.getGitHubPRStatus(repoUrl, prNumber);
  }

  async getGitHubPRStatus(repoUrl, prNumber) {
    if (!this.github) {
      throw new Error('GitHub token not configured');
    }

    const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
    const pr = await this.github.getPullRequest(owner, repo, prNumber);
    const status = await this.github.getPullRequestStatus(owner, repo, pr.head.sha);
    const checkRuns = await this.github.getCheckRuns(owner, repo, pr.head.sha);

    let ciState = 'pending';
    if (status.state === 'success' && checkRuns.check_runs.every((c) => c.conclusion === 'success')) {
      ciState = 'success';
    } else if (
      status.state === 'failure' ||
      checkRuns.check_runs.some((c) => c.conclusion === 'failure')
    ) {
      ciState = 'failed';
    }

    return {
      provider: 'github',
      prNumber: pr.number,
      prUrl: pr.html_url,
      state: pr.state,
      merged: pr.merged,
      mergeable: pr.mergeable,
      ciState,
      statusChecks: status.statuses,
      checkRuns: checkRuns.check_runs.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      })),
    };
  }

  async getGitLabMRStatus(repoUrl, mrIid) {
    if (!this.gitlab) {
      throw new Error('GitLab token not configured');
    }

    const { encodedPath } = GitLabClient.parseRepoUrl(repoUrl);
    const mr = await this.gitlab.getMergeRequest(encodedPath, mrIid);
    const pipelines = await this.gitlab.getPipelines(encodedPath, mr.source_branch);

    let ciState = 'pending';
    const latestPipeline = Array.isArray(pipelines) ? pipelines[0] : null;
    if (latestPipeline) {
      if (latestPipeline.status === 'success') {
        ciState = 'success';
      } else if (['failed', 'canceled'].includes(latestPipeline.status)) {
        ciState = 'failed';
      }
    }

    return {
      provider: 'gitlab',
      prNumber: mr.iid,
      prUrl: mr.web_url,
      state: mr.state,
      merged: mr.state === 'merged',
      mergeable: !mr.merge_status || mr.merge_status === 'can_be_merged',
      ciState,
      pipeline: latestPipeline
        ? { id: latestPipeline.id, status: latestPipeline.status, webUrl: latestPipeline.web_url }
        : null,
    };
  }

  async addComment(repoUrl, prNumber, comment, provider = null) {
    const resolvedProvider = detectProvider(repoUrl, provider);

    if (resolvedProvider === 'gitlab') {
      if (!this.gitlab) {
        throw new Error('GitLab token not configured');
      }
      const { encodedPath } = GitLabClient.parseRepoUrl(repoUrl);
      return this.gitlab.addMergeRequestNote(encodedPath, prNumber, comment);
    }

    if (!this.github) {
      throw new Error('GitHub token not configured');
    }
    const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
    return this.github.addPullRequestComment(owner, repo, prNumber, comment);
  }

  async pushCommitToBranch(options) {
    const {
      repoUrl,
      branchName,
      targetFile,
      patch,
      fixedFileContent = null,
      commitMessage,
      provider: explicitProvider,
    } = options;

    const provider = detectProvider(repoUrl, explicitProvider);

    if (provider === 'gitlab') {
      if (!this.gitlab) {
        throw new Error('GitLab token not configured');
      }
      const { encodedPath } = GitLabClient.parseRepoUrl(repoUrl);
      const existingFile = await this.gitlab.getFileContent(encodedPath, targetFile, branchName);
      const newContent = this.resolveFileContent(existingFile, patch, fixedFileContent);

      return this.gitlab.createOrUpdateFile(
        encodedPath,
        targetFile,
        newContent,
        commitMessage,
        branchName,
        existingFile
      );
    }

    if (!this.github) {
      throw new Error('GitHub token not configured');
    }

    const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
    const existingFile = await this.github.getFileContent(owner, repo, targetFile, branchName);
    const newContent = this.resolveFileContent(existingFile, patch, fixedFileContent);

    return this.github.createOrUpdateFile(
      owner,
      repo,
      targetFile,
      newContent,
      commitMessage,
      branchName,
      existingFile?.sha
    );
  }
}

function buildPRBody(description, errorId, analysisId, targetFile, patch) {
  return `## Automated Fix

This PR/MR was automatically generated to fix error #${errorId}.

### Analysis
${description}

### Changes
- Modified: \`${targetFile}\`

### Patch
\`\`\`diff
${patch}
\`\`\`

---
*Generated by Error Auto-Fixer (analysis #${analysisId})*
`;
}

export { GitHubClient } from './github.js';
