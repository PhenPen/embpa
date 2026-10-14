// Shared API helper. Wraps fetch to handle auth errors centrally.

(function () {
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      window.Auth.showAuthScreen();
      throw new Error('Session expired');
    }

    return res;
  }

  window.apiFetch = apiFetch;
})();
