/* Alygnn Android push registration bridge v2 (2026-10-24).
 * Runs only in the Capacitor app. Never displays or sends a token to a diagnostic screen.
 * The backend and database policies remain authoritative for token access.
 */
(function () {
  'use strict';
  if (window.__alygnnPushBridgeV2) return;
  window.__alygnnPushBridgeV2 = true;

  const STORAGE_KEY = 'alygnn_android_fcm_token_v1';
  const CHOICE_PREFIX = 'alygnn_push_choice_v1_';
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
    try { if (typeof workspaceSb !== 'undefined' && workspaceSb?.auth?.getSession) return workspaceSb; } catch (_) {}
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
      if (permission.receive !== 'granted' && force) permission = await plugin.requestPermissions();
      if (permission.receive !== 'granted') {
        report('waiting', 'Push notifications are off. Enable them from notification settings.', 'PERMISSION_DENIED');
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
    enable: () => attemptRegistration(true),
    status: () => ({ ...status })
  };
  const promptEligiblePages = new Set(['app-swipe.html', 'app-employer-dashboard.html', 'app-account.html']);
  let promptBusy = false;
  async function maybeOfferPermission() {
    if (promptBusy || !promptEligiblePages.has(location.pathname.split('/').pop())) return;
    if (!getCapacitor()?.isNativePlatform?.()) return;
    const p = getPlugin(); const client = getDb();
    if (!p || !client) return;
    let userId = '';
    try { userId = (await client.auth.getSession())?.data?.session?.user?.id || ''; }
    catch (_) { return; }
    if (!userId || localStorage.getItem(CHOICE_PREFIX + userId)) return;
    let perm;
    try { perm = await p.checkPermissions(); } catch (_) { return; }
    if (perm?.receive === 'granted') {
      localStorage.setItem(CHOICE_PREFIX + userId, 'allowed');
      attemptRegistration(false).catch(()=>{});
      return;
    }
    if (perm?.receive === 'denied') {
      localStorage.setItem(CHOICE_PREFIX + userId, 'declined');
      return;
    }
    if (document.getElementById('alygnn-permission-modal')) return;
    promptBusy = true;
    const overlay = document.createElement('div');
    overlay.id = 'alygnn-permission-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Enable Alygnn notifications');
    overlay.innerHTML = `<div class="alygnn-permission-card"><div class="alygnn-permission-icon" aria-hidden="true"><svg width="37" height="37" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></div><h2>Stay Updated with Alygnn</h2><p>Get alerts for new messages, application updates, hiring activity and important account information.</p><button type="button" data-action="allow">Allow Notifications</button><button type="button" class="alygnn-not-now" data-action="later">Not Now</button></div>`;
    const style = document.createElement('style');
    style.id = 'alygnn-permission-styles';
    style.textContent = `#alygnn-permission-modal{position:fixed;inset:0;z-index:2147483646;background:rgba(10,20,30,.58);display:flex;align-items:center;justify-content:center;padding:20px;font-family:'DM Sans',sans-serif}#alygnn-permission-modal .alygnn-permission-card{box-sizing:border-box;width:min(100%,380px);padding:30px 24px 22px;border-radius:20px;background:#FCFCFA;color:#1A2530;text-align:center;box-shadow:0 12px 45px #0003}#alygnn-permission-modal h2{font-size:21px;line-height:1.25;margin:12px 0}#alygnn-permission-modal p{font-size:14px;line-height:1.6;color:#4A5968;margin:0 0 25px}#alygnn-permission-modal .alygnn-permission-icon{font-size:34px;color:#5D7FA3}#alygnn-permission-modal button{display:block;width:100%;border:0;border-radius:11px;background:#5D7FA3;color:white;font:600 15px 'DM Sans',sans-serif;padding:15px;cursor:pointer}#alygnn-permission-modal button.alygnn-not-now{margin-top:8px;background:transparent;color:#4A5968}`;
    document.head.append(style);
    document.body.append(overlay);
    const close = choice => {
      localStorage.setItem(CHOICE_PREFIX + userId, choice);
      overlay.remove(); style.remove(); promptBusy = false;
    };
    overlay.querySelector('[data-action="later"]').addEventListener('click', () => close('declined'));
    overlay.querySelector('[data-action="allow"]').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await attemptRegistration(true); close('allowed'); }
      catch (_) { close('allowed'); }
    });
  }
  function refresh() {
    attemptRegistration(false).catch(() => {});
    // Give authenticated pages time to initialize without blocking navigation.
    setTimeout(() => { maybeOfferPermission().catch(()=>{}); }, 1300);
  }
  // Wait for the Capacitor bridge and page-specific authenticated Supabase client.
  // Unlike v1, a missing dependency on the first tick does not permanently disable push.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
