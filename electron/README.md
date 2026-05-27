# Anmerkung Processor — Desktop (Electron)

Wraps `anmerkung.html` in a standalone Electron window so it ships as a
native-feeling Windows app (`.exe`).

## What gets built

`electron-builder` produces two Windows artifacts in `../dist-electron/`:

| File | Type | Notes |
|---|---|---|
| `AnmerkungProcessor-<ver>-portable.exe` | Single-file portable | Double-click to run, no install |
| `AnmerkungProcessor-Setup-<ver>.exe`    | NSIS installer       | Lets the user pick install dir |

## Build it

The cleanest path is the GitHub Actions workflow at
`.github/workflows/build-anmerkung-exe.yml` — it runs on `windows-latest`
and uploads both `.exe` files as a workflow artifact. Trigger via:

- push to `main` that touches `anmerkung.html`, `assets/**`, or `electron/**`
- the **Run workflow** button (workflow_dispatch)
- creating a GitHub Release (the `.exe`s get attached to it)

### Build locally on Windows

```powershell
cd electron
npm install
npm run build:win
```

Output lands in `..\dist-electron\`.

### Build locally on Linux/macOS

Cross-building Windows artifacts from Linux requires Wine (`electron-builder`
shells out to it for the NSIS installer). Easiest fallback: just use the CI
workflow.

## Dev loop

```bash
cd electron
npm install
npm start          # boots Electron pointing at ../anmerkung.html
```

The window loads `anmerkung.html` directly from the repo root, so editing the
HTML / CSS / JS and reloading the window (Ctrl-R) is enough — no rebuild.

## Layout

```
electron/
  package.json     # electron + electron-builder config (build.* block)
  main.js          # main process: window, menu strip, link handling
  preload.js       # empty by design (page needs no Node APIs)
```

The HTML, `assets/`, and `manifest.webmanifest` aren't copied into this
directory — `electron-builder.extraResources` pulls them from the repo root
at build time and lays them out under `<app>/resources/app/`.

## Optional: custom icon

Drop a 256x256 `icon.ico` (or `icon.png`) into `electron/build/` and
electron-builder will pick it up automatically. Without it, the default
Electron icon is used.
