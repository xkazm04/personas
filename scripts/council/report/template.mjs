// The council report page: the verdict first, then the members, then the
// Director's report.md. Pure string building over the model from model.mjs;
// every value that came from a run file passes through `esc` or `richText`.
import { CSS } from './style.mjs';
import { CLIENT_JS } from './client.mjs';
import { esc, richText, renderReportMarkdown } from './markdown.mjs';
import { sevKey } from './model.mjs';

const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const f2 = (n) => (typeof n === 'number' ? n.toFixed(2) : '–');
/** The overall as stored (up to 4 places), never fewer than 2: 0.4 reads 0.40, 0.5083 stays. */
const fExact = (n) => {
  if (typeof n !== 'number') return '–';
  const s = String(Number(n.toFixed(4)));
  return (s.split('.')[1] ?? '').length >= 2 ? s : n.toFixed(2);
};
const pct = (n) => `${Math.max(0, Math.min(100, n * 100)).toFixed(2)}%`;
const shortSha = (s) => (s ? String(s).slice(0, 9) : '–');

const OUTCOME_MEANING = {
  ready: 'The evidence is clean enough to put in front of a person. It is not an approval.',
  fail: 'A binding floor or a hard failure stopped this round. Nothing is admitted.',
  incomplete: 'Too little of the rubric was measured for the round to stand as a verdict.',
  stalled: 'Three rounds did not converge. That is a reason for a person to look, not to try again.',
};

const SEV_LABEL = { high: 'High', med: 'Medium', low: 'Low', other: 'Note' };

function trustCopy(m) {
  if (m.trust === 'uncalibrated')
    return {
      tone: 'warn',
      head: 'The judges are uncalibrated',
      body: 'A judged floor is advisory and the overall only orders the queue. A mechanical floor binds regardless.',
    };
  if (m.trust === 'trusted' || m.trust === 'calibrated')
    return { tone: 'ok', head: 'The judges are calibrated', body: 'Every floor binds, judged and mechanical.' };
  return { tone: 'warn', head: `Trust state: ${m.trust}`, body: 'Read the overall as an ordering, not a measurement.' };
}

/* ------------------------------------------------------------------ figures */

