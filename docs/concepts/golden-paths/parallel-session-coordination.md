# Golden path — Parallel session coordination

> Situation node: `platform-delivery/testing-and-workflow/parallel-session-coordination` · [situation spine](../situation-spine.md)
> recurrence **4** · risk **HIGH** · sides **server** · convergence **converged** · `twoSided: false`
> dimensions: **resilience · code-quality**
> Leaf definition: *"Several agents sharing one checkout without clobbering each other's work."*
> Composed 2026-08-17 against `master` @ `dfd846b3b`. **Full contract** per the runbook's
> Mode 2 tiering (`risk: high`).
>
> **Sweep.** `.claude/active-runs.md` (3,352 lines, **327 entries** across 6 `##` sections, parsed
> twice by two different instruments), `docs/architecture/cli-coordination.md` (248 lines, read in
> full), `.claude/CLAUDE.md` §"Concurrent CLI sessions" + §"Parallel-safety primitives"
> (`:240-283`), all **35** skills under `.claude/skills/` (**53** tracked `.md`, every
> `active-runs` mention read in context), `lefthook.yml` (91 lines), `.github/workflows/ci.yml`
> test wiring, `.claude/mvp/calibration.md` (the fleet's own five-run index-race
> log), and `git log` over **7,406** commits — including the full five-commit forensic chain
> behind `PersonaOverviewVariantConstellation.tsx`.
>
> **Measured by executing, not by reading.** The load-bearing half of this document is a
> **throwaway git repository** built in the scratchpad, with **no lefthook, no concurrency and no
> Windows quirk**, in which `git commit -- <path>`, `git commit --only <path>`, an isolated
> `GIT_INDEX_FILE`, and the repo's own staged-count guard were each driven through the exact
> race they are supposed to survive. Six questions, six answers, printed below verbatim. That
> experiment **overturned this repo's own doctrine** and the brief that dispatched me — see §0
> and §12.1.
>
> **Two independent implementations of every count.** Where they disagreed, §12.3 says so — one
> disagreement was mine and it agreed with my thesis, which is the condition the doctrine says
> most needs a re-run.

---

## 0. Headline

**`.claude/CLAUDE.md:277` concludes: *"There is no reliable pathspec-scoping incantation while
another agent commits to the same worktree."* That is false, and the counter-example is already
in this repository — in `/mvp`'s own calibration log, where it has held for four consecutive runs
across eight concurrent builders. The reason nobody carried it across is that CLAUDE.md
diagnosed the wrong mechanism: it blamed lefthook, and the defect is plain git.**

Executed in a throwaway repo, `git init` and nothing else — no hooks, no second agent, no
Windows path weirdness:

```
=== Q1: git commit -- <path> — index vs working tree ===
committed content: WORKTREE
expected-if-INDEX: STAGED | expected-if-WORKTREE: WORKTREE

=== Q2: git commit --only <path> — index vs working tree ===
committed content: WORKTREE

=== Q3: does a pathspec commit take a SIBLING's file that is only staged? ===
files in commit: mine.txt
sibling still staged after? sibling.txt

=== Q4: ISOLATED GIT_INDEX_FILE — sibling stages into the shared index mid-flight ===
files in commit: mine.txt
shared index still holds sibling? mine.txt sibling.txt

=== Q5: does an isolated-index commit take my STAGED content, not my worktree? ===
committed content: STAGED

=== Q6: the TOCTOU window — staged-count check, then a sibling add, then commit ===
staged-count guard sees: 1 file(s)  [mine.txt ]
files actually committed: mine.txt sibling.txt
```

Read the table those six answers make:

| technique | scopes which **files** land? | takes my **staged content**? | survives a sibling `git add` mid-flight? |
| --- | --- | --- | --- |
| `git add <p>` then `git commit` | **no** | yes | **no** (Q6) |
| `git commit -- <p>` | **yes** (Q3) | **no** (Q1) | files yes, content **no** |
| `git commit --only <p>` | **yes** | **no** (Q2) | files yes, content **no** |
| isolated `GIT_INDEX_FILE` | **yes** (Q4) | **yes** (Q5) | **yes** (Q4) |

**One technique passes all three columns.** It is not exotic — `GIT_INDEX_FILE` is a documented
git environment variable — and it is already written down in this checkout, at
`.claude/mvp/calibration.md:54`, by a builder that hit the same wall from the other
side:

> *"**`git commit -- <path>` commits the WORKING TREE, not the index** — a genuine hole in the
> run-1/2/3 pathspec doctrine. Two builders independently hit it: with another session's
> unstaged edits in the same file, pathspec commit sweeps them in. … stage your hunks with
> `git apply --cached` and commit the verified index, or commit through an isolated
> `GIT_INDEX_FILE` — never bare pathspec."*

That is the correct mechanism, arrived at independently, and it explains every observation
CLAUDE.md records **without needing lefthook to be installed at all**. CLAUDE.md's version —
*"does NOT reliably scope the commit **when lefthook is installed**"*, cause given as *"lefthook's
partial-commit handling re-stages"* — is a plausible story that fails Q1 and Q2 in a repo with
no hooks. The two documents were four days and one directory apart.

Meanwhile the wrong half is what propagated. Measured across the 53 tracked skill documents:
**11 instructions in 6 files reach for a pathspec commit**, and **9 of the 11 prescribe it**.
Four of them — `code-review/SKILL.md:29`, `guide-sync/skill.md:47`, `prototype/SKILL.md:55`,
`sentry/SKILL.md:59` — tell the agent that `git commit --only <files>` will
*"**bypass the shared index entirely**"*. Q2 says it bypasses the index by committing the
**working tree**, which is not a bypass, it is a wider blast radius. `/perfect/SKILL.md:398` —
the repo's heaviest multi-agent orchestrator — states that `--only` *"is the form that makes this
safe **by construction**"*. Against those 11: **`GIT_INDEX_FILE` appears 3 times, all in one
skill's calibration log, and in zero SKILL.md specifications.**

**And the readback that CLAUDE.md calls "the only step that detects the failure at all" is in
none of them.** Across 53 skill documents carrying **26 `git commit` instructions in 9 files**,
the number that tell an agent to read back what actually landed is **zero**. The single regex
hit is `i18n-translate/SKILL.md:145` — `git log -1 --format=%cI <locale file>`, a file-mtime
lookup, not a verification. The readback appears in exactly **two files** in all of `.claude/`,
and **zero of them is a skill**: `CLAUDE.md:277`, where it is prescribed once, and
`active-runs.md` at `:7` and `:3120` (the latter with the flags reversed,
`git log -1 --oneline`), where two sessions narrate the incidents that earned it. It is a rule
that lives only in the document that states it and in the post-mortems of the people who needed
it. `lefthook.yml` declares `pre-commit` and `pre-push` and **no `post-commit` hook**.

The second half of the leaf is the ledger, and it has stopped having inputs.
`.claude/active-runs.md` holds **118 entries under a `## Active` heading**. The newest is dated
**2026-08-13**. The conflict check the whole design turns on
(`docs/architecture/cli-coordination.md:123`) fires only for an entry that is `started`-status,
path-overlapping, **and less than 2 hours old** — and older-than-2-hours entries are explicitly
*"presumed abandoned"* (`:129`). Four days after the last write, **every one of the 118 entries is
presumed abandoned**, so the check returns "no live conflict" for every path in the repository,
by construction, without looking at anything.

