#!/usr/bin/env node
/* Local preview server — check a change in a browser before it becomes a pull request.

   Why a server is needed at all: the app cannot run from file://. It fetches its changelog
   (assets/anmerkung-changelog.json) and, when a Wackler passphrase is stored, its encrypted
   ratecard. Browsers block those as cross-origin on file://, so opening anmerkung.html
   straight off disk gives a half-dead page.

   Zero dependencies and no build step, matching the rest of the repo:
       npm run dev            # default port 8080
       PORT=8081 npm run dev  # when 8080 is taken
   Ctrl-C stops it.
*/
import { createServer } from 'node:http';
import { readFile, stat, access } from 'node:fs/promises';
import { extname, join, normalize, sep, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Walk up to the repository root rather than counting "../" hops, so the server keeps
   working if this file is moved and cannot accidentally serve a parent directory. It keys
   off .git, not package.json: scripts/ has its own package.json (for the notify scripts'
   deps), so a package.json walk stops one level too early and would serve only scripts/. */
async function findRoot(start) {
  let dir = start;
  for (;;) {
    try { await access(join(dir, '.git')); return dir; } catch { /* keep walking */ }
    const up = dirname(dir);
    if (up === dir || up === parse(dir).root) throw new Error('repo root (.git) not found above ' + start);
    dir = up;
  }
}

const ROOT = await findRoot(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv':  'text/csv; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.pdf':  'application/pdf',
  '.zip':  'application/zip',
};

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

/* Resolve a request path to a file inside ROOT, refusing anything that escapes it.
   normalize() collapses ".." and unifies the separators, and that is what actually stops a
   traversal: "/..%2f..%2fpackage.json" normalises back down to the repo's own package.json
   rather than escaping. The prefix check is the belt to those braces, testing BOTH
   separators because join() emits backslashes on Windows while a request may carry forward
   slashes — a backslash-only comparison would be the fragile half of the pair. */
function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, '');
  const abs = join(ROOT, rel);
  const within = abs === ROOT || abs.startsWith(ROOT + sep) || abs.startsWith(ROOT + '/');
  return within ? abs : null;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  let target = resolveTarget(req.url || '/');

  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    log(`403 ${req.method} ${req.url}`);
    return res.end('Forbidden');
  }

  try {
    let info = await stat(target);

    // Directory: serve its index.html, else nothing (keeps the tool small).
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target);
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      /* no-store: an edit to a rule file must show on the next reload. A stale asset would
         otherwise look exactly like a bug in the change being reviewed, which is the one
         thing this server exists to rule out. */
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Length': body.length,
    });
    res.end(body);
    log(`200 ${req.method} ${req.url} (${body.length}b, ${Date.now() - started}ms)`);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      log(`404 ${req.method} ${req.url}`);
      res.end(`Not found: ${req.url}`);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      console.error(err);
      log(`500 ${req.method} ${req.url} — ${err.message}`);
      res.end('Server error');
    }
  }
});

/* A busy port is the common failure; say so plainly instead of crashing with a stack. */
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Another preview may still be running. Use a different port:\n`);
    console.error(`      PORT=8081 npm run dev\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Anmerkung — local preview`);
  console.log(`  serving ${ROOT}`);
  console.log(`\n    http://${HOST}:${PORT}/anmerkung.html\n`);
  console.log(`  Tests (separate terminal):  npm test`);
  console.log(`  Stop:                       Ctrl-C\n`);
});
