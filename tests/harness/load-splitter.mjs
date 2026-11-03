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

// peopleDom: a minimal real people-list DOM so the ½ checkbox state can be
// observed. querySelector returns a list with children/appendChild,
// createElement returns a person row with its text input and half box, and
// sandbox.__peopleRows(group) reads the rows as {name, half}. The setters
// replay a user: setting name fires peopleCard's input handler, setting half
// fires the row's change handler. Off by default, so the no-op stubs stay.
function buildPeopleDom() {
  const lists = new Map();   // group -> list element
  const parts = new Map();   // created row element -> { input, half }
  const staticInputs = new Map(); // markup row element -> its text input, no half box
  const handlers = {};       // peopleCard listeners by event type
  const card = { addEventListener(type, fn) { handlers[type] = fn; }, classList: { contains: () => false } };

  function inputOf(row) { return parts.has(row) ? parts.get(row).input : staticInputs.get(row); }

  function listFor(group) {
    if (!lists.has(group)) {
      const children = [];
      const list = {
        dataset: { group },
        children,
        appendChild(row) { children.push(row); return row; },
        querySelectorAll: sel => (sel === '.person-input' ? children.map(inputOf) : []),
      };
      Object.defineProperty(list, 'innerHTML', { get: () => '', set(v) { if (v === '') children.length = 0; } });
      // One markup row, as in File_splitter.html: text input, no ½ box.
      list.appendChild(createRow(false));
      lists.set(group, list);
    }
    return lists.get(group);
  }

  function createRow(withHalf = true) {
    const row = { className: '', innerHTML: '' };
    const input = {
      value: '',
      classList: { contains: c => c === 'person-input' },
      closest: sel => (sel === '.people-list' ? [...lists.values()].find(l => l.children.includes(row)) || null : null),
      focus() {},
    };
    const half = withHalf
      ? { checked: false, addEventListener(type, fn) { if (type === 'change') half.onchange = fn; } }
      : null;
    row.querySelector = sel => (sel === '.half-input' ? half
      : sel === '.person-input' || sel === 'input' ? input : null);
    if (half) parts.set(row, { input, half }); else staticInputs.set(row, input);
    return row;
  }

  function fire(type, target) { if (handlers[type]) handlers[type]({ target }); }

  return {
    card,
    querySelector(sel) {
      const m = /^\.people-list\[data-group="([^"]+)"\]$/.exec(sel);
      return m ? listFor(m[1]) : makeEl();
    },
    querySelectorAll(sel) {
      const m = /^\.people-list\[data-group="([^"]+)"\]\s+\.person-input$/.exec(sel);
      return m ? listFor(m[1]).querySelectorAll('.person-input') : [];
    },
    createElement: () => createRow(),
    rows: group => listFor(group).children.filter(row => parts.has(row)).map(row => {
      const p = parts.get(row);
      return {
        get name() { return p.input.value; },
        set name(v) { p.input.value = v; fire('input', p.input); },
        get half() { return p.half.checked; },
        set half(v) { p.half.checked = !!v; if (p.half.onchange) p.half.onchange(); },
      };
    }),
  };
}

// The optional `seed` pre-fills localStorage before the inline script runs,
// which is what the seed-dependent tests need.
// With `captureDom`, document.getElementById('totalsBody') records the markup
// appended by renderTotals in an `appended` string array (and `children`), and
// document.getElementById('skipBlanks').checked is a settable input defaulting
// to true. `htmlPath` points the loader at another copy of the page, e.g. a
// counterfactual HEAD revision kept outside the repo; without it the repo file
// is used, so the default load behaviour is unchanged.
// With `peopleDom`, the people lists are real enough to read the ½ boxes back
// (see buildPeopleDom).
export function loadSplitter({ seed, captureDom = false, peopleDom = false, htmlPath = HTML } = {}) {
  const html = readFileSync(htmlPath, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('fileSplitter.names'));
  if (!inline) throw new Error('splitter inline script not found');

  const store = new Map(seed ? Object.entries(seed) : []);
  const people = peopleDom ? buildPeopleDom() : null;
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
      if (people) {
        doc.querySelector = sel => people.querySelector(sel);
        doc.querySelectorAll = sel => people.querySelectorAll(sel);
        doc.createElement = () => people.createElement();
        const byId = doc.getElementById;
        doc.getElementById = id => (id === 'peopleCard' ? people.card : byId(id));
      }
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
  if (people) sandbox.__peopleRows = group => people.rows(group);

  const ctx = vm.createContext(sandbox);
  try { vm.runInContext(inline, ctx, { filename: 'splitter-inline.js' }); }
  catch (err) {
    if (typeof sandbox.balancedSizes !== 'function') {
      throw new Error('splitter inline failed to load: ' + err.message);
    }
  }
  return sandbox;
}
