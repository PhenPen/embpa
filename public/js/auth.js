// Auth screen logic. Exposes window.Auth with show/hide helpers.

(function () {
  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    const isLogin = mode === 'login';

    document.getElementById('auth-title').textContent = isLogin ? 'Welcome back' : 'Create your account';
    document.getElementById('auth-subtitle').textContent = isLogin
      ? 'Log in to manage your invoices'
      : 'Sign up to start managing invoices';
    document.getElementById('auth-submit').textContent = isLogin ? 'Log In' : 'Sign Up';
    document.getElementById('auth-switch-text').textContent = isLogin
      ? "Don't have an account?"
      : 'Already have an account?';
    document.getElementById('auth-switch-link').textContent = isLogin ? 'Sign up' : 'Log in';
    document.getElementById('auth-error').textContent = '';
  }

  function showAuthScreen() {
    document.getElementById('auth-screen').style.display = 'block';
    document.getElementById('app-screen').style.display = 'none';

    // Close any modals that might be open
    document.querySelectorAll('.modal-overlay.open').forEach((m) => {
      m.classList.remove('open');
    });

    setAuthMode('login');
  }

  function hideAuthScreen() {
    document.getElementById('auth-screen').style.display = 'none';
  }

  // --- Event listeners ---
  document.getElementById('auth-switch-link').onclick = (e) => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  };

  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorDiv = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit');

    errorDiv.textContent = '';

    if (!email || !password) {
      errorDiv.textContent = 'Email and password are required';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = authMode === 'login' ? 'Logging in...' : 'Signing up...';

    try {
      // Note: using plain fetch here, not apiFetch, because a 401 from
      // /auth/login just means "wrong credentials" and we want to show
      // it inline, not redirect.
      const res = await fetch(`/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        errorDiv.textContent = data.error || 'Something went wrong';
        return;
      }

      document.getElementById('auth-password').value = '';
      hideAuthScreen();
      await window.App.start(data.user);
    } catch (err) {
      errorDiv.textContent = 'Network error. Please try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
    }
  };

  // --- Public API ---
  window.Auth = {
    showAuthScreen,
    hideAuthScreen,
  };
})();
