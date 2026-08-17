# Golden path — Commit-path gates

> Situation node: `platform-delivery/gates-and-conventions/commit-path-gates` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **medium** ·
> sides: **server** · convergence: **converged** ·
> dimensions: **code-quality · resilience · performance** ·
> `twoSided: false` · merged from *"Git hook design"* + *"Conventional commit format"*.
> Composed 2026-08-17 against `master` @ `afb295187`. A parallel session moved
> the tree to `2edb8d694` mid-composition; every number below is re-stated with
> the commit it was taken at, and §12.6 records the one measurement that moved.
>
> **Sweep size.** `lefthook.yml` (91 lines) read in full and **every one of its
> ten jobs executed**, timed, and its exit code recorded. The three installed
> files in `.git/hooks/` read in full. `package.json`'s **77** scripts,
> the **9** constituents of `npm run check` (each executed separately),
> **24** gate-shaped scripts under `scripts/` mapped to every possible invoker
> (npm script / lefthook / GitHub CI / GitLab CI / codegen registry /
> `.claude/settings.json`), all **7** GitHub workflows plus `.gitlab-ci.yml`,
> `scripts/generate-changelog.mjs` and `scripts/bump-version.mjs`.
> **7,047** non-merge commit subjects classified against the commit-lint
> pattern; **1,000** commits' file sets replayed against each pre-commit glob.
> The GitHub Actions API queried for all seven workflows, all-time.
>
> **Measured by execution.** Nothing here is inferred from reading a config.
> The ESLint gate was **fault-injected three ways** to find out what actually
> disarms it — and the answer contradicts what
> [`golden-path-doctrine.md` §3](../golden-path-doctrine.md#3-the-severity-fact)
> has been telling five golden paths (§12.1). `cargo` was not run.
> `npm run census` / `census:check` was **not** run, per the doctrine's
> prohibition on a composer running the full registry.

---

## 0. The headline: four jobs guard a commit here, and the only one that runs on every commit is the one that does nothing

Ten jobs are declared in `lefthook.yml`. Executed at `afb295187`, on this
machine, one at a time:

| hook | job | `lefthook.yml` | exit | wall time | fires on |
| --- | --- | ---: | ---: | ---: | ---: |
| pre-commit | `eslint-staged` | `:18-20` | **0** | ~2 s | **52.7 %** of commits |
| pre-commit | `gitleaks-staged` | `:26-27` | **0 — SKIPPED** | 1 s | **100 %** of commits |
| pre-commit | `i18n-no-gaps` | `:37-39` | 0 | 3 s | **12.8 %** of commits |
| pre-commit | `i18n-no-untranslated` | `:49-51` | 0 | **146 s** | **12.8 %** of commits |
| pre-push | `typecheck` | `:55-56` | 0 | **287 s** | every push |
| pre-push | `golden-path-census` | `:74-75` | *not run — see header* | (minutes) | every push |
| pre-push | `i18n-coverage` | `:77-78` | 0 | 3 s | every push |
| pre-push | `evals` | `:81-82` | 0 | 7 s | every push |
| pre-push | `ai-conformance` | `:86-87` | 0 | 1 s | every push |
| pre-push | `ai-context-freshness` | `:89-90` | 0 | 2 s | every push |

Three facts follow from that table, and each is worse than it looks.

**One. The only job with no `glob:` — the one that therefore runs on every
single commit — is the secret scan, and it exits 0 without scanning.**
`gitleaks` is not installed on this machine, so `scripts/secret-scan.mjs:22-26`
prints `gitleaks not installed — secret scan SKIPPED (commit not blocked)` and
returns 0. Every other pre-commit job is scoped by a glob and therefore silent
on roughly half to seven-eighths of commits. Replayed over the last **1,000**
non-merge commits:

```
  527  52.7%  eslint-staged            glob *.{ts,tsx,js,cjs,mjs}
  128  12.8%  i18n-no-gaps             glob src/i18n/locales/*.json
  128  12.8%  i18n-no-untranslated     glob src/i18n/locales/*.json
 1000 100.0%  gitleaks-staged          (no glob)
```

The full leak surface, and which scanner reaches it, is
[`secret-leak-scanning`](./secret-leak-scanning.md)'s subject. What belongs
here is the *shape*: **the commit path's coverage profile is inverted.** Its
universal job is inert; its live jobs are conditional.

**Two. The gate that does fire on half of all commits cannot fail on a warning,
and the reason is not the one on record.** `lefthook.yml:20` is

```
npx eslint --quiet --no-warn-ignored --max-warnings 99999 {staged_files}
```

Fault-injected on `src/features/shared/components/modals/ExecutionDetailModal/DataDiffSection.tsx`
(26 warnings, 0 errors), 2026-08-17:

| invocation | exit | output |
| --- | ---: | --- |
| `npx eslint <file>` | **0** | `✖ 26 problems (0 errors, 26 warnings)` |
| `npx eslint --max-warnings 0 <file>` | **1** | — |
| `npx eslint --quiet --max-warnings 0 <file>` | **1** | — |
| `npx eslint --quiet --max-warnings 99999 <file>` (**the hook**) | **0** | *nothing at all* |

`--quiet` does **not** stop the warnings being counted — row 3 proves it. What
disarms the gate is the literal `99999`, against a whole-repo total of
`shared-facts.json#lint.warnings` = **1,135**. What `--quiet` disarms is
something else and arguably worse: the **display**. The hook prints nothing, so
the one channel a warn-level rule genuinely has — a human reading the message —
is closed at exactly the moment the developer is looking. See §12.1; this
corrects a doctrine claim that five paths cite.

**Three. The heavy gates are all one hook later, and one of them costs 146
seconds at pre-commit — against a budget the file itself writes down.**
`lefthook.yml:7` states the design principle: *"pre-commit must stay fast (<5s
on a small commit) so it doesn't break flow"*. `i18n-no-untranslated` measured
**146 s** and **136 s** on two consecutive runs. That is **27–29×** the stated
budget, on the 12.8 % of commits that touch a locale file. The budget is not
enforced anywhere, and nothing measures it.

**And behind all of it: the checks the contributor guide promises are not on
the commit path at all.** `.claude/CLAUDE.md`'s "PR self-review (agent: run
before pushing)" section names ten commands. Traced to their actual invokers:

