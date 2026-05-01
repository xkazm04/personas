# Architect

Heavy-hitter codebase scan for **structural patterns** — both weak ones to upgrade and strong ones to codify. Designed for rare, deliberate, high-effort sessions where the payoff is a class of bugs eliminated, a tech swap landed, or a convention promoted from "tribal knowledge" to "lint-enforced rule."

This is the highest-risk, highest-payoff skill in the suite. It pairs with `/research` (external sources) and `/explorer` (per-area paper cuts) — those handle the small and the medium; `/architect` handles the large.

This skill is **personas-specific.** It uses `.claude/codebase-context.md` and `.claude/codebase-stack.md` for taxonomy, and the Obsidian vault for a durable backlog of architectural decisions that span multiple sessions.

## Input

Three modes — pick one:

1. **`scan` mode.** Ask: **"Theme to scan for? (e.g. `state-management`, `error-handling`, `ipc-boundary`, `data-modeling`, `testing-strategy`, `async-patterns`, `type-safety`, `build-tooling`, or a free-form one)"**. If the user replies "pick for me," consult `Architect/coverage.md` for the staleest theme. Theme is required for scan mode — no theme means shallow findings; refuse and re-ask if the user resists.
2. **`area` mode.** User says "look at `<area>`" (e.g. `vault`, `agents/sub_chat`, `engine/scheduler`). Scan is bounded to that area but still cross-cutting within it. Same parallel-agent shape as scan mode.
3. **`resume` mode.** User says "resume" or types `/architect resume`. Skip scanning. Read `Architect/backlog.md`, present pending decisions sorted by priority, let the user pick one to execute now.

If unclear, ask: **"`scan`, `area`, or `resume`?"**

---

## Constants

- **Codebase reference files:**
  - `.claude/codebase-context.md` — DB-derived feature map. Used to resolve area scope and target file lists.
  - `.claude/codebase-stack.md` — hand-curated architecture, conventions, engine internals. Heavily consulted in scan mode.
  - `.claude/CLAUDE.md` — project rules.
  - `.claude/Design.md` — design system canonical reference.
- **Vault root** (resolved at Phase 0): one of two paths, whichever exists.
  - `Architect/scans/` — one note per scan run, the synthesis output
  - `Architect/decisions/` — one ADR per accepted decision (Markdown, ADR-style)
  - `Architect/backlog.md` — durable queue of accepted decisions with status
  - `Architect/strong-patterns.md` — patterns identified as load-bearing, kept for codification
  - `Architect/weak-patterns.md` — anti-patterns identified, with affected files
  - `Architect/coverage.md` — themes/areas previously scanned, staleness, last-decision date
  - `Patterns/architect-preferences.md` — distilled rules across runs (promoted from Lessons)
  - `Lessons/{date}-architect.md` — append-only self-reflection
- **Categories of finding** — `weak-pattern | strong-pattern | tech-swap | structural-bug-class | convention-gap`
- **Risk** — 1 (low, isolated) … 5 (production-critical surface)
- **Effort** — `s | m | l | xl`
- **Reach** — concrete number: "{N} files / {M} call sites / {K} components" — never vague.
- **Payoff** — 1 (incremental) … 5 (eliminates a recurring bug class or unblocks a major future)

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

- `$VAULT/Architect/` (directory)
- `$VAULT/Architect/scans/`, `$VAULT/Architect/decisions/` (directories)
- `$VAULT/Architect/backlog.md`:
  ```markdown
  # Architect Backlog

  Durable queue of architectural decisions. Sorted manually by priority.
  Status values: `proposed | approved | in-progress | shipped | abandoned | blocked`.

  ## Pending
  _No pending decisions._

  ## Shipped
  _None yet._

  ## Abandoned / Blocked
  _None yet._
  ```
- `$VAULT/Architect/strong-patterns.md`:
  ```markdown
  # Strong Patterns

  Load-bearing patterns identified by `/architect`. Promote-worthy: ideally these
  graduate into lint rules, design-doc sections, or codified conventions.

  ## Patterns

  _No patterns yet._
  ```
- `$VAULT/Architect/weak-patterns.md`:
  ```markdown
  # Weak Patterns

  Anti-patterns identified by `/architect`, with reach data. Each entry should
  eventually convert into a backlog decision (or get explicitly accepted as
  "tolerable for now" with a reason).

  ## Patterns

  _No patterns yet._
  ```
- `$VAULT/Architect/coverage.md`:
  ```markdown
  # Architect Coverage

  Heatmap of themes and areas scanned, with last-scan date.

  ## Themes
  _No themes scanned._

  ## Areas
  _No areas scanned._
  ```
- `$VAULT/Patterns/architect-preferences.md`:
  ```markdown
  # Architect Preferences (distilled from /architect runs)

  > Rules upgraded from `Lessons/` after 3+ observations. Loaded by Phase 1.

  _No patterns yet. Will be populated as runs accumulate._
  ```

