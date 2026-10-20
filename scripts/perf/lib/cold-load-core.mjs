// Pure half of the cold-load probe (scripts/perf/cold-load-probe.mjs): surface
// derivation from the app's navigation registry, the IPC waterfall arithmetic,
// the proposed bar and the scorecard. No network, no DOM: everything here is
// unit-tested by scripts/perf/__tests__/cold-load-core.test.mjs.
//
// The surface list is DERIVED, never hand-listed:
//   - sections from `NAV_SECTIONS` in src/lib/navigation/registry.ts
//     (reachability 'sidebar' | 'nested'; 'overlay-only' and 'hidden' own no
//     content-router branch, so they are not page loads)
//   - tabs from `TAB_DIMENSIONS` in src/lib/analytics/navCatalog.ts, the
//     catalog whose `exact<Union>` Records already fail tsc when a tab union
//     gains a member the catalog lacks
//   - companions pages from `COMPANIONS_PAGES` in src/features/companions/types.ts
// What IS hand-written is REACH: how to get a nested dimension on screen
// (DIMENSION_REACH below). A dimension that appears in the catalog and not in
// that table is treated as a top-level tab of its section, and
// `deriveSurfaces` reports it under `unreachedDimensions` instead of guessing.

/** How a nested tab dimension is put on screen. Keyed by catalog dimension key. */
export const DIMENSION_REACH = {
  goalsView: { requires: [{ store: 'system', key: 'teamsTab', value: 'goals' }], path: 'goals' },
  devToolsTab: { requires: [{ store: 'system', key: 'pluginTab', value: 'dev-tools' }], path: 'dev-tools' },
  cloudTab: { requires: [{ store: 'system', key: 'agentTab', value: 'cloud' }], path: 'cloud' },
  editorTab: { requires: [], needsPersona: true, path: 'editor' },
  designSubTab: {
    requires: [{ store: 'system', key: 'editorTab', value: 'design' }],
    needsPersona: true,
    path: 'editor/design',
  },
};

const ROUTED_REACHABILITY = new Set(['sidebar', 'nested']);