| the guide says run | pre-commit | pre-push | GitHub CI | verdict ever produced? |
| --- | :---: | :---: | :---: | --- |
| `npm run check` (9 constituents) | — | — | ✅ `ci.yml:118` | **no** — `ci.yml` is 0-for-320 |
| `npm run check:i18n:strict` | ✅ *(glob)* | — | — | yes, on locale commits |
| `npm run check:error-registry` | — | — | ✅ `ci.yml:135` | no |
| `npm run check:themes` | — | — | ✅ `ci.yml:144` | no |
| `npm run check:tauri-configs` | — | — | ✅ `ci.yml:151` | no |
| `npm run test -- --run` (2,400+ tests) | — | — | ✅ `ci.yml:190` | no |
| `cargo clippy … -D warnings` | — | — | ✅ `ci.yml:306` | no |
| `cargo test …` | — | — | ✅ `ci.yml:298` | no |
| `cargo test … export_bindings` | — | — | ✅ `ci.yml:417` | no |
| `node .ai/doctor.mjs` | — | ✅ `:86-87` | ✅ `ai-conformance.yml` | yes |

**Two of the ten reach a hook.** The other eight live only in CI, and CI's
all-time record, queried from the Actions API on 2026-08-17, is:

| workflow | success | failure | cancelled | other |
| --- | ---: | ---: | ---: | ---: |
| **`ci.yml`** | **0** | 190 | 128 | 2 in flight |
| **`audit.yml`** | **0** | 23 | 0 | — |
| `e2e-smoke.yml` | **0** | 34 | 4 | — |
| `release.yml` | **0** | 30 | 0 | — |
| `installer-test.yml` | 0 | 0 | 0 | **8 skipped** |
| `codeql.yml` | 14 | 0 | 0 | — |
| `ai-conformance.yml` | 4 | 0 | 0 | — |

So the honest summary of what gates a commit in this repository is: **a linter
that cannot fail on a warning and is silent about them, a secret scan that is
not installed, and two locale checks that fire on one commit in eight.** Push
adds a real typecheck and a real ratchet. CI adds eighteen more checks and has
never once said yes.

That is not an argument for adding gates. It is an argument for the one thing
this path prescribes: **put the gate where a verdict is actually produced, and
make the gate say so when it cannot produce one.**

---

## 1. Trigger

You are in this situation when you say, or are about to type, any of:

- "I'll add a pre-commit hook for this."
- "Where do I wire this check so it runs before people push?"
- "Should this be pre-commit or pre-push?"
- "Why didn't CI catch that?" / "Why is the hook not firing?"
- "What commit message format does this repo want?"
- "The hook is too slow, I'll just `--no-verify` this one."
- **The "if you are about to write X" test:** if you are about to write a
  `run:` line in `lefthook.yml`, a `glob:` on a hook job, an `|| true` after a
  checker, a `--max-warnings` number, or a `git commit -m "<type>: …"` inside a
  script or skill — you are here.

---

## 2. The one way

**Put the check on the hook where its verdict can still change what happens,
give it a `glob:` that describes the inputs it actually reads, and make it fail
loudly when it cannot run — then measure its wall time before you commit the
config, because a gate people bypass has a worse coverage profile than a gate
that does not exist.** Concretely, in this order. (a) Decide the hook by **cost
and blast radius, not by importance**: anything under ~5 s that reads only
staged files goes pre-commit; anything that must walk the tree, compile, or
talk to a network goes pre-push; anything that needs a matrix or a secret goes
CI — and if you put it in CI, you have chosen "no verdict on this machine", so
say that out loud in the job comment the way `lefthook.yml:58-73` does. (b)
Scope with `glob:` to the files the check *reads*, never to the files it
*reports on* — a check that reads `en.json` and reports on thirteen other
locales must be globbed on all fourteen or it will miss the edit that broke it.
(c) Never let an invocation swallow its own verdict: no `|| true`, no
`continue-on-error`, no `allow_failure`, and no `--max-warnings` above zero —
if the current count is not zero, ratchet it in the census, which is built for
exactly that, instead of writing a threshold nobody will ever lower. (d) Make
absence loud: if the check's tool, config, or input might not exist, exit
**non-zero** with the install instruction, and register the legitimate
exception explicitly — a checker that exits 0 because it found nothing to check
is indistinguishable from a clean tree, and this repository contains six of
them. (e) Time it: run it ten times on a realistic staged set and put the
number in the job's comment, because the budget in `lefthook.yml:7` is prose
and prose does not hold a line. (f) For the commit *message*, treat the type
vocabulary as **one shared enum with three consumers** — the commit-lint
pattern, the changelog generator's classifier, and every script or skill that
writes a message — and change all three in the same commit, or accept that the
divergence will show up in a user-facing release note.

If you can only do one thing: **make the failure arm exit non-zero.** Every
other clause is an optimisation on top of a gate that is actually capable of
saying no.

---

## 3. Mandated primitives

Use these; do not invent a parallel mechanism.

| primitive | where | what it gives you |
| --- | --- | --- |
| `lefthook.yml` `pre-commit:` job | repo root, `:15-51` | a staged-files check. `{staged_files}` is substituted by lefthook; `glob:` filters which files reach it, and a job whose glob matches nothing is skipped entirely (not run-and-passed). |
| `lefthook.yml` `pre-push:` job | repo root, `:53-90` | a whole-tree check that still runs on this machine. This is where a verdict is worth the most: it is the last gate before the work leaves the box, and unlike CI it has a 100 % production rate. |
| `glob:` on a job | e.g. `:19`, `:38`, `:50` | the input scope. **A job with no glob runs on every commit** (`gitleaks-staged`, `:26`). |
| `npm run census` / `census:check` | `package.json:49-50`, wired at `lefthook.yml:74-75` | the ratcheting-baseline mechanism. It exists so a *countable* condition does not need a bespoke script, and it is the only gate in this repository with a 100 % local production rate on push. |
| `scripts/census/lib/engine.mjs` `assertRule` | `:250-331` | the fail-loud contract, already implemented: `floor` (walk saw too few files), `zero-matches`, `stale-exclude`, `rose`, `dropped`. Do not re-derive these. |
| `node .ai/doctor.mjs` | `lefthook.yml:86-87` | the `.ai` conformance gate — the only one of the ten commands in `.claude/CLAUDE.md`'s PR self-review list that runs both locally and in a green CI workflow. |
| `scripts/generate-changelog.mjs` | `:13-17` | the release-notes classifier. `FEAT_RE`, `FIX_RE` and `INTERNAL_RE` are the *second* commit-type vocabulary in this repo; treat them as part of the commit-message contract. |
| `.github/workflows/ci.yml:31-95` | — | the conventional-commit pattern. This is the **only** enforcement of the message format anywhere; there is no `commit-msg` hook (§7 D4). |

**Two things that are NOT primitives here, and both look like one.**
`.git/hooks/*` is generated by `lefthook install` — never hand-edit it; the
copy on disk is a dispatcher, not a policy (§7 D6). And `.claude/settings.json`
is **gitignored** (`.gitignore:70`), so a hook registered there — three of them
are — reaches exactly one machine (§7 D7).

---

## 4. Steps

