# Refresh Codebase Context

Export the `personas` project's context map from the runtime SQLite DB to a static markdown snapshot at `.claude/codebase-context.md`. This snapshot is consumed by `/research` (and other skills) for fast relevance scoring without re-scanning the codebase.

**This skill is hardcoded to the `personas` project.** The dev_tools DB stores contexts for many codebases — this skill must never export contexts from other projects.

## When to Use

- After a fresh codebase scan in the app
- When the snapshot is older than ~30 days
- When git HEAD has moved >200 commits since the last refresh
- Manually after large refactors

`/research` will warn the user to re-run this skill when staleness is detected.

---

## Constants

- **DB path:** `C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db`
- **Personas root:** `C:\Users\mkdol\dolla\personas`
- **Output:** `.claude/codebase-context.md` (relative to personas repo root)
- **SQLite CLI:** `sqlite3` (already in PATH via Android SDK platform-tools)

---

## Phase 1: Verify Personas Project is Registered

Run:
```bash
sqlite3 "C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db" \
  "SELECT id, name FROM dev_projects WHERE root_path = 'C:\Users\mkdol\dolla\personas';"
```

**Three outcomes:**

### 1a. No row returned
The personas project has not been registered yet. Print this and stop:

```
The personas project is not yet registered in the dev_tools DB.

To register and scan it:
  1. Open the Personas app
  2. Navigate to Plugins → Dev Tools → Codebases
  3. Click "Add Project" and point to: C:\Users\mkdol\dolla\personas
  4. Open the project and click "Scan Codebase"
  5. Wait for the scan to finish (you'll see progress lines)
  6. Re-run /refresh-context

You can also use any other context-grouping flow in the app — this skill
just needs at least one row in dev_contexts for the personas project.
```

Do not attempt to insert the project via SQL — scanning is what generates the contexts, and scanning runs via the app's Tauri command.

### 1b. Row returned but no contexts exist
Run:
```bash
sqlite3 "C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db" \
  "SELECT COUNT(*) FROM dev_contexts WHERE project_id = '<id>';"
```

If `0`: print:
```
The personas project is registered but has no contexts yet.
Open the app → Plugins → Dev Tools → Codebases → personas → Scan Codebase.
Re-run /refresh-context after the scan completes.
```
Stop.

### 1c. Row returned and contexts exist
Continue to Phase 2.

---

## Phase 2: Export Contexts to Markdown

Query everything in one shot. Use `-separator` and structured output to keep parsing trivial.

```bash
sqlite3 -json "C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db" "
  SELECT
    COALESCE(cg.name, 'Ungrouped') AS group_name,
    COALESCE(cg.color, '#888888')   AS group_color,
    COALESCE(cg.group_type, '')     AS group_type,
    COALESCE(cg.position, 9999)     AS group_position,
    c.name        AS context_name,
    c.description AS context_description,
    c.file_paths  AS file_paths_json,
    c.entry_points AS entry_points_json,
    c.keywords    AS keywords_json,
    c.api_surface AS api_surface_json,
    c.tech_stack  AS tech_stack_json
  FROM dev_contexts c
  LEFT JOIN dev_context_groups cg ON c.group_id = cg.id
  WHERE c.project_id = '<personas_project_id>'
  ORDER BY group_position, group_name, c.name;
"
```

Parse the JSON output. For each row, the `*_json` columns are JSON strings (arrays) that need a second parse.

---

## Phase 3: Render the Snapshot

Write `.claude/codebase-context.md` with this structure:

```markdown
# Codebase Context Snapshot — personas

> Generated: {ISO-8601 UTC timestamp}
> Source: dev_contexts table for project_id={id}
> Total groups: {N}, Total contexts: {M}
> Git HEAD at generation: {short-sha} ({commit-message-first-line})
>
> **DO NOT EDIT MANUALLY.** Re-run `/refresh-context` to regenerate.
> Consumed by `/research` for relevance scoring.

---

## How to Use This File

Each section below describes a feature area of the personas codebase, with:
- **Description** — what it does
- **Files** — paths under `personas/` that implement it
- **Entry points** — key functions/components/routes
- **Keywords** — searchable terms for relevance matching
- **API surface** — external endpoints/IPC commands exposed
- **Tech stack** — frameworks/libs used in this area

When `/research` extracts an idea, it scores the idea against the keywords
and descriptions here to find the most likely attachment point. If no group
matches, the idea is dropped as out-of-scope.

---

{For each group, render:}

## {group_name}

> **Group type:** {group_type or "—"}
> **Color:** {group_color}

### {context_name}

{context_description}

**Files:**
{For each path in file_paths_json, render as: `- \`{path}\``}

**Entry points:**
{Comma-separated list from entry_points_json, or "—" if empty}

**Keywords:** {comma-separated from keywords_json, or "—"}

**API surface:** {from api_surface_json, or "—"}

**Tech stack:** {from tech_stack_json, or "—"}

---

{...next context...}
```

Notes:
- Skip empty fields (don't render `**Keywords:** —` if empty — just omit the line).
- If `file_paths_json` is empty, skip the context entirely (it has no anchor in the codebase).
- Sort contexts within each group alphabetically by name.
- The "Ungrouped" group always comes last regardless of position.

---

## Phase 4: Capture Git State for Staleness Detection

Append a footer to the file with git state, used by `/research` to detect drift:

```bash
git -C "C:/Users/mkdol/dolla/personas" rev-parse HEAD
git -C "C:/Users/mkdol/dolla/personas" rev-list --count HEAD
```

Footer format:
```markdown
---

<!-- snapshot-meta
git_head: {full-sha}
git_commit_count: {N}
generated_at: {ISO-8601}
-->
```

`/research` reads this footer and warns if the current `rev-list --count HEAD` exceeds `git_commit_count + 200`.

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

  Source DB:       C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db
  Project:         personas ({project_id})
  Groups:          {N}
  Contexts:        {M} (skipped {K} with no file paths)
  Templates:       {T} catalogued
  Connectors:      {C} catalogued
  Git HEAD:        {short-sha}

  Files:
    + .claude/codebase-context.md   (DB-derived feature map)
    + .claude/codebase-catalogs.md  (filesystem-derived inventories)
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
