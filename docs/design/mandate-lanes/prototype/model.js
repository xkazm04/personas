/* Mandates engine - the design's structures, DERIVED in code from window.DECISIONS.
 *
 * Nothing here is measured data. Mandates wrap the dataset's goals; envelopes,
 * stewards, acts, asks and spend figures are the design, computed
 * deterministically from item ids so every reload shows the same fleet.
 * `history[].agentWouldHave` is invented in the dataset; every agreement figure
 * built on it is a placeholder for a design that would measure it.
 *
 * Routing law (one function, `route`, used for the backlog AND live arrivals):
 *   no mandate covers it            -> orphanage (never a lane)
 *   a message                       -> talk (conversation is not a decision)
 *   report / council verdict        -> evidence on the mandate (no chip)
 *   inside the signed envelope      -> the steward acts; logged; revertible where possible
 *   crosses a clause                -> BREACH (coalesced per mandate + clause)
 *   outbound message or deletion    -> VALVE (no envelope may pre-authorise these)
 *   a mandate that says it is met   -> CLAIM; a drafted mandate -> SIGN
 */
(function () {
  'use strict';

  function h(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }
  function hs(s, salt) { return h(s + '#' + salt); }
  function pick(arr, r) { return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]; }

  var ACCEPT_P = { idea: 0.47, review: 0.8, incident: 0.65, question: 0.6, council: 0.7, approval: 0.6, policy: 0.5, evolution: 0.5 };
  var SCOPES = {
    'idea.accept': 'accept ideas into the plan',
    'idea.reject': 'reject or defer ideas',
    'review.info': 'approve info and low reviews',
    'incident.triage': 'triage medium and low incidents',
    'question.answer': 'answer questions inside its project',
    'dispatch': 'dispatch accepted work to builders',
    'report.read': 'file reports as evidence',
    'council.attach': 'attach council verdicts as evidence'
  };
  var ALL_SCOPES = Object.keys(SCOPES);
  var CLAUSE = {
    spend: { label: 'Spend cap', short: 'spend' },
    merge: { label: 'Merge held', short: 'merge' },
    scope: { label: 'Outside steward scope', short: 'scope' },
    stop: { label: 'Stop the line', short: 'stop' },
    risk: { label: 'High-severity review', short: 'risk' }
  };
  var VALVE = { 'outbound-message': 'Outbound message', deletion: 'Deletion' };
  var MERGE_LABEL = { never: 'never (every merge asks you)', 'gate-green': 'gate green', 'gate-green+council-ready': 'gate green + council ready' };

  function fmtMoney(n) { return '$' + (Math.round(n * 100) / 100).toFixed(n >= 100 ? 0 : 2).replace(/\.00$/, ''); }

  function create(dec, which) {
    var F = dec[which];
    var nowMs = Date.parse(F.nowIso);
    var M = {
      which: which, nowMs: nowMs, simMs: nowMs, fleet: F,
      mandates: [], byId: {}, byGoal: {}, byProject: {},
      asks: {}, acts: [], orphans: [], evidence: 0,
      you: [], listeners: [], seq: 0, streamIdx: 0,
      stats: { arrived: 0, stewardActs: 0, toYou: 0, orphaned: 0, evidence: 0, held: 0 },
      SCOPES: SCOPES, ALL_SCOPES: ALL_SCOPES, CLAUSE: CLAUSE, VALVE: VALVE, MERGE_LABEL: MERGE_LABEL,
      fmtMoney: fmtMoney, h: h
    };

    // ── Agreement placeholder (history.agentWouldHave is invented in the data)
    var agree = {};
    F.history.forEach(function (x) {
      var a = agree[x.project] || (agree[x.project] = { n: 0, same: 0 });
      a.n++; if (x.agentWouldHave === x.verdict) a.same++;
    });
    var all = F.history.reduce(function (a, x) { a.n++; if (x.agentWouldHave === x.verdict) a.same++; return a; }, { n: 0, same: 0 });
    M.agreement = { all: all, byProject: agree };

    // ── Mandates from goals
    function mandateFromGoal(g, drafted) {
      var r = h(g.id);
      var id = 'M-' + String(++M.seq).padStart(3, '0');
      var state = drafted ? 'draft'
        : g.status === 'done' ? 'claimed'
        : (g.status === 'open' && g.progress === 0) ? 'draft'
        : g.progress >= 80 ? 'claimed' : 'active';
      var tight = hs(g.id, 'tight') < 0.2;
      var decides = tight ? ['idea.reject', 'review.info', 'report.read', 'council.attach', 'dispatch']
        : ALL_SCOPES.filter(function (s) { return s !== 'question.answer' || hs(g.id, 'q') < 0.5; });
      var mr = hs(g.id, 'merge');
      var cap = pick([10, 15, 20, 25, 30, 40], hs(g.id, 'cap'));
      var athena = r < 0.22;
      var kpi = g.kpi ? { name: 'linked KPI', readInDays: state === 'claimed' && g.status !== 'done' ? 1 + Math.floor(hs(g.id, 'kd') * 6) : 0 } : null;
      var m = {
        id: id, goalId: g.id, intent: g.title, project: g.project,
        steward: athena ? 'Athena' : 'App Master · ' + g.project, stewardKind: athena ? 'athena' : 'app-master',
        state: state, version: state === 'draft' ? 0 : 1 + Math.floor(hs(g.id, 'v') * 3), progress: g.progress,
        drafted: !!drafted,
        acceptance: {
          kpi: kpi,
          uat: 'A fresh run of "' + g.title.toLowerCase().replace(/[.:]+$/, '') + '" passes end to end',
          council: hs(g.id, 'c') < 0.3 ? 'full' : 'lite',
          uatPassed: g.progress >= 80 || g.status === 'done',
          councilReady: g.status === 'done' || hs(g.id, 'cr') < 0.6
        },
        envelope: {
          repos: [g.project], spendCap: cap, spendUsed: Math.round(cap * hs(g.id, 'used') * 45) / 100,
          merge: mr < 0.5 ? 'never' : mr < 0.8 ? 'gate-green+council-ready' : 'gate-green',
          builders: 1 + Math.floor(hs(g.id, 'b') * 3), decides: decides,
          outbound: 'never', deletion: 'never', stopRules: '3 failed runs in a row, or 3 re-plans'
        },
        acts: [], held: [], evidence: [], asks: {}, versions: [],
        signedAt: state === 'draft' ? null : nowMs - Math.floor(hs(g.id, 'sa') * 12 + 1) * 864e5
      };
      m.versions.push({ v: m.version, at: m.signedAt || nowMs, note: state === 'draft' ? 'Drafted by Athena from your goal' : 'Signed', by: state === 'draft' ? 'Athena' : 'You' });
      M.mandates.push(m); M.byId[id] = m; M.byGoal[g.id] = m;
      (M.byProject[g.project] = M.byProject[g.project] || []).push(m);
      if (state === 'claimed') ask('claim', m, null, null);
      if (state === 'draft') ask('sign', m, null, null);
      return m;
    }
    F.goals.forEach(function (g) { mandateFromGoal(g, false); });

    // ── Asks: coalesced cards keyed by mandate + clause / valve kind
    function ask(type, m, item, sub) {
      var key = type === 'talk' ? 'talk:' + item.id : (m.id + ':' + type + (sub ? ':' + sub : ''));
      var a = M.asks[key];
      var t = item ? Date.parse(item.createdAt) : M.simMs;
      if (!a) {
        a = M.asks[key] = { key: key, type: type, sub: sub, mandate: m, items: [], createdAt: t, updatedAt: t, fresh: 0, stopTheLine: false, open: true };
        if (m) m.asks[key] = a;
      }
      if (item) { a.items.push(item); a.updatedAt = Math.max(a.updatedAt, t); }
      if (type === 'breach' && (sub === 'stop')) a.stopTheLine = true;
      a.open = true;
      return a;
    }
    M.ask = ask;

    function verdictOf(item) {
      var p = ACCEPT_P[item.kind] == null ? 0.6 : ACCEPT_P[item.kind];
      var r = hs(item.id, 'verdict');
      return r < p ? 'accept' : r < p + (1 - p) * 0.7 ? 'reject' : 'later';
    }
    function costOf(item) { return Math.round((2 + hs(item.id, 'cost') * 9) * 100) / 100; }

    function mandateFor(item) {
      if (item.goalId && M.byGoal[item.goalId]) return M.byGoal[item.goalId];
      var list = (M.byProject[item.source.project] || []).filter(function (m) { return m.state !== 'accepted'; });
      if (!list.length) return null;
      return list[Math.floor(hs(item.id, 'mand') * list.length)];
    }

    function act(m, item, verdict, opts) {
      opts = opts || {};
      var a = {
        id: 'act-' + (M.acts.length + 1), mandate: m, item: item, actor: opts.actor || m.steward,
        verdict: verdict, reversible: opts.reversible !== false, at: opts.at || Math.min(M.simMs, Date.parse(item.createdAt) + Math.floor(hs(item.id, 'lag') * 40 + 2) * 60000),
        version: m.version, reverted: false, cost: opts.cost || 0, live: !!opts.live
      };
      M.acts.push(a); m.acts.push(a);
      if (a.actor === m.steward) M.stats.stewardActs++;
      return a;
    }
    M.act = act;

    // The whole law, in one place.
    function route(item, live) {
      M.stats.arrived++;
      if (item.kind === 'goal') {
        var g = { id: 'goal:new-' + item.id, title: item.title.replace(/^Proposed goal:\s*/i, '').replace(/^./, function (c) { return c.toUpperCase(); }), status: 'open', progress: 0, project: item.source.project, kpi: null };
        var nm = mandateFromGoal(g, true);
        M.stats.toYou++;
        return { to: 'sign', mandate: nm, ask: M.asks[nm.id + ':sign'] };
      }
      if (item.kind === 'message') { M.stats.toYou++; return { to: 'talk', ask: ask('talk', mandateFor(item), item, null) }; }
      var m = mandateFor(item);
      if (!m) { M.orphans.push(item); M.stats.orphaned++; return { to: 'orphan' }; }
      if (m.state === 'draft' || m.state === 'suspended') { m.held.push(item); M.stats.held++; return { to: 'held', mandate: m }; }
      var env = m.envelope, k = item.kind;
      function breach(clause) { M.stats.toYou++; return { to: 'breach', mandate: m, ask: ask('breach', m, item, clause) }; }
      function done(verdict, o) { return { to: 'steward', mandate: m, act: act(m, item, verdict, Object.assign({ live: live }, o || {})) }; }
      if (k === 'report') { m.evidence.push(item); M.stats.evidence++; return done('filed as evidence'); }
      if (k === 'council') { m.evidence.push(item); M.stats.evidence++; return done('attached council verdict'); }
      if (k === 'incident') {
        if (item.tier === 1 || item.severity === 'high' || item.severity === 'critical') return breach('stop');
        return env.decides.indexOf('incident.triage') >= 0 ? done('triaged, retry scheduled') : breach('scope');
      }
      if (k === 'question') return env.decides.indexOf('question.answer') >= 0 ? done('answered inside the project') : breach('scope');
      if (k === 'policy' || k === 'evolution' || k === 'approval') return breach('scope');
      if (k === 'review' && (item.severity === 'high' || item.severity === 'critical')) return breach('risk');
      var v = verdictOf(item);
      if (v === 'reject') return done(k === 'idea' ? 'rejected idea' : 'rejected review');
      if (v === 'later') return done('deferred');
      if (k === 'idea' && env.decides.indexOf('idea.accept') < 0) return breach('scope');
      if (k === 'review' && item.severity === 'medium') return breach('risk');
      var irr = item.irreversible;
      if (irr === 'outbound-message' || irr === 'deletion') { M.stats.toYou++; return { to: 'valve', mandate: m, ask: ask('valve', m, item, irr) }; }
      if (irr === 'merge') {
        if (env.merge === 'never') return breach('merge');
        if (env.merge === 'gate-green+council-ready' && hs(item.id, 'cr') < 0.25) return breach('merge');
        return done('merged on a pre-signed envelope', { merge: true });
      }
      if (irr === 'spend') {
        var c = costOf(item);
        if (env.spendUsed + c > env.spendCap) return breach('spend');
        env.spendUsed = Math.round((env.spendUsed + c) * 100) / 100;
        return done('spent ' + fmtMoney(c), { cost: c, reversible: false });
      }
      return done(k === 'idea' ? 'accepted and dispatched' : 'approved');
    }
    M.route = route;

    // Backlog: oldest first, so spend caps fill in arrival order.
    F.pending.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).forEach(function (it) { route(it, false); });

    // ── The day: arrivals from `stream` land while the operator watches
    M.stream = F.stream.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    M.advance = function (toMs) {
      var landed = [];
      while (M.streamIdx < M.stream.length && Date.parse(M.stream[M.streamIdx].createdAt) <= toMs) {
        var it = M.stream[M.streamIdx++];
        M.simMs = Date.parse(it.createdAt);
        var r = route(it, true); r.item = it; landed.push(r);
        if (r.ask) r.ask.fresh = M.simMs;
      }
      M.simMs = Math.max(M.simMs, toMs);
      if (landed.length) emit({ type: 'arrivals', landed: landed });
      return landed;
    };
    M.dayEndMs = M.stream.length ? Date.parse(M.stream[M.stream.length - 1].createdAt) : nowMs + 864e5;

    // ── Reading helpers
    M.openAsks = function (type) {
      var out = [];
      for (var k in M.asks) { var a = M.asks[k]; if (a.open && (!type || a.type === type)) out.push(a); }
      return out.sort(M.askOrder);
    };
    // Consequence order, not clock order: stop-the-line, then what the ask unblocks, then age.
    M.askOrder = function (a, b) {
      return (b.stopTheLine - a.stopTheLine) || (M.unblocks(b) - M.unblocks(a)) || (a.createdAt - b.createdAt);
    };
    M.unblocks = function (a) {
      if (a.type === 'sign') return a.mandate.held.length + 1;
      if (a.type === 'claim') return 1 + Math.round(a.mandate.acts.length / 20);
      return a.items.length;
    };
    M.laneCount = function (type) { return M.openAsks(type).length; };
    M.itemsToYou = function () { return M.openAsks().reduce(function (s, a) { return s + Math.max(1, a.items.length); }, 0); };

    M.clauseRequest = function (a) {
      var m = a.mandate, e = m.envelope, n = a.items.length;
      if (a.sub === 'spend') {
        var need = a.items.reduce(function (s, it) { return s + costOf(it); }, 0);
        var to = Math.ceil((e.spendUsed + need) / 5) * 5;
        return { amend: 'Raise the spend cap from ' + fmtMoney(e.spendCap) + ' to ' + fmtMoney(to) + ' a day', deny: 'Keep the cap at ' + fmtMoney(e.spendCap), yes: '+' + fmtMoney(to - e.spendCap) + ' a day; ' + n + ' paid step' + (n === 1 ? '' : 's') + ' proceed now', no: n + ' paid step' + (n === 1 ? '' : 's') + ' wait; the steward continues inside ' + fmtMoney(e.spendCap), patch: { spendCap: to } };
      }
      if (a.sub === 'merge') return { amend: 'Let merges land on gate green + council ready', deny: 'Keep these ' + n + ' merge' + (n === 1 ? '' : 's') + ' held', yes: n + ' branch' + (n === 1 ? '' : 'es') + ' merge now, each revertible from the act log', no: 'Branches stay held; work continues on them', patch: { merge: 'gate-green+council-ready' } };
      if (a.sub === 'scope') {
        var kinds = {}; a.items.forEach(function (it) { kinds[it.kind] = 1; });
        var scope = kinds.idea ? 'idea.accept' : kinds.incident ? 'incident.triage' : kinds.question ? 'question.answer' : null;
        return { amend: scope ? 'Add "' + SCOPES[scope] + '" to the steward\'s scope' : 'Accept these proposals into the envelope', deny: 'Decline these ' + n, yes: 'The steward takes these and every later one like them, logged', no: n + ' item' + (n === 1 ? '' : 's') + ' declined with your reason; nothing else changes', patch: scope ? { addScope: scope } : {} };
      }
      if (a.sub === 'stop') return { amend: 'Resume with the steward\'s fix plan', deny: 'Keep the line stopped', yes: 'Builders restart on ' + m.id + '; a second failure stops it again', no: 'Work on ' + m.id + ' stays paused; nothing is lost', patch: {} };
      return { amend: 'Approve the change' + (n > 1 ? 's' : ''), deny: 'Reject the change' + (n > 1 ? 's' : ''), yes: 'Lands through today\'s gate, logged', no: 'Archived with your reason', patch: {} };
    };

    // ── Operator actions. Every one returns a sentence that carries meaning.
    function youLog(text, a) { M.you.unshift({ at: M.simMs, text: text }); emit({ type: 'you', text: text, ask: a }); return text; }
    function close(a) { a.open = false; if (a.mandate) delete a.mandate.asks[a.key]; }
    function bump(m, note) { m.version++; m.versions.push({ v: m.version, at: M.simMs, note: note, by: 'You' }); }

    M.decideBreach = function (a, how, reason) {
      var m = a.mandate, req = M.clauseRequest(a), n = a.items.length;
      if (how === 'suspend') return M.suspend(m, 'from a ' + CLAUSE[a.sub].label.toLowerCase() + ' breach');
      close(a);
      if (how === 'amend') {
        var p = req.patch;
        if (p.spendCap) m.envelope.spendCap = p.spendCap;
        if (p.merge) m.envelope.merge = p.merge;
        if (p.addScope && m.envelope.decides.indexOf(p.addScope) < 0) m.envelope.decides.push(p.addScope);
        if (p.spendCap || p.merge || p.addScope) bump(m, req.amend);
        a.items.forEach(function (it) { act(m, it, a.sub === 'merge' ? 'merged on v' + m.version : a.sub === 'spend' ? 'spent under v' + m.version : 'proceeded under v' + m.version, { at: M.simMs, cost: a.sub === 'spend' ? costOf(it) : 0, reversible: a.sub !== 'spend' }); });
        if (a.sub === 'spend') m.envelope.spendUsed = Math.round((m.envelope.spendUsed + a.items.reduce(function (s, it) { return s + costOf(it); }, 0)) * 100) / 100;
        return youLog(m.id + ' v' + m.version + ': ' + req.amend.toLowerCase() + '. ' + n + ' item' + (n === 1 ? '' : 's') + ' released to ' + m.steward + '.', a);
      }
      a.items.forEach(function (it) { act(m, it, 'declined by you' + (reason ? ': ' + reason : ''), { actor: 'You', at: M.simMs }); });
      return youLog(m.id + ': ' + req.deny.toLowerCase() + '. The steward continues inside v' + m.version + '.', a);
    };
    M.decideValve = function (a, how, ids, reason) {
      var m = a.mandate;
      var pickSet = ids ? a.items.filter(function (it) { return ids.indexOf(it.id) >= 0; }) : a.items.slice();
      a.items = a.items.filter(function (it) { return pickSet.indexOf(it) < 0; });
      if (!a.items.length) close(a);
      pickSet.forEach(function (it) { act(m, it, how === 'approve' ? (a.sub === 'deletion' ? 'deleted, approved by you' : 'sent, approved by you') : 'stopped by you' + (reason ? ': ' + reason : ''), { actor: 'You', at: M.simMs, reversible: how !== 'approve' }); });
      var what = a.sub === 'deletion' ? 'deletion' : 'outbound message';
      return youLog(how === 'approve' ? 'Approved ' + pickSet.length + ' ' + what + (pickSet.length === 1 ? '' : 's') + ' on ' + m.id + '. Each is in the act log under your name.' : 'Stopped ' + pickSet.length + ' ' + what + (pickSet.length === 1 ? '' : 's') + ' on ' + m.id + '. Nothing left the fleet.', a);
    };
    M.claimLock = function (m) {
      var acc = m.acceptance;
      if (acc.kpi && acc.kpi.readInDays > 0) return 'Accept unlocks after the KPI is read, in ' + acc.kpi.readInDays + ' day' + (acc.kpi.readInDays === 1 ? '' : 's') + '. The next measurement decides.';
      if (!acc.councilReady) return 'Accept unlocks when the council ' + acc.council + ' review is ready.';
      return null;
    };
    M.decideClaim = function (a, how, reason) {
      var m = a.mandate;
      if (how === 'accept') {
        var lock = M.claimLock(m);
        if (lock) return youLog('Not yet: ' + lock, null);
        close(a); m.state = 'accepted'; m.progress = 100;
        m.versions.push({ v: m.version, at: M.simMs, note: 'Accepted as met. Steward authority ended.', by: 'You' });
        return youLog(m.id + ' accepted as met. ' + m.steward + '\'s authority on it ended; ' + m.acts.length + ' acts stay in the log.', a);
      }
      close(a); m.state = 'active'; m.progress = Math.min(m.progress, 70);
      m.versions.push({ v: m.version, at: M.simMs, note: 'Sent back: ' + (reason || 'no reason given'), by: 'You' });
      return youLog(m.id + ' sent back to ' + m.steward + (reason ? ': "' + reason + '"' : '') + '.', a);
    };
    M.sign = function (m, edits) {
      if (edits) M.applyEdits(m, edits, true);
      var a = M.asks[m.id + ':sign']; if (a) close(a);
      m.state = 'active'; m.version = Math.max(1, m.version + 1); m.signedAt = M.simMs;
      m.versions.push({ v: m.version, at: M.simMs, note: 'Signed', by: 'You' });
      var held = m.held.splice(0), out = { steward: 0, toYou: 0 };
      held.forEach(function (it) { M.stats.arrived--; M.stats.held--; var r = route(it, true); if (r.to === 'steward') out.steward++; else out.toYou++; });
      return youLog('Signed ' + m.id + ' v' + m.version + '. ' + held.length + ' held item' + (held.length === 1 ? '' : 's') + ' released: ' + out.steward + ' to ' + m.steward + ', ' + out.toYou + ' back to you.', a);
    };
    M.dropDraft = function (m, reason) {
      var a = M.asks[m.id + ':sign']; if (a) close(a);
      m.state = 'accepted'; m.dropped = true;
      m.versions.push({ v: m.version, at: M.simMs, note: 'Draft dropped' + (reason ? ': ' + reason : ''), by: 'You' });
      var n = m.held.length;
      m.held.splice(0).forEach(function (it) { M.orphans.push(it); });
      return youLog('Dropped draft ' + m.id + (reason ? ' ("' + reason + '")' : '') + '. ' + n + ' held item' + (n === 1 ? '' : 's') + ' moved to the orphanage.', a);
    };
    M.applyEdits = function (m, e, silent) {
      var changed = [];
      if (e.intent != null && e.intent !== m.intent) { m.intent = e.intent; changed.push('intent'); }
      if (e.spendCap != null && +e.spendCap !== m.envelope.spendCap) { m.envelope.spendCap = +e.spendCap; changed.push('spend cap ' + fmtMoney(+e.spendCap)); }
      if (e.merge && e.merge !== m.envelope.merge) { m.envelope.merge = e.merge; changed.push('merge: ' + MERGE_LABEL[e.merge]); }
      if (e.decides) { var d = e.decides.join(','); if (d !== m.envelope.decides.join(',')) { m.envelope.decides = e.decides.slice(); changed.push('steward scope'); } }
      if (e.steward && e.steward !== m.steward) { m.steward = e.steward; changed.push('steward'); }
      if (!changed.length) return silent ? '' : youLog('No change to ' + m.id + '.', null);
      if (m.state !== 'draft') bump(m, 'Edited: ' + changed.join(', '));
      return silent ? '' : youLog(m.id + (m.state !== 'draft' ? ' v' + m.version : '') + ': ' + changed.join(', ') + '. Takes effect on the steward\'s next decision.', null);
    };
    M.suspend = function (m, why) {
      m.state = 'suspended';
      Object.keys(m.asks).forEach(function (k) { var a = m.asks[k]; if (a.type !== 'valve') { a.items.forEach(function (it) { m.held.push(it); }); close(a); } });
      m.versions.push({ v: m.version, at: M.simMs, note: 'Suspended ' + (why || ''), by: 'You' });
      return youLog('Suspended ' + m.id + '. Queued runs cancelled, running builders finish into their worktree, nothing merges. Valves stay with you.', null);
    };
    M.resume = function (m) {
      m.state = 'active';
      m.versions.push({ v: m.version, at: M.simMs, note: 'Resumed', by: 'You' });
      var held = m.held.splice(0); held.forEach(function (it) { M.stats.arrived--; route(it, true); });
      return youLog('Resumed ' + m.id + '. ' + held.length + ' held item' + (held.length === 1 ? '' : 's') + ' re-routed.', null);
    };
    M.revert = function (a) {
      if (a.reverted) return youLog('Already reverted.', null);
      if (!a.reversible) return youLog('Cannot revert: ' + a.verdict + '. It is in the log; narrow the scope to stop the next one.', null);
      a.reverted = true;
      var m = a.mandate, scope = scopeOf(a);
      return youLog('Reverted "' + a.item.title + '" (' + a.verdict + ') on ' + m.id + '.' + (scope && m.envelope.decides.indexOf(scope) >= 0 ? ' Press N to take "' + SCOPES[scope] + '" back from the steward.' : ''), null);
    };
    function scopeOf(a) {
      var k = a.item.kind, v = a.verdict;
      if (k === 'idea') return /reject|defer/.test(v) ? 'idea.reject' : 'idea.accept';
      if (k === 'review') return 'review.info';
      if (k === 'incident') return 'incident.triage';
      if (k === 'question') return 'question.answer';
      if (k === 'report') return 'report.read';
      if (k === 'council') return 'council.attach';
      return null;
    }
    M.scopeOf = scopeOf;
    M.narrow = function (m, scope) {
      var i = m.envelope.decides.indexOf(scope);
      if (i < 0) return youLog('"' + SCOPES[scope] + '" is not in ' + m.id + '\'s scope.', null);
      m.envelope.decides.splice(i, 1); bump(m, 'Narrowed: removed "' + SCOPES[scope] + '"');
      return youLog(m.id + ' v' + m.version + ': ' + m.steward + ' no longer may ' + SCOPES[scope] + '. Those come to you as breaches.', null);
    };
    M.adopt = function (project, m) {
      if (m.envelope.repos.indexOf(project) < 0) m.envelope.repos.push(project);
      (M.byProject[project] = M.byProject[project] || []).push(m);
      bump(m, 'Envelope now covers ' + project);
      var moving = M.orphans.filter(function (it) { return it.source.project === project; });
      M.orphans = M.orphans.filter(function (it) { return it.source.project !== project; });
      var out = { steward: 0, toYou: 0 };
      moving.forEach(function (it) { M.stats.arrived--; M.stats.orphaned--; var r = route(it, true); if (r.to === 'steward') out.steward++; else if (r.to !== 'orphan') out.toYou++; });
      return youLog(m.id + ' v' + m.version + ' now covers ' + project + '. ' + moving.length + ' orphans adopted: ' + out.steward + ' handled by the steward, ' + out.toYou + ' to you.', null);
    };
    M.dropOrphans = function (filterFn, label) {
      var drop = M.orphans.filter(filterFn);
      M.orphans = M.orphans.filter(function (it) { return !filterFn(it); });
      return youLog('Dropped ' + drop.length + ' orphan' + (drop.length === 1 ? '' : 's') + ' (' + label + '). They are archived, not deleted.', null);
    };
    M.talk = function (a, how, text) {
      close(a);
      return youLog(how === 'reply' ? 'Replied to ' + a.items[0].source.persona + (text ? ': "' + text + '"' : '') + '.' : 'Dismissed the message from ' + a.items[0].source.persona + '.', a);
    };

    // ── Derived readings for the surfaces
    M.mandateLoad = function (m) {
      var e = m.envelope;
      return { spendPct: Math.min(100, Math.round(e.spendUsed / e.spendCap * 100)), acts: m.acts.length, asks: Object.keys(m.asks).length, held: m.held.length,
        askRatio: m.acts.length ? Object.keys(m.asks).reduce(function (s, k) { return s + Math.max(1, m.asks[k].items.length); }, 0) / (m.acts.length + 1) : 0 };
    };
    // Re-read trigger (replaces the 14-day lapse): use, not the calendar.
    M.reread = function (m) {
      var e = m.envelope, L = M.mandateLoad(m);
      if (L.spendPct >= 90 && L.asks === 0) return 'Quiet but near its cap: is the envelope too wide?';
      if (L.askRatio > 0.25 && L.acts > 6) return 'Asks often for its size: is the envelope too tight?';
      if (e.merge !== 'never' && m.acts.filter(function (a) { return /merged/.test(a.verdict); }).length >= 5) return 'Has merged 5+ times on your signature since you last read it.';
      return null;
    };
    M.sample = function (m, n) {
      var pool = m.acts.filter(function (a) { return a.actor === m.steward; });
      return pool.map(function (a) { return { a: a, r: hs(a.item.id, 'sample' + m.version) }; }).sort(function (x, y) { return x.r - y.r; }).slice(0, n).map(function (x) { return x.a; });
    };
    M.agreementFor = function (m) {
      var a = M.agreement.byProject[m.project];
      return a && a.n ? Math.round(a.same / a.n * 100) : Math.round(M.agreement.all.same / Math.max(1, M.agreement.all.n) * 100);
    };
    M.find = function (q) {
      q = q.toLowerCase(); var out = [];
      M.mandates.forEach(function (m) { if ((m.id + ' ' + m.intent + ' ' + m.steward + ' ' + m.project).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'mandate', m: m }); });
      M.openAsks().forEach(function (a) { var hit = a.items.filter(function (it) { return (it.id + ' ' + it.title).toLowerCase().indexOf(q) >= 0; }); if (hit.length) out.push({ kind: 'ask', a: a, item: hit[0] }); });
      M.mandates.forEach(function (m) { Object.keys(m.envelope).forEach(function (k) { if (k.toLowerCase().indexOf(q) >= 0 || String(m.envelope[k]).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'clause', m: m, clause: k }); }); });
      for (var i = M.acts.length - 1; i >= 0 && out.length < 400; i--) { var a = M.acts[i]; if ((a.item.id + ' ' + a.item.title).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'act', act: a }); }
      M.orphans.forEach(function (it) { if (out.length < 500 && (it.id + ' ' + it.title).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'orphan', item: it }); });
      return out;
    };
    M.orphanGroups = function () {
      var g = {};
      M.orphans.forEach(function (it) { var k = it.source.project; (g[k] = g[k] || { project: k, items: [], producers: {} }).items.push(it); g[k].producers[it.source.persona] = (g[k].producers[it.source.persona] || 0) + 1; });
      return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.items.length - a.items.length; });
    };

    // ── Round 3: readings the inner surfaces show before the operator decides.

    // Where held items WOULD go under an envelope, without routing them: the same law as
    // `route`, side-effect free. A forecast for the sign card, labelled as design.
    M.forecast = function (m, env, items) {
      env = env || m.envelope; items = items || m.held;
      var out = { steward: 0, you: 0, evidence: 0 }, used = env.spendUsed, d = env.decides;
      items.forEach(function (item) {
        var k = item.kind;
        if (k === 'message' || k === 'goal') { out.you++; return; }
        if (k === 'report' || k === 'council') { out.evidence++; return; }
        if (k === 'incident') { if (item.tier === 1 || item.severity === 'high' || item.severity === 'critical' || d.indexOf('incident.triage') < 0) out.you++; else out.steward++; return; }
        if (k === 'question') { if (d.indexOf('question.answer') >= 0) out.steward++; else out.you++; return; }
        if (k === 'policy' || k === 'evolution' || k === 'approval') { out.you++; return; }
        if (k === 'review' && (item.severity === 'high' || item.severity === 'critical')) { out.you++; return; }
        if (verdictOf(item) !== 'accept') { out.steward++; return; }
        if (k === 'idea' && d.indexOf('idea.accept') < 0) { out.you++; return; }
        if (k === 'review' && item.severity === 'medium') { out.you++; return; }
        var irr = item.irreversible;
        if (irr === 'outbound-message' || irr === 'deletion') { out.you++; return; }
        if (irr === 'merge') { if (env.merge === 'never' || (env.merge === 'gate-green+council-ready' && hs(item.id, 'cr') < 0.25)) out.you++; else out.steward++; return; }
        if (irr === 'spend') { var c = costOf(item); if (used + c > env.spendCap) out.you++; else { used += c; out.steward++; } return; }
        out.steward++;
      });
      return out;
    };
    M.costOf = costOf;

    // What a breach's "amend" changes in the envelope, as before -> after rows.
    M.clauseDiff = function (a) {
      var m = a.mandate, e = m.envelope, p = M.clauseRequest(a).patch, rows = [];
      if (p.spendCap) rows.push({ label: 'Spend cap', from: fmtMoney(e.spendCap) + ' a day', to: fmtMoney(p.spendCap) + ' a day' });
      if (p.merge) rows.push({ label: 'Merge', from: MERGE_LABEL[e.merge], to: MERGE_LABEL[p.merge] });
      if (p.addScope) rows.push({ label: 'Steward decides', add: SCOPES[p.addScope] });
      return rows;
    };
    // What an edit of the envelope changes, as before -> after rows.
    M.envDiff = function (m, f) {
      var e = m.envelope, rows = [];
      if (!f) return rows;
      if (f.intent != null && f.intent !== m.intent) rows.push({ label: 'Intent', from: m.intent, to: f.intent });
      if (f.spendCap != null && +f.spendCap !== e.spendCap) rows.push({ label: 'Spend cap', from: fmtMoney(e.spendCap) + ' a day', to: fmtMoney(+f.spendCap) + ' a day' });
      if (f.merge && f.merge !== e.merge) rows.push({ label: 'Merge', from: MERGE_LABEL[e.merge], to: MERGE_LABEL[f.merge] });
      if (f.steward && f.steward !== m.steward) rows.push({ label: 'Steward', from: m.steward, to: f.steward });
      if (f.decides) {
        f.decides.forEach(function (s) { if (e.decides.indexOf(s) < 0) rows.push({ label: 'Steward decides', add: SCOPES[s] }); });
        e.decides.forEach(function (s) { if (f.decides.indexOf(s) < 0) rows.push({ label: 'Steward decides', del: SCOPES[s] }); });
      }
      return rows;
    };

    // A council verdict's members, DERIVED from the item id: the dataset carries no member
    // answers. The arithmetic renormalises over what was measured, as the council skill does.
    var MEMBERS = ['Worth to the user', 'Workmanship', 'Prior art', 'Resilience', 'Running cost', 'Undo cost'];
    M.councilVerdict = function (item) {
      var members = MEMBERS.map(function (n, i) {
        // The varying part leads the key: FNV barely moves its top bits for a change in the last character.
        return { name: n, score: h('mem' + i + '|' + item.id) < 0.12 ? null : 1 + Math.min(4, Math.floor(Math.pow(h('score' + i + '|' + item.id), 0.6) * 5)) };
      });
      var got = members.filter(function (x) { return x.score != null; });
      var coverage = got.length / members.length;
      var score = got.reduce(function (s, x) { return s + x.score; }, 0) / Math.max(1, got.length);
      var outcome = got.some(function (x) { return x.score === 1; }) ? 'fail' : coverage < 0.67 ? 'incomplete' : 'ready';
      return { members: members, coverage: coverage, score: score, outcome: outcome, tone: outcome === 'ready' ? 'ok' : outcome === 'fail' ? 'err' : 'warn' };
    };

    // One-key reasons for every "no", in the operator's words.
    M.reasons = function (kind, sub) {
      if (kind === 'breach') return {
        spend: ['Not worth the spend today', 'Find a cheaper path first', 'Wait for tomorrow\'s cap'],
        merge: ['I review merges on this mandate myself', 'Wait for the council verdict', 'The branch needs a second look'],
        scope: ['Not for this mandate', 'Ask me each time for these', 'Duplicate of earlier work'],
        stop: ['The fix plan is not convincing', 'Find the root cause first', 'Hold until the upstream recovers'],
        risk: ['Too risky without tests', 'Needs a human review first', 'Not now']
      }[sub] || ['Not now'];
      if (kind === 'valve') return sub === 'deletion' ? ['Keep it', 'Archive instead of deleting', 'Ask me again later'] : ['Not to be sent', 'Wrong recipient or wording', 'Draft it again and ask me'];
      if (kind === 'claim') return ['UAT does not cover the real flow', 'Wait for the KPI read first', 'The audit shows acts I would not take'];
      if (kind === 'sign') return ['Not a goal I hold', 'Fold it into an existing mandate', 'Later, not now'];
      return [];
    };

    M.on = function (fn) { M.listeners.push(fn); };
    function emit(ev) { M.listeners.forEach(function (fn) { fn(ev); }); }
    return M;
  }

  // Shared formatting
  function ago(ms, now) {
    var d = Math.max(0, now - ms) / 60000;
    if (d < 1) return 'now';
    if (d < 60) return Math.round(d) + 'm';
    if (d < 1440) return Math.round(d / 60) + 'h';
    return Math.round(d / 1440) + 'd';
  }
  function clock(ms) { var d = new Date(ms); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(s) {
    return esc(s).split(/\n/).map(function (l) {
      if (/^## /.test(l)) return '<h4>' + l.slice(3) + '</h4>';
      if (/^- /.test(l)) return '<li>' + l.slice(2) + '</li>';
      return l ? '<p>' + l + '</p>' : '';
    }).join('');
  }
  function fleetChoice() {
    var q = new URLSearchParams(location.search).get('fleet');
    return q === 'scale' ? 'scale' : 'today';
  }

  window.Mandates = { create: create, ago: ago, clock: clock, esc: esc, md: md, fleetChoice: fleetChoice, hash: h };
})();
