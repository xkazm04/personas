#!/usr/bin/env node
// Reflect evaluation harness — runs the Memory Engine v2 reflection pass
// against LIVE app data (via the test-automation server on :17320) and
// produces judgment bundles so a human/LLM can verify each proposal is
// high-quality and harmless BEFORE it is ever applied.
//
// Safe by construction: reflection is proposal-mode (no live rows change),
// and this script never calls apply/discard. It additionally asserts the
// persona's memory set is byte-identical before vs after the run.
//
// Usage:
//   node scripts/memory/reflect-eval.mjs                 # top 3 personas by memory count
//   node scripts/memory/reflect-eval.mjs --top 5
//   node scripts/memory/reflect-eval.mjs --persona <id>
//   node scripts/memory/reflect-eval.mjs --out <dir>     # default .reflect-eval/
//
// Output per persona: <out>/<persona-slug>/
//   before.json    — full non-archived memory snapshot pre-run
//   proposal.json  — the persona_memory_review_proposal row produced
//   checks.json    — deterministic integrity check results
//   review.md      — human-readable side-by-side (insight vs its sources)
//
// Requires the app running with test-automation (npm run tauri:dev:test).

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.PERSONAS_TEST_BASE ?? 'http://127.0.0.1:17320';

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const TOP = Number(argVal('--top') ?? 3);
const ONLY_PERSONA = argVal('--persona');
const OUT_DIR = argVal('--out') ?? '.reflect-eval';
const MIN_MEMORIES = Number(argVal('--min') ?? 8);

// ── bridge plumbing (:17320 /eval fire-and-forget + DOM stash + /query) ─────
async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

let seq = 0;
/**
 * Invoke a Tauri IPC command inside the live webview and return its result.
 *
 * /eval is fire-and-forget and the bridge's /query truncates each node's
 * text at 300 chars, so the JS stashes the JSON payload as ≤280-char CHUNK
 * child nodes under a hidden container plus a `-meta` node with the chunk
 * count. We poll the meta node, then read every chunk in ONE /query call
 * (attribute-prefix selector) and reassemble in index order.
 */
async function invokeIpc(command, params, { timeoutMs = 30_000 } = {}) {
  const id = `__re_${Date.now()}_${seq++}`;
  const js = `(async () => {
    const box = document.createElement('div');
    box.id = ${JSON.stringify(id)};
    box.style.display = 'none';
    document.body.appendChild(box);
    let payload;
    try {
      const r = await window.__TEST__.invokeCommand(${JSON.stringify(command)}, ${JSON.stringify(params)});
      payload = JSON.stringify(r);
    } catch (e) {
      payload = JSON.stringify({ success: false, error: String(e) });
    }
    const CHUNK = 280;
    const n = Math.ceil(payload.length / CHUNK) || 1;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.id = ${JSON.stringify(id)} + '-c' + String(i).padStart(6, '0');
      c.textContent = payload.slice(i * CHUNK, (i + 1) * CHUNK);
      box.appendChild(c);
    }
    const meta = document.createElement('span');
    meta.id = ${JSON.stringify(id)} + '-meta';
    meta.textContent = String(n);
    box.appendChild(meta);
  })()`;
  await post('/eval', { js });

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      const metaNodes = await post('/query', { selector: `#${id}-meta` });
      const metaText = Array.isArray(metaNodes) && metaNodes[0]?.text;
      if (!metaText) continue;
      const expected = Number(metaText);
      const chunks = await post('/query', { selector: `[id^="${id}-c"]` });
      if (!Array.isArray(chunks) || chunks.length !== expected) continue; // chunks still attaching
      const payload = chunks
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((c) => c.text ?? '')
        .join('');
      const parsed = JSON.parse(payload);
      if (!parsed.success) throw new Error(`${command} failed: ${parsed.error}`);
      return parsed.result;
    }
  } finally {
    await post('/eval', { js: `document.getElementById(${JSON.stringify(id)})?.remove()` }).catch(() => {});
  }
  throw new Error(`${command} timed out after ${timeoutMs}ms (stash ${id} never filled)`);
}

