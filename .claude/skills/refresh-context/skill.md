# Refresh Codebase Context

Render the `personas` project's context map from `context-map.json` (the
machine-readable map the app writes to the repo root on each scan) into a static
markdown snapshot at `.claude/codebase-context.md`, then regenerate the catalogs
file. The snapshot is consumed by `/research` (and other skills) for fast
relevance scoring without re-scanning the codebase. Because the snapshot is a
deterministic projection of `context-map.json`, the two cannot drift.

**This skill is hardcoded to the `personas` project.** It reads only the repo-root
`context-map.json`, never another project's contexts.

## When to Use

- After a fresh codebase scan in the app
- When the snapshot is older than ~30 days
- When git HEAD has moved >200 commits since the last refresh
- Manually after large refactors

`/research` will warn the user to re-run this skill when staleness is detected.

---

## Constants

- **Source of truth:** `context-map.json` (repo root) — written by the Personas
  app's context scan; this skill renders from it (no direct DB access).
- **Renderer:** `scripts/context/render-codebase-context.mjs` (Node ≥20)
- **Overrides:** `.claude/codebase-context-overrides.md` (hand-curated groups,
  appended verbatim by the renderer)
- **Output:** `.claude/codebase-context.md` (relative to personas repo root)

---

## Coordination — Active-Runs Ledger

`/refresh-context` is a **single-writer** skill — both `.claude/codebase-context.md` and `.claude/codebase-catalogs.md` are regenerated wholesale, so a concurrent run on either file would silently lose changes. Register this session in `.claude/active-runs.md` per the convention in [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md) BEFORE Phase 2's export starts. Read the file's `## Active` section first; if any `started`-status entry overlaps your planned scope and is <2h old, surface the conflict to the user before proceeding. Overlap on `.claude/active-runs.md` itself is expected and is not a conflict.

**Declared paths for `/refresh-context`:**
- `.claude/codebase-context.md` (regenerated wholesale — single-writer)
- `.claude/codebase-catalogs.md` (regenerated wholesale — single-writer)
- Read-only: the personas SQLite DB at `%APPDATA%/com.personas.desktop/personas.db`, `scripts/templates/**`, `scripts/connectors/builtin/**`
- Always: `.claude/active-runs.md`

**At session end** (Phase 7 summary, after the snapshot lands): move your entry to the top of `## Recently completed`. Update `Status` to `completed (commit: <sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/concepts/cli-coordination-active-runs.md`](../../../docs/concepts/cli-coordination-active-runs.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md), every CLI session must:

1. **Never `git stash`** other sessions' work — not even with `--keep-index`. Stash sweeps the entire working tree (and untracked files with `-u`) and silently relocates other sessions' in-flight edits. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A` / `git add .` / `git add -u`); leave everything else alone. The 2026-05-09 stash incident burned a `/research` run's working tree.
2. **Use a worktree for multi-file scope.** `/refresh-context` writes BOTH `.claude/codebase-context.md` AND `.claude/codebase-catalogs.md` wholesale — that's multi-file by definition. Default to:
   ```bash
   git worktree add .claude/worktrees/refresh-context -b worktree-refresh-context
   cd .claude/worktrees/refresh-context
   ```
   Note that the `.claude/` worktree subdirectory is gitignored (or should be — see CLAUDE.md), so the worktree itself doesn't pollute the main checkout's status.
3. **Atomic commits per task** — context regen + catalogs regen are separate writes; commit each. Never accumulate >30 min of uncommitted work.
4. **Clean up the worktree after merge.** Once the worktree's branch is in `git log master`, from the main checkout: `git worktree remove .claude/worktrees/refresh-context` and `git branch -D worktree-refresh-context`. Treat as part of the Phase 7 ledger ritual.

---

## Phase 1: Verify the context map exists

`.claude/codebase-context.md` is now a **deterministic projection of
`context-map.json`** — the machine-readable map the Personas app writes into
the repo root on every scan. This skill no longer reads the SQLite DB directly
(that path had gone stale, pointing at a different machine's home dir).

Check the source of truth is present:

```bash
test -f context-map.json && echo "ok" || echo "missing"
```

If missing, the personas project hasn't been scanned yet. Print this and stop:

```
context-map.json not found at the repo root.

To generate it:
  1. Open the Personas app -> Plugins -> Dev Tools -> Context Map
  2. Add/open the personas project and click "Scan Codebase" (or "Re-scan")
  3. The scan writes context-map.json into the repo root
  4. Re-run /refresh-context
