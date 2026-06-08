/* ════════════════════════════════════════════
   FIREBASE INIT
════════════════════════════════════════════ */
/* Guard: if the Firebase CDN didn't load (blocked by a corporate
   firewall / ad-blocker, offline, or an SRI mismatch), `firebase`
   is undefined. Without this guard the next line throws and the
   whole script dies silently — leaving the auth dropdown frozen on
   "— Loading… —". Instead, surface a clear, actionable error. */
if (typeof firebase === 'undefined' || !firebase.initializeApp) {
  document.addEventListener('DOMContentLoaded', () => {
    ['loginEmail', 'registerPerson'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">— Can\u2019t reach Firebase \u2014 check connection / ad-blocker —</option>';
    });
  });
  throw new Error('Firebase SDK failed to load — check network, ad-blocker, or CDN access.');
}

firebase.initializeApp(window.firebaseConfig);
const db          = firebase.firestore();

/* Use the DEFAULT Firestore transport (WebChannel) — no db.settings() override.
   Every other app in this project (todo.js, anmerkung.js, grimoire-core.js)
   uses the default transport and connects reliably on this network, while the
   holiday tracker was the ONLY app carrying an `experimentalAutoDetectLongPolling`
   override AND the only one that hung on a cold page load ("stuck on Loading…").
   Auto-detect fires a transport-probe round-trip before the first read; combined
   with the one-time .get() calls on the cold-start auth path it could stall the
   very first request, which is why a fresh refresh hung while an already-warm
   in-session connection worked. Matching the working apps (plain default) removes
   that probe and fixes the cold-start hang. */
const peopleCol   = db.collection('wmf_holiday_people');
const holidaysCol = db.collection('wmf_holidays');
const vacResetCol = db.collection('wmf_vac_resets');
const activityCol = db.collection('wmf_activity_log');
const pubHolCol   = db.collection('wmf_public_holidays');
const userProfCol = db.collection('wmf_user_profiles');
const settingsCol = db.collection('wmf_settings');

/* ════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════ */
const VACATION_DAYS_PER_YEAR = 12;
const PALETTE = [
  { bg: '#6ee7b7', text: '#0e0f13' }, { bg: '#818cf8', text: '#0e0f13' },
  { bg: '#f59e0b', text: '#0e0f13' }, { bg: '#f87171', text: '#0e0f13' },
  { bg: '#34d399', text: '#0e0f13' }, { bg: '#a78bfa', text: '#0e0f13' },
  { bg: '#fbbf24', text: '#0e0f13' }, { bg: '#60a5fa', text: '#0e0f13' },
];
const LEAVE_TYPE_ICONS = { vacation: '🌴', sick: '🤒', wfh: '🏠', training: '📚', parental: '👶', other: '📌' };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const LOG_META = {
  holiday_add:    { icon: '🌴', cls: 'add',    tag: 'ADDED',   tagColor: 'rgba(110,231,183,0.15)', tagText: 'var(--accent)' },
  holiday_delete: { icon: '🗑', cls: 'delete', tag: 'DELETED', tagColor: 'rgba(248,113,113,0.15)', tagText: 'var(--red)' },
  vac_reset:      { icon: '↺',  cls: 'reset',  tag: 'RESET',   tagColor: 'rgba(245,158,11,0.15)',  tagText: 'var(--accent2)' },
  person_add:     { icon: '➕', cls: 'person', tag: 'NEW',     tagColor: 'rgba(129,140,248,0.15)', tagText: 'var(--accent3)' },
  person_remove:  { icon: '➖', cls: 'person', tag: 'REMOVED', tagColor: 'rgba(248,113,113,0.15)', tagText: 'var(--red)' },
};

/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
let currentUser    = null;
let appStarted     = false;
let people         = [];
let holidays       = [];
let vacResets      = [];
let publicHolidays = [];
let userProfiles   = [];
let teamSettings   = { capacityThreshold: 0, departments: [] };
let viewYear       = new Date().getFullYear();
let viewMonth      = new Date().getMonth();
let currentView    = 'calendar';
let deptFilter     = localStorage.getItem('ht_dept_filter') || '';

let _pubHolSetCache  = null;
let _vacUsedCache    = {};
let _renderScheduled = false;

function bustCaches() {
  _pubHolSetCache = null;
  _vacUsedCache   = {};
}

/* ════════════════════════════════════════════
   SIMPLE AUTH
════════════════════════════════════════════ */
function makeUid(name) {
  return name.toLowerCase().replace(/\s+/g, '_') + '_' + btoa(name).slice(0, 6);
}
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + 'grimoire_salt'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function saveSession(profile) { localStorage.setItem('ht_session', JSON.stringify(profile)); }
function loadSession() { try { return JSON.parse(localStorage.getItem('ht_session')); } catch { return null; } }
function clearSession() { localStorage.removeItem('ht_session'); }

/* Reject a hanging promise after `ms` so a stuck Firestore read can never
   leave the UI frozen forever. Resolves/rejects with the underlying promise
   if it settles first. */
function withTimeout(promise, ms = 12000, label = 'Request') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + ' timed out. Check your connection and retry.')), ms)
    )
  ]);
}

/* ─────────────────────────────────────────
   FIX 1: initAuth — clear stale session on
   any Firestore error instead of silently
   swallowing it and leaving the UI stuck.
───────────────────────────────────────── */
async function initAuth() {
  const session = loadSession();
  if (session) {
    try {
      const snap = await withTimeout(userProfCol.doc(session.uid).get(), 12000, 'Sign-in check');
      if (snap.exists) {
        currentUser = { uid: session.uid, ...snap.data() };
        showApp();
        return;
      }
    } catch(e) {
      // Network/Firestore error or timeout — clear stale session and fall
      // through to the auth gate instead of hanging on a blank screen.
      clearSession();
    }
  }
  showAuthGate();
}

function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('mainApp').style.display  = '';
  saveSession(currentUser);
  updateUserChip();
  updateAdminUI();
  const wrap = document.getElementById('deptFilterWrap');
  if (wrap) wrap.classList.toggle('active', !!deptFilter);
  if (!appStarted) { appStarted = true; startListeners(); startLogListener(); }
}
function showAuthGate() {
  currentUser = null;
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('mainApp').style.display  = 'none';
  loadPeopleForAuth();
}

/* NOTE: initAuth() is intentionally invoked at the very BOTTOM of this file,
   not here. On the logged-out path initAuth() runs fully synchronously
   (no await executes) straight into loadPeopleForAuth(), which reads the
   `let _authLoadInFlight` / `_authLoadRetried` state declared further down.
   Calling it here accessed those `let` bindings before their declaration ran
   → Temporal Dead Zone "Cannot access '_authLoadInFlight' before
   initialization", which killed the script and froze the dropdown on
   "Loading…". Deferring the call until after all top-level declarations are
   initialized avoids the TDZ. The script is loaded at the end of <body>, so
   the DOM is already parsed by then. */

function switchAuthTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginPanel').style.display    = tab === 'login' ? '' : 'none';
  document.getElementById('registerPanel').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('authSubtitle').textContent    = tab === 'login' ? 'SIGN IN TO YOUR ACCOUNT' : 'CREATE YOUR ACCOUNT';
  clearAuthErrors();
}

function showAuthError(id, msg) {
  const el = document.getElementById(id); el.textContent = msg; el.classList.add('show');
}
function clearAuthErrors() {
  ['loginError','registerError'].forEach(id => {
    const el = document.getElementById(id); el.textContent = ''; el.classList.remove('show');
  });
}
function setAuthLoading(btnId, spinnerId, loading) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(spinnerId).style.display = loading ? 'inline-block' : 'none';
}

/* ─────────────────────────────────────────
   FIX 2: loadPeopleForAuth — in-flight guard
   prevents race condition when the user
   switches tabs rapidly, and the catch block
   resets any stuck loading state.
───────────────────────────────────────── */
let _authLoadInFlight = false;
let _authLoadRetried  = false;
async function loadPeopleForAuth() {
  if (_authLoadInFlight) return;
  _authLoadInFlight = true;

  const loginSel = document.getElementById('loginEmail');
  const regSel   = document.getElementById('registerPerson');
  loginSel.innerHTML = regSel.innerHTML = '<option value="">— Loading… —</option>';

  try {
    const [peopleSnap, profSnap] = await withTimeout(Promise.all([
      peopleCol.orderBy('name').get(),
      userProfCol.get()
    ]), 12000, 'Loading team');
    const linkedIds = new Set(profSnap.docs.map(d => d.data().personId));

    loginSel.innerHTML = '<option value="">— Select your name —</option>';
    regSel.innerHTML   = '<option value="">— Select your name —</option>';

    peopleSnap.docs.forEach(d => {
      const opt = `<option value="${d.id}">${d.data().name} (${d.data().dept})</option>`;
      if ( linkedIds.has(d.id)) loginSel.insertAdjacentHTML('beforeend', opt);
      if (!linkedIds.has(d.id)) regSel.insertAdjacentHTML('beforeend', opt);
    });

    if (loginSel.options.length === 1)
      loginSel.innerHTML = '<option value="">— No accounts yet — register first —</option>';
    if (regSel.options.length === 1)
      regSel.innerHTML   = '<option value="">— All members have accounts —</option>';

  } catch(e) {
    loginSel.innerHTML = regSel.innerHTML =
      '<option value="">— Couldn\u2019t load \u2014 retrying\u2026 —</option>';
    // Ensure buttons aren't stuck disabled if this was called during a login attempt
    setAuthLoading('loginBtn',    'loginSpinner',    false);
    setAuthLoading('registerBtn', 'registerSpinner', false);
    // One-shot auto-retry to recover from a transient hang/timeout without
    // forcing the user to manually refresh the page.
    if (!_authLoadRetried) {
      _authLoadRetried = true;
      _authLoadInFlight = false;
      setTimeout(loadPeopleForAuth, 2500);
      return;
    }
    loginSel.innerHTML = regSel.innerHTML =
      '<option value="">— Error loading \u2014 refresh to retry —</option>';
  } finally {
    _authLoadInFlight = false;
  }
}

