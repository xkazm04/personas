# Golden path — Documentation sync

> Situation node: `platform-delivery/gates-and-conventions/documentation-sync` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **low** ·
> sides **server** (**contradicted — §12.2**) · convergence **converged**
> (**failed — §12.3**) · dimensions: **code-quality** · `twoSided: true` ·
> merged from *"Documentation sync enforcement"* + *"Agent-facing repo contract"* ·
> spine's own framing: *"Which docs surfaces a user-visible change must update in
> the same session."*
> Composed 2026-08-17 against `master` @ `cc27be561`. **Short form** per the
> Mode-2 tiering (spine header, §0, §2 compact, §7, §9, §12). The quality core —
> two implementations of every count, private-registry validation, hand-verified
> precision, re-extraction — is unchanged.
>
> **Sweep.** `scripts/docs/check-doc-sync.mjs` (239 lines) and its sibling Stop
> hook `check-golden-path-touch.mjs`; `scripts/docs/feature-doc-map.json`
> (37 entries, 131 `sourceGlobs`, 38 registered tour flows);
> `scripts/docs/check-doc-map-paths.mjs`; `.claude/settings.json`;
> `.claude/CLAUDE.md` § *Documentation Sync*; all **87** markdown files under
> `docs/features/` (23,535 lines); **4,304** tracked `.ts`/`.tsx`/`.rs` files
> under `src/` + `src-tauri/` after the hook's own skip filter; **4,953**
> non-merge commits since the three-target hook landed (`d584207f7`,
> 2026-05-16); and **100 real Claude Code transcripts** from
> `~/.claude/projects/C--Users-mkdol-dolla-personas/` — **1,414 turns,
> 18,908 tool-result events**.
>
> **Measured by executing, not reading.** The headline is not an argument about
> `check-doc-sync.mjs`; it is the result of **running it** against twelve real
> transcripts and then replaying its transcript walk over every turn of all one
> hundred. See §0 and §12.1.

---

## §0 — Headline

**The Stop hook has never fired. Not rarely — never.** Its transcript walk
breaks on the first event matching `evt.type === 'user' && evt.message?.role ===
'user'` (`check-doc-sync.mjs:98`), and **a tool result is recorded as exactly
that shape**: across 100 transcripts, **18,908 of 20,322** such events (93.0%)
are tool results, against 1,414 genuine human messages. Every `Edit` is followed
immediately by its own `tool_result`, so walking backwards from the Stop point
hits a boundary before it reaches a single `tool_use`.

Executed over every turn in every transcript:

| | |
|---|---:|
| turns (delimited by genuine human messages) | **1,414** |
| turns that edited ≥1 file | **477** |
| …in which the hook's walk saw ≥1 edit | **0** (0.00%) |
| individual file-edits in those turns | **2,367** |
| …visible to the hook | **0** (0.00%) |
| hook invoked directly on 12 real transcripts (sessions with up to 209 edits) | **exit 0, 12 of 12** |

`:117` — `if (edited.size === 0) process.exit(0)` — is therefore not a
silent-pass *path*. It is **the** path, on every turn, since 2026-05-16.

Three further facts, each of which would matter on its own if the hook ran:

- **The satisfaction condition is a directory prefix, not the target the message
  names.** The hook prints *"Mapped feature doc(s) likely affected: `docs/features/X`"*
  and then accepts any file under `docs/features/` (`:120`), any file under
  `src/features/onboarding/` (`:121`), any file under `../personas-web/`
  (`:125`). Replayed over git history: of **761** entry-commit pairs where mapped
  source moved *and* some feature doc moved in the same commit, only **348
  (45.7%)** touched the doc the entry names. **54.3% of the satisfactions were
  the wrong document.**
- **The registry is the real gate, and nothing measures it.** **1,421 of 4,304**
  source files (**33.0%**) match no entry's `sourceGlobs` at all — including all
  229 files under `src/features/shared/`, all 131 under `src-tauri/db/src/`, and
  all 57 store slices. A registry-driven gate is blind by construction to what
  the registry omits.
- **The registry describes a directory layout that moves under it.** With rename
  detection on, **318 renames across 22 commits crossed an entry boundary**, and
  **51** of them stripped a doc of coverage entirely — files leaving
  `src/features/overview/` for `src/features/shared/components/modals/`, which no
  entry claims. A transcript of `file_path`s records only the *destination* of a
  move; the diff records both sides.

