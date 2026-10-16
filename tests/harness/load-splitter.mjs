/*
 * Loads the inline <script> of File_splitter.html into a node:vm so its
 * top-level function declarations (the pure extract/split helpers) can be
 * unit-tested in Node — mirrors load-alokasi.mjs. The inline block is the
 * attribute-less <script>; we pick it by the sentinel 'fileSplitter.names'.
 * Browser globals are stubbed; a top-level throw is non-fatal because
 * function declarations are hoisted before execution.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = join(__dirname, '..', '..', 'File_splitter.html');

function makeEl() {
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === 'value' || p === 'textContent' || p === 'className' || p === 'innerHTML') return '';
      if (p === 'children') return [];
      return makeEl();
    },
    set() { return true; },
    apply() { return makeEl(); },
  });
}

// captureDom element: stores innerHTML/className instead of swallowing them, so
// renderTotals' block markup survives appendChild. Only used when captureDom is
// on; every other property falls back to the existing no-op makeEl().
function makeCaptureEl() {
  const state = { innerHTML: '', className: '', value: '', textContent: '', children: [] };
  return new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === 'appendChild') return child => { state.children.push(child); return child; };
      if (p in state) return state[p];
      return makeEl();
    },
    set(_t, p, v) { state[p] = v; return true; },
    apply() { return makeEl(); },
  });
}

// The optional `seed` pre-fills localStorage before the inline script runs,
// which is what the seed-dependent tests need.
// With `captureDom`, document.getElementById('totalsBody') records the markup
// appended by renderTotals in an `appended` string array (and `children`), and
// document.getElementById('skipBlanks').checked is a settable input defaulting
// to true. `htmlPath` points the loader at another copy of the page, e.g. a
// counterfactual HEAD revision kept outside the repo; without it the repo file
// is used, so the default load behaviour is unchanged.
export function loadSplitter({ seed, captureDom = false, htmlPath = HTML } = {}) {
  const html = readFileSync(htmlPath, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('fileSplitter.names'));
  if (!inline) throw new Error('splitter inline script not found');

  const store = new Map(seed ? Object.entries(seed) : []);
  const sandbox = {
    // decode_cell is the one XLSX util the pure helpers call ('BC12' -> {c:54, r:11}).
    XLSX: { utils: { decode_cell(a) {
      let c = 0, i = 0;
      while (i < a.length && a[i] >= 'A' && a[i] <= 'Z') c = c * 26 + a.charCodeAt(i++) - 64;
      return { c: c - 1, r: parseInt(a.slice(i), 10) - 1 };
    } } },
    JSZip: function () {},
    document: (() => {
      const doc = {
        getElementById: () => makeEl(), querySelector: () => makeEl(),
        querySelectorAll: () => [], createElement: () => makeEl(),
        addEventListener() {}, body: makeEl(),
      };
      if (captureDom) {
        let appended = [];
        const children = [];
        const totalsBody = {
          children,
          appendChild(el) { appended.push(el.innerHTML); children.push(el); return el; },
        };
        Object.defineProperty(totalsBody, 'appended', { get: () => appended });
        Object.defineProperty(totalsBody, 'innerHTML', {
          get: () => '',
          // renderTotals clears the panel before each render; keep per-call captures.
          set(v) { if (v === '') { appended = []; children.length = 0; } },
        });
        const byId = { totalsBody, skipBlanks: { checked: true } };
        doc.getElementById = id => byId[id] || makeEl();
        doc.createElement = () => makeCaptureEl();
      }
      return doc;
    })(),
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
    },
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
    console, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  try { vm.runInContext(inline, ctx, { filename: 'splitter-inline.js' }); }
  catch (err) {
    if (typeof sandbox.balancedSizes !== 'function') {
      throw new Error('splitter inline failed to load: ' + err.message);
    }
  }
  return sandbox;
}
