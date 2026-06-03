# The Grimoire

> *"The Malignant Grimoire — a codex of VB/VBA spells, forwarder rituals and arcane workspace tools."*

A small, static collection of tools and reference pages for day-to-day VB/VBA work, QA, forwarder invoice processing, and other workspace rituals. The HTML files are static, loading scripts and styles from `assets/`; there is no build step, no bundler, and no backend — just open a file and go.

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
- [The Alchemist — Anmerkung Processor](#the-alchemist--anmerkung-processor)
- [Shared assets](#shared-assets)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
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
| Understand the Alchemist end-to-end (user flow + rule engine) | [`docs/ANMERKUNG-WORKFLOW.md`](docs/ANMERKUNG-WORKFLOW.md) |
| Understand the Alchemist's architecture (modules, state, PWA shell, extensibility) | [`docs/ANMERKUNG-ARCHITECTURE.md`](docs/ANMERKUNG-ARCHITECTURE.md) |
| Look up a VB/VBA snippet | [The Vault](https://codingkuh.my.id/code.html) · [source](code.html) |
| Check team absences / leave | [Holiday Tracker](https://codingkuh.my.id/holiday-tracker.html) · [source](holiday-tracker.html) |
| Review a Siemens task | [Task Reviewer](https://codingkuh.my.id/task-reviewer-siemens.html) · [source](task-reviewer-siemens.html) |
| Install the Alchemist offline | [Offline / PWA](#offline--pwa) |
| Fork and self-host | [Running locally](#running-locally) · [Firebase configuration](#firebase-configuration) |

---

## Pages

| Page | Tome | What it is | Live |
| --- | --- | --- | --- |
| [`index.html`](index.html) | **The Grimoire** | Landing page and linking hub for all the tools below. | [↗](https://codingkuh.my.id/) |
| [`code.html`](code.html) | **The Vault** | Browsable reference of VB/VBA snippets and notes. | [↗](https://codingkuh.my.id/code.html) |
| [`qa.html`](qa.html) | **The Oracle** | General QA knowledge base. | [↗](https://codingkuh.my.id/qa.html) |
| [`qa-siemens.html`](qa-siemens.html) | **Siemens GP Knowledge Base** | Project-specific QA reference (IBM Plex styling, light/dark). | [↗](https://codingkuh.my.id/qa-siemens.html) |
| [`standard-wording.html`](standard-wording.html) | **Siemens GP Standard Wording** | Reusable phrasing and copy templates. | [↗](https://codingkuh.my.id/standard-wording.html) |
| [`task-reviewer-siemens.html`](task-reviewer-siemens.html) | **Siemens GP Task Reviewer** | Review helper for incoming tasks. | [↗](https://codingkuh.my.id/task-reviewer-siemens.html) |
| [`anmerkung.html`](anmerkung.html) | **The Alchemist** | In-browser processor for forwarder invoice annotations (Dachser / K+N / DHL Express / Wackler). See [below](#the-alchemist--anmerkung-processor). | [↗](https://codingkuh.my.id/anmerkung.html) |
| [`todo.html`](todo.html) | **The Ledger** | Task tracker with filters, groups, and a light/dark toggle. | [↗](https://codingkuh.my.id/todo.html) |
| [`holiday-tracker.html`](holiday-tracker.html) | **Holiday Tracker** | Team vacation, sick, WFH, and half-day tracking with calendar + Gantt views, vacation balances, public holidays, department filters, and an activity log. Syncs via Firebase Firestore. | [↗](https://codingkuh.my.id/holiday-tracker.html) |

## The Alchemist — Anmerkung Processor

[`anmerkung.html`](anmerkung.html) is the most substantial page in the Grimoire. It parses forwarder invoice spreadsheets (`.xlsx`) entirely client-side and writes a per-row `Anmerkung` column based on forwarder-specific rules.

**Full workflow documentation:** [`docs/ANMERKUNG-WORKFLOW.md`](docs/ANMERKUNG-WORKFLOW.md) — user flow (Part A) plus engine internals, per-forwarder decision trees, column resolution, and the XLSX patching pipeline (Part C).

### Feature highlights

- **Four forwarder engines:** Dachser, K+N, DHL Express, Wackler — each with its own column resolver and rule set.
- **Preview / dry-run** — see every proposed annotation before writing to the file, with color-coded per-row status and a trigger-breakdown bar chart.
- **Bulk processing** — drop many `.xlsx` files at once; each gets an individual download, plus a "Download all as ZIP" option.
- **Rule Tester** — play with hypothetical values without uploading a file; useful for pinning down exactly when a rule fires.
- **Diff Mode / Rule Training** — compare a predicted vs. expected workbook, get rows labeled `wrong` / `missed` / `overfired` / `drift` / `correct`, filter by forwarder / sheet / free text, and export a CSV diff or a training set (CSV / JSONL) with predicted vs. expected plus the input cells the rules read. Every row has a one-click **Send to Tester** to open that exact scenario in the Rule Tester.
- **Opt-in "Why?" reason column** — writes an extra `Anmerkung_Reason` column so the trigger trace is auditable.
- **Configurable tolerance thresholds** per forwarder, persisted in `localStorage`.
- **Light / dark theme**, keyboard-navigable forwarder tiles (ARIA radiogroup), timestamped streaming log.
- **Installable as a PWA** (see [Offline / PWA](#offline--pwa)); the service worker is [`sw.js`](sw.js) and the manifest is [`manifest.webmanifest`](manifest.webmanifest).
- **Always-fresh deploys** — same-origin assets are served network-first, so content/rule edits reach users on their next online load with no cache-bust step required. The cache acts purely as an offline fallback.
- **Data-driven changelog** — [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) drives both the version badge and the in-app "What's new" modal, so prepending an entry there is the canonical way to publish release notes.

XLSX parsing is done with [SheetJS](https://sheetjs.com/) (`xlsx` 0.20.3, loaded from the official `cdn.sheetjs.com` with an SRI hash) and [JSZip](https://stuk.github.io/jszip/); the XLSX is patched in-place — only the `Anmerkung` column (and optionally `Anmerkung_Reason`) is rewritten, leaving styles, merged cells, formulas, and drawings untouched.

## Assets

| File | Purpose |
| --- | --- |
| [`assets/grimoire-core.css`](assets/grimoire-core.css) | Shared tokens, base styles, skip-link, reduced-motion rules. |
| [`assets/grimoire-core.js`](assets/grimoire-core.js) | Shared runtime: animated-canvas helpers (`densityScale`, `visibleRAF`, `shouldAnimate`) and the `Grimoire.Offline` module that registers the service worker, runs `PRECACHE` / `CACHE_STATUS` round-trips, and binds the "Download for offline" button. |
| [`assets/grimoire-pages.css`](assets/grimoire-pages.css) | Shared styles for standard pages (cards, grids). |
| [`assets/firebase-config.js`](assets/firebase-config.js) | Centralized Firebase config loaded by pages that need Firestore. |
| [`assets/anmerkung.css`](assets/anmerkung.css) · [`assets/anmerkung.js`](assets/anmerkung.js) | Styling and rule engine for The Alchemist. |
| [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) | Versioned release notes for the Anmerkung Processor. |
| [`assets/holiday-tracker.css`](assets/holiday-tracker.css) · [`assets/holiday-tracker.js`](assets/holiday-tracker.js) | Styling and logic for the Holiday Tracker. |
| [`assets/todo.css`](assets/todo.css) · [`assets/todo.js`](assets/todo.js) | Styling and logic for The Ledger. |
| [`sw.js`](sw.js) | Service worker. Network-first for **same-origin** assets (always serve the latest deployed code when online), cache-first for cross-origin CDN libs. Cache acts purely as an offline fallback. |
| [`manifest.webmanifest`](manifest.webmanifest) | PWA manifest for the Anmerkung Processor. |

## Tech stack

- **HTML / CSS / vanilla JavaScript** — no build tooling; every page can be opened directly in a browser.
- **Service Worker + PWA** — offline caching for the whole Grimoire, installable on Chrome / Edge.
- **Firebase Firestore** (`firebase-app-compat` + `firebase-firestore-compat` 10.12.2) — real-time sync for `holiday-tracker.html`. CDN scripts are pinned with Subresource Integrity (SRI) hashes.
- **SheetJS** (`xlsx` 0.20.3, from `cdn.sheetjs.com`) and **JSZip** — client-side XLSX parsing and writing in `anmerkung.html`.
- **Fonts (Google Fonts):** Cinzel, Syne, DM Sans, DM Mono, IBM Plex Sans/Mono, Space Grotesk.
- **Hosting:** GitHub Pages with a `CNAME` pointing to `codingkuh.my.id`.

## Running locally

Most pages work by opening the HTML file directly in a browser. For anything that uses `fetch` (the Anmerkung changelog JSON, the public-holidays API in the Holiday Tracker, or the service worker), serve over HTTP:

```bash
# from the repo root
python3 -m http.server 8000
# then browse to http://localhost:8000/
```

Any static server works — `npx serve`, `http-server`, or VS Code Live Server are fine alternatives.

> **Tip:** Service workers are only active when the site is served over `http(s)://` (or `file://` on a few browsers with flags). Use a local server to exercise offline mode.

## Offline / PWA

The Alchemist (`anmerkung.html`) is installable and fully offline-capable, but it's also **always-fresh** when online — the cache is treated as an offline fallback, not a content gate.

- Click **"Download for offline"** in the header to precache every Grimoire page and asset. A progress indicator reports each URL as it's fetched.
- **Online behavior:** every same-origin request (HTML, JS, CSS, JSON, manifest) goes network-first, so the latest deployed version of each file always wins. Cross-origin CDN libraries (SheetJS, JSZip, fonts) are cache-first because they're immutable per URL.
- **Offline behavior:** if the network fails, the SW falls back to whatever it last cached. Navigation requests with no cached entry fall back to the cached `./anmerkung.html` shell so the app still boots.
- **No version bumps required for content updates.** Editing `anmerkung.js`, `anmerkung.css`, the changelog JSON, or any other same-origin asset and pushing to `main` is enough — users get it on their next online load. Bump `VERSION` in [`sw.js`](sw.js) only when the SW logic itself changes (rare).

## Privacy & data handling

The Grimoire is deliberately thin on backend surface area.

- **The Alchemist processes every `.xlsx` entirely in your browser.** Invoices are parsed, evaluated, and re-zipped locally via [SheetJS](https://sheetjs.com/) + [JSZip](https://stuk.github.io/jszip/); nothing is uploaded anywhere. Bulk processing, Preview, Diff Mode, and the Rule Tester are all client-side.
- **Preferences** (theme, thresholds, forwarder selection) live in `localStorage` on your device.
- **Holiday Tracker** is the only page that talks to a server: it uses Firebase Firestore for real-time team sync. If you fork this repo, point it at your own Firebase project ([see below](#firebase-configuration)) and lock it down with Firestore security rules.
- **Google Fonts** are loaded from `fonts.googleapis.com` / `fonts.gstatic.com`. Remove the `<link>` tags in each HTML if you need a fully self-hosted asset graph.
- **Public holidays** in the Holiday Tracker come from an external public-holidays API.

## Browser support

- Tested on recent **Chrome** and **Edge** (desktop). PWA install and the service worker work out of the box there.
- **Firefox** and **Safari** run the pages fine; PWA install UX is browser-specific (e.g. Safari requires "Add to Home Screen" on iOS, and install prompts differ on desktop Firefox).
- Requires a modern baseline: ES2020+, `fetch`, `async`/`await`, service workers, `WeakMap`, and `localStorage`. No transpilation is shipped.
- Pointer-coarse devices (phones/tablets) get a trimmed UI — e.g. keyboard-shortcut badges on project tiles are hidden.

## Firebase configuration

Pages that need Firestore (currently only the Holiday Tracker) import config from [`assets/firebase-config.js`](assets/firebase-config.js) rather than inlining keys per page. If you fork the repo:

1. Create a Firebase project and enable Firestore.
2. Replace the config object in `assets/firebase-config.js` with your project's keys.
3. Deploy the Firestore security rules in [`firestore.rules`](firestore.rules). They allow-list only the collections the apps use (everything else is denied by default), which is safer than the default open rules. **They do not add authentication** — the collections are still effectively public, so also enable Firebase Authentication and/or [App Check](https://firebase.google.com/docs/app-check) and API key referrer restrictions if the data is sensitive. See Firestore [security rules](https://firebase.google.com/docs/firestore/security/get-started).

Firebase API keys in client code are identifiers, not secrets; access control must be enforced by security rules.

## Project layout

```
vb-code-vault/
├── index.html                       # landing page / hub
├── code.html                        # VB snippets (The Vault)
├── qa.html                          # general QA (The Oracle)
├── qa-siemens.html                  # Siemens-specific QA
├── standard-wording.html            # standard phrases / templates
├── task-reviewer-siemens.html       # Siemens task reviewer
├── anmerkung.html                   # forwarder invoice processor (The Alchemist)
├── anmerkung-presentation.html      # presentation deck for the Alchemist
├── todo.html                        # task ledger
├── holiday-tracker.html             # team holiday tracker (Firestore)
├── sw.js                            # service worker
├── manifest.webmanifest             # PWA manifest (Alchemist)
├── assets/
│   ├── grimoire-core.css            # shared styling tokens
│   ├── grimoire-core.js             # shared runtime (canvas + offline helpers)
│   ├── grimoire-pages.css           # shared styles for standard pages
│   ├── anmerkung.css                # Alchemist styles
│   ├── anmerkung.js                 # Alchemist rule engine + UI glue
│   ├── holiday-tracker.css          # Holiday Tracker styles
│   ├── holiday-tracker.js           # Holiday Tracker logic
│   ├── todo.css                     # The Ledger styles
│   ├── todo.js                      # The Ledger logic
│   ├── firebase-config.js           # centralized Firebase config
│   └── anmerkung-changelog.json     # versioned release notes for The Alchemist
├── docs/
│   ├── ANMERKUNG-WORKFLOW.md        # user flow + engine internals for The Alchemist
│   ├── ANMERKUNG-ARCHITECTURE.md    # system architecture / extensibility recipes
│   ├── HOLIDAY-TEAMS-NOTIFIER.md    # daily Teams cron for the Holiday Tracker
│   └── TASKS-TEAMS-NOTIFIER.md      # daily Teams cron for The Ledger (tasks due)
├── scripts/
│   ├── notify-tomorrow.mjs          # Holiday Tracker → Teams Adaptive Card
│   ├── notify-tasks-due.mjs         # The Ledger → Teams Adaptive Card
│   ├── package.json                 # Node deps for the notifier scripts
│   └── package-lock.json            # pinned dependency tree (used by `npm ci` in CI)
├── .github/workflows/
│   ├── holiday-notify.yml           # daily cron + manual dispatch (holidays)
│   └── tasks-notify.yml             # daily cron + manual dispatch (tasks)
├── data/                            # reference training corpora (Dachser, K+N samples)
├── firestore.rules                  # Firestore security rules (collection allow-list)
├── .gitignore
├── CNAME                            # custom domain config
├── LICENSE                          # all rights reserved
└── README.md
```

## Contributing

The HTML files load their specific scripts and styles from the `assets/` folder. Conventions:

- Keep shared visual tokens (colors, fonts, spacing, focus-ring rules) in [`assets/grimoire-core.css`](assets/grimoire-core.css) so the pages stay visually consistent.
- Reuse [`Grimoire.Offline`](assets/grimoire-core.js) rather than wiring a service worker per page.
- When editing rule strings in `anmerkung.html`, prefer the `PHRASES` catalog in [`assets/anmerkung.js`](assets/anmerkung.js) — it is the single source of truth for all Anmerkung output strings.
- When changing the Anmerkung rule engine, bump the version in [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) and add a release note so users see what changed in the in-app "What's new" modal. Also update [`docs/ANMERKUNG-WORKFLOW.md`](docs/ANMERKUNG-WORKFLOW.md) if the decision tree or column layout changed, and [`docs/ANMERKUNG-ARCHITECTURE.md`](docs/ANMERKUNG-ARCHITECTURE.md) if module boundaries / state shapes / SW strategy changed.
- **You generally do not need to bump `VERSION` in [`sw.js`](sw.js).** Same-origin assets are served network-first, so content/rule edits ship to users on their next online load with no cache invalidation step. Bump `VERSION` only when the SW logic itself changes (e.g., new caching strategy, new message types) — that rotates the cache name and forces a fresh re-install of `CORE`.

Pull requests welcome.

## Credits

Third-party libraries and services that make the Grimoire possible:

- [SheetJS (`xlsx`)](https://sheetjs.com/) — client-side XLSX reading/writing.
- [JSZip](https://stuk.github.io/jszip/) — ZIP manipulation used to patch `.xlsx` files without re-encoding styles.
- [Firebase](https://firebase.google.com/) — Firestore sync for the Holiday Tracker.
- [Google Fonts](https://fonts.google.com/) — Cinzel, Syne, DM Sans, DM Mono, IBM Plex Sans/Mono, Space Grotesk.
- [GitHub Pages](https://pages.github.com/) — static hosting.
- [Shields.io](https://shields.io/) — the badges at the top of this README.

## License

Copyright (c) 2026 nicoyogi. **All rights reserved.** See [`LICENSE`](LICENSE).

This repository is publicly viewable for reference only; no rights to reuse,
fork, modify, or redistribute are granted by default, and it contains
project-/client-specific material (e.g. Siemens references, forwarder data)
that is not intended for reuse. If you'd like to reuse any part of it, please
open an issue to coordinate with the maintainer.
