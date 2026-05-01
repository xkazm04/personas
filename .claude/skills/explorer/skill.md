# Explorer

Wander a logical section of the personas codebase, surface exactly **10 items** worth fixing, let the user triage, then execute the accepted ones in-session. Designed for frequent / low-friction use — daily wandering — and pairs with `/research` (external sources) and `/architect` (heavy structural change).

This skill is **personas-specific.** It uses `.claude/codebase-context.md` (refreshed by `/refresh-context`) as the natural area taxonomy, and the Obsidian vault for run records, coverage tracking, and cross-run learning.

## Interaction conventions

Built for parallel CLI control — every user prompt is single-keystroke answerable.

- **Every prompt is a numbered menu.** Numeric input picks the option; **Enter** triggers the default; option `1. other → …` is the deviation lane (free text).
- **Every phase output (intermediate or final) ends with a `Next?` block** of 2–5 numbered next-step actions. Replying with a digit advances the run without typing prose.
- Long free-text answers are still accepted everywhere; the menu just makes the common case instant.

## Input

Ask **two** numbered-menu questions, in this order. Numeric input picks the option; **Enter** picks the default; option `1. other → …` is the deviation lane and accepts free text.

### Q1 — Area

```
Area? (Enter = pick for me)
  1. other → type a hint (path fragment, keyword, or context id)
  2. agents
  3. vault
  4. orchestration
  5. triggers
  6. execution
  7. templates
  8. deployment
  9. platform
  10. pick for me   ← default
```

Numeric options 2–9 map 1:1 to the 8 groups in `codebase-context.md` (`AI Agent Configuration`, `Credential & Integration Vault`, `Pipeline & Team Orchestration`, `Event & Trigger Automation`, `Execution & Observability`, `Template & Recipe Library`, `Deployment & Sharing`, `Platform Administration`). Option 1's free text falls through to the Phase 2a resolver (path fragment / keyword / exact context id). Option 10 / Enter triggers Phase 2b auto-pick.

### Q2 — Category

```
Category? (Enter = any)
  1. other → describe (free-form intent; layered onto an auto-picked category)
  2. any            ← default
  3. quality
  4. dx
  5. ui
  6. perf
  7. bug
  8. i18n
  9. a11y
  10. sec
```

Wait for both answers. Don't ask anything else upfront — further questions only if a phase requires clarification.

If the user replies just "go" or "wander" or types `/explorer` with no arguments, treat as "pick for me" + "any" (Enter defaults for both).

---

## Constants

- **Codebase reference files** (always loaded):
  - `.claude/codebase-context.md` — DB-derived feature map (8 groups, ~32 contexts). The natural area taxonomy.
  - `.claude/codebase-stack.md` — hand-curated architecture, conventions, engine internals.
  - `.claude/CLAUDE.md` — project rules (i18n, design tokens, error handling, lint baseline).
- **Vault root** (resolved at Phase 0): one of two paths, whichever exists.
  - `Explorer/sweeps/` — one note per run, the canonical artifact
  - `Explorer/state.md` — informational claim board (which areas are being explored *right now*)
  - `Explorer/coverage.md` — heatmap of last visit per area + yield density
  - `Explorer/passes.md` — per-area "already considered and rejected" memory; future passes skip these
  - `Patterns/explorer-preferences.md` — distilled rules across runs (promoted from Lessons)
  - `Lessons/{date}-explorer.md` — append-only self-reflection
- **Categories** — `quality | dx | ui | perf | bug | i18n | a11y | sec`
- **Severities** — `critical | high | medium | low`
- **Effort buckets** — `xs (<15m) | s (15-60m) | m (1-3h) | l (>3h)`

---

## Phase 0: Resolve vault path

Two machines, one vault per machine. Probe both, use whichever exists.

```bash
if [ -d "C:/Users/mkdol/Documents/Obsidian/personas" ]; then
  VAULT="C:/Users/mkdol/Documents/Obsidian/personas"
elif [ -d "C:/Users/kazda/Documents/Obsidian/personas" ]; then
  VAULT="C:/Users/kazda/Documents/Obsidian/personas"
else
  echo "No personas vault found at either path. Aborting." && exit 1
fi
```

Record `$VAULT` for the rest of the run.

### Bootstrap (one-time per vault)

If any of these are missing, create them:

