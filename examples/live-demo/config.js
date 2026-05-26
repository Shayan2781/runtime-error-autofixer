// Must match the GitHub repo and SQLite project the live demo points at.
export const LIVE_DEMO_BASE = new URL('./', import.meta.url).pathname;

export const LIVE_DEMO_ROUTES = {
  demo: LIVE_DEMO_BASE,
  dashboard: `${LIVE_DEMO_BASE}dashboard/`,
};

export const LIVE_DEMO_CONFIG = {
  base: LIVE_DEMO_BASE,
  routes: LIVE_DEMO_ROUTES,
  endpoint: 'http://localhost:3000',
  projectKey: 'live-demo',
  release: '1.0.0',
  environment: 'demo',
  bundleName: 'app.bundle.js',
  bundleUrl: `${LIVE_DEMO_BASE}dist/app.bundle.js`,
  sourceMapUrl: `${LIVE_DEMO_BASE}dist/app.bundle.js.map`,
  sourceFiles: ['src/utils.js', 'src/app.js'],
};
