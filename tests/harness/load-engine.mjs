/*
 * Test harness loader for the Anmerkung rule engine.
 *
 * assets/anmerkung.js is browser code: it runs top-level IIFEs that touch
 * document / window / localStorage / XLSX, and it does not export anything.
 * To unit-test the rule engine in Node we:
 *   1. provide lightweight stubs for the browser globals it touches at load,
 *   2. run the file inside a node:vm context (top-level `function` declarations
 *      become properties of the context's global object), and
 *   3. pull the rule-engine functions back out of the context.
 *
 * Top-level function declarations are instantiated before any statement runs,
 * so every process* / helper function exists even if a later UI-only statement
 * were to throw. We still try hard to make the stubs total so nothing throws.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SRC = join(REPO_ROOT, 'assets', 'anmerkung.js');
const SRC_RATECARD = join(REPO_ROOT, 'assets', 'wackler-ratecard.js');
const SRC_NAT_RATECARD = join(REPO_ROOT, 'assets', 'wackler-national-ratecard.js');

/* The two Wackler ratecard .js files are business data and live local-only since
   b7f3c57 (only assets/wackler-ratecards.enc.json ships, decryptable with the team
   passphrase the tests deliberately don't have). The plaintext was tracked in git
   up to that point, so on a machine without the local files we fall back to the
   newest commit that still carried each file. Keeps the ratecard-dependent tier
   tests (FR-delta re-tiering, domestic rate notes) faithful in a plain clone.
   Returns null when neither source is available — callers degrade gracefully. */