- `$VAULT/Explorer/` (directory)
- `$VAULT/Explorer/sweeps/` (directory)
- `$VAULT/Explorer/state.md` — header only:
  ```markdown
  # Explorer State

  Active claims by `/explorer` runs. Informational only — not a hard lock.
  Stale entries (>2h) are released automatically by the next run.

  ## Active

  _No active explorers._
  ```
- `$VAULT/Explorer/coverage.md` — header only:
  ```markdown
  # Explorer Coverage

  Heatmap of areas explored. Used by Phase 2 to pick the staleest, highest-yield area.

  ## Areas
  ```
- `$VAULT/Explorer/passes.md` — header only:
  ```markdown
  # Explorer Passes

  Per-area record of items that were surfaced and **rejected** in past runs.
  Future passes over the same area skip these. Accepted items don't appear here
  (their fix is in the codebase). Items that were not surfaced are also absent.

  ## Areas
  ```
- `$VAULT/Patterns/explorer-preferences.md` — header only:
  ```markdown
  # Explorer Preferences (distilled from /explorer runs)

  > Rules upgraded from `Lessons/` after 3+ observations. Loaded by Phase 1.

  _No patterns yet. Will be populated as runs accumulate._
  ```

Don't create `Lessons/` (already shared with `/research`).

---

## Phase 1: Load context & memory

### 1a. Required-file check

For each of `codebase-context.md` and `codebase-stack.md` under `.claude/`:
- If missing → stop and instruct the user to run `/refresh-context`.

### 1b. Read in order

1. `.claude/codebase-context.md` — to learn the area taxonomy (8 groups, ~32 contexts, file paths, keywords).
2. `.claude/codebase-stack.md` — to learn engine internals and conventions.
3. `.claude/CLAUDE.md` — to learn project rules (i18n, design tokens, error handling, lint baseline).
4. `$VAULT/Architect/strong-patterns.md` (if present) — to know the canonical shapes the codebase has been observed to do well. When you propose a fix in Phase 5, **prefer the shape of an existing strong pattern** over inventing a new one. Reference the pattern in the item's `strong_pattern_ref` field.
5. `$VAULT/Patterns/explorer-preferences.md` — to deprioritize finding shapes the user has rejected before.
6. `$VAULT/Explorer/state.md` — to know what *other* explorers are working on right now.
7. `$VAULT/Explorer/coverage.md` — to know last-visit dates and yield per area.
8. `$VAULT/Explorer/passes.md` — to know which items were already rejected per area.
9. The 3 most recent files in `$VAULT/Lessons/` matching `*-explorer.md` (sorted descending) — to absorb recent self-reflection.

### 1c. Stale-claim sweep

In `$VAULT/Explorer/state.md`, any entry whose `claimed_at` is older than 2 hours is **stale** — assume the run was abandoned. Remove stale entries before proceeding. This keeps the file honest without an explicit lock.

### 1d. Snapshot freshness

Parse the `Generated:` line in `codebase-context.md`. If >30 days old OR `git rev-list --count HEAD` has advanced by >200 since `git_commit_count` in the snapshot footer, warn but continue:
```
Warning: codebase-context.md may be stale ({N} commits / {D} days since last refresh).
Consider running /refresh-context after this session.
```

---

## Phase 2: Pick area

### 2a. If user gave a hint

Resolve the hint to one or more contexts in `codebase-context.md`:
- Exact group name (e.g. `vault`) → all contexts under that group.
- Exact context id (e.g. `agent-chat-interface`) → that single context.
- Path fragment (e.g. `agents/sub_chat`) → contexts whose `Files:` overlap.
- Keyword (e.g. `i18n`) → contexts whose `Keywords:` match.

If the resolution is ambiguous (>3 plausible areas), present a short numbered list and ask "which one?" before continuing.

### 2b. If user said "pick for me"

Score each context by:
- **Staleness** — days since last visit per `coverage.md` (more days = higher score). Never-visited = max staleness.
- **Past yield density** — items accepted / items surfaced in last 1–2 visits (higher = higher score). Tie-breaker.
- **Active claim penalty** — if the context appears in `state.md` Active section, score = 0 (skip it; pick a different area).

Pick the top-scored context. If multiple tie, pick the one with the smaller file count (faster to scan, tighter feedback loop).

Tell the user which area you picked and why (one short sentence), then a `Next?` menu:

```
Next?
  1. other → name a different area or context id
  2. proceed with {picked-area}   ← default
  3. abort
```

