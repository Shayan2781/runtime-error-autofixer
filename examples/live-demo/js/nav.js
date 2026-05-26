import { LIVE_DEMO_ROUTES } from '../config.js';

export function mountNav(container, activePage) {
  if (!container) return;

  const links = [
    { id: 'demo', label: 'Demo', href: LIVE_DEMO_ROUTES.demo },
    { id: 'dashboard', label: 'Dashboard', href: LIVE_DEMO_ROUTES.dashboard },
  ];

  container.innerHTML = links
    .map(
      ({ id, label, href }) =>
        `<a href="${href}" class="${id === activePage ? 'active' : ''}">${label}</a>`
    )
    .join('');
}