It is also full of finished work. Hand-verified over the 39 entries in the live `## Active`
section: **29 declare themselves complete** — 27 with a `**COMPLETE**` / `SHIPPED` / `MERGED`
marker in the heading, one reading literally `Status: complete`, one reading
`Status: **work complete, UNCOMMITTED in the working tree**`. Ten remain genuinely open, aged
**11 to 22 days**.

And the mechanics are broken in a way the Conventions section cannot see. The file's own
Conventions say *"The `## Active` section is the source of truth"* (singular) and *"Concurrent
edits to this file: re-read on Edit failure, repeat the conflict check, retry. The Edit tool's
unique-old-string rule prevents silent clobbers."* The file contains **two** literal `## Active`
headings (`:3` and `:1167`) and **two** `## Recently completed (last 14 days)` headings (`:1957`
and `:3041`). An Edit anchored on the documented append point is therefore **non-unique**, which
is a *permanent* failure, not a transient one — and the documented recovery is "retry".

Finally, the campaign that is writing this sentence is the proof. Since the last ledger write:
**116 commits, 352 distinct files, 145 new golden-path documents**, produced by waves of five
concurrent composer agents on one checkout — and **zero ledger entries**. The corpus's own
governing documents record the predicted consequence twice: `golden-path-contract.md:225-231`
("three wave-2 composers wrote that one shared file concurrently and a completed,
runner-validated rule was silently overwritten"), and `golden-path-doctrine.md` §4 ("sibling
composers share the scratchpad directory and have overwritten each other's files"). **Both were
fixed by giving each writer its own file and merging afterwards — never by using the ledger.**

That is the finding underneath all of it, and it is the prescription in §2: **this system has
independently converged, three separate times, on "give every writer a private artifact and
reconcile at a merge point" — a private census registry per composer, a unique scratchpad
filename per agent, and `docs/architecture/cli-coordination.md:231`'s own unimplemented
reconsideration trigger (*"one entry per file under `.claude/active-runs/<id>.md`"*). The
isolated `GIT_INDEX_FILE` is the same shape applied to the index, and `git worktree` is the same
shape applied to the tree.** Coordination around a shared mutable object is the thing that keeps
failing; isolation plus reconciliation is the thing that keeps being reinvented.

---

## 1. Trigger

You are in this situation when any of these is true:

1. *"Another Claude session is working in this repo right now and I need to commit."*
2. *"I'm about to `git add` — what else is in the index?"* / *"why does `git status` show files I
   never touched?"*
3. *"My commit said 'no changes added to commit' but I definitely staged something."*
4. *"Two agents are editing the same file / registry / catalog — how do I not lose one?"*
5. *"This skill is about to write more than one file."*
6. **The "if you are about to write X" test:** if you are about to type `git stash`,
   `git add -A`, `git add .`, `git add -u`, `git commit --only`, or `git commit -- <paths>` in a
   checkout you do not exclusively own — stop, you are in this situation.

---

## 2. The one way

**Isolate, then reconcile — never coordinate around a shared mutable object.** Concretely, in
this order. **(a) If your write set is more than one file, take a `git worktree`.** It is the only
mechanism measured here that removes the race instead of narrowing it, and it costs one command:
`git worktree add .claude/worktrees/<slug> -b worktree-<slug>`. **(b) If you must commit on the
shared checkout, give yourself a private index rather than a clever pathspec.** Copy `.git/index`
to a private path, `GIT_INDEX_FILE=$IDX git add <your paths>`, `GIT_INDEX_FILE=$IDX git commit` —
this is the only form that scoped the files *and* took the staged content *and* survived a
sibling `git add` landing mid-flight (Q3/Q4/Q5 above). Where a file you must touch carries a
sibling's unstaged edits, stage your hunks into that private index with `git apply --cached`.
**Never `git commit -- <paths>` or `git commit --only <paths>`: both commit the working tree, so
they hand you a sibling's uncommitted edits to your own files under your commit message.**
**(c) Read back what actually landed.** `git log --oneline -1` (and `git diff --tree --name-only
-r HEAD` if the file list matters) immediately after every commit, compared against the message
and paths you passed. This is not belt-and-braces: a commit that silently no-ops is
byte-identical in the terminal to one that succeeded, and it is the only observation that
distinguishes them. **(d) When the readback disagrees, amend — never reset.** In every recorded
instance the content had landed and only the attribution was wrong; a reset turns an
attribution bug into data loss. **(e) Never `git stash`, and never `git add -A`/`.`/`-u`.** Stash
is a sweep of the whole tree including untracked files, and the thing it sweeps is whatever a
sibling has in flight. **(f) Do not trust a pre-commit staged-count check as a guard.** Q6 shows
it reads clean and the commit still takes a sibling's file, because the check's verdict expires
between the check and the commit; keep it as a *diagnostic*, and put the *guard* in (b) and the
*detector* in (c). **(g) Declare intent in the ledger anyway** — but understand what it buys: it
catches duplicated *work*, before either session writes code, and it buys nothing at all against
the index. Intent coordination and tree safety are different problems with different answers,
and this repo's history is a record of using the first where only the second would have helped.

> **Read alongside two neighbours.**
> [`commit-path-gates`](./commit-path-gates.md) owns what runs *at* commit time and its §7 D1-D6
> measure the hooks this path assumes; the `post-commit` verifier specified in §9 below is a
> hook that repo does not have, and that path is its owner if it ever lands.
> [`adding-a-ci-gate`](./adding-a-ci-gate.md) owns the fail-loud requirement that the §9
> instrument here inherits.

---

## 3. Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `git worktree add .claude/worktrees/<slug> -b worktree-<slug>` | **physical isolation.** A separate working directory and index sharing one object store. The only primitive here that makes the race impossible rather than narrower. |
| `GIT_INDEX_FILE=<path>` (an env var, seeded by `cp .git/index <path>`) | **a private index.** Verified: scopes the commit's file set, commits the staged content not the worktree, and is untouched by a sibling `git add` into `.git/index`. |
| `git apply --cached` | stages **your hunks** of a file that also carries a sibling's unstaged edits. The only way to commit a co-mingled file honestly. |
| `git log --oneline -1` | **the detector.** The single observation that separates "my commit landed" from "my commit silently no-oped and my files went into someone else's". |
| `git commit --amend` | **the recovery.** Content is present, attribution is wrong; amend fixes the second without risking the first. |
| `git diff --cached --stat` | a **diagnostic**, not a guard — see Q6. Useful for spotting a polluted index before you start; useless as the last thing before `git commit`. |
| `.claude/active-runs.md` | **intent coordination.** Declares scope so a second session does not duplicate work. Not a lock, not a tree guarantee. |
| `npm run clean:worktrees` (`scripts/worktree-gc.mjs`) | batch cleanup of worktrees other sessions abandoned — age / dirty / merged status, with `--force` to remove the clean+merged+stale ones. |

**Never:** `git stash` (any flags), `git add -A` / `git add .` / `git add -u`,
`git commit -- <paths>`, `git commit --only <paths>`, `git reset` as a recovery from a
misattributed commit.

---

## 4. Steps

1. **Read `.claude/active-runs.md`'s `## Active` section** and scan for an entry whose declared
   paths overlap your planned scope, is `started`, and is under 2 hours old. Today that yields
   nothing — see §7 D2 for why, and treat a nothing here as "no information", not "no conflict".
2. **Append your own entry** under `## Active` — slug, date, `Status: started`, and a `Paths:`
   line specific enough that overlap is meaningful (`src/features/agents/sub_chat/`, not `src/`).
   The heading is ambiguous today (§7 D4); append under the one at the top of the file.
3. **Decide isolation before you write anything.** More than one file, or any shared
   append-only registry (`rules.json`, `lib.rs`, `CHANGELOG.md`, a locale catalog, a checksum
   manifest) → `git worktree`. One file → the main checkout is fine.
4. **Work. Commit atomically** — one finding, one refactor step, one rollout step per commit; never
   more than ~30 minutes of uncommitted work in a shared tree.
5. **Before staging, classify the tree.** `git status --porcelain`, and for each entry decide:
   mine / pre-existing drift / another session's in-flight work. If the index already holds
   files you did not add, do not layer on top of it — go to step 6.
6. **Commit through a private index:**
   ```bash
   IDX="$(git rev-parse --git-dir)/tmp-index-$$"
   cp "$(git rev-parse --git-dir)/index" "$IDX"
   GIT_INDEX_FILE="$IDX" git add <your paths>
   GIT_INDEX_FILE="$IDX" git diff --cached --name-only    # exactly your paths, and nothing else
   GIT_INDEX_FILE="$IDX" git commit -m "<msg>"
   rm -f "$IDX"
   ```
   For a file that also carries a sibling's unstaged edits, replace the `git add` with
   `git apply --cached` over your own hunks.
7. **Read back, always:**
   ```bash
   git log --oneline -1
   git show --name-only --format= HEAD
   ```
   The subject must be yours and the file list must be your write set. **And then stop** — if
   both match, the primitives have taken over and there is nothing further to check.
8. **If the readback disagrees**, do not reset. If your content is inside someone else's commit,
   `git commit --amend` to a message that describes what is actually in it, and say so in the
   ledger entry; if your commit did not happen at all, re-run step 6.
9. **At session end**, move your ledger entry to the top of `## Recently completed` with the
   resulting SHA, or `aborted (<reason>)` / `handoff: <path>`.
10. **Remove the worktree** once its branch is confirmed in `git log master`:
    `git worktree remove .claude/worktrees/<slug>` then `git branch -D worktree-<slug>`. On
    Windows, remove any `node_modules` junction inside the worktree *first* — see §8 G4.

---

## 5. Anti-patterns

- **`git stash` to get a clean tree before committing.** Failure mode: stash captures the entire
  working tree, including another session's in-flight edits and (with `-u`) their untracked
  files, into a state most agents never think to look in. On 2026-05-09 this swept five files of
  a live `/research` run; recovery worked only because the one untracked file happened to still
  be reconstructible from conversation context.
- **`git commit -- <paths>` / `git commit --only <paths>` "to scope the commit".** Failure mode:
  both commit the **working tree** content of those paths (Q1, Q2), so any unstaged edit a
  sibling has made to a file in your list rides in under your message. The file *set* is correct,
  which is exactly what makes it convincing.
- **`git diff --cached --stat` as the last check before `git commit`.** Failure mode: TOCTOU.
  Q6 shows the guard reading exactly one file and the commit shipping two, because a sibling's
  `git add` landed in the gap. `/mvp`'s run-1 log records this same failure three separate times
  in one run.
- **Assuming a commit happened because the command printed hook output.** Failure mode: a no-op
  commit and a successful commit are indistinguishable in the terminal. The 2026-08-13 index
  contention incident (`active-runs.md:7`) was found only by `git log --oneline -1`; two other
  agents that day discovered theirs only from `git reflog`.
- **`git reset` to recover a misattributed commit.** Failure mode: the content is present and only
  the attribution is wrong; resetting converts a bookkeeping problem into a data-loss problem in
  a tree that other sessions are also writing.
- **Writing to a shared mutable registry from N concurrent agents.** Failure mode: last write
  wins and the loss is silent. `rules.json` lost a completed, runner-validated census rule this
  way; it was recovered only because its author had *also* pasted the block into their own
  document. A lost entry looks exactly like an entry nobody wrote.
- **A generic scratchpad filename.** Failure mode: two agents write `msg1.txt` and one overwrites
  the other between `Write` and `git commit -F`.
- **Treating an empty `## Active` conflict scan as evidence.** Failure mode: the check is
  vacuously true — every entry is over 2 hours old, so it reports "no conflict" without
  consulting anything (§7 D2).
- **A commit whose message describes a subset of its diff.** Failure mode: this is how a foreign
  file disappears. `389cdd6c8` is titled `polish(skills): sortable+aligned columns, spaced Use
  dialog, unified modals`, names only Skills-module work in 19 lines of body, and its diff
  deletes a 769-line component in a different feature — the first link in the five-commit chain
  in §7 D6.

---

## 6. Evidence

**The one site to copy: `.claude/mvp/calibration.md`.** It is not a spec, it is a
per-run calibration log, and it is the only artifact in this checkout that (a) states the correct
git mechanism, (b) proposes the working primitive, and (c) reports the result of applying it
across four subsequent runs. Its run-2 entry (`:54`) is quoted in §0; its run-4 entry (`:84`)
adds *"Pathspec commits held for the third run straight — zero swept commits across 8 builders
plus the orchestrator"*, plus the syntax trap that `git commit -- <paths> -m "msg"` fails because
the message must precede the pathspec. **A skill that writes down what happened to it and reads
that back at the start of the next run is the pattern; the git advice is downstream of it.**

Other exemplary sites:

- `docs/architecture/cli-coordination.md:46-75` — the design's own **rejected-alternatives**
  section (branching, daemon, lock files, rebase-on-merge), each with a stated reason. This is
  what makes the document still useful three months later: you can tell which constraints have
  changed. Four of its five reconsideration triggers (`:225-231`) have since tripped — see §7 D5.
- `docs/architecture/cli-coordination.md:231` — the trigger that predicted this path's §2:
  *"If two sessions consistently race on appending entries … the format may need a more
  conflict-resistant shape (one entry per file under `.claude/active-runs/<id>.md`, or YAML
  frontmatter with per-entry IDs)."* Written before the races happened.
- `.claude/skills/research/SKILL.md:145-185` and `:1150-1157` — the fullest register/deregister
  ritual in the fleet, including the one clause everybody else omits: overlap on
  `.claude/active-runs.md` *itself* is expected and is not a conflict.
- `.claude/skills/friend/SKILL.md:184` — the only skill that notices worktrees and the ledger
  interact: *"Append to `## Active` in the **main checkout's** `.claude/active-runs.md` (not the
  worktree's copy — they share the same file via git's worktree semantics, so the Edit lands in
  the same place)."*