// ── domain helpers ───────────────────────────────────────────────────────────
async function snapshotMemories(personaId) {
  return invokeIpc('list_memories', {
    personaId,
    tier: '!archive',
    limit: 500,
    offset: 0,
    sortColumn: 'created_at',
    sortDirection: 'desc',
  });
}

function memKey(m) {
  return `${m.id}|${m.tier}|${m.importance}|${m.title}|${m.content}`;
}

// ── deterministic integrity checks ──────────────────────────────────────────
function runChecks(proposal, before, after) {
  const byId = new Map(before.map((m) => [m.id, m]));
  const failures = [];
  const warnings = [];
  const check = (ok, label, detail) => {
    if (!ok) failures.push({ label, detail });
  };

  const synth = proposal.entries.filter((e) => e.action === 'synthesize');
  const archive = proposal.entries.filter((e) => e.action === 'archive');
  const other = proposal.entries.filter((e) => !['synthesize', 'archive'].includes(e.action));
  check(other.length === 0, 'only-reflection-actions', `unexpected actions: ${other.map((e) => e.action).join(',')}`);

  const consumed = new Set();
  for (const e of synth) {
    const tag = `synthesize "${e.title}"`;
    const sources = e.sourceIds ?? [];
    check(sources.length >= 2, `${tag}: >=2 sources`, `got ${sources.length}`);
    check(Boolean(e.newTitle?.trim()) && Boolean(e.newContent?.trim()), `${tag}: non-empty insight`, '');
    check(e.newImportance == null || (e.newImportance >= 1 && e.newImportance <= 5), `${tag}: importance in 1..5`, String(e.newImportance));
    for (const sid of sources) {
      const src = byId.get(sid);
      check(Boolean(src), `${tag}: source exists`, sid);
      if (src) check(src.tier !== 'core', `${tag}: source not core`, `${sid} (${src.title})`);
      if (consumed.has(sid)) warnings.push({ label: `${tag}: source ${sid} consumed by more than one insight`, detail: '' });
      consumed.add(sid);
    }
  }
  for (const e of archive) {
    const src = byId.get(e.memoryId);
    check(Boolean(src), `archive "${e.title}": target exists`, e.memoryId);
    if (src) check(src.tier !== 'core', `archive "${e.title}": target not core`, e.memoryId);
    check(!consumed.has(e.memoryId), `archive "${e.title}": not double-actioned`, e.memoryId);
  }

  // No-mutation assertion: the proposal run must not have touched live rows.
  const beforeKeys = new Set(before.map(memKey));
  const afterKeys = new Set(after.map(memKey));
  const changed =
    before.length !== after.length ||
    [...beforeKeys].some((k) => !afterKeys.has(k));
  check(!changed, 'no-live-mutation', `before=${before.length} after=${after.length}`);

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    stats: {
      memoriesReviewed: proposal.reviewedCount,
      insights: synth.length,
      archiveActions: archive.length,
      sourcesConsumed: consumed.size,
      // Net effect if applied: sources+archives leave the active pool, insights join it.
      netActiveDelta: synth.length - consumed.size - archive.filter((e) => !consumed.has(e.memoryId)).length,
    },
  };
}