function coverageRing(m) {
  const C = 2 * Math.PI * 46;
  const total = m.totalWeight || 1;
  let offset = 0;
  const segs = m.members
    .filter((x) => typeof x.weight === 'number')
    .map((x) => {
      const len = (x.weight / total) * C;
      const gap = Math.min(3, len / 3);
      const cls = x.measured ? 'seg on' : 'seg off';
      const s = `<circle class="${cls}" r="46" cx="60" cy="60" stroke-dasharray="${(len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(x.name)} ${x.measured ? 'measured' : 'unmeasured'} (weight ${f2(x.weight)})</title></circle>`;
      offset += len;
      return s;
    })
    .join('');
  const floor = m.rubric.coverageFloor;
  let tick = '';
  if (typeof floor === 'number') {
    const a = floor * 2 * Math.PI - Math.PI / 2;
    const [x1, y1, x2, y2] = [60 + 36 * Math.cos(a), 60 + 36 * Math.sin(a), 60 + 57 * Math.cos(a), 60 + 57 * Math.sin(a)];
    tick = `<line class="ring-floor" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  const cov = m.coverage == null ? '–' : `${Math.round(m.coverage * 100)}%`;
  return `<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="Coverage ${esc(cov)} of the rubric's weight measured">
    <circle class="ring-bg" r="46" cx="60" cy="60"/>${segs}${tick}
    <text x="60" y="60" text-anchor="middle" class="ring-n">${esc(cov)}</text>
    <text x="60" y="77" text-anchor="middle" class="ring-l">coverage</text>
  </svg>`;
}

function track(m, x, { big = false } = {}) {
  const thr = m.rubric.threshold;
  const parts = [];
  if (x.measured) {
    const tone = x.floorHit ? (x.advisory ? 'adv-hit' : 'hit') : 'ok';
    parts.push(`<span class="fill ${tone}" style="width:${pct(x.score)}"></span>`);
  } else {
    parts.push(`<span class="unm">${x.notApplicable ? 'not applicable' : 'unmeasured'}</span>`);
  }
  if (typeof x.floor === 'number') {
    const binding = x.kind === 'mechanical' || (m.trust !== 'uncalibrated' && m.trust !== 'unknown');
    parts.push(
      `<span class="floor ${binding ? 'binding' : 'advisory'}" style="left:${pct(x.floor)}"><b>floor</b></span>`,
    );
  }
  if (typeof thr === 'number') parts.push(`<span class="thr" style="left:${pct(thr)}">${big ? '<b>bar</b>' : ''}</span>`);
  return `<span class="track${x.measured ? '' : ' empty'}${big ? ' big' : ''}">${parts.join('')}</span>`;
}

function sevChips(sev) {
  return ['high', 'med', 'low']
    .map((k) => `<span class="sv sv-${k}${sev[k] ? '' : ' zero'}" aria-label="${sev[k]} ${SEV_LABEL[k].toLowerCase()}">${sev[k]}</span>`)
    .join('');
}

function deltaChip(d) {
  if (typeof d !== 'number') return '';
  const s = d > 0 ? `+${d.toFixed(2)}` : d < 0 ? `−${Math.abs(d).toFixed(2)}` : '±0.00';
  return `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${s}</span>`;
}

function scoreboard(m) {
  const thr = m.rubric.threshold;
  const rows = m.members
    .map(
      (x) => `<a class="sb-row${x.measured ? '' : ' is-unm'}" href="#m-${esc(x.name)}">
      <span class="sb-name"><b>${esc(cap(x.name))}</b><small>${esc(x.kind)}${x.weight != null ? ` · ${f2(x.weight)}` : ''}</small></span>
      ${track(m, x)}
      <span class="sb-score">${x.measured ? f2(x.score) : '–'}${x.confidence ? `<small class="conf c-${esc(x.confidence)}">${esc(x.confidence)}</small>` : ''}${deltaChip(x.delta)}</span>
      <span class="sb-sev">${x.findings.length ? sevChips(x.sev) : '<span class="none">no findings</span>'}</span>
    </a>`,
    )
    .join('');
  const overall = {
    measured: m.overall != null,
    score: m.overall,
    floor: null,
    kind: 'overall',
    floorHit: false,
  };
  const scale = [0, 0.25, 0.5, 0.75, 1]
    .filter((t) => typeof thr !== 'number' || Math.abs(t - thr) > 0.06)
    .map((t) => `<span style="left:${pct(t)}">${t === 0 ? '0' : t === 1 ? '1' : t.toFixed(2).replace(/^0/, '')}</span>`)
    .join('');
  return `<figure class="scoreboard" aria-labelledby="sb-cap">
    <div class="sb-head"><span>Member</span><span class="sb-scale">${scale}${typeof thr === 'number' ? `<em style="left:${pct(thr)}">bar ${f2(thr)}</em>` : ''}</span><span>Score</span><span class="sb-sevh"><b class="h-high">high</b><b class="h-med">med</b><b class="h-low">low</b></span></div>
    ${rows}
    <div class="sb-row sb-overall">
      <span class="sb-name"><b>Overall</b><small>weighted, on ${m.coverage == null ? '–' : Math.round(m.coverage * 100) + '%'} coverage</small></span>
      ${track(m, overall)}
      <span class="sb-score">${fExact(m.overall)}</span>
      <span class="sb-sev"><span class="none">${m.must.length} must-address</span></span>
    </div>
    <figcaption id="sb-cap"><span class="lg lg-thr"></span>the rubric's bar${typeof thr === 'number' ? ` ${f2(thr)}` : ''} <span class="lg lg-bind"></span>a floor that binds <span class="lg lg-adv"></span>an advisory floor <span class="lg lg-unm"></span>not measured: it lowers coverage and is not a zero</figcaption>
  </figure>`;
}

/* ------------------------------------------------------------------ sections */

function hero(m) {
  const t = trustCopy(m);
  const outcome = esc(m.outcome);
  const roundTxt = m.round != null ? `Round ${m.round}${m.mode === 'full' ? ' of 3' : ''}` : 'Round –';
  const thr = m.rubric.threshold;
  let overallNote = 'No overall was produced.';
  if (m.overall != null && typeof thr === 'number') {
    const gap = m.overall - thr;
    overallNote = `${Math.abs(gap).toFixed(2)} ${gap < 0 ? 'below' : 'above'} the rubric's bar of ${f2(thr)}.`;
    const floor = m.rubric.coverageFloor;
    if (typeof floor === 'number' && m.coverage != null && m.coverage < floor)
      overallNote += ` Coverage ${Math.round(m.coverage * 100)}% is under the ${Math.round(floor * 100)}% floor, so the number does not stand.`;
    else if (m.trust === 'uncalibrated') overallNote += ' While the judges are uncalibrated it only orders the queue.';
  }
  const work = m.must.filter((x) => x.kind === 'work' || x.kind === 'floor' || x.kind === 'hard').length;
  const limits = m.must.length - work;
  const lite = m.mode === 'lite' ? '<p class="lite-note">Lite pass: one session over value, craft and robustness. It is not the council.</p>' : '';
  return `<section id="verdict" class="hero" aria-labelledby="verdict-h" data-nav="The verdict">
  <div class="hero-in">
    <p class="eyebrow">Council report · ${esc(m.mode === 'lite' ? 'lite pass' : 'full council')} · ${esc(roundTxt)}</p>
    <h1 id="verdict-h">${esc(m.subject.title || m.subject.slug || m.runId)}</h1>
    <p class="slugline"><code class="code">${esc(m.subject.slug ?? '')}</code>${m.subject.kind ? ` <span>${esc(String(m.subject.kind).replace(/_/g, ' '))}</span>` : ''}</p>
    ${m.subject.summary ? `<p class="sub">${esc(m.subject.summary)}</p>` : ''}
    <div class="tiles">
      <div class="tile outcome o-${outcome}">
        <span class="k-l">Outcome</span>
        <span class="o-word${String(m.outcome).length > 7 ? ' long' : ''}">${esc(cap(m.outcome))}</span>
        <span class="o-mean">${esc(OUTCOME_MEANING[m.outcome] ?? 'An outcome this renderer does not know; read result.json.')}</span>
        ${lite}
      </div>
      <div class="tile">
        <span class="k-l">Overall</span>
        <span class="k-n">${fExact(m.overall)}</span>
        <span class="gauge">${m.overall != null ? `<i style="width:${pct(m.overall)}"></i>` : ''}${typeof thr === 'number' ? `<b style="left:${pct(thr)}"><em>${f2(thr)}</em></b>` : ''}</span>
        <span class="k-c">${esc(overallNote)}</span>
      </div>
      <div class="tile tile-ring">
        <span class="k-l">Coverage</span>
        <div class="ring-row">${coverageRing(m)}<ul class="ring-key">${m.members
          .map((x) => `<li class="${x.measured ? 'on' : 'off'}"><i></i>${esc(x.name)}</li>`)
          .join('')}</ul></div>
        <span class="k-c">Share of the rubric's weight that was measured${typeof m.rubric.coverageFloor === 'number' ? `; the amber tick is the ${Math.round(m.rubric.coverageFloor * 100)}% floor` : ''}.</span>
      </div>
      <a class="tile tile-must" href="#must">
        <span class="k-l">Must address</span>
        <span class="k-n">${m.must.length}</span>
        <span class="k-c">${work} ${work === 1 ? 'is' : 'are'} work${limits ? `; ${limits} ${limits === 1 ? 'is a limit' : 'are limits'} of the measurement` : ''}.</span>
      </a>
    </div>
    ${scoreboard(m)}
    <div class="trust tr-${t.tone}" role="note">
      <span class="tr-i" aria-hidden="true">${t.tone === 'ok' ? '✓' : '!'}</span>
      <span><b>${esc(t.head)}.</b> ${esc(t.body)}${m.trustSource ? ` <small>${esc(m.trustSource)}</small>` : ''}</span>
    </div>
    <dl class="ident" aria-label="Which version this report is about">
      <div><dt>Run</dt><dd><code>${esc(m.runId)}</code></dd></div>
      <div><dt>Round</dt><dd>${esc(roundTxt)}${m.supersedes ? ` <small>after <code>${esc(m.supersedes)}</code></small>` : ''}</dd></div>
      <div><dt>Head</dt><dd><code title="${esc(m.head ?? '')}">${esc(shortSha(m.head))}</code></dd></div>
      <div><dt>Span</dt><dd>${m.spanCount} paths${m.spanDigest ? ` · <code>${esc(m.spanDigest.slice(0, 8))}…</code>` : ''}</dd></div>
      <div><dt>Drift</dt><dd>${esc(m.drift ?? '–')}</dd></div>
      <div><dt>Rubric</dt><dd><code>${esc(m.rubric.version)}</code></dd></div>
      <div><dt>Started</dt><dd>${esc(m.startedAt ? m.startedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '–')}</dd></div>
    </dl>
    <p class="no-decision">This page carries no decision. Approve or reject in Personas, where the decision is bound to run <code>${esc(m.runId)}</code> at <code>${esc(shortSha(m.head))}</code>.</p>
  </div>
</section>`;
}

