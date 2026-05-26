const GITLAB_API_BASE = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';
const DEFAULT_TIMEOUT = 30000;

export class GitLabClient {
  constructor(token, logger, apiBase = GITLAB_API_BASE) {
    this.token = token;
    this.logger = logger;
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  async request(method, endpoint, body = null) {
    const url = `${this.apiBase}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const options = {
        method,
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`GitLab API error: ${response.status}`);
        error.status = response.status;
        error.body = errorBody;
        throw error;
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static parseRepoUrl(repoUrl) {
    const httpsMatch = repoUrl.match(/gitlab\.com[/:]([^/]+(?:\/[^/]+)+)/);
    if (httpsMatch) {
      const projectPath = httpsMatch[1].replace(/\.git$/, '');
      return { projectPath, encodedPath: encodeURIComponent(projectPath) };
    }

    throw new Error(`Cannot parse GitLab URL: ${repoUrl}`);
  }

  async getProject(encodedPath) {
    return this.request('GET', `/projects/${encodedPath}`);
  }

  async getBranch(encodedPath, branch) {
    try {
      return await this.request('GET', `/projects/${encodedPath}/repository/branches/${encodeURIComponent(branch)}`);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createBranch(encodedPath, branchName, ref) {
    return this.request('POST', `/projects/${encodedPath}/repository/branches`, {
      branch: branchName,
      ref,
    });
  }

  async getFileContent(encodedPath, filePath, ref) {
    try {
      const encodedFile = encodeURIComponent(filePath);
      const result = await this.request(
        'GET',
        `/projects/${encodedPath}/repository/files/${encodedFile}?ref=${encodeURIComponent(ref)}`
      );
      return {
        content: Buffer.from(result.content, 'base64').toString('utf-8'),
        blobId: result.blob_id,
      };
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createOrUpdateFile(encodedPath, filePath, content, message, branch, existing = null) {
    const encodedFile = encodeURIComponent(filePath);
    const endpoint = `/projects/${encodedPath}/repository/files/${encodedFile}`;

    if (existing) {
      return this.request('PUT', endpoint, {
        branch,
        content,
        commit_message: message,
        encoding: 'text',
      });
    }

    return this.request('POST', endpoint, {
      branch,
      content,
      commit_message: message,
      encoding: 'text',
    });
  }

  async createMergeRequest(encodedPath, title, description, sourceBranch, targetBranch) {
    return this.request('POST', `/projects/${encodedPath}/merge_requests`, {
      title,
      description,
      source_branch: sourceBranch,
      target_branch: targetBranch,
    });
  }

  async getMergeRequest(encodedPath, mrIid) {
    return this.request('GET', `/projects/${encodedPath}/merge_requests/${mrIid}`);
  }

  async getPipelines(encodedPath, ref) {
    try {
      return await this.request(
        'GET',
        `/projects/${encodedPath}/pipelines?ref=${encodeURIComponent(ref)}&order_by=updated_at&sort=desc&per_page=1`
      );
    } catch (error) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  async addMergeRequestNote(encodedPath, mrIid, body) {
    return this.request('POST', `/projects/${encodedPath}/merge_requests/${mrIid}/notes`, {
      body,
    });
  }
}
