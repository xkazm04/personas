---
layer: technique
subject: design-tokens
technique: token-enforcement
status: forged
laws:
  - gate-sees-target
  - failure-not-empty-success
  - deletion-is-not-repair
---

# Token enforcement

A token system is a promise that visual decisions go through names. Promises
about code decay at the rate of the busiest deadline unless a gate holds
them, and this technique is the design of that gate: what it bans, where it
runs, at what severity, and how it stays honest.

## The decay mechanism, precisely

Token systems do not fail by decision; they fail by accretion. One commit
inlines a raw value because the deadline is real and the squiggle is
ignorable. The next author copies the nearest code, which now contains the
raw value. Six months later a survey finds the semantic layer is one dialect
among several, and the fix is no longer "revert a commit" but "migrate a
codebase". The economics only work in one direction: **preventing a raw
value costs one review comment; removing an established raw-value dialect
costs a migration project.** Enforcement is cheap exactly once — before the
decay — which is why the gate ships *with* the token system, not after the
first drift audit.

The measured version of this: across token axes in one product, the axes
whose rules were wired within weeks of the token's introduction sat at
94–99% adoption; axes with no firing rule collapsed to single digits — and a
cross-product check falsified the tempting alternative explanations (how the
token is delivered, how ergonomic it is). The surviving predictor of
adoption was **whether a gate fires and how early it was wired**. Tokens do
not sell themselves; gates sell them.

## What the gate bans

The rule family, one per axis of the taxonomy:

- **Raw values with a semantic equivalent are errors.** A literal color where
  a color role exists; a raw radius where the radius ladder covers the case;
  a loose text-size utility where a type recipe exists; a magic duration
  where the ladder has a step. The predicate is "has an equivalent" — the
  gate's message must *name the equivalent* (ban + pointer), because a rule
  that only forbids teaches nothing and gets overridden.
- **Primitive references outside the role/theme layer are errors** — the
  skipped-layer anti-pattern from [token-taxonomy](token-taxonomy.md).
- **Contrast floors per theme.** Every foreground/surface pairing in every
  theme — authored and derived — meets its declared ratio. This gate reads
  the theme definitions themselves and recomputes the ratios; a checked-in
  approval matrix that isn't recomputed is a proxy, and proxies are exactly
  what [gate-sees-target](../../_laws.md#gate-sees-target) forbids: the gate
  must read what ships, or it passes precisely when the palette drifts.
- **Vocabulary membership.** Names referenced by consumers exist in the
  authority; themes bind the complete set (the completeness check from
  [theme-architecture](theme-architecture.md)); mirrors match (the parity
  check from [cross-language-token-parity](cross-language-token-parity.md)).

## The gate must be able to see the violation

Three visibility failures recur in raw-value gates, and each produces a
green result over a decaying codebase:

- **The byte-identical token.** If a semantic token's *expansion* is
  textually identical to the raw form it replaces — the token for "success
  text" resolves to the very same class string an author would type by hand
  — then at the site the gate reads, adopter and violator are
  indistinguishable, and the axis is lexically unenforceable no matter how
  good the rule is. Enforceability is a *design constraint on the token
  itself*: the sanctioned path must leave a distinct trace (a distinct name,
  a distinct reference) in the artifact the gate parses, or the gate cannot
  exist.
- **The deny-list membership check.** A rule that bans an enumerated list of
  known-bad values certifies everything else — including values that do not
  exist in the system at all, which then ship silently doing nothing. The
  vocabulary is closed; the check must therefore be an **allow-list against
  the authority** ("is this a member?"), never a deny-list of remembered
  offenses ("is this one of the bad ones?"). Measured in the wild: hundreds
  of uses of a size class that no layer defines, all green, because the
  deny-list had never heard of it.
- **The exemption bucket and the unvisited branch.** Path exemptions
  ("shared components are allowed"), skipped syntactic positions (values in
  interpolated strings, values outside the one attribute the rule visits),
  and early-return escape clauses each subtract silently from recall — a
  rule can be firing daily and still see under half of the real
  occurrences. Recall is a property to *measure against a ground-truth
  sweep*, not to assume from the rule's existence.

## Severity is the design decision

The most common way this gate is neutered is not deletion — it is being set
to **advisory**. The measured lesson generalizes: if the build pipeline
counts only errors (or caps only errors), then a warn-level rule enforces
*nothing at any gate, by construction* — every commit that ignores the
editor squiggle lands, and the squiggle-ignoring commits are, by selection,
exactly the decay. Advisory levels do have a real effect — they shape
authoring through editor feedback and correlate with adoption — but that
effect is persuasion, not enforcement, and a system whose floor is
persuasion has no floor.

The severity policy that works:

- **New violations: error.** No new raw values with equivalents, ever.
- **Legacy debt: ratchet, not advisory.** Where a codebase predates the
  rule, snapshot the count as a baseline and fail on *increase*, burning the
  baseline down opportunistically (fix-as-you-touch). A permanent warn-level
  is not a transition plan; it is surrender with telemetry.
- **Never narrow the rule to make a file pass.** Excluding the offending
  directory, deleting the failing theme from the matrix, or demoting the
  severity converts a visible defect into an invisible one at the exact
  place visibility existed —
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair).

## The escape hatch is loud and countable

Genuine one-offs exist — a brand asset with a fixed color, a physical
constant no role should own. The gate therefore has an override, and the
override's design carries the whole policy:

- **Syntactically loud** — an explicit inline suppression naming the rule,
  never a config-level exclusion that silently blesses a whole file.
- **Justified inline** — the suppression carries its one-line reason.
- **Countable** — suppressions are enumerable by grep or report, and the
  count is watched. Ten is a policy; three hundred is a dialect. An
  invisible escape hatch (a wildcard exclusion, a fork of the component
  outside the linted tree) is how enforcement dies while the dashboard
  stays green.

## The gate must be able to fail

Two honesty clauses, both instances of
[failure-not-empty-success](../../_laws.md#failure-not-empty-success):

1. **Zero-input is fatal, not green.** A theme-contrast checker that
   discovers zero themes, a parity checker that parses zero tokens, a lint
   run that matched zero files — each must exit as a broken instrument, not
   as a pass. Every one of these has a real failure mode (a moved file, a
   changed export shape, a glob that no longer matches) that otherwise
   reports as perfection.
2. **The gate runs where merges are decided.** An enforcement script that
   exists but is wired into no pipeline is documentation with an exit code.
   The chain to verify: rule exists → severity fails builds → pipeline runs
   it → pipeline blocks the merge. Any broken link and the system is
   advisory de facto, whatever the severity says.
