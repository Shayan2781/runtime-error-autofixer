// Live demo app: real runtime errors only (no throw, no eval).
import { getItems, calculateTotal, formatUserName } from './utils.js';

export function initApp() {
  document.getElementById('btn-load-dashboard')?.addEventListener('click', () => {
    const apiResponse = undefined;
    const count = getItems(apiResponse);
    document.getElementById('result').textContent = `Items: ${count}`;
  });

  document.getElementById('btn-calculate')?.addEventListener('click', () => {
    const items = [{ price: 10 }, { price: 20 }];
    const total = calculateTotal(items);
    document.getElementById('result').textContent = `Total: $${total}`;
  });

  document.getElementById('btn-profile')?.addEventListener('click', () => {
    const user = { id: 1 };
    const name = formatUserName(user);
    document.getElementById('result').textContent = `Hello, ${name}`;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