`Lessons/` is shared with the other skills — don't recreate.

---

## Phase 1: Load context & memory

### 1a. Required-file check

For each of `codebase-context.md`, `codebase-stack.md`, `CLAUDE.md` under `.claude/`:
- If missing → stop and instruct accordingly (`/refresh-context` for the first two).

### 1b. Read in order

1. `.claude/codebase-stack.md` — **most important** for architect. The Engine section, the conventions, the framework-vs-plugin boundary. Read in full.
2. `.claude/codebase-context.md` — area taxonomy, file paths.
3. `.claude/CLAUDE.md` + `.claude/Design.md` — project rules and design system.
4. `$VAULT/Architect/strong-patterns.md` — to know what's already considered load-bearing (avoid re-flagging strengths as "discoveries").
5. `$VAULT/Architect/weak-patterns.md` — to know what's already on the radar.
6. `$VAULT/Architect/backlog.md` — to know what's pending or in-progress.
7. `$VAULT/Architect/coverage.md` — for staleness signals.
8. `$VAULT/Patterns/architect-preferences.md` — to deprioritize finding shapes the user has rejected before.
9. The 3 most recent `$VAULT/Lessons/*-architect.md` files — recent self-reflection.

### 1c. Snapshot freshness

Same check as research/explorer. Warn if `codebase-context.md` is >30 days old or commits have advanced >200.

### 1d. Aging strong-patterns review

Parse `$VAULT/Architect/strong-patterns.md`. For each entry:
- Compute age = `today − Identified` date.
- If `Codification status: noted` AND age > 60 days AND no `Last reviewed` within 30 days → mark as **aging**.

Hold the aging list in working memory; surface it in Phase 5 alongside new findings. The intent is gentle pressure, not nagging — a pattern can stay `noted` indefinitely if the user explicitly snoozes or accepts that informal status is fine.

If a pattern's `Codification status` is already `lint-rule-added`, `docs-written`, or `test-guard-added`, don't flag it as aging. The codification has happened.

---

## Phase 2: Mode dispatch

### Scan mode → Phase 3
### Area mode → Phase 3 (with area scope override applied to all sub-agent prompts)
### Resume mode → Phase 9

---

## Phase 3: Parallel scan (scan + area modes)

This is where the heavy lifting happens. Spawn **3–5 `Explore` sub-agents in parallel**, each looking at the theme/area from a different angle. Each agent gets a focused prompt and reports back in a structured shape.

### 3a. Pick the angles

For a generic theme, default angles:
1. **Usage map** — where does this concept appear? Count call sites, group by feature module. Identify shape variation.
2. **Type/contract** — are the types consistent? Are interface boundaries respected? Any leaky abstractions?
3. **Failure mode** — what happens when this fails? Error handling consistency, recovery, observability.
4. **Performance surface** — any hot paths? Sync work that should be async? N+1 patterns? Bundle weight contributions?
5. **Test coverage** — is this tested at the right layer? Unit, integration, e2e? Test gaps that hide regressions?

Pick the angles that match the theme. Examples:

