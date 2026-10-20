// Page half of the cold-load probe. `installColdProbe` is NEVER called in
// node: its source is stringified and sent over the test-automation server's
// `/eval`, where it registers three methods on `window.__TEST__`
// (coldProbeVersion, coldProbeCapture/Restore, coldProbeMeasure). The bridge
// dispatcher (`__exec__` in src/test/automation/bridge.ts) looks methods up on
// `this` at call time, so a method added after load is reachable through
// `/bridge-exec` exactly like a built-in one - the same move
// src/test/automation/perfInstrument.ts makes for perfReset/perfSnapshot. That
// is why the probe works against an app built BEFORE it existed: no bridge.ts
// change is needed, and none is live in the running app anyway.
//
// Plain JS only (it runs unbundled in the webview). Every timestamp is
// performance.now() relative to t0 = the synchronous navigation call.

/* eslint-disable */
export function installColdProbe() {
  var T = window.__TEST__;
  if (!T) return;
  var VERSION = 'cold-load-probe/1';
  var STORES = {
    system: function () { return window.__SYSTEM_STORE__; },
    overview: function () { return window.__OVERVIEW_STORE__; },
    agent: function () { return window.__AGENT_STORE__; },
  };
  var CONTENT_CHARS = 40;
  var MEDIA_MIN = 48;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var nextFrame = function () {
    return new Promise(function (r) {
      var done = false;
      requestAnimationFrame(function (ts) { if (!done) { done = true; r({ ts: ts, raf: true }); } });
      // An occluded webview stops rAF; never hang the sampler on it.
      setTimeout(function () { if (!done) { done = true; r({ ts: performance.now(), raf: false }); } }, 120);
    });
  };

  var ipcMod = null;
  var ipcModError = null;
  function loadIpc() {
    if (ipcMod || ipcModError) return Promise.resolve();
    // Dev builds serve source modules by path; the app imports the same URL,
    // so this is the live ring buffer. A production build has no such path
    // and the depth metric is then reported unmeasurable.
    return import('/src/lib/ipcMetrics.ts').then(function (m) { ipcMod = m; }, function (e) { ipcModError = String((e && e.message) || e); });
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    } else if (el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }
  var CHROME_SEL = 'h1,h2,[role="tablist"],[data-testid^="content-header"]';
  var EXCLUDE_SEL = '[aria-hidden="true"],h1,h2,[role="tablist"],nav,[role="navigation"],[data-testid^="content-header"]';

  function classify(main, stale, oldMarkers) {
    var out = { chrome: false, content: false, ghost: false, oldVisible: false, chars: 0 };
    for (var i = 0; i < oldMarkers.length; i++) { if (visible(oldMarkers[i])) { out.oldVisible = true; break; } }
    var heads = main.querySelectorAll(CHROME_SEL);
    for (var h = 0; h < heads.length; h++) {
      var el = heads[h];
      if (stale.has(el) || el.closest('[aria-hidden="true"]')) continue;
      if (visible(el)) { out.chrome = true; break; }
    }
    var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    var seen = new Map();
    var node;
    while ((node = walker.nextNode())) {
      var t = node.textContent ? node.textContent.trim() : '';
      if (!t) continue;
      var p = node.parentElement;
      if (!p || stale.has(p)) continue;
      var ok = seen.get(p);
      if (ok === undefined) { ok = !p.closest(EXCLUDE_SEL) && visible(p); seen.set(p, ok); }
      if (!ok) continue;
      out.chars += t.length;
      if (out.chars >= CONTENT_CHARS) { out.content = true; break; }
    }
    if (!out.content) {
      var media = main.querySelectorAll('canvas,img,svg,video');
      for (var m = 0; m < media.length; m++) {
        var me = media[m];
        if (stale.has(me) || me.closest(EXCLUDE_SEL)) continue;
        var mr = me.getBoundingClientRect();
        if (mr.width >= MEDIA_MIN && mr.height >= MEDIA_MIN && visible(me)) { out.content = true; break; }
      }
    }
    var ghosts = main.querySelectorAll('[aria-hidden="true"]');
    for (var g = 0; g < ghosts.length; g++) {
      var ge = ghosts[g];
      if (stale.has(ge)) continue;
      var gr = ge.getBoundingClientRect();
      if (gr.width * gr.height >= 400 && visible(ge)) { out.ghost = true; break; }
    }
    return out;
  }

  function applySets(sets) {
    var applied = [];
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      var store = STORES[s.store] && STORES[s.store]();
      if (!store) { applied.push({ key: s.key, ok: false, why: 'store ' + s.store + ' not exposed' }); continue; }
      var setter = 'set' + s.key.charAt(0).toUpperCase() + s.key.slice(1);
      var st = store.getState();
      if (typeof st[setter] === 'function') st[setter](s.value);
      else { var patch = {}; patch[s.key] = s.value; store.setState(patch); }
      applied.push({ key: s.key, ok: store.getState()[s.key] === s.value, via: typeof st[setter] === 'function' ? setter : 'setState' });
    }
    return applied;
  }

  function ipcTotal() {
    if (ipcMod) return ipcMod.getIpcTotalCount();
    var P = window.__PERF__;
    return P ? P.snapshot().ipc.totalCount : null;
  }

  // One load: park elsewhere, put the target tab state in place while parked,
  // then navigate at t0 and watch frames until content and a settle.
  function measureOnce(spec, phase) {
    var main0 = document.getElementById('main-content');
    var notes = [];
    var park = T.navigate(spec.park);
    if (!park || !park.success) return Promise.resolve({ ok: false, phase: phase, reason: 'park refused: ' + (park && park.error) });
    return sleep(spec.parkMs).then(function () {
      var agent = STORES.agent();
      var personaId = null;
      if (spec.needsPersona) {
        var list = agent ? agent.getState().personas : [];
        personaId = list && list.length ? list[0].id : null;
        if (!personaId) return { ok: false, phase: phase, reason: 'needs a persona and the app has none' };
      } else if (spec.section === 'personas' && agent && agent.getState().selectedPersonaId) {
        agent.getState().selectPersona(null);
      }
      var applied = applySets(spec.sets);
      for (var a = 0; a < applied.length; a++) if (!applied[a].ok) notes.push('tab state did not stick: ' + JSON.stringify(applied[a]));
      return sleep(80).then(function () {
        var main = document.getElementById('main-content') || main0;
        if (!main) return { ok: false, phase: phase, reason: '#main-content not found' };
        var stale = new WeakSet();
        var all = main.querySelectorAll('*');
        var oldMarkers = [];
        for (var i = 0; i < all.length; i++) {
          stale.add(all[i]);
          if (oldMarkers.length < 40 && all[i].childElementCount === 0 && all[i].textContent && all[i].textContent.trim() && visible(all[i])) oldMarkers.push(all[i]);
        }
        var shifts = { cls: 0, count: 0 };
        var scripts = [];
        var lsObs = null, resObs = null, mutObs = null;
        var lastMutation = 0;
        var t0;
        try {
          lsObs = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) { if (!e.hadRecentInput && e.startTime >= t0) { shifts.cls += e.value; shifts.count++; } });
          });
          lsObs.observe({ type: 'layout-shift', buffered: false });
        } catch (e) { shifts = null; notes.push('layout-shift entry type unsupported'); }
        try {
          resObs = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) {
              if (e.startTime < t0) return;
              var n = e.name || '';
              if (/ipc\.localhost|^ipc:|__tauri/.test(n)) return;
              if (/\.(m?[jt]sx?|css|json)(\?|$)/.test(n) || /\/src\/|\/node_modules\/|\/assets\//.test(n)) scripts.push(n.replace(location.origin, ''));
            });
          });
          resObs.observe({ type: 'resource', buffered: false });
        } catch (e) { scripts = null; notes.push('resource timing observer unsupported'); }
        mutObs = new MutationObserver(function () { lastMutation = performance.now(); });
        mutObs.observe(main, { subtree: true, childList: true, characterData: true, attributes: false });

        var ipcBefore = ipcTotal();
        var t0Wall = Date.now();
        t0 = performance.now();
        var nav = T.navigate(spec.section);
        if (personaId) agent.getState().selectPersona(personaId);
        if (!nav || !nav.success) {
          lsObs && lsObs.disconnect(); resObs && resObs.disconnect(); mutObs.disconnect();
          return { ok: false, phase: phase, reason: 'navigate refused: ' + (nav && nav.error) };
        }
        var r = { ok: true, phase: phase, chromeMs: null, contentMs: null, ghostFirstMs: null, blankFrames: 0, blankFramesBeyondGrace: 0, blankMs: 0, frames: 0, rafFrames: 0 };
        var lastIpc = ipcBefore, lastIpcChange = t0, lastTs = t0;
        function loop() {
          return nextFrame().then(function (f) {
            var now = performance.now();
            var el = now - t0;
            r.frames++;
            if (f.raf) r.rafFrames++;
            if (r.contentMs == null) {
              var c = classify(main, stale, oldMarkers);
              if (c.chrome && r.chromeMs == null) r.chromeMs = el;
              if (c.ghost && r.ghostFirstMs == null) r.ghostFirstMs = el;
              if (c.content) r.contentMs = el;
              else if (!c.oldVisible && !c.ghost) {
                r.blankFrames++;
                r.blankMs += now - lastTs;
                if (el > spec.graceMs) r.blankFramesBeyondGrace++;
              }
            }
            lastTs = now;
            var ipcNow = ipcTotal();
            if (ipcNow !== lastIpc) { lastIpc = ipcNow; lastIpcChange = now; }
            var quiet = now - Math.max(lastIpcChange, lastMutation) >= spec.settleMs;
            if (r.contentMs != null && quiet) { r.settleReason = 'quiet'; return; }
            if (el >= spec.maxMs) { r.settleReason = 'cap'; return; }
            return loop();
          });
        }
        return loop().then(function () {
          var end = performance.now();
          r.settledMs = end - t0;
          r.avgFrameMs = r.frames ? r.settledMs / r.frames : null;
          r.throttled = r.rafFrames < r.frames * 0.8;
          if (r.throttled) notes.push('rAF ran in under 80% of samples (occluded or throttled webview): frame counts are a lower bound');
          if (r.chromeMs == null) notes.push('no new heading or tab strip appeared in #main-content');
          r.cls = shifts ? Math.round(shifts.cls * 10000) / 10000 : null;
          r.shiftCount = shifts ? shifts.count : null;
          r.scriptRequests = scripts ? scripts.length : null;
          r.scriptSample = scripts ? scripts.slice(0, 25) : null;
          var ipcAfter = ipcTotal();
          r.ipcCount = ipcBefore == null || ipcAfter == null ? null : ipcAfter - ipcBefore;
          r.ipcCalls = null;
          if (ipcMod) {
            var horizon = t0Wall + (r.contentMs != null ? r.contentMs : r.settledMs);
            r.ipcCalls = ipcMod.getIpcRecords()
              .map(function (x) { return { command: x.command, startMs: x.timestamp - x.durationMs - t0Wall, endMs: x.timestamp - t0Wall, ok: x.ok }; })
              .filter(function (x) { return x.startMs >= -5 && x.startMs + t0Wall <= horizon; });
          }
          lsObs && lsObs.disconnect(); resObs && resObs.disconnect(); mutObs.disconnect();
          r.notes = notes;
          r.domNodes = main.querySelectorAll('*').length;
          return r;
        });
      });
    });
  }

  T.coldProbeVersion = function coldProbeVersion() {
    return loadIpc().then(function () {
      return { success: true, version: VERSION, ipcMetrics: !!ipcMod, ipcMetricsError: ipcModError, perf: !!window.__PERF__, dev: !!ipcMod, mainContent: !!document.getElementById('main-content') };
    });
  };
  T.coldProbeCapture = function coldProbeCapture() {
    var sys = STORES.system().getState();
    var ov = STORES.overview && STORES.overview() ? STORES.overview().getState() : {};
    var ag = STORES.agent().getState();
    var keys = ['sidebarSection', 'homeTab', 'teamsTab', 'goalsView', 'templateTab', 'agentTab', 'editorTab', 'designSubTab', 'cloudTab', 'settingsTab', 'pluginTab', 'companionsPage', 'devToolsTab', 'eventBusTab'];
    var snap = { system: {}, overview: { overviewTab: ov.overviewTab }, selectedPersonaId: ag.selectedPersonaId || null };
    keys.forEach(function (k) { if (k in sys) snap.system[k] = sys[k]; });
    return { success: true, snapshot: snap };
  };
  T.coldProbeRestore = function coldProbeRestore(snapshot) {
    var sets = [];
    Object.keys(snapshot.system).forEach(function (k) { if (k !== 'sidebarSection') sets.push({ store: 'system', key: k, value: snapshot.system[k] }); });
    if (snapshot.overview && snapshot.overview.overviewTab) sets.push({ store: 'overview', key: 'overviewTab', value: snapshot.overview.overviewTab });
    var applied = applySets(sets);
    T.navigate(snapshot.system.sidebarSection);
    STORES.agent().getState().selectPersona(snapshot.selectedPersonaId);
    return { success: true, applied: applied.length };
  };
  T.coldProbeMeasure = function coldProbeMeasure(spec) {
    return loadIpc().then(function () { return measureOnce(spec, 'cold'); }).then(function (cold) {
      if (!cold.ok || spec.skipWarm) return { success: true, cold: cold, warm: null };
      return measureOnce(spec, 'warm').then(function (warm) { return { success: true, cold: cold, warm: warm }; });
    });
  };
}