- `.claude/active-runs.md:7` — the incident narration that earned the readback rule, written by
  the session it happened to, with the recovery it used. Ledger entries that carry a
  post-mortem are worth more than ledger entries that carry a status.
- `scripts/worktree-gc.mjs` (`npm run clean:worktrees`) — the janitor for the primitive in §3.
  It exists because step 10 is the step sessions skip.

---

## 7. Deviations

Ten. D1, D2, D3, D6 and D9 were executed or forensically traced; the rest were measured.

### D1 — the defeated incantation is prescribed 9 times; the working one appears in zero specs · executed

Census-measured over the 53 tracked `.md` under `.claude/skills/` (walk sees 53 files;
`node_modules` is skipped by the engine):

| signal | files | matches |
| --- | --- | --- |
| `git commit --only` / `git commit -- ` (the two forms measured to fail) | **6** | **11** |
| `GIT_INDEX_FILE` (the form measured to hold) | **1** | **3** |
| `git commit` (any form — the denominator) | 9 | 26 |
| `git log --oneline -1` / `git log -1` readback | 1 | 1 *(false positive — see below)* |

Hand-verified, all 11 opened: **11/11** are genuine occurrences of the defeated incantation.
Split by intent, **9 prescribe it** —

| site | what it says |
| --- | --- |
| `perfect/SKILL.md:206` | ``git commit --only <every path in this commit>``, "`--only` builds the commit from those" |
| `perfect/SKILL.md:226` | ``git commit --only <its write set> --no-verify`` for a builder's WIP |
| `perfect/SKILL.md:335` | ``git commit --only <every path in this commit> -m "..."`` |
| `perfect/SKILL.md:398` | "`git commit --only <paths>` **is the form that makes this safe by construction**" |
| `code-review/SKILL.md:29` | "(or use `git commit --only <files>`)" |
| `guide-sync/skill.md:47` | "`git commit --only <files>` **to bypass the shared index entirely**" |
| `prototype/SKILL.md:55` | same sentence, verbatim |
| `sentry/SKILL.md:59` | same sentence, verbatim |
| `.claude/mvp/calibration.md:11` | "builder briefs must use `git commit -- <paths>`" (run 1; **corrected by the same file at `:54` after run 2**) |