1. **Name the condition and ask whether it is countable.** If the answer is "a
   number that should only go down", stop: you want a census rule
   (`scripts/census/rules.json`), not a new script and not a new hook job. The
   census already implements the fail-loud contract, it already runs at
   pre-push, and it is already the only gate with a real production rate.
   *And then stop* — steps 2-7 are for the checks the census cannot express.

2. **Decide the hook by measured cost.** Write the check, then time it on a
   realistic staged set (`s=$(date +%s); <cmd>; echo $(( $(date +%s)-s ))`).
   Under ~5 s on staged files → pre-commit. Over that, or needs the whole tree
   → pre-push. Needs a matrix, a secret, or a second OS → CI, and accept that
   you have chosen "no verdict on this machine".

3. **Write the `glob:` from the check's INPUTS.** Open the script and list what
   it reads. `i18n-no-gaps` reads all fourteen locale files and is globbed
   `src/i18n/locales/*.json` — correct. A check that reads `en.json` *and*
   `src/**/*.tsx` needs both patterns or it will sleep through the edit that
   broke it.

4. **Make the absent-precondition arm exit non-zero.** The shape to copy is
   *not* `scripts/secret-scan.mjs:22-26`. Exit 1 with the install line. If a
   skip is genuinely right (an optional local tool, an advisory Stop hook),
   write the reason in the code the way
   `scripts/docs/check-golden-path-touch.mjs:117-124` does — a paragraph
   naming why absence is not a finding — so the next reader can tell a decision
   from an oversight.

5. **Assert the instrument.** Give the check a precondition that fails when it
   finds nothing to check. `scripts/check-csp-hosts.mjs` exists because a
   checker reported zero hosts twice while looking like a working gate;
   `check-corpus-integrity.mjs:62,78,84` exit 2 when the spine yields too few
   leaves. Copy that, not the silent `catch { process.exit(0) }` at
   `scripts/docs/check-doc-sync.mjs:132-135`.

6. **Never soften the invocation.** No `|| true`, `|| exit 0`,
   `continue-on-error: true`, `allow_failure: true`, or a `--max-warnings`
   above zero. If today's count is not zero, the count belongs in a census
   baseline where lowering it is a visible act, not in a threshold nobody will
   ever revisit.

7. **Put the number in the comment.** `lefthook.yml:58-73` is the model: it
   states what the job costs, why it is on pre-push and not pre-commit, what
   it fails on, and the specific incident that caused it to be added. A job
   comment that carries its own measurement is the only defence against the
   next person moving it to pre-commit "because it seems fast".

8. **If you touched the commit-message vocabulary, touch all three consumers.**
   Add the type to `ci.yml:33`'s `PATTERN`, decide whether it is internal in
   `scripts/generate-changelog.mjs:17`'s `INTERNAL_RE`, and grep
   `.claude/skills/` for scripts that emit it. Skipping any one of the three is
   how a repository ends up with 46 type words its own gate rejects (§7 D3).

---

## 5. Anti-patterns

**`--max-warnings <big number>`.** *Failure mode:* the gate is arithmetically
incapable of firing and reads as configured. `lefthook.yml:20` carries `99999`
against a repo total of 1,135; the gate would need an 88× regression on the
staged files alone. Use zero and a census baseline.

**`--quiet` on a linter in a hook.** *Failure mode:* not what you think. It
does **not** disarm the exit code (proven in §0). It disarms the *message* — so
the developer sees a silent pass over a file with 26 findings, and the one
mechanism warn-level rules actually have is closed at the moment it would
work.

**A hook job with no `glob:`.** *Failure mode:* it runs on every commit, so its
cost is paid a thousand times and its value had better be universal. The one
job in this file with no glob is the one that does nothing.

**`|| true` on the installer.** *Failure mode:* the hooks silently never get
installed. `package.json:98` is `"prepare": "lefthook install || true"`. If
lefthook's install fails — a locked binary, a worktree with a gitlink instead
of a `.git` directory, a partial `npm ci` — `npm install` prints success and
the contributor commits for weeks with no gates at all and no signal.

**Trusting `.git/hooks/` to fail.** *Failure mode:* the generated dispatcher's
last branch is `else echo "Can't find lefthook in PATH"` — and then the
function returns and the hook exits **0**. A machine without the lefthook
binary gets one line of output and a completely ungated commit. This is
lefthook's design, not the repo's, which is exactly why it must not be the
thing you rely on.

**Putting a check only in CI when CI does not pass.** *Failure mode:* you have
written a gate with a measured production rate of zero. Eight of the ten
commands in the contributor guide's self-review list are in this state.
CI-only is a legitimate choice for a matrix build; it is not a legitimate
choice for a check that could have run on the box.

**A `catch { process.exit(0) }` around reading the check's own config.**
*Failure mode:* the checker becomes a no-op the day someone renames the config,
and reports success forever. `scripts/docs/check-doc-sync.mjs:132-135` does
this **silently** — no message, no exit code, nothing. Contrast
`check-golden-path-touch.mjs:126-129`, which does the same thing but writes a
line to stderr first. The line is the whole difference between an outage and a
decision.

**Registering a hook only in `.claude/settings.json`.** *Failure mode:* the
registration cannot be committed (`.gitignore:70`), so the gate exists on
exactly one machine and a fresh clone silently has three fewer gates than the
documentation describes.

**Inventing a commit type because it reads better.** *Failure mode:* the
message passes locally (nothing checks it), fails a CI job that never passes
anyway, and then lands in the user-facing changelog's "Other" bucket with its
prefix stripped by a regex that was written to strip a *different* prefix
(§7 D3).

