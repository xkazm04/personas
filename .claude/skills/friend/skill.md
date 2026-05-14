# Friend

Endless companion loop scoped to one area of the personas codebase. Each cycle: scan → propose **5 development directions** → user picks a number → execute with repo conventions → report → propose 5 new directions. Designed for **parallel CLI sessions** where the user wants to keep adding UX / product value to a corner of the codebase with the least typing possible.

This skill is **personas-specific** and **development-flavored**. It does not do stabilization — that is `/explorer`'s job. It does not do heavy structural rewrites — that is `/architect`'s job. It does not look outside the repo — that is `/research`'s job. `/friend` exists for the long stretches where the user wants to keep evolving a feature area's product surface without composing prompts.

Companion to:
- `/explorer` — 10 paper cuts in an area, one-shot (quality / dx / perf / bug / a11y / i18n / sec)
- `/architect` — heavy structural cross-area sweeps, one-shot
- `/research` — external sources
- `/sentry` — fix prod errors

## Interaction conventions

Built for parallel CLI control — every user prompt is single-keystroke answerable.

- **Every prompt is a numbered menu.** Numeric input picks the option; **Enter** triggers the default; option `1. other → …` is the deviation lane (free text).
- **Every cycle ends with a `Next?` block** of 5 numbered next-direction options plus deviation + refresh. Replying with a digit advances the loop without typing prose.
- Long free-text answers are still accepted everywhere; the menu makes the common case instant.
- **No exit option in the menu.** The loop runs until the user interrupts, types a stop word in the deviation lane (`stop`, `done`, `bye`, `quit`), or the context window forces a wrap. On any of those, run the clean-exit ritual (Phase 6).

## Input

Ask **two** numbered-menu questions, in this order.

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

Numeric options 2–9 map 1:1 to the 8 groups in `.claude/codebase-context.md` — same mapping as `/explorer` and `/architect`. Option 1's free text falls through to the resolver (path fragment / keyword / exact context id). Option 10 / Enter triggers an auto-pick weighted by which area has had the least recent `/friend` activity (see Coverage below) — fall back to round-robin if no Coverage file exists yet.

### Q2 — Goal

```
Goal? (Enter = scan and propose)
  1. other → describe a vague intent (free text)
  2. scan and propose   ← default
  3. surprise me        — let me pick a stretch direction without telling me upfront
```

`scan and propose` and `surprise me` produce 5 directions; `surprise me` biases toward one bolder option and skips the user-readable scan summary.

A vague free-text intent (option 1) is layered as a prior over the auto-proposed directions but does not replace them — `/friend` still surfaces 5 options.

If the user typed `/friend` with no arguments, treat as area=`pick for me` + goal=`scan and propose`.

---

## Constants

- **Codebase reference files** (always loaded):
  - `.claude/codebase-context.md` — DB-derived feature map (8 groups, ~32 contexts). The natural area taxonomy.
  - `.claude/codebase-stack.md` — hand-curated architecture, conventions, engine internals.
  - `.claude/CLAUDE.md` — project rules (i18n, design tokens, error handling, lint baseline, parallel-safety primitives).
  - `.claude/Design.md` — design system canonical reference.
- **Active-runs ledger**: `.claude/active-runs.md` — register at Phase 0, deregister at Phase 6.
- **Vault root** (resolved at Phase 0): one of two paths, whichever exists. The vault is where `/friend` accumulates cross-session learning so feature selection improves over time. Mirror of the `/explorer` pattern, scoped to development-flavored directions instead of paper cuts.
  - `Friend/sessions/` — one note per session, the canonical artifact (mirrors `Explorer/sweeps/`)
  - `Friend/coverage.md` — heatmap of last `/friend` visit per area + acceptance density
  - `Friend/passes.md` — **rejected direction fingerprints per area**; Phase 2 reads this and avoids re-proposing. Hard rejects only (user typed "no", refresh, or "other" with reason); soft skips (user picked a different option this cycle) do NOT land here.
  - `Patterns/friend-preferences.md` — distilled rules promoted from `Lessons/` after **3+ observations**. Loaded by Phase 1; biases Phase 2 proposal shapes.
  - `Lessons/{date}-friend.md` — append-only per-session self-reflection. Shared folder with `/explorer` and `/research`; do NOT create the folder if missing — it lives at `$VAULT/Lessons/`.
  - `Architect/strong-patterns.md` (if present) — canonical shapes the codebase already does well. Phase 2 should **prefer the shape of an existing strong pattern** when proposing directions; reference it in the direction body.