### 2c. Category filter

If the user's category filter is not `any`, narrow the scan focus accordingly. The area stays the same; the filter only changes what kind of items count toward the 10-item budget.

---

## Phase 3: Claim the area

Append an entry to `$VAULT/Explorer/state.md` under the `## Active` section:

```markdown
- **{area-slug}** — claimed_at: {ISO timestamp}, run_id: {short random id}, category: {filter}
```

This is **informational, not a lock.** Other explorers reading this file will pick a different area. There's no enforcement, but the user said only one explorer runs at a time, so this is sufficient for awareness.

Print the claim line to the user so they know what's recorded.

---

## Phase 4: Wander the code

Read enough of the area to identify 10 items. Budget your tool calls — don't read every file in a 100-file area. Sample strategically.

### 4a. Sampling strategy

For an area with N files:
- N ≤ 5: read all of them.
- 5 < N ≤ 20: read all entry-point files (from `codebase-context.md` `Entry points:` line) + a random sampling of the rest, capped at 10 file reads.
- N > 20: read all entry points + grep-discover the largest files (`Glob` then sort by line count) + sample 5–8 of those.

Use `Read` with offset/limit when files are >500 lines — read top + bottom + a middle slice rather than the full file.

### 4b. What to look for, by category

For `quality`:
- Dead code, unreachable branches, unused exports.
- Duplicated logic across files (3+ near-identical blocks).
- Misleading names, unclear intent, leaking abstraction.
- Comments that explain "what" instead of "why" — flag the comment, not just the code.
- Commented-out code older than current branch.

For `dx`:
- Test setup boilerplate that could be a fixture.
- Type-unsafe IPC call sites (raw `invoke` instead of `invokeWithTimeout`).
- Repeated try/catch boilerplate that should use `toastCatch` / `silentCatch` / `resolveError`.
- Build-time hot-paths (large bundles, slow rebuilds) — use `npm run build` output if recent.
- Missing error context (errors thrown without enough info to debug).

For `ui`:
- Raw Tailwind classes where semantic tokens exist (Design.md §8). ESLint already warns; surface the *high-density* offenders.
- Visual bugs (overflow, alignment, contrast). Only flag if you can reproduce or strongly suspect from the code.
- Inconsistent spacing/radius/shadow vs the design tokens.
- Missing loading / empty / error states on user-facing components.
- Accessibility gaps that double as UX gaps (missing aria-label on icon-only buttons, focus traps, keyboard nav broken).

For `perf`:
- Unnecessary re-renders (object/array literals in deps, missing `useShallow`, missing memoization on expensive children).
- N+1 queries / IPC calls in a loop.
- Large lists without virtualization.
- `useEffect` chains where one effect depends on another's state (cascade).
- Subscriptions that don't unsubscribe.
- Synchronous work on the render path that could be async.

For `bug`:
- Race conditions (state read-then-write without a transaction, async effects without abort).
- Edge cases unhandled (empty arrays, null/undefined, NaN).
- Stale closures in effects/callbacks.
- Off-by-one, boundary errors.
- Wrong dependency arrays in hooks.
- Errors swallowed silently (catch with empty body or just `console.log`).

For `i18n`:
- Hardcoded English in JSX, placeholder, title, aria-label (the `custom/no-hardcoded-jsx-text` warnings).
- Status tokens displayed raw (should use `tokenLabel()`).
- Error messages bypassing `resolveErrorTranslated()`.
- Constants with `label:` instead of `labelKey:`.
- **Bundle nearby strings** — when a single component has 4+ hardcoded strings, surface ONE finding for "extract `<Component>` strings to en.ts" rather than 4 separate findings. Reach matters; one fix knocks out all of them.

