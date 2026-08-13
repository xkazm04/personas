# The golden-path contract

> What a composing agent is asked to produce for one leaf of the
> [situation spine](./situation-spine.md). Derived from three hand-authored
> probes ([`golden-paths/`](./golden-paths/)) that between them read ~157
> files and surfaced ~200 real defects — the sections below are the ones that
> carried that value, plus the one the probes proved was missing.

## The object

A golden path is **the canonical answer to one recurring construction
problem**. It is prescriptive, names real primitives, and is written for a
developer who is about to build the thing — not for a reviewer judging code
that already exists. Its head stays language-free so a sibling project in
another stack can adopt the same doctrine; its manifestations are
stack-specific.

One leaf → one golden path. No leaf gets two; no path spans two leaves.

## Nine sections

| # | Section | Answers | Notes |
| --- | --- | --- | --- |
| 1 | **Trigger** | how do I know I'm in this situation | 3–6 phrasings a developer would actually say or type, including the "if you are about to write X" test |
| 2 | **The one way** | the prescription | ONE paragraph, imperative, no hedging. If two answers are genuinely both correct, say which to reach for first and why |
| 3 | **Mandated primitives** | what you must use | `path/Name` — what each gives you. Never invent a name or a prop |
| 4 | **Steps** | the construction order | numbered, real. Include the "and then stop" step where the primitive takes over |
| 5 | **Anti-patterns** | the wrong moves, and why | each names the failure mode, not just the rule |
| 6 | **Evidence** | exemplary call sites | `path:line`. Name the ONE site to copy |
| 7 | **Deviations** | where this repo breaks it today | the fix backlog. Every entry needs a path and a one-line defect |
| 8 | **Gaps** | what the primitive genuinely cannot do | distinguishes a real limitation from laziness; several deviations are usually downstream of one gap |
| 9 | **The missing gate** | what would have caught this | see below |

### Section 9 is MANIFESTATION-layer, not principle-layer

**Corrected 2026-08-13 by the portability test** ([`research/portability-test.md`](./research/portability-test.md)),
which took three paths to a sibling repo on a different stack and measured
what happened. The heads transferred — `page-loading`'s found **22 real
defects** in a repo that had never seen it. **Every gate failed.**

Four §9 signals were tested against `personas-web`. All four scored **zero
true positives while the condition was present at scale.** The sharpest case
is the form path's signal, which claimed "a false-positive rate of zero by
construction" from 120 matches across 49 files here: the sibling contains
exactly **one** single-line `<label>`, and it has `htmlFor` — so the rule
matches nothing, while three genuine orphan labels sit in one file, invisible
only because Prettier and a line-length rule split them across lines.

The cause is general: **a signal keys on the markup a deviation happened to
wear in one repo, not on the semantic condition.** Ship that as doctrine and
it reports green forever in the sibling — precisely the failure this section
was written to prevent, committed by the section itself.

So: a gate is a **manifestation**. It belongs to the stack, beside the
primitive it guards, and it does NOT travel with the principle head. A path
adopted elsewhere inherits the trigger, the one way, the anti-patterns and the
verification *intent*; the adopting repo writes its own signal against its own
formatting, tooling and idiom. State in §9 which condition the signal is a
proxy for, so the next repo can re-derive a different proxy for the same
condition.

### Why a gate is required at all

All three probes independently found that **every deviation they listed had
shipped under a green `npm run check`**, and the platform sweep found 29 of
51 infrastructure situations with no machine gate at all. Where a custom
ESLint rule exists, convergence is measurably better; where none exists
(buttons, selects, empty states, form fields), it isn't. Documentation does
not hold a line. So every golden path proposes its own enforcement:

- the **signal** — what a machine can key on (`role="columnheader"` was found
  to be a near-perfect table signal: 6 files, 4 true positives)
- the **mechanism** — ESLint rule / check script / test / CI job / hook
- the **allowlist** — the legitimate exceptions, named
- **how it fails loudly if its own precondition is absent.** This is not
  optional. `ci.yml` in this repo is a museum of gates that ran green while
  checking nothing: commit-lint dying on a bad ref, `cargo test` aborting
  pre-compile without `--features desktop`, a secret scan that exits 0 when
  gitleaks isn't installed. A gate that no-ops is worse than no gate, because
  it manufactures confidence.

If no gate is possible, say so and say why — that is a finding.

### Don't write a script — add a census rule

**A §9 gate whose mechanism is "count the violations and fail if the count
rises" is already built. Do not write another script for it.** 247 leaves × ~2
gates is ~460 bespoke scripts, and wave 1 produced three paths that each
specified the same ratcheting-baseline mechanism independently
(`tables.md` Gaps 9/10, `inline-busy-state.md` §9 item 4,
`dropdown-and-select.md` §9 assertion 3 — same design, same failure-mode
analysis, three times).

