---
layer: application
subject: codebase-scanning
technique: rule-precision-discipline
stack: node
---

# The census engine — precision discipline as a declarative registry

`scripts/census/` is the repo's mechanical rule tier: a declarative
registry (`rules.json`, 201 rules at last count) driven by one engine
(`lib/engine.mjs`), where *adding a gate is an entry, not a new script*.
Nearly every clause of the precision discipline appears here as an
enforced structural property rather than a convention.

## The registry encodes the discipline's invariants

From the field guide at the top of `scripts/census/rules.json`:

- **Every rule has an owner** — `goldenPath` is mandatory: "A rule with no
  owner is a rule nobody maintains."
- **Baselines fail in both directions** — `baseline: { files, matches }`:
  "the run fails if either RISES, and also if either DROPS without this
  being updated (a silent drop is usually a broken matcher)."
- **The instrument is asserted before the result** — `floor` is the
  minimum file count the walk must *see*; below it "the result is
  untrustworthy and the run fails with 'matcher broken, not codebase
  clean'" (`engine.mjs:253-258`). A moved directory cannot masquerade as a
  cleanup.
- **Exemptions cannot rot** — every `exclude` entry requires a `reason`
  (≥ 12 characters, enforced), and "an exclude that matches no file fails
  the run (stale exemption)" (`engine.mjs:282`).

## Zero-match refusal, verbatim

`engine.mjs:267-272` refuses a rule that "matched zero files anywhere. A
census rule that finds nothing is a broken matcher … baselining it at zero
— a rule pinned at 0 is a gate that can never fail." This is the
technique's zero-match clause implemented as a hard failure, including the
corollary that the escape hatch (baseline it at zero) is named and blocked
in the same error message.

## Positive controls, with the anti-neutralization rule

The engine recognizes positive-control rules by id (`engine.mjs:377`) and
*forbids* them a baseline (`engine.mjs:384`): "a positive control must NOT
carry a baseline — it exists to fail." The comment above notes this
requirement broke three tools in this runner when controls were first
mandated — the controls did their job against the census's own
instrumentation before they ever gated the codebase.

## The population-first and cross-check lessons, paid for in this repo

Two of the discipline's strongest claims are grounded in measured history
around this engine rather than inside it:

- **Zero-percent precision from principle.** Two gates written from
  principle in one hour, without reading the population, both measured 0%
  precision (recorded in the library-consumption research and
  `.claude/CLAUDE.md`). The same file documents `custom/enforce-base-modal`:
  precision 0/8 and recall 0/19 over its whole anchor — while the census
  rule `hand-painted-modal-backdrop`, written against the real population,
  measures 20/20 precision on 19 files.
- **Counts that travel get a second implementation.** The 29-orphan-binding
  figure was produced by three independent implementations (48 / 31 / 29);
  the loosest was wrong by 19 because macro-generated code lacked the
  literal keyword the textual matcher keyed on. The census's own matcher
  history includes line-end token and CRLF-drift bugs caught only by a
  second implementation — the registry's `signal.description` field exists
  so every count carries its predicate.

## Where the application stops short of the technique

Hand-verified precision *samples* are not stored in the registry — measured
precision lives in the owning golden-path docs and commit messages, not as
a `precision:` field next to each rule. The registry knows each rule's
owner and baseline but not its last-measured hit rate; a maintainer must
follow the `goldenPath` pointer to learn whether they are holding a scalpel
or a shotgun.
