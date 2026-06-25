/* ══════════════════════════════════════════════════════════════
   OPERATION REPORT — daily tarif/faktual checking tracker
   ──────────────────────────────────────────────────────────────
   • Shared Firebase backend (same vb-code-vault project)
   • Custom name + password login (no Firebase Auth), mirroring
     the Holiday Tracker. Each user may only edit the row that
     carries their own name; admins may edit everyone.
   • History is imported by an admin who UPLOADS REPORT DATA.xlsx
     on the Admin tab: the workbook is parsed in the browser (SheetJS)
     and the parsed person-days + category-days are pushed to Firestore
     (idempotent — existing days are overwritten, not duplicated).
     report-data-seed.js still provides the default roster / metric /
     category definitions for the sign-in screen and grid.
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

/* ── Belum-Tarif reason gate ────────────────────────────────────
   Rule: when a person's unfinished tarif work ("Belum Tarif") is
   MORE THAN 50% of their TOTAL tarif work ("Selesai Tarif" +
   "Tidak Bisa" + "Belum Tarif"), they must record a reason when
   saving. The reason is stored on the entry and shown on the shared
   daily board, so anyone can see it. Faktual-only people have no
   tarif numbers, so the gate never applies to them. */
const BELUM_TARIF_KEYS = TARIF_KEYS.filter(k => /belum/i.test(k));  // belumTarif
const BELUM_THRESHOLD  = 0.5;
function belumStats(e){
  const belum = BELUM_TARIF_KEYS.reduce((a,k) => a + n(e && e[k]), 0);
  const base  = TARIF_KEYS.reduce((a,k) => a + n(e && e[k]), 0); // Selesai Tarif + Tidak Bisa + Belum Tarif
  return { belum, base, over: belum > base * BELUM_THRESHOLD };
}

/* ── State ──────────────────────────────────────────────────── */
let currentUser = null;            // { uid, personName, displayName, isAdmin }
let people      = [];              // merged seed + Firestore people
let entryDate   = todayISO();
let dayEntries  = {};              // personName -> entry doc (for entryDate)
let dayCats     = {};              // side -> category doc (for entryDate)
let unsubDay    = null;
let unsubCat    = null;
let activeTab   = 'entry';
let lastDashDocs= [];              // entries from the last Team Dashboard render (for export)
let lastMyDocs  = [];              // entries from the last My Stats render (for export)

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
/* currentUser carries a `personName` alias used throughout the grid/stats to
   match a row to the signed-in person. It starts as the account's displayName
   and is snapped to the canonical roster name by resolvePersonName() once the
   roster is loaded — see that function for why. */
function setUser(user){ currentUser = { ...user, personName: user.displayName }; }

/* Snap the signed-in account to its roster person by nameKey (case/space-
   insensitive). Entries store `person` in roster casing (e.g. "NICO", "Rizky"),
   but accounts can be registered with different casing (e.g. "Nico") — directly
   or via shared SSO from another Grimoire app. Without this, the exact-match
   `where('person','==',personName)` query hides the user's My Stats and the
   canEdit / "mine" checks lock them out of their own Daily Entry row. */
function resolvePersonName(){
  if (!currentUser) return;
  const key = GrimoireAuth.nameKey(currentUser.displayName);
  const match = people.find(p => GrimoireAuth.nameKey(p.name) === key);
  currentUser.personName = match ? match.name : currentUser.displayName;
}

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
  resolvePersonName();   // align personName with the roster casing used in entries
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
    const mainRow = `<tr class="${mine?'mine':''} ${editable?'':'locked'}">
      <td class="name-col">${esc(p.name)}${mine?' <span class="you">you</span>':''}</td>
      ${cells}<td class="total-col">${total||''}</td><td class="act-col">${saveBtn}</td></tr>`;
    return mainRow + reasonRowHTML(p, e, editable);
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
  // Reveal/hide the reason field live as the numbers change.
  document.querySelectorAll('#entryGrid input.num-in').forEach(inp =>
    inp.addEventListener('input', () => recomputeRow(inp.dataset.person)));
}

