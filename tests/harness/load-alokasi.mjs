/*
 * Loads the inline <script> of alokasi-project.html into a node:vm so its
 * top-level function declarations can be unit-tested in Node — mirroring
 * load-engine.mjs. The inline block is the only attribute-less <script> in
 * the file (open line 453, close line 1195); we pick it by the sentinel
 * 'sgp_alokasi_records'. Browser globals are stubbed; any top-level throw is
 * non-fatal because function declarations are hoisted before execution.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dirname, '..', '..', 'alokasi-project.html');

function makeEl() {
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === 'value' || p === 'textContent' || p === 'className' || p === 'innerHTML') return '';
      return makeEl();
    },
    set() { return true; },
    apply() { return makeEl(); },
  });
}

function colStub() {
  const c = {
    orderBy: () => c, where: () => c,
    onSnapshot: () => {},
    get: () => Promise.resolve({ docs: [] }),
    add: () => Promise.resolve({}),
    doc: () => ({ set: () => Promise.resolve(), delete: () => Promise.resolve(), get: () => Promise.resolve({}) }),
  };
  return c;
}

export function loadAlokasi() {
  const html = readFileSync(HTML, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('sgp_alokasi_records'));
  if (!inline) throw new Error('alokasi inline script not found');

  const firestore = () => ({ collection: () => colStub() });
  firestore.FieldValue = { serverTimestamp: () => 0, delete: () => 0 };
  const firebase = { apps: [{}], initializeApp() {}, firestore };

  const store = new Map();
  const sandbox = {
    firebase,
    window: { firebaseConfig: {}, addEventListener() {}, location: { hash: '' }, Grimoire: undefined },
    document: { getElementById: () => makeEl(), querySelector: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl(), addEventListener() {}, body: makeEl() },
    location: { hash: '' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    Grimoire: { Theme: { init() {}, toggle() {} } },
    GrimoireAuth: { restore: () => Promise.resolve(null), clearSession() {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { userAgent: 'node-test' },
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  try { vm.runInContext(inline, ctx, { filename: 'alokasi-inline.js' }); }
  catch (err) {
    if (typeof sandbox.weekDates !== 'function') {
      throw new Error('alokasi inline failed to load: ' + err.message);
    }
  }
  return sandbox;
}
