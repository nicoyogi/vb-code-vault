/* ══════════════════════════════════════════════════════════════
   OPERATION REPORT — daily tarif/faktual checking tracker
   ──────────────────────────────────────────────────────────────
   • Shared Firebase backend (same vb-code-vault project)
   • Custom name + password login (no Firebase Auth), mirroring
     the Holiday Tracker. Each user may only edit the row that
     carries their own name; admins may edit everyone.
   • History is seeded from REPORT DATA.xlsx via report-data-seed.js
     and pushed to Firestore once with the admin "Import history"
     button (idempotent — safe to run twice).
   ══════════════════════════════════════════════════════════════ */

/* ── Firebase guard ─────────────────────────────────────────── */
if (typeof firebase === 'undefined' || !firebase.initializeApp) {
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('loginName');
    if (sel) sel.innerHTML = '<option value="">— Can’t reach Firebase — check connection / ad-blocker —</option>';
  });
  throw new Error('Firebase SDK failed to load — check network, ad-blocker, or CDN access.');
}
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

const peopleCol  = db.collection('wmf_op_people');
const entryCol   = db.collection('wmf_op_entries');
const catCol     = db.collection('wmf_op_categories');
const SERVER_TS  = () => firebase.firestore.FieldValue.serverTimestamp();

/* ── Constants from the seed (with safe fallbacks) ──────────── */
const SEED     = window.REPORT_DATA_SEED || { people: [], metrics: [], categories: [], entries: [], categoryEntries: [] };
const METRICS  = SEED.metrics.length ? SEED.metrics : [
  { key:'selesaiTarif',   label:'Selesai Tarif Check', short:'Selesai Tarif',  side:'tarif' },
  { key:'tidakBisaCheck', label:'Tidak Bisa di-Check', short:'Tidak Bisa',     side:'tarif' },
  { key:'belumTarif',     label:'Belum Selesai Tarif', short:'Belum Tarif',    side:'tarif' },
  { key:'selesaiFaktual', label:'Selesai Faktual',     short:'Selesai Faktual',side:'faktual' },
  { key:'belumFaktual',   label:'Belum Selesai Faktual',short:'Belum Faktual', side:'faktual' },
];
const METRIC_KEYS = METRICS.map(m => m.key);
const TARIF_KEYS  = METRICS.filter(m => m.side === 'tarif').map(m => m.key);
const FAKTUAL_KEYS= METRICS.filter(m => m.side === 'faktual').map(m => m.key);
const CATEGORIES  = SEED.categories.length ? SEED.categories : ['FNP','KSP','OPP','PS1'];

/* ── State ──────────────────────────────────────────────────── */
let currentUser = null;            // { uid, personName, displayName, isAdmin }
let people      = [];              // merged seed + Firestore people
let entryDate   = todayISO();
let dayEntries  = {};              // personName -> entry doc (for entryDate)
let dayCats     = {};              // side -> category doc (for entryDate)
let unsubDay    = null;
let unsubCat    = null;
let activeTab   = 'entry';

/* ════════════════════════════════════════════
   AUTH HELPERS (shared scheme with Holiday Tracker)
════════════════════════════════════════════ */
/* Accounts, password hashing and the session are handled by the shared
   assets/grimoire-auth.js (wmf_user_profiles + ht_session + grimoire_salt),
   so a single sign-in works across every Grimoire app. */

function withTimeout(promise, ms = 12000, label = 'Request'){
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out. Check your connection and retry.')), ms))
  ]);
}

