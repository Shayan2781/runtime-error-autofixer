import { request } from './http.js';

export class ErrorFixerClient {
  constructor(options = {}) {
    if (!options.endpoint) {
      throw new Error('[ErrorFixer] endpoint is required');
    }
    if (!options.projectKey) {
      throw new Error('[ErrorFixer] projectKey is required');
    }

    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.projectKey = options.projectKey;
  }

  async uploadSourceMap({ file, version, artifactName, bundleName }) {
    const form = new FormData();
    form.append('file', file, `${bundleName}.map`);
    form.append('projectKey', this.projectKey);
    form.append('version', version);
    form.append('artifactName', artifactName || bundleName);

    return request(`${this.endpoint}/api/v1/sourcemaps`, {
      method: 'POST',
      body: form,
    });
  }

  async analyzeError(errorId) {
    return request(`${this.endpoint}/api/v1/analyze/${errorId}`, {
      method: 'POST',
    });
  }

  async generatePatch(analysisId) {
    return request(`${this.endpoint}/api/v1/analyze/${analysisId}/patch`, {
      method: 'POST',
    });
  }

  async createPullRequest(analysisId) {
    return request(`${this.endpoint}/api/v1/pr/${analysisId}`, {
      method: 'POST',
    });
  }

  async getErrorGroups() {
    return request(`${this.endpoint}/api/v1/errors/groups/${this.projectKey}`);
  }
}

export function createClient(options) {
  return new ErrorFixerClient(options);
}