**Writing a bespoke script for "count must not rise".** *Failure mode:* the
460th such script. That mechanism is `scripts/census/`; see
[the contract](../golden-path-contract.md#dont-write-a-script--add-a-census-rule).

---

## 6. Evidence

**The one site to copy: `lefthook.yml:58-75`, the `golden-path-census`
pre-push job.** It is the best gate declaration in the repository and every
clause of §2 is visible in it:

- it is on **pre-push, deliberately**, and the comment says why in seconds
  ("the walk is ~110 rules over ~4,800 files and takes minutes, which is a
  pre-push cost … and an unacceptable pre-commit one");
- it names **the incident that caused it** ("the author of the census pushed
  past a red one on 2026-08-16 … because the pre-commit hook runs eslint and
  gitleaks and never asks the census anything");
- it states **what it fails on** — a rise *and* a silent drop — and how a drop
  is legitimately cleared;
- it delegates fail-loud to a mechanism that already implements it
  (`engine.mjs:250-331`);
- it has **no glob**, correctly, because the census walks the tree.

Secondary exemplars, each for one clause:

| site | what it exemplifies |
| --- | --- |
| `lefthook.yml:6-13` | a header that states the design constraints (`<5s`, "hooks NEVER stash", "lint --fix on staged files only") — right instinct, unenforced (§7 D2) |
| `lefthook.yml:40-48` | a glob'd job whose comment explains why key-parity is only half the contract, with the date the blind spot was found |
| `scripts/i18n/check-coverage.mjs:93-95` | the repo's model **two-directional** comparison: `missing` *and* `extra`, computed from both sides, extras always fatal |
| `scripts/census/check-corpus-integrity.mjs:62,78,84,185,193` | five `process.exit(2)` preconditions — the instrument asserting itself |
| `scripts/census/check-corpus-integrity.mjs:205-234` | an advisory check that **writes down its own promotion condition** in the source, marked `PROMOTION POINT` |
| `.github/workflows/ci.yml:398-416` | a CI step whose comment names both flags as load-bearing and says what silently breaks without them |
| `.github/workflows/ci.yml:21-25` | `timeout-minutes` added after a six-hour hung job — bounding a gate's own runtime |

---

## 7. Deviations

Every item below was measured at `afb295187` unless noted. Counts are from two
independent implementations where a count is claimed; disagreements are in
§12.

### D1 — The pre-commit hook's universal job is inert, and it is the security one · executed

`node scripts/secret-scan.mjs` → stdout `[secret-scan] gitleaks not installed
— secret scan SKIPPED (commit not blocked).`, **exit 0**. `gitleaks` is not on
`PATH` (`which gitleaks` → not found). The job has no `glob:`, so this is the
one pre-commit job that runs on 1000 of 1000 sampled commits, and it is the one
that produces nothing. Full treatment in
[`secret-leak-scanning`](./secret-leak-scanning.md); recorded here because the
*commit path's* shape is what is wrong — the universal slot is occupied by a
no-op.

### D2 — pre-commit's own stated budget is exceeded 29× by a pre-commit job · executed, 146 s and 136 s

`lefthook.yml:7`: *"pre-commit must stay fast (<5s on a small commit)."*
`node scripts/i18n/check-untranslated.mjs --strict` measured **146 s** then
**136 s** on consecutive runs, both exit 0. It is globbed to
`src/i18n/locales/*.json`, so it fires on **12.8 %** of commits (128 of the
last 1,000) — which is precisely the population of commits where the developer
is least likely to expect a two-minute wait. Nothing measures the budget, and
the budget is a comment.

Second-order: the four pre-commit jobs run with `parallel: true` (`:16`), so
the *hook's* cost is the max, not the sum — 146 s. That is the number to fix
or to write down.

### D3 — Three commit-type vocabularies, and the repository's own tooling writes types its gate rejects · executed over 7,047 subjects

The format is enforced in exactly one place — `ci.yml:33`:

```
^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+\))?(!)?\: .+
```

Classified over every non-merge commit in history (7,047 subjects):

| | count | share |
| --- | ---: | ---: |
| matches the pattern | 5,386 | 76.4 % |
| **violates it** | **1,661** | **23.6 %** |
| ↳ has a `type:` prefix outside the allowlist | 1,116 | 15.8 % |
| ↳ has no `type:` prefix at all | 545 | 7.7 % |

**46 distinct type words** are in use that the pattern rejects, and the top of
that list is not typos — it is the repository's own tooling:

```
explorer 317 · research 188 · architect 167 · vibeman 154 · polish 59
proto 49 · ledger 29 · prototype 27 · schedules 15 · security 11 · radio 11
… 35 more, 1-9 each
```

Six of the top seven are **skill names**. `.claude/skills/research/SKILL.md:1117`
instructs the agent to `git commit --message "research: <title>"` — a type the
gate rejects, mandated by a tracked file in this repo.

The trend is downward but not gone: last 1,000 commits **8.6 %**, last 500
**6.2 %**, last 100 **4.0 %**.

**And the second vocabulary disagrees with the first.**
`scripts/generate-changelog.mjs` classifies the same subjects for the
user-facing release notes with a *different* enum:

- `FEAT_RE` / `FIX_RE` (`:13-14`) → the "Features" and "Fixes" sections;
- `INTERNAL_RE` (`:17`) = `chore|ci|test|style|build` → dropped entirely;
- everything else → **"Other"**, with its prefix removed by
  `msg.replace(/^[a-z]+(\(.+\))?!?:\s*/, "")` (`:38`).

Consequences, all executed against the live repo (1,650 commits since `v1.1.0`):

- `docs:` (724 commits all-time), `refactor:` (333) and `perf:` (123) are
  **allowed by commit-lint and shipped to users** in "Other". Running
  `node scripts/generate-changelog.mjs` today emits **1,447 lines**.
- `security(...)` — 11 commits, several of them real user-facing fixes — lands
  in "Other", not "Fixes", because `security` is in neither vocabulary.
- `:38`'s `^[a-z]+` strips lowercase prefixes only, so `explorer(x): …` loses
  its prefix and reads as prose, while `WIP: …` and `Cleanup: …` (3 commits)
  keep theirs verbatim in a release note.

Three consumers, three enums, zero mechanism keeping them in step.

### D4 — There is no `commit-msg` hook, and the one gate on the message has never rendered a verdict · executed

`lefthook.yml` has no `commit-msg:` section — grep of the file and of its
entire git history (`git log -S"prepare-commit-msg" -- lefthook.yml` → empty)
confirms it never has. So the format is enforced only by `ci.yml`'s
`commit-lint` job, and `ci.yml` is **0 successes in 320 runs** (190 failure,
128 cancelled, 2 in flight — Actions API, 2026-08-17).

The job itself is careful and well-repaired (`ci.yml:45-68` documents a real
bug where `github.base_ref` was empty on push and the step died with
`fatal: ambiguous argument 'origin/..HEAD'` on *every push* — meaning
commit-lint "had never actually linted anything"). The repair is correct. It
does not help, because the workflow it lives in does not reach a green
conclusion for other reasons.

**The cheapest fix on this page**: the same 30-line pattern check as a
`commit-msg` lefthook job costs milliseconds and produces a verdict on the box.

### D5 — The installer swallows its own failure · read

`package.json:98`: `"prepare": "lefthook install || true"`. A failed install is
indistinguishable from a successful one; `npm install` prints success either
way. On this machine the hooks *are* installed — `.git/hooks/pre-commit` and
`pre-push` are dated 2026-08-16 13:15, matching `lefthook.yml`'s mtime — so
this is a latent hazard, not a live outage. It is listed because the failure it
enables is silent and total, and the `|| true` buys nothing: `lefthook install`
failing is exactly the thing a contributor needs to be told about.

### D6 — The generated dispatcher's last branch is `echo` · read, 13-branch chain

`.git/hooks/pre-commit` (and `pre-push`) resolve the lefthook binary through a
13-branch `elif` chain — `$LEFTHOOK_BIN`, `lefthook.exe`, `lefthook.bat`, the
platform npm package, `@evilmartians/*`, `go tool`, `bundle exec`, `yarn`,
`pnpm`, `swift`, `mint`, `uv`, `mise`, `devbox` — and terminates:

```sh
else
  echo "Can't find lefthook in PATH"
fi
```

No `exit 1`. The function returns 0 and **the commit proceeds with zero gates**.
This is upstream lefthook's shape, and it is not fixable from `lefthook.yml`;
it is recorded because it is the actual failure mode of D5 and because it means
*"the hooks are installed"* is not the same claim as *"the hooks can run"*.

### D7 — Three of the repo's 24 gate-shaped scripts are registered only in a gitignored file · measured, 24 scripts × 6 possible invokers

Every script under `scripts/` whose basename starts with
`check|verify|guard|audit|ensure|security` (24, excluding `__tests__` and
`.archived`) was matched against six possible invokers: `package.json` scripts,
`lefthook.yml`, the seven GitHub workflows, `.gitlab-ci.yml`,
`scripts/run-codegen.mjs`'s task registry, and `.claude/settings.json`.

| registration | count | which |
| --- | ---: | --- |
| an npm script (some also CI) | 14 | `check-*`, `check-tiers`, `security-audit.sh`, … |
| GitHub CI only | 2 | `check-unused-bindings.sh`, `verify-onnxruntime-bundling.mjs` |
| the codegen registry only | 1 | `check-build-cache.mjs` |
| lefthook | 2 | `i18n/check-coverage.mjs`, `i18n/check-untranslated.mjs` |
| **`.claude/settings.json` only — gitignored** | **3** | `docs/check-doc-sync.mjs`, `docs/check-golden-path-touch.mjs`, `build/guard-concurrent-cargo.mjs` |
| **nothing at all** | **3** | `check-literal-parity.mjs`, `context/check-granularity.mjs`, `verify-resource-scoping.mjs` |

The three in `.claude/settings.json` are real and working — two `Stop` hooks
and one `PreToolUse` hook, verified by reading the file — but `.gitignore:70`
(`.claude/*`, with an allowlist beneath that does not include `settings.json`)
means the registration cannot travel in a commit. A fresh clone has three
fewer gates than `.claude/CLAUDE.md` and
[`golden-path-recall.md` §3](../golden-path-recall.md) describe, and nothing
reports the difference. `golden-path-recall.md` §3 names this problem for its
own hook; the measurement here is that it is now true of **three**.

The three wired to nothing were confirmed by `git grep` across the whole
tracked tree: `check-literal-parity.mjs` and `verify-resource-scoping.mjs`
appear in no config, no script and no workflow; `context/check-granularity.mjs`
is referenced only by its own source. (`i18n/check-route-sections.mjs` is a
near-miss: the *script* is unwired, but its library
`scripts/i18n/lib/section-refs.mjs` is exercised by
`src/i18n/__tests__/routeSectionCoverage.test.ts`, so the logic is covered even
though the entry point is not.)

### D8 — `npm run check` is on no local hook, and it costs about seventeen minutes · executed, per constituent

`package.json:51` composes nine checks. Each executed separately at
`afb295187`:

| constituent | exit | seconds |
| --- | ---: | ---: |
| `check:contracts` (command-contract + event-registry) | 0 | 5 |
| `check:tiers` | 0 | **398** |
| `check:tauri-configs` | 0 | 2 |
| `check:csp-hosts` | 0 | 3 |
| `check:corpus` | 0 | 5 |
| `check:doc-map` | 0 | 2 |
| `census:check` | *not run (composer prohibition)* | minutes |
| `tsc --noEmit` | 0 | **287** |
| `eslint src/` | **0 by construction** — no `--max-warnings`, and it emits 1,135 warnings | *not separately timed* |

The seven timed constituents total **702 s ≈ 11.7 minutes**, plus ESLint and
plus the census, and `check:tiers` alone is 398 of them.
Nothing local runs it. `lefthook.yml` invokes exactly **two** npm scripts —
`census:check` (`:75`) and `test:evals` (`:82`) — and six direct
`node`/`npx` commands. The composite therefore exists only inside `ci.yml:118`,
which has never passed.

This is not an argument to put it on pre-push. It is an argument that **the
composite is the wrong unit**: its two slowest members (`check:tiers`, `tsc`)
are 685 of its ~720 seconds, and one of them (`tsc`) is *already* a pre-push
job. Splitting the fast seven (19 s total, all green) onto pre-push would give
the commit path seven more real verdicts for nineteen seconds.

### D9 — Cleared claims

Recorded because a cleared claim is worth as much as a confirmed one.

- **"The hooks aren't installed."** They are. `.git/hooks/pre-commit` and
  `pre-push` exist, are dated with `lefthook.yml`, and dispatch correctly;
  `core.hooksPath` is the default and no global override is set.
- **"pre-push is red, so people must be pushing with `--no-verify`."** Every
  pre-push job I was permitted to run exits **0** today: typecheck (287 s),
  i18n-coverage, evals, ai-conformance, ai-context-freshness. The pre-push gate
  is *green*, not bypassed. And the repo's own tooling overwhelmingly forbids
  the bypass: of the **six** skills mentioning `--no-verify`, **five ban it
  explicitly** and one (`perfect/SKILL.md:226`) mandates it for intermediate
  `wip(…)` builder commits — a scoped, deliberate exception.
- **"`--quiet` is what disarms the ESLint gate."** False; see §0 and §12.1.
- **The orphan `prepare-commit-msg` hook.** `.git/hooks/prepare-commit-msg`
  exists (dated 2026-04-02) and calls `lefthook run prepare-commit-msg`, for
  which `lefthook.yml` has never had a section. It is a stale artifact of an
  older install and costs one process per commit. Harmless — listed so the next
  reader does not mistake it for a message gate.

---

## 8. Gaps

What the mechanism genuinely cannot do, as distinct from what nobody has done.

1. **lefthook cannot make its own absence fatal.** The generated dispatcher's
   fallback (D6) is upstream behaviour. There is no `lefthook.yml` key that
   converts "binary not found" into a non-zero exit; the only defence is
   out-of-band (a `prepare` script that verifies, or a CI job that asserts the
   hook files exist and are current).

2. **A hook cannot see the commit it is about to make.** `pre-commit` runs
   before the message exists; the message is only available to `commit-msg`.
   This is why the type-vocabulary check (D3, D4) cannot be folded into an
   existing job and needs its own hook.

3. **`{staged_files}` is the staged content only when the tree is clean.** A
   partial commit (`git add -p`, or `git commit --only <path>` with unrelated
   working-tree edits) hands the linter the *working-tree* file, not the staged
   blob. lefthook 2.x can stash to fix this; `lefthook.yml:8-9` explicitly
   forbids that — *"hooks NEVER stash, restore, or rewrite the working tree
   (concurrent CLIs share the tree)"* — which is the correct trade for this
   repository and a genuine, accepted hole in what pre-commit verifies.

4. **The census cannot see the commit path's own configuration.** Measured
   here and it is the reason §9 declines: every file that decides what runs at
   commit time — `lefthook.yml`, `package.json`, `eslint.config.js`,
   `.gitleaks.toml`, `.gitlab-ci.yml` — sits at the **repository root**, and
   `scripts/census/lib/engine.mjs:53-70` walks *directories*. A root of `"."`
   is the only way to reach them, and it also walks
   `.claude/worktrees/**` — five untracked, gitignored full copies of the
   repository on this machine, zero on a clean clone. Detail and numbers in §9.

5. **CI's verdict rate is not something a gate can fix.** Eight of the ten
   commands in the contributor guide are CI-only. Moving them is a design
   decision with a real cost (the matrix, the secrets, the runners); the gap is
   that nothing in the repository *reports* the difference between "checked"
   and "checked somewhere that has not produced a verdict in 320 runs".

6. **A time budget cannot be expressed in `lefthook.yml`.** There is no
   `max_seconds:` key. D2's 29× overrun is unenforceable by construction; the
   only available mechanism is a comment, which is why §4 step 7 asks for the
   number rather than a rule.

---

## 9. The missing gate — a reasoned decline, with the numbers that produced it

**No census rule is published for this leaf.** The fence below §9 is
deliberately absent; there is nothing here for
`scripts/census/merge-published-rules.mjs` to ingest, and that is the finding,
not an oversight.

**The condition a signal would be a proxy for**, stated stack-free so another
repository can derive its own: *a check that is declared as a gate and cannot
produce a failing verdict* — because its threshold is unreachable, its
precondition is absent, its invocation discards the exit code, or its
registration does not exist on the machine that matters.

Three candidate signals were built and run in a private scratch registry
(`gpb-reg-c*.json`, filenames unique to this composer), against the live tree,
via `scanRule` from `scripts/census/lib/engine.mjs` — the same code the real
runner uses. Each was hand-verified site by site. All three were rejected, and
the numbers are the point.

**Candidate A — "a gate script that exits 0 because its own tool is absent."**
Roots `["scripts"]`, extensions `.mjs/.js/.cjs/.sh`, walk **166** files.

- broad anchor (any `process.exit(0)`): **72 matches / 36 files**
- narrowed to a precondition-absent arm: **10 matches / 7 files**
- narrowed to *"the tool is missing, here is how to install it"*: **3 matches /
  3 files** — `scripts/secret-scan.mjs:23`, `scripts/ensure-ort-cache.mjs:309`,
  `scripts/docs/check-golden-path-touch.mjs:128`

Hand-verified precision on the merits: **1 of 3 (33 %)**. `secret-scan.mjs` is
a true positive — a security control declining silently. `ensure-ort-cache.mjs`
is a **fixer**, not a gate; skipping when `rustc` is absent is correct and
costs nothing. `check-golden-path-touch.mjs` is an advisory Stop hook whose
skip is argued for in eight lines of comment (`:117-124`) and is right. The
discriminator that separates the true positive from the other two — *does this
script's exit code gate a commit, a push, or a CI job?* — **is not in the file**.
It is in `lefthook.yml`, a workflow, or a gitignored settings file, none of
which the matcher can see from `scripts/`. 33 % is below every precision the
corpus has previously accepted (the recorded refusals sit at 22 %, 44 % and
71 %), and a gate that fires on two correct scripts out of three would be
deleted by the first person it annoyed.

**Candidate B — "a gate that reports a failure but cannot exit non-zero."**
Same roots. Anchor (`console.error(` / `::error::` / `FAIL` / `failed`):
**503 matches / 113 files**. File-anchored to those with no
`process.exit([1-9])`, no `process.exitCode = [1-9]`, no `exit [1-9]`, no
`throw`: **21 matches / 21 files**; the compliant half returns **92 files**.
Hand-checking the 21 found the population dominated by *libraries*
(`census/lib/engine.mjs`, three instruments, `lib/bundle-budget.mjs`) which
correctly return problems to a caller rather than exiting, and by test harnesses.
`scripts/secret-scan.mjs` appears in the violating set as a **false positive**:
its real exit is `process.exit(res.status === null ? 1 : res.status)` — a
dynamic non-zero the matcher cannot see. Estimated precision 30–50 %; not
shipped.

**Candidate C — "an invocation that discards its own verdict"**
(`|| true`, `|| exit 0`, `continue-on-error: true`, `allow_failure: true`,
`--max-warnings \d{4,}`). This is the signal that would catch `package.json:98`
(D5) and `lefthook.yml:20` (§0), and it is the one I most wanted to ship. It
cannot be expressed:

- Rooted at `["."]` with `.yml/.yaml/.sh/.json` it walks **8,126** files and
  returns **148 matches / 59 files** — of which the majority are duplicates
  inside `.claude/worktrees/**` and `.claude/worktrees/athena-dev-*`
  (**five** untracked full repository copies on this machine, **zero** on a
  clean clone) plus large data artifacts (`index.json`, `lint-output.json`,
  `practice-harvest/**/*.json`) where the tokens are prose.
- Rooted at `[".github"]` it walks 10 files and lands squarely on
  [`adding-a-ci-gate`](./adding-a-ci-gate.md)'s §7 P5, which already counts
  exactly this population (17 `if: always()`, 7 `continue-on-error`, 9
  `|| true` in `.github/workflows/`). Shipping it would be a second rule over
  the same sites for a different leaf.
- **The files that matter cannot be reached at all.** `lefthook.yml`,
  `package.json`, `eslint.config.js`, `.gitleaks.toml` and `.gitlab-ci.yml` are
  repository-root files. `walkFiles` (`engine.mjs:53-70`) takes directories;
  the only root that includes them is `"."`, and `ALWAYS_SKIP_DIRS`
  (`engine.mjs:19`) is `node_modules · .git · dist · target · coverage` — it
  does not skip `.claude`. So **the census cannot see the commit path's own
  configuration without simultaneously making its own population
  machine-dependent** — the exact failure the doctrine records for
  [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md), reached here
  from the opposite direction.

  That last point is sharpened by an instrument one directory away:
  `scripts/docs/measure-shared-facts.mjs:26` skips
  `['node_modules', 'target', '.git', 'worktrees', 'dist']` — it **does** skip
  worktrees. Two measurement instruments in the same repository, written for
  the same corpus, disagree about what counts as this repository. This is
  reported to the orchestrator as a §12 item rather than fixed here: changing
  `ALWAYS_SKIP_DIRS` changes what **172 live rules** see, which is a runtime
  behaviour change under the campaign's no-destructive-applies rule.

**The instrument this leaf actually needs**, specified so it can be written
later. Not a census rule — an **inventory**, because every one of the three
candidates failed for the same underlying reason the doctrine names: *a
count over what exists cannot see a gate that is not there.* Concretely, a
`scripts/check-gate-registry.mjs` that:

1. parses `lefthook.yml`, `package.json`'s scripts, the seven workflow files,
   `.gitlab-ci.yml`, `scripts/run-codegen.mjs`'s `TASKS`, and — if present —
   `.claude/settings.json`, into one **declared-gate inventory**;
2. walks `scripts/` for gate-shaped entry points and **set-difference**s the
   two, failing on either direction: an entry point nothing invokes (**3
   today**), and an invoker naming a script that does not exist;
3. asserts each declared gate's invocation contains none of the
   verdict-discarding tokens, with an explicit allowlist carrying a prose
   reason per entry (the census's `exclude.reason` contract,
   `engine.mjs:389-396`, is the model);
4. **exits 2 if the inventory is empty or smaller than a floor** — the
   precondition assertion that `check-csp-hosts.mjs` exists because of, and
   that `check-corpus-integrity.mjs:62,78,84` implements;
5. is registered at **pre-push**, where it costs milliseconds and produces a
   verdict, not in `npm run check`, which nothing local runs (D8).

Its positive control is already written: `scripts/i18n/check-coverage.mjs:93-95`
computes `missing` *and* `extra` from both sides and makes extras always fatal.
That is the shape. The gate on the gates has to be an inventory, or it will
have the same blind spot as everything it is checking.

---

## 10. Convergence — the `converged` label fails, in a mode the ledger has not recorded

The spine marks this leaf `convergence: converged`. Swept across all five
sibling checkouts (`../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`), the label is **contradicted** — and the way it
fails is worth more than the label.

| repo | hook manager | pre-commit jobs | pre-push jobs | commit-msg | secret scan |
| --- | --- | ---: | ---: | :---: | :---: |
| personas | **lefthook** | 4 | 6 | ✗ | declared, inert |
| personas-web | hand-rolled installer | **0** | 1 *(of 2 declared)* | ✗ | ✗ |
| brainiac | **none** | 0 | 0 | ✗ | ✗ |
| personas-cloud | **none** | 0 | 0 | ✗ | ✗ |
| vibeman | **none** *(1 uninstalled template)* | 0 | 0 | ✗ | ✗ |
| ascent | **none** | 0 | 0 | ✗ | ✗ |

**Personas is the only repository in the fleet with a hook manager at all.**
That is not convergence; it is a 5/5 silence with this repo alone on the other
side. And per the doctrine's re-weighting, a silence is the *strong* form of
oracle evidence — nobody solving this five times is evidence the problem is
either hard or unnoticed.

**The `commit-msg` result is sharper still, and it inverts the prescription.**
`commitlint`, a `commit-msg` hook, or a semantic-PR action: **0 of 6
repositories**, including this one. Yet conventional-commit *adherence*,
measured over the last 400 non-merge subjects in each:

| repo | adherence | enforcement |
| --- | ---: | --- |
| **ascent** | **99.5 %** (398/400) | **none of any kind** |
| brainiac | 94.8 % (311/328) | none |
| vibeman | 77.3 % (309/400) | none |
| personas-web | 55.5 % (222/400) | none |
| **personas** | **76.4 %** all-time, 96.0 % last 100 | a CI job that has never passed |
| personas-cloud | 0 % (0/5) | none |

The repository with the *strictest declared* rule is mid-table, and the one
with the best adherence has no rule at all. What separates them is not
enforcement — it is **who writes the commits**: ascent's history is
overwhelmingly agent-authored against a stable prompt, and personas' violations
cluster on the six skill names in D3. **The format is a property of the
author's template, not of the gate.** A `commit-msg` hook is still worth adding
here (D4) because it is cheap and it closes a loop — but the oracle says
plainly that it is not what produces adherence, and a path that claimed
otherwise would be wrong.

**Lineage caveat, applied.** `personas-web` and `ascent` share two
byte-identical dev-inspector scripts (`scripts/dev-inspector/inject-source-loc.cjs`,
63 lines; `source-loc-loader.cjs`, 79 lines) and a rewritten-comment copy of the
same `.gitignore` env block — so they are not fully independent on *tooling*.
Neither shares any gate configuration with this repo, because neither has any.
The effective independent cohort for the hook-manager question is therefore
**5 of 5 silent**, and for the commit-format question **4 independent** (web and
ascent counted once for tooling lineage, though their commit histories are
genuinely separate).

**One reportable failure elsewhere, for the fleet ledger.**
`personas-web`'s installed `.git/hooks/pre-push` carries **one** of the two jobs
its own installer declares (`scripts/install-git-hooks.mjs:17-22` writes two;
`check:i18n-encoding` was added later and `prepare` has not re-run). The
installer's append branch at `:39-41` exists for exactly that case and has never
fired. And `:11-13` `process.exit(0)`s when `.git` is not a *directory* — which
is false for every git worktree, where `.git` is a file. Reported, not edited.

---

## 11. Cross-check against the neighbours' prescriptions

Per [doctrine §6](../golden-path-doctrine.md#6-check-your-prescription-against-your-neighbours),
what happens to someone who follows this path *and* an adjacent one.

- **With [`adding-a-ci-gate`](./adding-a-ci-gate.md)**: no conflict, and a
  deliberate division. That path owns *"prove the gate can fail, then prove it
  did"* and the CI surface; this one owns *where the verdict is produced*. The
  composition is additive: its §2 clause (a) "break the thing first" is exactly
  what §0's three-way ESLint fault injection is. Where they touch — a gate
  invocation that cannot fail — this path defers, and §9 declines rather than
  ship a second rule over `.github/workflows/`.

- **With [`codegen-task-registration`](./codegen-task-registration.md)**: its
  §2 says *register the generator in `run-codegen.mjs`'s `TASKS` and both
  `PRESETS`*. Following both paths, note that `run-codegen` is reached from
  `predev`/`prebuild` — **not from any hook**. A generator registered as that
  path prescribes is still not on the commit path, so a stale artifact reaches
  a commit unchallenged. The two prescriptions do not conflict; the seam
  between them is unguarded, and D7's inventory instrument is where it would be
  closed.

- **With [`translation-completeness`](./translation-completeness.md)**: it
  prescribes closing locale gaps in the same change as the `en.json` edit,
  which is exactly what the two glob'd pre-commit jobs enforce — the one place
  in this repository where a golden path and a live hook agree completely. The
  cost is D2's 146 s, which belongs to *this* path to fix and not to that one.

- **With [`client-rule-mirroring`](./client-rule-mirroring.md)**: its §2 says
  *"do not mirror the rule; move the answer."* D3 is a three-way mirror of a
  commit-type enum with no shared source. Its prescription applies cleanly here
  and points at the right fix: one vocabulary file, read by the CI pattern, the
  changelog classifier and any script that writes a message — not three
  hand-kept copies.

---

## 12. Corrections

### 12.1 — The doctrine's §3 is wrong about the mechanism, and five paths cite it

[`golden-path-doctrine.md` §3](../golden-path-doctrine.md#3-the-severity-fact)
states: *"The pre-commit hook runs `--quiet --max-warnings 99999`, and
`--quiet` suppresses warnings **before** they can be counted."*

Fault-injected three ways on a 26-warning file (§0's table):
`--quiet --max-warnings 0` **exits 1**. ESLint counts warnings regardless of
`--quiet`; `--quiet` suppresses only the *report*. What makes the hook
incapable of firing is the `99999`, and nothing else.

**The doctrine's conclusion survives** — a warn-level rule enforces nothing at
either gate — and its other half is confirmed by execution here (`eslint src/`
with no `--max-warnings`, on a 26-warning file, exits 0). But the stated
mechanism is wrong, and it matters in a way that changes advice: because
`--quiet` is a *display* switch, removing it would restore the developer-facing
channel that doctrine §3 correctly identifies as the only thing a warn-level
rule has, at zero cost to the exit code. Under the mechanism on record, that
edit would look pointless.

Owed to `golden-path-doctrine.md` §3; not edited here (this composer's brief
scopes it to three files).

### 12.2 — `adding-a-ci-gate`'s workflow table has moved, and one row was wrong

That path's headline table (composed 2026-08-15 @ `e611c326d`) is re-measured
here 2026-08-17 against the same API:

| workflow | there | here | delta |
| --- | --- | --- | --- |
| `ci.yml` | 0 / 184 f / 76 c (260) | **0 / 190 f / 128 c + 2** (320) | +60 runs, still **zero** successes |
| `audit.yml` | 0 / 22 | **0 / 23** | +1 |
| `release.yml` | 0 / 30 | 0 / 30 | — |
| `e2e-smoke.yml` | 0 / 34 / 4c | 0 / 34 / 4c | — |
| `codeql.yml` | 13 | **14** | +1 |
| `ai-conformance.yml` | 4 | 4 | — |
| `installer-test.yml` | *"has never run at all"* | **8 runs, all `skipped`** | **corrected** |

`installer-test.yml` has been triggered eight times; every run concluded
`skipped`. "Never run" and "ran and skipped every time" are different findings
with different fixes — the first is a trigger problem, the second is a job-level
`if:` condition. The rest of that table replicates exactly, which is the more
important result: `ci.yml`'s success count is not drifting toward one.

### 12.3 — Corrections to this composer's own brief

- **"`lefthook.yml` pre-commit runs eslint/gitleaks only, NOT census."** True
  as far as it goes and incomplete: pre-commit runs **four** jobs, and the two
  the brief omits (`i18n-no-gaps`, `i18n-no-untranslated`) are the only
  pre-commit jobs on this machine capable of blocking a commit today. The
  second of them is also the one that breaks the file's own time budget by 29×.

- **"`npm run check` runs `eslint src/` with no `--max-warnings`."** Correct,
  but the brief's framing implies `npm run check` *is* TypeScript + ESLint. It
  is **nine** constituents (`package.json:51`), seven of which are neither, and
  it takes ~12 minutes plus the census. The `.claude/CLAUDE.md` PR-self-review
  line that describes it as "TypeScript + ESLint (incl. the 18 custom rules)"
  understates it the same way — and the parenthetical is also stale: the
  measured rule count is **21** custom rules, per
  [`adding-a-ci-gate`](./adding-a-ci-gate.md)'s sweep.

- **"`git commit --only` / `-- <pathspec>` do not reliably scope under
  lefthook (measured: swept sibling files)."** **Not re-tested here, and
  deliberately.** Reproducing it requires creating commits, which this
  composer's brief forbids. What *can* be said from the config: `lefthook.yml`
  declares no `stage_fixed:` on any job and its header (`:8-9`) states the hooks
  never restage — so lefthook's partial-commit restaging path is not the
  mechanism, and the `.claude/CLAUDE.md` account attributing it to "lefthook's
  partial-commit handling re-stages" is unsupported by the configuration. The
  observed sweeps are more consistent with the *second* mechanism that account
  also describes — a sibling session committing between `git add` and
  `git commit`, which no pathspec can defend against. Flagged as unverified,
  not contradicted.

### 12.4 — A false agreement in this composer's own measurements

The credential-shape anchor used for the sibling document reported **34
matches** whole-file, while its own violating/compliant partition summed to
**30** (6 + 24). The deficit is not a missing case: the partitioned patterns are
line-anchored (`^[^\n]*…` with `m`), and a line carrying **two** shapes is one
match there and two in the whole-file form. Both counts are correct answers to
different questions, and the file counts reconcile exactly (18 = 3 + 17 with 2
files in both halves). Recorded because a 4-count gap between an anchor and its
own partition is exactly what a broken matcher looks like, and the doctrine's
instruction — *check that your matcher composes* — is what caught it.

### 12.5 — Two implementations of the orphan-binding count disagreed, and the looser one was wrong

Not this leaf's headline, but measured here and owed to
[`cross-artifact-drift-gate`](./cross-artifact-drift-gate.md), which carries it:
1,033 binding files against 963 `.rs` files
(`shared-facts.json#rust.files`, re-verified 2026-08-17 at `2edb8d694` — *no
value changed*). Implementation 1 (the exported name must appear as a Rust
`struct`/`enum`/`type` declaration): **32 orphans**. Implementation 2 (a
`#[derive(… TS …)]` inventory, 989 types, then set-difference): **49**.
Agreement: **32**; implementation-1-only: **0**. Implementation 2's extra 17 are
its own false positives — its `#[derive(...)]`-to-declaration window misses
types with intervening `#[ts(...)]` attributes. The sound answer is **32**, of
which **29** are still referenced from `src/` outside the bindings directory.

### 12.6 — The tree moved under the measurement

Composition began at `afb295187` and a parallel session advanced `master` to
`2edb8d694` during it. Everything in §0, §7 and §9 was taken at `afb295187`.
The one re-measurement taken afterwards — `node scripts/docs/measure-shared-facts.mjs`
at `2edb8d694` — reported **20 facts, no value changed**, so `rust.files` (963)
and `lint.warnings` (1,135) hold at both commits. Recorded rather than
smoothed over: a number without the commit it was taken at is not reproducible,
and this repository is edited by several sessions at once.