— and **2 document the defect** (`.claude/mvp/calibration.md:54`, `:84`). The three
`GIT_INDEX_FILE` occurrences are all in that one calibration log; **no SKILL.md mentions it.**

The readback row deserves its own line. The single match is
`i18n-translate/SKILL.md:145` — `git log -1 --format=%cI <locale file>`, which reads a file's
last-touched time. **The true count of skills instructing an agent to verify that its own commit
landed is zero**, against 26 commit instructions, and `lefthook.yml` has no `post-commit` hook
in which the check could live instead.

Four of the nine prescriptions make a claim the experiment refutes head-on: `--only`
*"bypasses the shared index entirely"*. Q2 shows it bypasses the index by taking the **working
tree**, which is strictly worse than the index for the failure it is invoked against.

### D2 — the ledger's only algorithm has had no valid input for four days · executed

`docs/architecture/cli-coordination.md:123` defines the conflict check: overlap **AND**
`started`-status **AND** *"the entry's `started` timestamp is less than 2 hours old"*. `:129`:
older than 2 hours → *"presumes the other session is abandoned"*.

Parsed from the file: **118 entries under a `## Active` heading** (39 + 79), newest dated
**2026-08-13**, oldest **2026-05-26**. Today is 2026-08-17. **Every entry is between 4 and 83
days old**, so the algorithm's third conjunct is false for all 118 and the check is vacuously
"no live conflict" for every path in the repository. It is not that the check is failing; it is
that it cannot be reached.

Of the 39 in the live section (`:3`), hand-verified: **29 declare themselves finished** and were
never moved to `## Recently completed`. Two are worth naming because they are self-refuting in
place: `:224` reads `Status: complete` while sitting under `## Active`, and `:264` reads
`Status: **work complete, UNCOMMITTED in the working tree** (awaiting operator review)` — dated
2026-07-29, still there, with a clean working tree today (see D6 for where that work actually
went). The 10 genuinely open entries are 11 to 22 days old.

### D3 — the field the algorithm reads is present on 59% of live entries · executed

The conflict check needs a `Paths:` declaration to compute overlap against, and a `Status:` to
apply the staleness rule to. Present in the live `## Active` section: **`Paths:`/`Scope:` on 23
of 39 (59%)**, **`Status:` on 16 of 39 (41%)**. In the older `## Active` block at `:1167` — the
one written when the convention was new — the same fields are on **73 of 79 (92%)** and **76 of
79 (96%)**.

The format did not decay so much as bifurcate: entries that were *closed* got rewritten as
narratives with a `**COMPLETE**` marker in the heading and the machine-readable fields dropped,
while entries still open kept them. Either way, **16 of 39 live entries carry the two fields the
design's one algorithm consumes.**

### D4 — the documented append anchor is not unique, so the documented retry can never succeed

`.claude/active-runs.md` contains six `##` headings: `Active` (`:3`), `Recently completed`
(`:301`), `Conventions` (`:1155`), **`Active` again** (`:1167`), `Recently completed (last 14
days)` (`:1957`), and **`Recently completed (last 14 days)` again** (`:3041`).

Three consequences, all live:

- The Conventions say *"The `## Active` section is the source of truth"* — there are two, holding
  39 and 79 entries, and a session that reads the first never sees the other 79.
- Sixteen skills instruct "append to `## Active`". With two identical headings, an `Edit` anchored
  on that string fails the unique-old-string requirement — and the Conventions' prescribed
  recovery is *"re-read on Edit failure, repeat the conflict check, **retry**"*, which cannot
  succeed because the ambiguity is structural, not transient.
- `## Recently completed (last 14 days)` at `:1957` spans **2026-05-26 to 2026-07-27** — 62 days
  in a section whose heading promises 14. The trim step in the ritual is not running either.

### D5 — four of the design's five reconsideration triggers have tripped

`docs/architecture/cli-coordination.md:225-231` lists the conditions under which the design
should be revisited. Measured today:

| trigger | status |
| --- | --- |
| *"Multiple machines / worktrees become routine."* | **tripped.** `git log` carries `de0720b8c Merge origin/master — 75 commits from the other device` and `3968de562 … 12 commits, 30 conflicts resolved by class`; the operator's memory index records both devices as homes. |
| *"Session-density grows past ~5/day per project. v1 ledger format works fine at today's 3-runs/day cadence."* | **tripped, by roughly 5×.** The golden-path campaign runs **5 concurrent composers per wave**, multiple waves per day. |
| *"A non-`/research` skill duplicates work without registering."* — described as a *"concrete signal that a v2 cross-skill adoption gap is overdue"* | **tripped repeatedly.** Three wave-2 composers concurrently overwrote `scripts/census/rules.json` and lost a finished rule; sibling composers have overwritten each other's scratchpad files; and `/scan-sweep` deleted a file whose intentional removal was recorded in the ledger (D6). |
| *"The auto-baseliner produces SHA confusion in Phase 13."* | not observed. |
| *"The ledger file itself becomes a git-conflict hotspot"* — with the proposed fix *"one entry per file under `.claude/active-runs/<id>.md`"* | **tripped** (585 commits touch the file), and the proposed fix was subsequently **reinvented twice elsewhere** — a private census registry per composer, a unique scratchpad filename per agent — without either reinvention citing it. |

### D6 — a five-commit, three-session, seven-day chain in which one file was deleted twice · forensic

The ledger entry at `:264` says the roster pass DELETED `PersonaOverviewVariantConstellation.tsx`
and that the work was uncommitted. Traced through `git log`, what actually happened:

