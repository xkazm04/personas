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

> **Source-type agnosticism confirmed.** Runs 1-5 used YouTube videos (Phase 2a); run 6 used a blog article (Phase 2b WebFetch). Both paths produced the same downstream shape — same frontmatter, same Phase 6 rules, same output formats. The skill is source-type agnostic; do not special-case downstream phases based on whether the source came from 2a, 2b, or 2c.

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

**Also check `Patterns/descoped-reopenable.md`** (if it exists) for findings that were previously descoped but may now be viable due to changed ecosystem conditions. If any apply to the current source, surface them explicitly in Phase 7 as "previously descoped, reconsider?" items alongside the new findings.

### Source-type yield calibration

Different source types produce different finding profiles. **A "low" finding count is not a failure mode if it matches the source type's expected yield.** Don't force extraction past the natural limit just to hit a number.

| Source type | Expected yield | Typical pattern |
|---|---|---|
| **Technical interview / engineering talk** | **densest** — 3-5 strong findings with concrete file anchors | Run 3 (Codex/Bolin): 3 accepted findings + 1 security escalation. Interviews with engineers on specific systems often reveal architectural critiques that map directly to codebase gaps. |
| **Feature walkthrough / dev-focused demo** | dense — 3-4 findings with mix of code + template ideas | Run 1 (A2A Gateway): 4 accepted findings. Run 2 (Everything is a CLI): 4 accepted findings. Demos that show a specific workflow tend to produce at least one clear architectural finding. |
| **Product demo / competitor walkthrough** | **low + many catches** — 1-3 real findings, 5-10 "already existed" catches | Run 4 (Paperclip): 2 findings, **8 already-existed catches**. Product demos of competing systems are high signal for the host-first rule because every feature demonstrated is potentially "does personas have this?". Expect the catch count to exceed the finding count. |
| **Philosophical / forward-looking article or video** | low — 1-2 findings, mostly discovery-brief territory | Run 5 (Karpathy LLM Wiki): 2 accepted findings + 7 already-existed (the skill's own prior iteration had already implemented the core insight). Philosophical sources often produce narrow deltas against existing implementations. |
| **Product launch article** | low-medium — 1-3 findings including at least one scaffolding-shaped finding | Run 6 (Claude Managed Agents): 2 findings, one of which became a theoretical scaffolding handoff (Option C). Launch articles frequently describe gated/preview features that fit Option C. |
| **Blog post / raw text** | varies widely | Phase 2b and 2c work the same as 2a downstream; the yield depends on content density, not transport. |

**If the finding count feels low, check the source type first.** If the source is a product demo and you have 7+ catches, that's a successful run, not a failed one. Surface the catch count prominently in Phase 7 as the primary metric for low-finding runs.

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

**Step 1b — Catalog vs runtime check.** Before scoring any finding about "tool surface", "prompt size", "connector count", or similar quantitative architectural critiques, verify the catalog count is NOT the same as the per-execution count. Personas examples:
- 87 connectors in the catalog ≠ 87 connectors in any execution. Each persona binds **0-3** connectors. Per-execution surface uses 0-3 as the denominator.
- 92 templates in the catalog ≠ 92 prompts the LLM sees. Each persona uses 1 template at most.
- N protocol blocks defined ≠ N injected per execution. Some are conditional on persona type, dev-tools mode, etc.

If the finding's premise depends on catalog count = runtime count, **the finding is wrong** — drop it or reframe before presenting. See `codebase-stack.md` Section 3 for the connector binding model.

**Step 1c — Framework vs plugin routing.** Before deciding the file anchor for a code finding, check whether it belongs in the **core engine** or in a **plugin**. Personas-the-framework is general-purpose; code/SDLC-specific features (worktree isolation, CLAUDE.md updates, repo scans, PR generation, build automation) belong in `src/features/plugins/dev-tools/` + `src-tauri/src/commands/infrastructure/dev_tools.rs`, NOT in the core engine. See `codebase-stack.md` Section 3, subsection "Personas framework vs `dev-tools` plugin". When in doubt: ask "would a non-coding persona benefit from this?" If no → plugin, not core.

**Step 2 — Then search for the specific feature.** Now grep for the actual thing the idea proposes (function name, env var, flag, table name).

**Step 3 — Read the anchor file.** `Read` the most relevant file(s) — limit to ~100 lines. Identify the exact `file_path:line_number` where the change would land. **For host-infrastructure verification, read enough to confirm the public API (~30 lines), not the implementation (~500 lines)** — token efficiency matters.

**Step 4 — Drop if redundant.** If the gap doesn't actually exist (the codebase already does this), drop the idea.

**Security escalation rule:** When a grep against a file that exposes an HTTP, IPC, webhook, or external surface — **OR** that spawns a privileged subprocess (e.g. with `--dangerously-skip-permissions`) — returns **zero hits for auth/sandbox patterns** (`api_key|Authorization|Bearer|require_auth|middleware|sandbox|seatbelt|seccomp|landlock`), do NOT drop the finding as "no existing pattern". Instead, **escalate it to severity `CRITICAL` and re-label it as a security gap, not a feature add.** Open HTTP/IPC surfaces and unsandboxed privileged spawn sites are findings even when the user didn't ask about security — the source may not even mention security, but the codebase reality does.

**i18n impact check:** When a code finding touches frontend files (`src/**/*.tsx`), note whether it introduces new user-facing strings. If yes, mark it with `i18n: required` in the finding output and add an effort note: "New UI strings must go through `src/i18n/en.ts` + `useTranslation()` — see CLAUDE.md → Internationalization." This ensures the implementing CLI knows about the i18n cost upfront, not as a surprise during Phase 8 handoff execution. For findings that add backend status tokens displayed in the UI, note that `tokenLabel()` from `src/i18n/tokenMaps.ts` must be used instead of raw token strings.

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

**Do not auto-edit code** — the user will want to review the change. Pick a routing option based on the shape of what was accepted.

**The handoff plan is the default for clustered code findings.** Across runs 1-6, the user picked a handoff plan in every run where 2+ findings had concrete file anchors. Do NOT ask "handoff vs todos vs record" as an open question — propose the handoff as the default and only offer alternatives if the findings are clearly single/unrelated (Option A) or the user explicitly asks to defer (Option D).

**Option A — Single isolated finding → Obsidian + optional todo**
For one unrelated code finding with a clear `file_path:line` anchor, write it into the Obsidian Research note (Phase 9) as a checked-but-not-implemented item. Then ask: *"Should I open this as a todo via /gsd:add-todo?"* If yes, invoke that skill. Do NOT use this for 2+ findings — see Option B.

**Option B — Implementation-ready handoff plan (DEFAULT for 2+ clustered code findings)**
Write a self-contained handoff to `.planning/handoffs/{YYYY-MM-DD}-{slug}.md`. This is the default output for accepted clustered findings — confirmed across 5 of 6 iteration runs. Structure:

- **Header** — date, source link, original triage decision, target repo path
- **Why this matters** — one-paragraph context (what problem, what infrastructure already exists)
- **Goal** — numbered list of the bundled findings as deliverables
- **Non-goals** — explicit "do NOT do these" list (deferred findings, scope creep traps, layers not to touch). This is the most important section — it prevents the implementing CLI from drifting.
- **Dependency graph & order** — which tasks ship together, which depend on which
- **Per-task spec** — for each task: file path & line anchor, schema/migration SQL, struct definitions, function signatures, error mapping, acceptance criteria
- **Cross-cutting concerns** — convention compliance (point at `.claude/CLAUDE.md`), security defaults (default to denial), backward compat constraints, tests to add. **If any task touches frontend code (`src/**/*.tsx`), explicitly include BOTH of these lines:**
  - "Honor the typography contrast / muted-text antipattern rule from CLAUDE.md UI Conventions."
  - "All user-facing strings MUST use the i18n system (`useTranslation()` hook, keys in `src/i18n/en.ts`). No hardcoded English in JSX, placeholder, title, or aria-label attributes. For backend status tokens, use `tokenLabel()` from `src/i18n/tokenMaps.ts`. For error messages, use `resolveErrorTranslated()` from `src/i18n/useTranslatedError.ts`. See CLAUDE.md → Internationalization for the full contract."
- **Final acceptance checklist** — manual smoke tests + negative paths
- **What to do if you get stuck** — explicit rule: prefer the more conservative option, leave a `TODO(handoff-{date})` comment, write follow-ups to a sibling file rather than expanding scope silently
- **Out of band** — the deferred findings, so the implementing CLI knows they're queued and won't accidentally implement them

The handoff plan must be **self-contained** — readable without the conversation that produced it. The implementing CLI will not have access to this skill's context.

Record the handoff path in the Research note frontmatter (`handoff: .planning/handoffs/{date}-{slug}.md`) and in the Phase 11 final summary.

**Option C — Theoretical scaffolding handoff (gated/preview/whitelist-dependent features)**
Same structure as Option B, BUT with a much stricter non-goals section. Use this when the accepted finding depends on an external dependency that isn't available yet: whitelist-gated APIs, preview products, unreleased SDKs, features behind a private beta.

Distinguishing characteristics vs. Option B:
- **Non-goals section explicitly forbids any real integration attempts.** Example phrasing: *"Do NOT make any HTTP calls to {external host}. Not in tests, not in examples, not in commented-out code."* and *"Do NOT hardcode endpoint URLs before the API is publicly documented."*
- **Implementation style is scaffolding only:** stub structs/traits, settings keys with no defaults, `Err(AppError::NotImplemented(...))` returns, variant added to enums with dispatch points returning NotImplemented. The compile passes; no runtime behavior is exercised.
- **Every stub point gets a `TODO({feature-name}-{reason})` marker** (e.g., `TODO(managed-agents-whitelist)`) so a future CLI session can grep for all the breadcrumbs and finish the work when access is granted.
- **Tests only cover the deterministic stub path** (assert `NotImplemented` is returned). No integration tests; no fixtures that imply real API shape.
- **Out-of-band section lists "what to do when access is granted"** as a concrete checklist: grep for the TODO marker, flesh out stub methods, add UI surface, update docs.
- **Small Cargo.toml / deps additions are allowed only if** the dependencies are already present for other reasons. Do NOT add new dependencies that only the stub would use.

When to pick Option C over B:
- The source mentions a product in public beta / research preview / whitelist gate
- The API spec isn't publicly documented
- Authentication credentials for the external system aren't available to the dev team
- The user explicitly says "prepare theoretically" or "scaffold for future"

Run 6 (2026-04-08, Claude Managed Agents) produced the first handoff in this shape. It's a real category — codify it.

**Option D — Just record, no further action (escape hatch only)**
For findings the user wants to think about without acting on yet, write them into the Research note only. No todo, no handoff. The Research note serves as a future search target. This is the escape hatch, not a default — prefer B or C for any finding concrete enough to have a file anchor.

**Discovery briefs — de-prioritized.**
Earlier iterations offered a "discovery brief" shape for findings that needed architectural analysis before implementation. Run 2 wrote one; run 3's candidate was descoped; run 6's candidate was converted into a theoretical-scaffolding handoff (Option C) instead. Pattern: users prefer concrete plans (even stubs) over pure analysis documents. **Do NOT propose a discovery brief as a first-class option.** If a finding seems to need one, first ask whether it can be expressed as Option C (scaffolding) — that captures the architectural intent in compilable code. Only write a discovery brief as a last resort when there's genuinely nothing code-shaped to scaffold (e.g. a pure product-direction question). If written, place at `.planning/research/{date}-{slug}.md`.

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

### 10e. codebase-stack.md update check

Did this run discover a **structural fact about the codebase** that future runs would need to know? Examples:
- A misreading the user corrected (e.g. catalog vs runtime distinction)
- A plugin or module the skill didn't know existed (e.g. a separate cloud client, a dev-tools plugin)
- An architectural boundary that determines where findings should be routed (e.g. framework vs plugin)
- A security model invariant that affects threat assessment

If yes, **edit `codebase-stack.md`** with the new fact. Tag the addition with the run date and source so the iteration log can reference it. The file is hand-curated and `/refresh-context` does NOT regenerate it — your edits are durable.

If no, skip this step.

This step exists because runs 2 and 3 both discovered structural facts the skill needed but didn't have. The pattern: a finding gets misframed, the user corrects, the correction is broader than just "this run was wrong" — it's a fact every future run needs to know. Capturing it in `codebase-stack.md` prevents the same misframe in run N+1.

### 10f. Descoped-but-reopenable tracking

For each finding that was descoped (not declined, not accepted — descoped because of an external blocker like a hard technical problem, a missing dependency, or an unavailable product), record it in `C:/Users/mkdol/Documents/Obsidian/personas/Patterns/descoped-reopenable.md`. This is a separate file from `Patterns/user-preferences.md` — user preferences are permanent rules; descoped-reopenable entries are conditional waits.

File format (create if missing):

```markdown
# Descoped-But-Reopenable Findings

Findings that were descoped due to an external blocker but may become viable
later when the blocker clears. Phase 3 of future runs reads this file and
surfaces any matching items as "previously descoped, reconsider?" candidates.

## Entries

### {YYYY-MM-DD} — {finding title}
- **Source run:** {research note wikilink, e.g. [[2026-04-08-paperclip-hire-agents]]}
- **Original descope reason:** {verbatim quote from the user or self-assessment}
- **Blocker:** {what needs to change for this to become viable}
- **Reconsider trigger:** {concrete signal to watch for — e.g. "Anthropic ships X feature", "personas adds Y capability", "OSS project Z hits 1.0"}
- **Related findings:** {wikilinks to any related Research notes}
```

**When to add an entry:** if during Phase 8 the user descopes a finding AND the decline reason names a specific external blocker (not "no business need" or "too niche" — those are permanent rejections). The trigger for adding an entry is a phrase like *"come back when..."*, *"we can't do this until..."*, *"the platform doesn't support this yet..."*, or a technical problem the user explicitly acknowledges as unsolved.

**When NOT to add:** descopes based on priority ("not now"), scope ("too big"), or permanent preference ("we don't like this pattern"). Those belong in Lessons or user-preferences.

**Example from run 4 / run 6:** Paperclip run 4 surfaced "maximizer mode" (run-until-done semantics) which was descoped because of the goal-verification problem. Run 6 (Claude Managed Agents) observed that Anthropic solved the same problem externally. A properly-tracked descoped-reopenable entry from run 4 would have flagged this in run 6's Phase 3 automatically. **Write the entry now even if the blocker never clears — the cost of an unused entry is small; the cost of missing a reopen opportunity is a silently-missed finding.**

**Cross-check on future runs (Phase 3):** when reading `descoped-reopenable.md`, check each entry's "Reconsider trigger" against the current source. If the source describes a solution to the blocker, surface the entry in Phase 7 as a revived candidate next to the new findings.

**Cleanup:** when a descoped-reopenable entry is eventually accepted and actioned in a future run, remove it from the file (or move it to a "resolved" section at the bottom with the run date and handoff path). Don't let the file grow indefinitely.

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

  Already existed:  {A} (caught by host-first rule — see list)
  Descoped-reopenable: {D} (tracked in Patterns/descoped-reopenable.md)

  Actions taken:
    - /add-template invoked: {N} times ({names})
    - /add-credential invoked: {N} times ({names})
    - Implementation plan handoffs written: {N} ({paths})
    - Theoretical scaffolding handoffs written: {N} ({paths})
    - /gsd:add-todo invoked: {N} times
    - Findings logged for later: {N} (in Obsidian Research note only)

  Already-existed catches:
    {for each catch, one line: "{candidate title} → already at {file:line}"}
    {if none: "none"}

  Files updated:
    + Obsidian/personas/Research/{date}-{slug}.md
    + Obsidian/personas/Lessons/{date}-research.md
    {if handoff plan written:}
    + .planning/handoffs/{date}-{slug}.md
    {if pattern promoted:}
    ~ Obsidian/personas/Patterns/user-preferences.md
    {if descoped-reopenable entry added:}
    ~ Obsidian/personas/Patterns/descoped-reopenable.md
    {if codebase-stack.md updated in Phase 10e:}
    ~ .claude/codebase-stack.md

  Source-type yield:  {expected vs actual for this source type — see Phase 3 calibration table}
  Snapshot freshness: {fresh | stale by N commits — consider /refresh-context}
  Commit: {filled in by Phase 13 — short SHA + subject, or skip reason}
```

**Surface `already_existed` prominently when the finding count is low.** A product demo run that extracts 2 findings + 8 catches is a high-yield run — frame it that way. Do not let the user read "only 2 findings" as a failure when the real output is "8 existing features confirmed + 2 real gaps found".

---

## Phase 12: Release Log Update ("What's New") — optional

After Phase 11's summary, offer to log accepted findings into the in-app
release notes ("What's New" view in the desktop app). This is what makes the
work visible to future-you, other contributors opening the app, and — most
importantly — **the actual users** of the desktop app, who will read these
strings as news, not engineering logs.

**Skip the phase entirely** if zero findings were accepted in Phase 8 —
there is nothing to log.

**Critical rule before you start writing anything:** the release log is
**user-facing news**, NOT an internal changelog. The voice rules in
`.claude/CLAUDE.md` → "UI Conventions → Internationalization → Voice for
user-facing copy" apply to every word you write here. If you find yourself
typing a file path, a Rust struct name, an env var, or a `.planning/handoffs/`
reference, you have already failed — go back and rewrite as impact + benefit.

### 12a. Read the release config

Read `src/data/releases.json`. Identify:
- `config.active` — the version that the in-app view opens by default
- the matching release object inside `config.releases`
- how many items it already contains
- the highest existing item id in that release (for ID generation)

If the file is missing or unparseable, warn (`release log not found, skipping
Phase 12`) and stop. Do **not** create the file from scratch — its existence
is a project-level decision, not the skill's call.

### 12b. Locate the i18n folder

Read the directory listing of `src/features/home/components/releases/i18n/`.
There should be exactly 14 locale files (`en.ts, cs.ts, de.ts, es.ts, fr.ts,
ja.ts, ko.ts, zh.ts, ar.ts, hi.ts, ru.ts, id.ts, bn.ts, vi.ts`) plus
`useReleasesTranslation.ts`. Read `en.ts` to learn the namespace shape — the
items live under `whatsNew.releases.{version}.items.{itemId}` with `title`
and `description` keys.

If any locale file is missing, warn loudly:
```
Locale file {lang}.ts is missing — refusing to write a partial set.
The "What's New" view loads via direct property access; missing keys crash
the UI. Restore the file or skip Phase 12.
```

### 12c. Ask the user

Print:
```
Add accepted findings to the release log?
Active release: {version} — currently {N} item(s).

Reply with numbers from the accepted list (e.g., "1, 3"), "all", or "none".
```

Use the **same numbering** as the Phase 7 summary table so the user does not
have to re-translate. Only accepted findings are eligible — declined ones are
implicitly excluded.

If the user replies `none` (or empty), skip to Phase 12g (still confirm
"unchanged" in the summary).

### 12d. Build structural items for `releases.json`

For each chosen finding, build the structural metadata only:

```json
{
  "id": "{next-numeric-id}",
  "type": "{inferred type}",
  "status": "completed",
  "added_at": "{today YYYY-MM-DD}"
}
```

**No `title`, `description`, `summary`, `label`, or `source` fields.** Those
are user-facing strings that live in the i18n locale files, not in JSON. The
JSON is structural metadata only — versions, types, statuses, dates, ids.

**Type inference rules** (in order — first match wins):
1. Finding was escalated to severity `CRITICAL` by the Phase 6 security
   escalation rule → `"security"`
2. Finding's bucket is `code` AND title/summary clearly describes a bug fix
   (keywords: "fix", "bug", "regression", "incorrect", "leak") → `"fix"`
3. Finding introduces a backwards-incompatible change (keywords: "breaking",
   "remove", "rename", "drop column") → `"breaking"`
4. Finding adds documentation only → `"docs"`
5. Otherwise → `"feature"`

**Item ID convention**: simple incrementing strings — find the highest
existing numeric id in `release.items` (`"1", "2", "3", ...`) and increment.
If no items exist yet, start at `"1"`. The id is what links the JSON
structural entry to its i18n content.

Append the new items to the **end** of `release.items` so they appear last
within their type group in the UI (the changelog view groups by type but
keeps within-type ordering stable).

### 12e. Build user-facing content for the i18n files

For each chosen finding, draft a `{ title, description }` pair in **English**
following the user-facing-news voice:

- **Title (≤ 8 words):** lead with the user benefit. Imperative or noun
  phrase, NOT a technical summary. Examples:
  - ❌ "Add Bearer token middleware to /api routes"
  - ✅ "Safer access for the desktop app"
  - ❌ "Implement A2A JSON-RPC handler"
  - ✅ "Open your agents to other AI tools"
- **Description (1-3 short sentences):** explain what the user can now do
  and why they would care. NO file paths, NO module names, NO version-bump
  details, NO `.planning/handoffs/` references, NO Rust/TS jargon. Examples:
  - ❌ "Adds external_api_keys table, Bearer token middleware on the
       management HTTP API, gateway_exposure column on personas..."
  - ✅ "Personas can now talk to other AI tools through a shared protocol.
       Pick exactly which agents you want to share, and protect them with
       access keys you control — your private agents stay private by
       default."

**The translation test:** read your draft and ask "would a non-developer
who has never seen the codebase understand this and care about it?". If the
answer is no, rewrite.

### 12f. Write content to ALL 14 locale files

This is the i18n contract from `.claude/CLAUDE.md`: every key in `en.ts`
must exist in every other locale file. Skipping any file breaks the UI for
that language at runtime.

For each new item, for each of the 14 locale files:

1. Read the file.
2. Locate the `whatsNew.releases.{version}.items` object. (If the release
   itself is new, you also need to add `releases.{version}` with `label`,
   `summary`, and an empty `items` object. Use the version string as the
   default label, and a one-line summary.)
3. Append the new item id with the English `title` + `description` pair you
   drafted in 12e.
4. For non-English locale files, ALSO ensure the file has a top-of-file
   `// TODO(i18n-{lang}): translate from English placeholders` marker. If
   the marker is already there, leave it. If it's missing, add it.
5. Write the file back, preserving 2-space indentation and the existing
   field ordering.

**Do not attempt to translate the strings yourself.** Write English
everywhere. The TODO marker is the signal that human translation is pending.

**Validate before writing:** after building the new content for all 14
files in memory, double-check that:
- Every file gets the same set of new keys
- The id exists in `releases.json` AND in every locale file's items map
- No locale file has been skipped

### 12g. Write the JSON back

Write the updated `releases.json` with:
- Two-space indentation
- Trailing newline
- Field ordering inside each item (`id, type, status, priority, sort_order,
  added_at`) for diff-friendliness

### 12h. Confirm

Confirm with a one-line print:
```
Release log updated: {N} item(s) added to {version}.
  - releases.json (structural)
  - {14} locale files (English content + TODO markers preserved)
```

If the user replied `none`, print:
```
Release log unchanged.
```

### 12i. Add to the Phase 11 summary footer

Append a `Release log:` line to the existing Phase 11 printout (re-print
the summary so it stays canonical):

```
  Release log: {N} item(s) added to {version} (en + 13 locale placeholders)
                | unchanged
```

---

## Phase 13: Atomic Commit (MANDATORY — prevents merge loss)

**Why this phase exists**: On 2026-04-11, a merge without recovery options wiped out an entire research session's worth of code — Task Runner depth presets, DevProject monitoring fields, event registry entries, TaskOutputPanel markdown toggle, and more. The fixes had to be manually recreated from the conversation transcript because no commit had captured them. **Never again.** Each research run commits its own output at the end, so git is the recovery mechanism when anything else fails.

This phase runs at the very end of a research session after Phases 10–12 have completed. It is **non-negotiable** except in the two explicit skip conditions below.

### 13a. Determine if there are changes to commit

Run `git status --porcelain` to see uncommitted changes. If the output is **empty**, skip Phase 13 entirely and print `No changes to commit.` in the final summary. This covers the "accepted: none" branch where nothing was actioned.

### 13b. Review what will be committed

Run `git status` and `git diff --stat` to see the full set of changes. The user will see this output as part of the skill flow. **Look for unexpected files** — anything outside the expected scope should raise a warning:

- **Expected scope for a research run:**
  - Any files touched by accepted Phase 8 findings (if the user chose Option B/C and the implementation already happened in the same session, or if the user told the skill to "implement right away")
  - `.planning/handoffs/{date}-{slug}.md` (if a handoff was written)
  - `src/data/releases.json` + all 14 locale files under `src/features/home/components/releases/i18n/` (if Phase 12 ran)
  - The Obsidian vault is **outside the repo**, so it should NOT appear in git status
- **Unexpected files that warrant a pause:**
  - Files under `node_modules/`, `target/`, `.vite/`, build artifacts
  - `.env`, `credentials.json`, anything that looks like secrets
  - Files from feature areas completely unrelated to any accepted finding (suggests stale edits from a different session)

If unexpected files are present, **print them to the user and ask** whether to include them in the commit or leave them uncommitted. Don't auto-include anything suspicious.

### 13c. Stage only the in-scope files

Use **explicit `git add <path>` per file**, NOT `git add -A` or `git add .`. This avoids accidentally staging secrets or unrelated drift. Build the file list from:

1. The handoff path (if Phase 8 Option B/C ran)
2. The files edited by an in-session implementation (if the user said "implement right away")
3. `src/data/releases.json` + all 14 locale files (if Phase 12 ran)
4. Any new files created during the run (`sub_*/` directories, new Rust modules, new i18n keys)

### 13d. Write the commit message

Use this exact template via HEREDOC so multi-line formatting is preserved:

```bash
git commit -m "$(cat <<'EOF'
research: {short-title-of-source}

Source: {url-or-pasted}
Accepted: {N} finding(s) ({comma-separated-titles})

{optional 1-2 line summary of what was implemented or handed off}

{if handoff written:}
Handoff: .planning/handoffs/{date}-{slug}.md

{if /add-template or /add-credential ran:}
Catalog: /add-template {names} | /add-credential {names}

{if Phase 12 ran:}
Release log: {N} item(s) added to {version}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rules for the commit message:**
- First line prefix **must be `research:`** — this identifies research-run commits in `git log` and makes them easy to filter
- Short title = the source video/article title trimmed to ≤50 chars, lowercased
- **Never include file paths** in the commit body — those are in `git diff`; the message is about *why*
- **Never use `--no-verify`** — let pre-commit hooks run. If a hook fails, fix the issue, re-stage, and create a NEW commit (never `--amend`)
- **Never skip signing** — the Co-Authored-By line is required

### 13e. Handle commit failure

If the commit fails (pre-commit hook rejection, lint errors introduced by an in-session implementation, etc.):

1. Print the failure reason to the user
2. Do NOT retry with `--no-verify`
3. If the failure is fixable (e.g., TypeScript error in a file the skill wrote), **fix it inline** and create a new commit with the same message
4. If the failure is NOT fixable in the current session (e.g., hook requires manual intervention), print:
   ```
   ⚠️ Commit failed. Changes are staged but NOT committed.
   Research outputs are safe in Obsidian vault, but code changes
   are vulnerable to merge loss until you commit manually.
   Run: git commit --message "research: <title>"
   ```
5. Still write the Research note — never sacrifice the learning loop because of a commit failure

### 13f. Skip conditions

Phase 13 has exactly **two** skip conditions. Everything else is non-negotiable.

**Skip 1 — No changes:** Phase 13a found an empty `git status --porcelain`. Nothing to commit. Print `No changes to commit.` and move on.

**Skip 2 — User explicitly opts out:** The user typed one of `--no-commit`, `no commit`, or `skip commit` in the original `/research` invocation OR as a response to Phase 8 triage. In this case, print:
```
⚠️ Skipping commit per user request.
Changes are uncommitted and vulnerable to merge loss until you commit manually.
```

**NOT a skip condition:** "I'll commit manually later." Do not take the user's word for this — the whole point of Phase 13 is to make the commit happen in-session before context is lost. If the user expresses this preference, gently remind them that "later" turned into "lost work" on 2026-04-11, and ask again whether to commit now.

### 13g. Update the Phase 11 summary

Append a `Commit:` line to the final printout (re-print the summary so it stays canonical):

```
  Commit: {short-sha} — research: {short-title}
           | skipped (no changes)
           | skipped (user opted out)
           | ⚠️ commit failed — see above
```

This gives the user one line to verify the whole run is safely captured in git before they close the session.

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
| Phase 13 commit fails (pre-commit hook, lint, etc.) | Try to fix inline and re-commit. If unfixable, print the warning from Phase 13e and leave changes staged. Never use `--no-verify`. |
| Phase 13 detects unexpected files in `git status` | Ask the user before staging. Never auto-include suspicious paths (`node_modules/`, `.env`, `target/`, etc.). |

---

## Safety Rules

- **Never auto-edit personas source code.** Code findings always go to the Research note for human review.
- **Never** invoke `/add-template` or `/add-credential` without explicit user acceptance in Phase 8.
- **Never** skip Phase 10 unless the user typed `skip` — the learning loop is the whole point.
- The Obsidian vault is the source of truth for memory between runs. Do not duplicate this data into other locations.
- **Phase 12 is the only place** the skill writes to `src/data/releases.json` AND to any file under `src/features/home/components/releases/i18n/`. Never touch them from any other phase. Never write items the user did not explicitly accept in Phase 8 → Phase 12c.
- **Never write English directly into a `.tsx` literal** anywhere in the codebase. Per `.claude/CLAUDE.md` → Internationalization, every user-facing string lands in all 14 locale files. If a Phase 8 handoff plan would touch frontend code, the "Cross-cutting concerns" section MUST instruct the implementing CLI to follow the i18n contract (English first, then placeholders + TODO markers in the other 13).
- **Never put technical jargon in user-facing copy.** Release notes are news, not engineering logs. Voice rules in CLAUDE.md → "UI Conventions → Internationalization → Voice for user-facing copy". Apply them in Phase 12e *before* writing anything.
- **Phase 13 is mandatory.** Every research run ends with a commit unless there are no changes OR the user explicitly opted out. "I'll commit manually later" is not a valid skip reason — on 2026-04-11 "later" became "lost work from a bad merge". Git is the recovery mechanism.
- **Phase 13 stages files explicitly.** Never `git add -A` / `git add .` — always `git add <path>` per file to avoid sweeping up secrets or drift from other sessions.
- **Phase 13 never bypasses hooks.** No `--no-verify`, no `--no-gpg-sign`. If a pre-commit hook fails, fix the underlying issue and create a new commit.

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

### 2026-04-08 — runs 2 and 3 batch update (after Codex/Bolin video)

**Rules added (Phase 6):**
- **Step 1b — Catalog vs runtime check.** Before scoring any "tool surface" / "prompt size" / "connector count" finding, verify catalog count ≠ runtime count. Personas has 87 connectors in the catalog but each persona binds only 0-3. Got bitten by this in run 3 when I built an architectural critique on the wrong denominator. The rule prevents future runs from making the same mistake.
- **Step 1c — Framework vs plugin routing.** Before deciding the file anchor for a code finding, check whether it belongs in core engine or in a plugin. Personas-the-framework is general-purpose; SDLC features go in `dev-tools` plugin. Misrouted findings [3] and [4] in run 3 — the user corrected by pointing me to `src/features/plugins/dev-tools/`.
- **Step 3 efficiency note** — when verifying host infrastructure, read 30 lines (struct + public API), not 500 lines (full implementation). I read 481 lines of `desktop_discovery.rs` in run 2 to confirm it existed; could have read 30.
- **Security escalation rule expanded** — now also covers "spawn site for privileged subprocess with no sandbox", not just "HTTP/IPC surface with no auth". Both follow the same pattern: privileged surface + missing standard defense → CRITICAL severity. Run 3's `--dangerously-skip-permissions` finding fit the new shape.

**Rules added (Phase 10):**
- **Step 10e — codebase-stack.md update check.** After each run, ask: did this run discover a structural fact about the codebase that future runs would need? If yes, edit `codebase-stack.md`. Runs 2 and 3 both discovered such facts (run 2: cloud client/runner exists; run 3: catalog vs runtime + framework vs plugin) — capturing them in the file prevents the same misframe in future runs. The file is hand-curated and `/refresh-context` does NOT regenerate it, so edits are durable.

**Rules considered but not added:**
- "Auto-write handoff plan when 3+ findings cluster with file anchors" — three runs in a row produced handoff plans, so the pattern is established, but I'm not making it the silent default yet. The user's choice between Option A/B/C is part of the value of Phase 8 — automating it would remove the user's ability to say "actually, don't bundle this run". Leaving as user-choice.
- "Always grep for security patterns proactively" — too broad; would create noise. The escalation rule is narrow and targeted (only fires on privileged surfaces with missing standard defenses).

**Open questions for future runs:**
- Pattern observation: 3 runs, 3 handoff plans. Run 4 will test whether this is a pattern or just selection bias from picking dense technical videos.
- Two runs in a row needed `codebase-stack.md` updates. Is this a 1-2 runs-of-update phenomenon, or is the file going to keep accumulating corrections indefinitely?
- The discovery brief format (run 2 [4], run 3 [5] originally) is being descoped consistently. Either the user doesn't want them, or I'm proposing them at the wrong moments. Watch this in runs 4 and 5.

### 2026-04-08 — release log content is news, not a changelog (run 3/5)

**Rules added (Phase 12 rewrite):**
- **The release log is user-facing news.** First version of Phase 12 wrote technical descriptions ("Adds external_api_keys table, Bearer token middleware...") and source pointers (`.planning/handoffs/2026-04-08-...`) into the release log. The user opened the app, saw an internal changelog, and rejected the entire framing: "this is now designed as internal log, we should rather redesign into user-facing news. Planning file reference is not valid then, language should rather present impact and benefit then technical resolution." Phase 12e now has explicit voice rules + the "translation test" (would a non-developer who has never seen the codebase understand and care?), and Phase 12d explicitly drops the `source` field from the structural item.
- **i18n is non-negotiable.** Phase 12 used to write to `releases.json` only with English `title`/`description` fields baked in. That broke the project's i18n contract — every user-facing string must live in all 14 locale files. Phase 12 now writes to BOTH `releases.json` (structural metadata: id/type/status/dates) AND every locale file under `src/features/home/components/releases/i18n/` (English content + TODO markers in the 13 non-English files). Skipping any locale file crashes the UI at runtime because the `useReleasesTranslation` hook does direct property access.
- **Phase 12b (locate i18n folder) is a precondition.** Before writing anything, the skill verifies all 14 locale files exist. Missing files are a hard stop, not a "best effort" — refusing to ship a partial set is safer than corrupting the structure.
- **Voice rules live in CLAUDE.md, referenced from skill.md.** The actual voice rules ("lead with impact, no file paths, no jargon, one idea per item, translation test") live in `.claude/CLAUDE.md` → "UI Conventions → Internationalization → Voice for user-facing copy". Phase 12 references them rather than duplicating, so all code-touching skills (handoff executors, /add-template, /add-credential, ad-hoc edits) get the same rule from the same place.

**Rules considered but not added:**
- "Auto-translate the strings into all 14 languages." Too risky — translation quality matters and an LLM-generated French changelog would embarrass the project. Phase 12 writes English everywhere with TODO markers; humans translate later.
- "Skip locale files for languages the project hasn't shipped translations for." That's the trap that breaks i18n contracts in every project. Either every key is in every file, or the system is broken in subtle ways for some users.

### 2026-04-08 — release log integration (run 2/5)

**Rules added:**
- **Phase 12 (release log update).** After the A2A gateway run, the user shipped a "What's New" view backed by `src/data/releases.json`. The skill now offers to append accepted findings to the active release at the very end of the run, with type inferred from bucket + severity + keyword heuristics. The phase is **skipped entirely if zero findings were accepted** so it stays unobtrusive on dry runs.
- **Type inference order matters.** Security escalation > fix keywords > breaking change > docs > feature. The first match wins. This keeps a security-related code change from getting filed as a generic "feature" when it was the most important reframing of the run.
- **Source field convention.** Handoffs are first-class anchors; todos are not (they move). When neither exists, the Obsidian Research note path is the durable fallback. This means the "↪ source" line in the UI almost always points at something the user can re-open and read.
- **One-source-of-truth invariant.** `src/data/releases.json` is also the data source for the legacy roadmap timeline view, not a parallel store. Adding items only via Phase 12 (and never from any other phase) prevents the kind of skill-creep where two phases edit the same file with different conventions.

**Rules considered but not added:**
- "Auto-bump the version when filings cross some threshold." Out of scope — version bumps are a human decision tied to release cuts, not extraction volume.
- "Write to a separate `pending` bucket and have the user move items into a release later." Adds a workflow step the user has to remember. The active release IS the pending bucket.

### 2026-04-08 — post-session batch update (follow-ups from runs 1-6)

After the 6-run iteration session completed, six follow-up topics accumulated as "queued for later". This entry is the batch that applied them. Each one was observed across multiple runs before being codified.

**Rules added:**

- **Phase 8 Option B is now the DEFAULT for 2+ clustered code findings.** Across runs 1-6, the user picked a handoff plan in every single run that produced 2+ findings with file anchors. The old "three options, ask the user to pick" framing added friction without value. The skill now proposes the handoff as the default and only offers alternatives (A for single finding, D for pure defer) when the shape is clearly different. Run-5-style direct implementation is still a user override, not a Phase 8 option — it's what happens when the user tells the skill to implement instead of plan.

- **Phase 8 Option C — theoretical scaffolding handoff.** Run 6 (Claude Managed Agents launch) produced the first handoff where the feature was behind a whitelist gate and no real integration was possible. The shape is distinct enough from a regular handoff to warrant its own name: stub provider + reserved settings keys + `TODO({feature-name}-{reason})` breadcrumbs + strict non-goals forbidding any real HTTP calls. Picked when the source describes a product in public beta / research preview / whitelist gate / un-documented API. The existence of this option prevents the discovery-brief fallback for architectural findings that DO have a compilable stub.

- **Discovery briefs demoted.** Only 1 of 3 attempted discovery briefs across runs 1-6 survived (run 2's cloud-headless-personas). Runs 3 and 6 each had a candidate; run 3 was descoped entirely, run 6 was converted to Option C. Pattern: users prefer concrete plans (even stubs) over pure analysis documents. The skill now explicitly does NOT propose discovery briefs as a first-class option — only as a last-resort escape hatch when nothing code-shaped exists to scaffold. Run 1-2's baseline "discovery brief is a first-class Phase 8 option" was the wrong framing.

- **Phase 2b agnosticism note.** Run 6 was the first article source (blog post via WebFetch); runs 1-5 were all YouTube. Both paths produced identical downstream shapes — same frontmatter, same rules, same outputs. Added a short note in Phase 2 confirming this so future runs don't waste energy worrying about source-type branches in downstream phases.

- **Phase 3 source-type yield calibration table.** Added after observing that run 4's 2 findings / 8 catches felt low when it was actually a high-signal product-demo run. The calibration table maps source type → expected yield profile so a future run can self-assess whether "only 2 findings" is failure or expected behavior. Five source types documented from runs 1-6: technical interview (densest), feature walkthrough (dense), product demo (low + many catches), philosophical article (low, mostly deltas), product launch (low-medium, scaffolding-shaped). When the count feels low, check the type first.

- **Phase 10f — descoped-but-reopenable tracking in `Patterns/descoped-reopenable.md`.** Run 4's "maximizer mode" was descoped because of the hard goal-verification problem. Run 6 discovered Anthropic solved the same problem externally. A properly-tracked descoped-reopenable entry from run 4 would have flagged this in run 6's Phase 3 automatically. The new Phase 10f adds entries when a user descopes a finding with a specific external blocker (not "no business need" or "too niche" — those are permanent rejections). Phase 3 reads this file and surfaces revived candidates. The file is separate from `user-preferences.md` because these are conditional waits, not permanent rules.

- **Phase 11 — `already_existed` count surfaced in the printed summary.** Previously tracked only in Research note frontmatter from run 4 onward. Now surfaced as a first-class line in the printed final summary, with a per-catch list. Also added a "surface this prominently when the finding count is low" reminder — a 2-findings / 8-catches run should be framed as high-yield, not low.

- **Phase 11 — `descoped-reopenable` count surfaced.** Parallel to `already_existed`. Tracks how much potential work is parked against external blockers.

- **Phase 11 — `source-type yield` line.** Tells the user whether the run's output matches the expected profile for the source type. Prevents "this run felt low" reactions when the run was actually performing correctly.

**Rules considered but not added:**

- "Auto-write a handoff plan without asking the user." Too aggressive. Cluster detection is automatic; the final Phase 8 decision still belongs to the user. The change is defaulting toward B, not bypassing user consent.
- "Run Phase 3's descoped-reopenable cross-check automatically on every run without surfacing it." Defeats the purpose — the whole point is for the user to see when a previously-blocked finding is now viable. It stays visible in Phase 7 output.
- "Add fuzzy matching for descoped-reopenable 'reconsider triggers'." Out of scope for v1. Exact-substring match on the trigger phrase is enough until there's a real miss to justify complexity.
- "Demote Phase 12 (release log) similarly to discovery briefs." Phase 12 has different dynamics — it's a terminal write, not a mid-run routing decision. It stays.

**Open questions for future runs:**

- The Phase 3 yield calibration table was written after 6 runs of data. Does it generalize to run 7+? If a run produces a source type not in the table, the skill should extend the table rather than force-fit.
- Phase 10f tracks descoped-reopenable entries but doesn't delete them when blockers clear. The "cleanup" rule exists but has never run in practice. Watch for file growth over time.
- The "handoff as default" change means the user sees fewer Phase 8 choices. If that feels prescriptive on a specific run, the user can still override — but if overrides happen frequently, the default may be wrong. Track override rate across the next few runs.
- Option C (theoretical scaffolding) has only been used once (run 6). Whether the strict non-goals section holds up in practice — or if implementing CLIs drift into real HTTP anyway — is unknown until a second scaffolding handoff exists.

### 2026-04-11 — i18n infrastructure integration (post vibeman run #3)

**Context:** vibeman run #3 built the i18n infrastructure for the personas project — deep merge, token maps, error registry bridge, ESLint rule, locale parity script. CLAUDE.md now has a comprehensive Internationalization section. The research skill needed to be updated so handoff plans that touch frontend code carry the i18n contract forward to implementing CLIs.

**Rules added:**

- **Phase 6 — i18n impact check.** When a code finding touches frontend files (`src/**/*.tsx`), note whether it introduces new user-facing strings. If yes, mark `i18n: required` and add an effort note. For backend status tokens, note that `tokenLabel()` must be used. This catches the i18n cost at evidence-gathering time, not as a surprise during handoff execution. The safety rule at line 843 already covered the "never write English directly" prohibition, but the Phase 6 check surfaces the requirement earlier — at the finding level, before triage.

- **Phase 8 Option B cross-cutting concerns — explicit i18n bullet.** The typography contrast bullet existed; now an i18n bullet is mandatory alongside it for any handoff that touches `src/**/*.tsx`. References the specific tools: `useTranslation()` for UI strings, `tokenLabel()` for backend tokens, `resolveErrorTranslated()` for errors. Points to CLAUDE.md → Internationalization for the full contract.

**Why both rules matter together:** the Phase 6 check tells the user "this finding has i18n cost" at triage time, which affects effort estimates and priority. The Phase 8 cross-cutting concern tells the implementing CLI "here's how to honor i18n" at execution time. Without Phase 6, the user may accept a finding not realizing it requires en.ts changes. Without Phase 8, the implementing CLI may write hardcoded English despite the ESLint warning.

**Rules NOT added:**
- "Force all findings that touch .tsx to include i18n migration of existing hardcoded strings in the same file." Too aggressive — that's a separate goal (i18n Phase 2-8 migration), not a research skill concern. The research skill only ensures NEW strings from its findings go through i18n, not that existing strings in the same file get migrated.
- "Add i18n effort as a multiplier to the relevance score." The i18n cost is ~5 minutes per finding (add key to en.ts, use t.section.key in component) — not enough to change a relevance score.

### 2026-04-11 — Phase 13 atomic commit (post merge-loss incident)

**Context:** A bad merge on 2026-04-11 wiped out multiple research sessions' worth of code — Task Runner depth presets, DevProject monitoring fields, event registry entries, TaskOutputPanel markdown toggle, command name registrations, store slice signatures, API wrappers. None of it was committed. The Rust models still had their old struct shapes, the frontend bindings had reverted to pre-run forms, and the migration file still contained the ALTER TABLE statements — a classic broken-state drift. Recovery took ~30 minutes of manual re-typing from the conversation transcript.

**Root cause:** The research skill ended after Phase 12 (or Phase 11 if Phase 12 skipped) with no commit step. "Just commit manually later" was the implicit default. The Obsidian vault persisted the Research/Lessons notes (so the *learning* was intact), but the code changes from `implement right away` runs and handoff plans had no git anchor. A subsequent merge reconciliation dropped them silently.

**Rule added: Phase 13 — Atomic Commit (mandatory).**

Every research run now ends with an explicit commit step. The design choices:

- **Explicit file staging (`git add <path>`), not `git add -A`.** Avoids sweeping up secrets, build artifacts, or drift from concurrent sessions. The skill builds the file list from known outputs (handoff path, in-session edits, release log files).
- **`research:` commit prefix.** Makes research-run commits filterable via `git log --grep="^research:"`. Useful for forensics and for the `/gsd:pr-branch` skill to detect research commits when building PR branches.
- **Commit body explains *why*, not *what*.** The file list is in `git diff`; the message records source URL, accepted findings, handoff path, and catalog invocations. This is what's valuable in `git log` a month later.
- **No `--no-verify`, no `--amend`.** Hooks run, and if they fail, the skill fixes inline and creates a NEW commit. Amending after a hook failure loses the hook's feedback.
- **Only two skip conditions: no changes, explicit user opt-out.** "I'll commit later" is not a valid skip — the whole point is to make the commit happen *now*, before context is lost. The skill gently pushes back if the user offers to commit manually.
- **Phase 11 summary shows the commit SHA.** One line the user can scan to verify the run is safe in git before closing the session.
- **Commit failure doesn't block the Research note.** Even if the commit fails, the Obsidian Research note and Lessons note are written — the learning loop is always preserved, separate from the code-safety loop.

**Rules considered but not added:**

- "Push after commit." Too much side effect — push is a shared-state action, commit is local. The user may want to review multiple research commits before pushing. Phase 13 stops at commit.
- "Auto-create a branch for each research run." Overkill for single-finding runs. The `/gsd:pr-branch` skill already handles branch creation when needed.
- "Use `git stash` as a safety net before the run." Wrong direction — stashing makes recovery harder, not easier. Commit IS the safety net.
- "Block Phase 13 on TypeScript errors." Too brittle — pre-existing errors in unrelated files would block every research run. The pre-commit hook is the right place for lint/type checking.
- "Run `tsc --noEmit` automatically before committing." Compelling but expensive — tsc takes 60-90s on this repo. The pre-commit hook runs it for changed files already; full checks belong in CI.

**Open questions for future runs:**

- Will users respect the explicit stage rule, or will they push to include unrelated drift? The "unexpected files" prompt in 13b is the checkpoint — watch whether it fires often or never.
- Does the `research:` prefix get picked up by `/gsd:pr-branch`? It should — verify on next PR cycle.
- Is the commit message template too verbose for single-finding runs? Possibly — the "optional 1-2 line summary" slot is there to let short runs stay short.

### 2026-04-14 — "consumer web-app build tutorial" as a new zero-yield source type

**Context:** `/research` run on "Build and Deploy A Production Ready Events Manager Website | NextJS, React, TailwindCSS, PostgreSQL" (Pedro Tech, sponsored by Neon). Focus was templates + credentials. The video is a ~1h55m walkthrough of building a consumer-facing events-planner web app from scratch (Next.js + Prisma + Neon Postgres + Neon Auth + Vercel). **Result: 5 candidates extracted in Phase 3, zero survived Phase 4.** Every candidate was either already in the catalog (Neon, Vercel, GitHub) or not connector-shaped (Neon Auth = user-login primitive, Prisma = Node library, Event RSVP template = consumer web app flow, not an agent workflow).

**Rules added (Phase 3 calibration table):**

- **New source-type row — "Consumer web-app build tutorial."** Title pattern: "Build [and Deploy] X with [React|Next|Vue|Svelte] + DB + deploy stack" where X is a consumer-facing web app (events planner, dashboard, landing page, SaaS clone, etc.). Expected yield: **0 findings + 1-4 already-existed catches**. The overlap between "personas orchestrates AI agents that call APIs" and "how to build a React CRUD app for end users" is near-zero. The only findings such a source can produce are (a) a credential for a service the video uses, if not already in the catalog, or (b) an agent-shaped template that RE-imagines the consumer domain as an automation flow — but the re-imagining rarely survives the dedup check against existing calendar/meeting/notification templates.

- **Recommended action for this source type:** do the full Phase 3 extraction (5 candidates) to prove the drop, write a stub Research note + Lessons entry, commit. Do NOT stretch into a weak finding — a forced template that duplicates existing agent-shaped templates is net negative for the catalog.

- **New Phase 4 filter: "user-login auth vs machine-to-machine API auth"** (first observation, not yet a codebase-stack rule). When a new auth product appears as a credential candidate, test whether it's *user-facing login for end users of YOUR app* (Clerk, Auth0, Better Auth, Neon Auth, Supabase Auth — **drop**) or *machine-to-machine API auth your agent consumes* (**connector-shaped, keep**). This run was the first time the distinction mattered — Neon Auth was the borderline case and dropped cleanly once the filter was applied. Watch for a second observation. If it happens again, promote to `codebase-stack.md` as a permanent rule in Section 3 (connector binding model).

**Phase 6 tool-grep-first heuristic validated as the highest-leverage early move.** For sources where the title hints at "build X with Y and Z", running a tool-name grep across the cleaned transcript (`neon|prisma|vercel|clerk|stripe|resend|...`) before the deep read catches the entire "services mentioned" surface in one call. If every grep hit is already-existed or not-connector-shaped, the run is probably zero-findings — bail to stub-note early with confidence. Time cost: ~30 seconds. Benefit on this run: confirmed within ~2 minutes of loading the transcript that no new credentials were in play, which freed me to focus the deep read on the template question.

**Rules considered but not added:**

- "Auto-skip any video whose title matches the consumer web-app build pattern." Too aggressive — occasionally such videos DO surface a new deploy/DB/auth service worth adding. Better to do the full Phase 3 extraction and prove the drop, which takes ~15 minutes and produces a permanent Research note that prevents re-harvesting. The stub note is the insurance, not the bail-out.

- "Promote the user-login vs M2M auth filter to codebase-stack.md now." One observation isn't enough. If the same filter saves a second run, promote then.

**Open questions for future runs:**

- How common is the consumer-web-app-tutorial source type in practice? This is the first one in 14 runs. If it stays rare, the calibration table entry is documentation-only; if it becomes common (the YouTube algorithm feeds a lot of them), the early-bail heuristic becomes load-bearing.
- Does the stub-note-only path feel right to users, or will they push for at least one speculative template even on zero-yield runs? This run got approval for stub-only framing, but that's n=1. Watch the next zero-yield run.
