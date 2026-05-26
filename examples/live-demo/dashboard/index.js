import { createClient } from '../../../client-sdk/src/index.js';
import { LIVE_DEMO_CONFIG as CFG } from '../config.js';
import { mountNav } from '../js/nav.js';

const client = createClient({
  endpoint: CFG.endpoint,
  projectKey: CFG.projectKey,
});

mountNav(document.getElementById('site-nav'), 'dashboard');
document.getElementById('project-key').textContent = CFG.projectKey;

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function renderStats(stats) {
  const el = document.getElementById('stats');
  const items = [
    ['Groups', stats.totalGroups],
    ['Total occurrences', stats.totalOccurrences],
    ['Open', stats.openCount],
    ['Resolved', stats.resolvedCount],
  ];
  el.innerHTML = items
    .map(
      ([label, num]) =>
        `<div class="stat"><div class="num">${num ?? 0}</div><div class="label">${label}</div></div>`
    )
    .join('');
}

function renderRows(groups) {
  const tbody = document.getElementById('rows');
  if (!groups.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="empty">No errors captured yet. Trigger one from the demo.</td></tr>';
    return;
  }

  tbody.innerHTML = groups
    .map(
      (g) => `
        <tr>
          <td>
            <div class="mono">${g.errorType || 'Error'}</div>
            <div class="muted">${g.errorMessage || '-'}</div>
          </td>
          <td><strong>${g.occurrenceCount}</strong></td>
          <td class="muted">${fmtDate(g.firstSeenAt)}</td>
          <td class="muted">${fmtDate(g.lastSeenAt)}</td>
          <td><span class="badge ${g.status}">${g.status}</span></td>
        </tr>`
    )
    .join('');
}

async function loadDashboard() {
  const status = document.getElementById('status');
  try {
    const data = await client.getErrorGroups();
    renderStats(data.stats || {});
    renderRows(data.groups || []);
    status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${data.groups?.length || 0} error groups`;
  } catch (err) {
    status.textContent = `Failed to load: ${err.message}`;
    document.getElementById('rows').innerHTML =
      `<tr><td colspan="5" class="empty">${err.message}</td></tr>`;
  }
}

await loadDashboard();
setInterval(loadDashboard, 15000);
