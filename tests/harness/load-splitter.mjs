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

export function loadSplitter() {
  const html = readFileSync(HTML, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('fileSplitter.names'));
  if (!inline) throw new Error('splitter inline script not found');

  const store = new Map();
  const sandbox = {
    XLSX: {}, JSZip: function () {},
    document: {
      getElementById: () => makeEl(), querySelector: () => makeEl(),
      querySelectorAll: () => [], createElement: () => makeEl(),
      addEventListener() {}, body: makeEl(),
    },
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