The compliance number the leaf actually asks about — did the doc change in the
same session as the source — is **9.1%** at commit granularity (348 of 3,837
entry-commit pairs), **19.8%** if any feature doc counts, and **41.6%** under the
most generous same-calendar-day proxy.

---

## §2 — The one way (compact)

**Compute the coupling from the diff, satisfy on the named target, and put the
verdict where it is recorded — because a reminder nobody can count is
indistinguishable from a reminder nobody sends.** Concretely, in this order:

1. **Read the change from the VCS, not from a transcript.** A diff knows about
   renames, deletions and files that left a mapped area; a list of edited
   `file_path`s knows only destinations, and it only knows those if you can find
   the turn boundary. The single most expensive assumption in this repo's
   implementation is that a conversation transcript is a reliable record of what
   changed. It is not — §0.

2. **Assert the instrument before you trust it.** Every check that derives its
   input from somewhere it does not control needs a precondition that fails
   loudly when the input is empty. `edited.size === 0` and *"could not read the
   transcript"* and *"the map will not parse"* are three different states and
   this hook exits 0 for all three. A gate that cannot distinguish *nothing
   happened* from *I could not look* will report the second as the first for as
   long as it exists.

3. **Satisfy on the target you named.** If the message says *"update
   `docs/features/events/README.md`"*, accept only that path. A prefix-shaped
   satisfaction condition converts a specific, actionable nag into a generic one
   the fastest dismissal is to satisfy accidentally — measured here at 54.3%.

4. **Make coverage the gate, not membership.** A hand-maintained source→doc
   registry is the thing that rots; the check over it can only ever be as good as
   its completeness. So gate the *registry*: every top-level feature directory
   must resolve to exactly one doc, and an unmapped directory is a build failure,
   not a silent exemption. That converts a 33% hole from invisible to
   unmergeable, and it is the only form of this gate that survives a refactor.
   (Same shape as the orphan-binding lesson in
   [`cross-artifact-drift-gate`](./cross-artifact-drift-gate.md): **only an
   inventory of what should exist finds an absence.**)

5. **Prefer a derivation over a declaration where one exists.** `sourceGlobs`
   restates a directory layout the repository already knows. Where a convention
   holds — `src/features/<x>/**` ↔ `docs/features/<x>/README.md` or
   `docs/features/<x>.md` — derive the pair and let the registry hold only the
   exceptions. Measured: **12 of this map's 37 entries** are exactly that
   mechanical correspondence written out by hand (`personas`, `templates`,
   `recipes`, `settings`, `home`, `onboarding`, `overview`, `schedules`, and four
   plugins). Deriving them removes 12 hand-maintained couplings *and* makes them
   self-repairing under a rename, which is what §7.D breaks.

6. **State which surfaces are inside the enforcement boundary.** A check
   satisfied by *"any file under `../personas-web/`"* silently depends on a
   sibling checkout being present, on the same machine, at that relative path.
   Cross-repo coupling is a *report*, not a gate — publish it, do not pretend to
   enforce it.

7. **A dismissible nag is a fine teaching device and a non-gate.** Keep it for
   the in-session reminder; put the ratchet somewhere that leaves an artifact —
   a pre-commit or CI check over the same map — because **a dismissal rate that
   is not recorded anywhere cannot be improved, argued about, or even known.**
   The brief asked whether this repo's dismissal rate is knowable: it is not.
   `exit 2` writes to stderr and the reply is prose in a transcript. There is no
   counter, no log, no file. (In this repo the question is moot for a second
   reason: the numerator is zero.)

---

## §7 — Deviations

### 7.A — P0. Both Stop hooks are dead, by the same line, for the same reason

`check-doc-sync.mjs:95-108` and `check-golden-path-touch.mjs:81-95` contain
byte-equivalent transcript walks with the same boundary test and the same
comment (*"Walk backwards to the most recent user message"*). A tool result **is**
a `type:"user"` / `role:"user"` event; the walk stops there.

Executed (§0): **0 of 2,367 file-edits visible, across 477 editing turns in 100
transcripts**; direct invocation on 12 real transcripts returns **exit 0, 12/12,
with an empty edit set**, against sessions holding up to 209 edits.