/* Reason sub-row shown under a person when Belum Selesai > 50% of
   Selesai + Tidak Bisa. Editable rows get an input (always rendered,
   hidden until the threshold trips); other people's rows show the
   saved reason as read-only text so anyone can look. */
function reasonRowHTML(p, e, editable){
  const colspan = METRICS.length + 2;
  const reason  = (e.belumReason || '').trim();
  if (editable){
    const show = belumStats(e).over;
    return `<tr class="reason-row" data-reason-for="${esc(p.name)}" style="display:${show?'':'none'}">
      <td></td><td colspan="${colspan}" class="reason-cell">
        <div class="reason-wrap">
          <span class="reason-flag">⚠ Belum Tarif is over 50% of total Tarif (Selesai + Tidak Bisa + Belum) — reason required</span>
          <input class="reason-in" type="text" maxlength="300" data-person="${esc(p.name)}"
                 value="${esc(reason)}" placeholder="Explain why so much is unfinished…">
        </div></td></tr>`;
  }
  if (reason){
    return `<tr class="reason-row ro" data-reason-for="${esc(p.name)}">
      <td></td><td colspan="${colspan}" class="reason-cell">
        <div class="reason-wrap"><span class="reason-flag">⚠ Belum Tarif over 50%:</span>
        <span class="reason-text">${esc(reason)}</span></div></td></tr>`;
  }
  return '';
}

/* Recompute one row's live values and toggle its reason field. */
function recomputeRow(name){
  const e = {};
  document.querySelectorAll(`#entryGrid input.num-in[data-person="${CSS.escape(name)}"]`)
    .forEach(inp => { e[inp.dataset.key] = n(inp.value); });
  const row = document.querySelector(`#entryGrid tr.reason-row[data-reason-for="${CSS.escape(name)}"]`);
  if (row) row.style.display = belumStats(e).over ? '' : 'none';
}

