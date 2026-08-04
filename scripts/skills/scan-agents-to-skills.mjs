#!/usr/bin/env node
/**
 * scan-agents-to-skills — promote the Idea Scanner's scan lenses into PRESET
 * system skills, git-tracked at `.claude/skills/scan-<key>/SKILL.md` and
 * bundled into the installer via sync-system-skills.mjs → resources/skills.
 *
 * Source: src-tauri/src/commands/infrastructure/scan_agents.toml (22 agents).
 * The interactive scanner (idea_scanner.rs) emits DB-JSON for ingestion; these
 * generated skills are the *interactive* form — explore + report findings in
 * markdown. They are context-tracked so Fleet runs populate the Memory
 * Ledger's per-context coverage. The scanner backend lane is left untouched.
 *
 * Idempotent: skips a skill whose SKILL.md already exists unless --force.
 * Usage:  node scripts/skills/scan-agents-to-skills.mjs [--force] [--dry-run]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOML = join(REPO, 'src-tauri', 'src', 'commands', 'infrastructure', 'scan_agents.toml');
const SKILLS_DIR = join(REPO, '.claude', 'skills');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

/** Minimal parser for this flat `[[agents]]` + `key = "value"` TOML. */
function parseAgents(toml) {
  const agents = [];
  let cur = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '[[agents]]') { cur = {}; agents.push(cur); continue; }
    if (!cur) continue;
    const m = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
    if (m) cur[m[1]] = m[2];
  }
  return agents;
}

/** Skills-manager category per agent — finer than the 4 category groups. */
const CATEGORY_OVERRIDES = {
  'test-strategist': 'Testing',
  'dependency-auditor': 'Maintenance',
  'tech-debt-tracker': 'Maintenance',
  'analytics-planner': 'Data',
};
function skillCategory(a) {
  if (CATEGORY_OVERRIDES[a.key]) return CATEGORY_OVERRIDES[a.key];
  return a.category_group === 'technical' ? 'Development' : 'Other';
}

