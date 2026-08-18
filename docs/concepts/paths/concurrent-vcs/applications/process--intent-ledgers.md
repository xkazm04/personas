---
layer: application
subject: concurrent-vcs
technique: intent-ledgers
stack: process
---

# Intent ledger — `.claude/active-runs.md`, its design, and its measured decay

The repo's intent ledger is `.claude/active-runs.md`: a single git-tracked
file with `## Active` and `## Recently completed` sections that any session
materially editing the tree touches twice. The design rationale — including a
written rejected-alternatives section (branching, daemon, lock files,
rebase-on-merge) and five explicit reconsideration triggers — is
`docs/architecture/cli-coordination.md`.

## The ritual as specified

- **Phase 0 (start):** read `## Active`; an entry conflicts when it
  path-overlaps your scope AND is `started`-status AND is **under 2 hours
  old** (the staleness rule, `cli-coordination.md:123`; older entries are
  "presumed abandoned", `:129`). Then append your own entry: slug, date,
  `Status: started`, a `Paths:` line at meaningful granularity.
- **Phase 11/13 (end):** move the entry to the top of `## Recently completed`
  with the landed SHA, or `aborted (<reason>)` / `handoff: <path>`.

Adoption, measured 2026-08-17 (`parallel-session-coordination.md` §12.2):
**16 of 35 skills carry both rituals**; 3 more make it correctly conditional
for foreign repos; the 13 silent ones are the *newer autonomous* skills
(`/scan-sweep`, `/tiger`, `/i18n-translate`, `/mvp`, …) — adoption never
decayed, it was never extended past 2026-05-09.

## The decay, measured — every failure mode the technique warns about

The same study's deviations D2–D5 and D10 are the technique's cautionary
tales with numbers attached:

- **Vacuous staleness (D2):** 118 entries under `## Active`, newest 4 days
  old — so the 2-hour freshness conjunct is false for all of them and the
  conflict check returns "no live conflict" for every path in the repo
  without consulting anything. 29 of the 39 live-section entries declare
  themselves complete and were never moved.
- **Structural anchor ambiguity (D4):** the file contains **two**
  `## Active` headings (`:3`, `:1167`) and two `## Recently completed`
  headings, so an Edit anchored on the documented append point fails the
  unique-old-string rule *permanently* — and the file's own Conventions
  prescribe "retry", which cannot succeed.
- **Advisory means skippable (D10):** the golden-path campaign itself ran
  116 commits / 352 files across waves of five concurrent composers with
  **zero ledger entries** — and resolved its two collision losses by giving
  each writer a private artifact, not by using the ledger.
- **The escape hatch was predicted in writing (D5):**
  `cli-coordination.md:231` — "one entry per file under
  `.claude/active-runs/<id>.md`" — the isolate-then-reconcile shape,
  reinvented twice elsewhere (private census registries per composer,
  unique scratchpad filenames per agent) without citing it.

## What the ledger is still for

`parallel-session-coordination.md` §8 G2 states the boundary this
Application's technique inherits: worktrees, private indexes and readbacks
protect the *tree*; only the ledger protects against two sessions
independently doing the *same work* (the 2026-05-09 `/research`
near-duplicate). Isolation makes duplication *more* likely, not less — a
complete deployment needs both layers, and this repo currently has a strong
version of one and a decayed version of the other.
