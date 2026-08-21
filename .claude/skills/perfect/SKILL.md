---
name: perfect
contexts: tracked
memory: vault
category: Development
description: Session-after-session product perfection loop. The strongest available model at xhigh reasoning (currently Fable 5) directs — it walks the repo's context map context-by-context, proposes 5 challenged, high-value directions per context (features, design elevations, significant optimizations), gates them with the user until 10 are accepted, then orchestrates Opus-class builder subagents on ONE shared branch — grouped so their write sets cannot collide — while making every review/merge decision itself. All state lives in a linked Obsidian vault so any future session resumes the loop exactly where the last one stopped. Invoke with `/perfect [init|propose|build|status|reflect] [context-name]`.
argument-hint: "[init|propose|build|status|reflect] [context]"
version: 1.0
---

# Perfect — the direction-and-delivery loop

> One model configuration is best at *judgment* — seeing what would make a product excellent, challenging its own ideas, reviewing diffs ruthlessly. A well-scoped builder is great at *execution* inside a tight brief. `/perfect` wires the two together in a permanent loop: **the strongest model at xhigh directs, Opus-class builders build, the vault remembers.** Each session moves the product measurably closer to the best UX, architecture, and feature quality it can have; no session ever starts from zero.

## Roles — Director and Builders

- **Director (the main session — the strongest available model at xhigh reasoning; currently Fable 5, Opus 5 acceptable fallback).** Owns everything that is judgment: opportunity-scoring contexts, drafting directions, adversarially challenging them before the user ever sees them, running the acceptance gate, writing builder briefs, answering builders' product questions mid-flight, reviewing every diff, deciding merge/redo/drop, running the repo gates, committing, and writing the vault. The Director **never delegates a decision** to a builder and never rubber-stamps a builder's diff.
- **Builders (Opus-class subagents, `model: "opus"`, one per *lot* — see Phase B step 1).** Each receives a tight brief (direction specs + acceptance criteria + an explicit **write set** + repo-convention digest) and implements **in the wave's single shared tree**, alongside its siblings. Isolation is not what keeps them from colliding — disjoint grouping is. Builders return a structured report; when they hit a genuine product ambiguity they **return the question instead of guessing** — the Director answers via `SendMessage` and the builder continues.
- **Scouts (Explore subagents, cheap).** Produce the per-context current-state brief the Director synthesizes directions from. Never used for judgment.

## The Obsidian vault — durable loop state

Resolve the vault root (first hit wins), then use `$VAULT/Perfect/`:

```bash
VAULT="<obsidian-vault-root>/personas"   # verified to exist; contains Perfect/
# Portable fallback: if no Obsidian vault exists, use <repo>/.perfect/ (same schema — still an Obsidian-openable folder).
```