/* ─────────────────────────────────────────
   FIX 3: doLogin — validation now runs BEFORE
   setAuthLoading so early-return paths don't
   leave the button permanently disabled.
   finally only resets UI if still on auth gate
   (i.e. login didn't succeed and hide it).
───────────────────────────────────────── */
async function doLogin() {
  clearAuthErrors();
  const personId = document.getElementById('loginEmail').value.trim();
  const pw       = document.getElementById('loginPassword').value;

  if (!personId || !pw) {
    showAuthError('loginError', 'Enter your name and password.');
    return;
  }

  setAuthLoading('loginBtn', 'loginSpinner', true);
  try {
    const hash = await hashPassword(pw);
    const snap = await userProfCol
      .where('personId', '==', personId)
      .where('passwordHash', '==', hash)
      .get();
    if (snap.empty) {
      showAuthError('loginError', 'Incorrect name selection or password.');
      return;
    }
    const doc = snap.docs[0];
    currentUser = { uid: doc.id, ...doc.data() };
    showApp();
  } catch(e) {
    showAuthError('loginError', e.message);
  } finally {
    // Only reset if auth gate is still visible (success hides it)
    if (document.getElementById('authGate').style.display !== 'none') {
      setAuthLoading('loginBtn', 'loginSpinner', false);
    }
  }
}

/* ─────────────────────────────────────────
   FIX 4: doRegister — same pattern as doLogin.
   Validation before setAuthLoading, finally
   guarded by gate visibility check.
───────────────────────────────────────── */
async function doRegister() {
  clearAuthErrors();
  const personId = document.getElementById('registerPerson').value;
  const pw       = document.getElementById('registerPassword').value;
  const pw2      = document.getElementById('registerConfirm').value;

  if (!personId)     { showAuthError('registerError', 'Select your name.');                    return; }
  if (pw.length < 6) { showAuthError('registerError', 'Password must be at least 6 characters.'); return; }
  if (pw !== pw2)    { showAuthError('registerError', 'Passwords do not match.');               return; }

  setAuthLoading('registerBtn', 'registerSpinner', true);
  try {
    const [existing, personSnap] = await Promise.all([
      userProfCol.where('personId','==',personId).get(),
      peopleCol.doc(personId).get()
    ]);
    if (!existing.empty)    { showAuthError('registerError', 'This person already has an account.'); return; }
    if (!personSnap.exists) { showAuthError('registerError', 'Person not found.');                   return; }

    const displayName = personSnap.data().name;
    const uid  = makeUid(displayName);
    const hash = await hashPassword(pw);
    await userProfCol.doc(uid).set({
      personId, displayName, isAdmin: false, passwordHash: hash,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    currentUser = { uid, personId, displayName, isAdmin: false };
    showApp();
  } catch(e) {
    showAuthError('registerError', e.message);
  } finally {
    if (document.getElementById('authGate').style.display !== 'none') {
      setAuthLoading('registerBtn', 'registerSpinner', false);
    }
  }
}

async function doSignOut()       { closeProfileModal(); clearSession(); showAuthGate(); showToast('Signed out.'); }

/* ─────────────────────────────────────────
   FIX 5: doChangePassword — added loading
   state so the button doesn't stay clickable
   / visually frozen during the Firestore call.
───────────────────────────────────────── */
async function doChangePassword() {
  const pw1 = document.getElementById('newPw1').value;
  const pw2 = document.getElementById('newPw2').value;
  const err = document.getElementById('pwChangeError');
  err.textContent = ''; err.classList.remove('show');

  if (!pw1)          { err.textContent = 'Enter a new password.';  err.classList.add('show'); return; }
  if (pw1.length < 6){ err.textContent = 'Min 6 characters.';      err.classList.add('show'); return; }
  if (pw1 !== pw2)   { err.textContent = 'Passwords do not match.';err.classList.add('show'); return; }

  // Target the Update Password button inside the profile modal
  const btn = document.querySelector('#profileModal .btn-primary');
  if (btn) btn.disabled = true;
  try {
    const hash = await hashPassword(pw1);
    await userProfCol.doc(currentUser.uid).update({ passwordHash: hash });
    closeProfileModal();
    showToast('Password updated!');
  } catch(e) {
    err.textContent = e.message;
    err.classList.add('show');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ════════════════════════════════════════════
   PERMISSION HELPERS
════════════════════════════════════════════ */
const isAdmin    = ()           => !!(currentUser && currentUser.isAdmin);
const myPersonId = ()           => currentUser ? currentUser.personId : null;
const canEdit    = personId     => isAdmin() || personId === myPersonId();
const canDelete  = holiday      => isAdmin() || holiday.personId === myPersonId();

/* ════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════ */
function setStatus(cls, label) {
  document.getElementById('statusDot').className = 'status-dot ' + (cls || '');
  document.getElementById('statusLabel').textContent = label;
}
function showSaving(on) { document.getElementById('savingIndicator').style.display = on ? 'inline-flex' : 'none'; }

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'error-toast show' : 'show';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = ''; }, 2500);
}

function scheduleRender() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => { _renderScheduled = false; render(); });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeLog(); return;
  }
  const tag = document.activeElement.tagName.toLowerCase();
  if ((e.key === 'n' || e.key === 'N') && tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
    if (document.querySelector('.modal-overlay.open') || !currentUser) return;
    openAddModal();
  }
});

/* ════════════════════════════════════════════
   VIEW
════════════════════════════════════════════ */
function setView(v) {
  currentView = v;
  document.getElementById('viewCalBtn').classList.toggle('active', v === 'calendar');
  document.getElementById('viewGanttBtn').classList.toggle('active', v === 'gantt');
  document.getElementById('calendarView').style.display = v === 'calendar' ? '' : 'none';
  document.getElementById('ganttView').style.display    = v === 'gantt' ? '' : 'none';
  render();
}

/* ════════════════════════════════════════════
   ACTIVITY LOG
════════════════════════════════════════════ */
async function writeLog(action, message, meta) {
  try {
    await activityCol.add({
      action, message, meta: meta || {},
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      byUid:  currentUser ? currentUser.uid : null,
      byName: currentUser ? currentUser.displayName : null
    });
  } catch(e) {}
}

let activityLogs = [], logFilter = 'all', logUnreadCount = 0, logOpen = false;

function startLogListener() {
  activityCol.orderBy('ts','desc').limit(100).onSnapshot(snap => {
    activityLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('logCount').textContent = activityLogs.length + ' entries';
    if (!logOpen && snap.docChanges().some(c => c.type === 'added')) {
      logUnreadCount++;
      document.getElementById('logUnreadDot').classList.add('visible');
    }
    if (logOpen) renderLogEntries();
  }, () => {});
}

function openLog() {
  logUnreadCount = 0; logOpen = true;
  document.getElementById('logUnreadDot').classList.remove('visible');
  document.getElementById('logDrawer').classList.add('open');
  document.getElementById('logBackdrop').classList.add('open');
  renderLogEntries();
}
function closeLog() {
  logOpen = false;
  document.getElementById('logDrawer').classList.remove('open');
  document.getElementById('logBackdrop').classList.remove('open');
}
function setLogFilter(filter, btn) {
  logFilter = filter;
  document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLogEntries();
}

function fmtLogTime(ts) {
  if (!ts) return 'just now';
  const d    = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60)   + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600)  + 'h ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
       + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderLogEntries() {
  const body = document.getElementById('logBody');
  const display = logFilter === 'person'
    ? activityLogs.filter(l => l.action === 'person_add' || l.action === 'person_remove')
    : logFilter === 'all' ? activityLogs : activityLogs.filter(l => l.action === logFilter);
  document.getElementById('logCount').textContent = display.length + ' of ' + activityLogs.length + ' entries';
  if (!display.length) { body.innerHTML = '<div class="log-loading">No entries for this filter</div>'; return; }

  const parts = display.map(log => {
    const m = LOG_META[log.action] || { icon: '📌', cls: 'add', tag: log.action, tagColor: 'rgba(110,231,183,0.1)', tagText: 'var(--accent)' };
    const byTag = log.byName ? `<span style="color:var(--text-muted);font-size:0.58rem;"> · ${log.byName}</span>` : '';
    return `<div class="log-entry">
      <div class="log-icon ${m.cls}">${m.icon}</div>
      <div class="log-content">
        <div class="log-msg">${log.message}<span class="log-action-tag" style="background:${m.tagColor};color:${m.tagText};">${m.tag}</span>${byTag}</div>
        <div class="log-time">${fmtLogTime(log.ts)}</div>
      </div>
    </div>`;
  });
  body.innerHTML = parts.join('');
}

