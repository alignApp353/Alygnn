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
  const DEVICE_CHOICE_PREFIX = 'alygnn_push_delivery_enabled_v1_';
  function wantsNotifications(userId) {
    try { return localStorage.getItem(DEVICE_CHOICE_PREFIX + userId) !== 'false'; } catch (_) { return true; }
  }
  function storeDeliveryChoice(userId, enabled) {
    try { localStorage.setItem(DEVICE_CHOICE_PREFIX + userId, String(Boolean(enabled))); } catch (_) {}
  }
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
    try { if (window.Alygnn?.sb?.auth?.getSession) return window.Alygnn.sb; } catch (_) {}
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
    const allowed = wantsNotifications(userId);
    const fingerprint = userId + ':' + token + ':' + String(allowed);
    if (fingerprint === lastRegisteredKey) {
      report(allowed ? 'success' : 'disabled', allowed ? 'Push notifications enabled for this device' : 'Push notifications are off for this device', allowed ? 'REGISTERED' : 'USER_DISABLED');
      return;
    }
    report('saving', 'Saving device registration in Supabase', 'SAVING');
    const { error } = await db.from('push_device_tokens').upsert({
      token,
      user_id: userId,
      platform: 'android',
      enabled: allowed,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'token' });
    if (error) {
      const e = errText(error);
      report('error', 'Supabase rejected registration: ' + e.message, e.code || 'SUPABASE_SAVE_FAILED');
      return;
    }
    lastRegisteredKey = fingerprint;
    rememberToken(token);
    report(allowed ? 'success' : 'disabled', allowed ? 'Push notifications enabled for this device' : 'Push notifications are off for this device', allowed ? 'REGISTERED' : 'USER_DISABLED');
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
  // Native notification tap destinations only. No Firebase registration or delivery changes.
  const APPLICANT_DESTINATION = 'app-employer-dashboard.html?view=applicants';
  const APP_ROUTES = new Set([
    'app-chat.html', 'app-messages.html', 'app-applied.html', 'app-account.html',
    'app-swipe.html', 'app-employer-dashboard.html', 'app-employer-billing.html',
    'app-employer-verification-status.html', 'app-employer-team.html',
    'app-employer-account.html', 'app-employer-account-security.html',
    'app-employer-pricing.html'
  ]);
  const safeText = value => String(value == null ? '' : value).trim();
  function workspaceRole() {
    try {
      const active = safeText(sessionStorage.getItem('alygnn_active_mode') ||
        localStorage.getItem('alygnn_active_mode')).toLowerCase();
      if (active === 'candidate' || active === 'employer') return active;
      const account = safeText(localStorage.getItem('alygnn_account_type')).toLowerCase();
      if (account === 'candidate' || account === 'employer') return account;
    } catch (_) {}
    return location.pathname.split('/').pop().startsWith('app-employer-') ? 'employer' : 'candidate';
  }
  function internalAppLink(value) {
    const raw = safeText(value);
    if (!raw || raw.length > 500 || /[\\\x00-\x1f]/.test(raw)) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || url.hash || url.username || url.password) return '';
      const file = url.pathname.split('/').pop();
      if (!APP_ROUTES.has(file) || !/^\/?app-[\w-]+\.html$/.test(url.pathname)) return '';
      if (url.search && !/^\?[a-zA-Z0-9_=&%+.-]{1,250}$/.test(url.search)) return '';
      return file + url.search;
    } catch (_) { return ''; }
  }
  function destinationFromNotice(row, data) {
    const type = safeText(row?.type).toLowerCase();
    const title = safeText(row?.title).toLowerCase();
    const kind = safeText(data?.kind).toLowerCase();
    const category = safeText(data?.category).toLowerCase();
    const role = data?.role === 'employer' || data?.role === 'candidate' ? data.role : workspaceRole();
    if (/new.?applicant|new_?application|application_received|application_withdrawn|applicant_received/.test(type) ||
        category === 'new_applicants' ||
        /new applicant|new application received|candidate applied|application withdrawn/.test(title)) {
      return APPLICANT_DESTINATION;
    }
    if (/verification/.test(type) || /verification (approved|rejected|needs attention)/.test(title)) {
      return 'app-employer-verification-status.html';
    }
    if (/team|invite|member/.test(type) || /team invitation|team member/.test(title)) {
      return 'app-employer-team.html';
    }
    if (/billing|payment|invoice|subscription|plan_status/.test(type) ||
        category === 'billing' || /invoice|payment|subscription|billing/.test(title)) {
      return 'app-employer-billing.html';
    }
    if (/company_update|security_company_status|company_account/.test(type)) {
      return 'app-employer-account.html';
    }
    if (/security|password/.test(type) || kind === 'security' || category === 'security') {
      return role === 'employer' ? 'app-employer-account-security.html' : 'app-account.html';
    }
    if (/job_closed/.test(type)) return 'app-applied.html';
    if (/job_approved|job_rejected|job_slot|slot_expir|job_post|job_review/.test(type) ||
        (/posting|slot/.test(title) && role === 'employer')) {
      return 'app-employer-dashboard.html?view=jobs';
    }
    // Database links identify the intended workspace, including for shared team accounts.
    // Only local app pages are allowed; do not turn database text into an external URL.
    const linked = internalAppLink(row?.link);
    if (linked) return linked;
    if (/application|selected|shortlist|hired|rejected|not_selected/.test(type) ||
        category === 'applications') {
      return role === 'employer' ? APPLICANT_DESTINATION : 'app-applied.html';
    }
    if (kind === 'application' || kind === 'applicant') {
      return role === 'employer' ? APPLICANT_DESTINATION : 'app-applied.html';
    }
    if (kind === 'job' || category === 'job_updates' || category === 'recommendations') {
      return role === 'employer' && category !== 'recommendations'
        ? 'app-employer-dashboard.html?view=jobs' : 'app-swipe.html';
    }
    if (category === 'team_updates') return 'app-employer-account.html';
    return role === 'employer' ? 'app-employer-dashboard.html' : 'app-account.html';
  }
  function safeDestination(data, notification) {
    const info = data && typeof data === 'object' ? data : {};
    if (info.kind === 'message') {
      const role = info.role === 'employer' ? 'employer' :
        info.role === 'candidate' ? 'candidate' : workspaceRole();
      const params = new URLSearchParams({ role });
      if (/^[\w-]{20,50}$/.test(safeText(info.conversation))) {
        params.set('conversation', String(info.conversation));
        if (/^[\w-]{20,50}$/.test(safeText(info.application))) {
          params.set('application', String(info.application));
        }
        return 'app-chat.html?' + params.toString();
      }
      return 'app-messages.html?role=' + role;
    }
    // Used if the database is temporarily unreachable or notification permissions are changing.
    return destinationFromNotice({title:notification?.title || '',type:''}, info);
  }
  async function resolveTappedDestination(notification) {
    const data = notification?.data || {};
    const initial = safeDestination(data, notification);
    if (data?.kind === 'message') return initial;
    const client = db || getDb();
    if (!client?.auth?.getSession) return initial;
    try {
      const { data: sessionResult, error: sessionError } = await client.auth.getSession();
      const userId = sessionResult?.session?.user?.id;
      if (sessionError || !userId) return initial;
      const title = safeText(notification?.title);
      if (!title) return initial;
      const { data: notices, error } = await client.from('notifications')
        .select('id,type,title,body,link,read_at')
        .eq('recipient_id',userId).eq('title',title)
        .order('created_at',{ascending:false}).limit(12);
      if (error || !notices?.length) return initial;
      const body = safeText(notification?.body);
      // Require the exact message to avoid resolving a different notification with the same title.
      const match = notices.find(row => safeText(row.body) === body) || null;
      if (!match) return initial;
      if (!match.read_at) {
        // Best effort; a failed mark-read must never prevent navigation.
        client.from('notifications').update({read_at:new Date().toISOString()})
          .eq('id',match.id).eq('recipient_id',userId).then(()=>{},()=>{});
      }
      return destinationFromNotice(match, data);
    } catch (_) { return initial; }
  }
  // New-applicant pushes open the real All Applicants tab, not the candidate My Jobs page.
  // Uses the existing employer dashboard button, without modifying the dashboard HTML.
  function openRequestedApplicantsView() {
    if (location.pathname.split('/').pop() !== 'app-employer-dashboard.html' ||
        new URLSearchParams(location.search).get('view') !== 'applicants') return;
    let attempts = 0;
    const open = () => {
      const button = document.getElementById('jobs-all-applicants-btn');
      if (document.body?.dataset?.dashboardBooting === 'false' && button) {
        button.click();
        try {
          const url = new URL(location.href);
          url.searchParams.delete('view');
          history.replaceState(null,'',url.pathname + url.search);
        } catch (_) {}
        return;
      }
      if (attempts++ < 60) setTimeout(open,250);
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded',open,{once:true});
    else open();
  }
  openRequestedApplicantsView();
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
    await plugin.addListener('pushNotificationActionPerformed', async event => {
      const notification = event?.notification || null;
      if (!notification) return;
      // Database-backed links identify the exact event; safe fallbacks still work offline.
      // Never keep a cold-started app waiting for a network lookup.
      const fallback = safeDestination(notification.data, notification);
      const dest = await Promise.race([
        resolveTappedDestination(notification),
        new Promise(resolve => setTimeout(() => resolve(fallback), 2200))
      ]);
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
      // A saved opt-out must win over automatic registration on every page.
      if (!wantsNotifications(userId)) {
        report('disabled', 'Push notifications are off for this device', 'USER_DISABLED');
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

  async function devicePreferences() {
    const native = Boolean(getCapacitor()?.isNativePlatform?.());
    if (!native) return { native: false, enabled: false, permission: 'unavailable' };
    const p = getPlugin();
    let permission = 'unknown';
    try { permission = (await p?.checkPermissions?.())?.receive || 'unknown'; } catch (_) {}
    const client = getDb();
    let userId = '';
    try { userId = (await client?.auth?.getSession?.())?.data?.session?.user?.id || ''; } catch (_) {}
    const enabled = Boolean(userId) && wantsNotifications(userId);
    return { native, enabled, permission, ready: permission === 'granted' && enabled, signedIn: Boolean(userId) };
  }
  async function setDeliveryEnabled(enabled) {
    if (!getCapacitor()?.isNativePlatform?.()) throw new Error('Open the installed Alygnn app to manage device notifications.');
    db = db || getDb();
    if (!db) throw new Error('Your account is not ready. Sign in and try again.');
    const userId = await currentUserId();
    if (!userId) throw new Error('Sign in to Alygnn first.');
    if (!enabled) {
      // Server-side enabled=false is authoritative when a sender respects this flag.
      // Persist it BEFORE storing the local preference so a failed write never looks saved.
      const token = currentToken || rememberedToken();
      if (token) {
        const { error } = await db.from('push_device_tokens').upsert({
          token, user_id: userId, platform: 'android', enabled: false,
          last_seen_at: new Date().toISOString()
        }, { onConflict: 'token' });
        if (error) throw new Error('Could not turn off push notifications. Please try again.');
        lastRegisteredKey = userId + ':' + token + ':false';
      }
      storeDeliveryChoice(userId, false);
      report('disabled', 'Push notifications are off for this device', 'USER_DISABLED');
      return devicePreferences();
    }
    const p = getPlugin();
    if (!p) throw new Error('Push notifications are unavailable in this app build.');
    let perm = await p.checkPermissions();
    if (perm?.receive !== 'granted') perm = await p.requestPermissions();
    if (perm?.receive !== 'granted') {
      report('waiting', 'Allow notifications in Android settings to turn on push alerts', 'PERMISSION_DENIED');
      return devicePreferences();
    }
    // A previously registered device already has its Firebase token. Save the
    // enabled=true record before resolving so the screen never reports success
    // while the server still holds an off preference.
    const token = currentToken || rememberedToken();
    if (token) {
      const { error } = await db.from('push_device_tokens').upsert({
        token, user_id: userId, platform: 'android', enabled: true,
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'token' });
      if (error) throw new Error('Could not turn on push notifications. Please try again.');
      storeDeliveryChoice(userId, true);
      lastRegisteredKey = userId + ':' + token + ':true';
      report('success', 'Push notifications enabled for this device', 'REGISTERED');
      return devicePreferences();
    }
    // First-time setup has no saved token yet. Wait until Firebase returns one
    // AND saveToken confirms the server write before completing the action.
    storeDeliveryChoice(userId, true);
    lastRegisteredKey = '';
    lastAttempt = 0;
    try {
      await new Promise(async (resolve, reject) => {
        let done = false;
        const complete = (error) => {
          if (done) return;
          done = true;
          window.removeEventListener('alygnn-push-status', onStatus);
          clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        const onStatus = event => {
          const detail = event.detail || {};
          if (detail.code === 'REGISTERED' && detail.state === 'success') complete();
          else if (detail.state === 'error') complete(new Error('Could not register notifications. Please try again.'));
        };
        const timer = setTimeout(() => complete(new Error('Notification setup did not finish. Please try again.')), 12000);
        window.addEventListener('alygnn-push-status', onStatus);
        try {
          const result = await attemptRegistration(true);
          if (result?.state === 'error') complete(new Error('Could not register notifications. Please try again.'));
        } catch (_) { complete(new Error('Could not register notifications. Please try again.')); }
      });
      return devicePreferences();
    } catch (error) {
      storeDeliveryChoice(userId, false);
      lastRegisteredKey = '';
      report('disabled', 'Push notifications are off for this device', 'USER_DISABLED');
      throw error;
    }
  }
  window.AlygnnPush = {
    check: () => attemptRegistration(false),
    enable: () => setDeliveryEnabled(true),
    disable: () => setDeliveryEnabled(false),
    setEnabled: setDeliveryEnabled,
    getSettings: devicePreferences,
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
