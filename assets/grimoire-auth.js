/* ══════════════════════════════════════════════════════════════
   GRIMOIRE AUTH — one shared sign-in across every Grimoire app
   ──────────────────────────────────────────────────────────────
   Single source of truth = the Holiday Tracker's account store, so
   registering once signs you in everywhere (SSO):

     • collection : wmf_user_profiles
     • session    : localStorage 'ht_session'
     • salt       : 'grimoire_salt'  (SHA-256(password + salt))

   A person is identified by their NAME. login()/register() resolve
   an account by nameKey → displayName → name, which keeps it
   backward-compatible with BOTH schemas already in the wild:
     - Holiday Tracker docs:  { displayName, personId, isAdmin, passwordHash }
     - Allocation/Reviewer docs: { name, nameKey, passwordHash }
   New docs written here carry both `name` and `displayName` plus
   `nameKey`, so any app can read them.

   Requires the Firebase compat SDK (firebase-app + firebase-firestore)
   and assets/firebase-config.js to be loaded first, with
   firebase.initializeApp(...) already called by the host page OR by
   this module (it inits if needed).
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  if (typeof firebase === 'undefined' || !firebase.firestore) {
    console.error('[GrimoireAuth] Firebase SDK not loaded — auth unavailable.');
  } else if (!firebase.apps || !firebase.apps.length) {
    // Host page didn't init Firebase yet — do it from the shared config.
    if (global.firebaseConfig) firebase.initializeApp(global.firebaseConfig);
  }

  const GrimoireAuth = {
    COL: 'wmf_user_profiles',
    SALT: 'grimoire_salt',
    SESSION_KEY: 'ht_session',

    _col() { return firebase.firestore().collection(this.COL); },

    /* Normalised, comparable key for a person's name. */
    nameKey(name) {
      return (name || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    },

    /* Deterministic document id for a name. The exact formula only
       matters within this module; duplicate-detection across apps
       goes through _find() (by name), not by recomputing the id. */
    makeUid(name) {
      const key = this.nameKey(name) || 'user';
      let suffix = '';
      try { suffix = btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6); } catch (e) {}
      return key + '_' + (suffix || Math.random().toString(36).slice(2, 8));
    },

    async hash(pass) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + this.SALT));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    saveSession(u) { try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(u)); } catch (e) {} },
    loadSession()  { try { return JSON.parse(localStorage.getItem(this.SESSION_KEY)); } catch (e) { return null; } },
    clearSession() { try { localStorage.removeItem(this.SESSION_KEY); } catch (e) {} },

    /* Normalise either schema into one user shape. */
    _norm(uid, d) {
      const name = d.displayName || d.name || '';
      return {
        uid,
        name,
        displayName: name,
        nameKey: d.nameKey || this.nameKey(name),
        isAdmin: !!d.isAdmin,
        personId: d.personId || null,
      };
    },

    /* Resolve an account doc by name, tolerant of both schemas AND of
       case/spacing differences (e.g. roster "ARYA" vs account "Arya").
       Indexed exact matches first; then a client-side scan by nameKey so a
       differently-cased name still resolves to the one real account and we
       never create a duplicate. */
    async _find(name) {
      const trimmed = (name || '').trim();
      const key = this.nameKey(trimmed);
      const col = this._col();
      let snap = await col.where('nameKey', '==', key).limit(1).get();
      if (snap.empty) snap = await col.where('displayName', '==', trimmed).limit(1).get();
      if (snap.empty) snap = await col.where('name', '==', trimmed).limit(1).get();
      if (!snap.empty) return snap.docs[0];
      const all = await col.get();
      return all.docs.find(d => {
        const x = d.data();
        return this.nameKey(x.displayName || x.name || '') === key;
      }) || null;
    },

    /* → { ok:true, user } | { ok:false, reason:'notfound'|'badpass'|'error', message } */
    async login(name, pass) {
      try {
        const doc = await this._find(name);
        if (!doc) return { ok: false, reason: 'notfound', message: 'No account found — use Register.' };
        const d = doc.data();
        if (d.passwordHash !== await this.hash(pass))
          return { ok: false, reason: 'badpass', message: 'Incorrect password.' };
        const user = this._norm(doc.id, d);
        this.saveSession(user);
        return { ok: true, user };
      } catch (e) {
        console.error('[GrimoireAuth] login', e);
        return { ok: false, reason: 'error', message: 'Connection error.' };
      }
    },

    /* → { ok:true, user } | { ok:false, reason:'exists'|'error', message } */
    async register(name, pass) {
      try {
        const trimmed = (name || '').trim();
        if (await this._find(trimmed))
          return { ok: false, reason: 'exists', message: 'That name is already registered — use Sign In.' };
        // Bootstrap: the very first account in an empty store becomes admin.
        let isAdmin = false;
        try { isAdmin = (await this._col().limit(1).get()).empty; } catch (e) {}
        const uid = this.makeUid(trimmed);
        const profile = {
          name: trimmed,
          displayName: trimmed,
          nameKey: this.nameKey(trimmed),
          passwordHash: await this.hash(pass),
          isAdmin,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        await this._col().doc(uid).set(profile, { merge: true });
        const user = this._norm(uid, profile);
        this.saveSession(user);
        return { ok: true, user };
      } catch (e) {
        console.error('[GrimoireAuth] register', e);
        return { ok: false, reason: 'error', message: 'Connection error.' };
      }
    },

    /* Re-hydrate the session on page load. → user | null
       On a network failure we trust the locally stored session so a
       flaky connection never locks the user out. */
    async restore() {
      const s = this.loadSession();
      if (!s || !s.uid) return null;
      try {
        const snap = await this._col().doc(s.uid).get();
        if (snap.exists) {
          const user = this._norm(s.uid, snap.data());
          this.saveSession(user);
          return user;
        }
        this.clearSession();
        return null;
      } catch (e) {
        return this._norm(s.uid, s);
      }
    },

    signOut() { this.clearSession(); },

    /* All registered display names (for a "select your name" sign-in list). */
    async listAccounts() {
      try {
        const snap = await this._col().get();
        return snap.docs.map(d => { const x = d.data(); return x.displayName || x.name; })
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      } catch (e) { return []; }
    },

    /* Full account list for admin panels → [{ uid, displayName, isAdmin }]. */
    async listProfiles() {
      try {
        const snap = await this._col().get();
        return snap.docs.map(d => {
          const x = d.data();
          return { uid: d.id, displayName: x.displayName || x.name || d.id, isAdmin: !!x.isAdmin };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName));
      } catch (e) { return []; }
    },

    /* Set/clear admin on an account (used by per-app admin panels). */
    async setAdmin(uid, val) { await this._col().doc(uid).update({ isAdmin: !!val }); },
  };

  global.GrimoireAuth = GrimoireAuth;
})(window);
