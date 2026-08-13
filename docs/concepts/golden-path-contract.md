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

### Why section 9 exists

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

**Two passes.** The strongest probe ran a second sweep on its own and found a
shared-layer root cause that reframed the whole document. Compose, then
re-read against the corpus asking "what is upstream of these deviations?"

## Output

Markdown at `docs/concepts/golden-paths/<slug>.md`, headed by the leaf's
topic path, the date, and the sweep size. Sections in the order above.
Deviations and Gaps carry the counts that make them auditable.