```

Do not hand-author context-map.json — scanning is what generates it.

---

## Phase 2: Render the Snapshot from context-map.json

Run the deterministic renderer. It reads `context-map.json`, renders every
group + context to markdown, appends `.claude/codebase-context-overrides.md`
verbatim (hand-curated groups that survive DB regeneration), and writes the
`<!-- snapshot-meta -->` footer `/research` reads for staleness — using the
provenance commit stamped in the JSON (falling back to live `git HEAD` when the
JSON predates provenance stamping):

```bash
node scripts/context/render-codebase-context.mjs
```

That single command replaces the previous hand-rendered `sqlite3` pipeline
(old Phases 2-4). Because the markdown is a pure function of `context-map.json`,
the two can no longer drift — the 8-vs-9-groups drift that motivated this was
exactly two generators of the same data. Overrides are preserved: the renderer
appends the override file as-is (it owns its own headings/HTML comments).

To refresh the underlying data first, run a scan in the app (Phase 1) so
`context-map.json` is current, then run the renderer.

---

## Phase 5: Regenerate Catalogs File

After writing `codebase-context.md`, regenerate `.claude/codebase-catalogs.md` from the filesystem. This file inventories every template and connector for `/research` dedup and gap analysis.

Run this Node one-liner from the personas repo root (Node ≥20 is required, already in `package.json` engines):

```bash
node -e "
const fs = require('fs');
const path = require('path');

// Templates
const tRoot = 'scripts/templates';
const tCats = fs.readdirSync(tRoot).filter(d => fs.statSync(path.join(tRoot,d)).isDirectory());
const t = { total: 0, cats: {} };
for (const cat of tCats) {
  const dir = path.join(tRoot, cat);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  t.cats[cat] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      t.cats[cat].push({
        id: j.id,
        desc: (j.description || '').replace(/\s+/g, ' ').trim(),
        sflow: (j.service_flow || []).join(' -> '),
        triggers: (j.payload?.suggested_triggers || []).map(x=>x.trigger_type).filter(Boolean).join(','),
        cons: (j.payload?.suggested_connectors || []).map(x=>x.name).join(',')
      });
      t.total++;
    } catch(e) {}
  }
  t.cats[cat].sort((a,b)=>a.id.localeCompare(b.id));
}

// Connectors
const cDir = 'scripts/connectors/builtin';
const cFiles = fs.readdirSync(cDir).filter(f => f.endsWith('.json'));
const c = { total: 0, cats: {} };
for (const f of cFiles) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cDir, f), 'utf8'));
    const cat = j.category || 'uncategorized';
    if (!c.cats[cat]) c.cats[cat] = [];
    const m = j.metadata || {};
    c.cats[cat].push({
      name: j.name,
      auth: m.auth_type_label || m.auth_type || '?',
      summary: (m.summary || '').replace(/\s+/g, ' ').trim(),
      tier: m.pricing_tier || '?'
    });
    c.total++;
  } catch(e) {}
}
for (const k of Object.keys(c.cats)) c.cats[k].sort((a,b)=>a.name.localeCompare(b.name));

