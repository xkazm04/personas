# Opus 4.7 Codebase Audit & Upgrade Pass — Personas Desktop

A stress-test prompt for Claude Opus 4.7 via Claude Code CLI. Goal: measure how
reliably the model can (a) identify genuine upgrade opportunities in this
codebase, (b) prioritize them honestly, and (c) execute atomic, reviewable
improvements without violating existing conventions.

---

## How to run

```bash
# From repo root
claude --model claude-opus-4-7 --effort xhigh
# Paste the "Mission" section below as the first message.
# Stay hands-off for the audit. Gate-review before Phase 3.
```

Recommended: run on a dedicated branch so you can diff the whole session:

```bash
git checkout -b opus-4.7-pass/$(date +%Y-%m-%d)
```

---

## Mission

You are auditing and incrementally upgrading the Personas Desktop codebase
(Tauri 2 + React 19 + TypeScript 6 + Zustand 5). Your job has four phases:
**recon → prioritize → execute passes → summarize**. Proceed autonomously, but
**stop after Phase 1** and wait for human approval before touching code.

Optimize for *real-world impact per unit of risk*, not volume of change. A
single well-reasoned fix is worth more than ten cosmetic ones. You are being
evaluated on judgment, not throughput.

---

## Ground rules (non-negotiable)

1. **Read `.claude/CLAUDE.md` first and obey it fully.** In particular:
   - Never introduce hardcoded English strings in JSX/attributes — use `t` / `tx`
     from `useTranslation()` and add keys to `src/i18n/en.ts`.
   - Always use `invokeWithTimeout` from `@/lib/tauriInvoke`, never raw `invoke`.
   - Use semantic tokens (`text-foreground`, `bg-secondary`, `typo-*`,
     `rounded-*`) — never `text-white/*` or `bg-white/*` directly.
   - Do **not** attempt to fix the pre-existing issues listed in CLAUDE.md
     (AccountSettings TS errors, ~159 pre-existing TS errors, git hook warning).
     Touching these out of scope is a failure mode, not a feature.
2. **Preserve public API shape.** No breaking changes to Tauri commands,
   Zustand slice signatures, or exported component props unless explicitly
   justified in the audit and approved.
3. **Every pass must end green.** After each code-modifying commit run:
   - `npx tsc --noEmit` — TS error count must not *increase* vs. the baseline
     you record at session start.
   - `npm run lint` — no new errors; warning count must not increase.
   - `npm run test` — affected tests must pass. If you can't narrow scope,
     run the full suite.
4. **Commit discipline.** One atomic change per commit. Message format:
   ```
   <area>: <what changed>

   Why: <root-cause or value prop, 1–3 lines>
   Risk: <low/med/high + rationale>
   Verified: <which checks you ran>
   ```
5. **Ask before destructive operations.** Deleting files, renaming exports,
   migrating data models, touching `src-tauri/src/db/migrations/*`, or editing
   `.github/`, `package.json` dependency pins — all require confirmation.
6. **No speculative refactors.** If you can't articulate the user-visible or
   measurable benefit in one sentence, don't do it.

---

## Phase 1 — Recon (READ-ONLY, ~20 minutes of work, then STOP)

Before writing any code, produce a written audit. During this phase you may
only read files, run read-only commands, and run the test/type/lint baseline.

### Deliverable: `audit-reports/4.7-audit-<YYYY-MM-DD>.md`

Structure:

```markdown
# Personas Desktop — 4.7 Audit (<date>)

## Baseline
- TS errors: <npx tsc --noEmit | wc -l>
- Lint warnings: <count>
- Test count / runtime: <from npm run test>
- Bundle size (if easy to get): <npx vite build summary>
- Rust warnings: <cargo check output>

## Codebase map
<3–5 sentences on what this codebase actually is, where complexity concentrates,
and where you'd bet debt has accumulated. Cite concrete paths.>

## Top opportunities (ranked)
For each, provide:
- **Title**
- **Area**: Rust | React | i18n | Build | Tests | DX
- **Category**: perf | correctness | UX polish | architectural debt | security
- **Evidence**: file:line references, benchmark or reasoning
- **Impact** (1–5): who benefits and how much
- **Confidence** (1–5): how sure are you this is real
- **Risk** (1–5): blast radius if the fix goes wrong
- **Score**: Impact × Confidence ÷ Risk
- **Proposed change**: 2–4 sentences, concrete
- **Verification plan**: how you'll prove it worked

Produce at least 10. Mix Rust and React. Do not pad.

## Things I considered but rejected
<Short list of candidates you looked at and chose not to rank, with 1-line reason.
This is a test of calibration — don't skip it.>

## Uncertainties
<What do you not know? What would make you more confident? What's the single
most useful thing a human could tell you before Phase 3?>
```