That mechanism lives once at **[`scripts/census/`](../../scripts/census/)**.
Adding a gate is an entry in `scripts/census/rules.json`:

```jsonc
{
  "id": "raw-select",
  "goldenPath": "docs/concepts/golden-paths/dropdown-and-select.md",
  "roots": ["src"], "extensions": [".ts", ".tsx"],
  "signal": { "pattern": "<select(?![A-Za-z0-9_$-])", "flags": "g",
              "ignoreCommentLines": true, "description": "…" },
  "exclude": [{ "path": "…/ThemedSelect.tsx", "reason": "the primitive itself" }],
  "baseline": { "files": 46, "matches": 63 },
  "floor": 4000
}
```

Run it with `npm run census` (report) and `npm run census:check` (the gate —
drift is fatal); `npm run census -- --update` ratchets a baseline after a real
fix; `npm run census:test` is the runner's own self-test.

**It implements the §9 fail-loud requirement so each path doesn't have to
re-derive it.** A run fails — not warns — when the walk sees fewer files than
`floor` ("the matcher is broken, not the codebase clean"), when a rule matches
zero files anywhere, when an `exclude` entry no longer matches any file (a stale
exemption), when a count rises, **and when a count drops without the baseline
being updated** — a silent drop is a broken matcher far more often than it is
fixed code. Surviving counts print on success, so a build log distinguishes a
clean run from one that checked nothing. `exclude` entries require a prose
`reason`, enforced.

Two things a composing agent should know, both learned by getting them wrong
while building this:

- **Match against whole file content, never line-by-line.** The pattern
  `<select[\s/>]` applied per-line misses every `<select` that ends its line —
  63 of this repo's 67. It reads as "4 violations, looks clean".
- **Verify your §9 counts through a second implementation before baselining
  them.** `raw-web-storage` was specified as "430 lines, precision near-perfect";
  35% of those matches are prose in comments *about* migrating away from
  localStorage. The honest violation count is 186.

Use a census rule for countable signals. ESLint (with `RuleTester` fixtures)
remains the right host when the signal is structural/AST-shaped or wants an
autofix — `inline-busy-state.md` §9 explains why. The two compose: the rule
reports, the census ratchets.

## Composing rules

**Ground truth, never memory.** Every claim traces to a file read during
composition. Count real call sites; do not estimate. If the catalog or a doc
claims a primitive exists, open it — the probes found `feedback/EmptyState`
recommended by `CLAUDE.md`, the reuse doc *and* the catalog, and the file does
not exist. They also found `LoadingSpinner` documented as canonical while it
renders `null`.

**Compose across dimensions.** Each leaf carries the concerns a canonical
answer must satisfy — ui, function, performance, code-quality, resilience,
security, cost. A path that optimises one and ignores the others is not
canonical. A table path that is beautiful and unpaginated has failed; an auth
path that is secure and unusable has failed.

**Two-sided situations get one document with both halves.** Where the leaf is
marked `twoSided`, the path must state the frontend half, the backend half,
and the contract between them. Half a path is worse than none: the probes
found the IPC timeout hazard documented precisely on the frontend, with the
backend half implemented for exactly one command.

**Deviations are as valuable as adherence.** Do not soften them; they become
`violating` cells that drive the apply waves. A path with an empty Deviations
section had better have looked.

**Prefer the primitive that exists.** Where the repo already has a good answer
that nobody uses (`usePolling`, `FormField`, `DecisionRow`, `lazyRetry`,
`run_lanes`), the path's job is to route people to it — not to invent a new
one. Where the primitive is genuinely inadequate, that belongs in Gaps.

**Convergence is a free portability oracle — use it.** The portability test
found five mechanics **independently reinvented** in the sibling repo with no
shared document between them: a staggered-reveal hook matching ours down to
the docstring, the `useXColumns()` sibling-file convention, the exact
three-way loading branch, the columns-array primitive, and the
`loading && items.length === 0` guard. That is the strongest evidence a
prescription is universal rather than local taste. **A clause another codebase
reinvented is physics; a clause with no trace anywhere else should be
suspected of being local calibration.** When a path's prescription cannot be
found rediscovered anywhere, mark it as a house convention rather than
doctrine.

**Two passes.** The strongest probe ran a second sweep on its own and found a
shared-layer root cause that reframed the whole document. Compose, then
re-read against the corpus asking "what is upstream of these deviations?"

## Output

Markdown at `docs/concepts/golden-paths/<slug>.md`, headed by the leaf's
topic path, the date, and the sweep size. Sections in the order above.
Deviations and Gaps carry the counts that make them auditable.
