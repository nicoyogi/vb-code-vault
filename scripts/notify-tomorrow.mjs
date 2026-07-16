#!/usr/bin/env node
/**
 * notify-tomorrow.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Posts a Microsoft Teams message listing everyone on leave "tomorrow"
 * (where tomorrow is computed in Asia/Bangkok, UTC+7).
 *
 * Designed to run from GitHub Actions on a daily schedule. Reads holidays
 * and people from the existing Firestore project (vb-code-vault) using a
 * service account, and posts an Adaptive Card to a Teams Workflow webhook.
 *
 * ── Required env vars ──
 *   FIREBASE_SERVICE_ACCOUNT  JSON string of a service-account key with
 *                             read access to Firestore.
 *   TEAMS_WEBHOOK_URL         The URL produced by the "Post to a channel
 *                             when a webhook request is received" Workflow.
 *
 * ── Optional env vars ──
 *   TIMEZONE       IANA tz name (default: Asia/Bangkok).
 *   SKIP_IF_EMPTY  If "1"/"true", skip posting when no one is on leave
 *                  (default: true). Set to "0"/"false" to always post.
 *   DRY_RUN        If set to "1" / "true", prints the payload but does not POST.
 * ────────────────────────────────────────────────────────────────────────────
 */

import admin from 'firebase-admin';

const TIMEZONE     = process.env.TIMEZONE || 'Asia/Bangkok';
const WEBHOOK_URL  = process.env.TEAMS_WEBHOOK_URL;
const SVC_ACCOUNT  = process.env.FIREBASE_SERVICE_ACCOUNT;
const DRY_RUN      = /^(1|true)$/i.test(process.env.DRY_RUN || '');
const SKIP_IF_EMPTY = !/^(0|false)$/i.test(process.env.SKIP_IF_EMPTY || 'true');

if (!SVC_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT is required.');
  process.exit(1);
}
if (!WEBHOOK_URL && !DRY_RUN) {
  console.error('TEAMS_WEBHOOK_URL is required (or set DRY_RUN=1).');
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

/* ── Date helpers ──────────────────────────────────────────────────────── */
/**
 * Returns the calendar date in TIMEZONE for a given JS Date, formatted YYYY-MM-DD.
 * Uses Intl with en-CA which produces ISO-like output.
 */
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

/* ── Mirrors the holiday-tracker.html mapping ──────────────────────────── */
const LEAVE_TYPE_ICONS = {
  vacation: '🌴', sick: '🤒', wfh: '🏠',
  training: '📚', parental: '👶', other: '📌'
};

function leaveLabel(type) {
  if (!type) return 'Leave';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/* ── Firestore queries ─────────────────────────────────────────────────── */
/**
 * Holidays where start <= target <= end. Firestore can range-filter on a
 * single field, so we filter `start <= target` server-side, then filter
 * `end >= target` in memory. The collection is small (whole team).
 */
async function fetchHolidaysOnDate(targetIso) {
  const snap = await db.collection('wmf_holidays')
    .where('start', '<=', targetIso)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(h => typeof h.end === 'string' && h.end >= targetIso);
}

async function fetchPeopleMap() {
  const snap = await db.collection('wmf_holiday_people').get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  return map;
}

/* ── Adaptive Card payload (Teams Workflow webhook format) ─────────────── */
function buildAdaptiveCard(targetIso, entries) {
  const headerText = entries.length
    ? `Tomorrow on leave · ${fmtHumanDate(targetIso)}`
    : `No one on leave tomorrow · ${fmtHumanDate(targetIso)}`;

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
      text: `${entries.length} ${entries.length === 1 ? 'person' : 'people'} away`,
      wrap: true
    }
  ];

  if (entries.length) {
    const facts = entries.map(e => {
      const icon = LEAVE_TYPE_ICONS[e.type] || '📌';
      const half = e.halfDay ? ` (½ ${e.halfDayPart || ''})`.trimEnd() : '';
      const sameDay = e.start === e.end;
      const range = sameDay
        ? fmtShortDate(e.start)
        : `${fmtShortDate(e.start)} → ${fmtShortDate(e.end)}`;
      const returnDate = addDaysIso(e.end, 1);
      const value = `${icon} ${leaveLabel(e.type)}${half} · ${range} · returns ${fmtShortDate(returnDate)}`;
      return { title: e.personName, value };
    });
    body.push({ type: 'FactSet', facts });
  } else {
    body.push({
      type: 'TextBlock',
      text: 'Everyone is in. Have a productive day.',
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
    text: `Source: Holiday Tracker · ${TIMEZONE}`
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
  const todayIso    = isoInTz(new Date(), TIMEZONE);
  const tomorrowIso = addDaysIso(todayIso, 1);

  console.log(`Today (${TIMEZONE}): ${todayIso}`);
  console.log(`Querying leave for: ${tomorrowIso}`);

  const [rawHolidays, peopleMap] = await Promise.all([
    fetchHolidaysOnDate(tomorrowIso),
    fetchPeopleMap()
  ]);

  const entries = rawHolidays
    .map(h => {
      const person = peopleMap.get(h.personId);
      return {
        ...h,
        personName: person ? person.name : '(Unknown person)',
        personDept: person ? (person.dept || '') : ''
      };
    })
    .sort((a, b) => a.personName.localeCompare(b.personName));

  console.log(`Found ${entries.length} entries.`);
  entries.forEach(e => {
    console.log(`  · ${e.personName} — ${e.type} (${e.start} → ${e.end})`);
  });

  if (!entries.length && SKIP_IF_EMPTY && !DRY_RUN) {
    console.log('No one on leave tomorrow, and SKIP_IF_EMPTY is set. Skipping post.');
    return;
  }

  const payload = buildAdaptiveCard(tomorrowIso, entries);

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
    console.error('notify-tomorrow failed:', err);
    process.exit(1);
  });
