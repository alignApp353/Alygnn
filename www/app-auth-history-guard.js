/* Alygnn Android: retain renewable sessions, recover cleanly from revoked sessions.
   Shared by protected pages; never run this script on login pages. */
(function () {
  'use strict';

  const LOGIN = /employer/i.test(location.pathname)
    ? 'app-employer-login.html?logout=1'
    : 'app-login.html?logout=1';
  const SUPABASE_URL = 'https://auth.alygnn.com';
  const SUPABASE_KEY = 'sb_publishable_3l8krRh6WCyvKfNumWDBDw_C6CKr7rG';
  let client = null;
  let pending = null;
  let redirecting = false;

  function tokenKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(key || '')) keys.push(key);
      }
    } catch (_) { return null; }
    return keys;
  }

  function savedSession() {
    const keys = tokenKeys();
    if (keys === null) return {unavailable:true};
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const session = JSON.parse(raw);
        if (session && typeof session === 'object' && session.access_token) {
          return {session};
        }
      } catch (_) {}
    }
    return {missing:true};
  }

  function goToLogin() {
    if (redirecting) return;
    redirecting = true;
    // Leave the data cleanup to Supabase when possible. A missing/revoked
    // session must not be re-opened via the Android Back button.
    try {
      const keys = tokenKeys() || [];
      for (const key of keys) localStorage.removeItem(key);
      localStorage.removeItem('alygnn_account_type');
    } catch (_) {}
    location.replace(LOGIN);
  }

  function authClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return client;
  }

  function isInvalidSession(error) {
    const code = String(error?.code || error?.status || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return code === 'refresh_token_not_found' || code === 'refresh_token_already_used' ||
      code === 'invalid_refresh_token' || code === '400' || code === '401' ||
      /invalid refresh token|refresh token not found|refresh token.*revoked|session.*not found/.test(message);
  }

  async function validate() {
    if (redirecting || pending) return pending;
    const local = savedSession();
    if (local.missing) { goToLogin(); return; }
    if (local.unavailable) return; // Storage blocked: don't destroy a valid session.

    const expiresAt = Number(local.session?.expires_at || 0) * 1000;
    // Don't request a refresh repeatedly when the current access token is healthy.
    if (expiresAt > Date.now() + 2 * 60 * 1000) return;

    const sb = authClient();
    if (!sb) return; // Script may still be loading; re-check on next interval.
    pending = (async () => {
      try {
        // Supabase will refresh a near-expired/expired token if its refresh
        // token remains valid. This does not require user interaction.
        const result = await sb.auth.refreshSession();
        if (result.error) {
          if (isInvalidSession(result.error)) goToLogin();
          else console.warn('Alygnn session renewal temporarily unavailable:', result.error.message);
          return;
        }
        if (!result.data?.session) {
          // An explicit no-session response means authentication cannot continue.
          goToLogin();
        }
      } catch (error) {
        // Offline/network outages are not proof the user signed out.
        console.warn('Alygnn session renewal will retry:', error?.message || error);
      }
    })();
    try { await pending; } finally { pending = null; }
  }

  addEventListener('pagehide', () => { document.documentElement.style.visibility = 'hidden'; });
  addEventListener('pageshow', (event) => {
    if (event.persisted) {
      // Never display a cached account page from an earlier login.
      if (savedSession().missing) goToLogin();
      else location.reload();
      return;
    }
    document.documentElement.style.visibility = '';
    void validate();
  });
  addEventListener('focus', () => { void validate(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void validate();
  });
  // Retain a valid login; check the refresh token only when expiry is near.
  setInterval(() => { void validate(); }, 60000);
})();