// ── review.md — the judgment surface ────────────────────────────────────────
function renderReview(personaName, proposal, before, checks) {
  const byId = new Map(before.map((m) => [m.id, m]));
  const L = [];
  L.push(`# Reflect evaluation — ${personaName}`);
  L.push('');
  L.push(`Proposal \`${proposal.id}\` · status \`${proposal.status}\` · reviewed ${proposal.reviewedCount} memories`);
  L.push('');
  L.push(`> ${proposal.summary ?? ''}`);
  L.push('');
  L.push(`**Integrity checks:** ${checks.passed ? 'ALL PASSED' : `${checks.failures.length} FAILED`}`);
  for (const f of checks.failures) L.push(`- ❌ ${f.label} — ${f.detail}`);
  for (const w of checks.warnings) L.push(`- ⚠️ ${w.label}`);
  L.push('');
  L.push('## Judge each insight: is every claim supported by its sources? Is anything still-valuable lost when sources archive?');
  L.push('');
  let i = 0;
  for (const e of proposal.entries) {
    if (e.action === 'synthesize') {
      i += 1;
      L.push(`### Insight ${i}: ${e.newTitle}`);
      L.push('');
      L.push(`- category: \`${e.newCategory}\` · importance: ${e.newImportance} · reason: ${e.reason || '—'}`);
      L.push('');
      L.push(`**Proposed content:**`);
      L.push('');
      L.push(`> ${String(e.newContent).split('\n').join('\n> ')}`);
      L.push('');
      L.push(`**Replaces ${e.sourceIds?.length ?? 0} sources (archived on apply):**`);
      L.push('');
      for (const sid of e.sourceIds ?? []) {
        const s = byId.get(sid);
        if (!s) { L.push(`- MISSING ${sid}`); continue; }
        L.push(`- \`${sid.slice(0, 8)}\` [${s.category}, imp ${s.importance}, tier ${s.tier}, access ${s.access_count}] **${s.title}**`);
        L.push(`  > ${String(s.content).split('\n').join(' ')}`);
      }
      L.push('');
    }
  }
  const archives = proposal.entries.filter((e) => e.action === 'archive');
  if (archives.length) {
    L.push('## Standalone archive proposals (content below is what would leave the active pool)');
    L.push('');
    for (const e of archives) {
      const s = byId.get(e.memoryId);
      L.push(`- \`${e.memoryId.slice(0, 8)}\` **${e.title}** — ${e.reason || '—'}`);
      if (s) L.push(`  > ${String(s.content).split('\n').join(' ')}`);
    }
  }
  return L.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!health) {
    console.error(`Test-automation server not reachable at ${BASE}. Start the app with: npm run tauri:dev:test`);
    process.exit(1);
  }

  const stats = await invokeIpc('get_memory_stats', {});
  const personas = await invokeIpc('list_personas', {}).catch(() => []);
  const nameOf = new Map(personas.map((p) => [p.id, p.name]));

  let targets;
  if (ONLY_PERSONA) {
    targets = [[ONLY_PERSONA, null]];
  } else {
    targets = stats.agent_counts
      .filter(([, n]) => n >= MIN_MEMORIES)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP);
  }
  if (targets.length === 0) {
    console.error(`No personas with >= ${MIN_MEMORIES} memories.`);
    process.exit(1);
  }

  console.log(`Evaluating reflection on ${targets.length} persona(s): ${targets.map(([id, n]) => `${nameOf.get(id) ?? id} (${n ?? '?'} mem)`).join(', ')}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  for (const [personaId, count] of targets) {
    const name = nameOf.get(personaId) ?? personaId;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || personaId.slice(0, 8);
    const dir = path.join(OUT_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n── ${name} (${count ?? '?'} memories) ──`);

    const before = await snapshotMemories(personaId);
    fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify(before, null, 2));
    console.log(`  snapshot: ${before.length} non-archived memories`);

    console.log('  running reflect_memories_with_cli (may take up to 8 min)…');
    let result;
    try {
      result = await invokeIpc('reflect_memories_with_cli', { personaId }, { timeoutMs: 540_000 });
    } catch (e) {
      console.error(`  REFLECT FAILED: ${e.message}`);
      summary.push({ persona: name, personaId, error: e.message });
      continue;
    }
    if (!result.proposal_id) {
      console.log(`  no proposal produced (reviewed ${result.reviewed}) — too few memories or empty reflection`);
      summary.push({ persona: name, personaId, reviewed: result.reviewed, proposal: null });
      continue;
    }

    const proposal = await invokeIpc('get_persona_memory_review_proposal', { proposalId: result.proposal_id });
    fs.writeFileSync(path.join(dir, 'proposal.json'), JSON.stringify(proposal, null, 2));

    const after = await snapshotMemories(personaId);
    const checks = runChecks(proposal, before, after);
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(checks, null, 2));
    fs.writeFileSync(path.join(dir, 'review.md'), renderReview(name, proposal, before, checks));

    console.log(`  proposal ${proposal.id}: ${checks.stats.insights} insights, ${checks.stats.archiveActions} archives, checks ${checks.passed ? 'PASSED' : 'FAILED'}`);
    summary.push({ persona: name, personaId, proposalId: proposal.id, ...checks.stats, checksPassed: checks.passed, failures: checks.failures, dir });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone. Bundles in ${OUT_DIR}/ — judge each review.md, then apply or discard proposals from the Memories UI.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
