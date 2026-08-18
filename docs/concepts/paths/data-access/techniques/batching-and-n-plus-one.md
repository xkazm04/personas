---
layer: technique
subject: data-access
technique: batching-and-n-plus-one
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Batching and N+1

The N+1 defect is one query for a list of N parents, then one more query per
parent for its details — N+1 round trips to answer one question. It is the
most common data-access performance defect in existence, and the reason is
structural, not carelessness: **the code that loops is correct, readable,
and locally optimal.** Each iteration calls a well-named single-record
operation; nothing at any single call site is wrong. The defect exists only
in aggregate, which is exactly where nobody is looking.

## The surface causes it before the caller commits it

Trace any N+1 backward and you find a repository surface that offered
`fetch one by id` and nothing else. The caller had a list of ids and did
the only thing the API made possible. This reframes the responsibility:
**a repository that exposes single-record reads for data that is ever
displayed in lists has designed the N+1 in**; the loop is just where it
becomes visible.

The countermeasure is to make the set-shaped operation exist *first*:

- **Membership reads**: for any `fetch by id` on the surface, ask whether a
  caller will ever hold many ids — and if so, ship `fetch all by ids`
  returning a keyed map, in the same change. A map, not a list: the caller's
  next move is always association back to the parents, order from the store
  is an accident, and some ids legitimately match nothing — a map makes
  "missing" explicit per key instead of leaving the caller to zip two lists
  of different lengths.
- **Child-of-parent reads**: alongside `children of parent`, ship `children
  of parents`, grouped by parent key on the way out. Grouping in the layer,
  once, beats every caller re-implementing the bucketing loop.
- **Aggregate summaries**: when the callers' loop exists only to compute a
  count or latest-of per parent, the honest operation is the grouped
  aggregate query — one round trip, and the store does what stores are for.

## Building the membership list safely

The `IN`-list is where batching meets query construction, and it is the one
place even disciplined codebases interpolate — because the placeholder count
varies with the list length. The rules:

- **Placeholders are generated, values are bound.** The construction
  machinery emits one placeholder per element and binds each value; the
  list's *shape* is dynamic, its *contents* never enter the query text.
  This belongs in one shared helper, not at call sites.
- **Empty is answered, not sent.** An empty membership list is a decision
  point, not a degenerate case to pass through: an empty `IN ()` is a
  syntax error on some engines and a surprise on the rest. Two honest
  spellings exist — return early without touching the store (natural when
  the membership test is the whole query), or emit an always-false
  predicate in its place (natural when the test is one conjunct among
  several and the query must still compose). Either way the decision
  lives in the helper, so no call site can forget it.
- **Chunk under the engine's parameter ceiling.** Every engine caps bound
  parameters per statement; a batch endpoint that works in tests and dies
  at four thousand ids in production hit that ceiling. The helper chunks
  transparently, merges result maps across chunks — and for *writes*, the
  chunks run inside one transaction so the batch stays one fact.

## Join versus fetch-and-stitch

Set-shaped access has two implementations, and neither dominates:

- **One joined query** wins when the child adds few columns and the
  relationship is narrow. Its cost is duplication: a parent with thirty
  children arrives thirty times, and a wide parent row times a deep join
  multiplies transferred bytes fast.
- **Two queries and an in-memory stitch** — fetch parents, collect ids,
  batch-fetch children, associate by key — wins when rows are wide,
  children are many, or the two halves have different cache lives. Its
  cost is two round trips and the stitch code (which the repository owns,
  once).

The decision is measurable, not stylistic: rows transferred and bytes moved
under each shape, at the real data's fan-out. What is *not* acceptable is
the third option that emerges by default — the loop.

## Detection: count queries, not milliseconds

N+1 hides from latency-based observation by construction: in development
the dataset is ten rows and the loop costs nothing; the defect scales with
production data you do not have on your laptop. Latency is a proxy, and the
proxy diverges from the target exactly where the defect lives
([gate-sees-target](../../_laws.md#gate-sees-target)). The observable that
sees the defect itself is the **query count per operation** — which is flat
for healthy code and linear in N for the defect, at any dataset size,
including tiny test fixtures.

Two places to wire the counter:

- **In tests**: the layer exposes a statement counter (a test hook counting
  executions); a test renders the list operation over a fixture of, say,
  twenty parents and asserts the query count is a small constant. Assert
  the *predicate*, not a magic number — "constant in N, measured at two
  fixture sizes" is the honest form of the assertion
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)); a
  bare `assert count == 3` rots into ritual the first time someone bumps
  it to 4 to make a build pass.
- **In production telemetry**: queries-per-request as a distribution. The
  linear-in-N endpoints appear at the top the moment real data arrives,
  long before they appear in latency percentiles.

## Batching has a boundary too

Two cautions keep the technique from over-rotating:

- **Do not pre-batch speculatively.** Fetching children for a thousand
  parents because "the caller might need them" replaces N+1 with 1 query
  that moves a thousand times the data. Set-shaped endpoints answer the
  access patterns callers *have*, driven by the same evidence (the query
  counter) that found the loops.
- **Unbounded batches are the transaction-scope defect in a new costume.**
  `fetch all by ids` with a hundred thousand ids is a batch job, not a
  query; the chunking helper keeps statements legal, but the *operation*
  above it needs pagination or a job-shaped design. A batch endpoint's
  contract states what size it is designed for, and something enforces it.
