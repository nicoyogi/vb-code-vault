# VB Code Vault

> A small, static "Grimoire" of tools and reference pages for day-to-day VB/VBA work, QA, and workspace rituals.

**Live site:** [codingkuh.my.id](https://codingkuh.my.id/)

No build step, no framework, no server — just a handful of HTML files sharing a common style kit, hosted on GitHub Pages via the `CNAME` file.

---

## Pages

| Page | What it is |
| --- | --- |
| [`index.html`](index.html) | The **Grimoire** landing page. Linking hub for all the tools below. |
| [`code.html`](code.html) | **VB Code Vault** — a browsable reference of VB/VBA snippets and notes. |
| [`qa.html`](qa.html) | **Q&A Knowledge Base** — general QA guidelines and answers. |
| [`qa-siemens.html`](qa-siemens.html) | **Siemens GP Knowledge Base** — project-specific QA reference (IBM Plex styling, light/dark). |
| [`standard-wording.html`](standard-wording.html) | **Siemens GP Standard Wording** — reusable phrasing and copy templates. |
| [`anmerkung.html`](anmerkung.html) | **Anmerkung Processor** — in-browser processor for note/annotation data; parses Excel files client-side via [SheetJS](https://sheetjs.com/) + [JSZip](https://stuk.github.io/jszip/). |
| [`todo.html`](todo.html) | **The Ledger** — task tracker with filters, groups, and a light/dark toggle. |
| [`holiday-tracker.html`](holiday-tracker.html) | **Holiday Tracker** — team vacation, sick, WFH, and half-day tracking with a calendar + Gantt view, vacation balances, public holidays, department filters, and an activity log. Syncs via **Firebase Firestore**. |

## Shared assets

- `assets/grimoire-core.css` — shared tokens and base styles.
- `assets/grimoire-core.js` — shared behavior (e.g. animated background canvas).

## Tech

- **HTML / CSS / vanilla JS** — no build tooling, open any file directly in a browser.
- **Firebase Firestore** (`firebase-app-compat` + `firebase-firestore-compat` 10.7.2) — used by `holiday-tracker.html` for real-time sync.
- **SheetJS** (`xlsx 0.18.5`) and **JSZip** — used by `anmerkung.html` for client-side Excel parsing.
- **Fonts:** Cinzel, Syne, DM Sans, DM Mono, IBM Plex Sans/Mono, Space Grotesk (via Google Fonts).
- **Hosting:** GitHub Pages, with `CNAME` pointing to `codingkuh.my.id`.

## Running locally

Because everything is static, the simplest option is to just open `index.html` in a browser. For pages that fetch external APIs (`holiday-tracker.html` imports public holidays from [date.nager.at](https://date.nager.at/)), serve over HTTP instead:

```bash
# from the repo root
python3 -m http.server 8000
# then browse to http://localhost:8000/
```

Any static server (`npx serve`, `http-server`, VS Code Live Server, etc.) works equally well.

## Project layout

```
vb-code-vault/
├── index.html               # landing page / hub
├── code.html                # VB snippets
├── qa.html                  # Q&A knowledge base
├── qa-siemens.html          # Siemens-specific knowledge base
├── standard-wording.html    # standard phrases / templates
├── anmerkung.html           # annotation processor (xlsx)
├── todo.html                # task ledger
├── holiday-tracker.html     # team holiday tracker (Firestore)
├── assets/
│   ├── grimoire-core.css    # shared styling tokens
│   └── grimoire-core.js     # shared JS (bg canvas, etc.)
├── CNAME                    # custom domain config
└── README.md
```

## Contributing

Edits are page-scoped — each HTML file is self-contained (styles and scripts inline) apart from `assets/grimoire-core.*`. Keep shared visual tokens in `grimoire-core.css` so the pages stay visually consistent.

Pull requests welcome.