function hardFailures(m) {
  if (!m.hardFailures.length) return '';
  const items = m.hardFailures
    .map((h) => {
      const text = typeof h === 'string' ? h : (h.title ?? h.reason ?? h.detail ?? JSON.stringify(h));
      return `<li>${richText(text)}</li>`;
    })
    .join('');
  return `<div class="callout bad"><h3>Hard failures (${m.hardFailures.length})</h3><ul>${items}</ul></div>`;
}

const MUST_KIND = {
  work: { label: 'Work', cls: 'k-work' },
  floor: { label: 'Floor breach', cls: 'k-floor' },
  hard: { label: 'Hard failure', cls: 'k-floor' },
  unmeasured: { label: 'Limit of the measurement, not implementer work', cls: 'k-unm' },
};

function mustSection(m) {
  const items = m.must.length
    ? m.must
        .map((x, i) => {
          const k = MUST_KIND[x.kind] ?? MUST_KIND.work;
          const src = x.source
            ? `<a class="fid" href="#f-${esc(x.source.finding.id)}">${esc(x.source.finding.id)}</a><span class="sev-tag s-${sevKey(x.source.finding.severity)}">${esc(x.source.finding.severity)}</span>${x.source.finding.recurrence > 1 ? `<span class="rec">recurrence ${x.source.finding.recurrence}</span>` : ''}`
            : '';
          return `<li class="must ${k.cls}">
          <span class="must-n">${i + 1}</span>
          <div class="must-body">
            <div class="must-meta">${x.member ? `<a class="mtag" href="#m-${esc(x.member)}">${esc(x.member)}</a>` : ''}<span class="mkind">${esc(k.label)}</span>${src}</div>
            <p class="must-claim">${richText(x.text, { inline: true })}</p>
            ${x.kind === 'floor' && Number.isFinite(x.score) && Number.isFinite(x.floor) ? `<div class="must-fig">${track(m, { measured: true, score: x.score, floor: x.floor, kind: 'mechanical', floorHit: true, advisory: false }, { big: true })}<span>${f2(x.score)} against a binding floor of ${f2(x.floor)}</span></div>` : ''}
          </div>
        </li>`;
        })
        .join('')
    : '<li class="must k-none"><div class="must-body"><p class="must-claim">Nothing. The members named no line that must be addressed.</p></div></li>';
  return `<section id="must" aria-labelledby="must-h" data-nav="Must address">
  <p class="eyebrow">Must address · verbatim from result.json</p>
  <h2 id="must-h">What the council says must change</h2>
  ${hardFailures(m)}
  <ol class="musts">${items}</ol>
</section>`;
}