- `state-management` → angles 1, 2, 4, 5 (drop "failure mode" — state isn't error-prone in the usual sense; replace with "subscription / re-render footprint").
- `error-handling` → angles 1, 2, 3, 5.
- `ipc-boundary` → angles 1, 2, 3, plus a sec-leaning one ("auth and validation at the boundary").
- `data-modeling` → angles 1, 2, plus "migration history" and "schema-vs-types drift".
- `testing-strategy` → angles 5 (deeply), plus "fixture duplication" and "test harness reach".
- `async-patterns` → angles 1, 2, 3, 4.
- `type-safety` → angles 2, 4, plus "any-leak audit" and "ts-error-on-master surfaces".
- `build-tooling` → angles 4, 5, plus "config drift across packages" and "lock file health".

If `area` mode, every angle is bounded to files within the area's contexts in `codebase-context.md`.

### 3b. Sub-agent prompt template

Each sub-agent prompt should be **self-contained** — they don't have your context. Use `Explore` (read-only) for all of them.

```
You are scanning the personas codebase for {angle name}.

Theme: {theme}
{If area mode:} Scope: only files under {area paths from codebase-context.md}
Background: {1 paragraph from codebase-stack.md relevant to the theme}

Specific questions:
1. {question 1 tailored to angle}
2. {question 2}
3. {question 3}

Report format (Markdown):
- Files inspected: {list, capped at top 30 by relevance}
- Observed shapes: {distinct patterns found, with file:line examples for each}
- Inconsistencies: {where shapes diverge — call out specific files}
- Outliers: {any single file doing it differently from the rest}
- Smell strength: 1-5 (1 = healthy, 5 = active drag on the codebase)
- Cross-references: {where this angle interacts with other parts of the system}

Budget: 30-60 minutes of equivalent work. Don't enumerate every match — sample
strategically and report shape, not exhaustive detail.
```

Run all sub-agents **in parallel** (single message, multiple `Agent` tool calls).

### 3c. Synthesize

Merge the sub-agent reports into a single pattern model. Look specifically for:

- **Convergence** — multiple angles flagging the same module → high-confidence finding.
- **Conflict** — one angle calls something a strength, another calls it a weakness → investigate; usually means context-dependent (strong in module A, weak in module B).
- **Surprise** — something none of the angles expected → likely the most valuable finding of the run.
- **Reach quantification** — every weakness has a concrete count: "47 files, 12 components, 3 stores."

If sub-agent reports are thin (smell strengths all 1-2, inconsistencies few), the area is healthy in this theme. **Say so explicitly** and offer to either pick a different theme or downgrade the run to "passive scan, no findings to action." Don't manufacture findings to fill a quota.

### 3d. Output structure

After synthesis, you should have:
- 0–8 **weak-pattern findings** with reach, risk, effort, payoff.
- 0–4 **strong-pattern findings** worth codifying.
- 0–2 **tech-swap proposals** (replace lib X with Y) — only when smell strength is ≥4 AND swap unlocks payoff a refactor can't.
- 0–3 **structural-bug-class** findings — recurring bugs whose root is structural (e.g. "every effect that polls leaks because we have no `useInterval` primitive — fix the missing primitive, not 14 effects").

Cap total findings at **8**. If you have more, rank by `(reach × payoff) / (risk × effort)` and drop the bottom.

---

## Phase 4: Surface against existing memory

Before presenting, cross-check every finding against:
- `$VAULT/Architect/strong-patterns.md` — if you're flagging a "weakness" in something previously identified as strong, the user's expectation has changed; flag the conflict explicitly.
- `$VAULT/Architect/backlog.md` — if a finding duplicates a pending decision, merge them and note "previously proposed in [[backlog#decision-N]], re-confirming with new reach data."
- `$VAULT/Architect/weak-patterns.md` — same for weak patterns. If reach or risk has shifted, update the existing entry instead of creating a new one.

This step prevents architecture findings from drifting into "we keep finding the same thing every quarter and never doing it."

---

## Phase 5: Present findings

Print a summary table, then per-finding detail with full tradeoff context.

### Summary table

```
#   Type                   Sev    R   E    Reach                              Title
─   ────────────────────   ────   ─   ──   ─────────────────────────────────  ──────────────────────────────
1   weak-pattern           high   3   m    47 files / 12 components / 3 stores  Inconsistent loading state shape across feature modules
2   structural-bug-class   high   4   l    8 polling effects                    Missing useInterval primitive; every poll leaks subscriptions
3   tech-swap              med    4   xl   ~280 files                            Replace handcrafted form state with react-hook-form
4   strong-pattern          —     —   —    23 stores                             Zustand slice + useShallow is rigorously consistent — codify
...
```

R = risk (1-5), E = effort (s/m/l/xl). Strong patterns have no risk/effort — they're observations, not changes.

### Per-finding detail

For weak-pattern / structural-bug-class / tech-swap:

```
[N] {title}
    Type:        {weak-pattern | structural-bug-class | tech-swap}
    Reach:       {concrete count}
    Risk:        {1-5} — {1-line explanation: what could break, recovery path}
    Effort:      {s/m/l/xl} — {rough breakdown: scan/migrate/test ratio}
    Payoff:      {1-5} — {what this unlocks, what bug class it eliminates}

    Current shape:
      {2-3 sentences describing how it's done today, with 2-3 file:line examples
       showing variation if relevant}

    Proposed shape:
      {2-3 sentences describing the proposed convention/replacement, with one
       canonical example file:line showing where it's already done right (or
       a sketch of what it would look like)}

    Migration plan (sketch):
      {3-7 numbered steps, each shippable independently. Note which are
       breaking vs additive. Ballpark commit count and PR size.}

    Risks:
      - {risk 1, with mitigation}
      - {risk 2}
      - {risk 3}

    Already-on-radar: {link to weak-patterns.md entry or backlog item if any}
```

For strong-pattern:

```
[N] {title}
    Type:           strong-pattern
    Reach:          {concrete count}
    Why it works:   {2-3 sentences}
    Codification:   {how to promote — lint rule? Design.md section? CLAUDE.md note?}
    Risk to losing: {what would happen if it drifts — concrete bug shape}
```

### Aging strong patterns (from Phase 1d)

After the new findings, print a short Aging block — only if Phase 1d found any:

```
Aging strong patterns (noted but not codified):

[A1] {title}  — noted {date} ({N} days ago)  → [[Architect/strong-patterns#{title}]]
[A2] {title}  — noted {date} ({N} days ago)  → [[Architect/strong-patterns#{title}]]
```

These are not new findings — they're re-surfaced from prior runs. Phase 6 triage handles them with their own verdicts.

---

## Phase 6: Triage

Ask the user:
```
For each finding, decide:
  - "execute now" — pick this one to implement in this session
  - "queue" — accept as a backlog decision; defer execution
  - "drop" — not worth pursuing
  - "rework" — flagged something true but the proposed shape isn't right; you want a redo

Reply per-number (e.g. "1: queue, 2: execute, 3: drop, 4: queue") or "ask"
for a guided walkthrough.
```

The four-way triage matters: architect findings rarely all execute now, but they shouldn't all drop either. Most go to the queue.

For each verdict:

- **execute now** → proceed to Phase 7. Only one "execute now" per session is recommended; if the user picks more than one, ask: "doing N changes in one session is high-risk — pick the highest priority and queue the rest?" Allow override but warn.
- **queue** → proceed to Phase 8 (write ADR + add to backlog).
- **drop** → record in scan note as `decided: dropped` with reason. Pattern-track in Lessons (Phase 10).
- **rework** → ask: "what shape would actually fit?" Capture user's reframe, update the finding, re-present. If they don't have a clear redo, queue it as `proposed (needs reshape)` so a future scan can revisit.

Strong-pattern findings have a different triage:
```
For strong patterns (new this run), decide:
  - "codify" — proceed to Phase 7B; pick a vehicle (lint rule / docs / test guard) and ship it
  - "note"   — record in strong-patterns.md but defer codification
  - "drop"   — not actually as load-bearing as it looked; do NOT write to memory
```

For aging strong patterns (from Phase 1d), the verdicts are:
```
  - "codify"   — same Phase 7B path; this is exactly what aging is meant to push toward
  - "snooze"   — bump Last reviewed to today; won't surface as aging again for 30 days
  - "drop"     — pattern no longer load-bearing (codebase moved on); remove from strong-patterns.md
```

Codification is on by default if the user picks `codify` for any pattern (new or aging). The "triage first, docs after" preference means `note` is a valid steady state, but aging review eventually nudges noted patterns toward action or honest acceptance that informal status is fine.

---

## Phase 7: Execute (one decision, this session)

This is the high-rigor execution path. Architect changes default to a dedicated branch with full validation. **Always ask** about branching — sometimes rapid-development chaos doesn't allow it.

### 7a. Branch handling

Ask:
```
Create a dedicated branch for this? (recommended: yes)

  yes → branch name: architect/{slug}  ← suggested, edit if you want different
  no  → commit on current branch (current: {git branch --show-current})
```

Default to "yes" but the user said: in chaotic rapid-development phase, sometimes "no" is the right answer. Don't push back if they say no.

If yes, create the branch:
```bash
git switch -c architect/{slug}
```
After the branch exists, every commit lands there until the user merges or asks to switch back.

### 7b. Write the ADR first

Before any code change, write `$VAULT/Architect/decisions/{YYYY-MM-DD}-{slug}.md`:

```markdown
---
date: 2026-05-01
slug: {slug}
status: in-progress
type: weak-pattern | structural-bug-class | tech-swap
reach: "{concrete count}"
risk: {1-5}
effort: {s/m/l/xl}
payoff: {1-5}
branch: architect/{slug} | "(committed to master)"
related_scan: [[Architect/scans/{date}-{theme}]]
---

# {Title}

## Context
{What's the codebase reality today, with file:line examples. ~1 paragraph.}

## Decision
{What we're going to do. ~1 paragraph. Be specific about scope.}

## Consequences
### Positive
- {what we gain}
### Negative / risks
- {what we lose or risk}
### Mitigations
- {pre-flight checks, rollback plan}

## Rollout
{Numbered list of atomic commits planned. Each one is independently shippable.}
1. {step 1} — {validation: cargo check / tsc / lint / tests}
2. {step 2} — {validation}
3. ...

## Acceptance criteria
- {observable criterion 1}
- {observable criterion 2}
- {observable criterion 3}

## Regression checklist
- [ ] {area 1 still works} — verified by: {how}
- [ ] {area 2 still works} — verified by: {how}
- ...
```

### 7c. Pre-flight checks

Before commit 1, ensure baseline is clean:
```bash
# Run all from project root
git status                    # working tree should be clean
npx tsc --noEmit              # baseline TS errors recorded
npm run lint                  # baseline warning count recorded
cd src-tauri && cargo check && cd ..   # Rust baseline
npm run test -- --run         # baseline test pass/fail recorded
```

Record the baseline numbers in the ADR's `## Pre-flight baseline` section before proceeding. Every later commit's validation compares to this baseline — `npm run lint` going from 10086 → 10089 warnings is a regression, not noise.

### 7d. Atomic commits per rollout step

For each step in the ADR's Rollout section:

1. Apply the changes for that step.
2. Run the validation listed for that step.
3. **Compare to baseline** — TS errors must not increase, lint warnings must not exceed baseline + small rounding (5 max), tests must pass at the baseline rate.
4. If validation regresses → fix inline. Do NOT stack failing commits. Do NOT use `--no-verify` or `--amend`.
5. Commit with `architect: <step title>` prefix, Co-Authored-By footer, body referencing the ADR by wikilink.
6. Record the commit SHA in the ADR's Rollout section as you go.

### 7e. Final regression sweep

After the last step:

1. Run all validation commands one more time, fully:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `cargo check` in `src-tauri/`
   - `npm run test -- --run`
2. Walk through the ADR's regression checklist. For each item, verify it works (run the actual code path if possible — `npm run tauri dev` and exercise the surface).
3. **If any checklist item is unverified, do not mark the ADR as `shipped`.** Mark `in-progress` with a "needs verification" note and queue the verification as a follow-up.

### 7f. Update ADR status

When all rollout steps are committed and regression checklist passes:
- Update ADR frontmatter: `status: shipped`, add `commits: [<sha>, ...]`.
- Move the entry in `Architect/backlog.md` from Pending to Shipped.

If only some steps shipped, status stays `in-progress` and the ADR records which steps remain.

### 7g. Frontend changes — non-negotiable

If any commit touches `src/**/*.tsx`:
- Honor i18n contract: all user-facing strings via `useTranslation()` + keys in `src/i18n/en.ts`. No hardcoded English in JSX, placeholder, title, aria-label.
- Status tokens via `tokenLabel()` from `src/i18n/tokenMaps.ts`.
- Error messages via `resolveErrorTranslated()`.
- Use semantic design tokens (Design.md §8).

### 7h. Visual verification

For UI-affecting decisions: launch `npm run tauri dev`, exercise the affected surface, confirm. State explicitly when you have NOT visually verified — never claim "looks good" from code review alone.

---

## Phase 7B: Codify strong patterns

Triggered for every strong pattern (new or aging) marked `codify` in Phase 6. Multiple codifications can run in the same session — they're independent and lower-risk than a Phase 7 weak-pattern execution.

### 7B.a. Pick the vehicle

For each pattern marked `codify`, ask:

```
How should "{pattern title}" be codified? Pick one or more:

  1. lint-rule    — write a custom ESLint rule that flags non-conforming code
  2. docs-stack   — append a section to .claude/codebase-stack.md (loaded by all skills)
  3. docs-claude  — append a convention to .claude/CLAUDE.md (project rules; surfaces in every session)
  4. test-guard   — add a structural test that asserts the pattern (fails if drift introduced)
  5. multiple     — pick a combination (e.g. "1+2" = lint rule + stack docs)
```

**Rule of thumb for which vehicle fits:**
- Pattern is a code shape (call site discipline, hook usage, type contract) → `lint-rule` is strongest. Falls back to `docs-stack` if the pattern is too contextual to lint mechanically.
- Pattern is an architectural boundary (framework vs plugin, IPC contract, where things live) → `docs-stack` so future skills load it.
- Pattern is a project-wide convention humans need to know (i18n, design tokens, error handling) → `docs-claude` so it surfaces in CLAUDE.md and is loaded into every session.
- Pattern can be detected by file scan but not in a single file's AST (cross-file invariant, count threshold) → `test-guard` (a vitest test that walks the tree).

If the user picks `multiple`, codify each vehicle in a separate atomic commit.

### 7B.b. Lint rule vehicle

1. Read `eslint.config.js` and `eslint-rules/` to learn the project's custom-rule conventions (rule file shape, naming, registration).
2. Write a new rule under `eslint-rules/<rule-name>.js` (or `.cjs` if that's the existing pattern). Follow the existing custom rules' shape — name format, severity, message, fix function if mechanically auto-fixable.
3. Register the rule in `eslint.config.js`. Default severity: `warn` (matches the project's "warnings as known migration" baseline). Only use `error` if the user explicitly says "ship blocker."
4. Run `npm run lint` and capture the new warning count. Compare to baseline. If the new count is enormous (>500 warnings), warn the user — the rule is too noisy and either the pattern isn't actually as load-bearing as thought, or the rule needs scope narrowing. Pause for guidance.
5. Commit: `architect: codify <pattern> as ESLint rule` — body explains the rule, threshold, and current warning count.

### 7B.c. Docs vehicle (stack or claude)

1. Read the target file (`.claude/codebase-stack.md` or `.claude/CLAUDE.md`).
2. Find the right insertion point — for stack: a section like "Strong patterns" or under the architecture section it relates to; for CLAUDE.md: under "Important Conventions" with a subsection.
3. Write the section: name, why it works (the "load-bearing" reasoning from the strong-pattern entry), canonical example with `file:line` reference, anti-shape to avoid, optional pointer to the lint rule if `multiple` was picked.
4. Keep it concise — 10-25 lines. Long convention docs go unread.
5. Commit: `architect: codify <pattern> in <file>` — body quotes the appended section.

### 7B.d. Test guard vehicle

1. Read existing structural tests if any (`Grep "describe.*('structural'|'invariant'"` in `src/**/*.test.ts`).
2. Write a vitest test under the most relevant location (typically `src/__tests__/structural/<pattern>.test.ts`).
3. The test should walk the file tree (use `fast-glob` or Node `fs`), grep for the anti-shape, and assert zero violations. Provide a clear failure message that points the offender to the strong-patterns entry and the rule.
4. Run `npm run test -- --run` and confirm the new test passes against current code.
5. Commit: `architect: codify <pattern> as structural test guard`.

### 7B.e. Update the strong-patterns entry

In `$VAULT/Architect/strong-patterns.md`, update the entry:
- `Codification status: lint-rule-added | docs-written | test-guard-added` (or combination — list all that were added)
- Add `Codified: {date}` line.
- Add `Codification ADR: [[Architect/decisions/{date}-codify-{slug}]]` (see 7B.f).
- If a docs vehicle was used, link to the file: `Docs at: .claude/codebase-stack.md#<anchor>`.
- If a lint vehicle was used: `Lint rule: eslint-rules/<rule-name>.js`.

### 7B.f. Mini-ADR

Codification is a real decision with rollback considerations. Write a small ADR at `$VAULT/Architect/decisions/{YYYY-MM-DD}-codify-{slug}.md`:

```markdown
---
date: 2026-05-01
slug: codify-{slug}
status: shipped
type: codification
vehicle: lint-rule | docs-stack | docs-claude | test-guard | combination
parent_strong_pattern: [[Architect/strong-patterns#{title}]]
related_scan: [[Architect/scans/{date}-{theme}]]
commits: [<sha>]
---

# Codify: {pattern title}

## Why now
{reason — typically "noted N days ago, surfaced as aging" or "identified this run, smell-strength enough to enforce"}

## Vehicle and rationale
{which vehicle picked, why this one fits}

## Rollback
{how to undo if the codification turns out wrong — e.g. "drop the lint rule, the underlying pattern remains noted in strong-patterns.md"}
```

### 7B.g. For aging patterns marked `snooze`

No codification work — just update the entry in `strong-patterns.md`:
- Add or update `Last reviewed: {today}`.
- Bump the `Snoozed until: {today + 30 days}` field (create if missing).

This commit is optional — if it's the only change of the run, commit `architect: snooze {pattern} for 30d`. Otherwise bundle into the run's regular activity.

### 7B.h. For aging patterns marked `drop`

Remove the entry from `strong-patterns.md` entirely. Add a one-line entry to `Lessons/{date}-architect.md`:
```
- Dropped strong pattern "{title}" — original date {date}, reason: {user reason}.
```

This is the cleanup path. Don't keep zombie entries.

---

## Phase 8: Backlog the queued decisions

For every finding the user marked **queue** in Phase 6:

### 8a. Write a stub ADR

Same template as Phase 7b, but with:
- `status: proposed`
- Rollout section can be sketchy (filled in when the decision moves to `in-progress` in a future session).
- No commits, no branch.

Save to `$VAULT/Architect/decisions/{YYYY-MM-DD}-{slug}.md`.

### 8b. Append to the backlog

In `$VAULT/Architect/backlog.md`, under `## Pending`, add:

```markdown
- **[{date}] {Title}** — type: {type}, risk: {N}, effort: {s/m/l/xl}, payoff: {N}, reach: {concrete}
  ADR: [[Architect/decisions/{date}-{slug}]]
  Source scan: [[Architect/scans/{date}-{theme}]]
  Status: proposed
  Notes: {any user input from triage}
```

Sort the Pending section by `(reach × payoff) / (risk × effort)` descending — easiest high-payoff first. The user can manually re-sort.

### 8c. Update weak-patterns.md / strong-patterns.md

For weak-pattern findings, add or update an entry in `$VAULT/Architect/weak-patterns.md`:

```markdown
## {Pattern title}

- First seen: {date} (this run)  /  Last seen: {date}
- Reach: {count, current}
- Reach trend: {growing | stable | shrinking}
- Backlog item: [[Architect/backlog#decision-N]] (or "no decision queued yet")
- Examples: `{file:line}`, `{file:line}`, `{file:line}`
```

For strong-pattern findings — write only when triage verdict is `note` or `codify`. **Never write entries the user marked `drop`** (drop means "not actually load-bearing"; persisting it would pollute the file). For `codify` verdicts, the entry is written here in skeleton form, then Phase 7B fills in `Codified`, `Codification status`, and `Codification ADR` when the codification ships.

```markdown
## {Pattern title}

- Identified: {date}
- Reach: {count}
- Why it works: {1 sentence}
- Codification status: noted | docs-written | lint-rule-added | test-guard-added | combination
- Last reviewed: {date — set on every aging review snooze}
- Examples: `{file:line}`, `{file:line}`
```

For aging strong patterns marked `drop` in Phase 6, **delete** the existing entry from `strong-patterns.md` (see Phase 7B.h). Entries are not kept around as tombstones.

---

## Phase 9: Resume mode

Triggered when input was `resume`. Skip all of Phase 3 (no scanning).

### 9a. Read the backlog

Open `$VAULT/Architect/backlog.md`. Print the Pending section to the user, formatted as a numbered table:

```
Pending architect decisions ({N}):

#   Date         Title                                                   Type           R/E/P  Reach
─   ──────────   ─────────────────────────────────────────────────────   ────────────   ─────  ──────────────
1   2026-04-15   Inconsistent loading state shape across feature modules  weak-pattern   3/m/4  47f / 12c / 3s
2   2026-04-15   Replace handcrafted form state with react-hook-form      tech-swap      4/xl/4 ~280f
3   2026-04-22   Missing useInterval primitive; polling leaks             struct-bug     4/l/4  8 effects
...
```

R/E/P = risk / effort / payoff.

### 9b. Pick one to execute

Ask: "Which to execute now?" The user picks one number (or "open ADR N" to read the full decision before deciding).

If they pick `open`, read the ADR file and print it. Then re-ask.

### 9c. Refresh the ADR

The ADR was written previously and may be stale (codebase has moved on). Before executing:
- Re-verify the file:line anchors still exist.
- Re-count reach (run the original grep, see if numbers shifted).
- Read recent git log on touched files to spot conflicts.
- If anything material has changed (a step was already done by another change, the shape of the proposed fix is now wrong, the reach has shrunk to a level where it's not worth the effort), **stop and present the delta to the user**. Ask whether to proceed, reshape, or abandon.

If nothing material has changed, fill in any sketchy parts of the Rollout section and proceed.

### 9d. Execute

Jump to Phase 7c (pre-flight checks) and run through 7d–7h normally. The branch question still applies — ask.

---

## Phase 10: Self-reflection

### 10a. Ask why for dropped findings

Single batched question:
```
For the dropped findings, why did you drop them?

  [3] {title}
  [5] {title}

Per-item reasons or one overall reason. Type "skip" to move on.
```

### 10b. Append to Lessons

Write `$VAULT/Lessons/{YYYY-MM-DD}-architect.md`:

```markdown
## Run: {timestamp} — {theme or area} ({mode})

Sub-agents spawned: {N} angles
Findings surfaced: {weak: M, strong: K, swap: J, struct-bug: L}
Triage:
  - executed: [list]
  - queued: [list]
  - dropped: [list]
  - reworked: [list]

### Drop reasons
- [3] {reason}
- [5] {reason}

### Self-reflection
- Sub-agent angles that produced strong signal: {which ones}
- Sub-agent angles that produced noise: {which ones}
- Synthesis miss: {anything I framed wrong that the user corrected}
- Calibration drift: {e.g. "rated 4 findings 'high payoff' but user dropped 2 of 4 — over-weighting payoff"}
- Re-usable insight for future scans: {1 sentence}
```

### 10c. Backfill the scan note

(See Phase 11 for the scan note structure — backfill drop reasons there.)

### 10d. Pattern promotion

Same logic as `/research` and `/explorer`: read all `Lessons/*-architect.md`, look for repeated drop reasons. After 3+ observations, propose adding to `$VAULT/Patterns/architect-preferences.md`.

### 10e. codebase-stack.md update check

Did this run discover a structural fact about the codebase that future runs need to know? Architect runs are *especially* prone to this — sub-agent reports often surface boundaries the skill didn't have on its map. If yes, edit `.claude/codebase-stack.md` directly with the new fact, tagged with run date.

### 10f. Update coverage.md

Update the Themes section (or Areas if area mode):

```markdown
### {theme}
- Last scanned: {date}
- Last scan: [[Architect/scans/{date}-{theme}]]
- Findings (last 3 scans): [8, 4, 6]
- Findings actioned: [3, 1, 2]
- Yield density: {actioned / surfaced}
- Notes: {observations across runs}
```

---

## Phase 11: Persist the scan

Write `$VAULT/Architect/scans/{YYYY-MM-DD}-{theme-or-area-slug}.md`:

```markdown
---
date: 2026-05-01
mode: scan | area | resume
theme: state-management | (n/a for resume)
area: vault | (n/a unless area mode)
sub_agents_spawned: 4
findings_total: 8
findings_weak: 5
findings_strong: 2
findings_swap: 1
findings_struct_bug: 0
executed: [2]
queued: [1, 3, 5]
dropped: [4, 6]
reworked: [7, 8]
adrs_written: ["[[2026-05-01-loading-state-shape]]", "[[2026-05-01-poll-primitive]]"]
commits: [<sha1>, <sha2>, <sha3>]   # only if execute path was taken
branch: architect/loading-state-shape | "(committed to master)" | "(no execution this run)"
---

# Architect scan — {theme or area} ({date})

## Sub-agent reports
{1-2 sentence summary per angle, with link to full text if you want to keep
the full reports in working memory; otherwise omit}

## Findings

### [1] {title}  ➤ queued (ADR [[date-slug]])
**Type:** weak-pattern
**Reach / Risk / Effort / Payoff:** ...
**Verdict:** queued — {1 sentence reason}

### [2] {title}  ✅ executed → {commit shas}
**Type:** struct-bug
**Reach / Risk / Effort / Payoff:** ...
**Verdict:** executed; ADR [[date-slug]]; branch architect/{slug}

### [3] ...

## Strong patterns observed
- {pattern title} → noted in strong-patterns.md (or "codify" if user picked that)

## Cross-references
- Related ADRs (existing): [[...]]
- Related preferences: [[Patterns/architect-preferences]]
```

---

## Phase 12: Final summary

Print:

```
Architect run complete.

  Mode:           {scan | area | resume}
  Theme/area:     {theme or area name}
  Sub-agents:     {N} angles
  Findings:       {weak} weak / {strong} strong / {swap} swap / {sb} struct-bug

  Triage outcome:
    Executed:     {K} → ADR [[...]], commits {shas}, branch {branch}
    Queued:       {Q} (in backlog)
    Dropped:      {D}
    Reworked:     {R}

  Strong patterns:
    Identified:   {N} new this run
    Codified:     {C} → vehicles {[lint-rule|docs-stack|docs-claude|test-guard]}, commits {shas}
    Noted:        {M} → strong-patterns.md
    Aging surfaced: {A} (from prior runs ≥60d old)
    Aging actioned: {codified: K, snoozed: S, dropped: D}

  Files updated:
    + Obsidian/personas/Architect/scans/{date}-{slug}.md
    + Obsidian/personas/Lessons/{date}-architect.md
    + Obsidian/personas/Architect/decisions/{date}-{slug}.md  (× {N})
    ~ Obsidian/personas/Architect/backlog.md
    ~ Obsidian/personas/Architect/weak-patterns.md  (if any weak findings)
    ~ Obsidian/personas/Architect/strong-patterns.md  (if any strong findings)
    ~ Obsidian/personas/Architect/coverage.md
    {if pattern promoted:}
    ~ Obsidian/personas/Patterns/architect-preferences.md
    {if codebase-stack.md updated:}
    ~ .claude/codebase-stack.md

  Next steps:
    - {one concrete suggestion: "queue is at {Q} items; next /architect resume to ship one"}
    - {if strong pattern was noted: "consider /explorer or manual session to codify '{strong}'"}
    - {if branch was created: "merge architect/{slug} when ready"}
```

---

## Notes on use

- **Cadence** — once a week is plenty. Architect runs are heavy; the backlog absorbs the inventory and resume mode amortizes the work.
- **Scan vs resume** — alternate. Scan to fill the queue, resume to drain it. A backlog of 20 pending items means the next session should be resume, not scan.
- **Don't run while a heavy refactor is uncommitted on master.** Architect always wants a clean baseline. Stash or commit first.
- **The branch question is real** — say `no` when you're already on a topic branch and the change belongs there, or when the change is small enough that a feature branch is overkill. The default suggestion is `yes` because architect changes are typically not small, but the user's "no" is honored without pushback.
- **Conflict signal** — if a finding contradicts a `strong-pattern` already in the vault, treat it as the most interesting finding of the run. Either the strong-pattern entry is stale (codebase moved on) or the new finding is wrong. Either way, the answer changes the model meaningfully.
- **Drift signal** — if 3 consecutive scans on different themes produce backlog items but zero get executed via resume, the user is using architect as a brainstorming tool, not a shipping tool. Surface this in self-reflection: ask whether to lower the bar for execution or accept that the backlog is the artifact.
- **Tech swaps are the riskiest** — never propose a swap with reach ≥100 files unless smell strength is 5. A reach-280 swap (the react-hook-form example) is a multi-week project; the ADR's Rollout section should reflect that with 5–10+ atomic PRs.
