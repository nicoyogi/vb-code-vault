#!/usr/bin/env node
/**
 * notify-tasks-due.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Posts a Microsoft Teams message listing pending tasks from the Ledger
 * (todo.html · wmf_tasks) that are overdue or due within the next N days.
 *
 * Designed to run from GitHub Actions on a daily schedule. Reads tasks
 * from the existing Firestore project (vb-code-vault) using a service
 * account, and posts an Adaptive Card to a Teams Workflow webhook.
 *
 * ── Required env vars ──
 *   FIREBASE_SERVICE_ACCOUNT  JSON string of a service-account key with
 *                             read access to Firestore.
 *   TEAMS_WEBHOOK_URL         The URL produced by the "Post to a channel
 *                             when a webhook request is received" Workflow.
 *                             (TEAMS_TASKS_WEBHOOK_URL takes precedence if
 *                             set, so tasks can post to a different channel
 *                             than the holiday notifier.)
 *
 * ── Optional env vars ──
 *   TIMEZONE         IANA tz name (default: Asia/Bangkok).
 *   NEAR_DUE_DAYS    Number of days ahead to consider "near due"
 *                    (default: 3 — matches the in-app "soon" threshold).
 *   SKIP_IF_EMPTY    If "1"/"true", skip posting when nothing is overdue
 *                    or near-due (default: true). Set to "0"/"false" to
 *                    always post a daily card, even on quiet days.
 *   DRY_RUN          If "1"/"true", prints the payload but does not POST.
 * ────────────────────────────────────────────────────────────────────────────
 */

import admin from 'firebase-admin';

const TIMEZONE      = process.env.TIMEZONE || 'Asia/Bangkok';
const WEBHOOK_URL   = process.env.TEAMS_TASKS_WEBHOOK_URL || process.env.TEAMS_WEBHOOK_URL;
const SVC_ACCOUNT   = process.env.FIREBASE_SERVICE_ACCOUNT;
const NEAR_DUE_DAYS = Math.max(0, parseInt(process.env.NEAR_DUE_DAYS || '3', 10) || 0);
const SKIP_IF_EMPTY = !/^(0|false)$/i.test(process.env.SKIP_IF_EMPTY || 'true');
const DRY_RUN       = /^(1|true)$/i.test(process.env.DRY_RUN || '');

if (!SVC_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT is required.');
  process.exit(1);
}
if (!WEBHOOK_URL && !DRY_RUN) {
  console.error('TEAMS_WEBHOOK_URL (or TEAMS_TASKS_WEBHOOK_URL) is required (or set DRY_RUN=1).');
  process.exit(1);
}

/* ── Firebase init ─────────────────────────────────────────────────────── */
let creds;
try {
  creds = JSON.parse(SVC_ACCOUNT);
} catch (err) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON:', err.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(creds) });
const db = admin.firestore();

/* ── Date helpers (mirrors notify-tomorrow.mjs) ────────────────────────── */
function isoInTz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function diffDaysIso(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((a - b) / 86400000);
}

function fmtHumanDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function fmtShortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short'
  });
}

/* ── In-app "soon" labels (mirrors todo.html `dueInfo`) ────────────────── */
function dueLabel(diffDays) {
  if (diffDays < 0) {
    const n = -diffDays;
    return { state: 'overdue', label: `Overdue by ${n} day${n !== 1 ? 's' : ''}` };
  }
  if (diffDays === 0) return { state: 'today',    label: 'Due today' };
  if (diffDays === 1) return { state: 'tomorrow', label: 'Due tomorrow' };
  return { state: 'soon', label: `Due in ${diffDays} days` };
}

const STATE_ICON = {
  overdue:  '🚨',
  today:    '⏰',
  tomorrow: '⏳',
  soon:     '📅'
};

const STATE_ORDER = { overdue: 0, today: 1, tomorrow: 2, soon: 3 };