```
Perfect/
  Perfect.md               # HOME / Map-of-Content — always reflects current truth:
                           #   mission, the scored context QUEUE with the CURSOR,
                           #   the ACCEPTED POOL (n/10), shipped ledger headline, link to last session
  config.md                # per-repo overlay: gates to run, wave shape, wave size,
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

**The vault is NOT version-controlled and Obsidian's file-recovery never sees agent writes** (it only snapshots edits made in the app). A clobbered note is gone. Therefore, every write obeys these three rules — learned 2026-07-29, when this session destroyed a sibling session's note:

1. **Never `open(path,'w')` a session note.** `sessions/<date>.md` is NOT unique — two `/perfect` sessions on one day collide. Check existence first and take the next free `-2`, `-3` suffix. Same for any note you did not create this session.
2. **Re-read `Perfect.md` immediately before writing it, never patch the Phase-0 copy from memory.** A sibling session that wraps mid-run rewrites the cursor, `pool`, `shipped_total`, and `last_session` — a regex written against the Phase-0 text silently no-ops against the new text while your other replacements land, producing a self-contradicting header (this is exactly how the 2026-07-29 damage went unnoticed for several minutes).
3. **An operator's "that session is finished" means it finished — including its wrap.** It does NOT mean the vault still matches what you read before it wrapped. Re-read; do not assume.

When you do clobber something: say so immediately, stop, attempt recovery from the surviving derived sources (`Perfect.md`'s cursor, `directions/*` frontmatter, `git log`, the active-runs ledger), and leave the reconstruction **labelled as a reconstruction** with what is lost stated explicitly. Never quietly write over the gap.

## The loop — a vault-driven state machine

Every invocation starts the same way; the vault decides which phase runs.

### Phase 0 — Recall & register
1. Read `Perfect.md` (+ last session's `next:` pointer). If missing → run **init** (below).
2. Read `context-map.json`; diff against `contexts/*` — new contexts get notes + a queue slot, removed ones get archived (`status: retired` in frontmatter).
   **First verify the map's PROVENANCE and say which source you chose and why** — this file is not
   automatically yours, and in this repo THREE sources disagree:
   ```bash
   node -e 'const m=require("./context-map.json");console.log(JSON.stringify(m.project||m.$schema||{}))'
   ```
   As of 2026-08-08: the committed `context-map.json` is a **peer device's** post-consolidation
   partition (**208 contexts**, produced by `consolidate-contexts`, commit `976da4c5f` "767 -> 208",
   and confirmed correct by the operator); the **local app DB holds 49 coarse contexts / 8 groups**
   from an older scan; `.personas/contexts.txt` holds **773** pre-consolidation names dumped by the
   peer. Map ∩ local DB = **2 names**. There is no import path — `context-map.json` is export-only —
   so `git pull` does NOT sync a peer's rescan into this machine's DB.
   **Use the map for the QUEUE (it is the finer, truer partition of this source) and the LOCAL DB's
   names for anything the app anchors to** (see § App context coverage). Shape is not provenance.
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
   **Weight the slate by `config.md → ## User taste`** — the lens spread is a starting point, not a quota. **Learned taste through round 8: the user accepts outcome-value work** (features/optimizations with a visible user payoff) **and rejects cosmetic churn** (e.g. dark-mode remount tweaks). Pre-filter the 5 through that lens and say in the presentation that you did. Default depth is the *engine*, not the chrome: for any context with backend/algorithmic substance, most directions should be architecture-level (data model, algorithms, lifecycle, prompt/recall paths, cost structure); UI surfacing appears at most once-twice unless the user steers otherwise. Scout prompts must match this depth (trace the full pipeline, not just the components).
4. **Challenge before presenting** (the Director argues against itself; a direction that fails any check is replaced, not presented):
   - Does it already exist in code? (scout evidence, not assumption)
   - Was it already proposed/rejected/shipped? (check `contexts/<name>.md` history + memory)
   - Does it conflict with an active arc or a "removed, don't re-suggest" memory?
   - Is the value claim concrete — can I name the user moment it improves?
   - Can one builder session genuinely ship it behind the acceptance criteria?

   **Director self-check before the gate** — a proposal that fails any of these never reaches the user:
   - Names the concrete files it will touch (from scout evidence, not guessed).
   - Names the user-visible outcome in one sentence a non-developer would care about.
   - States why it beats the next-best alternative direction for this context.
   - Survives the taste filter above (outcome-value, not cosmetic churn).
5. **Present** the 5 in chat — numbered, each: title · lens · size · one-paragraph why · evidence · acceptance criteria. Then gate with **AskUserQuestion (multiSelect)** — the tool caps options at 4 per question, so use TWO questions in one call: Q1 = directions 1–3, Q2 = directions 4–5 (labels = `N · short title`, description = one-line value claim + size). The user can annotate via "Other" (e.g. `edit 2: …`, `stop`); selecting nothing in both = none accepted.
6. Record outcomes in the vault (rejected ones too, with the user's implied reason — rejections steer future proposals). Accepted → `directions/<slug>.md` with `status: accepted`, pool counter++, context gets `cooldown_until`. Update `Perfect.md` after every context, not at session end — a killed session must lose nothing.
7. **A `none` gate that carries a steer** (the user says what they wanted instead) is a re-scout order, not a rejection of the context: promote the steer to `config.md → ## User taste` if it generalizes, re-scout at the steered depth/angle, and re-propose the SAME context once before advancing the cursor. Never re-present any rejected direction.

### Phase B — Build (ONE branch, disjoint builders, the Director decides everything)

> **Process efficiency is the first constraint, ahead of defensive isolation.** Rounds 1–4 gave each
> builder its own worktree and its own branch, and the bill came due in round 4: 3 worktree setups +
> 3 junctions, single compiles of **24m05s and 28m29s** because three *different source paths*
> thrashed one `CARGO_TARGET_DIR`, a stale `personas-core` artifact that let `cargo check` pass while
> `cargo test` failed, siblings clobbering the shared test exe twice, N cherry-picks with
> union-merge hazards that turned master red for two picks, a whole extra cross-builder integration
> phase, and junction-ordered teardown. Every bit of that bought protection against **a collision
> that correct grouping prevents for free**.
>
> **The rule: isolation is not the answer to collision risk — disjoint grouping is. A wave with a
> high collision risk is a wave that is grouped wrong.** Fix the grouping; don't build machinery
> around the mistake.

1. **Partition by write set — the load-bearing step; get this right and the rest is bookkeeping.**
   For each accepted direction derive its **write set**: the files it will actually modify, taken
   from the direction's `## Evidence` (`file:line`) plus a Director read of the call path. *A guessed
   write set is worthless* — if you cannot name the files, the direction is not ready to build, and
   that is the same reachability discipline Phase P step 4 demands.
   Group directions into builder **lots** so write sets are **pairwise disjoint**:
   - Two directions overlap → they go in the **SAME lot** (one builder, sequentially) or one is
     **deferred** to the next wave. Never split an overlap across concurrent builders.
   - No disjoint partition exists → **the wave is one builder.** That is a legitimate, honest
     outcome, not a failure of the plan.
   - ≤ `config.wave_size` lots concurrent; ≤ 3 directions per lot (a 4-direction brief exceeded one
     agent-session budget in round 1).
   - **Rust-touching lots: ≤ 2 concurrent** — round 4 measured why.
   - Lots need not follow context boundaries. Disjointness is the criterion; one context can be two
     lots, and two small contexts can share one.
   Class C files (step 3) are excluded from write-set analysis — nobody but the Director touches
   them, so they cannot create overlap.
   Present the wave plan in one screen — **lot ↔ directions ↔ write set** — and say explicitly which
   directions were merged or deferred to reach disjointness. On user go (or `/perfect build`), execute.

2. **One branch for the whole wave.** No per-builder worktree, no per-builder branch, no per-direction
   merge.
   ```bash
   git switch -c perfect/<YYYY-MM-DD>      # from a clean master
   ```
   Every builder works in this one tree and commits onto this one branch. One source tree means
   coherent cargo fingerprints and warm incremental rebuilds — the single largest cost the old shape
   imposed — and it means the wave is **continuously integrated** rather than integrated at the end.
   **Where the tree lives:** the main checkout by default. If `.claude/active-runs.md` shows another
   session live in the main checkout, put the wave in **ONE** worktree (never one per builder) —
   same branch, same protocol — and apply the junction recipe once:
   ```powershell
   $root = "<abs repo root>"; $link = "$root\.claude\worktrees\perfect-wave\node_modules"
   if (Test-Path $link) { Remove-Item $link -Force -Recurse -Confirm:$false }
   New-Item -ItemType Junction -Path $link -Target "$root\node_modules" | Out-Null
   Test-Path "$link\.bin\tsc"    # MUST print True before you brief anyone
   ```
   **Do NOT use `cmd //c mklink //J … "..\..\..\node_modules"`.** `mklink` resolves a RELATIVE target
   against the **current** directory, not the link's — from the repo root it silently creates
   `C:\Users\node_modules` and still prints "Junction created", and the failure only surfaces as a
   builder that cannot find `tsc`. **"Junction created" is not evidence — the `Test-Path …\.bin\tsc`
   assertion is.** Teardown at wrap: `cmd //c rmdir` the junction **FIRST**, then `git worktree remove`.

3. **The shared-resource protocol.** One tree means shared mutable state; each piece gets exactly one
   owner, and this whole block goes verbatim into every brief.
   - **Class A — your own write set.** Yours alone; edit freely.
   - **Class B — append-only registries** (`src-tauri/src/lib.rs` command registrations, `mod`/`pub use`
     lists, `CHANGELOG.md`). Editing allowed, but **re-read the file immediately before each edit and
     anchor on a string unique to your change** — never rewrite one whole.
   - **Class C — Director-only.** `src/i18n/locales/*.json` + everything generated from them,
     `src/lib/bindings/`, `commandNames.generated.ts`, any codegen output — **and the git index**.
     Builders *report* what they need (new i18n keys as a JSON fragment; new ts-rs structs by name)
     and the Director applies it once at quiescence, running each codegen once. This deletes the
     entire locale-conflict machinery rounds 1–2 had to invent.
   - **Commits — builders still commit their own work** (never-lose-work beats commit hygiene, and
     builder death is the norm), but through an index-safe form: `git add <only your NEW files>`,
     then commit through an **isolated index** (`GIT_INDEX_FILE` seeded with `git read-tree HEAD`;
     `.claude/CLAUDE.md` primitive #5). It builds the commit from those
     paths alone and *disregards whatever else is staged*, so a sibling's in-flight staging can never
     ride along. **Never** `git add -A` / `git add .` / `git add -u` / bare `git commit` /
     `git commit -a` / `git stash` / `git checkout <path>` / `git restore`. An `index.lock` race fails
     loudly and harmlessly — retry it, never work around it.
   - **Builds:** cargo's own target-dir lock serialises compiles for free within one tree. What it
     cannot protect against is a sibling's half-written source. **A compile or type error in a file
     outside your write set is a sibling's transient state: re-run once, then report it — never fix
     it.** Same for a test that fails in a suite you do not own.

4. **Brief** each lot (template below); launch with `model: "opus"`, `subagent_type: "general-purpose"`,
   all briefs in one message so they run concurrently. **Brief quality bar:** the write set, the
   step-3 protocol verbatim, and the exact gates — `npx tsc --noEmit`, `npm run lint` (no new warnings
   in touched files), targeted vitest, plus the Class C *report-don't-touch* rule for i18n and
   bindings. Director review time is for judgment, not gate failures.

5. **Mid-flight decisions**: a builder returning `DECISION NEEDED: …` gets an answer from the Director
   via `SendMessage` — product calls, trade-offs and scope cuts are the Director's alone. A builder
   that stops without its final report gets one `SendMessage` nudge.
   **Builder-death recovery (session limits WILL kill builders):** the instant a builder dies, snapshot
   its work as `wip(…)` through an **isolated index** over its write set (`--no-verify`) — *not* `git add -A`,
   which was safe only while the tree was private and is now actively dangerous. Then the Director
   either finishes inline or re-briefs a fresh builder with "continue from the WIP commit".

6. **Review — the Director earns its title here.** Per direction: `git show <sha>` (the commits are
   already atomic and already on the wave branch — there is no branch-vs-master diff to get wrong).
   Review against the acceptance criteria, repo conventions (shared-component catalog, design tokens,
   i18n keys, `invokeWithTimeout`, error registry), and taste. Verdict per direction: **keep** /
   **redo with notes** (SendMessage; the builder fixes in place with a follow-up commit) / **drop**
   (`git revert` that commit, `status: failed`, reason recorded). Never accept on "tests pass" alone —
   read the diff. Hold commit messages to the Director's own bar; reword at review if needed.
   **Docs-vs-code check (learned round 1):** when a diff documents a behavior (contract text, formula,
   doc comment), grep for the code that implements it — one builder shipped a beautifully-documented
   decay formula with the implementing SQL never written. A contract describing behavior the code
   does not have is worse than nothing.
   **Rust gate calibration:** gate on *no NEW warnings in files this diff touched* (full-crate clippy
   `-D warnings` fails on hundreds of pre-existing warnings here — compare against master's warnings
   for the same files before blaming the diff).
   **Any branch-vs-master comparison, for any purpose, is three-dot or it is wrong** — and after a
   squash merge neither form answers "did this land": grep for a signature symbol instead.

7. **Integration gate, once, at quiescence.** After every builder has reported and been reviewed, run
   the `config.md` gates on the wave branch: tsc + the union of the wave's test suites (+ Rust checks
   if Rust was touched). This is now confirmation rather than discovery — one branch means the
   builders' work was already compiling against each other all along, which is precisely what round 3
   had to bolt on a separate phase to catch. Reds are fixed inline as Director commits **and the
   output is read BEFORE the next state-changing action** (rounds 4 and 5 both committed while an
   unread test run was showing failures). A departing builder that flags a regression in its final
   report is gate input, not noise.

8. **Land the wave: ONE merge.** Apply Class C (regenerate i18n from the builders' key fragments,
   `cargo test export_bindings`, `generate-command-names.mjs`) and commit it. Then:
   ```bash
   git switch master && git merge --ff-only perfect/<date>    # or --no-ff if master has moved
   ```
   The per-direction commits *are* the atomic history — no cherry-pick, no squash-per-direction, no
   N-way conflict resolution. If master moved under you, this is one ordinary content merge instead
   of N. Re-run the gates on master after the merge.

9. **Doc-sync in the same turn**: user-visible changes update the mapped `docs/features/*` (+ onboarding
   flow / marketing module if mapped) — the Stop hook will demand it anyway.

10. **Cleanup**: delete the wave branch once merged; if a wave worktree was used, `cmd //c rmdir` the
    node_modules **junction FIRST**, then `git worktree remove`, then verify the main checkout's real
    `node_modules` is still intact before moving on.

<details><summary><b>Exception path — surgery for a master that moves under you.</b> Not the default any
more; the one-branch shape removes the cherry-pick class entirely. Reach for these only when a
concurrent session dirties or advances a file you must land into.</summary>

- **Union-merge discipline:** both-append conflicts are usually safe to keep-both — but only when each
  side is a complete declaration. NEVER blind-union hunks whose sides end mid-function (a glued test-fn
  and a swallowed closing brace turned master red for two picks in round 4). Read every seam.
- **Concurrent-session DIRTY files:** never stash, never wait — commit *around* them. (a) Dirty
  `en.json`: stage `HEAD + your keys` straight into the index (`git hash-object -w` +
  `git update-index --cacheinfo`) and write `their-working-copy + your keys` to disk. (b) Dirty
  source file: same index trick, content built by `git merge-file` (base=fork, ours=HEAD, theirs=branch),
  plus a second merge-file for the working copy. (c) After re-applying another session's delta, **diff
  the result against the captured patch and require an exact match** — a reverted value edit leaves both
  a clean `git status` and a grep-for-the-key satisfied.
- **Shared append-files** (`lib.rs` registrations, `commandNames.generated.ts`, generated i18n): never
  wholesale-`checkout` a branch's version across sequential operations — it clobbers earlier ones'
  registrations and tsc catches it too late. Patch-union
  (`git diff branch~..branch -- file | git apply --3way`) or regenerate from source, always.
- **Locale re-application:** don't hand-merge JSON. Re-apply the branch's key **adds/removes**
  programmatically over master's current locales (flatten base vs branch per locale, set/delete on
  current, write), then regenerate `gen-types.mjs` + `split-locales.mjs`.
</details>

### Phase W — Wrap (every session, even interrupted ones)
1. Update every touched vault note; write the session note with the **`next:` pointer** (e.g. `next: propose — cursor at overview-analytics, pool 7/10` or `next: build wave 2 — trigger-system + agent-lab remain`).
2. `Perfect.md` headline refreshed: pool count, queue cursor, shipped-total, last-session link.
3. Move the active-runs ledger entry to Recently completed with SHAs.
4. **Reflect on the skill itself**: 2-4 bullets in `config.md → ## Skill improvement log` — what dragged, what the user overrode, what the next round should change. This log is the input for the between-rounds skill revision.

## Direction quality bar (what earns a slot in the 5)

- **Value-first**: names the user moment it improves; "nice refactor" is not a direction unless it unlocks something.
- **Evidence-backed**: cites today's code (`file:line`), not vibes.
- **One-session-shippable**: ≲15 files, no cross-context schema breaks; else slice it.
- **Novel to the vault**: not shipped, not pending, not previously rejected (unless the world changed — say so).
- **Lens-diverse**: default one per lens; substituting a second entry in one lens requires the Director to say why.

## Builder brief template

```
You are an Opus-class builder for the Personas desktop app
(Tauri 2 + React 19 + TS + Tailwind 4 + Zustand 5; local-first SQLite).

YOU ARE NOT ALONE IN THIS TREE. <n> builders are working in this same checkout
on this same branch (`perfect/<date>`) right now. You have been grouped so that
your files and theirs do not overlap — that grouping IS the collision
avoidance, so respecting it is the whole contract.

YOUR WRITE SET — the only files you may modify:
<explicit file list>
Anything outside it requires DECISION NEEDED. A compile error, type error or
failing test in a file OUTSIDE your write set is a sibling's half-written
state, not your bug: re-run once, then report it. Never fix it, never revert it.

SHARED-RESOURCE PROTOCOL (non-negotiable):
- Append-only registries (src-tauri/src/lib.rs registrations, mod/pub use lists,
  CHANGELOG.md): you MAY edit, but re-read the file immediately before each edit
  and anchor on a string unique to YOUR change. Never rewrite one whole.
- DIRECTOR-ONLY, do not touch: src/i18n/locales/*.json and anything generated
  from them, src/lib/bindings/, commandNames.generated.ts, any codegen output.
  REPORT what you need instead — new i18n keys as a JSON fragment in your final
  report, new ts-rs structs by name — and the Director applies them once.
- COMMITS: `git add <only your NEW files>` then
  an isolated-index commit over every path in this commit (`.claude/CLAUDE.md` primitive #5).
  `--only` builds the commit from those paths alone and ignores whatever else is
  staged, so a sibling's in-flight staging can never ride along in your commit.
  FORBIDDEN: git add -A · git add . · git add -u · bare git commit · git commit -a
  · git stash · git checkout <path> · git restore. An index.lock collision is
  harmless — retry it, never work around it.

Implement these accepted directions, one atomic commit each, message `feat(<context>): <title>`:
<per direction: What & why · Acceptance criteria · Evidence file:line · Risks/non-goals>

COMMIT EACH DIRECTION THE MOMENT IT IS DONE AND VERIFIED — never batch commits
for the end of the session. An interrupted session must lose at most the
direction in progress, not everything.

RUN COMPILES IN THE FOREGROUND — and if one genuinely exceeds the harness's
600s cap, background it and then IMMEDIATELY BLOCK on reading its result before
doing anything else. NEVER end a turn on a pending gate: no notification will
arrive, you will simply idle until the Director nudges you (this cost 5+ nudges
across waves and stalled two builders for an hour in round 4). Cargo's
target-dir lock wait is normal — waiting is correct, ending your turn is not.

SEARCH BEFORE BUILDING: before implementing any new mechanism, grep for an
existing implementation of the same concept and LAYER ON it rather than
forking a parallel system (round 3's history builder found a load-bearing
back-only nav history this way — unifying beat replacing).

A TEST THAT FAILS ON ITS FIRST RUN HAS DONE ITS JOB. Fix the code, not the
assertion, and pin what you learned — round 4 caught two real defects this way.

NO INTERACTIVE GIT: `git add -p`, `git add -i`, `git rebase -i` HANG this
harness (a round-5 builder stalled 600s on add -p). When directions interleave
in your own files, commit by FILE boundaries and document the shared commit —
never hunk-split interactively.

Repo law (non-negotiable):
- Read .claude/CLAUDE.md § Styling before any UI; reuse shared/components (CATALOG.md) — never hand-roll
  spinners/modals/tooltips/buttons; semantic tokens only (typo-*, rounded-*, shadow-elevation-*).
- Every user-facing string: add key to src/i18n/locales/en.json AND translate into all 13 other
  locales yourself via scripts/i18n/translate-extract.mjs → fill .i18n-work/missing-<code>.json
  (medium quality fine) → translate-merge.mjs. The pre-commit hook blocks gaps.
- IPC via invokeWithTimeout; errors via toastCatch/silentCatch + error registry; components < 200 LOC.
- New Rust types with ts-rs: run `cargo test export_bindings` and commit src/lib/bindings/ changes.
- GATES you must pass before reporting done: npx tsc --noEmit · npm run lint (no new warnings in
  files you touched) · targeted vitest · npm run check:i18n:strict if you touched strings/locales ·
  cargo test export_bindings (+ commit src/lib/bindings/) if you touched Rust structs. Then drive
  the actual flow when a dev server is available; report what you COULD NOT verify honestly.

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

- **Never stash, never `git add -A`** — per-file staging, staged-count check before every commit; other sessions' work is sacred (parallel-safety primitives in CLAUDE.md apply in full). Inside a wave, an **isolated-index** commit (`GIT_INDEX_FILE` + `git read-tree HEAD`) is the form that
  makes this safe. `git commit --only` is NOT: it commits the working tree, so a sibling's unstaged edit
  inside your pathspec rides in under your message.
- **Efficiency outranks defensive isolation.** Before adding any protective step to this loop, ask whether the risk it defends against is instead a signal that the *grouping* is wrong. Machinery that exists to survive a bad wave plan should be deleted and the wave plan fixed.
- **Cost discipline**: scouts are Explore-tier; builder-tier model spend goes only to accepted work; the Director never re-runs a scout whose brief is < 1 round old (it's in the context note).
- **Honest ledger**: a direction only reaches `shipped` with gates green AND the Director having read the diff; anything else is `failed` with a reason. No silent drops — every accepted direction's fate is recorded.
- **Interruptibility is a feature**: write the vault incrementally (after every context in P, after every merge in B) so a killed session resumes losslessly.
- **The user is the product owner**: the gate is theirs; the Director challenges but never overrides a rejection, and repeated rejections of a lens/context recalibrate the queue scores.

## App context coverage (Personas-managed repos)

This skill declares `contexts: tracked` — the Personas app measures per-context memory coverage for it. When run inside a Personas-managed repo (a `.personas/` dir exists, or the app dispatched this run), before finishing append JSON lines to `.personas/memory-outbox.jsonl` at the repo root (append, never rewrite) — one node per context you meaningfully worked on:

```json
{"type":"node","kind":"progress","title":"<=200 chars: what you did in this context","body":"optional detail","context":"<a name from the local app DB's dev_contexts>","skill":"perfect"}
```

**Which name — this is the part that silently fails.** The ingest matches `context` against the names the app actually knows, case-insensitively. An unrecognized name is NOT an error: the node is stored with a null context and never counts toward coverage. **Query the local app DB's `dev_contexts` table** (the same DB `/perfect smoke` opens read-only) and use a name from it — that is the only matching set. Do NOT trust `.claude/codebase-context.md` (a stale render), repo-root `context-map.json` (may be a peer device's or a foreign tool's map), or `.personas/contexts.txt` unless this machine's app dumped it — on 2026-08-08 all three disagreed with the DB, and two of the three would have anchored to nothing.

Always set both `"skill":"perfect"` and `"context":"<name>"` — together they drive the per-skill context-coverage % (last 30 days). Skip silently when not Personas-managed.

**Append incrementally, not at the end** — same rule as the vault: one line the moment a context's proposal pass closes, one more when a direction from it ships. "Before finishing" loses everything when a session is killed, and this loop's sessions get killed.

**Who ingests it:** the app sweeps the outbox into the Memory Ledger and deletes the file when a *Fleet-spawned* session exits, and whenever the Skills Manager panel (Dev Tools → Skills) is opened for the project. A `/perfect` run in a plain terminal is neither, so its lines sit on disk until the user next opens that panel — that is expected, not a failure. Never hand-write into the ledger DB; the outbox is the only door.

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