async function saveRow(personName, btn){
  if (!canEdit(personName)){ toast('You can only edit your own row.', 'err'); return; }
  const inputs = document.querySelectorAll(`#entryGrid input.num-in[data-person="${CSS.escape(personName)}"]`);
  const payload = { date: entryDate, person: personName, updatedAt: SERVER_TS(), updatedByUid: currentUser.uid };
  METRIC_KEYS.forEach(k => payload[k] = 0);
  inputs.forEach(inp => { payload[inp.dataset.key] = n(inp.value); });

  // Reason gate: too much unfinished work must be justified before saving.
  const stats = belumStats(payload);
  const reasonInput = document.querySelector(`#entryGrid input.reason-in[data-person="${CSS.escape(personName)}"]`);
  const reason = reasonInput ? reasonInput.value.trim() : '';
  if (stats.over && !reason){
    const row = document.querySelector(`#entryGrid tr.reason-row[data-reason-for="${CSS.escape(personName)}"]`);
    if (row) row.style.display = '';
    if (reasonInput) reasonInput.focus();
    toast(`Belum Tarif (${stats.belum}) is over 50% of total Tarif checked (${stats.base}). Add a reason to save.`, 'err');
    return;
  }
  payload.belumReason = stats.over ? reason : '';   // clear stale reason once back under threshold

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
  lastMyDocs = docs;
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
  lastDashDocs = docs;

  // per-metric totals + per-person (overall total and per-metric counts)
  const mTot = {}; METRIC_KEYS.forEach(k=>mTot[k]=0);
  const perPerson = {};
  const dates = new Set();
  docs.forEach(e=>{
    dates.add(e.date);
    const pp = perPerson[e.person] = perPerson[e.person] || { name:e.person, total:0, by:{} };
    METRIC_KEYS.forEach(k=>{ const v = n(e[k]); mTot[k]+=v; pp.by[k]=(pp.by[k]||0)+v; });
    pp.total += sumMetrics(e);
  });
  const grand = Object.values(mTot).reduce((a,b)=>a+b,0);

  // Which metric to rank the board by — 'all' = combined total (default).
  const metric    = document.getElementById('metricSel')?.value || 'all';
  const metricLbl = metric==='all' ? 'total checked' : (METRICS.find(m=>m.key===metric)?.short || metric);
  const valueOf   = p => metric==='all' ? (p?.total||0) : (p?.by?.[metric]||0);

  // Metric cards double as filters: click one to rank by it.
  const metricCards = METRICS.map(m=>{
    const pct = grand ? Math.round(mTot[m.key]/grand*100) : 0;
    return `<div class="stat metric-card${m.key===metric?' active':''}" data-metric="${m.key}" title="Rank the leaderboard by ${esc(m.short)}">
      <div class="stat-num">${mTot[m.key]}</div><div class="stat-lbl">${esc(m.short)}</div>
      <div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }).join('');

  const board = Object.values(perPerson).sort((a,b)=>valueOf(b)-valueOf(a));
  const max = valueOf(board[0]) || 1;
  const boardRows = board.map((p,i)=>`
    <div class="lb-row">
      <span class="lb-rank">${i+1}</span>
      <span class="lb-name">${esc(p.name)}${p.name===currentUser.personName?' <span class="you">you</span>':''}</span>
      <span class="lb-bar"><span style="width:${Math.round(valueOf(p)/max*100)}%"></span></span>
      <span class="lb-val">${valueOf(p)}</span>
    </div>`).join('') || `<p class="muted">No data in range.</p>`;

  wrap.querySelector('.dash-body').innerHTML = `
    <div class="stat-row">
      <div class="stat hero metric-card${metric==='all'?' active':''}" data-metric="all" title="Rank by combined total">
        <div class="stat-num">${grand}</div><div class="stat-lbl">Total checked · ${dates.size} day(s)</div></div>
      ${metricCards}
    </div>
    <h3 class="sub-h">Leaderboard <span class="muted">— by ${esc(metricLbl)}</span></h3>
    <div class="leaderboard">${boardRows}</div>`;

  // Clicking a card (or the hero) re-ranks the board by that metric.
  wrap.querySelectorAll('.dash-body [data-metric]').forEach(el =>
    el.addEventListener('click', () => {
      const sel = document.getElementById('metricSel');
      if (sel) sel.value = el.dataset.metric;
      renderDashboard();
    }));
}

/* ════════════════════════════════════════════
   EXCEL IMPORT  (parse REPORT DATA.xlsx in the browser)
   ────────────────────────────────────────────
   Admins upload the workbook on the Admin tab; we read it client-side
   with SheetJS and turn it into the same { people, entries,
   categoryEntries } shape the old baked-in seed used, then push it to
   Firestore via runImport(). Same CDN as alokasi-project.html.
════════════════════════════════════════════ */
function loadXLSX(){
  return new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload  = () => res(window.XLSX);
    s.onerror = () => rej(new Error('Could not load the Excel library (offline?).'));
    document.head.appendChild(s);
  });
}

/* Which workbook sheet carries what. Matched case/space-insensitively so
   small header drift in REPORT DATA.xlsx still imports cleanly. */
const SHEET_MAP = {
  'TOTAL TARIF CHECKING':            { kind:'category', side:'tarif'   },
  'TOTAL FAKTUAL CHECKING':          { kind:'category', side:'faktual' },
  'TOTAL SUDAH SELESAI TARIF CHECK': { kind:'person',   metric:'selesaiTarif'   },
  'DATA YG GK BISA DI CHECK':        { kind:'person',   metric:'tidakBisaCheck' },
  'TOTAL BELUM SELESAI TARIF CHECK': { kind:'person',   metric:'belumTarif'     },
  'TOTAL SELESAI FAKTUAL':           { kind:'person',   metric:'selesaiFaktual' },
  'TOTAL BELUM SELESAI FAKTUAL':     { kind:'person',   metric:'belumFaktual'   },
};
const normSheet = s => String(s||'').toUpperCase().replace(/\s+/g,' ').trim();
const sideOfMetric = k => (METRICS.find(m => m.key === k) || {}).side;

/* Dates in REPORT DATA.xlsx are mostly "DD.MM.YYYY" strings, but the workbook
   is hand-kept and messy: real Excel dates (JS Date), a date that lost its
   separator and became a number (13.112025 → 13.11.2025), and stray/duplicated
   separators ("23.12..2025", "10/04/.2026"). Recover all of them so an upload
   matches the data the team actually typed. Returns 'YYYY-MM-DD' or '' when the
   cell isn't a date. */
function toISO(v){
  if (v == null || v === '') return '';
  if (v instanceof Date){
    if (isNaN(v)) return '';
    const off = v.getTimezoneOffset();
    return new Date(v.getTime() - off*60000).toISOString().slice(0,10);
  }
  if (typeof v === 'number'){
    if (Number.isInteger(v) && v >= 20000 && v <= 60000){      // genuine Excel 1900 serial
      const d = new Date(Math.round((v - 25569) * 86400000));
      return isNaN(d) ? '' : d.toISOString().slice(0,10);
    }
    v = String(v);   // typo'd date that became a decimal number → parse as text below
  }
  let s = String(v).trim();
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);   // clean DD.MM.YYYY
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                  // already ISO
  m = s.match(/^(\d{1,2})[.\/-](\d{2})(\d{4})$/);              // dropped separator: 13.112025
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2,'0')}`;
  s = s.replace(/[.\/\-\s]+/g, '.');                            // collapse messy separators
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
}

function parseReportWorkbook(buf, XLSX){
  const wb = XLSX.read(buf, { type:'array', cellDates:true });
  const entriesMap = new Map();   // `${iso}__${person}` -> entry
  const catMap     = new Map();   // `${iso}__${side}`   -> category-day
  const peopleSeen = new Map();   // name -> { name, doesTarif, doesFaktual, order }
  let order = 0;
  const matchedSheets = [], skippedSheets = [];
  // Rows that carry real numbers but whose date cell couldn't be read are
  // silently lost on import — track them so the admin sees the data loss.
  let skippedRows = 0; const skippedSamples = [];
  const recordSkip = (raw) => {
    skippedRows++;
    const s = raw instanceof Date ? 'Invalid Date' : String(raw).trim();
    if (s && skippedSamples.length < 8 && !skippedSamples.includes(s)) skippedSamples.push(s);
  };
  const rowHasData = (row, cols) => Object.keys(cols).some(ci => n(row[ci]) > 0);
  // Only flag cells that were clearly *meant* to be a date: a broken Date object,
  // or text containing a digit. This skips total/label rows like "SUMME".
  const looksLikeDate = (raw) => {
    if (raw == null) return false;
    if (raw instanceof Date) return isNaN(raw);
    const s = String(raw).trim();
    return s !== '' && /\d/.test(s);
  };

  wb.SheetNames.forEach(sheetName => {
    const spec = SHEET_MAP[normSheet(sheetName)];
    if (!spec){ skippedSheets.push(sheetName); return; }
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
    if (!grid.length) return;
    matchedSheets.push(sheetName);

    const header  = (grid[0] || []).map(h => String(h == null ? '' : h).trim());
    let dateCol = header.findIndex(h => /^date$/i.test(h));
    if (dateCol < 0) dateCol = 0;

    if (spec.kind === 'category'){
      // header: date, FNP, KSP, OPP, PS1, SUMME  (FNP sometimes has a stray space)
      const cols = {}; // colIndex -> category
      header.forEach((h, ci) => { const k = h.toUpperCase().replace(/\s+/g,''); if (CATEGORIES.includes(k)) cols[ci] = k; });
      for (let r = 1; r < grid.length; r++){
        const row = grid[r]; if (!row) continue;
        const iso = toISO(row[dateCol]);
        if (!iso){ if (looksLikeDate(row[dateCol]) && rowHasData(row, cols)) recordSkip(row[dateCol]); continue; }
        const key = `${iso}__${spec.side}`;
        const obj = catMap.get(key) || { date:iso, side:spec.side };
        Object.entries(cols).forEach(([ci, cat]) => { const val = n(row[ci]); if (val) obj[cat] = val; });
        catMap.set(key, obj);
      }
    } else {
      // person sheet: header DATE, <people…>, SUMME
      const cols = {}; // colIndex -> person name
      header.forEach((h, ci) => {
        if (ci === dateCol) return;
        const name = h.trim();
        if (!name || /^(summe|total|date|tanggal)$/i.test(name)) return;
        cols[ci] = name;
        let p = peopleSeen.get(name);
        if (!p){ p = { name, doesTarif:false, doesFaktual:false, order:order++ }; peopleSeen.set(name, p); }
        if (spec.metric && sideOfMetric(spec.metric) === 'faktual') p.doesFaktual = true; else p.doesTarif = true;
      });
      for (let r = 1; r < grid.length; r++){
        const row = grid[r]; if (!row) continue;
        const iso = toISO(row[dateCol]);
        if (!iso){ if (looksLikeDate(row[dateCol]) && rowHasData(row, cols)) recordSkip(row[dateCol]); continue; }
        Object.entries(cols).forEach(([ci, name]) => {
          const val = n(row[ci]); if (!val) return;   // keep entries sparse; blanks/zeros default to 0 on write
          const key = `${iso}__${name}`;
          const e = entriesMap.get(key) || { date:iso, person:name };
          e[spec.metric] = val;
          entriesMap.set(key, e);
        });
      }
    }
  });

  return {
    people:          [...peopleSeen.values()],
    entries:         [...entriesMap.values()],
    categoryEntries: [...catMap.values()],
    matchedSheets, skippedSheets,
    skippedRows, skippedSamples,
  };
}

/* ════════════════════════════════════════════
   ADMIN  (import + accounts)
════════════════════════════════════════════ */
let pendingImport = null;   // parsed workbook awaiting the admin's confirm

async function renderAdmin(){
  if (!currentUser.isAdmin){ document.getElementById('adminBody').innerHTML = '<p class="muted">Admins only.</p>'; return; }
  const body = document.getElementById('adminBody');
  body.innerHTML = `<p class="muted">Loading accounts…</p>`;
  let profs = [];
  try { profs = await GrimoireAuth.listProfiles(); } catch(e){}
  const accRows = profs.map(p=>`<tr>
      <td class="name-col">${esc(p.displayName)} ${p.isAdmin?'<span class="crown">👑</span>':''}</td>
      <td>${p.uid===currentUser.uid?'<span class="muted">this is you</span>':
        (p.isAdmin?`<button class="mini-btn" data-demote="${esc(p.uid)}">Revoke admin</button>`
                  :`<button class="mini-btn" data-promote="${esc(p.uid)}">Make admin</button>`)}</td>
    </tr>`).join('') || `<tr><td colspan="2" class="muted">No accounts.</td></tr>`;

  body.innerHTML = `
    <div class="admin-card">
      <h3 class="sub-h">Import history</h3>
      <p class="muted">Upload <code>REPORT DATA.xlsx</code> to push its full history into the shared board.
        The file is read in your browser — nothing is uploaded anywhere except the parsed numbers, which go to Firebase.
        Safe to re-run — existing days are overwritten, not duplicated.</p>
      <div class="row-gap">
        <input type="file" id="importFile" accept=".xlsx,.xls" style="display:none">
        <button class="btn" id="chooseFileBtn">📄 Choose Excel file…</button>
        <span id="fileName" class="muted"></span>
      </div>
      <div id="importPreview" class="muted" style="margin-top:10px"></div>
      <div class="row-gap">
        <button class="btn primary" id="importBtn" disabled>Import history → Firebase</button>
        <span id="importStatus" class="muted"></span>
      </div>
      <div class="progress" id="importProg" style="display:none"><span></span></div>
    </div>
    <div class="admin-card">
      <h3 class="sub-h">Accounts</h3>
      <table class="grid"><tbody>${accRows}</tbody></table>
    </div>`;

  pendingImport = null;
  const fileInput = document.getElementById('importFile');
  document.getElementById('chooseFileBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => onImportFile(fileInput.files[0]));
  document.getElementById('importBtn').addEventListener('click', () => runImport(pendingImport));
  body.querySelectorAll('[data-promote]').forEach(b=>b.addEventListener('click',()=>setAdmin(b.dataset.promote,true)));
  body.querySelectorAll('[data-demote]').forEach(b=>b.addEventListener('click',()=>setAdmin(b.dataset.demote,false)));
}

/* Read + parse the chosen workbook, show a summary, and arm the Import button. */
async function onImportFile(file){
  const preview   = document.getElementById('importPreview');
  const nameEl    = document.getElementById('fileName');
  const importBtn = document.getElementById('importBtn');
  const status    = document.getElementById('importStatus');
  pendingImport = null; importBtn.disabled = true; status.textContent = '';
  if (!file){ nameEl.textContent = ''; preview.innerHTML = ''; return; }
  nameEl.textContent = file.name;
  preview.innerHTML = 'Reading…';
  try {
    const XLSX = await loadXLSX();
    const buf  = await file.arrayBuffer();
    const data = parseReportWorkbook(buf, XLSX);
    if (!data.entries.length && !data.categoryEntries.length){
      preview.innerHTML = `<span style="color:var(--red)">No recognisable sheets found — expected sheets like “TOTAL SUDAH SELESAI TARIF CHECK”.</span>`;
      return;
    }
    pendingImport = data;
    const dates = [...data.entries, ...data.categoryEntries].map(x => x.date).filter(Boolean).sort();
    const span  = dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length-1])}` : '—';
    preview.innerHTML =
      `Parsed <b>${data.entries.length.toLocaleString()}</b> person-days + ` +
      `<b>${data.categoryEntries.length.toLocaleString()}</b> category-days · ` +
      `<b>${data.people.length}</b> people · ${esc(span)}.` +
      (data.skippedRows ? `<br><span style="color:var(--red)">⚠ ${data.skippedRows.toLocaleString()} row(s) skipped — their date couldn't be read` +
        (data.skippedSamples.length ? ` (e.g. ${esc(data.skippedSamples.slice(0,5).join(', '))})` : '') +
        `. Fix those dates in the workbook and re-upload, or they won't be imported.</span>` : '') +
      (data.skippedSheets.length ? `<br><span class="muted">Skipped sheets: ${esc(data.skippedSheets.join(', '))}</span>` : '');
    importBtn.disabled = false;
  } catch(e){
    preview.innerHTML = `<span style="color:var(--red)">Couldn’t read file: ${esc(e.message)}</span>`;
  }
}

