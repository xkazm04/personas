# Research

Extract actionable improvements for the personas project from any external source (YouTube video, blog post, article, raw text). Score ideas against the codebase, bucket into Code / Template / Credential, and either auto-invoke `/add-template`, `/add-credential`, or persist code-improvement findings to the Obsidian memory vault.

This skill is **personas-specific.** It uses `.claude/codebase-context.md` (refreshed by `/refresh-context`) for fast relevance scoring and the Obsidian vault at `C:/Users/mkdol/Documents/Obsidian/personas` for long-term memory and self-improvement.

## Input

Ask the user, in this order:

1. **"What is the source? Paste a YouTube URL, an article URL, or raw text."**
2. **"Any focus hint? (`code` / `templates` / `credentials` / `all`) — defaults to `all`."**

Wait for both answers before proceeding. Do NOT ask anything else upfront — further questions only if a phase requires clarification.

---

## Constants

- **Codebase reference files** (all under `.claude/`, generated/maintained by `/refresh-context`):
  - `codebase-context.md` — DB-derived feature map (8 groups, 34 contexts, file paths, keywords). Always loaded.
  - `codebase-stack.md` — hand-curated architecture, **Claude Code CLI engine wrapping**, persona schema, tech stack, conventions. Always loaded.
  - `codebase-catalogs.md` — current 92 templates + 87 connectors with coverage gaps. Loaded only when bucket B or C is in scope.
- **Obsidian vault:** `C:/Users/mkdol/Documents/Obsidian/personas`
  - `Research/` — one note per run
  - `Lessons/` — self-reflection notes
  - `Patterns/user-preferences.md` — distilled rules across runs
  - `00 - Index.md` — vault entry point
- **Existing template catalog (filesystem):** `scripts/templates/` (mirror of catalogs file)
- **Existing credential catalog (filesystem):** `scripts/connectors/builtin/` (mirror of catalogs file)

---

## Phase 0: Bootstrap Vault (one-time)

Check if `C:/Users/mkdol/Documents/Obsidian/personas/00 - Index.md` exists. If not, create the structure:

```
C:/Users/mkdol/Documents/Obsidian/personas/
  00 - Index.md
  Research/
  Lessons/
  Patterns/
    user-preferences.md
```

`00 - Index.md` content:
```markdown
# Personas Memory Vault

Long-term memory for the `/research` skill and other personas-related work.

## Folders
- [[Research/]] — one note per `/research` run, source + extracted ideas + triage decisions
- [[Lessons/]] — self-reflection notes from each `/research` run (what was rejected and why)
- [[Patterns/]] — distilled rules across runs ([[Patterns/user-preferences|user preferences]])

## Conventions
- Research notes: `YYYY-MM-DD-{slug}.md` with frontmatter (source, date, accepted, rejected)
- Lessons notes: `YYYY-MM-DD-research.md` — append-only, one block per run
- Patterns are upgraded from Lessons after a rule has been observed 3+ times
```

`Patterns/user-preferences.md` content:
```markdown
# User Preferences (distilled from /research runs)

> Rules upgraded from `Lessons/` after 3+ observations. Loaded by `/research` Phase 1.

_No patterns yet. Will be populated as runs accumulate._
```

---

## Phase 1: Load Context & Memory

### 1a. Determine which reference files to load

Based on the focus hint, load this set:

| Focus | Files loaded |
|---|---|
| `code` | `codebase-context.md` + `codebase-stack.md` |
| `templates` | `codebase-context.md` + `codebase-stack.md` + `codebase-catalogs.md` |
| `credentials` | `codebase-context.md` + `codebase-stack.md` + `codebase-catalogs.md` |
| `all` (default) | all three |

`codebase-context.md` and `codebase-stack.md` are **always required**. `codebase-catalogs.md` is only required when bucket B or C is in scope.

### 1b. Verify required files exist

