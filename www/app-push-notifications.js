/* Alygnn Android push bridge v1. No visual/UI changes.
 * Requires @capacitor/push-notifications 8, native google-services.json,
 * and the push_device_tokens Supabase table/RLS from the accompanying SQL.
 */
(function () {
  'use strict';
  if (window.__alygnnPushInitialized) return;
  window.__alygnnPushInitialized = true;

  // Never trigger a browser push permission prompt on the website.
  const cap = window.Capacitor;
  const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const plugin = cap?.Plugins?.PushNotifications;
  if (!native || !plugin) return;

  let db;
  try { db = typeof sb === 'undefined' ? null : sb; } catch (_) { db = null; }
  if (!db?.auth?.getSession) return;

  const STORAGE_KEY = 'alygnn_android_fcm_token_v1';
  const CHANNEL_ID = 'alygnn_updates';
  let currentUser = '';
  let activeToken = '';
  let registrationStarted = false;
  let registered = false;
  let isSigningOut = false;
  let lastRegisteredKey = '';

  function rememberedToken() { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; } }
  function rememberToken(token) { try { localStorage.setItem(STORAGE_KEY, token); } catch (_) {} }
  function forgetToken() { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }

  async function ensureUser() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    currentUser = data?.session?.user?.id || '';
    return currentUser;
  }

  async function saveToken(token) {
    if (!token || !await ensureUser()) return;
    const key = currentUser + ':' + token;
    if (lastRegisteredKey === key) return;
    const { error } = await db.from('push_device_tokens').upsert({
      token, user_id: currentUser, platform: 'android', enabled: true,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'token' });
    if (error) throw error;
    activeToken = token;
    rememberToken(token);
    lastRegisteredKey = key;
  }

  async function forgetServerToken() {
    const token = activeToken || rememberedToken();
    if (!token) return;
    // Called while the Supabase session is still authenticated.
    try { await db.from('push_device_tokens').delete().eq('token', token); }
    catch (error) { console.warn('Alygnn push token could not be removed', error); }
    activeToken = '';
    lastRegisteredKey = '';
    forgetToken();
  }

  // Ensure sign-out detaches this physical device BEFORE the auth session is cleared.
  // Do not intercept any other authentication methods.
  if (typeof db.auth.signOut === 'function' && !db.auth.__alygnnPushSignOutWrapped) {
    const original = db.auth.signOut.bind(db.auth);
    db.auth.signOut = async function (options) {
      if (!isSigningOut) {
        isSigningOut = true;
        try { await forgetServerToken(); } finally { isSigningOut = false; }
      }
      return original(options);
    };
    db.auth.__alygnnPushSignOutWrapped = true;
  }

  function safeDestination(data) {
    if (data?.kind === 'message') {
      const isEmployer = data.role === 'employer';
      const params = new URLSearchParams({ role: isEmployer ? 'employer' : 'candidate' });
      if (data.conversation && /^[\w-]{20,50}$/.test(String(data.conversation))) {
        params.set('conversation', String(data.conversation));
        if (data.application && /^[\w-]{20,50}$/.test(String(data.application))) {
          params.set('application', String(data.application));
        }
        return 'app-chat.html?' + params;
      }
      return 'app-messages.html?role=' + (isEmployer ? 'employer' : 'candidate');
    }
    if (data?.kind === 'job') return 'app-swipe.html';
    return null;
  }

  async function register() {
    if (registrationStarted) return;
    registrationStarted = true;
    try {
      if (!await ensureUser()) return;
      // Channel id must match the id attached to Android FCM messages.
      try { await plugin.createChannel({ id: CHANNEL_ID, name: 'Alygnn updates',
        description: 'New messages and matching jobs', importance: 4,
        visibility: 1, vibration: true }); } catch (error) {
        console.warn('Alygnn notification channel not available', error);
      }
      const status = await plugin.checkPermissions();
      const permission = status.receive === 'granted'
        ? status : await plugin.requestPermissions();
      if (permission.receive !== 'granted') return;
      await plugin.register();
      registered = true;
    } catch (error) {
      console.warn('Alygnn push setup failed', error);
    } finally { registrationStarted = false; }
  }

  async function onRegistration(event) {
    const token = String(event?.value || '');
    if (!token) return;
    try { await saveToken(token); }
    catch (error) { console.warn('Alygnn could not save device token', error); }
  }

  // Attach listeners before calling register so the first token cannot be missed.
  (async function initialize() {
    try {
      await plugin.addListener('registration', onRegistration);
      await plugin.addListener('registrationError', error => console.warn('Alygnn push registration error', error));
      await plugin.addListener('pushNotificationReceived', () => {
        if (typeof window.AlygnnRefreshCandidateMessageBadge === 'function') {
          window.AlygnnRefreshCandidateMessageBadge();
        }
      });
      await plugin.addListener('pushNotificationActionPerformed', event => {
        const destination = safeDestination(event?.notification?.data);
        if (destination) location.href = destination;
      });
      await register();
      // Re-register after switching user accounts; auth callback should not throw.
      db.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') {
          lastRegisteredKey = '';
          setTimeout(() => { if (registered) plugin.register().catch(() => {}); else register(); }, 100);
        }
        if (event === 'SIGNED_OUT') { currentUser = ''; lastRegisteredKey = ''; }
      });
    } catch (error) { console.warn('Alygnn push listeners unavailable', error); }
  })();
})();
