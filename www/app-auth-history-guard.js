/* Prevent a signed-out or switched account from exposing an older cached WebView page. */
(function () {
  'use strict';
  const login = /employer/i.test(location.pathname) ? 'app-employer-login.html?logout=1' : 'app-login.html?logout=1';
  function hasSessionToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(key || '') && localStorage.getItem(key)) return true;
      }
    } catch (_) { return true; } // Never break a working login if storage is inaccessible.
    return false;
  }
  function check() {
    // On every protected navigation, avoid exposing authenticated screens after sign-out.
    if (!hasSessionToken()) location.replace(login);
  }
  addEventListener('pagehide', function () {
    // A page stored in the back-forward cache must not paint prior-account details.
    document.documentElement.style.visibility = 'hidden';
  });
  addEventListener('pageshow', function (event) {
    if (event.persisted) {
      // Reload to re-fetch authenticated data for the CURRENT account, never the previous one.
      if (!hasSessionToken()) location.replace(login);
      else location.reload();
      return;
    }
    document.documentElement.style.visibility = '';
    check();
  });
})();