function readRatecardSource(relPath) {
  try {
    return readFileSync(join(REPO_ROOT, relPath), 'utf8');
  } catch { /* not on disk — fall through to git history */ }
  try {
    const lastLive = execFileSync('git', ['log', '--diff-filter=d', '--format=%H', '-1', '--', relPath],
      { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    if (lastLive) {
      return execFileSync('git', ['show', `${lastLive}:${relPath}`],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    }
  } catch { /* shallow clone / no git — give up */ }
  return null;
}
const RATECARD_SRC = readRatecardSource('assets/wackler-ratecard.js');
const NAT_RATECARD_SRC = readRatecardSource('assets/wackler-national-ratecard.js');

/* XLSX cell address encoding, matching XLSX.utils.encode_cell({r,c})
   (0-based r/c -> e.g. {r:0,c:0} => "A1", {r:1,c:2} => "C2"). */
function colName(c) {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function encode_cell({ r, c }) {
  return colName(c) + (r + 1);
}

/* A totally permissive DOM element: every property read returns the element
   itself (so it is callable and chainable), every assignment is accepted, and
   a few properties return sensible typed values so layout math stays numeric. */
function makeElement() {
  const el = new Proxy(function () {}, {
    get(_t, prop) {
      switch (prop) {
        case 'width':
        case 'height':
        case 'scrollTop':
        case 'scrollHeight':
        case 'clientWidth':
        case 'clientHeight':
          return 0;
        case 'style':
        case 'dataset':
          return {};
        case 'value':
        case 'textContent':
        case 'className':
          return '';
        case 'classList':
          return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
        case 'parentNode':
          return el;
        case Symbol.toPrimitive:
          return () => 0;
        default:
          return el;
      }
    },
    set() { return true; },
    apply() { return el; },
  });
  return el;
}

function makeStubs() {
  const document = {
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
    body: makeElement(),
    hidden: false,
  };
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    Grimoire: undefined,
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  const XLSX = {
    utils: { encode_cell },
    read() { throw new Error('XLSX.read is not stubbed (not needed for rule tests)'); },
  };

  const sandbox = {
    document,
    window,
    localStorage,
    XLSX,
    navigator: { userAgent: 'node-test' },
    console,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('fetch is not stubbed')),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

let _engine = null;

export function loadEngine() {
  if (_engine) return _engine;

  const sandbox = makeStubs();
  const ctx = vm.createContext(sandbox);
  const code = readFileSync(SRC, 'utf8');

  /* Load the standalone Wackler rate card FIRST, in the same context, mirroring the
     <script> order in anmerkung.html. It publishes WACKLER_RATECARD on the context
     global, which the engine reads for its tier table and the enriched "Wackler rechnet"
     rate note. It's optional by design — the engine falls back to its inline tier table
     if this is absent — but loading it keeps the tests faithful to the browser runtime. */
  try {
    if (RATECARD_SRC) vm.runInContext(RATECARD_SRC, ctx, { filename: 'wackler-ratecard.js' });
  } catch (err) {
    /* Non-fatal: the engine degrades gracefully without the rate card. */
  }

  /* Then the national rate card, again mirroring the <script> order. It publishes
     WACKLER_NATIONAL_RATECARD and (for postal→zone resolution) reads the international
     WACKLER_RATECARD loaded just above. Optional by design — the "Wackler rechnet" note
     simply falls back to the plain tier wording when it's absent. */
  try {
    if (NAT_RATECARD_SRC) vm.runInContext(NAT_RATECARD_SRC, ctx, { filename: 'wackler-national-ratecard.js' });
  } catch (err) {
    /* Non-fatal: the engine degrades gracefully without the national rate card. */
  }

  try {
    vm.runInContext(code, ctx, { filename: 'anmerkung.js' });
  } catch (err) {
    /* Top-level function declarations are already bound on the context global
       before any statement executes, so a UI-only throw is non-fatal for the
       rule engine. Only rethrow if the engine itself failed to materialise. */
    if (typeof sandbox.processDachser !== 'function') {
      throw new Error('Engine failed to load: ' + err.message);
    }
  }

  const need = [
    // processors
    'processDachser', 'processKN', 'processDHL', 'processWackler',
    // tier helpers
    'dachserGetTier', 'knGetTier', 'wacklerGetTier', 'wacklerGetTierIdx', 'wacklerTierLabel',
    'wacklerRechnetNote',
    // dachser surcharge helpers
    'daIsNonInteger', 'daDetectSurchargeFromDiff',
    // wackler code books
    'wacklerSnkCode', 'isWacklerAvisCode', 'wacklerAvisLabel',
    // generic helpers
    'join', 'hasErr', 'cellNum', 'cellStr', 'findCol',
    'findAnmerkungCol', 'ensureAnmerkungCol', 'patchSheet', 'setAnmerkungColumnWidth',
    'normPhrase', 'samePhraseSet', 'splitTriggers',
    'idxToCol', 'colToIdx',
    'phraseToKey', 'phraseKeysFor',
    // diff-mode labeling / training-output primitives
    'classifyDiff', 'computePhraseDiff', 'granularLabel', 'rowUid', 'phraseCellParts',
    'buildTrainingSummary', 'buildRegressionSet', 'collectInputsForRow', 'buildEngineSourceDoc',
    'buildPhraseEmitterIndex',
  ];
  const engine = {};
  const missing = [];
  for (const name of need) {
    if (typeof sandbox[name] === 'function') engine[name] = sandbox[name];
    else missing.push(name);
  }
  if (missing.length) {
    throw new Error('Engine is missing expected functions: ' + missing.join(', '));
  }

  engine.encode_cell = encode_cell;
  engine.WACKLER_RATECARD = sandbox.WACKLER_RATECARD || null;
  engine.WACKLER_NATIONAL_RATECARD = sandbox.WACKLER_NATIONAL_RATECARD || null;
  /* The phrase catalog itself, so tests can guard catalog-wide invariants
     (e.g. no two entries may normPhrase-fold onto each other). PHRASES is a
     top-level `const`, which — unlike function declarations — does NOT land
     on the vm context's global object, so it has to be read back by
     evaluating inside the context. */
  try {
    engine.PHRASES = vm.runInContext('typeof PHRASES === "undefined" ? null : PHRASES', ctx);
  } catch (err) {
    engine.PHRASES = null;
  }
  _engine = engine;
  return engine;
}

/*
 * Build a fake XLSX worksheet for a single row.
 *
 *   cells: an object mapping column index -> raw cell value (string|number).
 *          Values are stored as { v } at encode_cell({ r, c }).
 *
 * Columns that are omitted read back as 0 (cellNum) / '' (cellStr), matching
 * how the engine treats blank cells.
 */
export function makeRow(rowIndex, cells) {
  const ws = {};
  for (const [c, v] of Object.entries(cells)) {
    ws[encode_cell({ r: rowIndex, c: Number(c) })] = { v };
  }
  return ws;
}