/** Build a quality interactive SKILL.md from one scan agent. */
function skillMarkdown(a) {
  const exampleBullets = (a.examples || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n');
  // Frontmatter description is double-quoted; agent text has no embedded quotes.
  const base = (a.description || '').trim();
  const sep = /[.!?]$/.test(base) ? '' : '.';
  const desc = `${base}${sep} Use for a focused ${a.label} pass over a project or a diff.`;
  return `---
name: scan-${a.key}
description: "${desc}"
argument-hint: "[context]"
category: ${skillCategory(a)}
contexts: tracked
memory: project
---
# ${a.label} ${a.emoji || ''}

If a context (feature-area) name is passed as the final argument, scope the
pass to that context's files — read \`context-map.json\` at the project root to
resolve the context's \`filePaths\` and stay inside them.

You are a **${a.label}**. Analyze the codebase through this lens and surface concrete, actionable findings — not generic advice.

## What to look for
${a.description}

Anchor examples:
${exampleBullets}

## Repo conventions — read before proposing any change

If \`.claude/conventions.json\` exists at the project root, read it first. It is
the machine-readable statement of this repo's hard gates (what blocks a commit,
what codegen must run after which edit, which rules are enforced). A finding
that violates a declared gate is not a finding, it is a defect you are about to
introduce — check the manifest before recommending, not after.

## How to work

1. **Survey before you judge.** Explore the codebase with the file tools and
   collect evidence *first* — where this lens is most relevant, what the code
   actually does. Do not form the verdict while you are still reading.
2. **Then run any deterministic check available** (a linter, a type-checker, an
   existing script) and reconcile it against what you found. Order matters: a
   tool's output anchors judgment, so a finding you formed only after seeing it
   is a finding the tool gave you, not one you found.
3. Prefer depth on a few real findings over a long list of nitpicks.
4. Cite evidence — reference actual files, functions, and line numbers.
5. Note explicitly where the deterministic check and your own reading disagree:
   a clean tool run over code you judged weak is a **finding about the tool's
   coverage**, and worth reporting as such.

## Report the honest shape of the run

Begin the report with one line declaring how it ran, so a weakened pass is never
silent:

- Full pass: \`Method: full (scope: <what you actually covered>)\`
- Anything less: \`⚠️ DEGRADED: <what was skipped and why>\`

Degrade openly whenever you sampled instead of covering, could not run a check
you meant to run, or hit a limit. A degraded scan reported as complete is worse
than no scan — the gap silently becomes "we looked at that."

## Output

Report each finding as a short section:
- **Title** — concise and actionable.
- **Finding** — what it is and why it matters, with evidence (\`file:line\`).
- **Recommendation** — the concrete change to make.
- **Scores** — effort / impact / risk, each 1–10 (1 = trivial / negligible / none … 10 = epic / transformative / critical).

End with a one-line summary (N findings, highest-impact first). Be specific; skip anything you can't ground in the code.

## Persist a snapshot

After reporting, append one line to \`.claude/scan-history/scan-${a.key}.jsonl\`
(create the directory if needed) so later runs can see movement instead of
starting blind:

\`\`\`json
{"at":"<ISO-8601>","scope":"<context or 'repo'>","findings":<n>,"p1":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
\`\`\`

Then read the previous lines and, if any exist, add a trend line to your report:

> **Trend for scan-${a.key}: 12 → 7 → 9 findings** (last 3 runs)

Compare like with like — a run scoped to one context is not comparable to a
whole-repo run, so say so rather than printing a misleading arrow. If this is
the first run, say "first run, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     The interactive Idea Scanner (DB-ingesting) remains the alternative path. -->
`;
}

/** Per-lens brief bundle for the sweep skill's references/lenses.md. */
function lensesMarkdown(agents) {
  const sections = agents.map((a) => {
    const examples = (a.examples || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join('\n');
    return `## ${a.key} — ${a.label} ${a.emoji || ''}

Group: ${a.category_group}
Match: \`/${a.match}/i\` (against the context's name, description, keywords, tech stack, API surface, and file paths)

${a.description}

Anchor examples:
${examples}`;
  }).join('\n\n');
  return `# Scan lenses — reference for /scan-sweep

One section per lens. \`Match\` is the same keyword rule the Personas app uses
to bundle lenses for a context — apply it to the context's attributes when no
explicit \`--lenses\` list was passed.

${sections}

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs. -->
`;
}

/** The consolidated context-sweep skill: read the code once, judge through
 *  every matched lens. The findings contract matches the Personas memory
 *  outbox ingest (finding / escalation / node line types). */
function sweepMarkdown() {
  return `---
name: scan-sweep
description: "End-to-end context sweep: reads one feature-area's code once, evaluates it through every scan lens (references/lenses.md), and by default FIXES the accepted S/M findings in-session with atomic commits — one session owns one context end to end. Pass --ideas-only to emit findings to the Personas memory outbox for backlog triage instead of fixing. L moonshot items are always triaged, never auto-built."
argument-hint: "[--ideas-only] [--lenses key1,key2] [context]"
category: Development
contexts: tracked
memory: project
---
# Context Sweep 🧭

You are running a **multi-lens sweep** over ONE context (feature area), end to
end. The expensive part of any scan is reading the code; do it once, then judge
what you read through each relevant lens. Depth beats breadth: a lens with
nothing real to say returns nothing.

**Two modes:**

- **Resolve (DEFAULT)** — scan, then IMPLEMENT the accepted S/M findings right
  in this session, one atomic commit each, and report what shipped. Only what
  you could not or should not fix leaves the session as a backlog finding.
- **Ideas-only (\`--ideas-only\`)** — scan and emit every finding to the memory
  outbox for app-side triage; change no code.

Several sweep sessions may run in this repo at once, each owning a different
context — the parallel rules in step 6 are what make that safe.

## 1. Resolve scope

- The **final argument** is the context name. Read \`context-map.json\` at the
  project root, find the context, and stay inside its \`filePaths\`.
- **No context argument → pick the least lens-covered context yourself.** Read
  \`context-map.json\` and \`.claude/scan-history/scan-sweep.jsonl\` (if present).
  Choose, in this order: the first context in map order with NO snapshot at all;
  else the context whose snapshots' \`lens_keys\` union is SMALLEST (fewest lenses
  ever applied); tie → the one whose latest snapshot is oldest. State the choice
  and why in the report header ("never swept" / "lens coverage 4/22, oldest
  <date>") so coverage rotation is auditable.

## 2. Load shared awareness (do this BEFORE reading code)

- \`.personas/backlog-digest.json\` (if present) — the project's live backlog
  memory: pending / accepted / rejected idea titles. **Never re-propose
  anything on those lists, including rephrasings of rejected titles.** A
  rejected title is a durable human "no".
- \`.claude/conventions.json\` (if present) — the repo's hard gates. A finding
  that violates a declared gate is a defect you are about to introduce, not a
  finding.
- \`.claude/scan-history/scan-sweep.jsonl\` (if present) — prior sweep
  snapshots for the trend line.

## 3. Pick the lens package

- If \`--lenses key1,key2,...\` was passed, use exactly those keys.
- Otherwise the package is **ALL lenses in \`references/lenses.md\`**, ordered
  matched-first: lenses whose \`Match\` regex hits the context's name,
  description, keywords, tech stack, API surface, or file paths go first (they
  get the deepest attention); the remaining lenses follow as a lighter pass —
  most will honestly report "nothing real", and that clean verdict is itself
  coverage worth recording.
- If prior snapshots for this context already carry \`lens_keys\`, put the
  never-applied lenses first within each tier — the package's job is to close
  lens coverage, not re-walk the covered ones.
- List matched vs. remaining lens keys in the report header.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST — form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter,
   existing script) and reconcile; deterministic findings belong to those tools,
   not to this sweep — do not restate them as findings.
3. Then walk the lens package **sequentially**. Per lens: at most **3**
   findings, each grounded in \`file:line\` evidence. Zero findings is a valid
   and common result — say "nothing real" and move on. Prefer one deep finding
   over three shallow ones.
   **Yield expectation for a FULL package: around 20 findings** on a healthy
   in-band context (most from 5-8 lenses, the rest honestly clean). Under ~10
   usually means you stopped at the surface — dig again before declaring
   clean. **Risk naturally grows with repeat sweeps of the same context**:
   round 1 harvests the low-destruction layer; later rounds are EXPECTED to
   surface medium-risk items the first pass deferred. That is the design, not
   scope creep — the triage gate (step 5) is what keeps it safe.
4. **Budget: at most 30 findings per context, lifetime.** Before emitting,
   subtract what prior snapshots already reported for this scope (\`findings\`
   counts) and never re-emit a finding already reported in a prior run or
   present in the backlog digest. When the remaining budget is smaller than
   what you found, keep the highest-impact items and say what was cut.
5. **Value/destruction rubric — score both sides.** Value = user-visible or
   developer-measurable gain (impact). Destruction = risk of breaking working
   code PLUS churn (lines rewritten per unit of gain). Order all work
   value-first, destruction-last. Two hard rules learned from calibration:
   - **"Unused/dead" claims require proof**: a tech-debt finding that says
     dead/unused MUST cite its zero-consumer grep in the evidence. Verified
     dead-code removal is the best value/destruction class there is; guessed
     dead-code removal is the worst.
   - **Repo-declared incremental migrations** (i18n string extraction, design
     token adoption — whatever the repo's conventions call fix-as-you-touch)
     ARE in scope for the nearest lens in the files you already read, but only
     where no deterministic gate already tracks them, and never as a bulk
     migration.

## 5. Size classes — the routing decision

Classify every candidate finding:

- **S** — localized: one file, one mechanism (a rename, a guard, an attribute).
- **M** — a few files or one subsystem seam; a normal PR.
- **L** — structural / moonshot: architecture-grade work spanning modules
  (the kind an architect pass would propose: new layers, protocol redesigns,
  cross-cutting migrations).

Routing:

- **Resolve mode has a TRIAGE PHASE before the execution phase.** Split the
  queue by destruction:
  - **Low destruction** (risk ≤ 3 and not pure churn): auto-execute, no ask.
  - **Above-medium destruction** (risk ≥ 4), **pure churn** (refactors of
    working code with no user-visible or measurable gain), **value-uncertain
    product items** (instrumentation, speculative features — low risk but the
    operator owns the value judgment), and **L items**:
    STOP and triage with the operator in the terminal — one line per item
    (title, value, what could break), operator picks which proceed. Accepted
    items join the execution phase; declined ones are dropped or emitted as
    backlog findings per the operator's word. Unattended (Fleet/app
    dispatch, no operator): risk ≥ 4 and churn items are NEVER built — emit
    them as findings with honest scores so the app's backlog gates them; L
    items emit with \`"size":"L"\` and effort ≥ 8.
  - Execution runs only AFTER triage resolves, highest value first.
  Never build an L item in a sweep session.
- **Ideas-only mode:** everything routes to the outbox; same L triage rule.

## 6. Resolve mode — implement the S/M findings now

Work the accepted list highest-impact first, one finding at a time:

1. **One atomic commit per finding.** Fix, verify, commit, then start the
   next. Never stack two findings' edits in one working state.
2. **Verify before committing** with the repo's own gates for the surface you
   touched (\`.claude/conventions.json\` names them; else the obvious ones —
   type-check, lint, the module's tests). A fix that fails its gate is either
   repaired inline or fully reverted — never committed red, never left
   half-applied.
3. Commit message: \`fix(<context>): <finding title>\` plus a body line naming
   the lens — the finding's provenance survives in history.
4. **A fix that grows beyond its size class mid-flight gets demoted, not
   forced.** If an S fix starts touching a third file or a shared surface you
   did not anticipate, stop, revert the attempt, and emit it as a finding
   with the honest larger size.

**Parallel-session rules (several sweeps share this repo, one context each):**

- Edit ONLY inside your context's \`filePaths\`, plus their tests and any
  generated artifacts the repo's conventions REQUIRE you to regenerate for
  those edits. A needed change outside that boundary is not yours to make —
  emit it as a finding naming the foreign file instead.
- Stage with explicit pathspecs only (\`git add <file> <file>\`) and commit with
  explicit paths — never \`git add -A\`/\`.\`/\`-u\`, never \`git stash\`, never
  reset another session's work. Before each commit, confirm the staged list
  is exactly your files.
- Shared/generated surfaces other sessions also write (locale bundles,
  generated types, checksum manifests): make the edit and its regen, commit
  IMMEDIATELY, and keep that commit minimal — shared files must never sit
  uncommitted while you work on the next finding.

## 7. Report

Header first:

- \`Method: full (context: <name>, lenses: <keys>)\` — or
  \`⚠️ DEGRADED: <what was skipped and why>\` if you sampled, skipped a lens, or
  hit a limit. A degraded sweep reported as complete is worse than no sweep.

Resolve mode leads with what SHIPPED — one line per fixed finding
(\`✔ <title> — <commit sha>\`), then the unfixed findings; ideas-only mode
lists findings only. Per finding, a short section:
- **Title** — concise and actionable.
- **Finding** — what and why it matters, with \`file:line\` evidence.
- **Recommendation** — the concrete change (or the commit that made it).
- **Scores** — size S/M/L + effort / impact / risk, each 1–10.

End with a one-line summary (X fixed, Y proposed across M lenses).

## 8. Emit to the memory outbox

Append to \`.personas/memory-outbox.jsonl\` (create \`.personas/\` if needed),
ONE JSON object per line, nothing else on the line.

**A FIXED finding is a progress node, not a finding** — it must not land in
the backlog as open work:

\`\`\`json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Fixed: <finding title>","body":"<commit sha>; <one-line gist>"}
\`\`\`

Each UNFIXED finding (everything, in ideas-only mode):

\`\`\`json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","title":"<finding title>","body":"<what + why + recommendation, condensed>","evidence":"<file:line — one-line proof>","size":"S|M|L","effort":3,"impact":7,"risk":2}
\`\`\`

Escalation — emit at most one per lens, ONLY when that lens produced a
critical finding (impact ≥ 8) or 3 real findings in this context:

\`\`\`json
{"type":"escalation","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","reason":"<≤120 chars: what the deep pass should chase>"}
\`\`\`

Coverage — one node line per lens you actually evaluated (found something or
not), plus one for the sweep itself:

\`\`\`json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Sweep pass: <lens-key> over <context>","body":"<n> findings; <one-line gist or 'clean'>"}
{"type":"node","kind":"progress","skill":"scan-sweep","context":"<context name>","title":"Sweep of <context>","body":"<lenses evaluated>; <fixed> fixed, <open> proposed, <e> escalations"}
\`\`\`

Keep the outbox lean — the ingest caps at 200 lines / 512 KB and accepts at
most 30 finding lines per pass; a full-package sweep emits ≤30 findings plus
one coverage node per evaluated lens (a clean lens still gets its node — that
IS the per-lens coverage record). The Personas app ingests and DELETES this
file when a Fleet session exits or the Skills Manager opens; findings land in
the project backlog deduped against everything already known.

## 9. Persist a snapshot

Append one line to \`.claude/scan-history/scan-sweep.jsonl\` (create the
directory if needed). \`lens_keys\` = every lens actually evaluated this run —
it is the per-context lens-coverage ledger the no-arg picker and the
package-ordering rule read. \`findings\` counts BOTH fixed and proposed (both
spend the 30-item budget):

\`\`\`json
{"at":"<ISO-8601>","scope":"<context>","mode":"resolve|ideas","lens_keys":["<key>","<key>"],"lenses":<n>,"findings":<n>,"fixed":<n>,"escalations":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
\`\`\`

If prior lines exist for the SAME scope, add a trend line to the report
("Trend for <context>: 12 → 7 → 9 findings"); otherwise say "first sweep of
this context, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     Single-lens scan-* skills remain the focused deep-dive form. -->
`;
}

const agents = parseAgents(readFileSync(TOML, 'utf8'));
let written = 0, skipped = 0;
for (const a of agents) {
  if (!a.key) continue;
  const dir = join(SKILLS_DIR, `scan-${a.key}`);
  const file = join(dir, 'SKILL.md');
  if (existsSync(file) && !force) {
    console.log(`skip   scan-${a.key} (exists)`);
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log(`would write  scan-${a.key}`);
    written++;
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, skillMarkdown(a), 'utf8');
  console.log(`write  scan-${a.key}`);
  written++;
}
// The consolidated sweep skill — one dir with SKILL.md + references/lenses.md.
// lenses.md regenerates whenever the sweep is (re)written so lens briefs track
// the TOML; same skip-unless-forced contract as the per-lens skills.
{
  const dir = join(SKILLS_DIR, 'scan-sweep');
  const file = join(dir, 'SKILL.md');
  if (existsSync(file) && !force) {
    console.log('skip   scan-sweep (exists)');
    skipped++;
  } else if (dryRun) {
    console.log('would write  scan-sweep (+ references/lenses.md)');
    written++;
  } else {
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(file, sweepMarkdown(), 'utf8');
    writeFileSync(join(dir, 'references', 'lenses.md'), lensesMarkdown(agents.filter((a) => a.key)), 'utf8');
    console.log('write  scan-sweep (+ references/lenses.md)');
    written++;
  }
}

console.log(`\n${dryRun ? 'would write' : 'wrote'} ${written}, skipped ${skipped} → ${SKILLS_DIR}`);
