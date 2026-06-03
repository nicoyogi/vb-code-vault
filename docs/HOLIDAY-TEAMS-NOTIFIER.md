# Holiday Tracker · Teams Notifier

Daily Microsoft Teams reminder that lists everyone on leave **tomorrow**, with
their leave type and return date. Runs every day at **13:00 Asia/Bangkok**
via GitHub Actions, queries the Firestore data already used by
`holiday-tracker.html`, and posts an Adaptive Card to a Teams channel.

```
GitHub Actions cron (06:00 UTC = 13:00 Bangkok)
        │
        ▼
  scripts/notify-tomorrow.mjs
   ├── reads wmf_holidays + wmf_holiday_people  (Firebase Admin SDK)
   └── POSTs Adaptive Card  ──────────►  Teams Workflow webhook
                                              │
                                              ▼
                                       #your-channel
```

## Files

| Path | Purpose |
|------|---------|
| `scripts/notify-tomorrow.mjs`           | Node script that queries Firestore and posts to Teams |
| `scripts/package.json`                  | Node deps (`firebase-admin`) |
| `.github/workflows/holiday-notify.yml`  | Daily cron + manual dispatch |

## One-time setup

You need to create **two GitHub repository secrets** — one for Firestore read access (the same data the in-browser Holiday Tracker uses) and one for the Teams webhook.

| Secret | Required? | Purpose |
|--------|-----------|---------|
| `FIREBASE_SERVICE_ACCOUNT` | Yes | JSON of a service-account key with read access to the Firestore project (`wmf_holidays`, `wmf_holiday_people` collections) |
| `TEAMS_WEBHOOK_URL` | Yes | Teams Workflow webhook URL — also used by the Tasks notifier unless `TEAMS_TASKS_WEBHOOK_URL` is set ([see TASKS-TEAMS-NOTIFIER.md](TASKS-TEAMS-NOTIFIER.md)) |

### 1. `FIREBASE_SERVICE_ACCOUNT` — Firestore service-account key

The notifier reads from the same Firebase project as `holiday-tracker.html`, but server-side via the Admin SDK, so it needs a service-account key (not the client-side Firebase config).

1. In the [Firebase console](https://console.firebase.google.com/), open the project that backs the Holiday Tracker.
2. **⚙ Project settings → Service accounts → Generate new private key**. A JSON file downloads.
3. Open the JSON in a text editor — copy the **entire file contents** (including the surrounding `{ ... }`).
4. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: *(paste the raw JSON exactly as exported — no surrounding quotes, no escaping)*
5. Make sure your Firestore [security rules](https://firebase.google.com/docs/firestore/security/get-started) still permit the service account to read `wmf_holidays` and `wmf_holiday_people`. Service-account auth bypasses client security rules by default, but if you've configured custom IAM restrictions on the project, double-check.

> The same key is reused by the [Tasks notifier](TASKS-TEAMS-NOTIFIER.md) — set it once.

### 2. `TEAMS_WEBHOOK_URL` — Teams Workflow webhook

The classic "Incoming Webhook" connector is being retired by Microsoft, so we
use the modern **Workflows** app (Power Automate under the hood — works with
your standard M365 account, no paid license required for this template).

1. In Microsoft Teams, click the channel where notifications should appear.
2. Click the `···` menu next to the channel name → **Workflows**.
3. Pick the template **"Post to a channel when a webhook request is received"**.
4. Sign in / accept permissions → **Next** → confirm the team and channel → **Add workflow**.
5. Copy the generated **HTTP POST URL**.
6. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `TEAMS_WEBHOOK_URL`
   - Value: *(paste the URL)*

## Running it

| When | How |
|------|-----|
| Automatic | Every day at 13:00 Asia/Bangkok (06:00 UTC) |
| Manual    | GitHub → **Actions** → **Holiday Tracker · Notify Tomorrow** → **Run workflow** |
| Dry run (CI) | Manual run with **dry_run = true** — prints the Adaptive Card payload to the action log without posting to Teams |
| Dry run (local) | See [Local dry-run](#local-dry-run) |

## Local dry-run

Useful for verifying the Firestore service account, the date logic, and the Adaptive Card schema without touching Teams.

```bash
cd scripts
npm install     # one-time

# Dry-run: queries Firestore, prints the Adaptive Card payload, does not POST.
FIREBASE_SERVICE_ACCOUNT="$(cat path/to/service-account.json)" \
  npm run notify:tomorrow:dry

# Real run from your laptop (POSTs to Teams). Same env vars + TEAMS_WEBHOOK_URL.
FIREBASE_SERVICE_ACCOUNT="$(cat path/to/service-account.json)" \
  TEAMS_WEBHOOK_URL="https://prod-XX.westus.logic.azure.com/..." \
  npm run notify:tomorrow
```

Set `TIMEZONE=Asia/Jakarta` (or any IANA name) to override the default `Asia/Bangkok` when computing "tomorrow".

## Behaviour notes

- **What "tomorrow" means.** The script computes "today" as the calendar date
  in `Asia/Bangkok`, then adds one day. So a run at 13:00 on Friday Bangkok
  time announces Saturday's leave.
- **Weekends and public holidays are not skipped.** A message is posted every
  day. If no one is away, the card says so explicitly.
- **All leave types are included** — vacation, sick, wfh, training, parental,
  other. Each entry shows an icon, the leave window, and the return date
  (= `end + 1 day`).
- **Half-days** are shown as `(½ AM)` / `(½ PM)`.
- **Return date is calendar-based**, not weekday-aware. If someone's leave
  ends on Friday, "returns Sat 17 May" is what you'll see.

## Changing the schedule or timezone

- Edit `.github/workflows/holiday-notify.yml`.
- Cron is in **UTC**. To change the post time, convert your desired local time
  to UTC and update the `cron:` line. Example: 09:00 Bangkok → `0 2 * * *`.
- To change the timezone used for "tomorrow", edit the `TIMEZONE` env var in
  the same file (any IANA name, e.g. `Asia/Jakarta`).

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Action succeeds but no message in Teams | Wrong webhook URL, or the Workflow was deleted. Recreate the Workflow and update the secret. |
| `Webhook POST failed: 400` | Adaptive Card schema rejected. Re-run with **dry_run = true** to inspect the payload. |
| Action runs but lists no entries when you expect some | Run the dry-run, check `Querying leave for: YYYY-MM-DD` in the log — confirm date and that the holiday entry's `start`/`end` cover it. |
| `FIREBASE_SERVICE_ACCOUNT is not valid JSON` | The secret was pasted with surrounding quotes or got mangled. Repaste the raw JSON exactly as exported from the Firebase console. |
| `FIREBASE_SERVICE_ACCOUNT is required.` | The secret isn't set on the repo (or the workflow is reading a different env name). Settings → Secrets and variables → Actions → confirm `FIREBASE_SERVICE_ACCOUNT` exists. |