- **Direction shape** — every proposed direction must:
  - Add or polish **user-visible product surface** (a new control, a clearer flow, a missing affordance, a small new capability, an interaction that makes an existing feature feel more finished).
  - Be implementable in **one atomic commit** that ships compiling, lint-clean code.
  - NOT be pure cleanup, dead-code removal, test-only changes, dependency bumps, or refactors without user-visible payoff. Those belong to `/explorer` / `/architect`.

---

## Phase 0: Setup (vault, ledger, worktree)

### 0a — Resolve vault path

```bash
if [ -d "C:/Users/mkdol/Documents/Obsidian/personas" ]; then
  VAULT="C:/Users/mkdol/Documents/Obsidian/personas"
elif [ -d "C:/Users/kazda/Documents/Obsidian/personas" ]; then
  VAULT="C:/Users/kazda/Documents/Obsidian/personas"
else
  VAULT=""   # vault is optional for /friend; we degrade gracefully
fi
```

If `$VAULT` is non-empty, bootstrap the Friend vault tree (idempotent — only create what's missing):

- `$VAULT/Friend/` (directory)
- `$VAULT/Friend/sessions/` (directory)
- `$VAULT/Friend/coverage.md` — header only:
  ```markdown
  # Friend Coverage

  Heatmap of areas visited by `/friend`. Used by Phase 0 auto-pick to favor stale, high-yield areas.

  ## Areas
  ```
- `$VAULT/Friend/passes.md` — header only:
  ```markdown
  # Friend Passes

  Per-area record of directions that were proposed and **hard-rejected** in past sessions.
  Future Phase 2 proposals over the same area filter against these. Soft skips (user picked
  a different option) are NOT recorded here — only hard rejects (explicit "no", refresh of
  the whole menu with a reason, or "other" with a rejection note).

  ## Areas
  ```
- `$VAULT/Patterns/friend-preferences.md` — header only (create `$VAULT/Patterns/` if missing):
  ```markdown
  # Friend Preferences (distilled from /friend sessions)

  > Rules upgraded from `Lessons/` after 3+ observations. Loaded by Phase 1; biases Phase 2.

  _No patterns yet. Will be populated as sessions accumulate._
  ```

Do NOT create `$VAULT/Lessons/` if it's missing — that folder is shared with `/explorer` and `/research` and they handle bootstrap. If it doesn't exist, `/friend` writes its lesson note alongside the others when one of those skills first creates it; until then, the Phase 6 lesson write is a no-op (log it to the session note instead).

### 0b — Read the active-runs ledger

Read `.claude/active-runs.md`. Scan `## Active` for entries whose declared `Paths:` overlap with the resolved area's path glob (see area→path mapping below) AND are `started`-status AND less than 2 hours old.

If overlap is found, present:

```
Heads up — another session is editing this area:
  <name> (started <hh:mm>, paths: <paths>)

What now? (Enter = proceed in worktree — physical isolation)
  1. other → free text
  2. proceed in worktree   ← default (recommended; worktree avoids collision)
  3. switch area
  4. abort
```

Default proceeds because `/friend` always runs in a worktree, so coexistence is safe; the prompt is informational so the user knows their commits land on a separate branch from the other session.

### 0c — Create the worktree

Compute a short slug: `friend-<area>-<HHMMSS>`. For example: `friend-agents-143012`.

```bash
SLUG="friend-<area>-$(date +%H%M%S)"
git worktree add ".claude/worktrees/$SLUG" -b "worktree-$SLUG"
cd ".claude/worktrees/$SLUG"
```

The entire loop runs inside the worktree. Branch name = `worktree-<slug>`. On clean exit (Phase 6), the worktree and branch are left in place — the user owns the merge decision.

### 0d — Append to active-runs ledger

Append to `## Active` in the **main checkout's** `.claude/active-runs.md` (not the worktree's copy — they share the same file via git's worktree semantics, so the Edit lands in the same place):

```
### friend — <area>
- Started: <YYYY-MM-DD HH:MM>
- Status: started
- Branch: worktree-friend-<area>-<HHMMSS>
- Worktree: .claude/worktrees/friend-<area>-<HHMMSS>/
- Paths: <area's path glob — e.g. src/features/agents/ src-tauri/src/commands/core/personas.rs>
- Note: /friend endless development loop
```

### 0e — Area → path mapping

For the ledger entry and for scoping the scan, resolve area to paths:

| Area | Primary paths |
| --- | --- |
| agents | `src/features/agents/` `src-tauri/src/commands/core/personas.rs` |
| vault | `src/features/vault/` `src-tauri/src/commands/credentials/` |
| orchestration | `src/features/teams/` `src/features/schedules/` `src-tauri/src/engine/` |
| triggers | `src/features/triggers/` `src-tauri/src/commands/communication/` `src-tauri/src/engine/event_registry.rs` |
| execution | `src/features/agents/sub_executions/` `src-tauri/src/commands/execution/` `src-tauri/src/engine/runner.rs` |
| templates | `src/features/templates/` `src-tauri/src/commands/design/` `src-tauri/src/engine/build_session/` |
| deployment | `src/features/deployment/` `src/features/share/` |
| platform | `src/features/settings/` `src/features/overview/` `src-tauri/src/commands/admin/` |

For free-text areas (Q1 option 1), use the same resolver as `/explorer` to map a hint → context → primary paths.

---

## Phase 1: Load memory + scan

### 1a — Read learning artifacts (once per session, not per cycle)

If `$VAULT` is set, read in parallel and hold in session context for the rest of the loop:

1. `.claude/codebase-context.md` — area taxonomy.
2. `.claude/codebase-stack.md` — engine internals, conventions.
3. `.claude/CLAUDE.md` — project rules (i18n, design tokens, IPC, parallel-safety).
4. `$VAULT/Patterns/friend-preferences.md` — distilled rules from prior sessions. Treat each rule as a Phase 2 constraint (e.g. "user prefers polish on hover/focus states over modal-style overlays" → bias proposals accordingly).
5. `$VAULT/Friend/passes.md` — the area's section, if present. Each line is a rejected-direction fingerprint. Phase 2 must filter against these.
6. `$VAULT/Friend/coverage.md` — last-visit date and acceptance density per area. Used by Phase 0 auto-pick; also surfaces here for the scan summary.
7. `$VAULT/Architect/strong-patterns.md` (if present) — canonical shapes. Prefer these when proposing.
8. The 3 most recent files in `$VAULT/Lessons/` matching `*-friend.md` (sorted descending) — recent self-reflection, e.g. "last session over-proposed modal-driven flows."

Skip any artifact that doesn't exist; never block on missing vault state.

### 1b — Scan the area (every session, lightweight)

Inside the worktree, do a **lightweight** scan to ground the proposals. Read budget: roughly **20–40 files**, weighted toward UI components and the most-recently-edited paths in the area. Do not exhaustively read everything — `/friend` is a fast loop.

Pull in parallel:

1. `git log --oneline --since="14 days ago" -- <area-paths>` — what's been moving here lately
2. `git diff --stat HEAD~10..HEAD -- <area-paths>` — recent volume by file
3. A `Grep` for `TODO|FIXME|XXX` scoped to the area
4. A `Grep` for `useTranslation\|t\.` to spot text-heavy components (potential UX surfaces)
5. The top of `.claude/codebase-context.md` group description for that area
6. 5–10 most-recently-modified files in the area (Glob with sorted-by-mtime)

For the `surprise me` goal, also pull two random non-trivial files from the area to seed something less obvious.

Synthesize a **two-sentence area summary** for the user (skip in `surprise me` mode):

```
<Area>: <one sentence on what's here>. <one sentence on what's been moving lately>.
```

---

## Phase 2: Propose 5 directions

Produce **exactly 5** development directions. Each direction is:

```
N. <short title — verb-led, 3–6 words>
   What:  <one line, ≤90 chars — concrete UX/product change>
   Why:   <one line, ≤90 chars — user-visible payoff>
   Touch: <est files, e.g. "~3 files">
```

Constraints on the 5:

- **Always development.** UX polish, missing affordances, small new capabilities, clearer flows, finished-feeling interactions, new product surfaces. If a candidate is "remove dead code", "extract a hook", "add tests", "bump a dep", drop it.
- **Default mix leans larger:** 1 small polish (visible in <1h), 2 medium feature add (1–3h), 2 stretch / bolder (could be 2–4h, may split across stages — see below). `surprise me` mode pushes further toward stretch (drop the small, add a second stretch). If a session signals a "dial down to polish" preference (user picks the small repeatedly, or explicitly says "smaller next time"), shift to 2 small / 2 medium / 1 stretch for subsequent cycles in that session. The default is biased toward larger because users running an unattended development loop are usually capable of taking on ambitious cycles, and small-only menus produce churny sessions that feel like cleanup rather than building.
- **Prefer deepening existing surfaces over net-new surfaces** in an established feature area. If the area already has obvious adjacent polish (a control that needs a sibling, a flow that needs a recap card, a panel that needs a sub-view of its own data), build on what exists. Net-new surfaces (a new tab, a new sidebar rail, a new page-level panel) should be at most **1 of the 5**. The remaining 4 slots are for direct extensions of code already in the area. Reason: net-new surface ideas read well as menu items but rarely match the user's actual want when they're already iterating on a feature.
- **Stages-of-N split is the natural shape for ambitious cycles**, not a fallback. When a direction's full payoff needs sequencing (schema migration + UI + brain wiring; new SQL view + IPC + tab + chart), present it as "stage 1 of N" with the stage-1 description capturing exactly what lands in this commit. Propose the next stage in a later cycle. This keeps the atomic-commit invariant honest while letting the loop tackle real product work that doesn't fit one commit. Mark explicitly in the direction body: `Stage 1 of N — ships <X>; next stage wires <Y>.` so the user knows what they're picking.
- **Each cycle is one atomic commit.** No exceptions. Stages-of-N spreads one ambitious direction across multiple cycles, but each cycle individually is still one commit that compiles and lints clean.
- **Honor CLAUDE.md.** Every direction must be implementable without violating i18n / design-token / IPC / error-handling / max-lines / parallel-safety rules.
- **No repeats.** Track proposed-and-completed direction titles within the session; do not re-propose. Track proposed-and-rejected titles within the session too — only re-propose if the user explicitly says "you can re-propose."
- **Drop in-session 2× soft-skips.** Maintain a set of direction titles the user has soft-skipped (i.e. picked something else when this was on the menu) in the current session. If a title hits the set twice and is still unpicked, **stop re-proposing it for the rest of the session**. The same direction can return in a future session (it's not a hard reject), but burning a 5-slot menu position on something the user has already passed on twice is noise. Net-new-surface ideas in particular tend to keep getting re-proposed because they're easy to generate — this rule is the in-session brake.
- **Filter against `Friend/passes.md`.** Any candidate whose fingerprint (area + short title + one-line What) closely matches a past hard-reject in this area is silently dropped before presentation. If it's a *near*-match (same target file, different angle), surface it but annotate `↻ previously passed; resurfacing because <reason>`.
- **Honor `Patterns/friend-preferences.md`.** Distilled rules (e.g. "prefer inline editing over modal overlays in this codebase") are hard constraints, not suggestions. If a candidate violates a preference, drop it.
- **Honor `Architect/strong-patterns.md`.** When the area has a canonical shape (e.g. "execution panels use the SidePanel primitive, not Dialog"), propose directions that reuse the canonical shape; reference the pattern by name in the direction body.

Present:

```
Area: <area>  Worktree: <slug>  Cycle: <n>

<scan summary, omit in surprise-me>

Next? (pick a number — Enter = 2)
  1. other → describe a direction in free text
  2. <Direction A title>                    ← default
  3. <Direction B title>
  4. <Direction C title>
  5. <Direction D title>
  6. <Direction E title>
  7. refresh — rescan and propose 5 new directions
```

For cycles 2+ in the same session, replace the scan summary with a one-line delta: `Since last cycle: <last commit title>, <files touched>`.

If the user types a stop word (`stop`, `done`, `bye`, `quit`, `exit`) in the free-text lane, jump to Phase 6.

---

## Phase 3: Risk gate

Before executing the chosen direction, you (the model) **silently judge** whether the path is materially risky. There is no hardcoded checklist — use judgment. Things that should trip the gate include but are not limited to:

- Changes to database schema, migrations, or table shape
- Renaming or removing a Tauri command, IPC contract, or exported ts-rs binding
- Touching credential storage, keyring backends, or AES-encrypted fields
- Cross-area scope creep (the direction reads like one area but actually touches many)
- Deleting >50 lines of any single file, or removing a component / module
- Anything that would change behavior of a currently-active scheduler / runner / cron path
- Anything that affects production-only code paths the user cannot easily verify locally
- Anything that would invalidate the lint or typecheck baseline beyond the file being touched

If the gate trips, pause and ask before acting:

```
Heads up: <one sentence on why this is risky, in plain language>.
<one sentence on the alternative shape if relevant>.

Proceed? (Enter = yes)
  1. other → describe an alternative
  2. yes
  3. narrower scope — describe the smaller version
  4. skip — pick a different direction
```

If the gate does **not** trip, execute immediately without asking. Do not ask for confirmation on routine UX/feature work — that is the entire point of the loop.

---

## Phase 4: Execute

Implement the chosen direction inside the worktree. Treat CLAUDE.md as binding. The non-negotiables most likely to apply on a `/friend` cycle:

### Frontend
- **i18n** — every new user-visible string goes to `src/i18n/locales/en.json` under the right section; access via `useTranslation()` / `t.section.key`. Never hardcode JSX text, placeholder, title, or aria-label.
- **Design tokens** — `typo-*` for text, `rounded-{interactive,input,card,modal}`, `shadow-elevation-1..4`, `bg-secondary/*` / `text-foreground/*` instead of `bg-white/*` / `text-white/*`. Refer to `.claude/Design.md`.
- **Tauri IPC** — always `invokeWithTimeout` from `@/lib/tauriInvoke`.
- **Errors** — `toastCatch()` for user-facing, `silentCatch()` for background. No empty `catch {}`.
- **Status tokens** — Rust ships machine tokens (e.g. `"queued"`); use `tokenLabel(t, 'execution', row.status)` to display.

### Backend
- **ts-rs** — if you `#[derive(TS)] #[ts(export)]` a new struct or change a derived one, run from the worktree:
  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml export_bindings
  ```
  Commit the resulting changes in `src/lib/bindings/`. (Note the dual-tree drift caveat in [user memory](../../../../.claude/projects/C--Users-kazda-kiro-personas/memory/feedback_ts_rs_bindings_dual_tree.md) — verify `src/lib/bindings/` actually updated; copy from `src-tauri/bindings/` if not.)
- **New Tauri commands** — also run `node scripts/generate-command-names.mjs` (or any `npm run dev` / `npm run build` will trigger it).
- **AppError** — new error variants need both the enum addition and the `Serialize` match arm.
- **Migrations** — additive only on `/friend` cycles. Anything destructive trips the Phase 3 gate.

### Docs
- If the direction is user-visible and touches one of the source areas mapped in `scripts/docs/feature-doc-map.json`, update the matching `docs/features/<area>/README.md` in the **same commit**. The Stop hook will catch this otherwise.

### Validation (before the commit)

Run, scoped to what was touched:

- TypeScript: `npx tsc --noEmit` if any `.ts`/`.tsx` changed.
- Lint: `npm run lint` (silenced — only fail on new errors above the baseline; warnings are fine on the `custom/no-raw-*-classes` / `custom/no-hardcoded-jsx-text` migrations, but never on the lines you just wrote).
- Rust: `cargo check --manifest-path src-tauri/Cargo.toml` if any `.rs` changed in `src-tauri/`.
- Tests: skip by default — `/friend` is fast cycles. Only run `npm run test -- <path>` if the direction explicitly added or changed test files.

If a check fails: fix inline in the worktree, re-validate, then commit. Do **not** stack failing work into the next cycle.

### Commit

One atomic commit per direction. Message shape:

```
<type>(<scope>): <imperative title from the direction>

<2–4 sentences: what changed, why user-visible. No bullet lists.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

`<type>` from {`feat`, `feat(ux)`, `feat(ui)`, `polish`}. `/friend` rarely produces `fix` / `refactor` / `chore` — if you find yourself reaching for those types, the direction was probably stabilization and should have been rejected at Phase 2.

Stage only the files you intentionally touched (`git add <path>` per file, never `git add -A` / `git add .` / `git add -u`). Before the commit, verify the staged count matches: `git diff --cached --stat`. If the staged-file count exceeds what you wrote, run `git restore --staged <unrelated-file>` per file before committing. This is the discipline from CLAUDE.md's parallel-safety section §5.

After commit: `git rev-parse --short HEAD` to capture the SHA for the report.

---

## Phase 5: Report + propose next 5

Print the report:

```
✓ <direction title>  (cycle <n>)
  Commit: <sha>  ·  Files: <N>  ·  +<a>/-<b>
  Did:  <one sentence — what changed, behavior-first>
  Checks: tsc <✓|—>  lint <✓|—>  cargo <✓|—>
  Worktree: .claude/worktrees/<slug>/   Branch: worktree-<slug>

Since last cycle: <previous direction or "first cycle">

Next? (Enter = 2)
  1. other → describe a direction
  2. <new Direction A>                    ← default
  3. <new Direction B>
  4. <new Direction C>
  5. <new Direction D>
  6. <new Direction E>
  7. refresh — rescan area and propose fresh
```

The 5 new directions follow the same constraints as Phase 2:
- Always development; no stabilization.
- Spread across small / medium / stretch.
- Do not re-propose anything already executed or rejected this session.
- May build on the just-completed cycle (e.g. if cycle N landed a new control, cycle N+1 could propose a polish on it) but should not require it — the user should be able to pick any of the 5 independently.

Loop back to **Phase 3** with the chosen direction. The loop has no built-in stopping condition.

### Optional codex-gf feature log

After every 3rd cycle (or after a cycle that landed >5 files), POST a single entry to the codex-gf feature log per CLAUDE.md's "Feature Log Sync" section. Probe `http://localhost:3001/api/feature-log` for 200; if not 200, silently skip. The log entry summarizes the *session arc* up to that point, not the single most recent cycle.

---

## Phase 6: Clean exit + learn

Triggered by: user typing a stop word in the free-text lane, an explicit interrupt, or the context window forcing a wrap. This is also where `/friend` gets smarter — every session must close the learning loop, not just save work.

### 6a — Stabilize the worktree

1. **If anything uncommitted:** decide whether to commit. If the last cycle was interrupted mid-execute, prefer to discard the partial change (`git restore .`) rather than commit broken work; surface this decision to the user with a numbered confirm if they are still responsive.
2. **Update active-runs.md** in the main checkout: move your `## Active` entry to the top of `## Recently completed`. Status: `completed (branch: worktree-<slug>, commits: <count>, last: <sha>)`. Keep the entry under 6 lines.

### 6b — Capture rejection reasons (one batched question)

Before writing the learning artifacts, ask the user a single batched question to attribute *why* the unpicked directions were unpicked. This is what makes `passes.md` and the preferences file actually useful — the title alone isn't enough signal.

```
For the directions you didn't pick this session, was it:
  [from cycle N] {title}
  [from cycle M] {title}
  ...

Reply per-item ("N: too risky, M: wrong layer") or one overall reason.

Shortcuts:
  skip    — record "no reason given" (still a soft skip, not a hard reject)
  hard <ids>  — mark these as hard rejects in passes.md (e.g. "hard N,M")
  Enter   — same as "skip"   ← default
```

Distinguish:
- **Soft skip** (default for unpicked) — could be re-proposed in a future session; does NOT land in `passes.md`. Recorded in the session note only.
- **Hard reject** (user typed `hard <ids>` or gave a reason that reads as principled refusal, e.g. "wrong direction", "we already tried this", "doesn't fit the product") — lands in `passes.md` so future sessions skip it.

### 6c — Write the session note

`$VAULT/Friend/sessions/{YYYY-MM-DD}-{slug}.md`:

```markdown
# Friend session: {area} — {YYYY-MM-DD HH:MM}

Worktree: `.claude/worktrees/{slug}/`
Branch: `worktree-{slug}`
Cycles: {N}
Commits: {first-sha}..{last-sha}

## Cycles

### Cycle 1 — ✓ {title} ({sha})
- What: {one line}
- Files: {N}, +{a}/-{b}
- Other proposed (soft-skipped): {titles}

### Cycle 2 — ✓ {title} ({sha})
- ...

## Hard rejects this session

- [{area}] {title} — {reason} (→ added to passes.md)

## Cross-references

- Related preferences: [[Patterns/friend-preferences]]
- Strong patterns referenced: [[Architect/strong-patterns]] §{pattern-name}
```

### 6d — Append to Lessons (shared folder)

If `$VAULT/Lessons/` exists, write/append `$VAULT/Lessons/{YYYY-MM-DD}-friend.md`:

```markdown
## Session: {timestamp} — {area} ({N} cycles)

Accepted: [list of titles]
Hard-rejected: [list with reasons]
Soft-skipped: [list]

### Self-reflection
- Direction shapes that resonated: {pattern observed}
- Direction shapes that didn't: {pattern observed}
- Calibration drift: {e.g. "proposed 4 modal-driven flows out of 15; only 1 picked — over-weighting modals in agents area"}
- Tools/files I should have read earlier: {observation}
- Strong patterns I should reuse more: {observation}
```

If `$VAULT/Lessons/` does not exist, embed this block at the bottom of the session note instead (do not create the shared folder unilaterally).

### 6e — Update `passes.md`

For each direction marked hard-reject in 6b, append a fingerprint to `$VAULT/Friend/passes.md` under the area's section (create the section if missing):

```markdown
## {area}

- {short-title} — {one-line What from the proposal} — pass {date}, session {slug}, reason: {short reason}
```

Keep entries short. The fingerprint is what Phase 2 filters against next session.

### 6f — Update `coverage.md`

Update or insert the row for this area in `$VAULT/Friend/coverage.md`:

```markdown
## Areas

### {area-slug}

- Last visited: {date}
- Last session: [[Friend/sessions/{date}-{slug}]]
- Cycles last 3 sessions: [3, 5, 2]
- Acceptance density last 3 sessions: [3/8, 5/15, 2/6]   <!-- picked/proposed -->
- Notes: {anything noteworthy across sessions}
```

### 6g — Pattern promotion check

Read all `$VAULT/Lessons/*-friend.md` (cap at the last 20 files for speed). If any single observation — accepted shape or rejected shape — has appeared in **3+ sessions** with close-synonym phrasing, propose adding it to `$VAULT/Patterns/friend-preferences.md`:

```
I've seen this 3+ times across sessions — promote to a permanent preference?

  "{distilled rule, e.g.: prefer inline editing affordances over modal dialogs in agents/}"

Source sessions: [[2026-05-01-friend-agents]], [[2026-05-06-friend-agents]], [[2026-05-12-friend-agents]]

Next? (Enter = 1)
  1. promote to Patterns/friend-preferences.md   ← default
  2. snooze — re-ask after 3 more observations
  3. drop — don't promote, reset the counter
```

If the user picks 1 (or Enter), append to `Patterns/friend-preferences.md` with the rule + the source-session backlinks. This is the slow loop that makes Phase 2 better over weeks of use.

### 6h — Print the exit summary

**Do NOT auto-merge to master.** Do NOT delete the worktree or branch. The user owns the merge decision. Print:

```
Session done.
  Branch:    worktree-{slug}
  Worktree:  .claude/worktrees/{slug}/
  Commits:   {count}  ({first-sha}..{last-sha})
  Area:      {area}
  Acceptance: {picked}/{proposed}  ({pct}%)

To merge: from the main checkout,
  git merge --no-ff worktree-{slug}
To inspect first:
  git log --oneline worktree-{slug} ^master
  git diff master...worktree-{slug}
To discard:
  git worktree remove .claude/worktrees/{slug} && git branch -D worktree-{slug}

Files updated:
  + Obsidian/personas/Friend/sessions/{date}-{slug}.md
  + Obsidian/personas/Lessons/{date}-friend.md   (if Lessons/ exists)
  ~ Obsidian/personas/Friend/coverage.md
  ~ Obsidian/personas/Friend/passes.md           (if any hard rejects)
  ~ Obsidian/personas/Patterns/friend-preferences.md  (if pattern promoted)
  ~ .claude/active-runs.md                       (ledger entry moved to completed)
```

---

## Learning artifacts (how the loop gets smarter)

The vault holds three artifacts that turn `/friend` from a stateless proposer into a sharpening tool over time. Mirror of `/explorer`'s machinery, scoped to development directions:

| File | Lifecycle | What it does |
| --- | --- | --- |
| `Friend/passes.md` | Append on hard-reject (Phase 6e). Read in Phase 1 / used in Phase 2 filter. | Stops `/friend` from re-proposing directions the user already principled-refused. Title-level fingerprint per area. |
| `Patterns/friend-preferences.md` | Append after 3+ observations (Phase 6g). Read in Phase 1 / hard constraint in Phase 2. | Distilled rules ("prefer X over Y in this codebase"). Slow loop; one promotion per session at most. |
| `Lessons/{date}-friend.md` | Append every session (Phase 6d). Last 3 read in Phase 1. | Per-session self-reflection. Source signal for the promotion check. |

`Friend/coverage.md` is the fourth artifact — last-visit dates and acceptance density per area. Powers the Q1 auto-pick weighting. Updated at Phase 6f.

Never block on any of these being missing — degrade gracefully. The first 2–3 sessions over a new area will run with no learned signal, and that's fine; the artifacts populate themselves.

### Pacing expectations (so users don't read "smarter over time" as "smarter on cycle 2")

The vault learning loop is real but **slow on purpose**. Concretely:

- **Session 1 over a new area:** zero patterns loaded, zero passes. Phase 2 proposals are pure scan-driven. The session writes its first Lesson entry. Expect this to feel like a stateless skill.
- **Sessions 2–3:** the in-session sticky-drop and any soft-skip filtering still come from current-session memory; cross-session signal only kicks in via the Lesson notes the model reads at Phase 1, which influence proposal *shape* but rarely cause hard filtering yet.
- **Session 3–4** is typically the first time the pattern-promotion check at Phase 6g triggers — 3+ observations of a close-synonym phrasing across Lesson notes promotes a rule to `Patterns/friend-preferences.md`, which becomes a *hard constraint* in Phase 2 from then on.
- **Session 5+:** the area starts feeling like it has a personality. Promoted preferences filter out shapes the user has rejected before; coverage scoring routes auto-pick to fresher areas; passes.md keeps the same bad idea from resurfacing.

If the user expects "/friend will adapt to my taste by cycle 2," they'll be disappointed. The right mental model: **the skill is sharpening, not adapting on every turn.** Surface this expectation in the Phase 6 exit summary on early sessions ("first pattern promotion typically happens around session 3–4 as observations accumulate") so the slow-loop design doesn't read as a missing feature.

---

## Non-goals (do not do these)

- **No stabilization.** If a direction reduces to lint cleanup, dead-code removal, type tightening, or test addition without behavior change, drop it from the Phase 2 menu. Suggest the user run `/explorer` for that area.
- **No multi-commit directions.** If a direction can't be done in one atomic commit while keeping the worktree compiling and lint-clean, split it or reject it.
- **No cross-area scope creep.** If executing a chosen direction reveals it needs to touch files outside the area, Phase 3's risk gate should trip and ask the user.
- **No auto-merge.** The worktree and branch are left for the user to inspect and merge on their own time.
- **No silent stash.** Per CLAUDE.md parallel-safety §1: never `git stash` to clean the tree. Use `git add <path>` per file in Phase 4 and verify the staged count.
- **No `--no-verify` / `--no-gpg-sign`.** If a hook fails on commit, fix the underlying issue.
- **No memory writes** about routine cycles. Only write a `feedback_*` memory if the user gives explicit guidance during a `/friend` session that would generalize across future sessions.

---

## Quick reference (one-screen)

```
/friend
  Q1: Area? (1=other, 2..9=area, 10=pick for me)         ← Enter = 10
  Q2: Goal? (1=other, 2=scan-and-propose, 3=surprise)    ← Enter = 2
  →  Phase 0  vault + bootstrap learning files + ledger + worktree
  →  Phase 1  load passes + preferences + recent lessons, then scan area
  →  Phase 2  propose 5 dev directions (filtered against passes + preferences)
LOOP:
  →  Phase 3  silent risk gate; ask only if risky
  →  Phase 4  execute → validate → atomic commit
  →  Phase 5  report + propose 5 new directions  ─┐
                                                  │ user picks number → Phase 3
EXIT (stop word / interrupt / context wrap):
  →  Phase 6  capture rejections → session note → Lessons → passes → coverage
              → pattern-promotion check → ledger → exit summary
              (worktree + branch left intact for user merge)
```
