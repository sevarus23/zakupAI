(function () {
  'use strict';

  function getToken() {
    return localStorage.getItem(CONFIG.TOKEN_KEY);
  }

  function getUser() {
    var raw = localStorage.getItem(CONFIG.USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveAuth(token, user) {
    localStorage.setItem(CONFIG.TOKEN_KEY, token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem(CONFIG.TOKEN_KEY);
    localStorage.removeItem(CONFIG.USER_KEY);
    window.location.href = '/login.html';
  }

  function isLoggedIn() {
    return !!getToken();
  }

  /**
   * Call on load of any protected page.
   * Redirects to /login.html if no token is present.
   */
  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = '/login.html';
    }
  }

  /**
   * Call on load of admin.html.
   * Redirects to /login.html if not logged in,
   * or to / if logged in but not admin.
   */
  function requireAdmin() {
    if (!isLoggedIn()) {
      window.location.href = '/login.html';
      return;
    }
    var user = getUser();
    if (!user || !user.is_admin) {
      window.location.href = '/';
    }
  }

  window.Auth = {
    getToken: getToken,
    getUser: getUser,
    saveAuth: saveAuth,
    logout: logout,
    isLoggedIn: isLoggedIn,
    requireAuth: requireAuth,
    requireAdmin: requireAdmin,
  };
})();
