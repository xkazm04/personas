/* Fleet Command Anywhere — companion client.
 *
 * Plain JS, no dependencies. Talks to the desktop's LAN companion API:
 *   GET  /api/state  — sessions × attention × Athena proposals (projection)
 *   POST /api/act    — approve | reject | reply | wake | kill (allowlisted)
 *
 * The device token arrives once in the URL fragment (#t=...) from the pairing
 * QR, is moved into localStorage, and is stripped from the address bar. It is
 * sent only as an Authorization header — never in a query string.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'personas-fleet-token';
  var POLL_MS = 5000;

  // ── token bootstrap ─────────────────────────────────────────────────
  (function adoptTokenFromFragment() {
    var m = /[#&]t=([0-9a-fA-F]+)/.exec(location.hash || '');
    if (m) {
      try { localStorage.setItem(TOKEN_KEY, m[1]); } catch (e) { /* private mode */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
  })();

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  // ── dom helpers ─────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h';
    return Math.round(h / 24) + 'd';
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var n = el('div', 'toast' + (isErr ? ' err' : ''), msg);
    document.body.appendChild(n);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.remove(); }, 3200);
  }

  // ── api ─────────────────────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { Authorization: 'Bearer ' + token() },
      opts.headers || {}
    );
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var e = new Error(body.message || body.code || ('HTTP ' + res.status));
          e.code = body.code;
          e.status = res.status;
          throw e;
        }
        return body;
      });
    });
  }

  function act(payload) {
    return api('/api/act', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── destructive two-tap confirm ─────────────────────────────────────
  // One action grammar: destructive verbs (kill) need an explicit second tap.
  function armButton(btn, armedLabel, fn) {
    var idleLabel = btn.textContent;
    var armed = false;
    var timer = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.classList.add('arm');
        btn.textContent = armedLabel;
        timer = setTimeout(function () {
          armed = false;
          btn.classList.remove('arm');
          btn.textContent = idleLabel;
        }, 3500);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.classList.remove('arm');
      btn.textContent = idleLabel;
      fn();
    });
  }

  function runAct(payload, okMsg) {
    return act(payload)
      .then(function (r) {
        toast(r.message || okMsg);
        refresh();
      })
      .catch(function (e) {
        toast(e.message || 'Failed', true);
        refresh();
      });
  }

  // ── rendering ───────────────────────────────────────────────────────
  var STATE_LABEL = {
    awaiting_input: 'Needs input',
    running: 'Working',
    spawning: 'Spawning',
    idle: 'Idle',
    stale: 'Stale',
    finished: 'Done',
    hibernated: 'Sleeping',
    exited: 'Exited',
  };

  function sessionDotClass(s) {
    if (s.attention === 'failed') return 'dot failed';
    return 'dot ' + s.state;
  }

  function renderNeeds(sessions) {
    var host = $('needs-list');
    host.textContent = '';
    var waiting = sessions.filter(function (s) { return s.attention === 'waiting' || s.attention === 'athena'; });
    $('needs-h').classList.toggle('hidden', waiting.length === 0);
    waiting.forEach(function (s) {
      var card = el('div', 'card ' + (s.attention === 'athena' ? 'attn-athena' : 'attn-waiting'));
      var head = el('div', 'card-head');
      head.appendChild(el('span', sessionDotClass(s)));
      head.appendChild(el('span', 'card-title', s.label));
      head.appendChild(el('span', 'card-ago', ago(s.lastActivityMs)));
      card.appendChild(head);
      if (s.attention === 'athena') {
        var b = el('span', 'badge', "Athena's on it");
        var sub = el('p', 'card-sub');
        sub.appendChild(b);
        card.appendChild(sub);
      }
      if (s.stateReason) card.appendChild(el('p', 'card-sub', s.stateReason));

      if (s.canReply) {
        var chips = el('div', 'actions');
        ['1', '2', 'Yes', 'Proceed'].forEach(function (c) {
          var btn = el('button', 'btn-chip', c);
          btn.addEventListener('click', function () {
            runAct({ action: 'reply', session_id: s.id, text: c }, 'Sent "' + c + '"');
          });
          chips.appendChild(btn);
        });
        card.appendChild(chips);

        var row = el('div', 'reply-row');
        var input = el('input');
        input.placeholder = 'Reply…';
        input.maxLength = 500;
        input.setAttribute('aria-label', 'Reply to ' + s.label);
        var send = el('button', null, 'Send');
        send.addEventListener('click', function () {
          var t = input.value.trim();
          if (!t) return;
          send.disabled = true;
          runAct({ action: 'reply', session_id: s.id, text: t }, 'Reply sent').then(function () {
            send.disabled = false;
            input.value = '';
          });
        });
        row.appendChild(input);
        row.appendChild(send);
        card.appendChild(row);
      }
      host.appendChild(card);
    });
  }

  function renderApprovals(approvals, sessionsById) {
    var host = $('approvals-list');
    host.textContent = '';
    $('approvals-h').classList.toggle('hidden', approvals.length === 0);
    approvals.forEach(function (a) {
      var card = el('div', 'card attn-athena');
      var head = el('div', 'card-head');
      var target = a.sessionId && sessionsById[a.sessionId];
      head.appendChild(el('span', 'badge', 'Athena proposes'));
      head.appendChild(el('span', 'card-title', target ? target.label : a.action));
      card.appendChild(head);
      if (a.rationale) card.appendChild(el('p', 'card-sub', a.rationale));
      if (a.text) card.appendChild(el('div', 'proposal-text', a.text));

      var actions = el('div', 'actions');
      var approve = el('button', 'btn-approve', 'Approve');
      approve.addEventListener('click', function () {
        approve.disabled = true;
        runAct({ action: 'approve', approval_id: a.id }, 'Approved');
      });
      var reject = el('button', null, 'Decline');
      reject.addEventListener('click', function () {
        reject.disabled = true;
        runAct({ action: 'reject', approval_id: a.id, reason: 'declined from phone' }, 'Declined');
      });
      actions.appendChild(approve);
      actions.appendChild(reject);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function renderSessions(sessions) {
    var host = $('sessions-list');
    host.textContent = '';
    $('no-sessions').classList.toggle('hidden', sessions.length !== 0);
    sessions.forEach(function (s) {
      var card = el('div', 'card');
      var head = el('div', 'card-head');
      head.appendChild(el('span', sessionDotClass(s)));
      head.appendChild(el('span', 'card-title', s.label));
      var lbl = STATE_LABEL[s.state] || s.state;
      if (s.dozing) lbl = 'Dozing';
      head.appendChild(el('span', 'card-ago', lbl + ' · ' + ago(s.lastActivityMs)));
      card.appendChild(head);

      var actions = null;
      function need() {
        if (!actions) { actions = el('div', 'actions'); card.appendChild(actions); }
        return actions;
      }
      if (s.canWake) {
        var wake = el('button', null, 'Wake');
        wake.addEventListener('click', function () {
          wake.disabled = true;
          runAct({ action: 'wake', session_id: s.id }, 'Waking…');
        });
        need().appendChild(wake);
      }
      if (s.canKill) {
        var kill = el('button', 'btn-danger', 'Kill');
        armButton(kill, 'Confirm kill', function () {
          runAct({ action: 'kill', session_id: s.id }, 'Killed');
        });
        need().appendChild(kill);
      }
      host.appendChild(card);
    });
  }

  function setConn(state) {
    var dot = $('conn-dot');
    dot.className = 'conn-dot' + (state === 'ok' ? ' ok' : state === 'bad' ? ' bad' : '');
    $('conn-label').textContent =
      state === 'ok' ? 'live' : state === 'bad' ? 'offline' : 'connecting';
  }

  function render(data) {
    var sessions = data.sessions || [];
    var approvals = data.approvals || [];
    var byId = {};
    sessions.forEach(function (s) { byId[s.id] = s; });

    var waiting = sessions.filter(function (s) { return s.attention === 'waiting' || s.attention === 'athena'; });
    $('all-clear').classList.toggle(
      'hidden',
      !(waiting.length === 0 && approvals.length === 0 && sessions.length > 0)
    );

    renderNeeds(sessions);
    renderApprovals(approvals, byId);
    renderSessions(sessions);
  }

  // ── poll loop ───────────────────────────────────────────────────────
  var pollTimer = null;

  function refresh() {
    if (!token()) {
      $('gate').classList.remove('hidden');
      $('inbox').classList.add('hidden');
      setConn('bad');
      return Promise.resolve();
    }
    $('gate').classList.add('hidden');
    $('inbox').classList.remove('hidden');
    return api('/api/state')
      .then(function (data) {
        setConn('ok');
        $('offline').classList.add('hidden');
        render(data);
      })
      .catch(function (e) {
        setConn('bad');
        if (e.status === 401) {
          // Revoked or stale token — back to the gate, honestly.
          try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* noop */ }
          $('gate').classList.remove('hidden');
          $('inbox').classList.add('hidden');
        } else {
          $('offline').classList.remove('hidden');
        }
      });
  }

  function loop() {
    refresh().then(function () {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(loop, POLL_MS);
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  // Service worker only works on secure origins; LAN http is fine without it.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/m/sw.js').catch(function () { /* optional */ });
  }

  loop();
})();