| # | commit | date | what |
| --- | --- | --- | --- |
| 1 | `389cdd6c8` | 2026-07-29 10:34 | `polish(skills): sortable+aligned columns, spaced Use dialog, unified modals` — 9 files, **853 deletions**, of which **769 are `PersonaOverviewVariantConstellation.tsx`**, a component in a different feature that the message never mentions. Master's typecheck broke. |
| 2 | `5afe5b4ca` | 2026-07-29 11:15 | `fix(personas): restore PersonaOverviewVariantConstellation` — a repair session restored it verbatim from `389cdd6c8^`, reasoning correctly from the evidence available: *"nothing in that commit suggests the variant was meant to go"*. |
| 3 | `39819a963` | 2026-07-30 | the roster pass lands, removing the import, the `VARIANTS` entry, the render site and the i18n keys — the **intentional** removal, the one the ledger recorded. |
| 4 | `887c16776` | 2026-07-30 | `Merge remote-tracking branch 'origin/master'` carries the restored file forward. |
| 5 | `5a65990a9` | 2026-08-05 | `/scan-sweep`, lens `tech-debt-tracker`, finds a 769-line zero-importer orphan and deletes it — along with two widgets only it consumed. 873 deletions. |

**Four commits and forty minutes of a human's attention to remove one file**, because the only
place the intent was written down was a ledger nobody read. Note that the repair at step 2 was
*correct*: with commit 1's message describing only Skills work, a restore was the right call. The
defect is upstream — a commit whose message describes a subset of its diff (§5) — and the ledger
was the one artifact that could have disambiguated it.

Also note the entry at `:264` is wrong in its own right: it claims the work was uncommitted, and
`39819a963` had already landed it.

### D7 — sixteen of thirty-five skills carry the ritual; the ones that don't include the heaviest committers

Measured two ways (§12.3 records the disagreement and its resolution). Of 35 skills:

- **16 carry both a register and a deregister step**: add-credential, add-template, architect,
  code-review, explorer, friend, guide-sync, perfect, prototype, refresh-context, research,
  sentry, ship-milestone, spark, triage-backlog, uat.
- **1 registers and never deregisters**: `ship-loop` (`SKILL.md:40`) — and it commits atomically
  through nine milestone phases.
- **3 make it conditional** — *"if the repo has an active-runs ledger, honor it"*: codebase-init,
  idea-run, project-populate. All three are designed to run in an arbitrary target repo, so
  conditional is the correct form.
- **2 mention it without a ritual**: athena, passport-onboard (the latter only inside
  `references/dimensions.md`, as a dimension it *assesses in other repos*).
- **13 do not mention it at all.**

The composition of that last group is the finding, not its size. It contains **`/scan-sweep`**,
whose own description is *"by default FIXES the accepted S/M findings in-session with atomic
commits — one session owns one context end to end"*, and whose spec carries the staging
discipline (`SKILL.md:183-190`: explicit pathspecs, staged-list confirmation, shared files
committed immediately) — it adopted parallel-safety primitive #7 and not the ledger. It also
contains `/tiger`, `/i18n-translate` (which rewrites 14 locale catalogs), `/motionize` and
`/leonardo` (both of which write components and assets into `src/`), `/promote`, `/mvp` and
`/kpi-sim`.

So the brief's premise — *"one adopter (`/research`)"* — understates adoption by 16×, and the
gap is not where it was expected: the ledger's non-adopters are not the read-only skills, they
are the newer autonomous ones. See §12.2.

### D8 — the "full design rationale" link in four skills points at a file that does not exist

`add-credential/skill.md:27`, `guide-sync/skill.md:32`, `refresh-context/skill.md:47` and
`sentry/SKILL.md:46` each close their coordination section with
*"Full design rationale: [`docs/concepts/cli-coordination-active-runs.md`]"*. That path does not
exist. The document moved to `docs/architecture/cli-coordination.md` on 2026-05-10 — the move is
recorded in the file's own header (`:3`) — and **7 files still link to the old path**, including
`docs/concepts/README.md` and `docs/BACKLOG.md`. Four of the sixteen ritual-carrying skills
therefore route an agent that wants to understand *why* to a 404.

### D9 — `git worktree list` shows one worktree; the directory holds three abandoned checkouts

```
$ git worktree list
C:/Users/mkdol/dolla/personas  dfd846b3b [master]

$ ls .claude/worktrees
athena-dev-515e976a   athena-dev-afc86f6c   athena-dev-fe5c433a

$ ls .git/worktrees
ls: cannot access '.git/worktrees': No such file or directory
```

Git has no record of any of them; each is a full working copy on disk (two carry `node_modules`,
one carries `docs/`, `eslint-rules/`, `evals/` and a `du.exe.stackdump`). This is Phase 13
failing in the direction nobody checks: the git metadata was cleaned and the directories were
not, so `npm run clean:worktrees` — which enumerates *git's* worktrees — cannot see them either.

Zero `worktree-*` branches remain, so the branches were tidied. And `active-runs.md:204` still
declares `Worktree .claude/worktrees/prototype-mm-goals (branch worktree-prototype-mm-goals)` for
an entry that is still `Status: started`; neither the directory nor the branch exists.

### D10 — the campaign writing this document has not registered once

Since the last write to `.claude/active-runs.md` (2026-08-14, and the last *ledger* commit
2026-08-13): **116 commits, 352 distinct files, 145 new documents under
`docs/concepts/golden-paths/`, zero ledger entries.** Working-tree state at the time of writing
shows six sibling composers' in-flight edits plus a regenerated ts-rs binding.

This is the leaf's own condition, at maximum intensity, in the corpus that documents it — and
the two losses it produced were both handled by *withdrawing from the shared file*
(a private census registry per composer, a unique scratchpad filename per agent) rather than by
using the coordination surface. §2 generalises that response rather than scolding it.

---

## 8. Gaps

**G1 — the ledger cannot express a lock, and was designed not to.** `docs/architecture/cli-coordination.md:17`:
*"No locks, no daemon, no queue, no branching."* Its accepted tradeoff (`:218`) is that a session
which forgets to register is invisible. That was a reasonable trade at 3 runs/day and is the
wrong trade at 5 concurrent agents; the design says so itself (`:228`). **The gap is real and the
design named it — what is missing is that nobody re-read the trigger list.**

**G2 — no primitive here coordinates *intent*; they only protect the tree.** A worktree, a private
index and a readback all prevent loss. None of them stops two agents from independently designing
the same feature, which is the failure the ledger was built for (the 2026-05-09 `/research`
near-duplicate). Isolation makes the tree safe and makes duplication *more* likely, not less. A
complete answer needs both halves, and this repo currently has a strong version of one and a
decayed version of the other.

**G3 — `GIT_INDEX_FILE` and lefthook are untested together here.** Q4/Q5 were run in a repo with no
hooks. Lefthook's partial-commit handling stashes unstaged changes around a `pre-commit` run; how
that composes with an alternate index has not been measured on this checkout, and measuring it
means running the real hook on a real commit, which is outside this session's non-destructive
remit. **Specify it, run it once, and record the result** — the whole §2 (b) rests on it holding.

**G4 — worktree removal on Windows has a junction ordering hazard.** Recorded in the operator's
memory index and in two ledger entries: `node_modules` inside a worktree is a directory junction,
and `git worktree remove` fails or removes the *target* unless the junction is removed first. The
step-10 sequence is therefore `rmdir` the junction, then `git worktree remove`. This is a real
platform limitation, not laziness, and it is the most likely reason for the three orphans in D9.

