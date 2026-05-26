export async function request(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || response.statusText);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}