The fix is one clause — treat an event as a turn boundary only when its content
is *not* a tool result:

```js
if (evt.type === 'user' && evt.message?.role === 'user') {
  const c = evt.message.content;
  const isToolResult = Array.isArray(c) && c.some((b) => b.type === 'tool_result');
  if (!isToolResult) break;          // a genuine human message ends the turn
  continue;                          // a tool result does not
}
```

**Not applied.** Repairing it turns two hooks that have never spoken into two
hooks that speak on most turns, immediately, in the operator's live sessions —
including this campaign's own. That is a change to what a live surface shows.
Registered as deferred fix **#105**.

> **A prior path saw the site and not the scale.**
> [`adding-a-ci-gate`](./adding-a-ci-gate.md) §7 P10 records *"`:117` exits 0
> when the transcript yields no edits"* as one of two silent-pass paths. The
> transcript **always** yields no edits. §12.1 carries the correction owed.

### 7.B — P1. The message names one document; the check accepts a directory

`:120`, `:121`, `:125` — `docsTouched`, `onboardingTouched`, `personasWebTouched`
are all `startsWith` tests on a directory prefix, while `docHits` /
`onboardingHits` / `marketingHits` carry the exact target and print it.

Measured over 4,953 non-merge commits since 2026-05-16, two implementations
(a regex translation of the hook's own `compileGlob`, and git's `:(glob)`
pathspec — §12.4):

| | commits | share |
|---|---:|---:|
| entry-commit pairs where mapped source moved | 3,837 | — |
| same commit touched **any** `docs/features/*` — what the hook accepts | 761 | 19.8% |
| same commit touched **the mapped doc** — what the hook asks for | 348 | 9.1% |
| mapped doc moved on the **same calendar day** (most generous session proxy) | 1,597 | 41.6% |

**Precision of the satisfaction condition: 348/761 = 45.7%.**

Worst entries by co-edit rate, all with three-figure trigger counts:
`docs/features/teams/pipeline.md` **3 of 410 (0.7%)**;
`docs/features/personas/README.md` **14 of 411 (3.4%)**;
`docs/features/templates/README.md` **4 of 257 (1.6%)**. Six docs are at
**0 of 15–41**: `monitor.md`, `companion/cockpit.md`, `deployment/README.md`,
`teams/deliberations.md`, `sharing/README.md`, `plugins/scraper.md`.

### 7.C — P1. A third of the source tree is outside the map

Two implementations, agreeing to one file:

```
tracked .ts/.tsx/.rs under src/ + src-tauri/ (after the hook's SKIP_PATTERNS): 4,304
  covered by >=1 sourceGlob    regex=2,883   git-pathspec=2,884
  UNCOVERED                    regex=1,421 (33.0%)   git=1,420 (33.0%)
  membership disagreement: 1 file (sdk/personas-sdk.ts — a SCOPE difference, §12.4)
```

Largest uncovered areas: `src/features/shared` **229**, `src-tauri/db/src`
**131**, `src-tauri/core/src` **109**, `src-tauri/engine/src` **109**,
`src-tauri/src/companion` **90**, `src-tauri/src/engine` **87**,
`src-tauri/src/commands` **76**, `src/stores/slices` **57**.

`src/features/shared/` is the sharpest case: it is where components go when they
are promoted out of a feature (7.D), it holds ~115 catalogued primitives, and it
is coupled to **no** feature doc. `check-doc-map-paths.mjs` validates that every
path the map *names* resolves (77 nodes, exit 0) — it cannot validate what the
map fails to name.

### 7.D — P1. 318 renames crossed an entry boundary; the hook sees only destinations

With `-M` on, over the same window:

| | |
|---|---:|
| renames | 982 |
| renames touching a mapped area | 501 |
| renames **crossing** an entry boundary | **318** (in 22 commits) |
| …where a doc **lost** coverage | 51 |
| …where a doc **gained** coverage | 308 |

`2dd138840` moved the whole `ExecutionDetailModal/` tree from
`src/features/overview/` (mapped to `docs/features/overview/README.md`) to
`src/features/shared/components/modals/` (mapped to nothing) — eight files, one
doc's coverage silently deleted. `0e7e339a5` moved `sub_workspaces/` components
from dev-tools to `overview/sub_patterns/`, taking them out of **two** docs'
coverage and into a third's. `72e768158` is the tell in miniature — *"relocate
ConfigurationPopup to overview/health"* — where the hook, reading `Edit`
`file_path`s, would learn only that `overview/` changed.

