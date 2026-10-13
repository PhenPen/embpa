// Bootstrap: check if the user is logged in, then route to the right screen.

(async function () {
  try {
    const res = await fetch('/auth/me');
    if (res.ok) {
      const { user } = await res.json();
      await window.App.start(user);
      return;
    }
  } catch (err) {
    // Fall through to auth screen
  }

  window.Auth.showAuthScreen();
})();
