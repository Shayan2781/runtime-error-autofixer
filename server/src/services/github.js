const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT = 30000;

export class GitHubClient {
  constructor(token, logger) {
    this.token = token;
    this.logger = logger;
  }

  /**
   * Make an authenticated request to GitHub API
   */
  async request(method, endpoint, body = null) {
    const url = `${GITHUB_API_BASE}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const options = {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'ErrorFixer-Bot',
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`GitHub API error: ${response.status}`);
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
    const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    const sshMatch = repoUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    throw new Error(`Cannot parse GitHub URL: ${repoUrl}`);
  }

  async getRepo(owner, repo) {
    return this.request('GET', `/repos/${owner}/${repo}`);
  }

  async getRef(owner, repo, branch) {
    return this.request('GET', `/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  }

  async createBranch(owner, repo, branchName, fromSha) {
    return this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    });
  }

  async getFileContent(owner, repo, path, ref = 'main') {
    try {
      const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
      const result = await this.request(
        'GET',
        `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
      );
      return {
        content: Buffer.from(result.content, 'base64').toString('utf-8'),
        sha: result.sha,
      };
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createOrUpdateFile(owner, repo, path, content, message, branch, existingSha = null) {
    const body = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    };

    if (existingSha) {
      body.sha = existingSha;
    }

    return this.request('PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, body);
  }

  async createPullRequest(owner, repo, title, body, head, base) {
    return this.request('POST', `/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      head,
      base,
    });
  }

  async getPullRequest(owner, repo, prNumber) {
    return this.request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  async getPullRequestStatus(owner, repo, ref) {
    try {
      return await this.request('GET', `/repos/${owner}/${repo}/commits/${ref}/status`);
    } catch (error) {
      if (error.status === 404) {
        return { state: 'pending', statuses: [] };
      }
      throw error;
    }
  }

  async getCheckRuns(owner, repo, ref) {
    try {
      return await this.request('GET', `/repos/${owner}/${repo}/commits/${ref}/check-runs`);
    } catch (error) {
      if (error.status === 404) {
        return { total_count: 0, check_runs: [] };
      }
      throw error;
    }
  }

  async updatePullRequest(owner, repo, prNumber, updates) {
    return this.request('PATCH', `/repos/${owner}/${repo}/pulls/${prNumber}`, updates);
  }

  async addPullRequestComment(owner, repo, prNumber, body) {
    return this.request('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      body,
    });
  }
}