### 7.E — P2. The onboarding half is structurally unreachable for 20 of 37 entries

Verified against [`guided-tour-step`](./guided-tour-step.md) §7.C, which
measured it first and whose numbers reproduce exactly: **38 registered flows**
(the map's `onboardingFlows` object has 39 keys, one of which is `_comment` —
§12.5), **17 of 37 entries declare any**, **6 live tour steps are registered
nowhere**, **3 registry entries name no live step**. Every flow in the registry
is referenced by ≥1 entry, and no entry references a flow outside it — so the
registry and the entries agree with each other while both are 6 short of the
tree. **Codegen-shaped consistency: the two artifacts agree; neither agrees with
reality.**

Onboarding satisfaction over history, for entries that *do* declare flows:
**53 of 2,361 triggering commits (2.2%)** touched any file under
`src/features/onboarding/`.

### 7.F — P2. The marketing check is a cross-repo dependency dressed as a gate

`:125` is satisfied by any edited path containing `/personas-web/`. That makes
the check's verdict a function of whether a *sibling checkout exists on this
machine at this relative path* — present here (`../personas-web`), absent on any
fresh clone and on every CI runner. **2,448** of the window's commits trigger the
marketing arm. `.claude/CLAUDE.md` describes the dismissal path as *"the explicit
trade-off"*; the untested precondition is not part of that trade.

### 7.G — P2. Cleared

Checked and found sound, recorded because a cleared claim is worth as much as a
confirmed one:

- `check-doc-map-paths.mjs` **works**: 77 nodes against 11,190 files, exit 0,
  every `doc` and `stepFile` resolves. It is wired into `npm run check` via
  `check:doc-map`. This is the one machine check in the documentation-sync
  surface that renders a verdict.
- `compileGlob` (`:72-87`) is **correct** for every pattern in the map — its
  `__GLOBSTAR__` handling matches git's `:(glob)` on 3,837 of 3,842 entry-commit
  pairs, and all five differences are rename detection, not translation bugs
  (§12.4).
- The map's `_comment` and the three-target design are coherent; the defect is
  not the design.

---

## §9 — The missing gate: a decline, and the instrument that would work

**Declined — with numbers.** No census rule is proposed for this leaf, and the
reason is the condition's shape rather than the difficulty of a regex.

**What was tried and why each fails:**

1. *The transcript-boundary bug* (7.A) lives in **2 files**, both under
   `scripts/docs/`. A two-file baseline is not a ratchet; and the compliant form
   — a tool-result-aware boundary — exists **nowhere in the repository**, so the
   mandatory positive control would return **0 matches**, which
   `assertRule` (`scripts/census/lib/engine.mjs:264`) treats as a *structural*
   failure. **Violating 2, compliant 0.**
2. *The prefix-shaped satisfaction condition* (7.B) is 3 `startsWith` calls in
   one file, and each names a **different** prefix — `docs/features/`,
   `src/features/onboarding/`, `../personas-web/`. Measured over the 155
   `.mjs`/`.js`/`.cjs` files under `scripts/`: the tight pattern
   `startsWith\(['"]docs/` matches **2 sites in 2 files** — one true positive
   (`check-doc-sync.mjs:120`) and one false (`scripts/test/evaluate.mjs`), so
   **precision 1/2 and recall 1/3**, since it cannot see the other two prefixes
   at all. Widening to any `.startsWith(` matches **95 sites in 44 files**, of
   which 3 are this condition — **3.2% precision.** A rule that finds one of the
   three cases it was written for reports green while the condition is present.
   Rejected, on the same grounds `adding-a-ci-gate` rejected
   `gate-exits-zero-from-catch`.
3. *The 33% coverage hole* (7.C), the *registry incompleteness* (7.E) and the
   *318 boundary-crossing renames* (7.D) are **absences and relations**, not
   tokens. The census ratchets a count of something *present* in a file. It
   cannot say "this registry omits a directory", "this rename left a mapped
   area", or "this doc was not co-edited". The doctrine already records this
   limit; this leaf is a clean instance of it.

