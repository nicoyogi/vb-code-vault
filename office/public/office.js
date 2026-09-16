/* The Office, client side.

   One `snapshot` frame carries the whole state and is the only source of truth;
   the deltas that follow are conveniences. Because every (re)connection opens with
   a fresh snapshot, a dropped delta can never leave this page permanently wrong,
   which is why there is no client-side reconciliation logic here at all.

   All values are written with textContent. Event targets are file paths and shell
   commands from the local machine, and they are never treated as markup. */

(function () {
  'use strict';

  var els = {
    dot: document.getElementById('linkDot'),
    label: document.getElementById('linkLabel'),
    loading: document.getElementById('loading'),
    gate: document.getElementById('gate'),
    gateTitle: document.getElementById('gateTitle'),
    gateBody: document.getElementById('gateBody'),
    gateCmd: document.getElementById('gateCmd'),
    office: document.getElementById('office'),
    spineTask: document.getElementById('spineTask'),
    rail: document.getElementById('rail'),
    gates: document.getElementById('gates'),
    deskGrid: document.getElementById('deskGrid'),
    deskBusy: document.getElementById('deskBusy'),
    deskTotal: document.getElementById('deskTotal'),
    signalRow: document.getElementById('signalRow'),
    filters: document.getElementById('filters'),
    feedEmpty: document.getElementById('feedEmpty'),
    feedList: document.getElementById('feedList'),
    feedCount: document.getElementById('feedCount'),
    moreBtn: document.getElementById('moreBtn')
  };

  var PAGE = 60;

  /* A tool call fires a PreToolUse and a PostToolUse, and both are real events, so
     the feed renders both as rows. This is what tells the two apart: one row says
     the call started, the next says it finished. A lifecycle hook fires once and
     has no second row, so it carries no label. */
  var PHASE = { pre: 'start', post: 'done' };

  var state = {
    events: [],
    byId: new Map(),
    desks: [],
    pipeline: null,
    stats: null,
    sessions: [],
    server: null,
    filter: null,
    shown: PAGE,
    ready: false
  };

  /* ── helpers ────────────────────────────────────────────────────────────── */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function timeOf(event) {
    var raw = event.ts || event.at;
    var ms = typeof raw === 'number' ? raw : Date.parse(raw);
    if (!Number.isFinite(ms)) return '--:--:--';
    var d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return String(n).padStart(2, '0'); })
      .join(':');
  }

  function clockOf(ms) {
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toTimeString().slice(0, 5);
  }

  function count(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
    if (n < 1000) return String(n);
    return n.toLocaleString('en-US');
  }

  function compact(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n === 0) return '0';
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  }

  /* The label that decides how a row reads. Inferred and ambiguous attribution is
     always marked, because a partly-right name shown as fact is worse than a set. */
  function whoOf(event) {
    var a = event.attribution || {};
    var name = a.agent || 'unattributed';

    if (a.confidence === 'ambiguous') {
      var list = (a.candidates || []).join('|') || 'several';
      return { text: name + '?', mark: '[' + list + ']', inferred: true, delegated: true };
    }
    if (a.confidence === 'inferred') {
      return { text: '~' + name, mark: '', inferred: true, delegated: name !== 'orchestrator' };
    }
    if (a.confidence === 'unknown') {
      return { text: name, mark: '?', inferred: true, delegated: true };
    }
    return { text: name, mark: '', inferred: false, delegated: name !== 'orchestrator' };
  }

  /* ── render: pipeline spine ─────────────────────────────────────────────── */
  function renderSpine(pipeline) {
    els.rail.replaceChildren();
    els.gates.replaceChildren();

    if (!pipeline || !pipeline.present) {
      els.spineTask.textContent = 'No task in flight. .agent/task.json is not present.';
      return;
    }

    els.spineTask.textContent = (pipeline.task || '') + (pipeline.state ? ' · ' + pipeline.state : '');

    pipeline.stages.forEach(function (stage, i) {
      var li = el('li', 'stage', stage);
      if (i === pipeline.stageIndex) li.dataset.mark = 'here';
      else if (pipeline.stageIndex > -1 && i < pipeline.stageIndex) li.dataset.mark = 'done';
      els.rail.appendChild(li);
    });

    if (!pipeline.gates.length) {
      els.gates.appendChild(el('li', 'gate-chip', 'No gates recorded yet'));
      return;
    }

    pipeline.gates.forEach(function (gate) {
      var li = el('li', 'gate-chip');
      li.dataset.status = gate.status;
      li.appendChild(el('b', null, gate.name));
      li.appendChild(el('span', null, gate.status));
      if (gate.evidence) li.title = gate.evidence;
      els.gates.appendChild(li);
    });
  }

  /* ── render: desks ──────────────────────────────────────────────────────── */
  function renderDesks() {
    els.deskGrid.replaceChildren();

    var busy = 0;
    state.desks.forEach(function (desk) {
      if (desk.busy) busy++;

      var li = el('li');
      var card = el('button', 'desk');
      card.type = 'button';
      card.dataset.busy = String(Boolean(desk.busy));
      card.dataset.delegated = String(Boolean(desk.busy) && desk.name !== 'orchestrator');
      card.setAttribute('aria-pressed', String(state.filter === desk.name));
      /* The whole card is one button, so every line inside it would otherwise be
         read as its name, including the two-line role description. The name is set
         here instead: which desk it is, and the one state that is not in the name
         of the desk itself. The description stays on screen as text. */
      card.setAttribute('aria-label', desk.name + (desk.busy ? ', working' : ', idle'));

      var top = el('div', 'desk-top');
      top.appendChild(el('span', 'desk-name', desk.name));
      if (desk.busy) {
        /* Every event, not every call: one tool call fires a PreToolUse and a
           PostToolUse, so this figure is twice TOOL CALLS in the strip below. */
        top.appendChild(el('span', 'desk-count', desk.events + (desk.events === 1 ? ' event' : ' events')));
      } else {
        top.appendChild(el('span', 'desk-builtin', desk.builtIn ? 'built-in' : 'idle'));
      }
      card.appendChild(top);

      if (desk.description) card.appendChild(el('p', 'desk-role', desk.description));

      var foot = el('div', 'desk-foot');
      /* A desk that has run nothing yet shows no tool at all: the badge above
         already says it is idle, and "quiet" beside "idle" said it twice. */
      var lastTool = desk.lastTool || (desk.busy ? 'active' : '');
      if (lastTool) foot.appendChild(el('span', 'desk-tool', lastTool));
      if (desk.lastAt) foot.appendChild(el('span', null, clockOf(desk.lastAt)));
      card.appendChild(foot);

      if (desk.task) card.appendChild(el('p', 'desk-task', desk.task));

      card.addEventListener('click', function () {
        state.filter = state.filter === desk.name ? null : desk.name;
        state.shown = PAGE;
        renderDesks();
        renderFilters();
        renderFeed();
      });

      li.appendChild(card);
      els.deskGrid.appendChild(li);
    });

    els.deskBusy.textContent = String(busy);
    els.deskTotal.textContent = String(state.desks.length);
  }

  /* ── render: signal line ────────────────────────────────────────────────── */
  function renderSignal() {
    els.signalRow.replaceChildren();
    var s = state.stats;
    if (!s) return;

    var items = [
      ['sessions', count(state.sessions.length), false],
      ['tool calls', count(s.toolCalls), false],
      ['steps', count(s.steps), false],
      ['tokens in', compact(s.inputTokens), false],
      ['tokens out', compact(s.outputTokens), false],
      ['cache read', compact(s.cacheReadTokens), false]
    ];

    if (s.costUsd > 0) items.push(['cost', '$' + s.costUsd.toFixed(4), true]);
    if (s.attribution && s.attribution.unresolved > 0) {
      items.push(['attribution gaps', count(s.attribution.unresolved), false]);
    }

    items.forEach(function (item) {
      els.signalRow.appendChild(el('dt', null, item[0]));
      var dd = el('dd', item[2] ? 'is-accent' : null, item[1]);
      els.signalRow.appendChild(dd);
    });
  }

  /* ── render: filters ────────────────────────────────────────────────────── */
  function agentNames() {
    var seen = [];
    var set = new Set();
    state.events.forEach(function (event) {
      var a = event.attribution || {};
      var names = a.confidence === 'ambiguous' ? a.candidates || [] : [a.agent || 'unattributed'];
      names.forEach(function (n) {
        if (n && !set.has(n)) { set.add(n); seen.push(n); }
      });
    });
    return seen;
  }

  function renderFilters() {
    els.filters.replaceChildren();

    var names = agentNames();
    /* A filter needs something to choose between, and an empty labelled group is
       still a group in the accessibility tree, so the group is hidden with its
       chips rather than left behind on its own. */
    els.filters.hidden = names.length < 2;
    if (names.length < 2) return;

    var all = el('button', 'filter', 'All');
    all.type = 'button';
    all.setAttribute('aria-pressed', String(state.filter === null));
    all.addEventListener('click', function () {
      state.filter = null;
      state.shown = PAGE;
      renderDesks();
      renderFilters();
      renderFeed();
    });
    els.filters.appendChild(all);

    names.forEach(function (name) {
      var b = el('button', 'filter', name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.filter === name));
      b.addEventListener('click', function () {
        state.filter = state.filter === name ? null : name;
        state.shown = PAGE;
        renderDesks();
        renderFilters();
        renderFeed();
      });
      els.filters.appendChild(b);
    });
  }

  /* ── render: activity ───────────────────────────────────────────────────── */
  function matches(event) {
    if (!state.filter) return true;
    var a = event.attribution || {};
    if (a.confidence === 'ambiguous') return (a.candidates || []).indexOf(state.filter) !== -1;
    return (a.agent || 'unattributed') === state.filter;
  }

  function renderFeed() {
    els.feedList.replaceChildren();

    var visible = state.events.filter(matches);
    var slice = visible.slice(0, state.shown);

    if (!visible.length) {
      els.feedEmpty.hidden = false;
      /* The All chip only exists once there is more than one agent to filter by,
         so the sentence names a control that is actually on screen. */
      els.feedEmpty.textContent = state.events.length
        ? (agentNames().length >= 2
          ? 'No activity for this agent yet. Pick another desk or All.'
          : 'No activity for this agent yet. Pick another desk.')
        : 'No events yet. Hooks fire on the next tool call: run something in Command Code and it lands here. If nothing arrives, restart Command Code so it loads the hooks block in .commandcode/settings.json.';
      els.feedCount.textContent = '';
      els.moreBtn.hidden = true;
      return;
    }

    els.feedEmpty.hidden = true;

    slice.forEach(function (event) {
      var who = whoOf(event);
      var li = el('li', 'row');
      li.dataset.delegation = String(who.delegated);
      if (event.historical) li.classList.add('row-historical');

      li.appendChild(el('span', 'row-time', timeOf(event)));

      var whoCell = el('span', 'row-who', who.text);
      if (who.mark) whoCell.appendChild(el('span', 'row-mark', ' ' + who.mark));
      if (who.inferred) whoCell.title = 'Attribution inferred from the open delegation, not read from the transcript.';
      li.appendChild(whoCell);

      var what = el('span', 'row-what');
      /* Kept on every row, empty for a lifecycle event, so the tool name stays in
         the same column whether or not there is a phase to name. */
      what.appendChild(el('span', 'row-phase', PHASE[event.phase] || ''));
      what.appendChild(el('span', 'row-tool', event.display || event.tool || event.event || 'event'));
      if (event.target) what.appendChild(el('span', 'row-target', event.target));
      li.appendChild(what);

      els.feedList.appendChild(li);
    });

    els.feedCount.textContent = visible.length + (visible.length === 1 ? ' event' : ' events')
      + (state.filter ? ' · ' + state.filter : '');

    els.moreBtn.hidden = visible.length <= state.shown;
    els.moreBtn.textContent = 'Show older (' + Math.max(0, visible.length - state.shown) + ')';
  }

  /* ── connection state ───────────────────────────────────────────────────── */
  function setLink(kind, text) {
    els.dot.dataset.state = kind;
    els.label.textContent = text;
  }

  function showGate(title, body, command) {
    els.loading.hidden = true;
    els.gate.hidden = false;
    els.office.hidden = true;
    els.gateTitle.textContent = title;
    els.gateBody.textContent = body;
    els.gateCmd.hidden = !command;
    if (command) els.gateCmd.querySelector('code').textContent = command;
  }

  /* ── stream ─────────────────────────────────────────────────────────────── */
  function applySnapshot(snap) {
    state.server = snap.server;
    state.desks = snap.desks || [];
    state.sessions = snap.sessions || [];
    state.pipeline = snap.pipeline || null;
    state.stats = snap.stats || null;
    state.events = (snap.events || []).slice().reverse();
    state.byId = new Map();
    state.events.forEach(function (e) { state.byId.set(e.id, e); });

    renderSpine(state.pipeline);
    renderDesks();
    renderSignal();
    renderFilters();
    renderFeed();
  }

  function connect() {
    var source = new EventSource('/api/stream');

    source.addEventListener('snapshot', function (msg) {
      state.ready = true;
      els.loading.hidden = true;
      els.gate.hidden = true;
      els.office.hidden = false;
      setLink('live', 'live');
      try {
        applySnapshot(JSON.parse(msg.data));
      } catch (e) {
        showGate('Unreadable snapshot', 'The server sent a snapshot this page could not parse. Check the terminal running the server.');
      }
    });

    source.addEventListener('event', function (msg) {
      try {
        var event = JSON.parse(msg.data);
        state.byId.set(event.id, event);
        state.events.unshift(event);
        /* The list keeps the newest 1200 events, and the id map is trimmed with it:
           a tab left open must not hold one entry per event for the whole session.
           state.events is newest first, so the tail is what goes. */
        if (state.events.length > 1200) {
          for (var i = 1200; i < state.events.length; i++) state.byId.delete(state.events[i].id);
          state.events.length = 1200;
        }
        renderFeed();
      } catch (e) { /* a torn delta is dropped; the next snapshot repairs it */ }
    });

    source.addEventListener('event.update', function (msg) {
      try {
        var patch = JSON.parse(msg.data);
        var event = state.byId.get(patch.id);
        if (!event) return;
        Object.assign(event, patch);
        renderFeed();
      } catch (e) { /* ignore */ }
    });

    source.addEventListener('desks', function (msg) {
      try {
        state.desks = JSON.parse(msg.data);
        renderDesks();
        renderFilters();
      } catch (e) { /* ignore */ }
    });

    source.addEventListener('pipeline', function (msg) {
      try {
        renderSpine(JSON.parse(msg.data));
      } catch (e) { /* ignore */ }
    });

    source.addEventListener('stats', function (msg) {
      try {
        state.stats = JSON.parse(msg.data);
        state.sessions = state.stats.sessions || state.sessions;
        renderSignal();
      } catch (e) { /* ignore */ }
    });

    source.addEventListener('sessions', function (msg) {
      try {
        state.sessions = JSON.parse(msg.data);
        renderSignal();
      } catch (e) { /* ignore */ }
    });

    source.addEventListener('open', function () {
      if (state.ready) setLink('live', 'live');
    });

    source.addEventListener('error', function () {
      if (source.readyState === EventSource.CLOSED) {
        setLink('offline', 'offline');
        showGate(
          'The office is closed',
          'The page reached the server, then the stream ended and could not be reopened. It listens on loopback only, so nothing outside this machine can connect.',
          'node office/server.mjs'
        );
        return;
      }

      if (state.ready) {
        setLink('reconnecting', 'reconnecting');
        return;
      }

      setLink('offline', 'not running');
      showGate(
        'The office is closed',
        'This page is only a view. It needs the local server, which is not answering on 127.0.0.1:4200. Start it from the repository root:',
        'node office/server.mjs'
      );
    });
  }

  els.moreBtn.addEventListener('click', function () {
    state.shown += PAGE;
    renderFeed();
  });

  connect();
})();