function roundsSection(m) {
  if (m.chain.length < 2) return '';
  const cards = m.chain
    .map((r) => {
      const bars = (r.dims ?? [])
        .map(
          (d) =>
            `<i class="${d.score == null ? 'u' : ''}" style="height:${d.score == null ? 100 : Math.max(4, d.score * 100)}%"><span class="vh">${esc(d.name)} ${d.score == null ? 'unmeasured' : f2(d.score)}</span></i>`,
        )
        .join('');
      const label = r.current ? '<span class="you">You are reading this round</span>' : r.missing ? '<span class="you">Not found beside this run</span>' : `<a href="../${encodeURIComponent(r.runId)}/report.html">Open its report</a>`;
      return `<li class="rnd${r.current ? ' cur' : ''}">
        <span class="r-no">Round ${r.round ?? '?'}</span>
        <span class="r-out o-${esc(r.outcome ?? 'unknown')}">${esc(r.outcome ?? 'unknown')}</span>
        <span class="r-n">${fExact(r.overall)}</span>
        <span class="r-c">coverage ${r.coverage == null ? '–' : Math.round(r.coverage * 100) + '%'} · <code>${esc(shortSha(r.head))}</code></span>
        <span class="r-bars" aria-hidden="true">${bars}</span>
        ${label}
      </li>`;
    })
    .join('');
  const names = (m.chain.find((r) => r.dims?.length)?.dims ?? []).map((d) => esc(d.name)).join(' · ');
  return `<section id="rounds" aria-labelledby="rounds-h" data-nav="Rounds">
  <p class="eyebrow">Rounds · ${m.chain.length} in this chain</p>
  <h2 id="rounds-h">How the rounds moved</h2>
  <ol class="rounds">${cards}</ol>
  <p class="figcap">Each card is one round of this subject in this mode, oldest first. The small bars are the members in rubric order (${names}); a hollow bar was not measured.</p>
</section>`;
}