/* ════════════════════════════════════════════
   FIRESTORE LISTENERS
════════════════════════════════════════════ */
function startListeners() {
  setStatus('', 'Connecting...');

  peopleCol.orderBy('name').onSnapshot(snap => {
    people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bustCaches(); scheduleRender();
    setStatus('online', 'Online');
    updateDeptFilterOptions();
    updateDeptDatalists();
    if (document.getElementById('manageModal').classList.contains('open')) {
      renderPeopleList();
      renderDeptManager();
    }
  }, err => { setStatus('error', 'Error'); showToast('Connection error: ' + err.message, true); });

  holidaysCol.orderBy('start').onSnapshot(snap => {
    holidays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bustCaches(); scheduleRender();
  }, err => { showToast('Sync error: ' + err.message, true); });

  vacResetCol.onSnapshot(snap => {
    vacResets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bustCaches(); scheduleRender();
  }, () => {});

  pubHolCol.orderBy('date').onSnapshot(snap => {
    publicHolidays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bustCaches(); scheduleRender();
  }, () => {});

  userProfCol.onSnapshot(snap => {
    userProfiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    if (document.getElementById('manageModal').classList.contains('open')) renderPeopleList();
  }, () => {});

  settingsCol.doc('team').onSnapshot(snap => {
    teamSettings = snap.exists
      ? { capacityThreshold: 0, departments: [], ...snap.data() }
      : { capacityThreshold: 0, departments: [] };
    if (!Array.isArray(teamSettings.departments)) teamSettings.departments = [];
    const thrInput = document.getElementById('capacityThreshold');
    if (thrInput && document.activeElement !== thrInput) thrInput.value = teamSettings.capacityThreshold || '';
    updateDeptFilterOptions();
    updateDeptDatalists();
    if (document.getElementById('manageModal').classList.contains('open')) renderDeptManager();
    scheduleRender();
  }, () => {});
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
function pubHolSet() {
  if (!_pubHolSetCache) _pubHolSetCache = new Set(publicHolidays.map(ph => ph.date));
  return _pubHolSetCache;
}

function holidaysOnDate(iso) {
  return holidays.filter(h => h.start <= iso && h.end >= iso);
}

function getColor(personId) {
  const idx = people.findIndex(p => p.id === personId);
  return PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length];
}
function initials(name) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function fmtDate(s) { return parseDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function getPerson(id) { return people.find(p => p.id === id); }
function getPersonName(id) { const p = getPerson(id); return p ? p.name : 'Unknown'; }
function publicHolOnDate(iso) { return publicHolidays.find(ph => ph.date === iso); }
function isWeekday(dateObj) { const d = dateObj.getDay(); return d !== 0 && d !== 6; }
function isWeekendIso(iso) { const d = parseDate(iso).getDay(); return d === 0 || d === 6; }

function countWeekdays(startIso, endIso) {
  const s = parseDate(startIso), e = parseDate(endIso);
  if (s > e) return 0;
  const phSet = pubHolSet();
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    if (isWeekday(cur) && !phSet.has(dateStr(cur))) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function countWeekdaysInYear(startIso, endIso, year) {
  const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
  const clampStart = startIso > yStart ? startIso : yStart;
  const clampEnd   = endIso   < yEnd   ? endIso   : yEnd;
  if (clampStart > clampEnd) return 0;
  return countWeekdays(clampStart, clampEnd);
}

function entryDays(h) {
  if (h.halfDay) {
    if (isWeekendIso(h.start) || pubHolSet().has(h.start)) return 0;
    return 0.5;
  }
  return countWeekdays(h.start, h.end);
}

/* ════════════════════════════════════════════
   VACATION UTILS
════════════════════════════════════════════ */
function vacUsedByYear(personId, year) {
  const key = `${personId}:${year}`;
  if (_vacUsedCache[key] !== undefined) return _vacUsedCache[key];

  const phSet = pubHolSet();
  let total = 0;
  for (const h of holidays) {
    if (h.personId !== personId || h.type !== 'vacation') continue;
    if (h.halfDay) {
      if (h.start >= `${year}-01-01` && h.start <= `${year}-12-31`
          && !isWeekendIso(h.start) && !phSet.has(h.start)) total += 0.5;
    } else {
      total += countWeekdaysInYear(h.start, h.end, year);
    }
  }
  _vacUsedCache[key] = total;
  return total;
}

function vacResetBonus(personId, year) {
  const rec = vacResets.find(r => r.personId === personId && r.year === year);
  return rec ? (rec.resetDays || 0) : 0;
}
function vacAllotment(personId, year) { return VACATION_DAYS_PER_YEAR + vacResetBonus(personId, year); }
function vacRemaining(personId, year) { return vacAllotment(personId, year) - vacUsedByYear(personId, year); }

function getConflicts(personId, start, end, excludeId) {
  return holidays.filter(h => h.id !== excludeId && h.personId === personId && h.start <= end && h.end >= start);
}

function fmtDays(n) { return n % 1 !== 0 ? n.toFixed(1) : String(n); }

/* ════════════════════════════════════════════
   DEPARTMENTS + FILTER
════════════════════════════════════════════ */
function effectiveDepartments() {
  const set = new Set();
  (teamSettings.departments || []).forEach(d => { if (d) set.add(d); });
  people.forEach(p => { if (p.dept) set.add(p.dept); });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function passDeptFilter(personId) {
  if (!deptFilter) return true;
  const p = getPerson(personId);
  return p ? p.dept === deptFilter : false;
}

function setDeptFilter(val) {
  deptFilter = val || '';
  if (deptFilter) localStorage.setItem('ht_dept_filter', deptFilter);
  else            localStorage.removeItem('ht_dept_filter');
  document.getElementById('deptFilterWrap').classList.toggle('active', !!deptFilter);
  scheduleRender();
}

function updateDeptFilterOptions() {
  const sel = document.getElementById('deptFilter');
  if (!sel) return;
  const depts = effectiveDepartments();
  const current = deptFilter;
  if (current && !depts.includes(current)) {
    deptFilter = '';
    localStorage.removeItem('ht_dept_filter');
  }
  sel.innerHTML = '<option value="">All</option>' +
    depts.map(d => `<option value="${d}"${d === deptFilter ? ' selected' : ''}>${d}</option>`).join('');
  sel.value = deptFilter;
  document.getElementById('deptFilterWrap').classList.toggle('active', !!deptFilter);
}

function updateDeptDatalists() {
  const depts = effectiveDepartments();
  const opts = depts.map(d => `<option value="${d}">`).join('');
  ['newPersonDeptOptions', 'editPersonDeptOptions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}

/* ════════════════════════════════════════════
   RENDER ORCHESTRATOR
════════════════════════════════════════════ */
function render() {
  renderStats();
  if (currentView === 'calendar') renderCalendar();
  else renderGantt();
  renderVacBalance();
  renderAway();
  renderAllList();
  renderLegend();
  updateUserChip();
}

function updateUserChip() {
  if (!currentUser) return;
  const color = getColor(currentUser.personId);
  const av = document.getElementById('userChipAvatar');
  av.style.background = color.bg;
  av.style.color = color.text;
  av.textContent = initials(currentUser.displayName);
  document.getElementById('userChipName').textContent = currentUser.displayName.split(' ')[0];
  document.getElementById('userChipCrown').style.display = currentUser.isAdmin ? 'inline' : 'none';
}
function updateAdminUI() {
  const admin = isAdmin();
  document.getElementById('pubHolBtn').style.display = admin ? '' : 'none';
  document.getElementById('manageBtn').style.display  = admin ? '' : 'none';
}

/* ════════════════════════════════════════════
   STATS
════════════════════════════════════════════ */
function renderStats() {
  const today = dateStr(new Date());
  const visiblePeople = deptFilter ? people.filter(p => p.dept === deptFilter) : people;
  const awayToday = new Set(
    holidaysOnDate(today).filter(h => passDeptFilter(h.personId)).map(h => h.personId)
  ).size;
  const monthKey = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
  const thisMonth = holidays.filter(h =>
    passDeptFilter(h.personId) &&
    (h.start.slice(0,7) === monthKey || h.end.slice(0,7) === monthKey)
  ).length;
  const teamLabel = deptFilter ? `${deptFilter}` : 'Team Members';
  document.getElementById('statsRow').innerHTML =
    `<div class="stat-box"><div class="stat-num">${visiblePeople.length}</div><div class="stat-label">${teamLabel}</div></div>
     <div class="stat-box"><div class="stat-num" style="color:var(--accent2)">${awayToday}</div><div class="stat-label">Away Today</div></div>
     <div class="stat-box"><div class="stat-num" style="color:var(--accent3)">${thisMonth}</div><div class="stat-label">This Month</div></div>`;
}

/* ════════════════════════════════════════════
   CALENDAR DRAG
════════════════════════════════════════════ */
let dragStart = null, dragEnd = null, isDragging = false;

function startDrag(iso) { isDragging = true; dragStart = iso; dragEnd = iso; highlightDrag(); }
function updateDrag(iso) { if (!isDragging) return; dragEnd = iso; highlightDrag(); }
function endDrag(iso) {
  if (!isDragging) return;
  isDragging = false; dragEnd = iso; highlightDrag();
  const [s, e] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart];
  document.getElementById('formStart').value = s;
  document.getElementById('formEnd').value   = e;
  if (!document.getElementById('addModal').classList.contains('open')) openAddModal(true);
  else { updateVacWarning(); updateConflictWarn(); updateWeekendWarn(); }
}
function highlightDrag() {
  if (!dragStart || !dragEnd) return;
  const [s, e] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart];
  document.querySelectorAll('.day-cell[data-iso]').forEach(cell => {
    const iso = cell.dataset.iso;
    cell.classList.remove('drag-range','drag-start','drag-end');
    if (iso === s)               cell.classList.add('drag-start');
    else if (iso === e)          cell.classList.add('drag-end');
    else if (iso > s && iso < e) cell.classList.add('drag-range');
  });
}

/* ════════════════════════════════════════════
   CALENDAR RENDER
════════════════════════════════════════════ */
function renderCalendar() {
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const firstDay   = new Date(viewYear, viewMonth, 1);
  let startDow = firstDay.getDay(); startDow = startDow === 0 ? 6 : startDow - 1;
  const daysInMonth     = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const today  = dateStr(new Date());
  const phSet  = pubHolSet();
  const mPad   = String(viewMonth + 1).padStart(2, '0');

  const monthStart = `${viewYear}-${mPad}-01`;
  const monthEnd   = `${viewYear}-${mPad}-${String(daysInMonth).padStart(2, '0')}`;

  const byDay = {};
  for (const h of holidays) {
    if (h.end < monthStart || h.start > monthEnd) continue;
    if (!passDeptFilter(h.personId)) continue;
    const clampStart = h.start < monthStart ? monthStart : h.start;
    const clampEnd   = h.end   > monthEnd   ? monthEnd   : h.end;
    const cur = new Date(parseDate(clampStart));
    const end = parseDate(clampEnd);
    while (cur <= end) {
      const iso = dateStr(cur);
      (byDay[iso] ??= []).push(h);
      cur.setDate(cur.getDate() + 1);
    }
  }

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--)
    cells.push({ day: daysInPrevMonth - i, month: viewMonth - 1, year: viewYear, other: true });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, month: viewMonth, year: viewYear, other: false });
  const rem = 42 - cells.length;
  for (let d = 1; d <= rem; d++)
    cells.push({ day: d, month: viewMonth + 1, year: viewYear, other: true });

  const grid = document.getElementById('daysGrid');
  const frag = document.createDocumentFragment();

  cells.forEach(({ day, month, year, other }) => {
    let mo = month, yr = year;
    if (mo < 0)  { mo = 11; yr--; }
    if (mo > 11) { mo = 0;  yr++; }
    const iso    = `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const hs     = byDay[iso] || [];
    const isToday = iso === today;
    const pubHol  = phSet.has(iso) ? publicHolidays.find(ph => ph.date === iso) : null;
    const dow     = parseDate(iso).getDay();
    const isWknd  = dow === 0 || dow === 6;

    const cell = document.createElement('div');
    cell.className = ['day-cell', other?'other-month':'', isToday?'today':'', hs.length?'has-holiday':'', pubHol?'public-holiday':'', isWknd?'weekend':''].filter(Boolean).join(' ');
    cell.dataset.iso = iso;

    cell.addEventListener('mousedown', e => { e.preventDefault(); startDrag(iso); });
    cell.addEventListener('mouseover', () => updateDrag(iso));
    cell.addEventListener('mouseup',   () => endDrag(iso));
    cell.addEventListener('click',     () => { if (dragStart !== dragEnd) return; selectDate(iso); });

    let pillsHtml = '';
    hs.slice(0, 3).forEach(h => {
      const color = getColor(h.personId);
      const name  = getPersonName(h.personId).split(' ')[0];
      const halfTag = h.halfDay ? `<span style="opacity:0.6;">${h.halfDayPart||''}</span>` : '';
      pillsHtml += `<div class="holiday-pill" style="background:${color.bg};color:${color.text};">${name}${halfTag}</div>`;
    });
    if (hs.length > 3) pillsHtml += `<div class="holiday-pill" style="background:var(--surface3);color:var(--text-muted);">+${hs.length-3}</div>`;

    const pubHolLabel = pubHol  ? `<div class="public-holiday-label">${pubHol.name}</div>` : '';
    const wkndLabel   = isWknd && !other ? `<div class="weekend-label">${dow===6?'SAT':'SUN'}</div>` : '';
    cell.innerHTML = `<div class="day-num">${day}</div><div class="holiday-dots">${pillsHtml}</div>${pubHolLabel}${wkndLabel}`;

    frag.appendChild(cell);
  });

  grid.innerHTML = '';
  grid.appendChild(frag);

  document.addEventListener('mouseup', () => { if (isDragging) endDrag(dragEnd); }, { once: true });
}

/* ════════════════════════════════════════════
   GANTT RENDER
════════════════════════════════════════════ */
function renderGantt() {
  document.getElementById('monthLabel').textContent = `${MONTHS_SHORT[viewMonth]} ${viewYear} — Timeline`;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = dateStr(new Date());
  const mPad  = String(viewMonth+1).padStart(2,'0');
  const DOW_LETTERS = ['S','M','T','W','T','F','S'];

  let html = `<div class="gantt-header-row"><div class="gantt-name-col">Person</div><div class="gantt-days-header">`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${viewYear}-${mPad}-${String(d).padStart(2,'0')}`;
    const dow = parseDate(iso).getDay();
    const isWknd = dow === 0 || dow === 6;
    html += `<div class="gantt-day-label${iso===today?' today-col':''}${isWknd?' weekend-col':''}" style="line-height:1.25;">
      <div style="font-size:0.52rem;opacity:0.75;">${DOW_LETTERS[dow]}</div>
      <div>${d}</div>
    </div>`;
  }
  html += `</div></div>`;

  people.forEach(p => {
    if (!passDeptFilter(p.id)) return;
    const color = getColor(p.id);
    let cells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${mPad}-${String(d).padStart(2,'0')}`;
      const dow = parseDate(iso).getDay();
      cells += `<div class="gantt-cell${iso===today?' today-col':''}${dow===0||dow===6?' weekend':''}"></div>`;
    }
    const mStart = `${viewYear}-${mPad}-01`;
    const mEnd   = `${viewYear}-${mPad}-${String(daysInMonth).padStart(2,'0')}`;
    let bars = '';
    holidays.filter(h => h.personId === p.id).forEach(h => {
      const clipStart = h.start < mStart ? mStart : h.start;
      const clipEnd   = h.end   > mEnd   ? mEnd   : h.end;
      if (clipStart > clipEnd) return;
      const startDay = parseInt(clipStart.split('-')[2]) - 1;
      const endDay   = parseInt(clipEnd.split('-')[2]) - 1;
      const left  = (startDay / daysInMonth) * 100;
      const width = ((endDay - startDay + 1) / daysInMonth) * 100;
      const icon  = LEAVE_TYPE_ICONS[h.type] || '📌';
      bars += `<div class="gantt-bar" style="left:${left}%;width:${width}%;background:${color.bg};" title="${icon} ${h.type} · ${fmtDate(h.start)} → ${fmtDate(h.end)}${h.note?' · '+h.note:''}">${width > 8 ? icon : ''}</div>`;
    });
    html += `<div class="gantt-person-row"><div class="gantt-person-name">${p.name.split(' ')[0]}</div><div class="gantt-cells" style="position:relative;">${cells}${bars}</div></div>`;
  });

  document.getElementById('ganttGrid').innerHTML = html;
}

/* ════════════════════════════════════════════
   VACATION BALANCE RENDER
════════════════════════════════════════════ */
function renderVacBalance() {
  const year = viewYear;
  document.getElementById('vacYearTag').textContent = year;
  const list = document.getElementById('vacBalanceList');
  const filtered = deptFilter ? people.filter(p => p.dept === deptFilter) : people;
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${deptFilter ? `No one in ${deptFilter}` : 'No team members yet'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    const color    = getColor(p.id);
    const allot    = vacAllotment(p.id, year);
    const used     = vacUsedByYear(p.id, year);
    const remaining = allot - used;
    const pct      = Math.max(0, Math.min(100, (remaining / allot) * 100));
    let remainClass = 'ok', barColor = '#6ee7b7';
    if (remaining <= 0)  { remainClass = 'exhausted'; barColor = '#f87171'; }
    else if (remaining <= 3) { remainClass = 'warn';  barColor = '#f59e0b'; }
    const bonus      = allot - VACATION_DAYS_PER_YEAR;
    const bonusBadge = bonus !== 0
      ? `<span style="font-family:'DM Mono',monospace;font-size:0.58rem;color:${bonus > 0 ? 'var(--accent3)' : 'var(--red)'};margin-left:3px;">${bonus > 0 ? '+' : ''}${bonus}↩</span>` : '';
    const resetBtn = isAdmin()
      ? `<button class="reset-vac-btn" onclick="resetVacation('${p.id}','${p.name.replace(/'/g,"\\'")}',${year})" title="Adjust vacation bonus">↺</button>` : '';
    return `<div class="vac-row">
      <div class="avatar" style="width:30px;height:30px;font-size:0.65rem;background:${color.bg};color:${color.text};">${initials(p.name)}</div>
      <div class="vac-info">
        <div class="vac-name">${p.name}</div>
        <div style="display:flex;align-items:center;gap:4px;">
          <div class="vac-dept">${p.dept}</div>
          <div class="vac-bar-wrap" style="flex:1;max-width:60px;"><div class="vac-bar" style="width:${pct}%;background:${barColor};"></div></div>
          <div class="vac-dept">${fmtDays(used)}/${allot}d used</div>
        </div>
      </div>
      <div class="vac-right">
        <div class="vac-counter"><span class="vac-remaining ${remainClass}">${fmtDays(remaining)}</span><span class="vac-of">left${bonusBadge}</span></div>
        ${resetBtn}
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   AWAY + ALL LIST
════════════════════════════════════════════ */
function renderAway() {
  const today = dateStr(new Date());
  const away  = holidaysOnDate(today).filter(h => passDeptFilter(h.personId));
  document.getElementById('awayCount').textContent = away.length;
  const list = document.getElementById('awayList');
  if (!away.length) { list.innerHTML = `<div class="empty-state">${deptFilter ? `No one in ${deptFilter} is away today ✓` : 'No one is away today ✓'}</div>`; return; }
  list.innerHTML = away.map(h => {
    const p = getPerson(h.personId); if (!p) return '';
    const color = getColor(h.personId);
    return `<div class="person-row">
      <div class="avatar" style="background:${color.bg};color:${color.text};">${initials(p.name)}</div>
      <div class="person-info"><div class="person-name">${p.name}</div><div class="person-dept">${p.dept}</div></div>
      <span class="leave-badge chip" style="background:var(--accent-a08);color:var(--accent);">${LEAVE_TYPE_ICONS[h.type]||'📌'}${h.halfDay?' ½':''}</span>
    </div>`;
  }).join('');
}

function renderAllList() {
  const sorted = [...holidays].filter(h => passDeptFilter(h.personId))
    .sort((a, b) => a.start.localeCompare(b.start));
  document.getElementById('allCount').textContent = sorted.length;
  const list = document.getElementById('allList');
  if (!sorted.length) { list.innerHTML = `<div class="empty-state">${deptFilter ? `No entries for ${deptFilter}` : 'No holidays recorded yet'}</div>`; return; }
  list.innerHTML = sorted.map(h => {
    const p = getPerson(h.personId); if (!p) return '';
    const color   = getColor(h.personId);
    const halfTag = h.halfDay ? ` · ½ ${h.halfDayPart||''}` : '';
    const days    = entryDays(h);
    const canEd   = canEdit(h.personId);
    const edit    = canEd
      ? `<button class="delete-btn" onclick="editHoliday('${h.id}')" title="Edit" style="color:var(--accent3);">✎</button>` : '';
    const del     = canDelete(h)
      ? `<button class="delete-btn" onclick="deleteHoliday('${h.id}')" title="Delete">✕</button>` : '';
    return `<div class="list-item-row">
      <div class="avatar" style="width:30px;height:30px;background:${color.bg};color:${color.text};font-size:0.65rem;">${initials(p.name)}</div>
      <div class="list-item-info">
        <div class="list-item-name">${p.name} ${LEAVE_TYPE_ICONS[h.type]||'📌'}<span style="font-family:'DM Mono',monospace;font-size:0.6rem;color:var(--text-muted);margin-left:4px;">${fmtDays(days)}d</span></div>
        <div class="list-item-date">${fmtDate(h.start)} → ${fmtDate(h.end)}${halfTag}${h.note?' · '+h.note:''}</div>
      </div>
      ${edit}
      ${del}
    </div>`;
  }).join('');
}

function renderLegend() {
  const pubHolLegend = publicHolidays.length ? `<div class="legend-item"><div class="legend-dot" style="background:var(--accent3)"></div>Public Holiday</div>` : '';
  const legendPeople = deptFilter ? people.filter(p => p.dept === deptFilter) : people;
  document.getElementById('legend').innerHTML =
    legendPeople.map(p => {
      const color = getColor(p.id);
      return `<div class="legend-item"><div class="legend-dot" style="background:${color.bg}"></div>${p.name.split(' ')[0]}</div>`;
    }).join('') +
    pubHolLegend +
    `<div class="legend-item"><div class="legend-dot" style="background:var(--surface3);border:1px solid var(--border);"></div>Weekend (not counted)</div>`;
}

/* ════════════════════════════════════════════
   PEOPLE LIST (admin modal)
════════════════════════════════════════════ */
function renderPeopleList() {
  const list = document.getElementById('peopleList');
  if (!people.length) { list.innerHTML = '<div class="empty-state">No people added yet</div>'; return; }
  list.innerHTML = people.map(p => {
    const color = getColor(p.id);
    const prof  = userProfiles.find(u => u.personId === p.id);
    let badge = '';
    if (prof && prof.isAdmin) badge = `<span class="account-badge admin">👑 admin</span>`;
    else if (prof)            badge = `<span class="account-badge linked">✓ account</span>`;
    else                      badge = `<span class="account-badge unlinked">no account</span>`;
    const toggleAdmin = prof
      ? `<button class="btn btn-sm btn-ghost" onclick="toggleAdminStatus('${prof.uid}','${p.name}',${!!prof.isAdmin})" style="padding:4px 8px;font-size:0.65rem;">${prof.isAdmin?'↓':'↑'}admin</button>`
      : '';
    return `<div class="list-item-row" style="flex-wrap:wrap;gap:6px;">
      <div class="avatar" style="width:30px;height:30px;background:${color.bg};color:${color.text};font-size:0.65rem;">${initials(p.name)}</div>
      <div class="list-item-info"><div class="list-item-name">${p.name}</div><div class="list-item-date">${p.dept}</div></div>
      ${badge}${toggleAdmin}
      <button class="delete-btn" onclick="openEditPerson('${p.id}')" title="Edit name &amp; department" style="color:var(--accent3);">✎</button>
      <button class="delete-btn" onclick="removePerson('${p.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   PUBLIC HOLIDAYS (admin)
════════════════════════════════════════════ */
function openPublicHolidays() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  renderPubHolList();
  const yr = document.getElementById('pubHolYear');
  if (yr && !yr.value) yr.value = new Date().getFullYear();
  const status = document.getElementById('pubHolFetchStatus');
  if (status) status.textContent = '';
  document.getElementById('pubHolModal').classList.add('open');
}
function closePubHol() { document.getElementById('pubHolModal').classList.remove('open'); }

function renderPubHolList() {
  const list = document.getElementById('pubHolList');
  if (!publicHolidays.length) { list.innerHTML = '<div class="empty-state">No public holidays added yet</div>'; return; }
  list.innerHTML = publicHolidays.map(ph =>
    `<div class="pub-hol-item">
      <span style="font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--text-dim);flex:0 0 110px;">${fmtDate(ph.date)}</span>
      <span style="font-size:0.82rem;flex:1;">${ph.name}</span>
      <button class="delete-btn" onclick="deletePublicHoliday('${ph.id}')" title="Remove">✕</button>
    </div>`
  ).join('');
}

async function addPublicHoliday() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const date = document.getElementById('newPubDate').value;
  const name = document.getElementById('newPubName').value.trim();
  if (!date || !name) { showToast('Enter date and name.', true); return; }
  showSaving(true);
  try {
    await pubHolCol.add({ date, name, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('newPubDate').value = '';
    document.getElementById('newPubName').value = '';
    renderPubHolList(); showToast('Public holiday added!');
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}
async function deletePublicHoliday(id) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  showSaving(true);
  try { await pubHolCol.doc(id).delete(); renderPubHolList(); showToast('Removed.'); }
  catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function fetchCountryHolidays() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const country = document.getElementById('pubHolCountry').value;
  const yearRaw = document.getElementById('pubHolYear').value.trim();
  const year    = Number(yearRaw);
  const status  = document.getElementById('pubHolFetchStatus');
  const btn     = document.getElementById('pubHolFetchBtn');

  if (!country) { status.textContent = '⚠ Select a country first.'; status.style.color = 'var(--red)'; return; }
  if (!Number.isInteger(year) || year < 2020 || year > 2099) {
    status.textContent = '⚠ Enter a valid year (2020–2099).'; status.style.color = 'var(--red)'; return;
  }

  btn.disabled = true;
  status.style.color = 'var(--text-muted)';
  status.textContent = `Fetching ${country} ${year}…`;

  try {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const entries = await resp.json();
    if (!Array.isArray(entries) || !entries.length) {
      status.style.color = 'var(--accent2)';
      status.textContent = `No holidays returned for ${country} ${year}.`;
      return;
    }

    const existingKeys = new Set(publicHolidays.map(ph => `${ph.date}|${(ph.name||'').toLowerCase()}`));
    const toAdd = entries
      .map(e => ({ date: e.date, name: e.localName || e.name || 'Holiday' }))
      .filter(e => e.date && !existingKeys.has(`${e.date}|${e.name.toLowerCase()}`));

    if (!toAdd.length) {
      status.style.color = 'var(--accent2)';
      status.textContent = `All ${entries.length} ${country} ${year} holidays already imported.`;
      return;
    }

    showSaving(true);
    const batch = db.batch();
    const stamp = firebase.firestore.FieldValue.serverTimestamp();
    toAdd.forEach(e => {
      batch.set(pubHolCol.doc(), { date: e.date, name: e.name, country, createdAt: stamp });
    });
    await batch.commit();

    await writeLog('vac_reset',
      `<strong>Public holidays</strong> — imported ${toAdd.length} ${country} ${year} holiday${toAdd.length === 1 ? '' : 's'}`,
      { country, year, added: toAdd.length });

    status.style.color = 'var(--accent)';
    status.textContent = `✓ Imported ${toAdd.length} holiday${toAdd.length === 1 ? '' : 's'} (${entries.length - toAdd.length} already existed).`;
    showToast(`Imported ${toAdd.length} ${country} ${year} holidays!`);
    renderPubHolList();
  } catch(e) {
    status.style.color = 'var(--red)';
    status.textContent = `⚠ Fetch failed: ${e.message}`;
  } finally {
    btn.disabled = false;
    showSaving(false);
  }
}

/* ════════════════════════════════════════════
   VACATION RESET (admin)
════════════════════════════════════════════ */
async function resetVacation(personId, personName, year) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const existing    = vacResets.find(r => r.personId === personId && r.year === year);
  const currentBonus = existing ? (existing.resetDays || 0) : 0;
  const currentAllot = VACATION_DAYS_PER_YEAR + currentBonus;

  const msg =
    `Adjust ${personName}'s vacation bonus for ${year}.\n\n` +
    `Base allotment: ${VACATION_DAYS_PER_YEAR} days\n` +
    `Current bonus:  ${currentBonus >= 0 ? '+' : ''}${currentBonus} days\n` +
    `Current total:  ${currentAllot} days\n\n` +
    `Enter the NEW bonus (positive = add, negative = reduce, 0 = remove bonus).\n` +
    `Example: "3" for carry-over, "-6" for half-year proration, "12" for a fresh year reset.`;

  const raw = prompt(msg, String(currentBonus));
  if (raw === null) return;
  const newBonus = Number(raw.trim());
  if (!Number.isFinite(newBonus)) { showToast('Invalid number.', true); return; }
  if (newBonus === currentBonus)  { showToast('No change.'); return; }

  const newAllot = VACATION_DAYS_PER_YEAR + newBonus;
  if (newAllot < 0) { showToast('Total allotment cannot be negative.', true); return; }
  if (!confirm(`Set ${personName}'s ${year} allotment to ${newAllot} days (bonus ${newBonus >= 0 ? '+' : ''}${newBonus})?`)) return;

  showSaving(true);
  try {
    await vacResetCol.doc(`${personId}_${year}`).set({
      personId, year, resetDays: newBonus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const delta = newBonus - currentBonus;
    const sign  = delta >= 0 ? '+' : '';
    await writeLog('vac_reset',
      `<strong>${personName}</strong> — ${year} bonus set to ${newBonus >= 0 ? '+' : ''}${newBonus} days (${sign}${delta} change · total ${newAllot}d)`,
      { personId, year, newBonus, previousBonus: currentBonus });
    showToast(`${personName}: ${year} allotment now ${newAllot} days`);
  } catch(e) { showToast('Reset failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function toggleAdminStatus(uid, personName, currentlyAdmin) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  if (currentlyAdmin && uid === currentUser.uid) { showToast("Can't remove your own admin status.", true); return; }
  if (!confirm(`${currentlyAdmin ? 'Remove' : 'Grant'} admin for ${personName}?`)) return;
  showSaving(true);
  try {
    await userProfCol.doc(uid).update({ isAdmin: !currentlyAdmin });
    showToast(`${personName} is ${!currentlyAdmin ? 'now an admin' : 'no longer admin'}.`);
    renderPeopleList();
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

/* ════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════ */
function changeMonth(dir) {
  viewMonth += dir;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
  render();
}
function goToday() { const t = new Date(); viewYear = t.getFullYear(); viewMonth = t.getMonth(); render(); }
function selectDate(iso) {
  document.getElementById('searchDate').value = iso;
  searchByDate();
  const [y, m] = iso.split('-').map(Number);
  viewYear = y; viewMonth = m - 1;
  render();
}

/* ════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════ */
function searchByDate() {
  const val = document.getElementById('searchDate').value;
  const res = document.getElementById('searchResults');
  if (!val) { res.innerHTML = ''; return; }
  const hs     = holidaysOnDate(val).filter(h => passDeptFilter(h.personId));
  const pubHol = publicHolOnDate(val);
  let html = '';
  if (pubHol) html += `<div class="search-result-item" style="border-color:var(--accent3-a25);">
    <div class="result-avatar" style="background:var(--accent3-a12);color:var(--accent3);">🗓</div>
    <div class="result-info"><div class="result-name">${pubHol.name}</div><div class="result-dates">Public Holiday</div></div>
  </div>`;
  if (!hs.length && !pubHol) { res.innerHTML = '<div class="no-results">No one on leave this day</div>'; return; }
  html += hs.map(h => {
    const p = getPerson(h.personId); if (!p) return '';
    const color = getColor(h.personId);
    return `<div class="search-result-item">
      <div class="result-avatar" style="background:${color.bg};color:${color.text};">${initials(p.name)}</div>
      <div class="result-info">
        <div class="result-name">${p.name} ${LEAVE_TYPE_ICONS[h.type]||'📌'}${h.halfDay?' ½'+h.halfDayPart:''}</div>
        <div class="result-dates">${fmtDate(h.start)} → ${fmtDate(h.end)}${h.note?' · '+h.note:''}</div>
      </div>
    </div>`;
  }).join('');
  res.innerHTML = html;
}

/* ════════════════════════════════════════════
   ADD MODAL
════════════════════════════════════════════ */
function toggleHalfDay() {
  const checked = document.getElementById('halfDayCheck').checked;
  document.getElementById('halfDaySelect').classList.toggle('visible', checked);
  if (checked) {
    const s = document.getElementById('formStart').value;
    if (s) document.getElementById('formEnd').value = s;
  }
  updateModalWarnings();
}

let _warnTimer = null;
function scheduleModalWarnings() {
  clearTimeout(_warnTimer);
  _warnTimer = setTimeout(updateModalWarnings, 16);
}
function updateModalWarnings() {
  updateWeekendWarn(); updateConflictWarn(); updateVacWarning(); updateCapacityWarn();
}

function attachModalListeners() {
  ['formPerson','formStart','formEnd','formType'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (id === 'formStart' && document.getElementById('halfDayCheck').checked)
        document.getElementById('formEnd').value = document.getElementById('formStart').value;
      scheduleModalWarnings();
    });
  });
}

let _modalListenersAttached = false;
let editingHolidayId = null;
function openAddModal(keepDates, editH) {
  if (!currentUser) { showToast('Please sign in first.', true); return; }
  if (!_modalListenersAttached) { _modalListenersAttached = true; attachModalListeners(); }

  editingHolidayId = editH ? editH.id : null;
  const titleEl  = document.getElementById('addModalTitle');
  const subEl    = document.getElementById('addModalSub');
  const saveBtn  = document.getElementById('saveHolBtn');
  const delBtn   = document.getElementById('editDeleteBtn');
  titleEl.textContent = editH ? 'Edit Holiday' : 'Add Holiday';
  saveBtn.textContent = editH ? 'Update Holiday' : 'Save Holiday';
  delBtn.style.display = editH ? '' : 'none';

  const sel = document.getElementById('formPerson');
  if (isAdmin()) {
    sel.innerHTML = '<option value="">— Select person —</option>';
    people.forEach(p => { sel.innerHTML += `<option value="${p.id}">${p.name} (${p.dept})</option>`; });
    sel.disabled = false;
    if (!editH) subEl.textContent = 'Record who\'s out and when · weekdays (Mon–Fri) only';
  } else {
    const myId = myPersonId();
    const me   = getPerson(myId);
    sel.innerHTML = me ? `<option value="${myId}">${me.name} (${me.dept})</option>` : '<option value="">— Not linked to a person —</option>';
    sel.disabled  = true;
    if (!editH) subEl.textContent = `Adding holiday for you · ${me ? me.name : ''} · weekdays only`;
  }

  if (editH) {
    sel.value = editH.personId;
    document.getElementById('formStart').value = editH.start;
    document.getElementById('formEnd').value   = editH.end;
    document.getElementById('formType').value  = editH.type || 'vacation';
    document.getElementById('formNote').value  = editH.note || '';
    document.getElementById('halfDayCheck').checked = !!editH.halfDay;
    document.getElementById('halfDaySelect').classList.toggle('visible', !!editH.halfDay);
    if (editH.halfDay && editH.halfDayPart) document.getElementById('halfDayPart').value = editH.halfDayPart;
    subEl.textContent = `Editing entry for ${getPersonName(editH.personId)}`;
  } else {
    if (!keepDates) {
      document.getElementById('formStart').value = '';
      document.getElementById('formEnd').value   = '';
    }
    document.getElementById('formNote').value   = '';
    document.getElementById('formType').value   = 'vacation';
    document.getElementById('halfDayCheck').checked = false;
    document.getElementById('halfDaySelect').classList.remove('visible');
  }

  document.getElementById('vacWarning').style.display    = 'none';
  document.getElementById('conflictWarn').style.display  = 'none';
  document.getElementById('weekendWarn').style.display   = 'none';
  document.getElementById('capacityWarn').style.display  = 'none';
  document.getElementById('addModal').classList.add('open');
  setTimeout(() => { if (!sel.disabled && !editH) sel.focus(); }, 100);
  if (keepDates || editH) updateModalWarnings();
}

function closeModal() {
  document.getElementById('addModal').classList.remove('open');
  editingHolidayId = null;
  dragStart = null; dragEnd = null;
  document.querySelectorAll('.day-cell').forEach(c => c.classList.remove('drag-range','drag-start','drag-end'));
}

function editHoliday(id) {
  const h = holidays.find(x => x.id === id);
  if (!h) { showToast('Entry not found.', true); return; }
  if (!canEdit(h.personId)) { showToast('You can only edit your own entries.', true); return; }
  openAddModal(false, h);
}

async function deleteFromEdit() {
  if (!editingHolidayId) return;
  const id = editingHolidayId;
  closeModal();
  await deleteHoliday(id);
}

/* ════════════════════════════════════════════
   WARNINGS
════════════════════════════════════════════ */
function updateWeekendWarn() {
  const start = document.getElementById('formStart').value;
  const end   = document.getElementById('formEnd').value;
  const warn  = document.getElementById('weekendWarn');
  if (!start || !end || end < start) { warn.style.display = 'none'; return; }

  const wdays = countWeekdays(start, end);
  if (wdays === 0) {
    warn.style.display = 'block';
    warn.style.background = 'var(--red-a12)';
    warn.style.borderColor = 'var(--red-a25)';
    warn.style.color = 'var(--red)';
    warn.textContent = '⛔ Selected dates are weekends or public holidays only — no weekdays to book.';
    return;
  }

  const s = parseDate(start), e = parseDate(end);
  let hasWeekend = false;
  const cur = new Date(s);
  while (cur <= e) {
    const d = cur.getDay();
    if (d === 0 || d === 6) { hasWeekend = true; break; }
    cur.setDate(cur.getDate() + 1);
  }

  if (hasWeekend) {
    warn.style.display = 'block';
    warn.style.background = 'var(--accent2-a08)';
    warn.style.borderColor = 'rgba(245,158,11,0.25)';
    warn.style.color = 'var(--accent2)';
    warn.textContent = `⚠ Weekends are excluded — this range counts as ${wdays} weekday${wdays !== 1 ? 's' : ''} (Mon–Fri only).`;
  } else {
    warn.style.display = 'none';
  }
}

function updateConflictWarn() {
  const personId = document.getElementById('formPerson').value;
  const start    = document.getElementById('formStart').value;
  const end      = document.getElementById('formEnd').value;
  const warn     = document.getElementById('conflictWarn');
  if (!personId || !start || !end || end < start) { warn.style.display = 'none'; return; }
  const conflicts = getConflicts(personId, start, end, editingHolidayId);
  warn.style.display = conflicts.length ? 'block' : 'none';
  if (conflicts.length) {
    const names = conflicts.map(h => `${LEAVE_TYPE_ICONS[h.type]||'📌'} ${fmtDate(h.start)}→${fmtDate(h.end)}`).join(', ');
    warn.textContent = `⚠ Overlaps existing entry: ${names}`;
  }
}

function updateVacWarning() {
  const personId = document.getElementById('formPerson').value;
  const start    = document.getElementById('formStart').value;
  const end      = document.getElementById('formEnd').value;
  const type     = document.getElementById('formType').value;
  const halfDay  = document.getElementById('halfDayCheck').checked;
  const warn     = document.getElementById('vacWarning');

  if (type !== 'vacation' || !personId || !start || !end || end < start) {
    warn.style.display = 'none'; return;
  }

  const startYear = parseInt(start.slice(0, 4));
  const endYear   = parseInt(end.slice(0, 4));
  const p = getPerson(personId);

  const yearDeductions = {};
  if (halfDay) {
    if (!isWeekendIso(start) && !pubHolSet().has(start))
      yearDeductions[startYear] = 0.5;
  } else {
    for (let yr = startYear; yr <= endYear; yr++) {
      const d = countWeekdaysInYear(start, end, yr);
      if (d > 0) yearDeductions[yr] = d;
    }
  }

  const years = Object.keys(yearDeductions).map(Number).sort();
  if (!years.length) { warn.style.display = 'none'; return; }

  let worstClass = 'warn-ok';
  const lines = years.map(yr => {
    const deduction = yearDeductions[yr];
    const remaining = vacRemaining(personId, yr);
    const after     = remaining - deduction;
    const label     = years.length > 1 ? ` (${yr})` : '';
    if (after < 0) {
      worstClass = 'warn-error';
      return `⚠ ${deduction}d from ${yr}${label} — only ${remaining} left, ${Math.abs(after).toFixed(1)} over allotment`;
    } else if (after <= 3) {
      if (worstClass !== 'warn-error') worstClass = 'warn-caution';
      return `ℹ ${fmtDays(deduction)}d from ${yr}${label} — ${fmtDays(after)} day${after !== 1 ? 's' : ''} remaining`;
    } else {
      return `✓ ${fmtDays(deduction)}d from ${yr}${label} — ${fmtDays(after)} day${after !== 1 ? 's' : ''} remaining`;
    }
  });

  warn.style.display = 'block';
  warn.className     = worstClass;
  warn.textContent   = `${p.name}: ` + lines.join(' · ');
}

function updateCapacityWarn() {
  const warn     = document.getElementById('capacityWarn');
  const threshold = Number(teamSettings.capacityThreshold) || 0;
  if (!warn) return;
  if (threshold <= 0) { warn.style.display = 'none'; return; }

  const personId = document.getElementById('formPerson').value;
  const start    = document.getElementById('formStart').value;
  const end      = document.getElementById('formEnd').value;
  const halfDay  = document.getElementById('halfDayCheck').checked;
  if (!personId || !start || !end || end < start) { warn.style.display = 'none'; return; }

  const phSet  = pubHolSet();
  const hotDays = [];
  const rangeEnd = halfDay ? start : end;
  const cur = parseDate(start);
  const last = parseDate(rangeEnd);
  while (cur <= last) {
    const iso = dateStr(cur);
    cur.setDate(cur.getDate() + 1);
    if (!isWeekday(parseDate(iso)) || phSet.has(iso)) continue;
    const offIds = new Set();
    for (const h of holidays) {
      if (h.id === editingHolidayId) continue;
      if (h.personId === personId)   continue;
      if (h.start <= iso && h.end >= iso) offIds.add(h.personId);
    }
    const totalIfBooked = offIds.size + 1;
    if (totalIfBooked >= threshold) {
      const names = [...offIds].map(getPersonName).join(', ');
      hotDays.push({ iso, totalIfBooked, names });
    }
  }

  if (!hotDays.length) { warn.style.display = 'none'; return; }

  const preview = hotDays.slice(0, 3)
    .map(d => `${fmtDate(d.iso)} (${d.totalIfBooked} people${d.names ? ': ' + d.names : ''})`)
    .join(' · ');
  const moreTag = hotDays.length > 3 ? ` · +${hotDays.length - 3} more day${hotDays.length - 3 === 1 ? '' : 's'}` : '';
  warn.style.display = 'block';
  warn.className     = 'warn-caution';
  warn.textContent   = `⚠ Team capacity: ${hotDays.length} day${hotDays.length === 1 ? '' : 's'} would hit ≥${threshold} people off — ${preview}${moreTag}`;
}

async function saveCapacityThreshold() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const raw = document.getElementById('capacityThreshold').value.trim();
  const val = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(val) || val < 0 || val > 20) { showToast('Enter a number 0–20.', true); return; }
  showSaving(true);
  try {
    await settingsCol.doc('team').set({
      capacityThreshold: val,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast(val === 0 ? 'Capacity warnings disabled.' : `Threshold set to ${val} people.`);
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

/* ════════════════════════════════════════════
   DEPARTMENT MANAGER (admin)
════════════════════════════════════════════ */
function renderDeptManager() {
  const list = document.getElementById('deptManagerList');
  if (!list) return;
  const depts = effectiveDepartments();
  if (!depts.length) {
    list.innerHTML = '<div class="empty-state" style="padding:8px 0;">No departments yet — add one below or they appear automatically when you set a dept on a person.</div>';
    return;
  }
  list.innerHTML = depts.map(d => {
    const count = people.filter(p => p.dept === d).length;
    return `<div class="dept-chip">
      <span>${d}</span>
      <span class="dept-count" title="${count} ${count === 1 ? 'person' : 'people'}">${count}</span>
      <button class="dept-chip-btn" onclick="renameDepartment(${JSON.stringify(d).replace(/"/g,'&quot;')})" title="Rename">✎</button>
      <button class="dept-chip-btn del" onclick="removeDepartment(${JSON.stringify(d).replace(/"/g,'&quot;')})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

async function addDepartment() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const input = document.getElementById('newDeptName');
  const name = input.value.trim();
  if (!name) { showToast('Enter a department name.', true); return; }
  const existing = effectiveDepartments();
  if (existing.some(d => d.toLowerCase() === name.toLowerCase())) {
    showToast('Department already exists.', true); return;
  }
  showSaving(true);
  try {
    const next = [...(teamSettings.departments || []), name];
    await settingsCol.doc('team').set({
      departments: next,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    input.value = '';
    showToast(`Added "${name}".`);
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function renameDepartment(oldName) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const raw = prompt(`Rename department "${oldName}" to:`, oldName);
  if (raw === null) return;
  const newName = raw.trim();
  if (!newName || newName === oldName) return;
  const existing = effectiveDepartments().filter(d => d !== oldName);
  if (existing.some(d => d.toLowerCase() === newName.toLowerCase())) {
    showToast('A department with that name already exists.', true); return;
  }
  const affected = people.filter(p => p.dept === oldName);
  if (affected.length &&
      !confirm(`Rename "${oldName}" to "${newName}"?\nThis will update ${affected.length} ${affected.length === 1 ? 'person' : 'people'}.`)) return;

  showSaving(true);
  try {
    const batch = db.batch();
    const managed = teamSettings.departments || [];
    const idx = managed.indexOf(oldName);
    const nextManaged = idx >= 0
      ? managed.map(d => d === oldName ? newName : d)
      : [...managed, newName];
    batch.set(settingsCol.doc('team'),
      { departments: nextManaged, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true });
    affected.forEach(p => batch.update(peopleCol.doc(p.id), { dept: newName }));
    await batch.commit();

    if (deptFilter === oldName) {
      deptFilter = newName;
      localStorage.setItem('ht_dept_filter', newName);
    }
    await writeLog('person_add',
      `Department renamed: <strong>${oldName}</strong> → <strong>${newName}</strong> (${affected.length} updated)`,
      { oldName, newName, affected: affected.length });
    showToast(`Renamed to "${newName}".`);
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function removeDepartment(name) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const affected = people.filter(p => p.dept === name);
  const msg = affected.length
    ? `Remove department "${name}"?\n${affected.length} ${affected.length === 1 ? 'person will be' : 'people will be'} moved to "Team".`
    : `Remove department "${name}" from the managed list?`;
  if (!confirm(msg)) return;

  showSaving(true);
  try {
    const managed = teamSettings.departments || [];
    const nextManaged = managed.filter(d => d !== name);
    const batch = db.batch();
    batch.set(settingsCol.doc('team'),
      { departments: nextManaged, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true });
    affected.forEach(p => batch.update(peopleCol.doc(p.id), { dept: 'Team' }));
    await batch.commit();

    if (deptFilter === name) {
      deptFilter = '';
      localStorage.removeItem('ht_dept_filter');
    }
    await writeLog('person_remove',
      `Department <strong>${name}</strong> removed${affected.length ? ` (${affected.length} moved to Team)` : ''}`,
      { name, affected: affected.length });
    showToast('Department removed.');
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

/* ════════════════════════════════════════════
   SAVE / DELETE HOLIDAY
════════════════════════════════════════════ */
async function saveHoliday() {
  const personId    = document.getElementById('formPerson').value;
  let   start       = document.getElementById('formStart').value;
  let   end         = document.getElementById('formEnd').value;
  const type        = document.getElementById('formType').value;
  const note        = document.getElementById('formNote').value.trim();
  const halfDay     = document.getElementById('halfDayCheck').checked;
  const halfDayPart = halfDay ? document.getElementById('halfDayPart').value : null;

  if (!personId || !start || !end) { showToast('Please fill in person, start and end date.', true); return; }
  if (end < start) { showToast('End date must be after start date.', true); return; }
  if (!canEdit(personId)) { showToast('You can only add holidays for yourself.', true); return; }
  if (halfDay) end = start;
  if (type === 'vacation' && !halfDay && countWeekdays(start, end) === 0) {
    showToast('Selected range has no weekdays (or all days are public holidays).', true); return;
  }

  showSaving(true);
  try {
    const savedName = getPersonName(personId);
    const icon      = LEAVE_TYPE_ICONS[type] || '📌';
    const halfTag   = halfDay ? ` (½ ${halfDayPart})` : '';
    const wdays     = halfDay ? 0.5 : countWeekdays(start, end);

    if (editingHolidayId) {
      const update = { personId, start, end, type, note, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByUid: currentUser.uid };
      if (halfDay) { update.halfDay = true; update.halfDayPart = halfDayPart; }
      else         { update.halfDay = firebase.firestore.FieldValue.delete(); update.halfDayPart = firebase.firestore.FieldValue.delete(); }
      await holidaysCol.doc(editingHolidayId).update(update);
      await writeLog('holiday_add',
        `<strong>${savedName}</strong> — ${icon} ${type}${halfTag} updated: ${fmtDate(start)} → ${fmtDate(end)} (${wdays}d)${note?' · '+note:''}`,
        { personId, start, end, type, edited: true }
      );
      closeModal(); showToast('Holiday updated!');
    } else {
      const entry = { personId, start, end, type, note, createdAt: firebase.firestore.FieldValue.serverTimestamp(), addedByUid: currentUser.uid };
      if (halfDay) { entry.halfDay = true; entry.halfDayPart = halfDayPart; }
      await holidaysCol.add(entry);
      await writeLog('holiday_add',
        `<strong>${savedName}</strong> — ${icon} ${type}${halfTag} from ${fmtDate(start)} to ${fmtDate(end)} (${wdays}d)${note?' · '+note:''}`,
        { personId, start, end, type }
      );
      closeModal(); showToast('Holiday saved!');
    }
  } catch(e) { showToast('Save failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function deleteHoliday(id) {
  const delH = holidays.find(h => h.id === id);
  if (delH && !canDelete(delH)) { showToast('You can only delete your own entries.', true); return; }
  if (!confirm('Delete this holiday entry?')) return;
  showSaving(true);
  try {
    if (delH) {
      await writeLog('holiday_delete',
        `<strong>${getPersonName(delH.personId)}</strong> — ${LEAVE_TYPE_ICONS[delH.type]||'📌'} ${delH.type} (${fmtDate(delH.start)} → ${fmtDate(delH.end)}) deleted`,
        { personId: delH.personId, start: delH.start, end: delH.end }
      );
    }
    await holidaysCol.doc(id).delete();
    showToast('Entry deleted.'); searchByDate();
  } catch(e) { showToast('Delete failed: '+e.message, true); }
  finally { showSaving(false); }
}

/* ════════════════════════════════════════════
   MANAGE PEOPLE (admin)
════════════════════════════════════════════ */
function openManage() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  renderPeopleList();
  renderDeptManager();
  updateDeptDatalists();
  const thrInput = document.getElementById('capacityThreshold');
  if (thrInput) thrInput.value = teamSettings.capacityThreshold || '';
  document.getElementById('manageModal').classList.add('open');
}
function closeManage() { document.getElementById('manageModal').classList.remove('open'); }

async function addPerson() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const name = document.getElementById('newPersonName').value.trim();
  const dept = document.getElementById('newPersonDept').value.trim() || 'Team';
  if (!name) { showToast('Enter a name.', true); return; }

  const normalized = name.toLowerCase();
  const dupe = people.find(p => p.name.toLowerCase() === normalized);
  if (dupe) {
    if (!confirm(`⚠ "${dupe.name}" already exists in ${dupe.dept}.\n\nAdd a second person with the same name anyway?`)) return;
  }

  showSaving(true);
  try {
    await peopleCol.add({ name, dept, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await writeLog('person_add', `<strong>${name}</strong> added to team (${dept})`, { name, dept });
    document.getElementById('newPersonName').value = '';
    document.getElementById('newPersonDept').value = '';
    showToast('Person added!'); renderPeopleList();
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

async function removePerson(id) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  if (!confirm('Remove this person and all their holidays?')) return;
  showSaving(true);
  try {
    const [snap, resetSnap] = await Promise.all([
      holidaysCol.where('personId','==',id).get(),
      vacResetCol.where('personId','==',id).get()
    ]);
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    resetSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(peopleCol.doc(id));
    const removedPerson = people.find(p => p.id === id);
    await batch.commit();
    if (removedPerson) await writeLog('person_remove', `<strong>${removedPerson.name}</strong> removed from team (${removedPerson.dept})`, { name: removedPerson.name });
    renderPeopleList(); showToast('Person removed.');
  } catch(e) { showToast('Failed: '+e.message, true); }
  finally { showSaving(false); }
}

let _editingPersonId = null;

function openEditPerson(id) {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  const person = people.find(p => p.id === id);
  if (!person) { showToast('Person not found.', true); return; }
  _editingPersonId = id;
  document.getElementById('editPersonName').value = person.name || '';
  document.getElementById('editPersonDept').value = person.dept || '';
  document.getElementById('editPersonSub').textContent = `Editing ${person.name}`;
  const err = document.getElementById('editPersonError');
  err.textContent = ''; err.classList.remove('show');
  updateDeptDatalists();
  document.getElementById('editPersonModal').classList.add('open');
  setTimeout(() => document.getElementById('editPersonName').focus(), 100);
}

function closeEditPerson() {
  document.getElementById('editPersonModal').classList.remove('open');
  _editingPersonId = null;
}

async function saveEditPerson() {
  if (!isAdmin()) { showToast('Admin only.', true); return; }
  if (!_editingPersonId) return;
  const person = people.find(p => p.id === _editingPersonId);
  if (!person) { showToast('Person not found.', true); closeEditPerson(); return; }

  const newName = document.getElementById('editPersonName').value.trim();
  const newDept = document.getElementById('editPersonDept').value.trim() || 'Team';
  const err = document.getElementById('editPersonError');
  err.textContent = ''; err.classList.remove('show');

  if (!newName) { err.textContent = 'Name cannot be empty.'; err.classList.add('show'); return; }

  const normalized = newName.toLowerCase();
  if (newName.toLowerCase() !== (person.name || '').toLowerCase()) {
    const dupe = people.find(p => p.id !== _editingPersonId && (p.name || '').toLowerCase() === normalized);
    if (dupe && !confirm(`⚠ "${dupe.name}" already exists in ${dupe.dept}.\n\nUse the same name anyway?`)) return;
  }

  const nameChanged = newName !== person.name;
  const deptChanged = newDept !== person.dept;
  if (!nameChanged && !deptChanged) { showToast('No change.'); closeEditPerson(); return; }

  showSaving(true);
  try {
    const update = {};
    if (nameChanged) update.name = newName;
    if (deptChanged) update.dept = newDept;
    await peopleCol.doc(_editingPersonId).update(update);

    if (nameChanged) {
      const prof = userProfiles.find(u => u.personId === _editingPersonId);
      if (prof) {
        try { await userProfCol.doc(prof.uid).update({ displayName: newName }); } catch (e) {}
      }
    }

    const parts = [];
    if (nameChanged) parts.push(`name: ${person.name} → ${newName}`);
    if (deptChanged) parts.push(`dept: ${person.dept} → ${newDept}`);
    await writeLog('person_add',
      `<strong>${newName}</strong> updated (${parts.join(' · ')})`,
      { personId: _editingPersonId, oldName: person.name, newName, oldDept: person.dept, newDept });

    showToast('Person updated.');
    closeEditPerson();
    renderPeopleList();
  } catch (e) {
    err.textContent = 'Failed: ' + e.message;
    err.classList.add('show');
  } finally { showSaving(false); }
}

/* ════════════════════════════════════════════
   PROFILE MODAL
════════════════════════════════════════════ */
function openProfileModal() {
  document.getElementById('profileTitle').textContent = currentUser.displayName;
  document.getElementById('profileSub').textContent   = currentUser.isAdmin ? '👑 Admin' : 'Team member';
  document.getElementById('newPw1').value = '';
  document.getElementById('newPw2').value = '';
  const err = document.getElementById('pwChangeError');
  err.textContent = ''; err.classList.remove('show');
  document.getElementById('profileModal').classList.add('open');
}
function closeProfileModal() { document.getElementById('profileModal').classList.remove('open'); }

/* ════════════════════════════════════════════
   CSV EXPORT
════════════════════════════════════════════ */
function exportCSV() {
  if (!holidays.length) { showToast('No entries to export.', true); return; }
  const headers = ['Name','Department','Type','Start','End','Weekdays','Half Day','Note'];
  const rows = holidays.map(h => {
    const p = getPerson(h.personId);
    return [
      p ? p.name : 'Unknown',
      p ? p.dept : '',
      h.type,
      h.start,
      h.end,
      fmtDays(entryDays(h)),
      h.halfDay ? (h.halfDayPart || 'yes') : '',
      (h.note || '').replace(/,/g, ';')
    ];
  });
  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `holidays_${dateStr(new Date())}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!');
}

/* ════════════════════════════════════════════
   AUTO-LOGOUT ON INACTIVITY
════════════════════════════════════════════ */
(function() {
  const INACTIVITY_LIMIT  = 15 * 60 * 1000;
  const WARNING_LEAD_TIME = 60 * 1000;

  let idleTimer    = null;
  let warningTimer = null;
  let countdownInt = null;
  let warningShown = false;

  function isAppActive() {
    const mainApp = document.getElementById('mainApp');
    return mainApp && mainApp.style.display !== 'none';
  }

  function hideWarning() {
    warningShown = false;
    const modal = document.getElementById('inactivityModal');
    if (modal) modal.classList.remove('open');
    clearInterval(countdownInt); countdownInt = null;
  }

  function showWarning() {
    if (!isAppActive()) return;
    warningShown = true;
    const modal = document.getElementById('inactivityModal');
    const secEl = document.getElementById('inactivitySeconds');
    let remaining = Math.floor(WARNING_LEAD_TIME / 1000);
    if (secEl) secEl.textContent = remaining;
    if (modal) modal.classList.add('open');

    clearInterval(countdownInt);
    countdownInt = setInterval(() => {
      remaining--;
      if (secEl) secEl.textContent = Math.max(0, remaining);
      if (remaining <= 0) {
        clearInterval(countdownInt); countdownInt = null;
        hideWarning();
        if (isAppActive()) {
          showToast('Signed out due to inactivity.', true);
          doSignOut();
        }
      }
    }, 1000);
  }

  function resetInactivityTimer() {
    if (warningShown) return;
    clearTimeout(idleTimer);
    clearTimeout(warningTimer);
    warningTimer = setTimeout(showWarning, INACTIVITY_LIMIT - WARNING_LEAD_TIME);
    idleTimer    = setTimeout(() => {
      if (isAppActive()) {
        hideWarning();
        showToast('Signed out due to inactivity.', true);
        doSignOut();
      }
    }, INACTIVITY_LIMIT);
  }

  window.dismissInactivityWarning = function() {
    hideWarning();
    resetInactivityTimer();
  };

  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach(event => {
    window.addEventListener(event, resetInactivityTimer, { passive: true });
  });

  resetInactivityTimer();
})();

/* ════════════════════════════════════════════
   MODAL BACKDROP
════════════════════════════════════════════ */
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

/* ════════════════════════════════════════════
   SUBTLE CANVAS BACKGROUND
════════════════════════════════════════════ */
(function() {
  if (window.Grimoire && window.Grimoire.reducedMotion) return;
  const cv = document.getElementById('bg-canvas');
  if (!cv) return;
  const cx = cv.getContext('2d');
  let w, h;
  const pts = [];
  function rs() { w = cv.width = window.innerWidth; h = cv.height = window.innerHeight; }
  window.addEventListener('resize', rs);
  rs();
  for(let i = 0; i < 20; i++) {
    pts.push({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-0.5)*0.2, vy: (Math.random()-0.5)*0.2,
      r: Math.random()*1.5 + 0.5,
      c: Math.random() > 0.5 ? 'rgba(110,231,183,0.15)' : 'rgba(129,140,248,0.15)'
    });
  }
  function loop() {
    if (window.Grimoire && window.Grimoire.reducedMotion) return;
    cx.clearRect(0,0,w,h);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      cx.fillStyle = p.c; cx.fill();
    });
    requestAnimationFrame(loop);
  }
  loop();
})();


/* ════════════════════════════════════════════
   BOOT
   Kick off auth LAST, after every top-level let/const above has been
   initialized. On the logged-out path initAuth() runs synchronously into
   loadPeopleForAuth(), which reads `_authLoadInFlight`/`_authLoadRetried`;
   invoking it earlier hit a Temporal Dead Zone and froze the dropdown on
   "Loading…". The script tag sits at the end of <body>, so the DOM is ready.
════════════════════════════════════════════ */
initAuth();
