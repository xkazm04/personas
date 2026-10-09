// Read one council run directory into the shape the report draws.
//
// Inputs are the run's own artefacts and nothing else: result.json (the
// verdict), report.md (the Director's prose), started.json (round, mode, drift),
// verdict-<member>.json (only for what result.json lacks), and - for the rounds
// strip - the result.json of sibling run dirs linked by `supersedes_run_id`.
// The rubric's weights and threshold are NOT in a run's files: they come from
// the registry's rubric JSON when that checkout exists, else from the mirror
// below (the same numbers `src/features/companions/curator/council/table/rubrics.ts`
// pins), and the page says which.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const MIRROR = {
  'feature-v1': {
    threshold: 0.7,
    coverageFloor: 0.6,
    dimensions: {
      value: { weight: 0.3, floor: 0.4, kind: 'judged' },
      craft: { weight: 0.25, floor: null, kind: 'mixed' },
      rivalry: { weight: 0.2, floor: null, kind: 'judged' },
      robustness: { weight: 0.15, floor: 0.5, kind: 'mechanical' },
      economics: { weight: 0.1, floor: null, kind: 'mechanical' },
    },
  },
  'architecture-v1': {
    threshold: 0.7,
    coverageFloor: 0.6,
    dimensions: {
      craft: { weight: 0.35, floor: null, kind: 'mixed' },
      robustness: { weight: 0.3, floor: 0.5, kind: 'mechanical' },
      reversibility: { weight: 0.25, floor: 0.5, kind: 'mechanical' },
      economics: { weight: 0.1, floor: null, kind: 'mechanical' },
    },
  },
};

const jsonCache = new Map();

/** Parse a JSON file, or `null` when it is absent or unreadable (cached per path). */
export function readJson(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  let v = null;
  if (existsSync(path)) {
    try {
      v = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      v = null;
      process.stderr.write(`  note: ${path} is not valid JSON (${err.message}); treated as absent\n`);
    }
  }
  jsonCache.set(path, v);
  return v;
}

/** The rubric a run was judged by: registry JSON first, then the mirror, with provenance. */
export function loadRubric(version, registryRoot) {
  const file = registryRoot && version ? join(registryRoot, 'skills', 'council', 'rubric', `${version}.json`) : null;
  const reg = file ? readJson(file) : null;
  if (reg && Array.isArray(reg.dimensions)) {
    const dimensions = {};
    for (const d of reg.dimensions) dimensions[d.dimension] = { weight: d.weight, floor: d.floor ?? null, kind: d.kind };
    return { version, threshold: reg.threshold, coverageFloor: reg.coverage_floor, dimensions, source: 'registry' };
  }
  const m = MIRROR[version];
  if (m) return { version, ...m, source: 'mirror' };
  return { version: version ?? 'unknown', threshold: null, coverageFloor: null, dimensions: {}, source: 'unknown' };
}

const SEV_ORDER = { high: 0, med: 1, medium: 1, low: 2, info: 3, lead: 4 };
export const sevKey = (s) => (s === 'medium' ? 'med' : s in SEV_ORDER ? s : 'other');

function memberOf(dim, rubric, verdict) {
  const r = rubric.dimensions[dim.dimension] ?? {};
  const findings = [...(dim.findings ?? verdict?.findings ?? [])].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || (b.recurrence ?? 0) - (a.recurrence ?? 0),
  );
  const sev = { high: 0, med: 0, low: 0, other: 0 };
  for (const f of findings) sev[sevKey(f.severity)] += 1;
  const measured = dim.state === 'measured' && typeof dim.score === 'number';
  return {
    name: dim.dimension,
    kind: dim.kind ?? r.kind ?? 'unknown',
    state: dim.state ?? (measured ? 'measured' : 'unmeasured'),
    measured,
    notApplicable: dim.state === 'not_applicable',
    score: measured ? dim.score : null,
    confidence: dim.confidence ?? null,
    floor: dim.floor !== undefined ? dim.floor : (r.floor ?? null),
    floorHit: !!dim.floor_hit,
    advisory: !!dim.advisory,
    weight: typeof r.weight === 'number' ? r.weight : null,
    unmeasuredReason: dim.unmeasured_reason ?? null,
    findings,
    sev,
    evidence: dim.evidence ?? verdict?.evidence ?? [],
    techniques: dim.techniques ?? verdict?.techniques ?? [],
    delta: typeof dim.delta === 'number' ? dim.delta : null,
  };
}

/**
 * Classify one `must_address` line. The instrument writes three shapes:
 * `<member>: <defect>` (work), `<member> is unmeasured: <why>` (a limit of the
 * measurement, not work) and `<member> scored <x> below its floor of <y>`.
 */
