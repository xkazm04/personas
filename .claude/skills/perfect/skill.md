---
name: perfect
description: Session-after-session product perfection loop. The strongest available model (Fable) directs — it walks the repo's context map context-by-context, proposes 5 challenged, high-value directions per context (features, design elevations, significant optimizations), gates them with the user until 10 are accepted, then orchestrates one Opus builder subagent per context in isolated worktrees while making every review/merge decision itself. All state lives in a linked Obsidian vault so any future session resumes the loop exactly where the last one stopped. Invoke with `/perfect [init|propose|build|status|reflect] [context-name]`.
---

# Perfect — the direction-and-delivery loop

> One model is best at *judgment* — seeing what would make a product excellent, challenging its own ideas, reviewing diffs ruthlessly. Cheaper strong models are great at *execution* inside a well-scoped brief. `/perfect` wires the two together in a permanent loop: **Fable directs, Opus builds, the vault remembers.** Each session moves the product measurably closer to the best UX, architecture, and feature quality it can have; no session ever starts from zero.

## Roles — Director and Builders

- **Director (the main session — Fable, or the strongest model available).** Owns everything that is judgment: opportunity-scoring contexts, drafting directions, adversarially challenging them before the user ever sees them, running the acceptance gate, writing builder briefs, answering builders' product questions mid-flight, reviewing every diff, deciding merge/redo/drop, running the repo gates, committing, and writing the vault. The Director **never delegates a decision** to a builder and never rubber-stamps a builder's diff.
- **Builders (Opus subagents, `model: "opus"`, one per context).** Each receives a tight brief (direction specs + acceptance criteria + the context's `file_paths` scope + repo-convention digest) and implements in its **own worktree**. Builders return a structured report; when they hit a genuine product ambiguity they **return the question instead of guessing** — the Director answers via `SendMessage` and the builder continues.
- **Scouts (Explore subagents, cheap).** Produce the per-context current-state brief the Director synthesizes directions from. Never used for judgment.

## The Obsidian vault — durable loop state

Resolve the vault root (first hit wins), then use `$VAULT/Perfect/`:

```bash
for v in "C:/Users/kazda/Documents/Obsidian/personas" "C:/Users/mkdol/Documents/Obsidian/personas"; do
  [ -d "$v" ] && VAULT="$v" && break
done
# Portable fallback: if no Obsidian vault exists, use <repo>/.perfect/ (same schema — still an Obsidian-openable folder).
```

```
Perfect/
  Perfect.md               # HOME / Map-of-Content — always reflects current truth:
                           #   mission, the scored context QUEUE with the CURSOR,
                           #   the ACCEPTED POOL (n/10), shipped ledger headline, link to last session
  config.md                # per-repo overlay: gates to run, worktree recipe, wave size,
                           #   direction sizing rules, cooldown, + ## Skill improvement log
  contexts/<name>.md       # one per context-map context (long-lived, updated in place)
  directions/<slug>.md     # one per direction (long-lived; the atom of the whole loop)
  sessions/<YYYY-MM-DD[-n]>.md  # immutable run records, each ends with a `next:` pointer
```

**Context note** (`contexts/<name>.md`):
```markdown
---
name: <context-map name>        type: perfect/context
group: <group>                  category: ui|api|lib|data|config
opportunity: <0-10>             # value reach × headroom × strategic fit (Director's judgment)
last_proposed: <YYYY-MM-DD|never>   cooldown_until: <date|—>
directions: ["[[<slug>]]", …]
---
## Current state   (scout brief digest + file:line evidence — refreshed each proposal pass)
## Direction history   (proposed / accepted / REJECTED-and-why — rejections are memory too)
## Shipped   (direction → commit SHA → observed effect)
```

**Direction note** (`directions/<slug>.md`):
```markdown
---
slug: <kebab, stable>           type: perfect/direction
context: "[[<context-name>]]"   lens: feature|ux|optimization|robustness|wildcard
status: proposed | accepted | building | shipped | failed | dropped | rejected
size: S|M|L                     # must fit ONE builder session (≲15 files, no cross-context schema break)
proposed: <date>  accepted: <date|—>  shipped: <date|—>  commit: <sha|—>
---
## What & why   (the user value, one paragraph, no fluff)
## Evidence   (file:line of the gap/opportunity in today's code)
## Acceptance criteria   (3-6 checkable bullets — the builder's contract AND the review checklist)
## Risks / non-goals
## Build record   (builder report digest, review verdict, gate results — filled during build)
```

**Session note**: phases run, contexts covered, accept/reject tallies, build outcomes with SHAs, deltas, and **`next: <the exact resumption instruction for the following session>`**.

Vault hygiene: slugs are stable; **update notes, never duplicate**. Subagents may fail to write files in some harnesses — after any parallel phase the Director MUST `ls` the target dir and **backfill missing notes from the agents' returned content** before trusting "written".

## The loop — a vault-driven state machine

Every invocation starts the same way; the vault decides which phase runs.

### Phase 0 — Recall & register
1. Read `Perfect.md` (+ last session's `next:` pointer). If missing → run **init** (below).
2. Read `context-map.json`; diff against `contexts/*` — new contexts get notes + a queue slot, removed ones get archived (`status: retired` in frontmatter).
3. Repo rituals: read `.claude/active-runs.md`, surface overlaps, append this session's entry. Scan MEMORY.md signals that veto directions (e.g. "Langfuse REMOVED — don't re-suggest").
4. Announce the resumption point in one sentence, then go where the state machine points: pool < 10 → **Propose**; pool ≥ 10 (or user said `build`) → **Build**.

### Init (first run only)
1. Scaffold the vault tree + `config.md` (record: gates = `npm run check`, `npm run test -- --run`, `check:i18n:strict` when locales touched, `cargo clippy/check + cargo test --lib --features desktop` when Rust touched; wave size = 3; cooldown = 2 rounds).
2. Score every context 0-10 for **opportunity** = user-facing reach × headroom (distance from "perfect", judged from context-map metadata, `docs/features/*`, and memory) × strategic fit (active arcs in memory). Write the ranked **queue** into `Perfect.md` with the cursor at the top. Don't deep-read code yet — scoring is refined per-context at proposal time.
3. Write session note; proceed straight into Propose.

### Phase P — Propose (context by context, until the pool holds 10)
Loop while `pool < 10` and the user hasn't said stop:

1. **Cursor** = highest-opportunity context not on cooldown. **Prefetch**: before presenting context *k*, launch the scout for context *k+1* in the background.
2. **Scout** (Explore, "very thorough", read-only): given the context's `file_paths`, `entry_points`, `db_tables` → return a current-state brief: what exists, what's rough, dead ends, UX seams, perf smells, with `file:line` evidence. **A component only "exists" if it RENDERS — trace every surface the brief describes to an actual mount point** (round 3's smoke pass caught a strip that scout + two builders treated as live while it had zero consumers).
3. **Draft 5 directions** — one per lens by default: **feature** (new user value), **ux** (design/flow elevation), **optimization** (perf/cost/significant simplification), **robustness** (failure modes, observability, architecture), **wildcard** (the non-obvious idea a great PM would pitch). Each sized to ONE builder session; a bigger vision ships as its phase-1 slice.
   **Weight the slate by `config.md → ## User taste`** — the lens spread is a starting point, not a quota. Default depth is the *engine*, not the chrome: for any context with backend/algorithmic substance, most directions should be architecture-level (data model, algorithms, lifecycle, prompt/recall paths, cost structure); UI surfacing appears at most once-twice unless the user steers otherwise. Scout prompts must match this depth (trace the full pipeline, not just the components).
4. **Challenge before presenting** (the Director argues against itself; a direction that fails any check is replaced, not presented):
   - Does it already exist in code? (scout evidence, not assumption)
   - Was it already proposed/rejected/shipped? (check `contexts/<name>.md` history + memory)
   - Does it conflict with an active arc or a "removed, don't re-suggest" memory?
   - Is the value claim concrete — can I name the user moment it improves?
   - Can one Opus session genuinely ship it behind the acceptance criteria?
5. **Present** the 5 in chat — numbered, each: title · lens · size · one-paragraph why · evidence · acceptance criteria. Then gate with **AskUserQuestion (multiSelect)** — the tool caps options at 4 per question, so use TWO questions in one call: Q1 = directions 1–3, Q2 = directions 4–5 (labels = `N · short title`, description = one-line value claim + size). The user can annotate via "Other" (e.g. `edit 2: …`, `stop`); selecting nothing in both = none accepted.
6. Record outcomes in the vault (rejected ones too, with the user's implied reason — rejections steer future proposals). Accepted → `directions/<slug>.md` with `status: accepted`, pool counter++, context gets `cooldown_until`. Update `Perfect.md` after every context, not at session end — a killed session must lose nothing.
7. **A `none` gate that carries a steer** (the user says what they wanted instead) is a re-scout order, not a rejection of the context: promote the steer to `config.md → ## User taste` if it generalizes, re-scout at the steered depth/angle, and re-propose the SAME context once before advancing the cursor. Never re-present any rejected direction.

### Phase B — Build (one Opus builder per context, Fable decides everything)
1. **Wave plan**: group the pool's accepted directions by context → one builder per context, ≤ `config.wave_size` (default 3) concurrent, and **≤ 3 directions per builder brief** (a 4-direction brief exceeded one agent-session budget in round 1 — split a bigger context into two sequential builders). Present the wave plan in one screen; on user go (or when invoked as `/perfect build`), execute.
2. **Worktree per builder** — prepared by the Director, NOT via Agent-tool isolation (those worktrees lack `node_modules`):
   ```bash
   git worktree add .claude/worktrees/perfect-<ctx> -b worktree-perfect-<ctx>
   cmd //c mklink //J ".claude\\worktrees\\perfect-<ctx>\\node_modules" "..\\..\\..\\node_modules"   # junction, NOT copy
   # Builders run Rust checks with the shared target: CARGO_TARGET_DIR=<main>/src-tauri/target cargo check / cargo test --lib
   ```
3. **Brief** each builder (see template below); launch with `model: "opus"`, `subagent_type: "general-purpose"`, all briefs in one message so they run concurrently.
4. **Mid-flight decisions**: a builder returning `DECISION NEEDED: …` gets an answer from the Director via `SendMessage` — product calls, trade-offs, and scope cuts are Fable's alone. A builder that stops without its final report gets one `SendMessage` nudge.
   **Builder-death recovery (learned round 1 — session limits WILL kill builders):** the instant a builder dies, `git add -A && git commit --no-verify` a `wip(…)` snapshot **inside its worktree** (isolated tree — add-all is safe there; never-lose-work beats commit hygiene). Then the Director either finishes the work inline (review the WIP diff, complete gaps, split into per-direction commits along file boundaries — same-file hunks may share a commit if the message says so) or re-briefs a fresh builder after the limit resets with "continue from the WIP commit".
5. **Review — the Director earns its title here.** Per builder branch: `git diff master...worktree-perfect-<ctx>` and review against each direction's acceptance criteria, repo conventions (shared-component catalog, design tokens, i18n keys, `invokeWithTimeout`, error registry), and taste. Verdict per direction: **merge** / **redo with notes** (SendMessage, builder fixes in place) / **drop** (`status: failed`, reason recorded). Never merge on "tests pass" alone — read the diff.
   **Docs-vs-code check (learned round 1):** when a diff documents a behavior (contract text, formula, doc comment), grep for the code that implements it before merging — one builder shipped a beautifully-documented decay formula with the implementing SQL never written. A contract describing behavior the code doesn't have is worse than nothing.
   **Rust gate calibration:** gate on *no NEW warnings in files this diff touched* (clippy full-crate `-D warnings` fails on hundreds of pre-existing warnings in this repo — compare against master's warnings for the same files before blaming the diff).
6. **Merge serially**: per direction, `git merge --squash` (or cherry-pick) → ONE atomic commit on master, message `feat(<context>): <direction title>` + `Co-Authored-By` footer. Stage per-file, verify `git diff --cached --stat` matches intent (foreign pre-staged files → `git restore --staged` them). Run the config gates on master after each merge; a red gate is fixed inline before the next merge.
   **Concurrent-master locale conflicts (learned round 1):** when another session moves the locale files under a pending cherry-pick, don't hand-merge JSON — re-apply the branch's key **adds/removes** programmatically over master's current locale files (flatten base vs branch per locale, set/delete on current, write), then regenerate `gen-types.mjs` + `split-locales.mjs` and `git add` the artifacts before `cherry-pick --continue`. Round 1's script: session scratchpad `merge-locale-keys.mjs` — recreate it from this recipe.
   **Union-merge discipline (learned round 4 the hard way):** both-append cherry-pick conflicts are USUALLY safe to keep-both — but only when each side is a complete declaration. NEVER blind-union hunks whose sides end mid-function (a glued test-fn and a swallowed closing brace turned master red for two picks). Read every seam; and **read the gate's output BEFORE the next state-changing action** — `cherry-pick --continue` AND `git commit` both count (round 5 repeated round 4's mistake in miniature: an integration fix was committed while its test run sat unread showing 3 failures). A departing builder that flags a master regression in its final report is gold — treat those flags as gate input, not noise.
   **Concurrent-session DIRTY files blocking a pick (learned round 2):** never stash, never wait — commit around them. (a) Dirty `en.json`: stage `HEAD + your keys` directly into the index (`git hash-object -w` + `git update-index --cacheinfo`), and write `their-working-copy + your keys` to disk — their uncommitted work stays theirs, and their later commit can't revert your keys. (b) Dirty Rust/source file: same index trick, content built by `git merge-file` (base=branch-fork, ours=HEAD, theirs=branch), plus a second merge-file for the working copy. (c) **Shared append-files** (`lib.rs` command registrations, `commandNames.generated.ts`, generated i18n): NEVER wholesale-`checkout` a branch's version across sequential picks — it clobbers earlier picks' registrations (tsc catches it too late). Patch-union (`git diff branch~..branch -- file | git apply --3way`) or regenerate from source, always.
6b. **Cross-builder integration gate (learned round 3):** parallel builders each verify against the master they forked from — their work can be mutually incompatible (one retired a type-union member another targeted; one restructured a component another wrote tests against). After ALL of a wave's picks land, run tsc + the union of the wave's test suites on master BEFORE wrap; treat failures as Director-fixed integration commits, not builder redos. When two builders share a direction dependency, fork the dependent builder's worktree AFTER the dependency merges (sequenced builder) — it worked cleanly in round 3.
7. **Doc-sync in the same turn**: user-visible changes update the mapped `docs/features/*` (+ onboarding flow / marketing module if mapped) — the Stop hook will demand it anyway.
8. **Cleanup**: per worktree — `cmd //c rmdir` the node_modules **junction FIRST**, then `git worktree remove`, then delete the branch once its commits are on master.

### Phase W — Wrap (every session, even interrupted ones)
1. Update every touched vault note; write the session note with the **`next:` pointer** (e.g. `next: propose — cursor at overview-analytics, pool 7/10` or `next: build wave 2 — trigger-system + agent-lab remain`).
2. `Perfect.md` headline refreshed: pool count, queue cursor, shipped-total, last-session link.
3. Move the active-runs ledger entry to Recently completed with SHAs. Best-effort POST to the codex-gf feature log (silent on failure).
4. **Reflect on the skill itself**: 2-4 bullets in `config.md → ## Skill improvement log` — what dragged, what the user overrode, what the next round should change. This log is the input for the between-rounds skill revision.

## Direction quality bar (what earns a slot in the 5)

- **Value-first**: names the user moment it improves; "nice refactor" is not a direction unless it unlocks something.
- **Evidence-backed**: cites today's code (`file:line`), not vibes.
- **One-session-shippable**: ≲15 files, no cross-context schema breaks; else slice it.
- **Novel to the vault**: not shipped, not pending, not previously rejected (unless the world changed — say so).
- **Lens-diverse**: default one per lens; substituting a second entry in one lens requires the Director to say why.

## Builder brief template

```
You are an Opus builder for the `<context>` context of the Personas desktop app
(Tauri 2 + React 19 + TS + Tailwind 4 + Zustand 5; local-first SQLite).
Work ONLY in this worktree: <abs path>. Your scope is this context's files:
<file_paths from context-map.json>. Touching other contexts requires DECISION NEEDED.

Implement these accepted directions, one atomic commit each, message `feat(<context>): <title>`:
<per direction: What & why · Acceptance criteria · Evidence file:line · Risks/non-goals>

COMMIT EACH DIRECTION THE MOMENT IT IS DONE AND VERIFIED — never batch commits
for the end of the session. An interrupted session must lose at most the
direction in progress, not everything.

FOREGROUND ONLY — this means the tool mechanics: NEVER set run_in_background
on a shell command, never spawn "waiter" scripts, never end your turn with
"the notification will tell me" (it won't — you will idle until the Director
nudges you; this has burned 5+ nudges across waves). Run every compile/test as
ONE blocking foreground command; shared-cargo-target lock waits are normal.

SEARCH BEFORE BUILDING: before implementing any new mechanism, grep for an
existing implementation of the same concept and LAYER ON it rather than
forking a parallel system (round 3's history builder found a load-bearing
back-only nav history this way — unifying beat replacing).

NO INTERACTIVE GIT: `git add -p`, `git add -i`, `git rebase -i` HANG this
harness (a round-5 builder stalled 600s on add -p). When directions interleave
in shared files, commit by FILE boundaries and document the shared commit —
never hunk-split interactively.

Repo law (non-negotiable):
- Read .claude/Design.md before any UI; reuse shared/components (CATALOG.md) — never hand-roll
  spinners/modals/tooltips/buttons; semantic tokens only (typo-*, rounded-*, shadow-elevation-*).
- Every user-facing string: add key to src/i18n/locales/en.json AND translate into all 13 other
  locales yourself via scripts/i18n/translate-extract.mjs → fill .i18n-work/missing-<code>.json
  (medium quality fine) → translate-merge.mjs. The pre-commit hook blocks gaps.
- IPC via invokeWithTimeout; errors via toastCatch/silentCatch + error registry; components < 200 LOC.
- New Rust types with ts-rs: run `cargo test export_bindings` and commit src/lib/bindings/ changes.
- Verify before claiming done: npx tsc --noEmit, targeted vitest, and drive the actual flow when a
  dev server is available; report what you COULD NOT verify honestly.

If a product decision is ambiguous, STOP that direction and return `DECISION NEEDED: <question>`
with your recommendation — never guess. Final report format:
per direction → status (done|blocked|decision-needed), commits, files, verification evidence, open risks.
```

## Modes

- **`/perfect`** — resume the loop wherever the vault says it stopped (the default; covers init on first run).
- **`/perfect propose [context]`** — force a proposal pass (optionally jump the cursor to a named context).
- **`/perfect build`** — build now with the current pool even if < 10.
- **`/perfect status`** — read-only: queue, cursor, pool, in-flight builds, shipped ledger, last session. No agents.
- **`/perfect smoke`** — live L2 verification pass over recent waves' shipped surfaces: drive the USER'S running instance via the :17320 bridge (verify a new-code marker first — never trust a stale port), read-mostly navigation, and use **read-only sqlite3 queries against the live DB** (`sqlite3 "file:<path>?mode=ro"`) as the primary diagnostic — one GROUP BY beats an hour of DOM archaeology. Record verified/not-driven/fixes in a `sessions/<date>-smoke` note; small fixes commit inline (gates BEFORE commit). Run after every ~2 waves; state-dependent surfaces that keep rolling over go to a fresh-DB harness session instead.
- **`/perfect reflect`** — read `config.md → Skill improvement log` + last sessions and propose concrete edits to THIS skill file.

## Guardrails

- **Never stash, never `git add -A`** — per-file staging, staged-count check before every commit; other sessions' work is sacred (parallel-safety primitives in CLAUDE.md apply in full).
- **Cost discipline**: scouts are Explore-tier; Opus is spent only on accepted work; the Director never re-runs a scout whose brief is < 1 round old (it's in the context note).
- **Honest ledger**: a direction only reaches `shipped` with gates green AND the Director having read the diff; anything else is `failed` with a reason. No silent drops — every accepted direction's fate is recorded.
- **Interruptibility is a feature**: write the vault incrementally (after every context in P, after every merge in B) so a killed session resumes losslessly.
- **The user is the product owner**: the gate is theirs; the Director challenges but never overrides a rejection, and repeated rejections of a lens/context recalibrate the queue scores.