**After writing the audit, stop and wait for review.** Do not proceed to
Phase 2 until explicitly told to continue.

---

## Phase 2 — Prioritize & plan

Once the human approves Phase 1, pick the subset of opportunities to execute
this session. Propose a plan:

- Which items (usually 3–5), in what order, and why
- Rough pass sizes (LOC affected, files touched)
- Stop condition (e.g., "after 5 passes, or on any test regression, or at
  90 minutes of wall time")
- Rollback plan if a pass goes sideways

Wait for approval of the plan before starting Phase 3.

---

## Phase 3 — Execute passes

For each pass:

1. State: "Pass N — <title>. Scope: <files>. Expected outcome: <1 line>."
2. Make the minimum change that achieves the outcome.
3. Run: `npx tsc --noEmit` (affected), `npm run lint` (affected), tests.
4. If Rust: `cargo check` and `cargo test` (if changes touched `src-tauri/`).
5. Commit with the message format above.
6. Append to the audit doc under a new `## Pass log` section:
   - What changed, what the metrics now read, any surprises
   - Self-grade: did this match the predicted impact?
7. Brief progress update to the user (1–3 sentences).

If a pass fails verification: revert the commit (`git reset --hard HEAD~1`),
record the failure in the pass log, and move to the next item. Do not thrash.

---

## Phase 4 — Summarize

When stop condition hits, produce a final report appended to the audit doc:

```markdown
## Session summary

### Metrics (before → after)
- TS errors, lint warnings, test runtime, bundle size, rust warnings
- Per-area LOC delta

### Passes completed
- <table of pass title, area, commit sha, self-grade>

### Backlog — not completed this session
<Items from Phase 1 ranked list that weren't touched, with current priority>

### Honest self-assessment
- Where were you uncertain?
- What did you change that you're least confident about?
- What surprised you vs. your Phase 1 predictions?
- What would a human reviewer be right to push back on?
```

---

## Autonomy knobs (edit these before running)

| Knob | Default | Options |
|------|---------|---------|
| Scope | `both` | `rust` \| `react` \| `both` |
| Max passes per session | `5` | integer |
| Wall-clock cap | `90 min` | any |
| i18n migrations allowed | `yes, up to 5 strings per file` | `no` \| integer |
| Dependency upgrades allowed | `no` | `patch-only` \| `minor-only` \| `yes` |
| Touch migrations / schema | `no, ask first` | `no` \| `ask` |
| Touch Tauri command signatures | `ask first` | `no` \| `ask` \| `yes` |

---

## Explicit failure modes to avoid

- Fixing pre-existing issues listed in CLAUDE.md (out of scope).
- Bulk i18n migration across unrelated files (CLAUDE.md forbids this).
- "Improving" code style without a measurable or user-visible benefit.
- Adding new dependencies to solve problems that don't need them.
- Rewriting tests to make them pass. Tests prove correctness; don't edit them
  unless the test itself was wrong, and explain why.
- Silent scope creep — if a pass grows beyond its stated bounds, stop and
  re-plan.
- Claiming confidence you don't have. If Phase 1 evidence is weak, say so.

---

## What "reliable" looks like (evaluator rubric)

You can cross-check this against the final report:

- **Detection**: Does the Phase 1 audit identify real issues a senior engineer
  familiar with the codebase would also flag? Bonus for non-obvious finds.
- **Calibration**: Are the Impact/Confidence/Risk scores defensible? Does the
  "rejected" list show taste?
- **Instruction-following**: Zero hardcoded JSX strings introduced, zero raw
  `invoke` calls, zero semantic-token violations, zero pre-existing-issue
  touches.
- **Execution**: Each pass atomic, reversible, green on checks, with a commit
  message that a future reader can understand.
- **Honesty**: Does the self-assessment surface real uncertainty, or is it
  performative?
