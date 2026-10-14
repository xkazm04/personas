/* The parts every inner surface is built from, so a second card reads faster than the first.
 * Ported from the app's own deck anatomy (data/source/decision-center/deck: CardHeader,
 * LedgerRail, DeckDock, ReasonPrompt, ReportReader, ScoreMeter, FactLine):
 *
 *   head      tile + eyebrow + lamp + age, the title (the ask), a context line, and the
 *             OUTCOME PAIR: "If you <yes>: ..." lit, "If you <no>: ..." quiet
 *   body      what the operator reads to decide (ask, diff, items, checklist, reader)
 *   rail      a sunk well, the same order everywhere: who asks, two hero tiles, the
 *             envelope meter, facts; and at its foot the DOCK
 *   dock      verdict pair (yes lit, no quieter) with the key inset ONCE in the button,
 *             then branches, then quiet links; an armed verdict says so in place; a
 *             reason prompt replaces the dock instead of opening another layer
 *
 * Pure string builders: no state lives here. */
(function () {
  'use strict';
  var esc = function (s) { return window.Mandates.esc(s); };

  var P = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var G = {
    breach: P + '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    stop: P + '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M10 15V9"/><path d="M14 15V9"/></svg>',
    send: P + '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    trash: P + '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    sign: P + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    claim: P + '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    talk: P + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    report: P + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    council: P + '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M4 7h16"/><path d="M4 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M20 7l-2.5 6a3 3 0 0 0 5 0z"/></svg>',
    mandate: P + '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    clock: P + '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    unblocks: P + '<path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>',
    layers: P + '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
    lock: P + '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    check: P + '<path d="M20 6 9 17l-5-5"/></svg>',
    x: P + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    pause: P + '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    play: P + '<path d="m6 3 14 9-14 9z"/></svg>',
    branch: P + '<path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>',
    undo: P + '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
    narrow: P + '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>',
    reply: P + '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    read: P + '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    go: P + '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    edit: P + '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    inbox: P + '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    wallet: P + '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
    merge: P + '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
    search: P + '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    archive: P + '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
    chev: P + '<path d="m9 18 6-6-6-6"/></svg>',
    widen: P + '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>',
    users: P + '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  };

  function kbd(k) { return '<kbd>' + esc(k) + '</kbd>'; }
  function lamp(tone, lit, extra) { return '<i class="ae-lamp ae-t-' + tone + (lit === false ? '' : ' is-lit') + (extra ? ' ' + extra : '') + '"></i>'; }

  /** The card's head. o: { tone, glyph, eyebrow:[...], age, title, context, yes:{verb,text}, no:{verb,text}, titleId } */
  function head(o) {
    var eb = (o.eyebrow || []).map(function (e, i) { return '<span class="' + (i === 0 ? 'ae-tone-text' : '') + '">' + e + '</span>'; }).join('<span class="dot" aria-hidden="true">·</span>');
    return '<header class="c-head ae-t-' + o.tone + '">' +
      '<span class="c-tile" aria-hidden="true">' + (G[o.glyph] || G.mandate) + '</span>' +
      '<div class="c-eyebrow typo-eyebrow">' + eb + lamp(o.tone, true, o.breathe ? 'breathe' : '') + (o.age ? '<span class="c-age typo-caption">' + esc(o.age) + '</span>' : '') + '</div>' +
      '<h2 class="c-title typo-heading-lg" id="' + (o.titleId || 'deck-title') + '">' + esc(o.title) + '</h2>' +
      (o.context ? '<div class="c-context typo-body">' + o.context + '</div>' : '') +
      (o.yes || o.no ? '<div class="c-outcomes">' + (o.yes ? outcome('yes', o.yes) : '') + (o.no ? outcome('no', o.no) : '') + '</div>' : '') +
      '</header>';
  }
  function outcome(side, x) {
    return '<p class="c-outcome is-' + side + (x.tone ? ' ae-t-' + x.tone : '') + '"><span class="v typo-label">If you ' + esc(x.verb) + '</span><span class="t typo-body">' + esc(x.text) + '</span></p>';
  }

  /** A section inside a card body: eyebrow title, optional aside, content. */
  function sec(title, aside, inner, cls) {
    return '<section class="c-sec' + (cls ? ' ' + cls : '') + '"><div class="c-sec-h"><span class="typo-eyebrow">' + title + '</span>' + (aside ? '<span class="c-sec-aside typo-caption">' + aside + '</span>' : '') + '</div>' + inner + '</section>';
  }

  /** The rail: { who:{initial,name,sub}, tiles:[{glyph,value,label}], meter:{label,used,cap,mark,tone}, facts:[[label,valueHtml]], extra, dock } */
  function rail(o) {
    var who = o.who ? '<div class="r-who"><span class="r-mono">' + esc(o.who.initial) + '</span><span class="r-whot"><span class="typo-heading">' + esc(o.who.name) + '</span><span class="typo-caption">' + o.who.sub + '</span></span></div>' : '';
    var tiles = o.tiles ? '<div class="r-tiles">' + o.tiles.map(function (t) {
      return '<div class="r-tile" title="' + esc(t.label) + '"><span class="g">' + G[t.glyph] + '</span><span class="v">' + t.value + '</span><span class="l typo-caption">' + esc(t.label) + '</span></div>';
    }).join('') + '</div>' : '';
    return '<aside class="c-rail" aria-label="Ledger">' +
      '<div class="r-scroll">' + who + tiles + (o.meter ? meter(o.meter) : '') + (o.facts && o.facts.length ? facts(o.facts) : '') + (o.extra || '') + '</div>' +
      '<div class="r-dock">' + (o.dock || '') + '</div></aside>';
  }

  /** Capsule meter, ten notches, an optional mark for "what the ask would make it". */
  function meter(m) {
    var pct = Math.min(100, Math.round(m.used / Math.max(0.01, m.cap) * 100));
    var tone = m.tone || (pct > 85 ? 'warn' : 'run');
    var mark = m.mark != null ? '<span class="mk" style="left:' + Math.min(100, Math.round(m.mark / Math.max(0.01, m.markOf || m.cap) * 100)) + '%"></span>' : '';
    return '<div class="r-meter ae-t-' + tone + '"><div class="r-meter-h"><span class="typo-eyebrow">' + esc(m.label) + '</span><span class="r-meter-v"><b class="typo-heading">' + m.usedText + '</b><span class="typo-caption"> / ' + m.capText + '</span></span></div>' +
      '<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="' + m.cap + '" aria-valuenow="' + m.used + '" aria-label="' + esc(m.label) + '"><span class="fill" style="width:' + pct + '%"></span>' + mark + '</div>' +
      (m.note ? '<div class="typo-caption r-meter-n">' + m.note + '</div>' : '') + '</div>';
  }

  /** Fact lines: label as small caps on the left, the value as the hero on the right. */
  function facts(rows) {
    return '<dl class="facts">' + rows.map(function (r) { return '<dt class="typo-eyebrow">' + esc(r[0]) + '</dt><dd class="typo-data">' + r[1] + '</dd>'; }).join('') + '</dl>';
  }

  /** A verdict: the yes is lit, the no is quieter; the key is printed ONCE, inside. */
  function verdict(o) {
    var cls = 'vbtn ' + (o.yes ? 'is-yes' : 'is-no') + ' ae-t-' + (o.tone || (o.yes ? 'ok' : 'off')) + (o.armed ? ' is-armed' : '') + (o.locked ? ' is-locked' : '');
    return '<button class="' + cls + '" data-act="' + o.act + '"' + (o.locked ? ' aria-disabled="true"' : '') + ' aria-label="' + esc(o.armed ? 'Confirm: ' + o.label : o.label) + '">' +
      '<span class="g">' + G[o.locked ? 'lock' : (o.glyph || (o.yes ? 'check' : 'x'))] + '</span>' +
      '<span class="l"><span class="typo-title">' + esc(o.armed ? (o.armedLabel || 'Press ' + o.k + ' again to confirm') : o.label) + '</span>' + (o.hint ? '<span class="typo-caption">' + esc(o.hint) + '</span>' : '') + '</span>' + kbd(o.k) + '</button>';
  }
  /** A branch: its own words, a hint, a key; quieter than a verdict. */
  function branch(o) {
    return '<button class="bbtn' + (o.danger ? ' is-danger' : '') + (o.armed ? ' is-armed' : '') + '" data-act="' + o.act + '">' +
      '<span class="g">' + G[o.glyph || 'branch'] + '</span><span class="l"><span class="typo-body">' + esc(o.armed ? 'Press ' + o.k + ' again to confirm' : o.label) + '</span>' + (o.hint ? '<span class="typo-caption">' + esc(o.hint) + '</span>' : '') + '</span>' + (o.k ? kbd(o.k) : '') + '</button>';
  }
  /** Quiet links: places to go and look. Never a verdict. */
  function links(list) {
    return '<div class="dlinks">' + list.map(function (l) { return '<button class="dlink" data-act="' + l.act + '">' + (l.k ? kbd(l.k) : '') + '<span>' + esc(l.label) + '</span></button>'; }).join('') + '</div>';
  }
  /** What an armed verdict will do, said before the second press. */
  function armedBox(title, lines, tone) {
    return '<div class="armedbox ae-t-' + (tone || 'err') + '" role="alert"><div class="ab-h"><span class="typo-eyebrow ae-tone-text">' + G.lock + esc(title) + '</span><span class="typo-caption">' + kbd('Esc') + ' disarms</span></div><ul>' + lines.map(function (l) { return '<li class="typo-body">' + l + '</li>'; }).join('') + '</ul></div>';
  }

  /** "Why?": one digit picks a reason, Enter skips when optional, Esc cancels. */
  function prompt(p) {
    var n = p.text ? p.text.trim().length : 0, short = p.min && n < p.min;
    return '<div class="rprompt" data-prompt>' +
      '<div class="typo-heading">' + esc(p.title) + '</div>' +
      (p.options || []).map(function (o, i) { return '<button class="ropt" data-opt="' + i + '"><span class="typo-body">' + esc(o) + '</span>' + kbd(String(i + 1)) + '</button>'; }).join('') +
      '<textarea id="prompt" rows="2" class="typo-body" placeholder="' + esc(p.ph || 'Or write your own') + '" aria-label="' + esc(p.title) + '">' + esc(p.text || '') + '</textarea>' +
      (p.min ? '<div class="typo-caption rcount ' + (short ? 'is-short' : 'is-ok') + '" id="prompt-count">' + (short ? 'A reason is required: ' + (p.min - n) + ' more character' + (p.min - n === 1 ? '' : 's') : 'Ready: Enter sends') + '</div>' : '') +
      '<div class="rkeys typo-caption">' + ((p.options || []).length ? '<span>' + kbd('1') + '–' + kbd(String(p.options.length)) + ' pick</span>' : '') + '<span>' + kbd('Tab') + ' write</span>' + (p.min ? '' : '<span>' + kbd('Enter') + ' ' + esc(p.skip || 'skip the reason') + '</span>') + '<span class="r">' + kbd('Esc') + ' cancel</span></div></div>';
  }

  /** Items behind a card: lamp or checkbox, title, one meta line, an evidence strip. */
  function itemRows(items, o) {
    o = o || {};
    var cap = o.cap || 40;
    return '<div class="irows" role="listbox" aria-label="' + esc(o.label || 'Items') + '">' + items.slice(0, cap).map(function (it, i) {
      var ev = null; try { ev = it.evidence ? JSON.parse(it.evidence) : null; } catch (e) { ev = null; }
      var idx = (o.base || 0) + i, on = idx === o.foc;
      var lead = o.picks ? '<span class="pick' + (o.picks[i] ? ' on' : '') + '" data-pick aria-hidden="true">' + G.check + '</span>' : lamp(o.tone || 'warn', on);
      var strip = ev ? '<span class="ev"><span>' + ev.files + (ev.files === 1 ? ' file' : ' files') + '</span><span>' + ev.linesChanged + (ev.linesChanged === 1 ? ' line' : ' lines') + '</span><span class="' + (ev.gates === 'green' ? 'ok' : 'bad') + '">gates ' + esc(ev.gates) + '</span></span>' : '';
      var preview = o.preview ? '<span class="pv typo-caption">' + esc(firstLine(it.body)) + '</span>' : '';
      return '<div class="irow' + (on ? ' is-foc' : '') + (o.picks && !o.picks[i] ? ' is-off' : '') + '" data-item="' + idx + '" role="option" aria-selected="' + on + '">' + lead +
        '<span class="m"><span class="t typo-title">' + esc(it.title) + '</span>' + preview +
        '<span class="s typo-caption">' + esc(it.source.persona) + ' · ' + esc(it.source.project) + ' · ' + esc(it.kind) + (it.severity && it.severity !== 'info' ? ' · ' + esc(it.severity) : '') + ' · ' + esc(o.ago(it)) + strip + (it.irreversible ? '<span class="irr">' + esc(IRR[it.irreversible]) + '</span>' : '') + '</span></span>' +
        '<button class="rd" data-read title="Read it">' + (on ? kbd('E') : '') + '<span>read</span></button></div>';
    }).join('') + (items.length > cap ? '<div class="irows-more typo-caption">+' + (items.length - cap) + ' more in this card, same order</div>' : '') + '</div>';
  }
  var IRR = { merge: 'merges', spend: 'spends', 'outbound-message': 'sends outside', deletion: 'deletes' };
  function firstLine(s) { var l = String(s || '').split('\n').filter(function (x) { return x.trim() && !/^## /.test(x); }); return (l[1] || l[0] || '').replace(/^- /, ''); }

  /** One act: the same row in the claim audit, the mandate page and the ledger. */
  function actRows(list, o) {
    o = o || {};
    if (!list.length) return '<div class="empty-line typo-body">' + (o.empty || 'No steward acts yet. Nothing has been decided in this envelope.') + '</div>';
    return '<div class="arows" role="listbox" aria-label="Acts">' + list.map(function (a, i) {
      var on = i === o.foc, tone = a.reverted ? 'off' : a.actor === 'You' ? 'info' : /merged|spent|deleted|sent/.test(a.verdict) ? 'warn' : 'run';
      var state = a.reverted ? '<span class="st is-rev">reverted</span>' : a.reversible ? '<span class="st">' + (on ? kbd('V') + ' ' : '') + 'revertible</span>' : '<span class="st is-final">final</span>';
      return '<div class="arow' + (on ? ' is-foc' : '') + (a.reverted ? ' is-rev' : '') + '" data-actrow="' + i + '" role="option" aria-selected="' + on + '">' +
        '<span class="w typo-caption num">' + esc(o.ago(a)) + '</span>' + lamp(tone, !a.reverted) +
        '<span class="m"><span class="t typo-title">' + esc(a.item.title) + '</span><span class="s typo-caption"><b class="ae-t-' + tone + ' ae-tone-text">' + esc(a.verdict) + '</b> · ' + esc(a.actor) + ' · ' + esc(a.item.kind) + ' from ' + esc(a.item.source.persona) + (o.showMandate ? ' · <span class="mid">' + a.mandate.id + '</span>' : '') + '</span>' +
        (on ? '<span class="why typo-caption">Allowed because ' + esc(o.why(a)) + ' · envelope v' + a.version + '</span>' : '') + '</span>' + state + '</div>';
    }).join('') + '</div>';
  }

  /** Before → after, for any change to an envelope. */
  function diff(rows, empty) {
    if (!rows.length) return '<div class="diff is-empty typo-caption">' + (empty || 'No change yet. Edit a field and the diff appears here.') + '</div>';
    return '<div class="diff">' + rows.map(function (r) {
      if (r.add) return '<div class="d add"><span class="typo-eyebrow">' + esc(r.label) + '</span><span class="typo-body">+ ' + esc(r.add) + '</span></div>';
      if (r.del) return '<div class="d del"><span class="typo-eyebrow">' + esc(r.label) + '</span><span class="typo-body">− ' + esc(r.del) + '</span></div>';
      return '<div class="d"><span class="typo-eyebrow">' + esc(r.label) + '</span><span class="typo-body"><s>' + esc(r.from) + '</s> ' + G.go + ' <b>' + esc(r.to) + '</b></span></div>';
    }).join('') + '</div>';
  }

  /** A checklist row: lamp, criterion, status word. */
  function checks(rows) {
    return '<div class="checks">' + rows.map(function (r) {
      return '<div class="ck ae-t-' + r.tone + '">' + lamp(r.tone, r.tone !== 'off') + '<span class="m"><span class="typo-title">' + esc(r.label) + '</span><span class="typo-caption">' + r.detail + '</span></span><span class="w typo-label ae-tone-text">' + esc(r.word) + '</span></div>';
    }).join('') + '</div>';
  }

  function stamp(label, tone, glyph) {
    return '<div class="stamp ae-t-' + tone + '" aria-hidden="true"><span>' + G[glyph || 'check'] + esc(label) + '</span></div>';
  }

  function emptyCard(title, sub, extra) {
    return '<div class="c-empty"><span class="c-tile" aria-hidden="true">' + G.inbox + '</span><div class="typo-heading-lg">' + esc(title) + '</div><div class="typo-body muted">' + sub + '</div>' + (extra || '') + '</div>';
  }

  /** A long body section as ONE counted line that expands in place. The state lives on .card-body[data-unfold]. */
  function fold(o) {
    return '<section class="c-fold' + (o.cls ? ' ' + o.cls : '') + '"><button class="c-fold-h" data-fold aria-label="' + esc(o.title) + ': expand or collapse">' +
      '<span class="chev">' + G.chev + '</span><span class="sum"><span class="typo-eyebrow">' + o.title + '</span><span class="typo-body">' + o.summary + '</span></span>' +
      '<span class="typo-caption fk"><span class="on-closed">' + kbd(o.k || 'I') + ' expand</span><span class="on-open">' + kbd(o.k || 'I') + ' collapse</span></span></button>' +
      '<div class="c-fold-b">' + (o.aside ? '<div class="typo-caption c-fold-aside">' + o.aside + '</div>' : '') + o.inner + '</div></section>';
  }

  /** One scope the steward holds, or does not hold yet. r: row from M.scopeRows; foc: selected. */
  function scopeRows(rows, o) {
    o = o || {};
    var idx = 0;
    function line(r, held) {
      var on = idx === o.foc, i = idx++;
      var ev = held
        ? '<span class="num">' + r.acts + '</span> acts' + (r.agree != null ? ' · <span class="design" title="Placeholder: agentWouldHave is invented in the dataset">' + r.agree + '% agree</span>' : '')
        : (r.absorb ? 'would have absorbed <b class="num">' + r.absorb + '</b> of the ' + rows.reached + ' that reached you' : 'nothing it would have absorbed yet') + (r.agree != null ? ' · <span class="design" title="Placeholder: agentWouldHave is invented in the dataset">' + r.agree + '% agree</span>' : '');
      var key = held ? (on ? kbd('N') + ' narrow' : '') : (on ? kbd('W') + ' widen' : '');
      return '<div class="srow' + (on ? ' is-foc' : '') + (held ? '' : ' is-cand') + '" data-srow="' + i + '" role="option" aria-selected="' + on + '">' + lamp(held ? 'run' : 'off', held) +
        '<span class="m"><span class="t typo-title">' + esc(r.label) + (r.sensitive ? ' <span class="irr">' + (r.s === 'merge.land' ? 'irreversible once downstream builds on it' : r.s === 'spend.over' ? 'not refundable' : 'cannot be undone') + '</span>' : '') + '</span><span class="s typo-caption">' + ev + '</span></span><span class="st">' + key + '</span></div>';
    }
    return '<div class="srows" role="listbox" aria-label="Scopes">' +
      '<div class="c-sec-h"><span class="typo-eyebrow">The steward decides alone · ' + rows.held.length + '</span><span class="c-sec-aside typo-caption">acts it took, agreement with you (design)</span></div>' +
      (rows.held.length ? rows.held.map(function (r) { return line(r, true); }).join('') : '<div class="empty-line typo-body">It holds no scope: everything reaches you.</div>') +
      '<div class="c-sec-h" style="margin-top:14px"><span class="typo-eyebrow">Not held yet · ' + rows.cand.length + '</span><span class="c-sec-aside typo-caption">what each would have taken off you</span></div>' +
      rows.cand.map(function (r) { return line(r, false); }).join('') + '</div>';
  }

  window.Parts = { fold: fold, scopeRows: scopeRows, G: G, kbd: kbd, lamp: lamp, head: head, sec: sec, rail: rail, meter: meter, facts: facts, verdict: verdict, branch: branch, links: links, armedBox: armedBox, prompt: prompt, itemRows: itemRows, actRows: actRows, diff: diff, checks: checks, stamp: stamp, emptyCard: emptyCard, firstLine: firstLine, IRR: IRR };
})();