const PROOF = ['claimed', 'simulated', 'replayed', 'observed'];

function scenariosSection(m) {
  if (!m.scenarios.length) return '';
  const rows = m.scenarios
    .map((s) => {
      const lvl = PROOF.indexOf(s.proof);
      const ladder = PROOF.map((p, i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
      return `<tr>
        <td><b>${esc(s.title ?? s.slug)}</b><br><code class="code">${esc(s.slug)}</code></td>
        <td><span class="pill p-${esc(s.state)}">${esc(s.state)}</span></td>
        <td class="t-num">${s.score == null ? '–' : f2(s.score)}${s.n != null ? `<small> n=${esc(s.n)}</small>` : ''}</td>
        <td><span class="ladder" aria-label="proof: ${esc(s.proof)}">${ladder}</span> <small>${esc(s.proof ?? '–')}</small></td>
        <td class="sc-sum">${richText(s.summary ?? '')}</td>
      </tr>`;
    })
    .join('');
  const env = m.envelope
    ? Object.entries(m.envelope)
        .map(([k, v]) => `<span class="env"><b>${Array.isArray(v) ? v.length : 0}</b> ${esc(k.replace(/_/g, ' '))}</span>`)
        .join('')
    : '';
  return `<section id="scenarios" aria-labelledby="sc-h" data-nav="Scenarios">
  <p class="eyebrow">The envelope · ${m.scenarios.length} branches</p>
  <h2 id="sc-h">Scenarios</h2>
  ${env ? `<div class="envelope">${env}</div>` : ''}
  <div class="table-wrap"><table class="grid scen"><thead><tr><th>Branch</th><th>State</th><th>Score</th><th>Proof (claimed → observed)</th><th>What the member says</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>`;
}

function evidenceBlock(x) {
  if (!x.evidence.length) return '';
  const row = (e) => {
    const kind = esc(e.kind ?? 'ref');
    let ref = `<code class="ref">${esc(e.ref)}</code>`;
    if (e.kind === 'url' && /^https?:\/\//i.test(String(e.ref))) {
      ref = `<a class="ref" href="${esc(e.ref)}" rel="noreferrer noopener" target="_blank">${esc(String(e.ref).replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
    }
    return `<li class="ev"><span class="ev-k k-${kind}">${kind}</span>${ref}${e.caption ? `<span class="ev-c">${esc(e.caption)}</span>` : ''}</li>`;
  };
  const head = x.evidence.slice(0, 6).map(row).join('');
  const rest = x.evidence.slice(6);
  return `<div class="m-block"><h3 class="m-sub">Evidence <span>${x.evidence.length}</span></h3>
    <ul class="evidence">${head}</ul>
    ${rest.length ? `<details class="more"><summary>${rest.length} more evidence ${rest.length === 1 ? 'ref' : 'refs'}</summary><ul class="evidence">${rest.map(row).join('')}</ul></details>` : ''}
  </div>`;
}

function techniquesBlock(x) {
  if (!x.techniques.length) return '';
  const items = x.techniques
    .map(
      (t) =>
        `<li><span class="t-sub">${esc(t.subject)}</span><span class="t-sep">›</span><span class="t-tech">${esc(t.technique)}</span>${t.proof ? `<span class="t-proof">${esc(t.proof)}</span>` : ''}</li>`,
    )
    .join('');
  return `<div class="m-block"><h3 class="m-sub">Standards applied <span>${x.techniques.length}</span></h3><ul class="techs">${items}</ul></div>`;
}

function memberSection(m, x, i) {
  const total = x.findings.length;
  const sevbar = total
    ? `<div class="sevbar" aria-label="${x.sev.high} high, ${x.sev.med} medium, ${x.sev.low} low">${['high', 'med', 'low', 'other']
        .filter((k) => x.sev[k])
        .map((k) => `<span class="sb-${k}" style="flex:${x.sev[k]}">${x.sev[k]} ${SEV_LABEL[k].toLowerCase()}</span>`)
        .join('')}</div>`
    : '';
  const findings = x.findings
    .map((f) => {
      const k = sevKey(f.severity);
      return `<li class="finding s-${k}" id="f-${esc(f.id)}">
        <div class="f-top"><span class="sev-tag s-${k}">${esc(f.severity)}</span><code class="fid">${esc(f.id)}</code>${f.recurrence > 1 ? `<span class="rec">recurrence ${esc(f.recurrence)}</span>` : ''}</div>
        <h3 class="f-title">${richText(f.title, { inline: true })}</h3>
        ${f.detail ? `<details class="f-detail"><summary>The member's reasoning</summary><div class="f-body">${richText(f.detail)}</div></details>` : ''}
      </li>`;
    })
    .join('');
  const unm = !x.measured
    ? `<div class="callout ${x.notApplicable ? 'note' : 'dim'}"><h3>${x.notApplicable ? 'Not applicable' : 'Not measured'}</h3>${x.unmeasuredReason ? richText(x.unmeasuredReason) : '<p>No reason was recorded.</p>'}</div>`
    : '';
  const floorTxt =
    typeof x.floor === 'number'
      ? `floor ${f2(x.floor)}${x.floorHit ? (x.advisory ? ' · hit, advisory' : ' · hit, binding') : ' · held'}`
      : 'no floor';
  return `<section id="m-${esc(x.name)}" class="member" aria-labelledby="mh-${esc(x.name)}" data-nav="${esc(cap(x.name))}">
  <header class="m-head">
    <div>
      <p class="eyebrow">Member ${i + 1} · ${esc(x.kind)}${x.weight != null ? ` · weight ${f2(x.weight)}` : ''}</p>
      <h2 id="mh-${esc(x.name)}">${esc(cap(x.name))}</h2>
    </div>
    <div class="m-fig">
      <span class="m-n${x.measured ? '' : ' unm'}">${x.measured ? f2(x.score) : 'unmeasured'}</span>
      <span class="m-tags">${x.confidence ? `<span class="conf c-${esc(x.confidence)}">${esc(x.confidence)} confidence</span>` : ''}${deltaChip(x.delta)}<span class="m-floor">${esc(floorTxt)}</span></span>
      ${track(m, x, { big: true })}
    </div>
  </header>
  ${unm}
  ${total ? `<div class="m-block"><h3 class="m-sub">Findings <span>${total}</span></h3>${sevbar}<ol class="findings">${findings}</ol></div>` : x.measured ? '<p class="quiet">This member filed no findings.</p>' : ''}
  ${techniquesBlock(x)}
  ${evidenceBlock(x)}
</section>`;
}

/* ---------------------------------------------------------------------- page */

function rail(m, report) {
  const link = (id, label, num, extra = '') =>
    `<li><a href="#${esc(id)}" data-target="${esc(id)}"><span class="num">${String(num).padStart(2, '0')}</span><span class="lbl">${label}</span>${extra}</a></li>`;
  let n = 0;
  const verdict = [link('verdict', 'The verdict', n++), link('must', `Must address <span class="cnt">${m.must.length}</span>`, n++)];
  if (m.chain.length > 1) verdict.push(link('rounds', 'Rounds', n++));
  if (m.scenarios.length) verdict.push(link('scenarios', 'Scenarios', n++));
  const members = m.members.map((x) =>
    link(
      `m-${x.name}`,
      esc(cap(x.name)),
      n++,
      `<span class="mini${x.measured ? '' : ' u'}" aria-hidden="true">${x.measured ? `<i style="width:${pct(x.score)}"></i>` : ''}</span><span class="mini-n">${x.measured ? f2(x.score) : '–'}</span>`,
    ),
  );
  const written = report.sections.map((s) => link(s.id, esc(s.title), n++));
  return `<nav class="rail" aria-label="Contents">
  <div class="rail-head"><span class="rail-k">Council</span><span class="rail-t">${esc(m.subject.title || m.subject.slug)}</span></div>
  <p class="grp">The verdict</p><ol>${verdict.join('')}</ol>
  <p class="grp">The members</p><ol class="members">${members.join('')}</ol>
  ${written.length ? `<p class="grp">The written report</p><ol>${written.join('')}</ol>` : ''}
  <p class="rail-foot">No decision is taken here. Approve or reject in Personas.</p>
</nav>`;
}

export function renderPage(m) {
  const report = renderReportMarkdown(m.reportMd);
  if (report.preamble.trim()) {
    report.sections.unshift({ id: 'r-synthesis', title: 'Synthesis', titleHtml: 'Synthesis', html: report.preamble });
  }
  const written = report.sections
    .map(
      (s, i) => `<section id="${esc(s.id)}" class="prose" aria-labelledby="${esc(s.id)}-h" data-nav="${esc(s.title)}">
  <p class="eyebrow">From report.md · ${i + 1} of ${report.sections.length}</p>
  <h2 id="${esc(s.id)}-h">${s.id === 'r-synthesis' ? 'Synthesis' : s.titleHtml.replace(/^\d+[.)]\s+/, '')}</h2>
  ${s.html}
</section>`,
    )
    .join('\n');
  const title = `${m.subject.title || m.subject.slug || m.runId} · council ${m.mode} r${m.round ?? '?'}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the report</a>
<header class="top">
  <div class="top-in">
    <span class="brand">Personas <b>Council</b></span>
    <span class="crumb" aria-live="off"><span class="crumb-s">${esc(m.subject.slug ?? '')}</span> <span class="crumb-sep">/</span> <span id="crumb">The verdict</span></span>
    <span class="top-id"><span class="o-dot o-${esc(m.outcome)}"></span>${esc(m.outcome)} · r${esc(m.round ?? '?')} · <code>${esc(shortSha(m.head))}</code></span>
  </div>
  <span class="prog" id="prog"></span>
</header>
<div class="wrap">
${rail(m, report)}
<main id="main">
${hero(m)}
${mustSection(m)}
${roundsSection(m)}
${scenariosSection(m)}
${m.members.map((x, i) => memberSection(m, x, i)).join('\n')}
${written}
<footer class="foot">
  <p>Rendered from <code>result.json</code> and <code>report.md</code> in <code>${esc(m.runDir)}</code>. Rubric weights and the bar come from the ${m.rubric.source === 'registry' ? 'registry rubric file' : m.rubric.source === 'mirror' ? "app's rubric mirror (no registry checkout was found)" : 'nowhere: the rubric version is unknown'}; floors and kinds come from the run. ${m.evidenceFiles ? `The run keeps ${m.evidenceFiles} entries under <code>evidence/</code>.` : ''}</p>
  <p>This page carries no decision. Approve or reject in Personas, bound to run <code>${esc(m.runId)}</code> at <code>${esc(m.head ?? '–')}</code>.</p>
</footer>
</main>
</div>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
