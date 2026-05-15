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

You need to create **two GitHub repository secrets**.

### 1. `TEAMS_WEBHOOK_URL` — Teams Workflow webhook

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
| Dry run   | Manual run with **dry_run = true** — prints the Adaptive Card payload to the action log without posting to Teams |

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
