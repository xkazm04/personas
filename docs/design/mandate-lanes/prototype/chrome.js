/* The monitor frame around the decision surface: header, census, supply plates, bays,
   dock, toast, find palette, help, and the day simulator. Rendered from window.FLEET
   (data/ui/fleet.js) so the frame is the real harness fleet, not a mock. */
(function () {
  'use strict';
  var esc = function (s) { return window.Mandates.esc(s); };
  var ICON = function (icon) { return '../data/ui/assets/agent_icons/' + (icon || 'code') + '-dark.webp'; };
  var SVG = {
    pulse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>'
  };

  function header(which) {
    var q = function (v) { var p = new URLSearchParams(location.search); p.set('fleet', v); return '?' + p.toString(); };
    return '<header class="hdr">' +
      '<span class="logo">' + SVG.pulse + '</span><h1>Persona Monitor</h1>' +
      '<nav class="tabs"><span class="tab on">' + SVG.grid + 'Activity</span><span class="tab">' + SVG.chat + 'Conversations</span><span class="tab">' + SVG.map + 'Map</span>' +
      '<span class="fleet-toggle" title="Dataset: press D to switch"><a class="' + (which === 'today' ? 'on' : '') + '" href="' + q('today') + '">today</a><a class="' + (which === 'scale' ? 'on' : '') + '" href="' + q('scale') + '">scale ×10</a></span>' +
      '<span class="muted" style="font-size:.875rem;margin-left:6px"><kbd>D</kbd></span></nav></header>';
  }

  function census(fleet, mandated) {
    var c = { run: 0, warn: 0, err: 0, idle: 0 };
    fleet.personas.forEach(function (p) {
      if (p.pile === 'needs' && mandated) { if (p.needTone === 'critical') c.err++; else if (p.running) c.run++; else c.idle++; }
      else if (p.pile === 'needs') { if (p.needTone === 'critical') c.err++; else c.warn++; }
      else if (p.pile === 'working') c.run++; else c.idle++;
    });
    fleet.sessions.forEach(function (s) {
      if (s.state === 'running') c.run++; else if (s.state === 'awaiting_input') c.warn++; else c.idle++;
    });
    var total = c.run + c.warn + c.err + c.idle;
    function tag(tone, n, lit, title) { return '<span class="tag ae-win ' + (lit && n ? 'is-lit ' : '') + 'ae-t-' + tone + '" title="' + title + '"><i class="ae-lamp ' + (lit && n ? 'is-lit' : '') + '"></i><span class="typo-data">' + n + '</span></span>'; }
    return '<div class="census" aria-label="Agents">' +
      '<span class="tag ae-win is-lit is-selected ae-t-run" title="All agents and sessions"><i class="ae-lamp is-lit"></i><span class="typo-data">' + total + '</span></span>' +
      tag('run', c.run, true, 'Running') + tag('warn', c.warn, true, 'Agents with a need (today\'s count, before mandates)') + tag('err', c.err, true, 'Failed') + tag('off', c.idle, false, 'Idle') + '</div>';
  }

  function sessionsPlate(fleet) {
    var q = fleet.queue, on = '';
    for (var i = 0; i < q.cap; i++) on += '<i class="' + (i < q.running ? 'on' : '') + '"></i>';
    return '<section class="plate ae-plate"><div class="engrave">Sessions <i class="ae-lamp is-lit ae-t-run" style="width:6px;height:6px;vertical-align:middle"></i></div>' +
      '<div style="font-size:1.6rem;font-weight:700;margin-top:4px" class="num">' + q.running + ' <span class="muted" style="font-size:1rem">/ ' + q.cap + '</span></div><div class="rack">' + on + '</div>' +
      '<div class="muted" style="margin-top:6px;font-size:.875rem">' + q.entries.length + ' queued</div></section>';
  }

  function usagePlate(fleet) {
    var rows = fleet.usage.plans.slice(0, 4).map(function (p) {
      var w = p.windows ? p.windows.fiveHour.usedPct : 0;
      var left = 100 - w;
      return '<span class="dim" style="font-size:.875rem">' + esc((p.provider || '?').slice(0, 2)) + '</span><div><div class="ae-bar ' + (p.live ? 'ae-t-run' : 'ae-t-off') + '"><span style="width:' + left + '%"></span></div><div class="dim" style="font-size:.875rem;margin-top:2px">' + esc(p.label || p.provider) + (p.windows ? ' · ' + left + '% left' : ' · not installed') + '</div></div>';
    }).join('');
    return '<section class="plate ae-plate"><div class="engrave">Subscription usage</div><div class="fuel">' + rows + '</div></section>';
  }

  /** Bays from the fleet. lampFn(persona) -> { cls: 'needs'|'critical'|'working'|'off'|'quiet', count, title }. */
  function bays(fleet, lampFn, opts) {
    opts = opts || {};
    var teams = fleet.teams.filter(function (t) { return t.kind === 'project'; });
    var by = {}; fleet.personas.forEach(function (p) { (by[p.teamId || '_none'] = by[p.teamId || '_none'] || []).push(p); });
    var order = { needs: 0, critical: 0, working: 1, quiet: 2, off: 3 };
    var html = teams.concat([{ id: '_none', name: 'Ungrouped', color: '#64748b' }]).map(function (t) {
      var ps = by[t.id] || []; if (!ps.length) return '';
      var lines = ps.map(function (p) { return { p: p, l: lampFn(p) }; }).sort(function (a, b) { return order[a.l.cls] - order[b.l.cls]; });
      var lit = lines.filter(function (x) { return x.l.cls === 'needs' || x.l.cls === 'critical'; }).length;
      var max = opts.maxLines || 99;
      var body = lines.slice(0, max).map(function (x) {
        return '<div class="pline ' + x.l.cls + '" title="' + esc(x.l.title || '') + '"><img alt="" src="' + ICON(x.p.icon) + '"><span class="nm">' + esc(x.p.name) + '</span>' + (x.l.count ? '<span class="ct">' + x.l.count + '</span>' : '') + '</div>';
      }).join('') + (lines.length > max ? '<div class="dim" style="padding:2px 10px;font-size:.875rem">+' + (lines.length - max) + ' more</div>' : '');
      var np = opts.nameplate ? opts.nameplate(t, lit) : '<span class="n">' + (lit || '') + '</span><i class="ae-lamp ' + (lit ? 'is-lit ae-t-warn' : 'ae-t-off') + '"></i>';
      return '<section class="bay ae-plate"><div class="np"><span class="bar-l" style="background:' + esc(t.color) + '"></span><span class="clamp1">' + esc(t.name) + '</span>' + np + '</div>' + body + '</section>';
    }).join('');
    return '<div class="bays">' + html + '</div>';
  }

  var toastT = null;
  function toast(text) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 4200);
  }

  function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  /** Find: one item, one rule, one mandate. onPick(result). */
  function palette(M, onPick) {
    var el = document.createElement('div'); el.className = 'palette ae-plate'; el.innerHTML =
      '<div class="crumbs" style="margin-bottom:6px"><b>Find</b><span class="sep"></span><span>a mandate, a clause, an item, an act, an orphan</span><span style="margin-left:auto"><kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd></span></div>' +
      '<input type="text" placeholder="Type to find… e.g. M-004, merge, onboarding, review:00012" aria-label="Find"><div class="res"></div>';
    document.body.appendChild(el);
    var input = el.querySelector('input'), res = el.querySelector('.res'), list = [], sel = 0;
    // Grouped in the order the operator acts on them: cards first, then the rules behind them.
    var GROUPS = [['ask', 'Cards waiting for you', 'breach'], ['mandate', 'Mandates', 'mandate'], ['clause', 'Envelope rules', 'lock'], ['act', 'Acts in the log', 'layers'], ['orphan', 'Orphans', 'archive']];
    function mark(text, q) {
      var s = String(text), i = s.toLowerCase().indexOf(q.toLowerCase());
      return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
    }
    function draw() {
      var q = input.value.trim(), all = q.length < 2 ? [] : M.find(q), counts = {};
      all.forEach(function (r) { counts[r.kind] = (counts[r.kind] || 0) + 1; });
      list = [];
      GROUPS.forEach(function (g) { list = list.concat(all.filter(function (r) { return r.kind === g[0]; }).slice(0, g[0] === 'ask' ? 20 : 12)); });
      sel = Math.min(sel, Math.max(0, list.length - 1));
      var G = window.Parts.G, last = null;
      res.innerHTML = list.length ? list.map(function (r, i) {
        var kind = r.kind, title, side, g = GROUPS.filter(function (x) { return x[0] === kind; })[0], gh = '';
        if (kind !== last) { gh = '<div class="grp">' + g[1] + ' <span>' + counts[kind] + (counts[kind] > (kind === 'ask' ? 20 : 12) ? ', showing the first ' + (kind === 'ask' ? 20 : 12) : '') + '</span></div>'; last = kind; }
        if (kind === 'mandate') { title = r.m.id + ' · ' + r.m.intent; side = r.m.state + ' · ' + r.m.steward; }
        else if (kind === 'ask') { title = r.item.title; side = r.a.type + (r.a.sub ? ' · ' + r.a.sub : '') + (r.a.mandate ? ' · ' + r.a.mandate.id : ''); }
        else if (kind === 'clause') { title = r.m.id + ' envelope · ' + r.clause + ' = ' + (Array.isArray(r.m.envelope[r.clause]) ? r.m.envelope[r.clause].join(', ') : r.m.envelope[r.clause]); side = 'rule'; }
        else if (kind === 'act') { title = r.act.item.title; side = r.act.actor + ' · ' + r.act.verdict; }
        else { title = r.item.title; side = 'no mandate · ' + r.item.source.project; }
        return gh + '<div class="r' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><span class="g">' + G[g[2]] + '</span><span class="clamp1">' + mark(title, q) + '</span><span class="dim clamp1" style="max-width:280px">' + esc(side) + '</span></div>';
      }).join('') : (q.length < 2 ? '<div class="dim" style="padding:10px 10px 0">Type two letters or more, or start from one of these:</div>' : '<div class="dim" style="padding:10px 10px 0">Nothing matches "' + esc(q) + '". Try a mandate id, a clause, or a kind:</div>') +
        '<div class="hints">' + ['M-001', 'merge', 'spend', 'deletion', 'onboarding', 'incident'].map(function (h) { return '<button data-hint="' + h + '">' + h + '</button>'; }).join('') + '</div>';
      var s = res.querySelector('.r.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    res.addEventListener('click', function (e) { var h = e.target.closest('[data-hint]'); if (h) { input.value = h.dataset.hint; sel = 0; draw(); input.focus(); } });
    input.addEventListener('input', function () { sel = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && list[sel]) { close(); onPick(list[sel]); }
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
    });
    res.addEventListener('click', function (e) { var r = e.target.closest('.r'); if (r) { close(); onPick(list[+r.dataset.i]); } });
    function open() { el.classList.add('open'); input.value = ''; draw(); setTimeout(function () { input.focus(); }, 0); }
    function close() { el.classList.remove('open'); }
    return { open: open, close: close, isOpen: function () { return el.classList.contains('open'); } };
  }

  function help(title, rows) {
    var el = document.createElement('div'); el.className = 'help ae-plate';
    el.innerHTML = '<div class="crumbs"><b>' + esc(title) + '</b><span style="margin-left:auto"><kbd>?</kbd> closes</span></div><div class="k">' +
      rows.map(function (r) {
        if (r[0] === '#') return '<span class="engrave" style="grid-column:1 / 3;margin-top:8px">' + esc(r[1]) + '</span>';
        return '<span>' + r[0].split(' ').map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join(' ') + '</span><span>' + esc(r[1]) + '</span>';
      }).join('') + '</div>';
    document.body.appendChild(el);
    return { toggle: function () { el.classList.toggle('open'); }, close: function () { el.classList.remove('open'); }, isOpen: function () { return el.classList.contains('open'); } };
  }

  /** The day: advances simulated time; arrivals route through the model as they land. */
  function day(M, onTick, opts) {
    opts = opts || {};
    var stepMin = opts.stepMin || (M.which === 'scale' ? 12 : 20), timer = null;
    function tick() {
      if (M.simMs >= M.dayEndMs) { stop(); onTick({ ended: true, landed: [] }); return; }
      var landed = M.advance(M.simMs + stepMin * 60000);
      onTick({ landed: landed });
    }
    function start() { if (timer) return; timer = setInterval(tick, opts.everyMs || 700); onTick({ started: true, landed: [] }); }
    function stop() { clearInterval(timer); timer = null; onTick({ stopped: true, landed: [] }); }
    return { toggle: function () { timer ? stop() : start(); }, running: function () { return !!timer; }, stop: stop, step: tick };
  }

  function fleetSwitch() {
    var p = new URLSearchParams(location.search);
    p.set('fleet', p.get('fleet') === 'scale' ? 'today' : 'scale');
    location.search = p.toString();
  }

  /** Persona id -> number of open ask items it raised (the lamps after mandates). */
  function asksByPersona(M) {
    var c = {};
    M.openAsks().forEach(function (a) { a.items.forEach(function (it) { var k = it.source.personaId; c[k] = (c[k] || 0) + 1; }); });
    return c;
  }

  window.Chrome = { header: header, census: census, sessionsPlate: sessionsPlate, usagePlate: usagePlate, bays: bays, toast: toast, typing: typing, palette: palette, help: help, day: day, fleetSwitch: fleetSwitch, asksByPersona: asksByPersona, ICON: ICON, SVG: SVG };
})();