**G5 — the census cannot assert the absence that matters most.** The strongest finding in D1 is
that **zero** skills instruct a post-commit readback. A ratchet counts something present; it
cannot say "no document anywhere tells an agent to verify its commit". Same wall as
`check-csp-hosts.mjs`. §9 gates the *presence* of the defeated form and specifies a separate
instrument for the absence.

**G6 — a `post-commit` hook cannot fail a commit.** By git's design the commit has already been
written when `post-commit` runs; the hook's exit code is ignored. So the verifier specified in §9
is a **loud detector**, not a gate — it can print, log, and set a non-zero marker file, and it
cannot roll anything back. That is sufficient for this defect (the whole problem is that the
failure is silent) and it is worth stating plainly so nobody mistakes it for a guard.

---

## 9. The gate

One rule and its positive control, validated standalone in a composer-private scratch registry
(`rules-testworkflow-b7f2.json` — filename unique to this composer), hand-verified at the level
of the matched substring, then re-extracted from this document and re-run to identical numbers.
**The full registry was not run** — per the doctrine, that is the orchestrator's step.

**The condition the signal is a proxy for, stated stack-free so another repo can re-derive its
own:** *the project's agent-facing instructions prescribe a technique that the project has
already measured to be unsound, because the correction landed in a different document from the
prescription.* In this stack that manifests as `git commit --only` surviving in six skill files
after the experiment that refutes it; in a repo whose agent instructions live in `AGENTS.md` or
a prompt template it will manifest wherever a superseded incantation is copy-pasted between
specs. The general instrument is **an inventory of prescriptions checked against the log of
what was measured** — which is why the second half of this section specifies a checker rather
than a second pattern.

```json
{
  "id": "defeated-pathspec-commit",
  "goldenPath": "docs/concepts/golden-paths/parallel-session-coordination.md",
  "roots": [".claude/skills"],
  "extensions": [".md"],
  "signal": {
    "pattern": "git\\s+commit\\s+(?:--only|--)\\s",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "an agent-facing instruction to scope a commit with a pathspec. PROXY FOR the stack-free condition: the project prescribes a technique it has already measured to be unsound. Executed in a hook-free throwaway repo, BOTH `git commit -- <p>` and `git commit --only <p>` commit the WORKING TREE rather than the index, so a sibling's unstaged edits to a file in your pathspec ride in under your message. Four of the matching sites claim the opposite in so many words (\"bypass the shared index entirely\") and one calls it \"safe by construction\"."
  },
  "baseline": { "files": 6, "matches": 11 },
  "floor": 40
}
```

```json
{
  "id": "defeated-pathspec-commit-positive-control",
  "goldenPath": "docs/concepts/golden-paths/parallel-session-coordination.md",
  "roots": [".claude/skills"],
  "extensions": [".md"],
  "signal": {
    "pattern": "GIT_INDEX_FILE",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "POSITIVE CONTROL - the isolated-index form, the one technique measured to scope the file set AND take the staged content AND survive a sibling `git add` mid-flight. Partitions the repo's commit-scoping advice into the form that fails and the form that holds."
  },
  "floor": 40
}
```

**Baseline, as run:** gate **6 files / 11 matches**; control **1 file / 3 matches**; walk sees
**53** files against a floor of 40. The **11-to-3 ratio is the finding**, and so is the shape of
the 3: all three are in `mvp/state/calibration.md`, a per-run log, and none is in any SKILL.md
specification. The control is a genuine partition of one construct — *how this repo tells an
agent to scope a commit* — into the failing and holding forms, which is the strongest form the
doctrine asks for.

**Hand-verified precision: 11/11.** Every match was printed with 70 characters of following
context and opened. All eleven are real occurrences of the incantation; **9 prescribe it**
(table in §7 D1) and **2 document the defect** (`calibration.md:54`, `:84`). Precision as
"a prescription" is therefore **9/11 = 81.8%**, and the two non-prescriptions are precisely the
lines that record the correction — an exemption class no pattern can separate, because the
defect and its post-mortem are the same string. Reported both ways rather than picking the
flattering one.

**Pattern selection was measured, not assumed.** Three candidates were run and printed their
matched substrings: a loose form allowing 40 characters between `commit` and the flag, the tight
form above, and a backtick-anchored form. **All three return 6 files / 11 matches with identical
sites.** The tight form ships because it is the simplest thing that reproduces the set — the
looser variants buy nothing and would eventually catch `git commit --amend --no-verify`-shaped
prose.

**Fault injection — eight cases, driven from a node harness that captures the raw exit code and
never pipes it.** A synthetic three-file corpus was built in the scratchpad: one file with the
four violating shapes, one with four near-misses, one with the control token.

| # | injection | expected | measured |
| --- | --- | --- | --- |
| A | synthetic corpus, baseline 1/4 — 4 violations (`git commit --only a.ts`, `` `git commit -- src/x` ``, `git commit  --only  <p>`, `$ git commit -- .`) vs 4 near-misses (`git commit -m "x"`, `git commit --amend`, `git diff --cached --stat`, `git commit --no-verify -m "y"`) | gate 1 file / **4** matches, control 1/1, near-miss file untouched | **exit 0**, gate `1 / 4`, control `1 / 1` — the near-miss file contributes **0** |
| B | rise: baseline 1/2, actual 1/4 | fail | **exit 1** |
| C | silent drop: baseline 9/99, actual 1/4 | fail | **exit 1** |
| D | floor breach: `floor` 500 over a 3-file corpus | fail | **exit 1**, both rules |
| E | empty tree, `floor` 1 — the zero-match assertion | fail | **exit 1**, reported as a silent drop 4 → 0 |
| F | positive control declared **with** a `baseline` | rejected by `validateRule` | **exit 1** — *"a positive control must NOT carry a baseline"* |
| G | the real repo, as published: `.claude/skills`, baseline 6/11, floor 40 | pass | **exit 0**, gate `6 / 11`, control `1 / 3`, walked `53` |

A first attempt at this harness failed for the reason the doctrine names: the rules JSON was
built in a bash heredoc and MSYS ate the backslashes, so `\\s` reached the runner as `s` and the
parse threw. Regenerated with `JSON.stringify`. Worth repeating because the failure was loud —
had the mangled pattern happened to parse, every case would have measured a different rule.

The near-miss that matters is `git commit --amend` and `git commit --no-verify`: both are
`git commit` followed by a `--`-prefixed token, and a naive `git commit\s+--` catches them.
Requiring `(?:--only|--)\s` — the flag `--only`, or a bare `--` followed by whitespace, which is
git's end-of-options marker and therefore always introduces a pathspec — is what buys 11/11.

**Overlap, measured at SITE level against the FINAL pattern.** No registered rule roots anywhere
under `.claude/`; the registry's 178 rules root at `src`, `src-tauri`, `scripts`, `tools`,
`tests`, `uat`, `evals` and `eslint-rules`. **Site overlap: 0, structurally.** This rule is the
registry's first entry pointed at agent-facing documentation, which is worth flagging to the
orchestrator as a new population rather than a new pattern.

**A population note the doctrine demands.** `.claude/skills` on disk holds 81 `.md`; 53 are
tracked. The 28-file difference is entirely `motionize/node_modules/`, which the census engine
skips via `ALWAYS_SKIP_DIRS`, and `motionize/out/` holds **0** `.md`. So the walk sees 53 on this
machine and 53 on a clean clone — **the population is machine-independent**, unlike the case
`tauri-permissions-and-csp` had to decline. The floor is set to 40, comfortably under 53 and
comfortably over zero, so a mis-rooted walk fails loudly.

