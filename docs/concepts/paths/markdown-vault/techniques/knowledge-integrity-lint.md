---
layer: technique
subject: markdown-vault
technique: knowledge-integrity-lint
status: forged
laws: [failure-not-empty-success, gate-sees-target, deletion-is-not-repair]
shared_with: []
---

# Knowledge integrity lint

Code has compilers and tests; a knowledge store has neither, and its defects
make no noise. A broken reference costs nothing until someone follows it. A
claim that stopped being true costs nothing until someone acts on it. A note
nothing links to simply falls out of the navigable world. The store does not
crash — it **rots**, and the only observable symptom is that humans quietly
stop trusting it. This technique gives the rot detectors, the way lint gave
code its silent defect classes detectors: run them routinely, report
findings as defects with locations, and never let the detector mutate what
it measures.

## The three defect classes

- **Broken links — reference integrity.** A link whose target resolves to no
  note, found by resolving every extracted edge against the note index and
  reported with source note and line, like a compiler error. The resolution
  rules are the shared ones the whole application uses — a linter with its
  own private resolver reports its own private defects.
- **Orphans — reachability.** Notes with no incoming links, unreachable by
  navigation. Crucially, orphanhood has **legitimate exemptions**: entry
  points (top-level notes, indexes, deliberately unlinked overviews) are not
  defects. The exemption policy is declared in one predicate, visible next
  to the check — not smuggled in as scattered special cases — because the
  exemptions are where two features' "orphan counts" diverge and where a
  reader will ask why a note was or wasn't flagged.
- **Staleness — temporal integrity.** A note untouched for longer than a
  threshold is flagged for review. Honesty requirement: modification time is
  a **proxy** for review-currency — an untouched note may be timelessly
  correct, a freshly-touched one may have had a typo fixed in a stale claim.
  The check carries its predicate ("untouched for N days", N configurable,
  zero disables) and presents findings as review candidates, never as
  verdicts.

## The detector must see the whole target

Two laws govern the scan itself. Per
[gate-sees-target](../../_laws.md#gate-sees-target) and
[failure-not-empty-success](../../_laws.md#failure-not-empty-success), a lint
pass that silently skips an unreadable directory and reports the remainder
clean has manufactured the most expensive lie the store can tell: a **false
clean** over a partial corpus. The lint walk therefore aborts loudly on the
first unreadable corner — unlike best-effort walks elsewhere in the vault,
whose consumers only want a measurement. Same walker, opposite error policy,
chosen by what the consumer's "done" means. A lint result must be one of
"scanned everything, found these" or "could not scan"; there is no third
state.

## Two tiers: mechanical and judgment

The defect classes above are **syntactic** — deterministic, cheap, safe to
run on every invocation. Above them sits a **semantic** tier only judgment
can reach: two notes contradicting each other, a topic mentioned everywhere
that deserves its own page, an obvious cross-link both notes are missing,
a cluster the vault covers thinly. A language model reads a compact summary
of the corpus and proposes findings.

The tiers get opposite operating contracts, because their costs and failure
modes are opposite:

| | Syntactic | Semantic |
|---|---|---|
| Determinism | total | none — same vault, different findings per run |
| Cost | a walk | a metered model call |
| Cadence | always | opt-in, deliberate |
| Input | the whole vault | a **bounded** summary: capped note count, capped snippet per note, capped total prompt |
| Output authority | defect reports | **proposals only** — a human reviews before anything acts |

The bounding is not frugality alone: an unbounded corpus dump produces worse
judgment than a curated summary, and an unbounded bill produces a switched-
off tier. Propose-only is not timidity: a nondeterministic detector with
write access is a nondeterministic *mutator*.

## Repair is a separate pass, and deletion is not repair

Lint detects; it never fixes. Repair — pruning superseded notes, merging
duplicates into a canonical note, refreshing links and structure — is its
own pass with its own contract:

- **Bounded**: a per-pass budget of notes and a hard time cap, so a pass is
  reviewable and re-runnable rather than a vault-wide big bang.
- **Goal-declared**: which of prune / merge / refresh this pass may do is
  explicit input, not the repairer's mood.
- **Fact-preserving**: per
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair), removing
  a note to clear a finding destroys the knowledge that made the note worth
  linting. A merge keeps every distinct fact from its sources; a prune is
  reserved for the superseded and the content-free; human-authored primary
  records are kept intact absent exact duplication.
- **Measured regardless of outcome**: corpus size before and after, counted
  by the pass itself — and counted even when the pass fails or is cancelled,
  because a half-run repair has already mutated the store. Self-reported
  action counts from the repairing agent are reconciled against the
  measured delta, not trusted alone.
