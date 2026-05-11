# The Grimoire

> *"The Malignant Grimoire — a codex of VB/VBA spells, forwarder rituals and arcane workspace tools."*

A small, static collection of tools and reference pages for day-to-day VB/VBA work, QA, forwarder invoice processing, and other workspace rituals. Each page is a self-contained HTML file; there is no build step, no bundler, and no backend — just open a file and go.

**Live site:** [codingkuh.my.id](https://codingkuh.my.id/)

[![Site](https://img.shields.io/badge/site-codingkuh.my.id-0d8c5f)](https://codingkuh.my.id/)
[![Hosting](https://img.shields.io/badge/hosting-GitHub%20Pages-24292e?logo=github)](https://pages.github.com/)
[![No Build](https://img.shields.io/badge/build-none-34d399)](#running-locally)
[![PWA](https://img.shields.io/badge/PWA-offline--capable-5b9cf6)](#offline--pwa)

---

## Table of contents

- [Pages](#pages)
- [The Alchemist — Anmerkung Processor](#the-alchemist--anmerkung-processor)
- [Shared assets](#shared-assets)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
- [Offline / PWA](#offline--pwa)
- [Firebase configuration](#firebase-configuration)
- [Project layout](#project-layout)
- [Contributing](#contributing)

---

## Pages

| Page | Tome | What it is |
| --- | --- | --- |
| [`index.html`](index.html) | **The Grimoire** | Landing page and linking hub for all the tools below. |
| [`code.html`](code.html) | **The Vault** | Browsable reference of VB/VBA snippets and notes. |
| [`qa.html`](qa.html) | **The Oracle** | General QA knowledge base. |
| [`qa-siemens.html`](qa-siemens.html) | **Siemens GP Knowledge Base** | Project-specific QA reference (IBM Plex styling, light/dark). |
| [`standard-wording.html`](standard-wording.html) | **Siemens GP Standard Wording** | Reusable phrasing and copy templates. |
| [`task-reviewer-siemens.html`](task-reviewer-siemens.html) | **Siemens GP Task Reviewer** | Review helper for incoming tasks. |
| [`anmerkung.html`](anmerkung.html) | **The Alchemist** | In-browser processor for forwarder invoice annotations (Dachser / K+N / DHL Express / Wackler). See [below](#the-alchemist--anmerkung-processor). |
| [`todo.html`](todo.html) | **The Ledger** | Task tracker with filters, groups, and a light/dark toggle. |
| [`holiday-tracker.html`](holiday-tracker.html) | **Holiday Tracker** | Team vacation, sick, WFH, and half-day tracking with calendar + Gantt views, vacation balances, public holidays, department filters, and an activity log. Syncs via Firebase Firestore. |

## The Alchemist — Anmerkung Processor

[`anmerkung.html`](anmerkung.html) is the most substantial page in the Grimoire. It parses forwarder invoice spreadsheets (`.xlsx`) entirely client-side and writes a per-row `Anmerkung` column based on forwarder-specific rules.

- **Four forwarder engines:** Dachser, K+N, DHL Express, Wackler — each with its own column resolver and rule set.
- **Preview / dry-run** — see every proposed annotation before writing to the file.
- **Opt-in "Why?" reason column** — writes an extra `Anmerkung_Reason` column so the trigger trace is auditable.
- **Rule Tester** — play with hypothetical values without uploading a file.
- **Diff Mode** — compare two processed workbooks side-by-side; export a CSV diff or a training-set (CSV / JSONL) with predicted vs. expected values plus the input cells the rules read.
- **Configurable tolerance thresholds** per forwarder, persisted in `localStorage`.
- **Light / dark theme**, keyboard-navigable forwarder tiles, timestamped streaming log.
- **Installable as a PWA** (see [Offline / PWA](#offline--pwa)); the service worker is [`sw.js`](sw.js) and the manifest is [`manifest.webmanifest`](manifest.webmanifest).
- **Changelog** is data-driven and lives in [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) — bumping `version` there updates the badge and the "What's new" modal on the next load (the SW serves this file network-first).

XLSX parsing is done with [SheetJS](https://sheetjs.com/) (`xlsx` 0.18.5) and [JSZip](https://stuk.github.io/jszip/); the XLSX is patched in-place without re-encoding cell styles.

## Shared assets

| File | Purpose |
| --- | --- |
| [`assets/grimoire-core.css`](assets/grimoire-core.css) | Shared tokens, base styles, skip-link, reduced-motion rules. |
| [`assets/grimoire-core.js`](assets/grimoire-core.js) | Shared runtime: animated-canvas helpers (`densityScale`, `visibleRAF`, `shouldAnimate`) and the `Grimoire.Offline` module that registers the service worker, runs `PRECACHE` / `CACHE_STATUS` round-trips and binds the "Download for offline" button. |
| [`assets/firebase-config.js`](assets/firebase-config.js) | Centralized Firebase config loaded by pages that need Firestore. |
| [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) | Versioned release notes for the Anmerkung Processor. |
| [`sw.js`](sw.js) | Service worker. Network-first for HTML + the changelog JSON, cache-first for everything else. |
| [`manifest.webmanifest`](manifest.webmanifest) | PWA manifest for the Anmerkung Processor. |

## Tech stack

- **HTML / CSS / vanilla JavaScript** — no build tooling; every page can be opened directly in a browser.
- **Service Worker + PWA** — offline caching for the whole Grimoire, installable on Chrome / Edge.
- **Firebase Firestore** (`firebase-app-compat` + `firebase-firestore-compat` 10.7.2) — real-time sync for `holiday-tracker.html`.
- **SheetJS** (`xlsx` 0.18.5) and **JSZip** — client-side XLSX parsing and writing in `anmerkung.html`.
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

The Alchemist (`anmerkung.html`) is installable and fully offline-capable:

- Click **"Download for offline"** in the header to precache every Grimoire page and asset. A progress indicator reports each URL as it's fetched.
- Once primed, the site works with no network — new cached versions are picked up on the next online visit (HTML and the changelog JSON are served network-first, everything else cache-first).
- The SW lives at [`sw.js`](sw.js). When the cache schema changes, bump the `VERSION` constant to purge old caches on activate.
- `assets/anmerkung-changelog.json` is served **network-first**, so bumping its `version` field surfaces in the badge and "What's new" modal on the next load without requiring a SW version change.

## Firebase configuration

Pages that need Firestore (currently only the Holiday Tracker) import config from [`assets/firebase-config.js`](assets/firebase-config.js) rather than inlining keys per page. If you fork the repo:

1. Create a Firebase project and enable Firestore.
2. Replace the config object in `assets/firebase-config.js` with your project's keys.
3. Mind your Firestore [security rules](https://firebase.google.com/docs/firestore/security/get-started) — the default open rules are not suitable for production.

Firebase API keys in client code are identifiers, not secrets; access control must be enforced by security rules.

## Project layout

```
vb-code-vault/
├── index.html                    # landing page / hub
├── code.html                     # VB snippets (The Vault)
├── qa.html                       # general QA (The Oracle)
├── qa-siemens.html               # Siemens-specific QA
├── standard-wording.html         # standard phrases / templates
├── task-reviewer-siemens.html    # Siemens task reviewer
├── anmerkung.html                # forwarder invoice processor (The Alchemist)
├── todo.html                     # task ledger
├── holiday-tracker.html          # team holiday tracker (Firestore)
├── sw.js                         # service worker
├── manifest.webmanifest          # PWA manifest (Alchemist)
├── assets/
│   ├── grimoire-core.css         # shared styling tokens
│   ├── grimoire-core.js          # shared runtime (canvas + offline helpers)
│   ├── firebase-config.js        # centralized Firebase config
│   └── anmerkung-changelog.json  # versioned release notes for The Alchemist
├── CNAME                         # custom domain config
└── README.md
```

## Contributing

Each HTML file is **self-contained** (styles and scripts inline) apart from the handful of shared files in `assets/`. Conventions:

- Keep shared visual tokens (colors, fonts, spacing, focus-ring rules) in [`assets/grimoire-core.css`](assets/grimoire-core.css) so the pages stay visually consistent.
- Reuse [`Grimoire.Offline`](assets/grimoire-core.js) rather than wiring a service worker per page.
- When editing rule strings in `anmerkung.html`, prefer the `PHRASES` catalog — it is the single source of truth for all Anmerkung output strings.
- When changing the Anmerkung rule engine, bump the version in [`assets/anmerkung-changelog.json`](assets/anmerkung-changelog.json) and add a release note so users see what changed.
- If the service worker cache schema changes, bump `VERSION` in [`sw.js`](sw.js) so old caches are purged on activate.

Pull requests welcome.