/** NAV_SECTIONS rows: id, reachability, devOnly, minTier, parent. */
export function parseNavRegistry(source) {
  const start = source.indexOf('export const NAV_SECTIONS');
  if (start < 0) throw new Error('NAV_SECTIONS not found in registry source');
  const end = source.indexOf('] as const', start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const out = [];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*\{\s*id:\s*'([\w-]+)'.*?reachability:\s*'([\w-]+)'/.exec(line);
    if (!m) continue;
    const minTier = /minTier:\s*TIERS\.(\w+)/.exec(line)?.[1]?.toLowerCase() ?? null;
    const parent = /parent:\s*'([\w-]+)'/.exec(line)?.[1] ?? null;
    out.push({ id: m[1], reachability: m[2], devOnly: /devOnly:\s*true/.test(line), minTier, parent });
  }
  if (out.length === 0) throw new Error('NAV_SECTIONS parsed to zero rows: the matcher is broken, not the registry empty');
  return out;
}

function parseStringArray(source, constName) {
  const re = new RegExp(`export const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const m = re.exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** TAB_DIMENSIONS rows with their value sets resolved. */
export function parseNavCatalog(catalogSource, companionsSource) {
  const sets = new Map();
  for (const m of catalogSource.matchAll(/const\s+(\w+)\s*=\s*exact<\w+>\(\{([^}]*)\}\)/g)) {
    const values = [...m[2].matchAll(/['"]?([\w:-]+)['"]?\s*:\s*true/g)].map((x) => x[1]);
    sets.set(m[1], values);
  }
  const companions = companionsSource ? parseStringArray(companionsSource, 'COMPANIONS_PAGES') : null;
  if (companions) sets.set('COMPANIONS_PAGES', companions);

  const start = catalogSource.indexOf('export const TAB_DIMENSIONS');
  if (start < 0) throw new Error('TAB_DIMENSIONS not found in navCatalog source');
  const end = catalogSource.indexOf('];', start);
  const block = catalogSource.slice(start, end);
  const dims = [];
  for (const m of block.matchAll(/\{\s*key:\s*'(\w+)',\s*store:\s*'(\w+)',\s*section:\s*'([\w-]+)',\s*values:\s*(\w+)\s*\}/g)) {
    const values = sets.get(m[4]);
    if (!values || values.length === 0) throw new Error(`TAB_DIMENSIONS.${m[1]}: value set ${m[4]} did not parse`);
    dims.push({ key: m[1], store: m[2], section: m[3], values });
  }
  if (dims.length === 0) throw new Error('TAB_DIMENSIONS parsed to zero rows: the matcher is broken');
  return dims;
}

/**
 * Every navigable surface: one per (section, top-level tab value), plus one
 * per nested dimension value reached through DIMENSION_REACH. A section with
 * no tab dimension is one surface.
 */
export function deriveSurfaces(sections, dims) {
  const surfaces = [];
  const unreachedDimensions = [];
  for (const sec of sections) {
    if (!ROUTED_REACHABILITY.has(sec.reachability)) continue;
    const own = dims.filter((d) => d.section === sec.id);
    const top = own.filter((d) => !DIMENSION_REACH[d.key]);
    const nested = own.filter((d) => DIMENSION_REACH[d.key]);
    const gates = { devOnly: sec.devOnly, minTier: sec.minTier };
    if (top.length === 0) {
      surfaces.push({ id: sec.id, section: sec.id, sets: [], needsPersona: false, gates, dimension: null });
    }
    if (top.length > 1) {
      // Two top-level dimensions on one section would need a reach rule; say so.
      for (const d of top.slice(1)) unreachedDimensions.push(d.key);
    }
    const primary = top[0];
    if (primary) {
      for (const v of primary.values) {
        surfaces.push({
          id: `${sec.id}/${v}`,
          section: sec.id,
          sets: [{ store: primary.store, key: primary.key, value: v }],
          needsPersona: false,
          gates,
          dimension: primary.key,
        });
      }
    }
    for (const d of nested) {
      const reach = DIMENSION_REACH[d.key];
      for (const v of d.values) {
        surfaces.push({
          id: `${sec.id}/${reach.path}/${v}`,
          section: sec.id,
          sets: [...reach.requires, { store: d.store, key: d.key, value: v }],
          needsPersona: !!reach.needsPersona,
          gates,
          dimension: d.key,
        });
      }
    }
  }
  // A tab that only exists to host a nested dimension (teams/goals hosts
  // goalsView) is measured through that dimension's surfaces; listing it too
  // would count the same load twice.
  const covered = new Set();
  for (const d of dims) for (const req of DIMENSION_REACH[d.key]?.requires ?? []) covered.add(`${req.key}=${req.value}`);
  const deduped = surfaces.filter((s) => {
    const last = s.sets[s.sets.length - 1];
    return !last || !covered.has(`${last.key}=${last.value}`);
  });
  return { surfaces: deduped, unreachedDimensions };
}

/**
 * Longest chain of IPC calls in which each call STARTED after the previous one
 * FINISHED. A child fetch that waits for its parent's data to mount is exactly
 * such a chain, so this is an UPPER bound on the waterfall depth: two
 * independent calls that merely happened in sequence also chain. Input records
 * carry `startMs` and `endMs` on one clock.
 */
export function sequentialDepth(records) {
  const calls = records
    .filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs))
    .sort((a, b) => a.startMs - b.startMs);
  const best = new Array(calls.length).fill(1);
  const prev = new Array(calls.length).fill(-1);
  for (let i = 0; i < calls.length; i++) {
    for (let j = 0; j < i; j++) {
      if (calls[j].endMs <= calls[i].startMs && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
  }
  let at = -1;
  for (let i = 0; i < calls.length; i++) if (at < 0 || best[i] > best[at]) at = i;
  const chain = [];
  while (at >= 0) {
    chain.unshift(calls[at].command);
    at = prev[at];
  }
  return { depth: chain.length, chain };
}

/**
 * The PROPOSED bar. Stated in the scorecard header as a proposal, not law.
 * `null` metrics (unmeasured) never fail a check; they are counted apart.
 */
export const PROPOSED_BAR = {
  chromeMs: 100,
  contentMs: 1000,
  blankFramesBeyondGrace: 0,
  graceMs: 150,
  cls: 0.05,
  ipcSequentialDepth: 2,
  warmContentMs: 100,
};

export function evaluateBar(row, bar = PROPOSED_BAR) {
  const fails = [];
  const unmeasured = [];
  const check = (name, value, limit, label) => {
    if (value == null || Number.isNaN(value)) {
      unmeasured.push(name);
      return;
    }
    if (value > limit) fails.push(label(value));
  };
  const c = row.cold ?? {};
  const w = row.warm ?? {};
  check('chromeMs', c.chromeMs, bar.chromeMs, (v) => `chrome ${Math.round(v)} ms > ${bar.chromeMs}`);
  check('contentMs', c.contentMs, bar.contentMs, (v) => `content ${Math.round(v)} ms > ${bar.contentMs}`);
  check('blankFramesBeyondGrace', c.blankFramesBeyondGrace, bar.blankFramesBeyondGrace, (v) => `${v} blank frame(s) after ${bar.graceMs} ms`);
  check('cls', c.cls, bar.cls, (v) => `CLS ${v.toFixed(3)} > ${bar.cls}`);
  check('ipcSequentialDepth', c.ipcSequentialDepth, bar.ipcSequentialDepth, (v) => `IPC depth ${v} > ${bar.ipcSequentialDepth}`);
  check('warmContentMs', w.contentMs, bar.warmContentMs, (v) => `warm revisit ${Math.round(v)} ms > ${bar.warmContentMs}`);
  if (c.contentMs == null && c.ok) fails.push('no real content detected before the cap');
  return { fails, unmeasured };
}

/** Worst first: more bar failures, then slower first content, then id. */
export function rankRows(rows) {
  return rows
    .map((r) => ({ ...r, verdict: r.cold?.ok ? evaluateBar(r) : { fails: [], unmeasured: [] } }))
    .sort((a, b) => {
      const okA = a.cold?.ok ? 1 : 0;
      const okB = b.cold?.ok ? 1 : 0;
      if (okA !== okB) return okB - okA;
      const f = b.verdict.fails.length - a.verdict.fails.length;
      if (f) return f;
      const ca = a.cold?.contentMs ?? Number.POSITIVE_INFINITY;
      const cb = b.cold?.contentMs ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return cb - ca;
      return a.id.localeCompare(b.id);
    });
}

const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d));

export function renderScorecard(run, bar = PROPOSED_BAR) {
  const ranked = rankRows(run.rows);
  const measured = ranked.filter((r) => r.cold?.ok);
  const failing = measured.filter((r) => r.verdict.fails.length > 0);
  const skipped = ranked.filter((r) => !r.cold?.ok);
  const lines = [];
  lines.push(`# Cold-load scorecard - ${run.startedAt.slice(0, 10)}`);
  lines.push('');
  lines.push(`Generated by \`scripts/perf/cold-load-probe.mjs\` against the running app on :${run.port} (${run.buildMode}).`);
  lines.push('');
  lines.push('## Proposed bar (a PROPOSAL, not yet doctrine)');
  lines.push('');
  lines.push(`- chrome (first new heading or tab strip in \`#main-content\`) <= ${bar.chromeMs} ms`);
  lines.push(`- first real content (>= 40 visible chars or a >= 48 px figure outside chrome and ghosts) <= ${bar.contentMs} ms`);
  lines.push(`- zero blank-body frames after the ${bar.graceMs} ms delay-hidden ghost window`);
  lines.push(`- CLS < ${bar.cls} over the load window`);
  lines.push(`- sequential IPC depth <= ${bar.ipcSequentialDepth} (upper bound on the fetch waterfall)`);
  lines.push(`- warm revisit first content <= ${bar.warmContentMs} ms`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`- surfaces derived: ${run.rows.length}; measured: ${measured.length}; skipped or refused: ${skipped.length}`);
  lines.push(`- failing the proposed bar: **${failing.length} of ${measured.length}**`);
  const counts = {};
  for (const r of failing) for (const f of r.verdict.fails) {
    const k = f.split(/\s\d|\s>/)[0].replace(/^\d+\s/, '').trim();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const byCheck = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(' · ');
  if (byCheck) lines.push(`- failures by check: ${byCheck}`);
  lines.push('');
  if (run.caveats?.length) {
    lines.push('## Caveats and what was not measured');
    lines.push('');
    for (const c of run.caveats) lines.push(`- ${c}`);
    lines.push('');
  }
  lines.push('## Surfaces, worst first');
  lines.push('');
  lines.push('| # | surface | chrome ms | content ms | blank (>grace) | CLS | scripts | IPC | IPC depth | warm ms | fails |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  measured.forEach((r, i) => {
    const c = r.cold;
    lines.push(`| ${i + 1} | \`${r.id}\` | ${fmt(c.chromeMs)} | ${fmt(c.contentMs)} | ${fmt(c.blankFrames)} (${fmt(c.blankFramesBeyondGrace)}) | ${fmt(c.cls, 3)} | ${fmt(c.scriptRequests)} | ${fmt(c.ipcCount)} | ${fmt(c.ipcSequentialDepth)} | ${fmt(r.warm?.contentMs)} | ${r.verdict.fails.join('; ') || 'pass'} |`);
  });
  if (skipped.length) {
    lines.push('');
    lines.push('## Not measured');
    lines.push('');
    for (const r of skipped) lines.push(`- \`${r.id}\`: ${r.cold?.reason ?? r.cold?.error ?? 'unknown'}`);
  }
  lines.push('');
  return lines.join('\n');
}
