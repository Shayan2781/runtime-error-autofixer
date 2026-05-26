import { init, createClient, runAutoFix } from '../../client-sdk/src/index.js';
import { LIVE_DEMO_CONFIG as CFG } from './config.js';
import { createLogger, setPipelineStatus } from './js/demo-ui.js';
import { mountNav } from './js/nav.js';

const client = createClient({
  endpoint: CFG.endpoint,
  projectKey: CFG.projectKey,
});

mountNav(document.getElementById('site-nav'), 'demo');
document.getElementById('dashboard-link').href = CFG.routes.dashboard;

const logEl = document.getElementById('log');
const log = createLogger(logEl);
const pipelineStatusEl = document.getElementById('pipeline-status');
const crashButtons = document.querySelectorAll('button.crash');

let pipelineRunning = false;

function setCrashButtonsDisabled(disabled) {
  crashButtons.forEach((btn) => {
    btn.disabled = disabled;
  });
}

document.getElementById('cfg-project').textContent = CFG.projectKey;
document.getElementById('cfg-release').textContent = CFG.release;

async function uploadSourceMap() {
  try {
    const res = await fetch(CFG.sourceMapUrl);
    if (!res.ok) throw new Error('Run: npm run build:live-demo');
    const blob = await res.blob();

    const data = await client.uploadSourceMap({
      file: blob,
      version: CFG.release,
      artifactName: CFG.bundleName,
      bundleName: CFG.bundleName,
    });

    document.getElementById('cfg-sourcemap').textContent = `uploaded (id ${data.id})`;
    log(`Source map uploaded: ${CFG.bundleName}.map`, 'ok');
  } catch (e) {
    document.getElementById('cfg-sourcemap').textContent = 'failed';
    log(`Source map upload failed: ${e.message}`, 'err');
  }
}

async function startAutoFix(errorId) {
  if (pipelineRunning) {
    log('Pipeline already running - trigger another error after it finishes.', 'warn');
    return;
  }

  pipelineRunning = true;
  setCrashButtonsDisabled(true);
  document.getElementById('val-analysis-id').textContent = '-';
  document.getElementById('val-pr-url').textContent = '-';

  try {
    const result = await runAutoFix(client, errorId, {
      onStep: ({ step, detail }) => {
        setPipelineStatus(pipelineStatusEl, step, detail);
        if (step === 'analyze') log(`Auto: analyzing error #${errorId}…`, 'info');
        if (step === 'patch') log('Auto: generating patch…', 'info');
        if (step === 'pr') log('Auto: creating GitHub PR…', 'info');
      },
    });

    document.getElementById('val-analysis-id').textContent = String(result.analysisId);
    const url = result.prData.prUrl;
    document.getElementById('val-pr-url').innerHTML = url
      ? `<a href="${url}" target="_blank">${url}</a>`
      : '-';

    setPipelineStatus(pipelineStatusEl, 'done');
    const alreadyGenerated =
      result.analyzeData.alreadyGenerated || result.prData.alreadyGenerated;
    const occurrenceNote =
      result.analyzeData.occurrenceCount != null
        ? ` (${result.analyzeData.occurrenceCount} occurrences)`
        : '';

    log(
      alreadyGenerated
        ? `Fix already generated${occurrenceNote} - PR: ${url}`
        : result.prData.cached
          ? `Pipeline done - existing PR: ${url}`
          : `Pipeline done - PR created: ${url}`,
      'ok'
    );
  } catch (e) {
    setPipelineStatus(pipelineStatusEl, 'error', e.message);
    log(`Auto pipeline failed: ${e.message}`, 'err');
  } finally {
    pipelineRunning = false;
    setCrashButtonsDisabled(false);
  }
}

init({
  endpoint: CFG.endpoint,
  projectKey: CFG.projectKey,
  release: CFG.release,
  environment: CFG.environment,
  debug: true,
  onErrorSent(data) {
    document.getElementById('val-error-id').textContent = String(data.id);
    log(`Error captured → server id ${data.id}`, 'ok');
    startAutoFix(data.id);
  },
});

document.getElementById('cfg-sdk').textContent = 'initialized';
log('SDK initialized - click a red button to trigger auto-fix.', 'ok');

await uploadSourceMap();
setPipelineStatus(pipelineStatusEl, 'idle');

const bundle = document.createElement('script');
bundle.src = CFG.bundleUrl;
document.body.appendChild(bundle);