For `a11y`:
- Missing labels on form inputs.
- Color contrast (you can't measure it, but you can flag `text-foreground/40` on `bg-secondary/30` style stacks).
- Keyboard navigation broken (clickable divs without role/tabIndex).
- Missing focus styles.
- Modal without focus trap, escape handler, or backdrop click.

For `sec`:
- Externally-reachable surfaces (HTTP routes, IPC commands, webhooks) without auth/validation.
- Privileged subprocess spawns without sandboxing.
- User input directly interpolated into SQL/command strings.
- Credentials logged or surfaced in error messages.
- See `/research` Phase 6 "Security escalation rule" — same logic applies. Auto-promote sec findings to severity `critical`.

### 4c. Honor the deprioritization signals

- If `Patterns/explorer-preferences.md` contains a rule like "user rejects cosmetic CSS findings without a measurable issue," skip those.
- If `Explorer/passes.md` for this area lists items by short fingerprint (file:line + 1-line summary), skip exact matches. A near-match is OK to surface — but note "previously passed; resurfacing because <reason>".

### 4d. Stop conditions

- 10 items found → stop scanning, move to Phase 5.
- Exhausted the area without 10 items → widen scope by pulling in the *adjacent* context from the same group in `codebase-context.md`. Note the widening in the run record. If still <10 after widening twice, stop with what you have and explain the shortfall.
- Tool budget exceeded (>40 file reads) → stop with what you have.

**Do not pad the list** with low-value items just to hit 10. Quality over quota. If you stop short, the run record explains why.

---

## Phase 5: Categorize and structure each item

For each of the 10 (or fewer) items, capture:

```yaml
- id: 1
  title: "<short imperative phrase, ≤60 chars>"
  category: quality | dx | ui | perf | bug | i18n | a11y | sec
  severity: critical | high | medium | low
  effort: xs | s | m | l
  anchor: "<file_path>:<line_number>"
  evidence: "<2-3 sentence explanation of the gap, with verbatim code snippet if helpful>"
  suggested_fix: "<1-2 sentence shape of the fix — not the fix itself>"
  strong_pattern_ref: "<wikilink to Architect/strong-patterns#... entry>" | null
  i18n_impact: "<none | adds keys to en.ts | touches existing keys>"
  cluster_hint: "<other ids that ship naturally with this one, or 'standalone'>"
```

**On `strong_pattern_ref`:** if the suggested fix matches the shape of an entry in `Architect/strong-patterns.md` (e.g. proposing memoization on a Zustand selector when the strong pattern "Zustand slice + useShallow" exists), set `strong_pattern_ref` to the wikilink. The fix should then **conform to the canonical example** in that entry, not invent a new shape. If no strong pattern applies, leave it null.

### Severity rubric (be honest)

- **critical** — security gap, data loss risk, crash on common path. Drop everything and ship.
- **high** — wrong behavior on the golden path, broken on a common edge case, regression risk if left.
- **medium** — paper cut, confusing UX, small perf hit, latent risk.
- **low** — polish, nice-to-have, taste-level.

If you find yourself rating most items "high," recalibrate downward. A 10-item list typically lands as 0–1 critical, 2–3 high, 4–6 medium, 1–3 low.

### Cluster detection

After categorizing, scan for items that should ship together:
- Same file → same PR.
- Type/function dependency → ship in order.
- Same i18n component bundle → one extraction PR.

Note these in `cluster_hint`.

---

## Phase 6: Present to user

Print a summary table, then per-item detail.

### Summary table

```
#   Cat     Sev    Effort  Title                                              Anchor
─   ─────   ────   ──────  ─────────────────────────────────────────────────  ──────────────────────────
1   bug     high   s       Race in session-resume effect                      src/features/agents/sub_chat/hooks/useResumeSession.ts:42
2   perf    med    xs      Memoize ChatBubble props (renders on every tick)   src/features/agents/sub_chat/ChatBubbles.tsx:118
3   i18n    med    m       Extract AdvisoryLaunchpad strings (12 keys)        src/features/agents/sub_chat/AdvisoryLaunchpad.tsx
...
```

### Per-item detail

For each row:
```
[N] {title}
    Category / Severity / Effort:  {cat} / {sev} / {effort}
    Anchor:    {file:line}
    Evidence:  {explanation + snippet}
    Suggested: {1-2 sentence fix shape}
    Follows:   {strong-pattern wikilink + canonical example, or "—" if none applies}
    i18n:      {none | N new keys | touches existing}
    Cluster:   {standalone | ships with [a, b]}
```

If any items are clustered, end the section with a short "Clusters" block:
```
Clusters:
  - [2, 5, 8] — all in ChatBubbles.tsx; ship in one PR. Order: 5 → 2 → 8.
  - [3] alone — i18n extraction, separate PR.
```

---

## Phase 7: Triage

Ask the user:
```
Which to action? Reply with item numbers (e.g. "1, 3, 4").

Shortcuts:
  all     — accept every surfaced item
  none    — accept nothing (still write the sweep note)
  ask     — guided walkthrough item-by-item
  Enter   — same as "none"   ← default
```

For each accepted item, execute it **in this same session**. Same default as `/research`: discover → decide → implement → commit, all in one context window.

### Execution rules

**Single accepted item with a clear anchor (Option A):**
1. Apply the edit at `anchor`.
2. Run validation:
   - Rust → `cargo check` in `src-tauri/`
   - TypeScript → `npx tsc --noEmit`
   - i18n → `node scripts/i18n/check-coverage.mjs`
   - Frontend → `npm run lint` (warnings OK; errors must be fixed)
3. **Stage only the paths this item touched** — `git add path/one path/two`. Never `git add -A`, `git add .`, or `git add -u` (those would sweep up in-flight work from concurrent CLIs or the user's editor). If you can't list the paths you changed, stop and run `git diff --name-only` first.
4. Commit atomically: `explorer: <short title>` + Co-Authored-By footer + body explaining the why.

**2+ accepted items (Option B):**
1. Print the inline plan (one paragraph per item: file, change shape, validation).
2. Execute in **risk-ascending order** (xs effort first, l last; severity ties broken by category — `bug` before `perf` before `i18n` before `quality`).
3. Atomic commit per item. Validation per commit.
4. If validation fails → fix inline, do NOT stack failing commits. No `--no-verify`, no `--amend`.
5. If a downstream item turns out to be redundant after an upstream commit, drop it and note the drop in the run record.

**Item that needs more thought (Option D — escape hatch):**
Record it in the run record as `decided: deferred` with the reason. Do NOT write a handoff file. The run record is the future search target. Use sparingly — prefer A or B.

### Frontend changes — non-negotiable

If any accepted item touches `src/**/*.tsx`:
- Honor i18n contract: all user-facing strings via `useTranslation()` + keys in `src/i18n/en.ts`. No hardcoded English in JSX, placeholder, title, aria-label.
- Status tokens via `tokenLabel()` from `src/i18n/tokenMaps.ts`.
- Error messages via `resolveErrorTranslated()`.
- Use semantic design tokens (Design.md §8) — no raw white/black/shadow utilities.

If you can't honor these in the change, defer the item — don't ship it half-converted.

### Frontend visual verification

If a change is visually meaningful (UI category, or any change to a rendered component shape), state explicitly that you have NOT visually verified, OR start `npm run dev` and exercise the affected surface in a browser before committing. Don't claim "looks good" from code review alone.

---

## Phase 8: Persist the sweep

Write `$VAULT/Explorer/sweeps/{YYYY-MM-DD}-{area-slug}.md`:

```markdown
---
date: 2026-05-01
run_id: {short id}
area: {context-id or group}
files_sampled: {N}
category_filter: any | quality | ...
total_items: 10
accepted: [1, 3, 4]
declined: [2, 5, 6, 7, 8, 9, 10]
deferred: []
commits: [<sha1>, <sha2>]
widened: false
---

# {Area title} sweep — {date}

## Items

### [1] {title}  ✅ accepted → {commit sha} `{commit subject}`
**Category / Severity / Effort:** {cat} / {sev} / {effort}
**Anchor:** `{file:line}`
**Evidence:** {evidence}
**Fix shape:** {what was actually done; reference commit body for detail}

### [2] {title}  ❌ declined
**Category / Severity / Effort:** ...
**Anchor:** ...
**Evidence:** ...
**Decline reason:** _filled in Phase 9_

### [3] {title}  ⏸ deferred
**Category / Severity / Effort:** ...
**Reason:** {why deferred — concrete blocker, not vague "later"}

...

## Cross-references
- Adjacent areas not yet swept: {list from coverage.md, optional}
- Related preferences: [[Patterns/explorer-preferences]]
```

---

## Phase 9: Self-reflection

### 9a. Ask why for declined items

Single batched question:
```
For the declined items, why did you skip them?

  [2] {title}
  [5] {title}
  ...

Reply per-item ("2: too vague, 5: already planned") or one overall reason.

Shortcuts:
  skip    — record "no reason given"
  Enter   — same as "skip"   ← default
```

### 9b. Append to Lessons

Write/append `$VAULT/Lessons/{YYYY-MM-DD}-explorer.md`:

```markdown
## Run: {timestamp} — {area} ({category filter})

Sampled: {N} files
Surfaced: {M} items
Accepted: [list]
Declined: [list] (with reasons)
Deferred: [list] (with blockers)

### Self-reflection
- Categories that resonated: {pattern}
- Categories that didn't: {pattern}
- Calibration drift: {e.g. "rated 7 items 'high' but user accepted only 2; over-weighting severity"}
- Tools to use more / less next time: {observation}
```

### 9c. Backfill the sweep note

Add the decline reasons to the Phase 8 sweep note's `[N] declined` blocks.

### 9d. Update passes.md

For each declined item, append a fingerprint to `$VAULT/Explorer/passes.md` under the area's section (create section if missing):

```markdown
## {area}

- {file:line} — {1-line summary of the rejected suggestion} — pass {date}, run {id}, reason: {short reason}
```

The fingerprint matters — future passes over the same area skip these. Keep entries short.

### 9e. Pattern promotion check

Read all `$VAULT/Lessons/*-explorer.md`. If a decline reason has appeared in **3+ runs** (or close synonym), propose adding it to `$VAULT/Patterns/explorer-preferences.md`:

```
I've seen this 3+ times — promote to permanent rule?
  "{distilled rule}"

Source runs: [[2026-04-12-vault-credentials]], [[2026-04-20-overview-metrics]], [[2026-04-28-agents-editor]]

Next?
  1. promote to Patterns/explorer-preferences.md   ← default
  2. snooze (re-ask after 3 more observations)
  3. drop (don't promote, reset the counter)
```

If the user picks 1, append to `Patterns/explorer-preferences.md`.

### 9f. Update coverage.md

Update or insert the row for this area:

```markdown
## Areas

### {area-slug}

- Last visited: {date}
- Last run: [[Explorer/sweeps/{date}-{area-slug}]]
- Items surfaced (last 3 runs): [10, 8, 10]
- Items accepted (last 3 runs): [3, 5, 4]
- Yield density: {accepted / surfaced average}
- Notes: {anything noteworthy across runs}
```

### 9g. Release the claim

Remove the entry written in Phase 3 from `$VAULT/Explorer/state.md`.

---

## Phase 10: Final summary

Print:
```
Explorer run complete.

  Area:           {name} (group: {group})
  Category:       {filter}
  Files sampled:  {N}
  Items surfaced: {M} / 10
  Accepted:       {K} → {commit shas}
  Declined:       {L}
  Deferred:       {D}

  Coverage update: last visit {date} → {today}, yield density {X}/{Y}

  Files updated:
    + Obsidian/personas/Explorer/sweeps/{date}-{slug}.md
    + Obsidian/personas/Lessons/{date}-explorer.md
    ~ Obsidian/personas/Explorer/coverage.md
    ~ Obsidian/personas/Explorer/passes.md  (if any declines)
    ~ Obsidian/personas/Explorer/state.md   (claim released)
    {if pattern promoted:}
    ~ Obsidian/personas/Patterns/explorer-preferences.md

  Next?
    1. /explorer {staleest adjacent area}                ← default
    2. /explorer {same area, different category}
    3. /research {area}    (external-source companion run)
    4. /architect resume   (drain backlog)
    5. done
```

If zero items were accepted, frame the run as a successful pass over a healthy area. The point is signal, not action.

---

## Notes on use

- **Pair with `/research`** — run `/explorer` after a research session that touched a specific area, to immediately surface adjacent gaps the research run didn't cover.
- **Cadence** — daily or every-other-day is a reasonable rhythm. Coverage.md will tell you when the codebase is uniformly fresh and you should switch to `/architect` instead.
- **Coexist with uncommitted work.** Multiple CLIs and editor sessions share the working tree. Explorer never stashes, resets, or discards anything it didn't author. Each commit stages **only the specific paths** the explorer touched (`git add path/one path/two`); never `git add -A`, `git add .`, or `git add -u`. If an item's anchor file already has uncommitted changes from someone else, surface it: "this file already has changes — commit them first, or layer on top?" Default to layer-on-top if the user doesn't pick. Forbidden at all times: `git stash`, `git reset --hard`, `git restore`, `git checkout --` on paths the run didn't author, `git clean -f`.
- **Drift signal** — if 3+ explorer runs in a row produce 0 accepted items, the calibration is off (severity bar too low, or area was wrong). Trigger a self-reflection: read the last 3 sweeps and ask the user "what shape would have actually been useful?"