**Checked for overlap before declining**, per the census discipline: the 191
registered rules include four touching `.github`/YAML
(`env-default-conflates-unset-with-empty`, `config-value-frozen-at-compile-time`,
`unverifiable-generated-artifact`, `verification-that-cannot-fail`) and none
whose `goldenPath` is this leaf. Nothing to extend.

**The instrument that would work — specified, not written.**
`scripts/docs/check-doc-map-coverage.mjs`, wired into `npm run check` beside the
existing `check:doc-map`:

```
for each top-level dir D under src/features/ and src-tauri/src/commands/:
    if no entry's sourceGlobs matches any file in D  -> collect D
assert  unmapped == []          (or an explicit, reasoned allowlist entry)
assert  files_walked >= FLOOR   (else: "the matcher is broken, not the tree clean")
assert  every entry matches >=1 live file   (a stale glob is a dead entry)
exit 2 if either assertion has nothing to check
```

Today that reports **1,421 unmapped files across the 8 areas in 7.C**, which is
the number a ratchet should hold. It is an *inventory* check, not a diff check —
which is precisely why it can see what the Stop hook cannot. Its own
fail-loud precondition is the `files_walked >= FLOOR` assertion, copied from
`scripts/census/lib/engine.mjs:253`, because a coverage checker that walks zero
directories reports perfect coverage.

**And the type that outranks it.** Per the contract's *"prefer a type over a
gate"*: the strongest fix here removes the registry rather than gating it. Make
`doc` **derivable** — `src/features/<x>/**` → `docs/features/<x>/README.md` — and
let `feature-doc-map.json` hold only the exceptions. A derived coupling cannot
be 33% incomplete, and a rename that leaves `src/features/<x>/` changes the
derived answer automatically. That deletes 7.C and 7.D outright, and leaves 7.A
and 7.B as ordinary bugs.

---

## §12 — Corrections

### 12.1 — Owed to [`adding-a-ci-gate`](./adding-a-ci-gate.md) §7 P10

That path records `check-doc-sync.mjs:117` as one of *"two silent-pass paths"*,
phrased as *"exits 0 when the transcript yields no edits"*. Correct about the
line, and it understates by the maximum possible margin: **the transcript always
yields no edits**, because the walk's turn boundary (`:98`) is the shape a tool
result wears. Measured 0 of 2,367 file-edits across 477 editing turns. The same
correction applies to its P10 sentence *"It is also a nag, not a gate"* — it is
neither; it is silent. **P10's proposed fix (distinguish the three states, fail
loudly on an unparseable map) is still right and now insufficient**: fixing the
reporting of an empty set does not fill the set.

### 12.2 — `sides: "server"` is contradicted, and inverted rather than incomplete

Every artifact in this document is **build tooling and repository content**:
a Node Stop hook, a JSON registry, markdown under `docs/`, and git history.
Nothing in this leaf has a client half or a server half; the label is not "too
narrow", it is **inapplicable**. The one place a side-shaped distinction appears
is the *marketing* surface (7.F), and that axis is **cross-repository**, not
client/server. Add to the doctrine's ledger as a **contradiction with a new
mode**: not "it was both", not "it was inverted" — *the axis does not partition
this leaf*.

### 12.3 — `convergence: converged` fails — and the oracle inverted my own first draft

**This section was written wrong once and is corrected here on purpose**, because
the error is the exact one the doctrine warns about: I drafted *"no sibling has a
documentation-sync mechanism at all"* from the shape of the problem, then ran the
sweep.

What the sweep actually returned, cohort established at measurement time
(2026-08-17):

| repo | source→doc registry | enforcement |
|---|---|---|
| `../brainiac` | **yes** — `docs/feature-doc-map.json`, 12 entries, same `{doc, sourceGlobs}` schema, same `_comment` convention | **none** — no `.claude/settings.json`, no hook, no checker, and `feature-doc-map` appears in **0** other files in the repo |
| `../vibeman` | no | has a `Stop` hook — but it is an **HTTP callback to its own localhost app** (`/api/hooks/task-stopped`), unrelated to documentation |
| `../personas-web` | no | `.claude/settings.json` declares **no hooks** |
| `../ascent` | no | `.claude/settings.json` declares **no hooks** |
| `../personas-cloud` | no | no `.claude/` at all |

Three things follow, and none of them is "converged":