/* ── Firestore query ───────────────────────────────────────────────────── */
async function fetchPendingTasks() {
  const snap = await db.collection('wmf_tasks')
    .where('status', '==', 'pending')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ── Adaptive Card payload (Teams Workflow webhook format) ─────────────── */
function buildAdaptiveCard(todayIso, entries) {
  const overdueCount = entries.filter(e => e.state === 'overdue').length;
  const todayCount   = entries.filter(e => e.state === 'today').length;
  const upcomingCount = entries.length - overdueCount - todayCount;

  const headerText = entries.length
    ? `Tasks due soon · ${fmtHumanDate(todayIso)}`
    : `No tasks due soon · ${fmtHumanDate(todayIso)}`;

  const summary = entries.length
    ? [
        overdueCount  ? `${overdueCount} overdue`           : null,
        todayCount    ? `${todayCount} due today`           : null,
        upcomingCount ? `${upcomingCount} due within ${NEAR_DUE_DAYS} day${NEAR_DUE_DAYS !== 1 ? 's' : ''}` : null
      ].filter(Boolean).join(' · ')
    : `Nothing overdue or due in the next ${NEAR_DUE_DAYS} day${NEAR_DUE_DAYS !== 1 ? 's' : ''}.`;

  const body = [
    {
      type: 'TextBlock',
      size: 'Large',
      weight: 'Bolder',
      text: headerText,
      wrap: true
    },
    {
      type: 'TextBlock',
      spacing: 'None',
      isSubtle: true,
      text: summary,
      wrap: true
    }
  ];

  if (entries.length) {
    const facts = entries.map(e => {
      const icon = STATE_ICON[e.state] || '📌';
      const fwd  = e.fwd ? ` · ${e.fwd}`  : '';
      const total = e.total ? ` · ${e.total}` : '';
      const value = `${icon} ${e.label} (${fmtShortDate(e.dueIso)})${fwd}${total}`;
      return { title: e.title || '(untitled task)', value };
    });
    body.push({ type: 'FactSet', facts });
  } else {
    body.push({
      type: 'TextBlock',
      text: 'The ledger is calm. No looming deadlines.',
      wrap: true,
      spacing: 'Medium'
    });
  }

  body.push({
    type: 'TextBlock',
    spacing: 'Medium',
    isSubtle: true,
    size: 'Small',
    wrap: true,
    text: `Source: The Ledger · ${TIMEZONE}`
  });

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body
      }
    }]
  };
}

/* ── Main ──────────────────────────────────────────────────────────────── */
async function main() {
  const todayIso = isoInTz(new Date(), TIMEZONE);
  const cutoffIso = addDaysIso(todayIso, NEAR_DUE_DAYS);

  console.log(`Today (${TIMEZONE}): ${todayIso}`);
  console.log(`Near-due window: through ${cutoffIso} (${NEAR_DUE_DAYS} day${NEAR_DUE_DAYS !== 1 ? 's' : ''} ahead).`);

  const rawTasks = await fetchPendingTasks();

  const entries = rawTasks
    .filter(t => t && t.dueAt && typeof t.dueAt.toDate === 'function')
    .map(t => {
      const dueIso = isoInTz(t.dueAt.toDate(), TIMEZONE);
      const diffDays = diffDaysIso(dueIso, todayIso);
      const { state, label } = dueLabel(diffDays);
      return {
        id: t.id,
        title: t.title || '',
        fwd: t.fwd || '',
        total: t.total || '',
        dueIso,
        diffDays,
        state,
        label
      };
    })
    .filter(t => t.diffDays <= NEAR_DUE_DAYS)
    .sort((a, b) => {
      const sa = STATE_ORDER[a.state] ?? 99;
      const sb = STATE_ORDER[b.state] ?? 99;
      if (sa !== sb) return sa - sb;
      if (a.diffDays !== b.diffDays) return a.diffDays - b.diffDays;
      return (a.title || '').localeCompare(b.title || '');
    });

  console.log(`Pending tasks with due dates: ${rawTasks.filter(t => t.dueAt).length}`);
  console.log(`Overdue or near-due: ${entries.length}`);
  entries.forEach(e => {
    console.log(`  · [${e.state}] ${e.title} — due ${e.dueIso} (${e.label})`);
  });

  if (!entries.length && SKIP_IF_EMPTY && !DRY_RUN) {
    console.log('Nothing overdue or near-due, and SKIP_IF_EMPTY is set. Skipping post.');
    return;
  }

  const payload = buildAdaptiveCard(todayIso, entries);

  if (DRY_RUN) {
    console.log('DRY_RUN — payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // Teams Workflow webhooks return 202 Accepted on success.
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook POST failed: ${res.status} ${res.statusText} ${text}`);
  }
  console.log(`Posted to Teams (HTTP ${res.status}).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('notify-tasks-due failed:', err);
    process.exit(1);
  });