For each required file under `.claude/`:
- If `codebase-context.md` is missing → stop, instruct to run `/refresh-context`
- If `codebase-stack.md` is missing → stop, ask user to regenerate it (it's hand-curated; suggest the user ask Claude to recreate it from `src-tauri/src/db/models/persona.rs`, `src-tauri/src/engine/provider/`, `package.json`, and `Cargo.toml`)
- If `codebase-catalogs.md` is missing AND focus needs it → stop, instruct to run `/refresh-context`

### 1c. Read and absorb the loaded files

Read each loaded file in full. These three files together describe:
- **codebase-context.md** — *where* code lives (8 groups, 34 contexts, file paths, keywords)
- **codebase-stack.md** — *how the engine works* (Claude Code CLI wrapping, persona schema, tech stack, conventions)
- **codebase-catalogs.md** — *what already exists* (92 templates, 87 connectors, coverage gaps)

The `codebase-stack.md` Section 2 ("Engine: Claude Code CLI Wrapping") is the **single most important fact** — personas literally spawns the `claude` binary as its LLM provider. Any idea about Claude Code CLI features (hooks, slash commands, MCP, settings, output styles, subagents, session resume) is **highly relevant** to this codebase, not out of scope.

### 1d. Check snapshot freshness

Parse the `<!-- snapshot-meta -->` footer in `codebase-context.md`. Compare:
- `git_commit_count` vs current `git rev-list --count HEAD`
- `generated_at` vs today

If commits have advanced by >200 OR snapshot is >30 days old, warn but continue:
```
Warning: codebase-context.md may be stale ({N} commits / {D} days since last refresh).
Consider running /refresh-context after this session.
```

Also check `codebase-catalogs.md` `Generated:` line if loaded; warn similarly if >30 days old (the catalogs change more frequently than the DB-derived feature map).

### 1e. Load memory

Read in order:
1. `C:/Users/mkdol/Documents/Obsidian/personas/Patterns/user-preferences.md`
2. The 3 most recent files in `C:/Users/mkdol/Documents/Obsidian/personas/Lessons/` (sorted by filename, descending)

These inform extraction priorities and what to deprioritize.

---

## Phase 2: Source Ingestion

Detect source type from the user's first answer:

### 2a. YouTube URL
Patterns: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`

Check `yt-dlp` is installed:
```bash
yt-dlp --version
```

If missing, abort with:
```
yt-dlp is not installed. Install it with one of:
  - winget install yt-dlp
  - pip install yt-dlp
  - Download from https://github.com/yt-dlp/yt-dlp/releases
Then re-run /research.
```

Otherwise, extract auto-generated subtitles:
```bash
mkdir -p .research-cache
yt-dlp \
  --skip-download \
  --write-auto-sub \
  --sub-lang en \
  --sub-format vtt \
  --output ".research-cache/%(id)s.%(ext)s" \
  "<url>"
```

Parse the resulting `.vtt` file:
- Strip WEBVTT header
- Strip cue settings and styling
- Collapse consecutive duplicate lines (auto-subs repeat heavily)
- Keep timestamps in `[HH:MM:SS]` format every ~30 seconds for citation

If no `.vtt` was produced (some videos have transcripts disabled), report the issue and ask the user to paste the transcript manually or provide an alternative source.

After parsing, delete the cache file. Keep only the cleaned text in working memory.

### 2b. Other URL
Use `WebFetch` with a prompt asking for the article body, stripped of nav/footer/ads.

### 2c. Raw text
Use as-is.

**Sanity check:** if the resulting text is <300 words, report it's too thin to harvest meaningful ideas and stop.

---

## Phase 3: Raw Idea Extraction

From the source text, extract 5-15 distinct ideas. Each idea must be:
- A concrete technique, pattern, tool, or recommendation (not opinions or filler)
- Grounded in a specific quote or timestamp from the source
- Standalone enough to be evaluated independently

For each idea, capture:
- `title` — short imperative phrase (<60 chars)
- `summary` — 1-2 sentences
- `source_anchor` — quote (≤20 words) or `[HH:MM:SS]` for video sources
- `tentative_bucket` — your initial guess: `code` / `template` / `credential` / `unclear`

Apply memory-informed filtering: if `Patterns/user-preferences.md` says "user rejects migration ideas" or similar, deprioritize matching ideas (still extract, but mark `low_priority: true`).

---

## Phase 4: Relevance Filter

For each idea, score relevance against `.claude/codebase-context.md`:

- **High** — keywords clearly match a context group's keywords/description; specific files/entry points are obvious anchors
- **Medium** — partial keyword overlap or description similarity, no clear file anchor
- **Low / drop** — no plausible attachment point in any context group

**Drop all `Low` ideas.** Don't waste user attention on out-of-scope material.

If the focus hint was `code` / `templates` / `credentials`, drop ideas that don't match the chosen bucket (after Phase 5 reclassification).

---

## Phase 5: Bucket Classification

Re-evaluate each surviving idea and assign a final bucket. An idea may belong to **multiple** buckets — that's fine, present it once but flag all applicable buckets.

### Bucket A — Code Improvement
The idea suggests a change to existing code in personas. Examples:
- "Add request retry with exponential backoff"
- "Memoize this expensive computation"
- "Use IntersectionObserver instead of scroll listeners"

Required output: target file(s) under `personas/`, function/component name if known, evidence the gap exists.

### Bucket B — New Persona Template
The idea describes a new agent workflow that fits the `add-template` schema. Indicators:
- Mentions external services orchestration
- Has clear trigger → action → notification flow
- Could replace a manual repetitive process

Required output: template name, services involved, primary trigger, similar templates already in `scripts/templates/` (and why this isn't a duplicate).

### Bucket C — New Credential
The idea references an external service whose connector isn't in `scripts/connectors/builtin/`. Indicators:
- A specific tool/SaaS named that personas doesn't yet integrate
- The integration would unlock template ideas in Bucket B

Required output: service name, auth type if known, why personas needs it.

If an idea is a `template + credential` combo (a new template that requires a not-yet-existing credential), present it once, flag both buckets, and note that the credential must be added first.

---

## Phase 6: Evidence Gathering

For each surviving idea, gather concrete evidence to make the user's triage easy. Budget your tool calls — don't go deeper than necessary.

### Code bucket

**Step 1 — Host infrastructure first.** Before searching for the specific feature, grep for the *category of host infrastructure* the idea would attach to. Examples:
- HTTP endpoint idea? `Grep "axum|HttpServer|Router::new"` to find existing HTTP server modules
- Background job idea? `Grep "tokio::spawn|JoinHandle|Worker"` to find existing job runners
- Auth/middleware idea? `Grep "middleware|tower_http|from_fn"` to find existing middleware patterns
- New table idea? `Grep "CREATE TABLE.*<related_concept>"` in `migrations.rs`
- New CLI flag idea? `Grep "binary_candidates\|build_cli_args"` in `engine/provider/`

This catches existing-but-undocumented surface area in one grep. **A single discovery here typically reframes 2-4 findings at once** — what looked like "build new infrastructure" becomes "add routes to existing router" / "add column to existing table". Reframing changes both effort estimates and file anchors, so do it before deeper greps.

**Step 2 — Then search for the specific feature.** Now grep for the actual thing the idea proposes (function name, env var, flag, table name).

**Step 3 — Read the anchor file.** `Read` the most relevant file(s) — limit to ~100 lines. Identify the exact `file_path:line_number` where the change would land.

**Step 4 — Drop if redundant.** If the gap doesn't actually exist (the codebase already does this), drop the idea.

**Security escalation rule:** When the Step 2 grep against a file that exposes an HTTP, IPC, webhook, or external surface returns **zero hits for auth-relevant patterns** (`api_key|Authorization|Bearer|require_auth|middleware`), do NOT drop the finding as "no existing pattern". Instead, **escalate it to severity `CRITICAL` and re-label it as a security gap, not a feature add.** Open HTTP/IPC surfaces are findings even when the user didn't ask about security — the source video may not even mention security, but the codebase reality does.

### Template bucket
- **First** scan `codebase-catalogs.md` Template Catalog section for duplicates (faster than filesystem)
- If a similar entry exists by id/scope/services, drop the idea — note "duplicate of {id}"
- If unsure, `Read` the closest existing template JSON (1 file max from `scripts/templates/{category}/{id}.json`) to confirm
- **Boost priority** if the idea's category is marked as **sparse** in `codebase-catalogs.md` Coverage Analysis section
- For ideas requiring connectors NOT in the catalog, mark them as **combo** (template + credential, credential first)

### Credential bucket
- **First** scan `codebase-catalogs.md` Connector Catalog section for the service name
- If found, drop the idea — note "already exists as {name}"
- If not found, **boost priority** if the connector category is sparse
- Also verify the auth type is supported (compare against the auth distribution in Coverage Analysis)

---

## Phase 7: Present Findings

Print a single summary table followed by numbered detail blocks. **Before printing, run cluster detection (below) so the user can see natural bundles instead of a flat list.**

### Cluster detection

Before presenting, scan the surviving findings for clusters that should ship together:

- **Same file anchor** — multiple findings touching the same file (e.g. all 4 land in `engine/management_api.rs`) usually want a shared PR. Note the cluster.
- **Dependency edges** — finding B mentions a field/table/module that finding A would create. Note `depends on [N]`.
- **Security pairing** — an auth finding paired with an exposure/visibility finding. Neither makes sense alone (auth without exposure flag = every key sees everything; exposure flag without auth = anyone reaches public stuff). Always present these as a forced pair.
- **Protocol pairing** — a protocol-shape endpoint paired with a self-describing metadata endpoint (the metadata endpoint is the prerequisite). Always present these as a natural pair.

For each cluster, add a one-line note to the relevant findings: `Cluster: ships with [N, M] — recommended order: M → N`. This makes the user's triage decision a cluster decision, not a per-row one.

### Summary table

```
#  Bucket       Title                                          Relevance  File / Service
─  ───────────  ─────────────────────────────────────────────  ─────────  ──────────────────
1  code         Add retry with backoff to API proxy            High       src-tauri/src/engine/api_proxy.rs
2  template     Daily standup digest from GitHub PRs           High       (new template)
3  credential   Add Linear connector                           Medium     (new credential)
4  code+tpl     Webhook deduplication via idempotency keys     High       src-tauri/src/.../webhooks.rs
...
```

### Per-idea detail

For each row:
```
[N] {title}
    Bucket(s):    {bucket(s)}
    Source:       "{quote}" or [HH:MM:SS]
    Summary:      {2-3 sentences}
    Evidence:     {file_path:line for code, similar templates for templates, etc.}
    Recommended:  {/add-template "..." | /add-credential "..." | edit {file}}
    Why it fits:  {which context group from snapshot it maps to}
```

---

## Phase 8: User Triage

Ask the user:
```
Which findings should I action? Reply with numbers (e.g., "1, 3, 4"),
"all", "none", or "ask" for a guided walkthrough.
```

For each accepted finding:

### Code bucket

**Do not auto-edit code** — the user will want to review the change. There are **three** routing options for code findings; pick based on the shape of what was accepted:

**Option A — Single isolated finding → Obsidian + optional todo**
For one or two unrelated code findings, write each into the Obsidian Research note (Phase 9) as a checked-but-not-implemented item with the exact `file_path:line`. Then ask: *"Should I open this as a todo via /gsd:add-todo?"* If yes, invoke that skill.

**Option B — Bundled cluster (3+ findings or any forced pair from Phase 7 cluster detection) → implementation plan handoff**
When multiple code findings cluster (same file, dependency edges, security pair, protocol pair), do NOT route them as individual todos — that loses the bundling story. Instead, ask the user:

```
These N findings cluster naturally (same file / shared migration / forced pair).
Options:
  (a) write one implementation plan handoff document for another CLI to execute
  (b) split into N individual /gsd:add-todo items
  (c) just record in the Obsidian Research note for now
```

If the user picks (a), write a self-contained handoff to `.planning/handoffs/{YYYY-MM-DD}-{slug}.md` with this structure:
- **Header** — date, source link, original triage decision, target repo path
- **Why this matters** — one-paragraph context (what problem, what infrastructure already exists)
- **Goal** — numbered list of the bundled findings as deliverables
- **Non-goals** — explicit "do NOT do these" list (deferred findings, scope creep traps, layers not to touch). This is the most important section — it prevents the implementing CLI from drifting.
- **Dependency graph & order** — which tasks ship together, which depend on which
- **Per-task spec** — for each task: file path & line anchor, schema/migration SQL, struct definitions, function signatures, error mapping, acceptance criteria
- **Cross-cutting concerns** — convention compliance (point at `.claude/CLAUDE.md` — auto-loaded by every Claude Code session in this repo, contains UI conventions including the typography contrast rule, state management, IPC patterns, and "what NOT to do"), security defaults (default to denial), backward compat constraints, tests to add. **If any task in the handoff touches frontend code (`src/**/*.tsx`), explicitly include a "Honor the typography contrast / muted-text antipattern rule from CLAUDE.md UI Conventions" line so the implementing CLI does not re-introduce muted body text.**
- **Final acceptance checklist** — manual smoke tests + negative paths
- **What to do if you get stuck** — explicit rule: prefer the more conservative option, leave a `TODO(handoff-{date})` comment, write follow-ups to a sibling file rather than expanding scope silently
- **Out of band** — the deferred findings, so the implementing CLI knows they're queued and won't accidentally implement them

The handoff plan must be **self-contained** — readable without the conversation that produced it. The implementing CLI will not have access to this skill's context.

Record the handoff path in the Research note frontmatter (`handoff: .planning/handoffs/{date}-{slug}.md`) and in the Phase 11 final summary.

**Option C — Just record, no further action**
For findings the user wants to think about, write them into the Research note only. No todo, no handoff. The Research note serves as a future search target.

### Template bucket
Auto-invoke `/add-template` with a pre-filled description derived from the finding's title + summary + recommended services. Pass the description as the first user message inside the skill so the user doesn't have to retype it.

### Credential bucket
Auto-invoke `/add-credential` with the service name pre-filled.

### Combo bucket
If both template + credential are flagged, run `/add-credential` first, then `/add-template`. Confirm with the user before chaining.

For each declined finding (in the user's reply or by omission), record the number for Phase 10.

---

## Phase 9: Persist to Obsidian Research Note

Write `C:/Users/mkdol/Documents/Obsidian/personas/Research/{YYYY-MM-DD}-{slug}.md`.

Where `{slug}` is derived from the source: video title, article title, or first 4 words of raw text. kebab-case, max 40 chars.

Frontmatter + body:
```markdown
---
date: 2026-04-07
source_type: youtube|article|text
source_url: <url or "pasted">
source_title: "<video/article title>"
focus: all|code|templates|credentials
total_extracted: 12
total_after_relevance: 7
accepted: [1, 3, 4]
declined: [2, 5, 6, 7]
buckets: { code: 4, template: 2, credential: 1 }
---

# {Source title}

**Source:** [{title}]({url})
**Run:** {timestamp}

## Summary
{2-3 sentence overview of what this source covered}

## Extracted Ideas

### [1] {title}  ✅ accepted → {action taken}
**Bucket:** code
**Source anchor:** "{quote}" / [HH:MM:SS]
**Evidence:** `src/foo/bar.ts:42`
**Notes:** {anything from triage}

### [2] {title}  ❌ declined
**Bucket:** template
**Source anchor:** ...
**Evidence:** ...
**Decline reason:** _to be filled in Phase 10_

...

## Cross-references
- Related patterns: [[Patterns/user-preferences]]
- Prior runs touching same area: {wikilinks to other Research notes if any}
```

---

## Phase 10: Self-Reflection (the learning loop)

This phase makes the skill smarter over time. Do not skip it.

### 10a. Ask why

For declined findings, ask the user **once**, in a single batched question:
```
Help me improve. For these declined items, why did you skip them?

  [2] {title}
  [5] {title}
  [6] {title}
  [7] {title}

You can answer per-item ("2: too vague, 5: already planned") or with a
single reason that covers all of them. Type "skip" to move on.
```

If the user types `skip`, jump to 10c.

### 10b. Append to Lessons

Write/append to `C:/Users/mkdol/Documents/Obsidian/personas/Lessons/{YYYY-MM-DD}-research.md`:
```markdown
## Run: {timestamp} — {source title}

Source: {url}
Accepted: [1, 3, 4]
Declined: [2, 5, 6, 7]

### Decline reasons
- [2] {reason}
- [5] {reason}
- [6] {reason}
- [7] {reason}

### Self-reflection
- What I extracted that resonated: {pattern}
- What I extracted that didn't: {pattern}
- Tools I should use more / less next time: {observation}
```

The "Self-reflection" block is your own assessment — not the user's — written as a brief note about what worked in this run vs. what didn't.

### 10c. Update Research note

Backfill the Research note from Phase 9 with the decline reasons.

### 10d. Pattern promotion check

Read all files in `Lessons/` and look for repeated decline reasons:
- If the same reason (or close synonym) has appeared in **3+** runs, propose adding it to `Patterns/user-preferences.md`.
- Show the proposed pattern to the user and ask: "I've seen this 3+ times — promote to permanent rule?"
- If yes, append to `Patterns/user-preferences.md` as a new bullet with date and source-run links.

---

## Phase 11: Final Summary

Print:
```
Research run complete.

  Source:       {title} ({source_type})
  Extracted:    {N} ideas
  After filter: {M} relevant
  Accepted:     {K} ({list})
  Declined:     {L} ({list})

  Actions taken:
    - /add-template invoked: {N} times ({names})
    - /add-credential invoked: {N} times ({names})
    - Implementation plan handoffs written: {N} ({paths})
    - /gsd:add-todo invoked: {N} times
    - Findings logged for later: {N} (in Obsidian Research note only)

  Files updated:
    + Obsidian/personas/Research/{date}-{slug}.md
    + Obsidian/personas/Lessons/{date}-research.md
    {if handoff plan written:}
    + .planning/handoffs/{date}-{slug}.md
    {if pattern promoted:}
    ~ Obsidian/personas/Patterns/user-preferences.md

  Snapshot freshness: {fresh | stale by N commits — consider /refresh-context}
```

---

## Phase 12: Roadmap / Release Log Update (optional)

After Phase 11's summary, offer to log accepted findings into the in-app
release notes ("What's New" view in the desktop app). This is what makes the
work visible to future-you and any other contributor opening the app.

**Skip the phase entirely** if zero findings were accepted in Phase 8 — there
is nothing to log.

### 12a. Read the release config

Read `src/data/releases.json`. Identify:
- `config.active` — the version that the in-app view opens by default
- the matching release object inside `config.releases`
- how many items it already contains

If the file is missing or unparseable, warn (`release log not found, skipping
Phase 12`) and stop. Do **not** create the file from scratch — its existence is
a project-level decision, not the skill's call.

### 12b. Ask the user

Print:
```
Add accepted findings to the release log?
Active release: {version}{ (label)} — currently {N} item(s).

Reply with numbers from the accepted list (e.g., "1, 3"), "all", or "none".
```

Use the **same numbering** as the Phase 7 summary table so the user does not
have to re-translate. Only accepted findings are eligible — declined ones are
implicitly excluded.

If the user replies `none` (or empty), skip to Phase 12d (still confirm).

### 12c. Append items

For each chosen finding, build a `ReleaseItem` object:

```json
{
  "id": "{version}-{auto-incremented-index}",
  "type": "{inferred type}",
  "title": "{finding title}",
  "description": "{1-2 sentences derived from finding summary}",
  "status": "completed",
  "added_at": "{today YYYY-MM-DD}",
  "source": "{handoff path | research note path | obsidian wikilink}"
}
```

**Type inference rules** (in order — first match wins):
1. Finding was escalated to severity `CRITICAL` by the Phase 6 security
   escalation rule → `"security"`
2. Finding's bucket is `code` AND title/summary clearly describes a bug fix
   (keywords: "fix", "bug", "regression", "incorrect", "leak") → `"fix"`
3. Finding introduces a backwards-incompatible change (keywords: "breaking",
   "remove", "rename", "drop column") → `"breaking"`
4. Finding adds documentation only → `"docs"`
5. Otherwise → `"feature"`

**Source field rules**:
- If a handoff was written in Phase 8 Option B → use the handoff path
  (`.planning/handoffs/{date}-{slug}.md`)
- Else if `/gsd:add-todo` was invoked → omit `source` (todos move; the
  Research note is the durable anchor)
- Else → use the Obsidian Research note path
  (`Obsidian/personas/Research/{date}-{slug}.md`)

**Item ID convention**: `{version}-{N}` where `N` is the next integer after
the highest existing `{version}-N` id in that release. If no existing items
match the pattern, start at `1`.

Append the new items to the **end** of `release.items` so they appear last
within their type group in the UI (the changelog view groups by type but
keeps within-type ordering stable).

### 12d. Write the file back

Write the updated JSON back to `src/data/releases.json`. Preserve:
- Two-space indentation
- Trailing newline
- Field ordering inside each item (`id, type, title, description, status,
  added_at, source`) for diff-friendliness

Confirm with a one-line print:
```
Release log updated: {N} item(s) added to {version}.
```

If the user replied `none`, print:
```
Release log unchanged.
```

### 12e. Add to the Phase 11 summary footer

Append a `Release log:` line to the existing Phase 11 printout (this means
Phase 12 must run before the user dismisses the summary, OR the summary must
be re-printed afterward — pick the latter so the summary stays canonical):

```
  Release log: {N} item(s) added to {version} | unchanged
```

---

## Error Handling

| Failure | Response |
|---|---|
| `.claude/codebase-context.md` missing | Stop. Tell user to run `/refresh-context`. |
| `yt-dlp` missing | Stop with install instructions. |
| YouTube has no auto-subs | Ask for manual transcript paste or alternate source. |
| `WebFetch` returns paywall / 403 | Ask user to paste the article text. |
| Source text <300 words | Report insufficient content. Stop. |
| Fewer than 2 ideas survive Phase 4 | Report "no relevant ideas found in this source for personas." Still write a stub Research note so the source isn't re-harvested. |
| Obsidian vault path missing | Run Phase 0 bootstrap, don't fail. |
| `/add-template` or `/add-credential` invocation fails | Report which one, save its description into the Research note as "deferred", continue. |
| `src/data/releases.json` missing or unparseable | Print `release log not found, skipping Phase 12` and stop the phase. Do NOT auto-create the file. |

---

## Safety Rules

- **Never auto-edit personas source code.** Code findings always go to the Research note for human review.
- **Never** invoke `/add-template` or `/add-credential` without explicit user acceptance in Phase 8.
- **Never** skip Phase 10 unless the user typed `skip` — the learning loop is the whole point.
- The Obsidian vault is the source of truth for memory between runs. Do not duplicate this data into other locations.
- **Phase 12 is the only place** the skill writes to `src/data/releases.json`. Never touch it from any other phase. Never write items the user did not explicitly accept in Phase 8 → Phase 12b.

---

## Skill Iteration Log

This section records *why* each non-obvious rule exists. When a rule looks redundant on a future read, check here before removing — the reason may still apply.

### 2026-04-08 — initial run on A2A Gateway video (run 1/5)

**Rules added:**
- **Phase 6 host-infrastructure-first ordering.** Discovered that the second-order grep (`axum|HttpServer` against the whole codebase) reframed 4 of 7 surviving findings from "build new infrastructure" to "add to existing router". Without that step, file anchors and effort estimates were wrong. Cost of the rule: one extra grep per run. Benefit: catches existing surface area before findings are presented.
- **Phase 6 security escalation rule.** A grep for `api_key|Authorization|Bearer` against `engine/management_api.rs` returned `No matches found` — and that *was the finding*. The video didn't mention security at all; the codebase reality made it the most important item. Without the escalation rule, the finding would have been dropped as "no existing pattern".
- **Phase 7 cluster detection.** All 4 accepted findings landed in the same file (`engine/management_api.rs`) with natural dependency edges. Presenting them as a flat numbered list lost the bundling story; the user had to manually re-cluster them. Now Phase 7 does it before printing.
- **Phase 8 Option B (implementation plan handoff).** When 3+ findings cluster, individual `/gsd:add-todo` items lose the dependency graph. The user explicitly asked for a self-contained handoff document instead. Pattern is: write to `.planning/handoffs/{date}-{slug}.md`, include non-goals as the most important section (prevents implementing CLI from drifting), record the path in the Research note frontmatter and Phase 11 summary.

**Rules considered but not added:**
- "Always grep for security patterns even when the source doesn't mention security" — too broad, would create noise on most runs. The escalation rule is narrower (only fires when the host is HTTP/IPC/external surface).
- "Auto-write handoff plans whenever clusters form" — too aggressive. Cluster *detection* is automatic; the routing decision (Option A/B/C) stays with the user.

**Open questions for future runs:**
- Does the bundling pattern hold across different source types? (this run was a tightly-scoped technical video — articles may extract more diffuse findings)
- Is the 30-second timestamp anchor frequency right? Could be denser for fast-paced videos
- Is loading all 3 reference files always worth the token cost? Focus-aware loading (Phase 1a) helps but only on user opt-in

### 2026-04-08 — release log integration (run 2/5)

**Rules added:**
- **Phase 12 (release log update).** After the A2A gateway run, the user shipped a "What's New" view backed by `src/data/releases.json`. The skill now offers to append accepted findings to the active release at the very end of the run, with type inferred from bucket + severity + keyword heuristics. The phase is **skipped entirely if zero findings were accepted** so it stays unobtrusive on dry runs.
- **Type inference order matters.** Security escalation > fix keywords > breaking change > docs > feature. The first match wins. This keeps a security-related code change from getting filed as a generic "feature" when it was the most important reframing of the run.
- **Source field convention.** Handoffs are first-class anchors; todos are not (they move). When neither exists, the Obsidian Research note path is the durable fallback. This means the "↪ source" line in the UI almost always points at something the user can re-open and read.
- **One-source-of-truth invariant.** `src/data/releases.json` is also the data source for the legacy roadmap timeline view, not a parallel store. Adding items only via Phase 12 (and never from any other phase) prevents the kind of skill-creep where two phases edit the same file with different conventions.

**Rules considered but not added:**
- "Auto-bump the version when filings cross some threshold." Out of scope — version bumps are a human decision tied to release cuts, not extraction volume.
- "Write to a separate `pending` bucket and have the user move items into a release later." Adds a workflow step the user has to remember. The active release IS the pending bucket.
