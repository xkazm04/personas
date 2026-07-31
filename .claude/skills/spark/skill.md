---
name: spark
contexts: tracked
memory: vault
category: Development
description: Turn a vague product idea (a "sparkle") into a complete, grounded design through waves of select/multi-select questions — then orchestrate the build. Uses the context map to target exactly which contexts/files the idea touches, scouts them before asking anything, converges the design across four perspectives (functional, UX, UI, performance/architecture), and executes via builder subagents in a worktree under Director review. All runs live in a linked Obsidian vault; every run ends with a self-improvement retro that sharpens the skill itself. Invoke with `/spark <idea…>` or `/spark resume <slug> | status | reflect`.
argument-hint: "<idea…> | resume <slug> | status | reflect"
---

# Spark — sparkle in, fire out

> The operator's strength is *having* the idea; the model's strength is everything between the idea and the shipped commit: locating it in 400k LOC, knowing what already exists, asking the few questions that actually matter, designing across perspectives the operator wouldn't pause on, and building without drift. `/spark` is that bridge. **One invocation = one idea, end to end: target → scout → design waves → brief → build → retro.** Multiple sparks run as parallel CLI sessions, isolated by worktrees and coordinated by the active-runs ledger.

## Roles

- **Director (the main session).** Owns targeting, question design, the design brief, builder briefs, diff review, merge decisions, gates, vault writes, and the retro. Never delegates judgment.
- **Scouts (Explore subagents, read-only, cheap).** One per target context: current-state brief with `file:line` evidence. A surface only "exists" if it renders — trace mount points.
- **Builders (strong subagents, one per work package).** Tight brief + acceptance criteria + file scope; work in the spark's worktree; return structured reports; return questions instead of guessing.

## The Obsidian vault

```bash
VAULT="C:/Users/kazda/Documents/Obsidian/personas"   # fallback: <repo>/.spark/ (same schema)
```

```
Spark/
  Spark.md                 # HOME: idea ledger table (slug · status · contexts · one-liner · last session),
                           #   fire count (shipped), link to last session
  config.md                # per-repo overlay: gates, wave defaults, perspective checklist,
                           #   ## Question taste (learned — what the operator wants asked vs decided for them)
                           #   ## Skill improvement log (append-only, one dated line per retro finding)
  ideas/<slug>.md          # one per spark, cradle-to-grave (see schema)
  sessions/<YYYY-MM-DD[-n]>.md  # immutable run records, end with `next:` pointer
```

**Idea note** (`ideas/<slug>.md`) — the atom of the loop:

```markdown
---
slug: <kebab, stable>        type: spark/idea
status: sparked | scouted | designing | designed | building | shipped | parked | dropped
contexts: [<context-map names>]      groups: [<groups>]
sparked: <date>   designed: <date|—>   shipped: <date|—>   commit: <sha|—>
waves_used: <n>   questions_asked: <n>
---
## Spark          (the operator's words, near-verbatim — never paraphrase away intent)
## Targeting      (contexts chosen + why; contexts considered and excluded + why)
## Scout digest   (what exists today, file:line; what the idea collides with or can reuse)
## Design decisions   (one line per answered question: Q → chosen option → implication.
##                     Include options REJECTED — they are memory for the next wave and next spark.)
## Design brief   (the buildable contract — see Phase 3 schema)
## Build record   (work packages, builder reports digest, review verdicts, gate results, SHAs)
## Retro          (what the process got wrong/right on THIS idea — feeds config.md log)
```

