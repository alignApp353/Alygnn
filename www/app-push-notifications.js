/* Alygnn Android push registration bridge v2 (2026-10-24).
 * Runs only in the Capacitor app. Never displays or sends a token to a diagnostic screen.
 * The backend and database policies remain authoritative for token access.
 */
(function () {
  'use strict';
  if (window.__alygnnPushBridgeV2) return;
  window.__alygnnPushBridgeV2 = true;

  const STORAGE_KEY = 'alygnn_android_fcm_token_v1';
  const CHANNEL_ID = 'alygnn_updates';
  let plugin = null;
  let db = null;
  let listenersReady = false;
  let authListenerReady = false;
  let signOutWrapped = false;
  let registering = false;
  let lastAttempt = 0;
  let lastRegisteredKey = '';
  let currentToken = '';
  let signOutInProgress = false;
  const status = { state: 'initializing', message: 'Initializing push notifications', code: '', at: '' };

  function report(state, message, code) {
    status.state = state;
    status.message = String(message || '');
    status.code = String(code || '');
    status.at = new Date().toISOString();
    // No FCM token, user ID, keys, or private data are emitted.
    window.dispatchEvent(new CustomEvent('alygnn-push-status', { detail: { ...status } }));
    if (state === 'error') console.warn('Alygnn push: ' + status.message, status.code);
  }
  function errText(error) {
    // Only share short, safe diagnostic error descriptions, never request headers/keys/tokens.
    const code = String(error?.code || error?.status || '').slice(0, 30);
    let message = String(error?.message || error?.error || 'Unknown error');
    message = message.replace(/(?:eyJ[A-Za-z0-9._-]{30,}|[A-Za-z0-9_-]{90,})/g, '[redacted]');
    return { code, message: message.slice(0, 180) };
  }
  function getCapacitor() { return window.Capacitor || null; }
  function getPlugin() {
    const cap = getCapacitor();
    if (!cap?.isNativePlatform?.()) return null;
    if (cap.Plugins?.PushNotifications) return cap.Plugins.PushNotifications;
    if (typeof cap.registerPlugin === 'function') return cap.registerPlugin('PushNotifications');
    if (typeof cap.nativePromise === 'function') {
      return {
        addListener: (name, callback) => cap.addListener('PushNotifications', name, callback),
        checkPermissions: () => cap.nativePromise('PushNotifications', 'checkPermissions', {}),
        requestPermissions: () => cap.nativePromise('PushNotifications', 'requestPermissions', {}),
        register: () => cap.nativePromise('PushNotifications', 'register', {}),
        createChannel: options => cap.nativePromise('PushNotifications', 'createChannel', options)
      };
    }
    return null;
  }
  function getDb() {
    try { if (typeof sb !== 'undefined' && sb?.auth?.getSession) return sb; } catch (_) {}
    try { if (window.sb?.auth?.getSession) return window.sb; } catch (_) {}
    return null;
  }
  function rememberToken(token) {
    try { localStorage.setItem(STORAGE_KEY, token); } catch (_) {}
  }
  function rememberedToken() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
  }
  function forgetToken() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  async function currentUserId() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    return data?.session?.user?.id || '';
  }
  async function saveToken(token) {
    if (!token) return report('error', 'Firebase did not return a token', 'EMPTY_TOKEN');
    const userId = await currentUserId();
    if (!userId) {
      report('waiting', 'Sign in to Alygnn to register this device', 'NO_SESSION');
      return;
    }
    const fingerprint = userId + ':' + token;
    if (fingerprint === lastRegisteredKey) {
      report('success', 'This Android device is registered in Supabase', 'REGISTERED');
      return;
    }
    report('saving', 'Saving device registration in Supabase', 'SAVING');
    const { error } = await db.from('push_device_tokens').upsert({
      token,
      user_id: userId,
      platform: 'android',
      enabled: true,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'token' });
    if (error) {
      const e = errText(error);
      report('error', 'Supabase rejected registration: ' + e.message, e.code || 'SUPABASE_SAVE_FAILED');
      return;
    }
    lastRegisteredKey = fingerprint;
    rememberToken(token);
    report('success', 'This Android device is registered in Supabase', 'REGISTERED');
  }
  async function onRegistration(event) {
    const token = String(event?.value || '');
    if (!token) return report('error', 'Firebase returned an empty registration token', 'EMPTY_TOKEN');
    currentToken = token;
    try { await saveToken(token); }
    catch (error) { const e = errText(error); report('error', 'Could not save token: ' + e.message, e.code || 'TOKEN_SAVE_FAILED'); }
  }
  async function removeSavedToken() {
    const token = currentToken || rememberedToken();
    if (!token || !db) return;
    try {
      const { error } = await db.from('push_device_tokens').delete().eq('token', token);
      if (error) console.warn('Alygnn push: could not remove token during sign out', error.code || '');
    } catch (_) { /* Signing out must remain possible even during network failures. */ }
    finally { currentToken = ''; lastRegisteredKey = ''; forgetToken(); }
  }
  function protectSignOut() {
    if (signOutWrapped || typeof db?.auth?.signOut !== 'function') return;
    signOutWrapped = true;
    try {
      const original = db.auth.signOut.bind(db.auth);
      db.auth.signOut = async function (options) {
        if (!signOutInProgress) {
          signOutInProgress = true;
          try { await removeSavedToken(); } finally { signOutInProgress = false; }
        }
        return original(options);
      };
    } catch (_) { /* Do not interfere with login/logout if the SDK is immutable. */ }
  }
  function safeDestination(data) {
    if (data?.kind === 'message') {
      const role = data.role === 'employer' ? 'employer' : 'candidate';
      const params = new URLSearchParams({ role });
      if (data.conversation && /^[\w-]{20,50}$/.test(String(data.conversation))) {
        params.set('conversation', String(data.conversation));
        if (data.application && /^[\w-]{20,50}$/.test(String(data.application))) {
          params.set('application', String(data.application));
        }
        return 'app-chat.html?' + params;
      }
      return 'app-messages.html?role=' + role;
    }
    if (data?.kind === 'job') return 'app-swipe.html';
    return null;
  }
  async function ensureListeners() {
    if (listenersReady) return;
    if (!plugin) throw new Error('Native push plugin is not available');
    await plugin.addListener('registration', onRegistration);
    await plugin.addListener('registrationError', error => {
      const e = errText(error);
      report('error', 'Firebase registration failed: ' + e.message, e.code || 'FIREBASE_REGISTRATION_FAILED');
    });
    await plugin.addListener('pushNotificationReceived', () => {
      window.AlygnnRefreshCandidateMessageBadge?.();
    });
    await plugin.addListener('pushNotificationActionPerformed', event => {
      const dest = safeDestination(event?.notification?.data);
      if (dest) window.location.href = dest;
    });
    listenersReady = true;
  }
  function watchAuth() {
    if (authListenerReady) return;
    authListenerReady = true;
    try {
      db.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_IN') {
          // Supabase emits this on refreshed sessions too. Avoid a hot loop.
          lastRegisteredKey = '';
          setTimeout(() => { attemptRegistration(false).catch(() => {}); }, 250);
        }
        if (event === 'SIGNED_OUT') lastRegisteredKey = '';
      });
    } catch (error) { report('error', 'Could not watch login state', 'AUTH_LISTENER'); }
  }
  async function attemptRegistration(force) {
    if (registering) return { ...status };
    if (!force && Date.now() - lastAttempt < 15000) return { ...status };
    registering = true;
    lastAttempt = Date.now();
    try {
      const cap = getCapacitor();
      if (!cap?.isNativePlatform?.()) {
        report('unavailable', 'Push registration is available in the installed Alygnn Android app', 'NOT_NATIVE');
        return { ...status };
      }
      plugin = plugin || getPlugin();
      if (!plugin) {
        report('error', 'Capacitor PushNotifications plugin is missing from this build', 'PLUGIN_MISSING');
        return { ...status };
      }
      db = db || getDb();
      if (!db) {
        report('error', 'Alygnn Supabase client is not ready on this page', 'SUPABASE_NOT_READY');
        return { ...status };
      }
      protectSignOut();
      watchAuth();
      const userId = await currentUserId();
      if (!userId) {
        report('waiting', 'Sign in to Alygnn to register this device', 'NO_SESSION');
        return { ...status };
      }
      await ensureListeners();
      try {
        await plugin.createChannel({ id: CHANNEL_ID, name: 'Alygnn updates',
          description: 'New messages and matching jobs', importance: 4,
          visibility: 1, vibration: true });
      } catch (_) { /* Optional channel settings must not block registration. */ }
      let permission = await plugin.checkPermissions();
      if (permission.receive !== 'granted') permission = await plugin.requestPermissions();
      if (permission.receive !== 'granted') {
        report('error', 'Allow Alygnn notifications in Android Settings', 'PERMISSION_DENIED');
        return { ...status };
      }
      report('registering', 'Requesting a Firebase device token', 'REGISTERING');
      await plugin.register();
      // The token is delivered later through the registration listener.
      return { ...status };
    } catch (error) {
      const e = errText(error);
      report('error', 'Push setup failed: ' + e.message, e.code || 'SETUP_FAILED');
      return { ...status };
    } finally { registering = false; }
  }

  window.AlygnnPush = {
    check: () => attemptRegistration(true),
    status: () => ({ ...status })
  };
  function refresh() { attemptRegistration(false).catch(() => {}); }
  // Wait for the Capacitor bridge and page-specific authenticated Supabase client.
  // Unlike v1, a missing dependency on the first tick does not permanently disable push.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
