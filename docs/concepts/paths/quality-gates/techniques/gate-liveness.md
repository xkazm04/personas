---
layer: technique
subject: quality-gates
technique: gate-liveness
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Gate liveness

The most expensive state a gate can occupy is not red, and not honestly
absent — it is **false green**: exiting clean because it checked nothing.
A dead gate is worse than no gate, because no gate leaves the team
appropriately nervous, while a dead one radiates confidence. Liveness is
the set of properties that make a gate's green mean what everyone assumes
it means, and none of them come free.

## Assert the instrument before the result

Every checker has an instrument — the file walk, the rule load, the parser,
the external tool — and a result. The standing rule
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
**instrument failures get their own exit path, distinct from both pass and
fail.** Concretely, a checker treats as fatal — not as zero findings:

- a walked population of zero, or wildly below the expected floor
  ("checked 0 files" is the signature of a moved directory or a broken
  glob, never of a clean codebase);
- a configuration or rule set that failed to load, leaving the checker
  running with an empty standard;
- a required external tool that is absent — the correct output is a loud
  "cannot check," visibly different from "checked, clean." A gate that
  skips silently when its scanner is not installed is reporting its own
  absence in the voice of success;
- inputs it could not parse, when the unparseable population is the very
  thing being judged.

The vocabulary matters: three outcomes (pass / fail / could-not-run), three
distinguishable outputs, ideally three exit codes. Any check that folds
could-not-run into pass has pre-committed to the worst failure mode.

## Portability: a gate must run where it claims to run

A gate that works only on its author's machine gates only its author. The
classic killers:

- **Path assumptions** — resolving the project root from the current
  working directory instead of from the checker's own location, so the
  check walks an empty tree when invoked from anywhere else;
- **Tool presence** — depending on a binary that one machine happens to
  have on its path;
- **Platform drift** — path separators, line endings, case sensitivity,
  shell dialects.

The test is not code review; it is running the gate from every context
that will invoke it — each rung, each platform, a fresh clone. And note
the interaction with instrument assertion: a *non-portable* checker
without instrument assertions is precisely how false green is
manufactured at scale — on the foreign machine it finds zero files and
reports success. The two properties back each other up; a portability bug
under an instrument assertion is a loud error, under none it is a
permanent silent pass.

## Chain ordering: one broken step can blind the rest

Gate suites commonly run as an abort-on-first-failure chain. Two
consequences deserve design attention:

- **A step that cannot run somewhere aborts everything after it, there.**
  If step three of nine has a portability bug, machines where it breaks
  never execute steps four through nine — and the failure message points
  at the broken step, not at the six checks that silently never ran. Order
  chains so environment-fragile steps run late, or better, make each step
  liveness-clean before it enters the chain; and when diagnosing "the
  suite fails on machine X," always ask what the abort *prevented* from
  running.
- **Abort-on-first hides breadth.** For feedback rungs, prefer
  run-everything-report-all so one finding does not mask five; reserve
  abort-on-first for cases where later steps are meaningless after an
  earlier failure.

## The invocation channel can swallow the verdict

A checker's exit code only matters if the thing invoking it reads it.
Between a healthy checker and an obedient pipeline sit invocation layers
that routinely eat the verdict:

- **Pipes.** Feeding a checker's output through a pager or filter replaces
  the observed exit status with the last command's — a red run pushed
  through a pipe has been watched turning green this way, once is enough.
  Run gates directly, or under strict pipe-failure semantics.
- **Wrappers and task runners** that catch the child's failure, print it,
  and exit clean — turning refusal into narration.
- **Announced skips.** A gate whose dependency is absent and says so
  loudly, then exits clean, is honest output and zero enforcement. The
  pattern is defensible exactly when a binding upstream backstop runs the
  same check unconditionally; without the backstop, the control is opt-in
  on every machine that never installed the tool, and the announcement is
  the gate's obituary read aloud at each commit.

## Prove it red: the seeded-failure test

A gate's operation is verified the same way any code is — by observing it
fail on input built to fail:

- **At birth:** before a new gate is trusted, feed it a known violation
  and watch it go red through the *real* invocation path — the actual hook,
  the actual pipeline step — not just the checker run by hand. This
  catches the wiring class of death: checker fine, trigger never fires,
  every result it ever reported was a report nobody requested
  ([gate-sees-target](../../_laws.md#gate-sees-target) applied to the
  trigger: the gate must see the *events* it gates, not just the files).
- **Continuously, where stakes justify it:** keep known-bad fixtures in
  the gate's own test suite. And treat fixture quality as load-bearing —
  a rule's test fixtures that never contain the pattern the rule exists
  to catch certify nothing, while looking exactly like coverage.
- **On any dispute:** when someone says "but the gate passed," the first
  diagnostic is a seeded failure, because "the gate has never fired" and
  "the gate cannot fire" are indistinguishable from the outside.

A useful standing metric: **time since last red**, per gate. A gate that
has been green for a year is either guarding an extinct defect class
(candidate for retirement), or dead (candidate for a seeded-failure probe).
Green forever is not a trophy; it is a question.

## Liveness of the trigger, not just the checker

The checker and its trigger fail independently. Hooks can be uninstalled;
conditional pipeline steps can have conditions that never match; a
transcript- or event-walking trigger can terminate early on a malformed
assumption and observe nothing while the checker behind it stands ready
and idle. Liveness auditing therefore covers the full path: does the
trigger fire on real events, does it hand the checker the real target, and
does the checker's verdict reach an exit code someone obeys. Any link in
that chain can be dead while every other link is healthy — and the
observable, in every case, is green.
