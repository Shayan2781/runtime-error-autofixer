export function createLogger(logEl) {
  return function log(msg, cls = 'info') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.prepend(d);
  };
}

export const PIPELINE_STEPS = {
  idle: 'Waiting for an error…',
  analyze: 'Analyzing error with LLM…',
  patch: 'Generating patch from analysis…',
  pr: 'Creating GitHub pull request…',
  done: 'Pipeline complete.',
  duplicate: 'Fix already generated for this error.',
  error: 'Pipeline failed.',
};

export function setPipelineStatus(el, step, detail = '') {
  if (!el) return;
  const base = PIPELINE_STEPS[step] || step;
  el.textContent = detail ? `${base} ${detail}` : base;
  el.dataset.step = step;
  el.classList.toggle('loading', ['analyze', 'patch', 'pr'].includes(step));
  el.classList.toggle('ok', step === 'done');
  el.classList.toggle('err', step === 'error');
}