async function setAdmin(uid, val){
  try { await GrimoireAuth.setAdmin(uid, val); toast(val?'Granted admin.':'Revoked admin.'); renderAdmin(); }
  catch(e){ toast('Failed: '+e.message,'err'); }
}

async function runImport(data){
  if (!currentUser.isAdmin) return;
  if (!data || (!data.entries?.length && !data.categoryEntries?.length)){
    toast('Choose a REPORT DATA.xlsx file first.', 'err'); return;
  }
  const btn = document.getElementById('importBtn');
  const status = document.getElementById('importStatus');
  const prog = document.getElementById('importProg');
  btn.disabled = true; prog.style.display = ''; const bar = prog.querySelector('span');

  // Build the full write list from the uploaded workbook
  const writes = [];
  (data.people||[]).forEach(p => writes.push({ ref: peopleCol.doc(GrimoireAuth.makeUid(p.name)),
    data: { name:p.name, doesTarif:p.doesTarif!==false, doesFaktual:!!p.doesFaktual, order:p.order ?? 99 } }));
  (data.entries||[]).forEach(e => {
    const d = { date:e.date, person:e.person, updatedAt:SERVER_TS(), importedAt:SERVER_TS() };
    METRIC_KEYS.forEach(k => d[k] = n(e[k]));
    writes.push({ ref: entryCol.doc(`${e.date}__${e.person}`), data:d });
  });
  (data.categoryEntries||[]).forEach(c => {
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
   EXPORT  (.xlsx via SheetJS — the Date column is written as a real
   date typed to dd.mm.yyyy, so Excel can't re-guess DD.MM vs MM.DD per
   its locale the way it does with a plain-text CSV. Reuses loadXLSX().)
════════════════════════════════════════════ */
/* ISO date → Excel serial day number (epoch 1899-12-30). UTC math
   keeps it free of timezone/DST drift. */
function excelDateSerial(iso){
  if (!iso || iso.length < 10) return null;
  const [y,m,d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m-1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}
/* One row per person-day: Date[, Person], every metric, Total, Reason.
   Column A is written as a real date locked to one format. */
async function exportXLSX(filename, sheetName, docs, includePerson){
  const XLSX = await loadXLSX();
  const head = ['Date'];
  if (includePerson) head.push('Person');
  METRICS.forEach(m => head.push(m.label));
  head.push('Total', 'Reason');

  const sorted = [...docs].sort((a,b) =>
    (a.date||'').localeCompare(b.date||'') || (a.person||'').localeCompare(b.person||''));

  const aoa = [head];
  sorted.forEach(e => {
    const row = [e.date || '']; // placeholder; turned into a real date cell below
    if (includePerson) row.push(e.person || '');
    METRIC_KEYS.forEach(k => row.push(n(e[k])));
    row.push(sumMetrics(e), e.belumReason || '');
    aoa.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Lock column A to a single date format so every row reads the same.
  for (let r = 1; r < aoa.length; r++){
    const addr   = XLSX.utils.encode_cell({ r, c: 0 });
    const serial = excelDateSerial(sorted[r-1].date);
    ws[addr] = serial == null
      ? { t:'s', v: sorted[r-1].date || '' }
      : { t:'n', v: serial, z: 'dd.mm.yyyy' };
  }
  ws['!cols'] = head.map((h,i) => ({ wch: i === 0 ? 12 : Math.max(h.length + 2, 10) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
async function exportDashboard(){
  if (!lastDashDocs.length){ toast('Nothing to export for this range.', 'err'); return; }
  const range = document.getElementById('rangeSel')?.value || '30';
  const tag   = range === 'all' ? 'all-time' : `last-${range}d`;
  try {
    await exportXLSX(`operation-report_${tag}_${todayISO()}.xlsx`, 'Team Dashboard', lastDashDocs, true);
    toast(`Exported ${lastDashDocs.length} row(s).`);
  } catch(e){ toast('Export failed: ' + e.message, 'err'); }
}
async function exportMyStats(){
  if (!lastMyDocs.length){ toast('No entries to export yet.', 'err'); return; }
  const who = (currentUser.personName || 'me').replace(/[^\w-]+/g, '_');
  try {
    await exportXLSX(`operation-report_${who}_${todayISO()}.xlsx`, 'My Stats', lastMyDocs, false);
    toast(`Exported ${lastMyDocs.length} day(s).`);
  } catch(e){ toast('Export failed: ' + e.message, 'err'); }
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
  const metricSel = document.getElementById('metricSel');
  if (metricSel) metricSel.innerHTML = '<option value="all">All metrics</option>' +
    METRICS.map(m => `<option value="${esc(m.key)}">${esc(m.short)}</option>`).join('');
  document.getElementById('rangeSel')?.addEventListener('change', renderDashboard);
  metricSel?.addEventListener('change', renderDashboard);
  document.getElementById('exportDashBtn')?.addEventListener('click', exportDashboard);
  document.getElementById('exportMyBtn')?.addEventListener('click', exportMyStats);
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
