# The Grimoire

> *"The Malignant Grimoire: a codex of VB/VBA spells, forwarder rituals and arcane workspace tools."*

A small, static collection of tools and reference pages for day-to-day VB/VBA work, QA, forwarder invoice processing, and other workspace rituals. The HTML files are static, loading scripts and styles from `assets/`; there is no build step and no bundler. Pages that fetch data need a local server (see [Running locally](#running-locally)); the rest open straight from disk. Nine of the pages sync through Google Firebase Firestore, and two scheduled GitHub Actions post Teams reminders from `scripts/`.

**Live site:** [codingkuh.my.id](https://codingkuh.my.id/)

[![Site](https://img.shields.io/badge/site-codingkuh.my.id-0d8c5f)](https://codingkuh.my.id/)
[![Hosting](https://img.shields.io/badge/hosting-GitHub%20Pages-24292e?logo=github)](https://pages.github.com/)
[![No Build](https://img.shields.io/badge/build-none-34d399)](#running-locally)
[![PWA](https://img.shields.io/badge/PWA-offline--capable-5b9cf6)](#offline--pwa)
[![Alchemist](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnicoyogi%2Fvb-code-vault%2Fmain%2Fassets%2Fanmerkung-changelog.json&query=%24.version&prefix=v&label=Alchemist&color=d4af64)](assets/anmerkung-changelog.json)
[![Privacy](https://img.shields.io/badge/data-stays%20in%20browser-a78bfa)](#privacy--data-handling)

---

## Table of contents

- [At a glance](#at-a-glance)
- [Pages](#pages)
- [The Alchemist: Anmerkung Processor](#the-alchemist-anmerkung-processor)
- [Assets](#assets)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
- [Tests](#tests)
- [Offline / PWA](#offline--pwa)
- [Privacy & data handling](#privacy--data-handling)
- [Browser support](#browser-support)
- [Firebase configuration](#firebase-configuration)
- [Project layout](#project-layout)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

---

## At a glance

| I want to… | Go here |
| --- | --- |
| Browse the live site | [codingkuh.my.id](https://codingkuh.my.id/) |
| Annotate a forwarder invoice (Dachser / K+N / DHL / Wackler) | [The Alchemist](https://codingkuh.my.id/anmerkung.html) · [source](anmerkung.html) |
| See what the Anmerkung rules actually do, per forwarder | [`docs/anmerkung/conditions-report.pdf`](docs/anmerkung/conditions-report.pdf) · [`docs/anmerkung/anmerkung_exact_condition_table.pdf`](docs/anmerkung/anmerkung_exact_condition_table.pdf) |
| Understand the diff / AI-bundle workflow and its safety gates | [`docs/anmerkung/README-v5.md`](docs/anmerkung/README-v5.md) · [`docs/anmerkung/ai_operating_contract.md`](docs/anmerkung/ai_operating_contract.md) |
| Run the test suite | [Tests](#tests) |
| Look up a VB/VBA snippet | [The Vault](https://codingkuh.my.id/code.html) · [source](code.html) |
| Check team absences / leave | [Holiday Tracker](https://codingkuh.my.id/holiday-tracker.html) · [source](holiday-tracker.html) |
| Plan who works which project, then track allocation, quantity & per-person performance | [Project Allocation](https://codingkuh.my.id/alokasi-project.html) · [source](alokasi-project.html) |
| Install the Alchemist offline | [Offline / PWA](#offline--pwa) |
| Fork and self-host | [Running locally](#running-locally) · [Firebase configuration](#firebase-configuration) |

---

## Pages

| Page | Tome | What it is | Live |
| --- | --- | --- | --- |
| [`index.html`](index.html) | **The Grimoire** | Landing page and linking hub for all the tools below. | [↗](https://codingkuh.my.id/) |
| [`code.html`](code.html) | **The Vault** | Browsable reference of VB/VBA snippets and notes. | [↗](https://codingkuh.my.id/code.html) |
| [`qa.html`](qa.html) | **The Oracle** | General QA knowledge base. | [↗](https://codingkuh.my.id/qa.html) |
| [`qa-siemens.html`](qa-siemens.html) | **Siemens GP Knowledge Base** | Project-specific QA reference (Cinzel / Syne / DM Mono styling, light/dark). | [↗](https://codingkuh.my.id/qa-siemens.html) |
| [`standard-wording.html`](standard-wording.html) | **Siemens GP Standard Wording** | Reusable phrasing and copy templates. | [↗](https://codingkuh.my.id/standard-wording.html) |
| [`File_splitter.html`](File_splitter.html) | **The Splitter** | Six steps to split vendor work per system: upload one file per system (or a single workbook with a sheet per system), filter by note, exclude Kreditors and Referenz, check totals, weight people by half-day, download the split. Syncs saved lists via Firestore. | [↗](https://codingkuh.my.id/File_splitter.html) |
| [`alokasi-project.html`](alokasi-project.html) | **Siemens GP Project Allocation** | Three tabs. **Plan:** an allocation cockpit that fuses open backlog, availability (from the Holiday Tracker), per-person throughput and project due dates to decide who works what each day/week; **Records:** daily per-project entries (staff, quantity, status) with Excel/PDF export and import from `ALOKASI PROJECT.xlsx`; **Analyze:** Quantity/Personnel pivots, **per-person scorecards** (the former Task Reviewer, derived from the records), backlog aging and the analyzer. Per-user sign-in, syncs via Firebase. Due dates live in `sgp_alokasi_projects`, so publish its Firestore rules in the console before they save. | [↗](https://codingkuh.my.id/alokasi-project.html) |
| [`task-reviewer-siemens.html`](task-reviewer-siemens.html) | **Task Reviewer (redirect)** | Merged into Project Allocation → People. Redirects to `alokasi-project.html#people`; kept for old links. | [↗](https://codingkuh.my.id/task-reviewer-siemens.html) |
| [`anmerkung.html`](anmerkung.html) | **The Alchemist** | In-browser processor for forwarder invoice annotations (Dachser / K+N / DHL Express / Wackler). See [below](#the-alchemist-anmerkung-processor). | [↗](https://codingkuh.my.id/anmerkung.html) |
| [`operation-report.html`](operation-report.html) | **The Tally** | Daily tarif and faktual checking with per-user sign-in (shared `assets/grimoire-auth.js`): you fill your own row, the team sees a live dashboard, plus categories and admin targets. Firestore-backed. | [↗](https://codingkuh.my.id/operation-report.html) |
| [`timesheet_app.html`](timesheet_app.html) | **The Timekeeper** | Upload a timesheet workbook, pick the month, and get an overtime report with totals. Client-side only (loads `xlsx` 0.18.5 from jsDelivr); no Firestore. | [↗](https://codingkuh.my.id/timesheet_app.html) |
| [`anmerkung-presentation.html`](anmerkung-presentation.html) | **Alchemist deck** | Slide deck explaining the Anmerkung Processor. Not linked from the hub. | [↗](https://codingkuh.my.id/anmerkung-presentation.html) |
| [`todo.html`](todo.html) | **The Ledger** | Task tracker with filters, groups, and a light/dark toggle. | [↗](https://codingkuh.my.id/todo.html) |
| [`holiday-tracker.html`](holiday-tracker.html) | **Holiday Tracker** | Team vacation, sick, WFH, and half-day tracking with calendar + Gantt views, vacation balances, public holidays, department filters, and an activity log. Syncs via Firebase Firestore. | [↗](https://codingkuh.my.id/holiday-tracker.html) |

## The Alchemist: Anmerkung Processor

[`anmerkung.html`](anmerkung.html) is the most substantial page in the Grimoire. It parses forwarder invoice spreadsheets (`.xlsx`) entirely client-side and writes a per-row `Anmerkung` column based on forwarder-specific rules.

**Rule documentation:** the generated [conditions report](docs/anmerkung/conditions-report.pdf) lists the live thresholds and the rule cascade per forwarder, and [`docs/anmerkung/`](docs/anmerkung/) holds the diff / AI-bundle and patch-protocol notes. [`assets/anmerkung.js`](assets/anmerkung.js) is the source of truth when the documents and the code disagree.

### Feature highlights

- **Four forwarder engines:** Dachser, K+N, DHL Express and Wackler, each with its own column resolver and rule set.
- **Preview / dry-run:** see every proposed annotation before writing to the file, with color-coded per-row status and a trigger-breakdown bar chart.
- **Bulk processing:** drop many `.xlsx` files at once; each gets an individual download, plus a "Download all as ZIP" option.
- **Rule Tester:** play with hypothetical values without uploading a file; useful for pinning down exactly when a rule fires.
- **Diff Mode / Rule Training:** compare a predicted vs. expected workbook, get rows labeled `wrong` / `missed` / `overfired` / `drift` / `correct`, filter by forwarder / sheet / free text, and export a CSV diff or a training set (CSV / JSONL) with predicted vs. expected plus the input cells the rules read. Every row has a one-click **Send to Tester** to open that exact scenario in the Rule Tester. A **Bulk** sub-panel compares many predicted/expected file pairs at once (auto-paired by filename) and merges every row into one wider training corpus, tagging each exported row with its `source_file`.
- **Opt-in "Why?" reason column:** writes an extra `Anmerkung_Reason` column so the trigger trace is auditable.
- **Configurable tolerance thresholds** per forwarder, persisted in `localStorage`.
- **Two skins and a light / dark theme.** The pro skin ([`assets/anmerkung-pro.css`](assets/anmerkung-pro.css)) is the default; the header style button switches to the mystic skin, and the theme button switches light / dark independently of it. Forwarder tiles are a keyboard-navigable ARIA radiogroup, and the log is timestamped.
- **Installable as a PWA** (see [Offline / PWA](#offline--pwa)); the service worker is [`sw.js`](sw.js) and the manifest is [`manifest.webmanifest`](manifest.webmanifest).
- **Always-fresh deploys:** same-origin assets are served network-first, so content/rule edits reach users on their next online load with no cache-bust step required. The cache acts purely as an offline fallback.
- **Data-driven changelog:** [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) drives both the version badge and the in-app "What's new" modal, so prepending an entry there is the canonical way to publish release notes.

XLSX parsing is done with [SheetJS](https://sheetjs.com/) (`xlsx` 0.20.3, loaded from the official `cdn.sheetjs.com` with an SRI hash) and [JSZip](https://stuk.github.io/jszip/); the XLSX is patched in-place: only the `Anmerkung` column (and optionally `Anmerkung_Reason`) is rewritten, leaving styles, merged cells, formulas, and drawings untouched.

## Assets

| File | Purpose |
| --- | --- |
| [`assets/grimoire-core.css`](assets/grimoire-core.css) | Shared tokens, base styles, skip-link, reduced-motion rules. |
| [`assets/grimoire-core.js`](assets/grimoire-core.js) | Shared runtime: the `Grimoire.Nav` page registry that footer links are generated from, animated-canvas helpers (`densityScale`, `visibleRAF`, `shouldAnimate`), and the `Grimoire.Offline` module that registers the service worker, runs `PRECACHE` / `CACHE_STATUS` round-trips, and binds the "Download for offline" button. |
| [`assets/grimoire-pages.css`](assets/grimoire-pages.css) | Shared styles for standard pages (cards, grids). |
| [`assets/grimoire-theme.css`](assets/grimoire-theme.css) · [`assets/grimoire-theme.js`](assets/grimoire-theme.js) | The landing-page design language (ambient motion, section skins), shared by nine pages. |
| [`assets/grimoire-auth.js`](assets/grimoire-auth.js) | Shared per-user sign-in, used by Project Allocation and Operation Report. |
| [`assets/firebase-config.js`](assets/firebase-config.js) | Centralized Firebase config loaded by pages that need Firestore. |
| [`assets/anmerkung.css`](assets/anmerkung.css) · [`assets/anmerkung.js`](assets/anmerkung.js) | Styling and rule engine for The Alchemist. |
| [`assets/anmerkung-pro.css`](assets/anmerkung-pro.css) | The default Alchemist skin (pro). The header style button toggles to the mystic skin. |
| [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) | Versioned release notes for the Anmerkung Processor. |
| [`assets/wackler-ratecard-loader.js`](assets/wackler-ratecard-loader.js) · [`assets/wackler-ratecards.enc.json`](assets/wackler-ratecards.enc.json) | Client-side decryption of the Wackler tariff tables. The plaintext matrices are gitignored business data; [`scripts/encrypt-ratecards.mjs`](scripts/encrypt-ratecards.mjs) rebuilds the encrypted bundle. |
| [`assets/operation-report.js`](assets/operation-report.js) · [`assets/report-data-seed.js`](assets/report-data-seed.js) | Operation Report logic, and its seeded history generated from the local `REPORT DATA.xlsx`. |
| [`assets/holiday-tracker.css`](assets/holiday-tracker.css) · [`assets/holiday-tracker.js`](assets/holiday-tracker.js) | Styling and logic for the Holiday Tracker. |
| [`assets/todo.css`](assets/todo.css) · [`assets/todo.js`](assets/todo.js) | Styling and logic for The Ledger. |
| [`sw.js`](sw.js) | Service worker. Network-first for **same-origin** assets (always serve the latest deployed code when online), cache-first for cross-origin CDN libs. Cache acts purely as an offline fallback. |
| [`manifest.webmanifest`](manifest.webmanifest) | PWA manifest for the Anmerkung Processor. |

## Tech stack

- **HTML / CSS / vanilla JavaScript** with no build step and no bundler. Pages that `fetch` (the changelog, the Wackler rate cards, the public-holidays API) or use Firestore need an HTTP server; the rest open straight from disk.
- **Service Worker + PWA** for offline caching across the Grimoire, installable on Chrome / Edge. The precache list covers the Alchemist and the shared assets; other pages are cached as you browse them.
- **Firebase Firestore** (`firebase-app-compat` + `firebase-firestore-compat` 10.12.2, plus `firebase-storage-compat` on the two knowledge bases) is the sync layer for nine pages: `code.html`, `qa.html`, `qa-siemens.html`, `standard-wording.html`, `alokasi-project.html`, `File_splitter.html`, `operation-report.html`, `todo.html` and `holiday-tracker.html`. CDN scripts are pinned with Subresource Integrity (SRI) hashes.
- **Firebase Admin** in `scripts/`, used by the two scheduled notifiers to read Firestore server-side. The notifier package requires Node.js 22 or newer.
- **SheetJS** (`xlsx` 0.20.3, from `cdn.sheetjs.com`) and **JSZip** for client-side XLSX parsing and writing in `anmerkung.html`; `timesheet_app.html` uses `xlsx` 0.18.5 from jsDelivr.
- **Fonts (Google Fonts):** Cinzel, Syne, DM Sans, DM Mono, DM Serif Display, Outfit, Inter, JetBrains Mono. The `IBM Plex` / `Space Grotesk` entries further down the CSS are fallback families with no webfont behind them.
- **Hosting:** GitHub Pages with a `CNAME` pointing to `codingkuh.my.id`.

## Running locally

Most pages work by opening the HTML file directly in a browser. For anything that uses `fetch` (the Anmerkung changelog JSON, the public-holidays API in the Holiday Tracker, or the service worker), serve over HTTP:

```bash
# from the repo root
npm run dev           # http://127.0.0.1:8080
PORT=8081 npm run dev # if 8080 is taken
```

`scripts/dev-server.mjs` is a small zero-dependency static server (Node builtins only, no install step). It sends `no-store`, so an edit to a rule file shows on the next reload instead of a stale asset looking like a bug in your change. Any static server works too: `python3 -m http.server 8000`, `npx serve`, or VS Code Live Server.

> **Tip:** Service workers are only active when the site is served over `http(s)://` (or `file://` on a few browsers with flags). Use a local server to exercise offline mode.

## Tests

The unit tests use the Node built-in test runner; there is no test framework to install.

```bash
npm test                  # everything: 266 tests across the rule engine, diff mode, splitter and allocation
npm run test:anmerkung    # the Anmerkung suites only
npm run verify:anmerkung  # syntax gate, required-engine symbols, SHA-256 of assets/anmerkung.js, then the full suite
```

Tests live in `tests/`. Three harnesses in `tests/harness/` load the browser code into `node:vm` with stubs: `load-engine.mjs` for `assets/anmerkung.js`, `load-alokasi.mjs` for the script inside `alokasi-project.html`, and `load-splitter.mjs` for `File_splitter.html`. They pull the plaintext Wackler rate cards out of git history when those gitignored files are absent locally, so the suite passes on a fresh clone without the business data.

The condition-report PDF is generated separately and needs Python: `python scripts/anmerkung/report_conditions.py` writes `docs/anmerkung/conditions-report.pdf` from `assets/anmerkung.js`.

## Offline / PWA

The Alchemist (`anmerkung.html`) is installable and fully offline-capable, but it's also **always-fresh** when online: the cache is treated as an offline fallback, not a content gate.

- Click **"Download for offline"** in the header to precache every Grimoire page and asset. A progress indicator reports each URL as it's fetched.
- **Online behavior:** every same-origin request (HTML, JS, CSS, JSON, manifest) goes network-first, so the latest deployed version of each file always wins. Cross-origin CDN libraries (SheetJS, JSZip, fonts) are cache-first because they're immutable per URL.
- **Offline behavior:** if the network fails, the SW falls back to whatever it last cached. Navigation requests with no cached entry fall back to the cached `./anmerkung.html` shell so the app still boots.
- **No version bumps required for content updates.** Editing `anmerkung.js`, `anmerkung.css`, the changelog JSON, or any other same-origin asset and pushing to `main` is enough; users get it on their next online load. Bump `VERSION` in [`sw.js`](sw.js) only when the SW logic itself changes (rare).

## Privacy & data handling

The Grimoire is deliberately thin on backend surface area.

- **The Alchemist processes every `.xlsx` entirely in your browser.** Invoices are parsed, evaluated, and re-zipped locally via [SheetJS](https://sheetjs.com/) + [JSZip](https://stuk.github.io/jszip/); nothing is uploaded anywhere. Bulk processing, Preview, Diff Mode, and the Rule Tester are all client-side.
- **Preferences** (theme, thresholds, forwarder selection) live in `localStorage` on your device.
- **Firestore-backed pages** talk to Google's servers. Nine of them sync through Firestore: `code.html`, `qa.html`, `qa-siemens.html`, `standard-wording.html`, `alokasi-project.html`, `File_splitter.html`, `operation-report.html`, `todo.html` and `holiday-tracker.html`; the two knowledge bases also use Firebase Storage for attachments. If you fork this repo, point them at your own Firebase project ([see below](#firebase-configuration)) and lock them down with Firestore security rules. The Alchemist, `timesheet_app.html` and `anmerkung-presentation.html` stay entirely client-side.
- **Google Fonts** are loaded from `fonts.googleapis.com` / `fonts.gstatic.com`. Remove the `<link>` tags in each HTML if you need a fully self-hosted asset graph.
- **Public holidays** in the Holiday Tracker come from an external public-holidays API.

## Browser support

- Tested on recent **Chrome** and **Edge** (desktop). PWA install and the service worker work out of the box there.
- **Firefox** and **Safari** run the pages fine; PWA install UX is browser-specific (e.g. Safari requires "Add to Home Screen" on iOS, and install prompts differ on desktop Firefox).
- Requires a modern baseline: ES2020+, `fetch`, `async`/`await`, service workers, `WeakMap`, and `localStorage`. No transpilation is shipped.
- Narrow screens (≤ 480px) drop the keyboard-shortcut badges on the project tiles, and coarse-pointer devices get 44px touch targets from [`assets/grimoire-core.css`](assets/grimoire-core.css).

## Firebase configuration

Pages that need Firestore (nine of them, listed under [Tech stack](#tech-stack)) import config from [`assets/firebase-config.js`](assets/firebase-config.js) rather than inlining keys per page. If you fork the repo:

1. Create a Firebase project and enable Firestore.
2. Replace the config object in `assets/firebase-config.js` with your project's keys.
3. Publish security rules in the Firebase console that allow-list only the collections the apps use (everything else is denied by default), which is safer than the default open rules. A rules file is kept out of the repo on purpose, so it has to be pasted into the console or deployed from a local checkout. **Rules do not add authentication**: the collections are still effectively public, so also enable Firebase Authentication and/or [App Check](https://firebase.google.com/docs/app-check) and API key referrer restrictions if the data is sensitive. See Firestore [security rules](https://firebase.google.com/docs/firestore/security/get-started).

Firebase API keys in client code are identifiers, not secrets; access control must be enforced by security rules.

## Project layout

```
vb-code-vault/
├── index.html                       # landing page / hub
├── code.html                        # VB snippets (The Vault)
├── qa.html                          # general QA (The Oracle)
├── qa-siemens.html                  # Siemens-specific QA
├── standard-wording.html            # standard phrases / templates
├── File_splitter.html               # per-system work splitter (Firestore)
├── operation-report.html            # daily tarif / faktual checking (Firestore)
├── timesheet_app.html               # overtime report generator
├── task-reviewer-siemens.html       # redirect → alokasi-project.html#people (merged)
├── alokasi-project.html             # Siemens project allocation cockpit (plan / records / analyze)
├── anmerkung.html                   # forwarder invoice processor (The Alchemist)
├── anmerkung-presentation.html      # presentation deck for the Alchemist
├── todo.html                        # task ledger
├── holiday-tracker.html             # team holiday tracker (Firestore)
├── sw.js                            # service worker
├── manifest.webmanifest             # PWA manifest (Alchemist)
├── assets/
│   ├── grimoire-core.css            # shared styling tokens
│   ├── grimoire-core.js             # shared runtime (nav registry + canvas + offline helpers)
│   ├── grimoire-pages.css           # shared styles for standard pages
│   ├── grimoire-theme.css           # landing-page design language (motion layer)
│   ├── grimoire-theme.js            # companion script for the above
│   ├── grimoire-auth.js             # shared per-user sign-in
│   ├── anmerkung.css                # Alchemist (mystic) styles
│   ├── anmerkung-pro.css            # Alchemist pro skin (default)
│   ├── anmerkung.js                 # Alchemist rule engine + UI glue
│   ├── wackler-ratecard-loader.js   # client-side decrypt of the Wackler tariffs
│   ├── wackler-ratecards.enc.json   # encrypted Wackler tariff bundle
│   ├── holiday-tracker.css          # Holiday Tracker styles
│   ├── holiday-tracker.js           # Holiday Tracker logic
│   ├── todo.css                     # The Ledger styles
│   ├── todo.js                      # The Ledger logic
│   ├── operation-report.js          # Operation Report logic
│   ├── report-data-seed.js          # seeded Operation Report history
│   ├── firebase-config.js           # centralized Firebase config
│   └── anmerkung-changelog.json     # versioned release notes for The Alchemist
├── docs/
│   ├── anmerkung/                   # condition PDFs, v5 integration notes, AI contract, patch protocol
│   └── superpowers/                 # plans and design specs kept per feature
├── tests/                           # node --test suites + tests/harness/ vm loaders
├── scripts/
│   ├── dev-server.mjs               # zero-dependency preview server (`npm run dev`)
│   ├── encrypt-ratecards.mjs        # rebuilds assets/wackler-ratecards.enc.json
│   ├── anmerkung/                   # verify.mjs gate + report_conditions.py PDF generator
│   ├── notify-tomorrow.mjs          # Holiday Tracker → Teams Adaptive Card
│   ├── notify-tasks-due.mjs         # The Ledger → Teams Adaptive Card
│   ├── package.json                 # Node deps for the notifier scripts
│   └── package-lock.json            # pinned dependency tree (used by `npm ci` in CI)
├── .github/workflows/
│   ├── holiday-notify.yml           # daily cron + manual dispatch (holidays)
│   └── tasks-notify.yml             # daily cron + manual dispatch (tasks)
├── data/                            # local Excel sources (gitignored, not shipped)
├── package.json                     # npm test / dev / verify:anmerkung
├── .gitignore
├── CNAME                            # custom domain config
├── LICENSE                          # all rights reserved
└── README.md
```

## Contributing

The HTML files load their specific scripts and styles from the `assets/` folder. Conventions:

- Keep shared visual tokens (colors, fonts, spacing, focus-ring rules) in [`assets/grimoire-core.css`](assets/grimoire-core.css) so the pages stay visually consistent.
- Reuse [`Grimoire.Offline`](assets/grimoire-core.js) rather than wiring a service worker per page.
- The `PHRASES` catalog in [`assets/anmerkung.js`](assets/anmerkung.js) is the single source of truth for Anmerkung output strings. `PHRASE_LITERALS` and `PHRASE_TEMPLATES` below it are the fallback for wording that has not been promoted into the catalog yet.
- When changing the Anmerkung rule engine, bump the version in [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) and add a release note so users see what changed in the in-app "What's new" modal. If the rule cascade changed, rebuild [`docs/anmerkung/conditions-report.pdf`](docs/anmerkung/conditions-report.pdf) with `python scripts/anmerkung/report_conditions.py`.
- **You generally do not need to bump `VERSION` in [`sw.js`](sw.js).** Same-origin assets are served network-first, so content/rule edits ship to users on their next online load with no cache invalidation step. Bump `VERSION` only when the SW logic itself changes (e.g., new caching strategy, new message types); that rotates the cache name and forces a fresh re-install of `CORE`.

Pull requests welcome.

## Credits

Third-party libraries and services that make the Grimoire possible:

- [SheetJS (`xlsx`)](https://sheetjs.com/): client-side XLSX reading/writing.
- [JSZip](https://stuk.github.io/jszip/): ZIP manipulation used to patch `.xlsx` files without re-encoding styles.
- [Firebase](https://firebase.google.com/): Firestore sync for nine pages, plus the Admin SDK behind the Teams notifiers.
- [Google Fonts](https://fonts.google.com/): Cinzel, Syne, DM Sans, DM Mono, DM Serif Display, Outfit, Inter, JetBrains Mono.
- [GitHub Pages](https://pages.github.com/): static hosting.
- [Shields.io](https://shields.io/): the badges at the top of this README.

## License

Copyright (c) 2026 nicoyogi. **All rights reserved.** See [`LICENSE`](LICENSE).

This repository is publicly viewable for reference only; no rights to reuse,
fork, modify, or redistribute are granted by default, and it contains
project-/client-specific material (e.g. Siemens references, forwarder data)
that is not intended for reuse. If you'd like to reuse any part of it, please
open an issue to coordinate with the maintainer.