1. **The registry is a port, and its `_comment` says so out loud**: *"the
   Personas doc-rot scan reads this file to flag any doc whose coupled source
   changed without the doc being touched."* `brainiac` is not a witness; it is a
   **dependent** — it publishes this artifact *for* the Personas app to consume.
   The doctrine's exclusion applies exactly.
2. **The declaration travelled and the enforcement did not.** This is the
   oracle's strongest result shape — cost/inversion, not agreement. The half of
   the practice that is cheap to copy (a JSON file) crossed the boundary; the
   half that does the work (a machine that reads it) did not. And the ported
   half is in **better** health than the original: `brainiac`'s 12 entries resolve
   **12 of 12**, with no `onboardingFlows` and no `marketingModule` — no
   partially-populated optional fields, because it never grew the two extra
   target types that are 20/37 and 13/37 empty here.
3. **Personas is ahead of the fleet, stated as self-comparison** — it is the only
   repo that built a mechanism. And the mechanism should not be copied as-is:
   §0 shows it has never run.

Recorded for the doctrine's ledger as a **fourteenth tested `convergence:
converged` and a fourteenth failure**, in the "converged on not having the
problem / one author's artifact wearing two coats" family.

### 12.4 — The two implementations disagreed on 5 of 3,842, and the disagreement was the finding

Implementation A parsed `git log --name-only` and applied a verbatim copy of the
hook's own `compileGlob`. Implementation B never translated a glob: it handed
each `sourceGlob` to git as a `:(glob)` pathspec and intersected commit-sha sets.
They disagreed on **3 of 37 entries, 5 of 3,842 pairs (0.13%)**.

Every difference is **rename detection**. `git log --name-only` prints only the
*new* path of an `R100` rename; `git log -- :(glob)…` matches **both** sides.
The sample that exposed it — `72e768158`, *"relocate ConfigurationPopup to
overview/health"* — is `R100 src/features/agents/…/ConfigurationPopup.tsx →
src/features/overview/…/ConfigurationPopup.tsx`, and it is the seed of §7.D.
**The disagreement between the two implementations became a deviation section.**

Two further notes on instrument honesty:

- My first diagnostic for that divergence was **wrong**: it tested membership
  with `git ls-files --error-unmatch -- :(glob)<g> <f>`, and passing both the
  glob and the file as pathspecs makes git OR them, so every file "matched".
  Caught because the reported "git-only" files were obviously unrelated to the
  entry. A diagnostic needs the same scepticism as a measurement.
- The single coverage-membership difference in 7.C (`sdk/personas-sdk.ts`) is a
  **scope** difference, not a matcher difference: implementation A enumerated
  `src/` + `src-tauri/` only, while B let git glob the whole repo — which
  incidentally establishes that the map reaches outside both trees. Reported as
  what it is rather than folded into the agreement.

### 12.5 — 39 keys, 38 flows: a count that is a measurement of the counter

`Object.keys(map.onboardingFlows).length` is **39**; `guided-tour-step` §7.C
says **38**. Both are right: the 39th key is `_comment`. Reported because the
doctrine's warning generalises here exactly — *the count looks like a
measurement of the registry; it is a measurement of whether you remembered that
JSON has no comments, so registries grow comment-shaped members*. `:194`'s
`onboardingFlows[flowId]` lookup is unaffected (nothing references `_comment`),
so this is a counting hazard, not a bug.

### 12.6 — The brief's lead was already published; going elsewhere was the work

The dispatch brief offered as *"the measured hole"*: *20 of 37 doc-map entries
declare no `onboardingFlows`, and 6 live tour steps are registered nowhere.*
Both numbers are correct and **both were already published**, by
[`guided-tour-step`](./guided-tour-step.md) §7.C, including the observation that
`check-doc-sync.mjs`'s onboarding check "can never name" an unregistered step.
Verified on use (one command, §7.E) rather than re-derived, and this document's
new ground is elsewhere: the hook does not run at all (§0/7.A), the satisfaction
condition is 45.7% precise (7.B), a third of the tree is unmapped (7.C), and the
map's coupling is destroyed by 318 renames (7.D).

The brief also asked whether the **dismissal rate is knowable**. Answer: **no**,
for a structural reason worth keeping — `exit 2` writes to stderr and the
response is prose. No counter, no log, no artifact. And in this repo the question
never arose: the numerator has been zero since 2026-05-16.