/* ════════════════════════════════════════════
   DATE / FORMAT HELPERS
════════════════════════════════════════════ */
function todayISO(){
  const d = new Date(); const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off*60000).toISOString().slice(0,10);
}
function fmtDate(iso){
  if (!iso || iso.length < 10) return iso || '';
  const [y,m,d] = iso.split('-'); return `${d}.${m}.${y}`;
}
function fmtDay(iso){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dt = new Date(iso + 'T00:00:00');
  return isNaN(dt) ? '' : days[dt.getDay()];
}
function addDays(iso, n){
  const dt = new Date(iso + 'T00:00:00'); dt.setDate(dt.getDate()+n);
  const off = dt.getTimezoneOffset();
  return new Date(dt.getTime() - off*60000).toISOString().slice(0,10);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function n(v){ const x = parseInt(v,10); return isNaN(x) ? 0 : x; }
function sumMetrics(e, keys = METRIC_KEYS){ return keys.reduce((a,k) => a + n(e && e[k]), 0); }

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
let _toastT = null;
function toast(msg, kind = 'ok'){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ════════════════════════════════════════════
   PEOPLE  (seed ∪ Firestore)
════════════════════════════════════════════ */
function seedPeople(){
  return (SEED.people || []).map(p => ({ name:p.name, doesTarif:p.doesTarif!==false, doesFaktual:!!p.doesFaktual, order:p.order ?? 99 }));
}
async function loadPeople(){
  const base = seedPeople();
  const byName = new Map(base.map(p => [p.name, p]));
  try {
    const snap = await withTimeout(peopleCol.get(), 12000, 'Loading team');
    snap.docs.forEach(d => {
      const data = d.data();
      if (!byName.has(data.name)) byName.set(data.name, { name:data.name, doesTarif:data.doesTarif!==false, doesFaktual:!!data.doesFaktual, order:data.order ?? 99 });
    });
  } catch(e){ /* offline → fall back to seed only */ }
  people = [...byName.values()].sort((a,b) => (a.order-b.order) || a.name.localeCompare(b.name));
  return people;
}
function personByName(name){ return people.find(p => p.name === name); }

/* ════════════════════════════════════════════
   AUTH GATE
════════════════════════════════════════════ */
/* currentUser carries a `personName` alias (= displayName) used throughout
   the grid/stats to match a row to the signed-in person. */
function setUser(user){ currentUser = { ...user, personName: user.displayName }; }

async function initAuth(){
  const user = await GrimoireAuth.restore();
  if (user){ setUser(user); await loadPeople(); showApp(); return; }
  showAuthGate();
}

function showAuthGate(){
  currentUser = null;
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('mainApp').style.display  = 'none';
  populateAuthDropdowns();
}
function showApp(){
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('mainApp').style.display  = '';
  paintUserChip();
  document.getElementById('adminTab').style.display = currentUser.isAdmin ? '' : 'none';
  document.getElementById('dateInput').value = entryDate;
  selectTab('entry');
}

function switchAuthTab(tab){
  document.getElementById('tabLogin').classList.toggle('active', tab==='login');
  document.getElementById('tabRegister').classList.toggle('active', tab==='register');
  document.getElementById('loginPanel').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('registerPanel').style.display = tab==='register' ? '' : 'none';
  clearAuthErr();
}
function authErr(id, msg){ const el=document.getElementById(id); el.textContent=msg; el.classList.add('show'); }
function clearAuthErr(){ ['loginError','registerError'].forEach(id=>{const el=document.getElementById(id);el.textContent='';el.classList.remove('show');}); }
function setBusy(btnId, spinId, busy){ document.getElementById(btnId).disabled=busy; document.getElementById(spinId).style.display=busy?'inline-block':'none'; }

async function populateAuthDropdowns(){
  const loginSel = document.getElementById('loginName');
  const regSel   = document.getElementById('registerName');
  loginSel.innerHTML = regSel.innerHTML = '<option value="">— Loading… —</option>';
  await loadPeople();
  let accounts = [];
  try { accounts = await GrimoireAuth.listAccounts(); }
  catch(e){ loginSel.innerHTML = regSel.innerHTML = '<option value="">— Couldn’t load — refresh —</option>'; return; }
  // Match case-insensitively so a roster name like "ARYA" recognises an
  // existing "Arya" account instead of offering a duplicate registration.
  const registeredKeys = new Set(accounts.map(a => GrimoireAuth.nameKey(a)));

  // Sign-in: any registered Grimoire account (shared across apps).
  loginSel.innerHTML = '<option value="">— Select your name —</option>' +
    accounts.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if (accounts.length === 0) loginSel.innerHTML = '<option value="">— No accounts yet — register first —</option>';

  // Register: this team's people who don't have an account yet.
  regSel.innerHTML = '<option value="">— Select your name —</option>';
  people.forEach(p => { if (!registeredKeys.has(GrimoireAuth.nameKey(p.name))) regSel.insertAdjacentHTML('beforeend', `<option value="${esc(p.name)}">${esc(p.name)}</option>`); });
  if (regSel.options.length === 1) regSel.innerHTML = '<option value="">— Everyone has an account —</option>';
}

async function doLogin(){
  clearAuthErr();
  const name = document.getElementById('loginName').value;
  const pw   = document.getElementById('loginPassword').value;
  if (!name || !pw){ authErr('loginError','Select your name and enter your password.'); return; }
  setBusy('loginBtn','loginSpinner',true);
  try {
    const r = await GrimoireAuth.login(name, pw);
    if (!r.ok){ authErr('loginError', r.reason === 'notfound' ? 'No account for that name — use Register.' : r.message); return; }
    setUser(r.user); await loadPeople(); showApp();
  } finally { if (document.getElementById('authGate').style.display !== 'none') setBusy('loginBtn','loginSpinner',false); }
}

async function doRegister(){
  clearAuthErr();
  const name = document.getElementById('registerName').value;
  const pw   = document.getElementById('registerPassword').value;
  const pw2  = document.getElementById('registerConfirm').value;
  if (!name)        { authErr('registerError','Select your name.'); return; }
  if (pw.length < 4){ authErr('registerError','Password must be at least 4 characters.'); return; }
  if (pw !== pw2)   { authErr('registerError','Passwords do not match.'); return; }
  setBusy('registerBtn','registerSpinner',true);
  try {
    const r = await GrimoireAuth.register(name, pw);
    if (!r.ok){ authErr('registerError', r.message); return; }
    setUser(r.user); await loadPeople(); showApp();
    if (r.user.isAdmin) toast('Account created — you are the first user, so you have admin rights.', 'ok');
  } finally { if (document.getElementById('authGate').style.display !== 'none') setBusy('registerBtn','registerSpinner',false); }
}

function signOut(){
  if (unsubDay) unsubDay();
  if (unsubCat) unsubCat();
  GrimoireAuth.signOut(); currentUser = null;
  showAuthGate(); toast('Signed out.');
}

function paintUserChip(){
  document.getElementById('chipName').textContent = currentUser.displayName;
  document.getElementById('chipAvatar').textContent = currentUser.displayName.slice(0,1).toUpperCase();
  document.getElementById('chipCrown').style.display = currentUser.isAdmin ? '' : 'none';
}
function canEdit(personName){ return currentUser && (currentUser.isAdmin || currentUser.personName === personName); }

/* ════════════════════════════════════════════
   TABS
════════════════════════════════════════════ */
function selectTab(tab){
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  if (tab === 'entry')      startDayListener();
  if (tab === 'mystats')    renderMyStats();
  if (tab === 'dashboard')  renderDashboard();
  if (tab === 'categories') startCatListener();
  if (tab === 'admin')      renderAdmin();
}

/* ════════════════════════════════════════════
   DAILY ENTRY  (per-person, edit-locked)
════════════════════════════════════════════ */
function changeDate(iso){
  entryDate = iso || todayISO();
  document.getElementById('dateInput').value = entryDate;
  if (activeTab === 'entry') startDayListener();
  if (activeTab === 'categories') startCatListener();
}
function stepDate(delta){ changeDate(addDays(entryDate, delta)); }

function startDayListener(){
  if (unsubDay) unsubDay();
  document.getElementById('entryMeta').textContent = `${fmtDay(entryDate)} · ${fmtDate(entryDate)}`;
  unsubDay = entryCol.where('date','==',entryDate).onSnapshot(snap => {
    dayEntries = {};
    snap.docs.forEach(d => { const e = d.data(); dayEntries[e.person] = { id:d.id, ...e }; });
    renderEntryGrid();
  }, err => { document.getElementById('entryGrid').innerHTML = `<p class="err-line">Couldn’t load: ${esc(err.message)}</p>`; });
}

function renderEntryGrid(){
  const head = `<tr><th class="name-col">Name</th>` +
    METRICS.map(m => `<th title="${esc(m.label)}">${esc(m.short)}</th>`).join('') +
    `<th>Total</th><th></th></tr>`;

  const rows = people.map(p => {
    const e = dayEntries[p.name] || {};
    const editable = canEdit(p.name);
    const mine = currentUser.personName === p.name;
    const cells = METRICS.map(m => {
      const applies = (m.side === 'tarif' && p.doesTarif) || (m.side === 'faktual' && p.doesFaktual);
      if (!applies) return `<td class="na">—</td>`;
      const val = (e[m.key] ?? '') === '' ? '' : n(e[m.key]);
      return editable
        ? `<td><input class="num-in" type="number" min="0" inputmode="numeric" data-person="${esc(p.name)}" data-key="${m.key}" value="${val}" placeholder="0"></td>`
        : `<td class="ro">${val === '' ? '·' : val}</td>`;
    }).join('');
    const total = sumMetrics(e);
    const saveBtn = editable
      ? `<button class="mini-btn" data-save="${esc(p.name)}">Save</button>`
      : `<span class="lock" title="Only ${esc(p.name)} or an admin can edit this row">🔒</span>`;
    return `<tr class="${mine?'mine':''} ${editable?'':'locked'}">
      <td class="name-col">${esc(p.name)}${mine?' <span class="you">you</span>':''}</td>
      ${cells}<td class="total-col">${total||''}</td><td class="act-col">${saveBtn}</td></tr>`;
  }).join('');

  // daily totals row
  const totalsByKey = METRIC_KEYS.map(k => people.reduce((a,p) => a + n((dayEntries[p.name]||{})[k]), 0));
  const grand = totalsByKey.reduce((a,b) => a+b, 0);
  const totalRow = `<tr class="grand">
    <td class="name-col">TOTAL</td>
    ${totalsByKey.map(t => `<td>${t||''}</td>`).join('')}
    <td class="total-col">${grand||''}</td><td></td></tr>`;

  document.getElementById('entryGrid').innerHTML =
    `<table class="grid"><thead>${head}</thead><tbody>${rows}${totalRow}</tbody></table>`;

  document.querySelectorAll('#entryGrid [data-save]').forEach(btn =>
    btn.addEventListener('click', () => saveRow(btn.dataset.save, btn)));
}

async function saveRow(personName, btn){
  if (!canEdit(personName)){ toast('You can only edit your own row.', 'err'); return; }
  const inputs = document.querySelectorAll(`#entryGrid input[data-person="${CSS.escape(personName)}"]`);
  const payload = { date: entryDate, person: personName, updatedAt: SERVER_TS(), updatedByUid: currentUser.uid };
  METRIC_KEYS.forEach(k => payload[k] = 0);
  inputs.forEach(inp => { payload[inp.dataset.key] = n(inp.value); });
  const old = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try {
    await entryCol.doc(`${entryDate}__${personName}`).set(payload, { merge: true });
    toast(`Saved ${personName} · ${fmtDate(entryDate)}`);
  } catch(e){ toast('Save failed: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = old; }
}

/* ════════════════════════════════════════════
   CATEGORIES  (FNP/KSP/OPP/PS1 — admin editable)
════════════════════════════════════════════ */
function startCatListener(){
  if (unsubCat) unsubCat();
  document.getElementById('catMeta').textContent = `${fmtDay(entryDate)} · ${fmtDate(entryDate)}`;
  unsubCat = catCol.where('date','==',entryDate).onSnapshot(snap => {
    dayCats = {};
    snap.docs.forEach(d => { const c = d.data(); dayCats[c.side] = { id:d.id, ...c }; });
    renderCatGrid();
  }, err => { document.getElementById('catGrid').innerHTML = `<p class="err-line">Couldn’t load: ${esc(err.message)}</p>`; });
}
function renderCatGrid(){
  const sides = [['tarif','Tarif Checking'],['faktual','Faktual Checking']];
  const admin = currentUser.isAdmin;
  const head = `<tr><th class="name-col">Checking</th>${CATEGORIES.map(c=>`<th>${esc(c)}</th>`).join('')}<th>Total</th><th></th></tr>`;
  const rows = sides.map(([side,label]) => {
    const c = dayCats[side] || {};
    const cells = CATEGORIES.map(cat => {
      const val = (c[cat] ?? '') === '' ? '' : n(c[cat]);
      return admin
        ? `<td><input class="num-in" type="number" min="0" inputmode="numeric" data-side="${side}" data-cat="${cat}" value="${val}" placeholder="0"></td>`
        : `<td class="ro">${val===''?'·':val}</td>`;
    }).join('');
    const total = CATEGORIES.reduce((a,cat)=>a+n(c[cat]),0);
    const act = admin ? `<button class="mini-btn" data-savecat="${side}">Save</button>` : `<span class="lock" title="Admin only">🔒</span>`;
    return `<tr><td class="name-col">${esc(label)}</td>${cells}<td class="total-col">${total||''}</td><td class="act-col">${act}</td></tr>`;
  }).join('');
  document.getElementById('catGrid').innerHTML = `<table class="grid"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  if (admin) document.querySelectorAll('#catGrid [data-savecat]').forEach(btn =>
    btn.addEventListener('click', () => saveCat(btn.dataset.savecat, btn)));
}
async function saveCat(side, btn){
  if (!currentUser.isAdmin){ toast('Admin only.', 'err'); return; }
  const payload = { date: entryDate, side, updatedAt: SERVER_TS(), updatedByUid: currentUser.uid };
  document.querySelectorAll(`#catGrid input[data-side="${side}"]`).forEach(inp => payload[inp.dataset.cat] = n(inp.value));
  const old = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try { await catCol.doc(`${entryDate}__${side}`).set(payload, { merge:true }); toast(`Saved ${side} totals · ${fmtDate(entryDate)}`); }
  catch(e){ toast('Save failed: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = old; }
}

/* ════════════════════════════════════════════
   MY STATS  (logged-in user's own history)
════════════════════════════════════════════ */
async function renderMyStats(){
  const wrap = document.getElementById('myStats');
  wrap.innerHTML = `<p class="muted">Loading your history…</p>`;
  let docs = [];
  try { docs = (await entryCol.where('person','==',currentUser.personName).get()).docs.map(d=>d.data()); }
  catch(e){ wrap.innerHTML = `<p class="err-line">Couldn’t load: ${esc(e.message)}</p>`; return; }
  docs.sort((a,b)=>b.date.localeCompare(a.date));
  const totals = {}; METRIC_KEYS.forEach(k=>totals[k]=0);
  docs.forEach(e=>METRIC_KEYS.forEach(k=>totals[k]+=n(e[k])));
  const grand = Object.values(totals).reduce((a,b)=>a+b,0);

  const cards = METRICS.map(m=>`<div class="stat"><div class="stat-num">${totals[m.key]}</div><div class="stat-lbl">${esc(m.short)}</div></div>`).join('');
  const head = `<tr><th>Date</th>${METRICS.map(m=>`<th>${esc(m.short)}</th>`).join('')}<th>Total</th></tr>`;
  const rows = docs.slice(0,60).map(e=>`<tr><td class="name-col">${fmtDate(e.date)}</td>${METRIC_KEYS.map(k=>`<td>${n(e[k])||''}</td>`).join('')}<td class="total-col">${sumMetrics(e)||''}</td></tr>`).join('')
    || `<tr><td colspan="${METRICS.length+2}" class="muted" style="text-align:center;padding:20px">No entries yet — add some on the Daily Entry tab.</td></tr>`;

  wrap.innerHTML = `
    <div class="stat-row"><div class="stat hero"><div class="stat-num">${grand}</div><div class="stat-lbl">All-time total · ${docs.length} day(s)</div></div>${cards}</div>
    <div class="table-scroll"><table class="grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

/* ════════════════════════════════════════════
   TEAM DASHBOARD
════════════════════════════════════════════ */
async function renderDashboard(){
  const wrap = document.getElementById('dashboard');
  const range = document.getElementById('rangeSel')?.value || '30';
  wrap.querySelector('.dash-body').innerHTML = `<p class="muted">Loading…</p>`;
  let q = entryCol;
  let start = null;
  if (range !== 'all'){ start = addDays(todayISO(), -parseInt(range,10)); q = entryCol.where('date','>=',start); }
  let docs = [];
  try { docs = (await q.get()).docs.map(d=>d.data()); }
  catch(e){ wrap.querySelector('.dash-body').innerHTML = `<p class="err-line">Couldn’t load: ${esc(e.message)}</p>`; return; }

  // per-metric totals + per-person
  const mTot = {}; METRIC_KEYS.forEach(k=>mTot[k]=0);
  const perPerson = {};
  const dates = new Set();
  docs.forEach(e=>{
    dates.add(e.date);
    METRIC_KEYS.forEach(k=>mTot[k]+=n(e[k]));
    perPerson[e.person] = perPerson[e.person] || {name:e.person, total:0};
    perPerson[e.person].total += sumMetrics(e);
  });
  const grand = Object.values(mTot).reduce((a,b)=>a+b,0);

  const metricCards = METRICS.map(m=>{
    const pct = grand ? Math.round(mTot[m.key]/grand*100) : 0;
    return `<div class="stat"><div class="stat-num">${mTot[m.key]}</div><div class="stat-lbl">${esc(m.short)}</div>
      <div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }).join('');

  const board = Object.values(perPerson).sort((a,b)=>b.total-a.total);
  const max = board[0]?.total || 1;
  const boardRows = board.map((p,i)=>`
    <div class="lb-row">
      <span class="lb-rank">${i+1}</span>
      <span class="lb-name">${esc(p.name)}${p.name===currentUser.personName?' <span class="you">you</span>':''}</span>
      <span class="lb-bar"><span style="width:${Math.round(p.total/max*100)}%"></span></span>
      <span class="lb-val">${p.total}</span>
    </div>`).join('') || `<p class="muted">No data in range.</p>`;

  wrap.querySelector('.dash-body').innerHTML = `
    <div class="stat-row">
      <div class="stat hero"><div class="stat-num">${grand}</div><div class="stat-lbl">Total checked · ${dates.size} day(s)</div></div>
      ${metricCards}
    </div>
    <h3 class="sub-h">Leaderboard <span class="muted">— by total checked</span></h3>
    <div class="leaderboard">${boardRows}</div>`;
}

/* ════════════════════════════════════════════
   ADMIN  (import + accounts)
════════════════════════════════════════════ */
async function renderAdmin(){
  if (!currentUser.isAdmin){ document.getElementById('adminBody').innerHTML = '<p class="muted">Admins only.</p>'; return; }
  const body = document.getElementById('adminBody');
  body.innerHTML = `<p class="muted">Loading accounts…</p>`;
  let profs = [];
  try { profs = await GrimoireAuth.listProfiles(); } catch(e){}
  const seedCount = (SEED.entries||[]).length + (SEED.categoryEntries||[]).length;
  const accRows = profs.map(p=>`<tr>
      <td class="name-col">${esc(p.displayName)} ${p.isAdmin?'<span class="crown">👑</span>':''}</td>
      <td>${p.uid===currentUser.uid?'<span class="muted">this is you</span>':
        (p.isAdmin?`<button class="mini-btn" data-demote="${esc(p.uid)}">Revoke admin</button>`
                  :`<button class="mini-btn" data-promote="${esc(p.uid)}">Make admin</button>`)}</td>
    </tr>`).join('') || `<tr><td colspan="2" class="muted">No accounts.</td></tr>`;

  body.innerHTML = `
    <div class="admin-card">
      <h3 class="sub-h">Import history</h3>
      <p class="muted">Push the ${seedCount.toLocaleString()} records bundled from <code>REPORT DATA.xlsx</code>
        (${(SEED.entries||[]).length} person-days + ${(SEED.categoryEntries||[]).length} category-days) into Firebase.
        Safe to run again — existing days are overwritten, not duplicated.</p>
      <div class="row-gap">
        <button class="btn primary" id="importBtn">Import history → Firebase</button>
        <span id="importStatus" class="muted"></span>
      </div>
      <div class="progress" id="importProg" style="display:none"><span></span></div>
    </div>
    <div class="admin-card">
      <h3 class="sub-h">Accounts</h3>
      <table class="grid"><tbody>${accRows}</tbody></table>
    </div>`;

  document.getElementById('importBtn').addEventListener('click', runImport);
  body.querySelectorAll('[data-promote]').forEach(b=>b.addEventListener('click',()=>setAdmin(b.dataset.promote,true)));
  body.querySelectorAll('[data-demote]').forEach(b=>b.addEventListener('click',()=>setAdmin(b.dataset.demote,false)));
}

async function setAdmin(uid, val){
  try { await GrimoireAuth.setAdmin(uid, val); toast(val?'Granted admin.':'Revoked admin.'); renderAdmin(); }
  catch(e){ toast('Failed: '+e.message,'err'); }
}

async function runImport(){
  if (!currentUser.isAdmin) return;
  const btn = document.getElementById('importBtn');
  const status = document.getElementById('importStatus');
  const prog = document.getElementById('importProg');
  btn.disabled = true; prog.style.display = ''; const bar = prog.querySelector('span');

  // Build the full write list
  const writes = [];
  (SEED.people||[]).forEach(p => writes.push({ ref: peopleCol.doc(GrimoireAuth.makeUid(p.name)),
    data: { name:p.name, doesTarif:p.doesTarif!==false, doesFaktual:!!p.doesFaktual, order:p.order ?? 99 } }));
  (SEED.entries||[]).forEach(e => {
    const d = { date:e.date, person:e.person, updatedAt:SERVER_TS(), importedAt:SERVER_TS() };
    METRIC_KEYS.forEach(k => d[k] = n(e[k]));
    writes.push({ ref: entryCol.doc(`${e.date}__${e.person}`), data:d });
  });
  (SEED.categoryEntries||[]).forEach(c => {
    const d = { date:c.date, side:c.side, updatedAt:SERVER_TS(), importedAt:SERVER_TS() };
    CATEGORIES.forEach(cat => d[cat] = n(c[cat]));
    writes.push({ ref: catCol.doc(`${c.date}__${c.side}`), data:d });
  });

  try {
    const CHUNK = 400; let done = 0;
    for (let i=0; i<writes.length; i+=CHUNK){
      const batch = db.batch();
      writes.slice(i, i+CHUNK).forEach(w => batch.set(w.ref, w.data, { merge:true }));
      await batch.commit();
      done = Math.min(i+CHUNK, writes.length);
      const pct = Math.round(done/writes.length*100);
      bar.style.width = pct+'%';
      status.textContent = `Imported ${done.toLocaleString()} / ${writes.length.toLocaleString()} (${pct}%)`;
    }
    status.textContent = `✓ Done — ${writes.length.toLocaleString()} records imported.`;
    toast('History imported.');
    await loadPeople();
  } catch(e){
    status.textContent = '✗ ' + e.message;
    toast('Import failed: ' + e.message, 'err');
  } finally { btn.disabled = false; }
}

/* ════════════════════════════════════════════
   WIRE-UP
════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  document.getElementById('dateInput').addEventListener('change', e => changeDate(e.target.value));
  document.getElementById('prevDay').addEventListener('click', () => stepDate(-1));
  document.getElementById('nextDay').addEventListener('click', () => stepDate(1));
  document.getElementById('todayBtn').addEventListener('click', () => changeDate(todayISO()));
  document.getElementById('rangeSel')?.addEventListener('change', renderDashboard);
  document.getElementById('signOutBtn').addEventListener('click', signOut);

  // Enter-to-submit on auth
  ['loginPassword'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); }));
  ['registerConfirm'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') doRegister(); }));

  initAuth();
});

// expose handlers used by inline onclick in the auth gate
window.switchAuthTab = switchAuthTab;
window.doLogin = doLogin;
window.doRegister = doRegister;
