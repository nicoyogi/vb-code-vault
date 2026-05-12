/* ══════════════════════════════════════════════════════════════
   FIREBASE CONFIG — shared across the Grimoire
   ──────────────────────────────────────────────────────────────
   Note: a Firebase Web API key is NOT a secret. It's a public
   project identifier. Real security comes from:
     • Firestore / Storage security rules
     • API key HTTP-referrer restrictions (Google Cloud Console)
     • Firebase App Check
     • Authentication
   See: https://firebase.google.com/docs/projects/api-keys
   ══════════════════════════════════════════════════════════════ */
window.firebaseConfig = {
  apiKey:            "AIzaSyABb63nTxq-DY0CsHDtdJsUF4NBF7Cnrxw",
  authDomain:        "vb-code-vault.firebaseapp.com",
  projectId:         "vb-code-vault",
  storageBucket:     "vb-code-vault.firebasestorage.app",
  messagingSenderId: "773245175115",
  appId:             "1:773245175115:web:0b6a4f27388f58f026d4ce"
};
