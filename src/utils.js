// Utility functions with intentional bugs for the live demo.

export function getItems(data) {
  // FIX: Add a null/undefined check for data before accessing its properties.
  if (!data) {
    return 0;
  }
  return data.items.length;
}

export function calculateTotal(items) {
  // BUG: off-by-one - reads items[items.length] which is undefined
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i].price;
  }
  return total;
}

export function formatUserName(user) {
  // BUG: assumes user.profile exists
  return user.profile.name.toUpperCase();
}