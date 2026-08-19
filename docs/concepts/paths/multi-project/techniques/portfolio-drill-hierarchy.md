---
layer: technique
subject: multi-project
technique: portfolio-drill-hierarchy
status: forged
laws: [derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Portfolio drill hierarchy

A portfolio surface fails in one of two directions: it shows too little and
becomes a list of names nobody consults, or it shows everything and becomes a
wall of numbers nobody can rank. The cure is structural — a drill hierarchy
where **each level answers exactly one question, at a density chosen for that
question, over data fetched for that level alone.**

## The three levels and their questions

- **Level 1 — the wall.** All N projects at once. Its question: **"which
  project needs me?"** Per project it may spend a card's worth of signal:
  identity (name, mark), liveness (is anything happening), a pulse fragment
  (the most recent notable event), one or two headline scores, and an
  attention flag when something crossed a threshold. The wall is a triage
  instrument; every element on it must serve ranking or noticing, and any
  element that serves "completeness" belongs a level down.
- **Level 2 — the matrix.** One project, all managed dimensions. Its
  question: **"what shape is this project in?"** The natural form is a grid
  of per-dimension cells — each cell showing the dimension's verdict, its
  trend, and whether it is measured at all — dense enough that the whole
  project is judged in one screen, uniform enough that cells compare across
  dimensions at a glance.
- **Level 3 — the detail.** One dimension of one project, full depth. Its
  question: **"what exactly, and what next?"** Evidence, history, the
  concrete gap list, the action that would move it. This is the only level
  entitled to raw records.

Two levels suffice for small portfolios (wall → detail); the matrix earns its
place as soon as projects carry more dimensions than a wall card can hold,
which in practice is immediately. Deep portfolios grow more levels below
(a dimension's own sub-matrix, a record console) — fine, as long as each
added level states its question and keeps its budget; a drill with levels
nobody can name is navigation, not hierarchy.

The wall itself often earns **two presentations of the same population at
the same budget**: a *cover* view (one synthesized card per project — the
triage face) and a *comparison* view (the projects × dimensions matrix that
[cross-project-comparison](cross-project-comparison.md) specifies — the
analysis face). These are one level with two lenses, not two levels: same
data, same summary rows, switchable in place, ideally with each project's
card visibly becoming its column so the operator never loses the mapping
between the two.

## The density budget is a fetch budget

The visible discipline — how much each level *shows* — is downstream of the
real one: how much each level *reads*. The wall's cost must grow as
N × (a handful of pre-digested fields), never as N × depth. The defect this
forbids is familiar everywhere portfolios exist: the wall that fans out to
each member's full record "because the data was right there," is fast at
five projects, tolerable at fifteen, and unusable at forty — slowing down in
exact proportion to the portfolio's success. Concretely:

- The wall reads a **summary row per project** — a rollup maintained by
  ingestion and scoring, not assembled at view time from raw member data.
- Rollups are stored derivations, so each one names how it is recomputed
  and what triggers it
  ([derivation names recomputation](../../_laws.md#derivation-names-recomputation));
  a wall over rollups nobody refreshes is a museum, and the difference
  between the two is the named trigger.
- Every rolled-up number carries its predicate — what was counted, over
  what window, measured when
  ([count carries its predicate](../../_laws.md#count-carries-predicate)) —
  surfaced at latest on hover, because a wall of unlabelled scalars trains
  operators to invent the predicates themselves.

## Drilling preserves context

The levels are one instrument, not three pages that happen to link. Moving
down carries the *why* — landing on the matrix from an attention flag should
arrive with the flagged dimension emphasized, not reset to a default view.
Moving up returns to the wall as it was: same ordering, same filters, same
scroll. And lateral movement matters more than designers expect: at the
matrix and detail levels, the operator's next question is very often "and
how does the *next* project look on this same screen?" — a sibling switcher
at the current level (advance to the next project, hold the view) turns a
portfolio review from N separate visits into one sweep. The breadcrumb is
the cheap, load-bearing implementation of all three: it names where you are,
returns you exactly, and hosts the sibling switch.

## Level parity with reality

Each level must be honest about staleness and absence, because aggregation
launders both:

- A rollup computed from stale inputs must say so; the wall rendering a
  week-old score with today's confidence is worse than rendering "unscored."
- A dimension never measured is **absent**, not zero, at every level —
  the matrix cell says "unmeasured," and the wall's headline composite
  excludes rather than zero-fills it (the
  [unmeasured-honesty](../../scoring-rubrics/techniques/unmeasured-honesty.md)
  discipline, applied to display).
- An unwatched project — one whose signal feed is broken — must look
  *broken* on the wall, not calm (see
  [passive-signal-ingestion](passive-signal-ingestion.md)).

The wall is the portfolio's face; whatever it launders, the operator
believes.