### The instrument the census cannot be: a post-commit readback

**Specified, not installed.** The defect this leaf is named for — a commit that silently does not
happen, or happens into someone else's — is detectable in three lines, and every incident in the
record would have been caught by them:

```bash
# .lefthook/post-commit/verify-landed.sh  (NOT INSTALLED — see the deferred register)
expected="$(cat "$(git rev-parse --git-dir)/COMMIT_EDITMSG_EXPECTED" 2>/dev/null)" || exit 0
actual="$(git log -1 --format=%s)"
[ "$expected" = "$actual" ] || printf 'COMMIT MISMATCH\n  expected: %s\n  landed:   %s\n' \
  "$expected" "$actual" >&2
```

Three properties make it worth specifying precisely:

1. **It fails loudly when its own precondition is absent.** Without the expected-subject file it
   exits 0 rather than passing silently on nothing — but the *caller* must write that file, so
   the honest version of the fail-loud requirement here is that the skills' commit step writes
   the expected subject before committing. A hook that can only compare `HEAD` against itself is
   one of the no-op gates `adding-a-ci-gate` catalogues.
2. **It cannot be a gate** (§8 G6): `post-commit` runs after the commit object exists and its exit
   code is ignored by git. It is a detector. That is exactly right for this defect, whose entire
   nature is silence.
3. **It runs on every commit the operator makes, in an app in daily use.** Installing a hook is a
   change to what happens when the operator types `git commit`, which the standing rules place
   firmly on the note-it side of the line.

**Registered as deferred fix #73** in
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md), together with the two
doc-level corrections this document earns but does not apply: CLAUDE.md's mechanism (§12.1) and
the nine `--only` prescriptions (§7 D1).

**And the absence that no ratchet reaches.** Zero of 53 skill documents instruct a readback. The
instrument for that is an **inventory comparison**, not a count: enumerate the skills that
instruct `git commit` (9 today), enumerate those that instruct a readback (0), and fail when the
first set is not a subset of the second — with an exit-2 guard if it finds fewer than 5
committing skills, because a rename in `.claude/skills/` would otherwise make it measure nothing
forever. That is ~30 lines and it is the same shape as the orphan-binding inventory the corpus
already knows it needs.

---

## 12. Corrections

### 12.1 — to `.claude/CLAUDE.md:277`, and to the brief that quoted it: the mechanism is wrong and the conclusion is too strong

CLAUDE.md's parallel-safety primitive #5 states that `git commit -- <pathspec>` *"does NOT
reliably scope the commit **when lefthook is installed**"*, attributes the cause to
*"lefthook's partial-commit handling re-stages"*, and concludes *"**There is no reliable
pathspec-scoping incantation** while another agent commits to the same worktree."* My brief
carried all three claims forward as settled.

**All three are wrong, and the experiment needs no second agent to show it.** In a `git init`
repository with no hooks and no concurrency:

- **Q1: `git commit -- <path>` commits the working tree.** Staged `STAGED`, wrote `WORKTREE` over
  it unstaged, committed with a pathspec — the commit contains `WORKTREE`. Lefthook is not
  involved and cannot be.
- **Q2: `git commit --only <path>` does exactly the same.** CLAUDE.md's own first paragraph says
  *"`git commit --only <paths>` did hold"* and its second says it did not; neither explains why,
  because the reason is that both take the working tree and *whether that hurts depends on
  whether a sibling had unstaged edits to your files that time*.
- **Q3: pathspec commits DO scope the file set correctly.** A sibling's pre-staged
  `sibling.txt` stayed staged and out of the commit. So the failure was never about *which files*
  — it was about *whose content* in the files you named. That distinction is the whole fix, and
  no version of CLAUDE.md's text makes it.
- **Q4/Q5: an isolated `GIT_INDEX_FILE` scopes the file set, commits the staged content, and is
  untouched by a sibling `git add` landing mid-flight.** So a reliable mechanism exists.

The correct general statement is: **there is no reliable *pathspec* incantation, because
pathspec commits read the working tree; there is a reliable *index* mechanism, and it is
`GIT_INDEX_FILE`.** Owed as an edit to `.claude/CLAUDE.md:277` and registered as deferred fix
#73 rather than applied, because CLAUDE.md is loaded into every session in this repo and
rewriting it mid-campaign changes what five running composers believe.

**The corollary is the more useful finding.** The right answer was already in the checkout, in
`/mvp`'s calibration log, discovered independently by a builder in a different repo four days
before CLAUDE.md's entry was written — and it did not travel, because a per-run calibration log
is not a place anyone looks for a project-wide rule. **When a skill's own log corrects a
project-wide doctrine, the doctrine does not find out.** That is a coordination failure between
*documents* and it has the same shape as the one between sessions.

### 12.2 — to the brief: the ledger has 16 adopters, not one, and the gap is not where it was expected

The brief framed §0 around a ratio: *"The ledger is intent coordination with one adopter
(`/research`). A convention adopted by one of N skills is not a convention. Measure: how many
skills materially edit files, and how many carry the Phase 0 register / Phase 11 deregister
ritual?"*

Measured: **22 of 35 skills reference the ledger; 16 carry both rituals; 1 registers without
deregistering; 3 make it conditional (correctly — they run in foreign repos); 13 are silent.**
The v2 rollout described at `docs/architecture/cli-coordination.md:135-164` shipped, and mostly
stuck.

So the ratio is not the story. **The story is which 13 are silent**, and it inverts the brief's
expectation. The design doc's own "explicitly not adopting" list (`:164`) names read-only skills
— `/explorer`, `/prime`, `/reflect`, `/record-demo`. Today `/explorer` **has** adopted (it grew
an execute phase), and the silent set is instead the *newer autonomous* skills: `/scan-sweep`
(atomic commits in this repo by design), `/tiger`, `/i18n-translate`, `/motionize`, `/leonardo`,
`/mvp`, `/promote`, `/kpi-sim`. Adoption did not decay; it was never extended to anything written
after 2026-05-09.

The sharper observation is that `/scan-sweep` adopted the parallel-safety *primitives*
(`SKILL.md:183-190` — explicit pathspecs, staged-list confirmation, immediate commits on shared
files) and not the *ledger*. Given §0's finding that the primitives are what protect the tree and
the ledger is what protects against duplicated design, that is a defensible half-adoption and
not simple negligence. It also means the two halves have been drifting apart in practice for
three months, which is what §8 G2 is about.

### 12.3 — my two implementations disagreed twice, and one disagreement agreed with my thesis

**Disagreement A — 13 vs 16 skills carrying both rituals.** Implementation A applied a
hand-written regex signal list to whole-file text; implementation B split each file into
sentences, isolated those naming the ledger, and classified them by imperative verb. A said 13,
B said 16. Hand-verification of the three disputed skills (`code-review`, `guide-sync`, `uat`)
found **B correct in all three**: A's register regex required the phrase *"register this session
in"* and missed *"Register in [link] before writing any report file"* and *"then append your own
entry"*. A also missed `ship-loop`'s register-only form. **Published figure: 16, from B.** The
vocabulary lesson is the doctrine's: A's word list came from reading four skills and generalising,
so it was precise on the ones it was derived from and blind to the phrasings it had not seen.