**Vault safety (non-negotiable, inherited from /perfect's 2026-07-29 incident):** the vault is not version-controlled and Obsidian file-recovery never sees agent writes. Never `open(path,'w')` a note you didn't create this session; session-note names collide — probe and suffix `-2`, `-3`. Re-read `Spark.md` immediately before every write; never patch from a stale Phase-0 copy. After any parallel phase, `ls` the target dir and backfill missing notes from returned agent content.

## The loop

### Phase 0 — Recall & register
1. Read `Spark.md` (missing → scaffold vault + `config.md` with: gates = `npm run check`, `npm run test -- --run`, `check:i18n:strict` when locales touched, `cargo clippy` + `npm run test:rust` when Rust touched; wave size = one AskUserQuestion call of up to 4 questions; default max 3 waves; perspective checklist = functional / ux / ui / performance-architecture / integration).
2. Parse invocation: new idea text → new slug; `resume <slug>` → jump to the phase its `status` names; `status` → render the ledger table and stop; `reflect` → Phase 6 only.
3. Repo rituals: read `.claude/active-runs.md`, surface overlaps with the idea's likely scope, append this session's entry (one bash invocation — the ledger is unsafe to edit-then-commit across concurrent sessions). Scan MEMORY.md for veto signals.
4. Record the spark verbatim in `ideas/<slug>.md` (`status: sparked`).

### Phase 1 — Target (context map, not vibes)
1. Read the root `CLAUDE.md` generated block + `context-map.json`. **Sizing rule:** the app's database is the authority; if the committed file disagrees with the generated block, trust the block's counts and use the file only for names/paths.
2. Map the idea to **1–3 primary contexts** (where code changes land) and up to 3 **touched contexts** (integration points: stores, IPC commands, shared components, i18n). Name them and the reasoning in `## Targeting` — including near-miss contexts you excluded, so a wrong targeting is diagnosable at retro.
3. If targeting is genuinely ambiguous (two plausible homes with different architectures), that is **wave-1 question #1** — never guess silently, never ask more than one targeting question.

### Phase 2 — Scout before asking
Launch one Explore scout per primary context (parallel, "very thorough"): what exists, what the idea overlaps/duplicates, reusable primitives (check `shared/components/CATALOG.md` for UI ideas), data model touchpoints, perf-relevant volumes, `file:line` evidence. Digest into `## Scout digest` (`status: scouted`).

**Grounding rule: no question reaches the operator that the code could have answered.** "Should this be a new tab or extend X?" is only a valid question if the scout confirmed X exists, renders, and could host it.

### Phase 3 — Design waves (the heart)
Converge the design through **waves of AskUserQuestion** (each call = up to 4 questions; single-select for architecture forks, multiSelect for scope composition). **There is no wave cap** — a large feature legitimately takes a long dialog. The loop terminates on *clarity*, not on count: after every wave, re-run the completeness checklist below; iterate while any item is genuinely open, stop the moment none are. The discipline is per-question, not per-run: every question must be one whose answer changes the design (see craft rules) — an unnecessary question is a flaw at any wave number, and ten necessary waves are not.

**Wave composition — questions are ordered by decision leverage, not by perspective:**
- **Wave 1 — shape:** the questions whose answers change everything downstream. Scope boundary (multiSelect: which of these 4–6 scouted capabilities is v1?), the one architecture fork, the primary user moment, targeting disambiguation if needed.
- **Middle waves — perspectives sweep:** work through the perspectives *still genuinely open* after the shape settled: **functional** (edge behaviors, empty/error states), **UX** (entry point, flow, what the user sees while waiting — loading pattern v2 applies), **UI** (which shared primitives / where it lives visually; per Design.md), **performance/architecture** (data volume expectations, caching, sync vs background, engine impact). Deep ideas may need several waves inside one perspective — follow-up questions that only became possible after the previous answer are the sign the dialog is working, not drifting.
- **Final wave — residue:** whatever the checklist pass still marks open. If a wave's answers OPEN more items than they close for two consecutive waves, the spark is compound — propose splitting it into two ideas rather than continuing.

**Question craft rules:**
1. Every option is a real, scouted, buildable choice — description names the trade-off in one line. Put your recommendation first, marked "(Recommended)".
2. **Decide, don't ask, when convention already answers:** repo conventions (i18n, tokens, shared components, error handling, loading UX) are never questions. Consult `config.md → ## Question taste` — it accumulates what this operator wants to be asked vs. have decided for them. Operator "Other" answers and corrections are the strongest taste signal; capture corrections via the Decision Mirror ritual in the same turn.
3. After each wave, write `## Design decisions` immediately (chosen AND rejected options) — a killed session must lose nothing.
4. **Completeness gate before leaving Phase 3** — the perspective checklist, answered either by operator choice, convention, or explicit Director decision (marked as such):
   functional scope ▸ data model & persistence ▸ IPC/commands surface ▸ UX flow + all async/empty/error states ▸ UI surfaces + shared-component reuse ▸ i18n plan ▸ performance posture ▸ failure modes ▸ docs-sync surfaces affected ▸ out-of-scope list.

### Phase 4 — The brief & the go-gate
Write `## Design brief` in the idea note:

```markdown
### Summary        (three sentences a PM would sign)
### Work packages  (1–4, each ONE builder session: files touched, what changes, acceptance criteria 3–6 checkable bullets)
### Data & IPC     (schema/migrations, new commands, ts-rs bindings to regen)
### UX/UI spec     (per-surface: states, components from catalog, tokens, loading pattern)
### i18n keys      (sections touched; translation pipeline required before commit)
### Non-goals      (explicitly rejected options from the waves)
### Risks
```

Gate with one AskUserQuestion: **Build now / Adjust (say what) / Park it** (`status: designed`). "Adjust" loops one targeted wave, not a restart. "Park" is a first-class success — a designed-but-parked idea is a shippable asset in the vault.

### Phase 5 — Fire (execution)
1. `git worktree add .claude/worktrees/spark-<slug> -b worktree-spark-<slug>` — all multi-file work isolates; parallel-safety primitives from CLAUDE.md apply in full (stage per-file, verify `git diff --cached --stat` count, never stash).
2. One builder per work package, sequential when packages share files, else parallel. Brief = the work package + repo-convention digest + "return questions, don't guess".
3. Director reviews every diff against acceptance criteria (not vibes), runs the gates from `config.md`, fixes-or-bounces, commits atomically per package (`Co-Authored-By` footer). i18n keys go through the translate-extract/merge pipeline before commit — strict coverage is a pre-commit hook, not optional.
4. Docs-sync: update the coupled `docs/features/*` / onboarding / marketing surfaces the Stop hook will name, in the same session.
5. Merge to master only when all gates are green; then remove the worktree + branch (Phase-13 ritual). `status: shipped`, record SHA.

### Phase 6 — Retro (the self-improving mechanism)
Before deregistering from the ledger, the Director audits **the process, not the product**, and writes `## Retro` + appends dated one-liners to `config.md → ## Skill improvement log`:
- **Targeting accuracy:** did the build touch contexts targeting missed, or skip ones it named?
- **Question efficiency:** which questions changed nothing downstream (should have been convention)? What did the operator answer via "Other" that the options should have contained? Any correction → it's already in the Decision Mirror; mirror the lesson into `## Question taste`.
- **Scout misses:** anything the builders discovered that the scout should have surfaced?
- **Execution friction:** gate failures, builder bounces, rework — and the upstream design decision that would have prevented each.
- **Skill edits:** if ≥2 sessions' logs point at the same flaw, propose a concrete edit to THIS file — gated with the operator, never silent.

Wrap: session note with `next:` pointer, update `Spark.md` ledger, move the active-runs entry to Recently completed with the SHA.

## Invariants
- One spark per session by default; the vault + ledger + worktrees are what make many parallel sparks safe.
- The operator's verbatim spark text is sacred — design converges *toward* it; scope creep beyond it needs an explicit question.
- Waves are uncapped; clarity is the terminator. Each question must earn its place (its answer changes the design); the checklist decides when the dialog is done. Two consecutive waves that open more than they close → propose splitting the spark.
- Never mark shipped on tsc/cargo alone — the gates run, and UI work gets observed, not assumed.