// Render
const lines = [];
lines.push('# Codebase Catalogs — personas');
lines.push('');
lines.push('> Generated: ' + new Date().toISOString());
lines.push('> Templates: ' + t.total + ' across ' + Object.keys(t.cats).length + ' categories');
lines.push('> Connectors: ' + c.total + ' across ' + Object.keys(c.cats).length + ' categories');
lines.push('>');
lines.push('> **DO NOT EDIT MANUALLY.** Re-run \`/refresh-context\` to regenerate.');
lines.push('> Consumed by \`/research\` for template/credential bucket dedup and gap analysis.');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## How /research Uses This File');
lines.push('');
lines.push('When an idea is bucketed as a **template** or **credential** proposal:');
lines.push('1. **Dedup** — does a template/credential with this scope already exist? Drop the idea if yes.');
lines.push('2. **Gap fit** — does the idea fill a sparse category? Boost priority if yes.');
lines.push('3. **Service compatibility** — for template ideas, are required connectors in the catalog? If not, the credential must be added first.');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Template Catalog (' + t.total + ')');
lines.push('');
const tCatNames = Object.keys(t.cats).sort();
for (const cat of tCatNames) {
  lines.push('### ' + cat + ' (' + t.cats[cat].length + ')');
  lines.push('');
  for (const item of t.cats[cat]) {
    const trig = item.triggers ? ' [trigger: ' + item.triggers + ']' : '';
    const cons = item.cons ? ' (uses: ' + item.cons + ')' : '';
    const sflow = item.sflow ? ' — flow: ' + item.sflow : '';
    lines.push('- **' + item.id + '** — ' + item.desc + sflow + cons + trig);
  }
  lines.push('');
}
lines.push('---');
lines.push('');
lines.push('## Connector Catalog (' + c.total + ')');
lines.push('');
const cCatNames = Object.keys(c.cats).sort();
for (const cat of cCatNames) {
  lines.push('### ' + cat + ' (' + c.cats[cat].length + ')');
  lines.push('');
  for (const item of c.cats[cat]) {
    lines.push('- **' + item.name + '** (' + item.auth + ', ' + item.tier + ') — ' + item.summary);
  }
  lines.push('');
}
lines.push('---');
lines.push('');
lines.push('## Coverage Analysis');
lines.push('');
lines.push('### Template categories by density');
lines.push('');
const tDens = tCatNames.map(cat => ({ cat, n: t.cats[cat].length })).sort((a,b)=>b.n-a.n);
for (const x of tDens) {
  const tag = x.n < 3 ? '  ← **sparse, gap candidate**' : (x.n >= 8 ? '  (well-covered)' : '');
  lines.push('- ' + x.cat + ': ' + x.n + tag);
}
lines.push('');
lines.push('### Connector categories by density');
lines.push('');
const cDens = cCatNames.map(cat => ({ cat, n: c.cats[cat].length })).sort((a,b)=>b.n-a.n);
for (const x of cDens) {
  const tag = x.n < 3 ? '  ← **sparse, gap candidate**' : (x.n >= 8 ? '  (well-covered)' : '');
  lines.push('- ' + x.cat + ': ' + x.n + tag);
}
lines.push('');
lines.push('### Auth type distribution');
lines.push('');
const authMap = {};
for (const cat of cCatNames) for (const item of c.cats[cat]) authMap[item.auth] = (authMap[item.auth]||0)+1;
const authSorted = Object.entries(authMap).sort((a,b)=>b[1]-a[1]);
for (const [auth, n] of authSorted) lines.push('- ' + auth + ': ' + n);
lines.push('');

fs.writeFileSync('.claude/codebase-catalogs.md', lines.join('\n'));
console.log('wrote .claude/codebase-catalogs.md (' + lines.length + ' lines, ' + t.total + ' templates, ' + c.total + ' connectors)');
"
```

If Node fails or `scripts/templates` / `scripts/connectors/builtin` is missing, report the failure but **do not abort the skill** — `codebase-context.md` is the primary output.

---

## Phase 6: Note codebase-stack.md (do not regenerate)

`.claude/codebase-stack.md` is hand-curated and **must not be auto-regenerated**. Just verify it exists. If missing, print:

```
Note: .claude/codebase-stack.md is missing. This file documents the persona schema,
Claude Code CLI engine wrapping, tech stack, and architectural conventions. It is
hand-curated and only refreshed manually after major architecture changes. Without
it, /research will have weaker context about persona internals and the CLI engine.
Ask Claude to regenerate it if you've had significant model/schema/engine changes.
```

Do not attempt to regenerate it from this skill — it requires reading multiple source files and reasoning about architecture, which is a separate task.

---

## Phase 7: Summary

Print:
```
Codebase context refreshed.

  Source:          context-map.json (rendered by render-codebase-context.mjs)
  Project:         personas ({project_id})
  Groups:          {N}
  Contexts:        {M} (skipped {K} with no file paths)
  Templates:       {T} catalogued
  Connectors:      {C} catalogued
  Git HEAD:        {short-sha}

  Files:
    + .claude/codebase-context.md   (DB-derived feature map{if overrides applied:} + hand-curated overrides{end})
    + .claude/codebase-catalogs.md  (filesystem-derived inventories)
    {if .claude/codebase-context-overrides.md exists:}
    = .claude/codebase-context-overrides.md  (hand-curated overrides, appended above)
    {if exists:}
    = .claude/codebase-stack.md     (hand-curated, unchanged)
    {if missing:}
    ! .claude/codebase-stack.md     (MISSING — see Phase 6 note)

Next: /research can now use these snapshots for relevance scoring.
```

---

## Safety Rules

- **Never** export contexts for any project other than personas. If multiple `dev_projects` rows match the personas root_path (shouldn't happen — `root_path` is UNIQUE — but defensive check), abort and report.
- **Never** modify the DB. This skill is read-only.
- **Never** hardcode the project_id — always look it up by `root_path`. The ID is a runtime UUID and varies per machine.
- If the DB file is missing, print install instructions for the Personas app and stop.