**Disagreement B — the one I nearly published.** My first ledger parser reported that the live
`## Active` section carried a `Status:` field on **0 of 39** entries against **75 of 79** in the
older block, and I wrote the sentence "the format decayed exactly when deregistration stopped."
It was anchored wrong: the parser required `Status:` at line start (optionally after a bullet),
and the current section writes it mid-line — `- Started: 2026-08-06. Status: started (Phase 1-2,
scouting)`. Re-run anchor-free: **16 of 39, not 0 of 39.** The finding survives in weakened form
(41% vs 96%) and the *narrative* — a decay — did not survive at all; the honest description is a
bifurcation between closed entries rewritten as prose and open entries that kept their fields.

I caught it only because I hand-read twelve entries for a different purpose and saw `Status:` in
all twelve. **The measurement supported a conclusion I already believed, which the doctrine names
as exactly the condition under which to re-run it, and I re-ran it by accident rather than by
discipline.** Recorded here in that spirit.

**A third, minor one, resolved as an instrument difference, not a finding.** My bespoke walk
reported `shared/chrome` at 94 restricted-import sites; the census pattern reports 77. The gap is
dynamic `import('@/…')` and re-export forms, which the census pattern (anchored on `from
['"]@/`) does not match by design. Both numbers are right about what they measure; only the
census figure is published, in the sibling leaf that owns it.

### 12.4 — spine labels

**`sides: "server"` is contradicted, and the correction is "neither".** This leaf has no client
half and no server half. Its entire subject matter is git, a markdown ledger, `lefthook.yml` and
`.claude/skills/**` — build-and-process surface that does not run in either the WebView or the
Rust binary. The exemplar (`mvp/state/calibration.md`), all ten deviations, the census rule, its
control and its floor are all outside `src/` and `src-tauri/` entirely. This is the eighth
recorded `sides` contradiction and it is a **new mode**: not incomplete, not inverted, but a leaf
for which the client/server axis has no meaning. The spine's `sides` enumeration has no value
for "process".

**`convergence: converged` is contradicted, and it fails in the doctrine's tenth mode — the
fleet converged on the disease.** The sibling sweep was scoped to the one question this leaf can
ask of another repo: does it have a coordination surface for concurrent agents on one checkout?
`../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman` and `../ascent` were checked
for an `active-runs`-shaped artifact. **None has one** — five silences. Read as agreement, that is
"5 of 5 converged"; read correctly, it means **Personas is the only repo in the cohort that runs
five agents concurrently on one checkout, so it is the only one with the problem, and it owns
the fleet's only answer to it.** Consistent with the doctrine's `embedded-terminal-session`
precedent, where the label pointed at a 5/5 silence and its direction was backwards. (All five
checkouts exist and four carry a `.claude/` directory of 9-18 files, so this is a silence about
the practice, not an absence of the surface it would live on.) A partial primitive sweep before
the remaining repos timed out found `personas-web` at **0 `GIT_INDEX_FILE`, 1 `git worktree`
mention, 3 `git stash` mentions, 0 pathspec-commit mentions** — the one sibling measured
*recommends* the thing this repo bans, which is a mild inversion and is reported rather than
built on.

There is, however, one genuine cross-repo data point and it is the strongest evidence in this
document — and it is **not** an agreement. `/mvp`'s calibration log is a record of the same
practice being applied in **five different repositories** (ascent, systedo-case, gravitone,
lighttrack, and one more) across four runs with eight concurrent builders, *failing* in run 1-2,
being *corrected* to the isolated-index form, and then *holding* for runs 3, 4 and 5. Per the
doctrine's weighting that is cost-and-failure evidence, not agreement evidence, and it survives
the single-author confound: the same person got it wrong, was forced by a measured failure to
change it, and the changed version held under repeated adversarial conditions. **That is the
best available argument for §2 (b), and it is worth more than five siblings nodding.**

**`twoSided: false` holds** — trivially, given the `sides` finding above.

### 12.5 — the primed leads, checked

- ***"the ledger is the coordination surface; `/research` is the first adopter"*** — true as
  history (`cli-coordination.md:248` names it), false as present state (§12.2). The word "first"
  in the design doc has been read as "only" for three months.
- ***"`git commit --only` does hold"*** (CLAUDE.md's own first paragraph, before its own second
  paragraph retracts it) — **refuted by Q2**, and the retraction's replacement mechanism is also
  wrong. Both halves of that primitive needed the experiment.
- ***"verify `git log --oneline -1` — this is the only step that detects the failure at all"***
  — **confirmed and, as far as I can measure, uniquely correct in that document.** It is also the
  one clause of the primitive that reached zero skills.
- ***"`git worktree` is the only structural fix"*** — **half right.** It is the only structural fix
  *for the tree*. `GIT_INDEX_FILE` is a structural fix for the index, and it is cheaper: no
  second checkout, no `node_modules`, no Windows junction hazard, no merge step, no orphan
  directories (§7 D9). For a session committing three files on the shared checkout, the private
  index is the right primitive and the worktree is overkill.
- ***"the recovery commit for the stash incident itself swept 18 pre-staged files"*** —
  confirmed verbatim in `cli-coordination.md:176`, and Q6 now supplies the mechanism that made
  it inevitable rather than unlucky.

---

## 13. Field incident, 2026-08-17, hours after this document was written

The orchestrator's `git push` of the commit that **contains this document** failed with
exit 1:

```
 ! [remote rejected] master -> master (cannot lock ref 'refs/heads/master':
   is at 313dc6a846… but expected de274d14db…)
```

**The work was already published.** A sibling session pushed `master` during the **487
seconds** this push spent in pre-push hooks (typecheck 290 s, golden-path census 178 s),
and because both sessions share one checkout and one branch, the sibling's push carried
the orchestrator's commit with it. The remote then advanced once more, to the sibling's
own `fecbacb42`. By the time the rejection printed, the ref the push wanted to move had
been moved twice by someone else.

Three things this adds to §2, all measured rather than reasoned:

1. **A failed push does not mean unpublished work.** The compare-and-swap failed on the
   *ref value*, not on the *content*. All five of the orchestrator's commits were
   already ancestors of `origin/master`.
2. **Comparing `HEAD` to `origin/master` is not the check.** Run at the moment of
   failure it read `local 313dc6a84 / remote fecbacb42 / ahead 1` — which looks like
   divergence and is not. `origin/master` is a **local cache** that a failed push leaves
   at whatever the last fetch saw. The honest check is an explicit fetch followed by an
   **ancestry test per commit**: `git merge-base --is-ancestor <sha> origin/master`.
   That is the push-side analogue of §2's `git log --oneline -1` readback, and it is
   owed for exactly the same reason — the failure mode is a **green-looking wrong
   answer**, not an error.
3. **The hook duration is the race window.** 487 seconds is not a hook cost, it is an
   *exposure*: every second of pre-push validation is a second in which the ref you are
   about to move can move. Nothing here is wrong with the hooks — but a session that
   treats push as instantaneous will keep being surprised by this, and the longer the
   repo's gates get, the wider the window opens.

The correct response was to do **nothing but verify**. No re-push, no pull, no rebase,
no reset — the desired state already held, and every one of those commands would have
been an edit to shared history in service of a problem that did not exist.