export function classifyMust(line, memberNames) {
  const s = String(line);
  let m = s.match(/^(\w+) is unmeasured:\s*(.*)$/s);
  if (m) return { kind: 'unmeasured', member: m[1], text: m[2] || s };
  m = s.match(/^(\w+) scored ([\d.]+) below its floor of ([\d.]+)\s*(.*)$/s);
  if (m) return { kind: 'floor', member: m[1], text: s, score: Number(m[2]), floor: Number(m[3]) };
  m = s.match(/^(\w+):\s*(.*)$/s);
  if (m && memberNames.includes(m[1])) return { kind: 'work', member: m[1], text: m[2] };
  if (/^hard[ _-]?fail/i.test(s)) return { kind: 'hard', member: null, text: s };
  return { kind: 'work', member: null, text: s };
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The finding a must-address line came from, by title prefix within its member. */
function sourceFinding(must, members) {
  const pool = must.member ? members.filter((m) => m.name === must.member) : members;
  const t = norm(must.text);
  if (t.length < 12) return null;
  for (const m of pool)
    for (const f of m.findings) {
      const ft = norm(f.title);
      const n = Math.min(48, ft.length, t.length);
      if (n >= 12 && ft.slice(0, n) === t.slice(0, n)) return { member: m.name, finding: f };
    }
  return null;
}

/** Strip the Win32 extended-length prefix the app stores (`\\?\C:\...`, `\\?\UNC\host\...`). */
export function cleanRunDir(p) {
  let s = String(p ?? '').trim();
  if (s.startsWith('\\\\?\\UNC\\')) s = '\\\\' + s.slice(8);
  else if (s.startsWith('\\\\?\\')) s = s.slice(4);
  return s;
}

function roundSummary(dir, result, started) {
  return {
    runId: result?.run_id ?? basename(dir),
    dir,
    round: result?.round_no ?? started?.round_no ?? null,
    outcome: result?.outcome ?? null,
    overall: typeof result?.overall === 'number' ? result.overall : null,
    coverage: typeof result?.coverage === 'number' ? result.coverage : null,
    head: result?.receipt?.head_sha ?? null,
    hasReport: existsSync(join(dir, 'report.md')),
    dims: (result?.dimensions ?? []).map((d) => ({
      name: d.dimension,
      score: d.state === 'measured' && typeof d.score === 'number' ? d.score : null,
    })),
  };
}

/** The chain of rounds this run belongs to, oldest first, found among sibling dirs. */
function roundChain(runDir, result) {
  const parent = dirname(runDir);
  const self = roundSummary(runDir, result, null);
  const chain = [{ ...self, current: true }];
  const seen = new Set([self.runId]);
  // Backwards through supersedes_run_id.
  let prevId = result.supersedes_run_id;
  while (prevId && !seen.has(prevId)) {
    seen.add(prevId);
    const dir = join(parent, prevId);
    const r = readJson(join(dir, 'result.json'));
    if (!r) {
      chain.unshift({ runId: prevId, dir, round: null, outcome: null, missing: true, dims: [] });
      break;
    }
    chain.unshift(roundSummary(dir, r, null));
    prevId = r.supersedes_run_id;
  }
  // Forwards: a sibling whose result supersedes the newest round we hold.
  const slug = result.subject?.slug;
  let siblings = [];
  try {
    siblings = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory() && (!slug || e.name.includes(slug)))
      .map((e) => e.name);
  } catch {
    siblings = []; // an unreadable parent only costs the forward half of the strip
  }
  let tip = self.runId;
  for (let guard = 0; guard < 8; guard++) {
    const next = siblings.find((name) => {
      if (seen.has(name)) return false;
      return readJson(join(parent, name, 'result.json'))?.supersedes_run_id === tip;
    });
    if (!next) break;
    seen.add(next);
    const r = readJson(join(parent, next, 'result.json'));
    chain.push(roundSummary(join(parent, next), r, null));
    tip = next;
  }
  return chain;
}

/** Everything the template needs from one run directory. Throws only on a missing required input. */
export function loadRun(runDir, { registryRoot } = {}) {
  const result = readJson(join(runDir, 'result.json'));
  const started = readJson(join(runDir, 'started.json'));
  const rubric = loadRubric(result.rubric_version ?? started?.rubric_version, registryRoot);
  const members = (result.dimensions ?? []).map((d) =>
    memberOf(d, rubric, readJson(join(runDir, `verdict-${d.dimension}.json`))),
  );
  const names = members.map((m) => m.name);
  const must = (result.must_address ?? []).map((line) => {
    const c = classifyMust(line, names);
    return { ...c, raw: String(line), source: c.kind === 'work' ? sourceFinding(c, members) : null };
  });
  const totalWeight = members.reduce((a, m) => a + (m.weight ?? 0), 0);
  const drift = started?.drift ?? result.drift ?? null;
  const mode = result.mode ?? started?.mode ?? (/-lite-r\d+$/.test(result.run_id ?? '') ? 'lite' : 'full');
  const evidenceDir = join(runDir, 'evidence');
  return {
    runDir: resolve(runDir),
    runId: result.run_id ?? basename(runDir),
    mode,
    subject: result.subject ?? started?.subject ?? {},
    round: result.round_no ?? started?.round_no ?? null,
    supersedes: result.supersedes_run_id ?? null,
    trust: result.trust_state ?? started?.trust_state ?? 'unknown',
    trustSource: started?.trust_state_source ?? null,
    rubric,
    head: result.receipt?.head_sha ?? started?.receipt?.head_sha ?? null,
    spanCount: (result.receipt?.spanned_paths ?? started?.receipt?.spanned_paths ?? []).length,
    spanDigest: result.receipt?.span_digest ?? null,
    drift: typeof drift === 'string' ? drift : (drift?.verdict ?? null),
    startedAt: started?.started_at ?? null,
    hardFailures: result.hard_failures ?? [],
    members,
    totalWeight,
    overall: typeof result.overall === 'number' ? result.overall : null,
    coverage: typeof result.coverage === 'number' ? result.coverage : null,
    outcome: result.outcome ?? 'unknown',
    must,
    summary: typeof result.summary === 'string' ? result.summary : '',
    scenarios: result.scenarios ?? [],
    envelope: result.envelope ?? null,
    skipped: result.skipped_dimensions ?? [],
    chain: roundChain(runDir, result),
    evidenceFiles: existsSync(evidenceDir) ? readdirSync(evidenceDir).length : 0,
    reportMd: readFileSync(join(runDir, 'report.md'), 'utf8'),
  };
}
