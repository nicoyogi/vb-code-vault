# The Ledger · Teams Notifier (Near-Due Tasks)

Daily Microsoft Teams reminder that lists pending tasks from the Ledger
(`todo.html` · `wmf_tasks`) which are **overdue** or **due within the next
N days** (default 3 — matching the in-app "soon" amber threshold). Runs
every day at **08:30 Asia/Bangkok** via GitHub Actions, queries the same
Firestore project used by the page, and posts an Adaptive Card to a Teams
channel.

```
GitHub Actions cron (01:30 UTC = 08:30 Bangkok)
        │
        ▼
  scripts/notify-tasks-due.mjs
   ├── reads wmf_tasks  (Firebase Admin SDK, where status=='pending')
   ├── keeps tasks with dueAt <= today + NEAR_DUE_DAYS  (incl. overdue)
   └── POSTs Adaptive Card  ──────────►  Teams Workflow webhook
                                              │
                                              ▼
                                       #your-channel
```

## Files

| Path | Purpose |
|------|---------|
| `scripts/notify-tasks-due.mjs`        | Node script that queries Firestore and posts to Teams |
| `scripts/package.json`                | Node deps (`firebase-admin`) and `notify:tasks*` scripts |
| `.github/workflows/tasks-notify.yml`  | Daily cron + manual dispatch |

## One-time setup

The notifier reuses the same two GitHub repository secrets as the holiday
notifier — if you've already set those up, you're done.

| Secret | Required? | Purpose |
|--------|-----------|---------|
| `FIREBASE_SERVICE_ACCOUNT` | Yes | JSON of a service-account key with read access to Firestore |
| `TEAMS_WEBHOOK_URL`        | Yes (or use `TEAMS_TASKS_WEBHOOK_URL`) | Teams Workflow webhook URL |
| `TEAMS_TASKS_WEBHOOK_URL`  | Optional | If set, used instead of `TEAMS_WEBHOOK_URL` so tasks can post to a different channel than holidays |

To create a Teams Workflow webhook (the modern replacement for the retired
"Incoming Webhook" connector):

1. In Microsoft Teams, click `···` next to the target channel name → **Workflows**.
2. Pick the template **"Post to a channel when a webhook request is received"**.
3. Sign in / accept permissions → **Next** → confirm team and channel → **Add workflow**.
4. Copy the generated **HTTP POST URL**.
5. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `TEAMS_WEBHOOK_URL` (or `TEAMS_TASKS_WEBHOOK_URL` for a separate channel)
   - Value: *(paste the URL)*

## Running it

| When | How |
|------|-----|
| Automatic | Every day at 08:30 Asia/Bangkok (01:30 UTC) |
| Manual    | GitHub → **Actions** → **Ledger · Notify Near-Due Tasks** → **Run workflow** |
| Dry run   | Manual run with **dry_run = true** — prints the Adaptive Card payload to the action log without posting to Teams |

Local dry-run (also useful for verifying schema/permissions):

```bash
cd scripts
FIREBASE_SERVICE_ACCOUNT="$(cat path/to/service-account.json)" \
  npm run notify:tasks:dry
```

## What "near-due" means

The script computes "today" as the calendar date in `Asia/Bangkok`, converts
each task's `dueAt` Timestamp to the same timezone, and keeps any pending
task where `dueAt <= today + NEAR_DUE_DAYS`. That includes:

- **Overdue** — `dueAt < today` (badge/icon: 🚨)
- **Due today** — `dueAt == today` (⏰)
- **Due tomorrow** — `dueAt == today + 1` (⏳)
- **Due in N days** — `dueAt <= today + NEAR_DUE_DAYS` (📅)

Tasks with `status == 'done'` and tasks without a `dueAt` are skipped, so
the notification only chases *open work with a deadline*.

## Behaviour notes

- **Quiet days are skipped by default.** `SKIP_IF_EMPTY` defaults to `true`,
  so no message is posted on days when nothing is overdue or near-due. Set
  it to `false` (manual run input or workflow env) to always post a card —
  useful if you want a daily "all clear" ping.
- **Sort order in the card:** overdue first, then today, tomorrow, then
  upcoming, with each bucket sorted by ascending due date and then by title.
- **Per-task line format:** `<icon> <state label> (<short date>) · <forwarder> · <total>`
  with the task title shown as the FactSet title.
- **Half-days, completion notes, etc.** are ignored — only the title,
  forwarder, total, and due date are surfaced.

## Changing the schedule, timezone, or window

- Edit `.github/workflows/tasks-notify.yml`.
- Cron is in **UTC**. To change the post time, convert your desired local
  time to UTC and update `cron:`. Example: 09:00 Bangkok → `0 2 * * *`.
- To change the timezone used for "today", edit the `TIMEZONE` env var.
- To change the near-due window, edit the `NEAR_DUE_DAYS` env var (any
  non-negative integer; `0` means *only overdue + due today*). The manual
  dispatch also exposes this as an input.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Action succeeds but no message in Teams | Either nothing was due (and `SKIP_IF_EMPTY` is on — check the action log), or the webhook URL is wrong. |
| `Webhook POST failed: 400` | Adaptive Card schema rejected. Re-run with **dry_run = true** to inspect the payload. |
| A task you expected is missing | Check the action log: it prints every pending task that passed the window filter. Common causes: `status != 'pending'`, `dueAt` not set, or `dueAt` is further than `NEAR_DUE_DAYS` ahead. |
| `FIREBASE_SERVICE_ACCOUNT is not valid JSON` | The secret was pasted with surrounding quotes or got mangled. Repaste the raw JSON exactly as exported from the Firebase console. |
