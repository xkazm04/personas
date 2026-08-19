# v3 Full-Corpus Transplant Test — shared agent kit (Phase 1, READ-ONLY)

You are one shard of a full-coverage portability field test. The Personas
golden-path knowledge graph (105 subjects · 624 techniques · 9 cross-cutting
laws) is applied as a lens to a sibling repo. This IS the corpus's own **live
transplant test** (GRAPH.md §5) — the step that promotes a subject to
`transplant-tested`. **Phase 1 is READ-ONLY: scan only. Make NO edits, NO
commits, do NOT write into any repo (neither the sibling nor personas).** Your
final text is the deliverable — a structured report.

## Load the rubric (personas repo — READ ONLY)

- `C:/Users/mkdol/dolla/personas/scripts/census/subject-index.json` — every
  subject → its `category`, `techniques:[{slug, laws[]}]`, `evidence[]`,
  `counter_evidence[]`, `deviations[]`, `applications[]`. **This gives you your
  scope without prose-reading.** Look up each subject in YOUR bundle here.
- `C:/Users/mkdol/dolla/personas/scripts/census/law-index.json` — the 9 laws,
  each with its `statement` + the techniques that cite it. The compact physics core.
- `C:/Users/mkdol/dolla/personas/docs/concepts/paths/_laws.md` — full law text.
- For each subject you score, read its technique bodies under
  `C:/Users/mkdol/dolla/personas/docs/concepts/paths/<subject>/techniques/*.md`.
  **Each technique body states ONE governing rule** (usually under a `## The
  governing rule` / first bold sentence) and cites its laws in frontmatter. That
  sentence IS your rubric for that technique — no interpretation needed. Read the
  subject's `<subject>.md` opener for the definitional boundary (what counts as
  this subject) when a manifestation is ambiguous.

## Protocol — per subject in your bundle, per technique

1. **Locate the target repo's manifestation** (its *application* of the technique).
   If the whole subsystem is absent in this repo → `n/a-absent` for the subject,
   move on FAST (this is a valid, expected result — NEVER score an absent
   subsystem as a violation; a backend has no modal-stack, a frontend has no
   job-queue). Spend your depth on subjects that actually manifest.
2. **Score each present technique** against its **governing rule** AND each **law
   it cites** → one verdict:
   - `holds` — satisfied, independently (default: the technique body is stack-free
     by the purity gate, so a match is independent BY CONSTRUCTION).
   - `holds(self)` — **politicas only** — satisfied because politicas literally
     PORTS Personas' own artifact (its census engine / ported rules; see
     `PROVENANCE.json`). Discounted, not independent evidence. Any other repo:
     never use this.
   - `partial` — the rule holds on some axes, n/a or unmet on others (a
     half-present subsystem tears along technique boundaries — score the halves).
   - `violates` — the rule is broken. If it's a REAL latent bug, it's an APPLY
     finding (below).
   - `n/a-absent` — subsystem not present. `n/a-scope` — out of this repo's scope.
3. **Two implementations for any load-bearing count** (two greps / two rg
   queries). Report both; a disagreement is itself a finding.

## The 9 laws (b4 agents only — score once for the whole repo)

If your bundle is the "…+LAWS" bundle, additionally score each of the 9 laws
against the repo as a whole (verdict + `file:line` + one-line note), using the
`statement` in law-index.json. Every other bundle: you still cite laws per
technique, but you do NOT produce the standalone 9-law scorecard (b4 owns it, to
avoid duplication).

## APPLY findings (real latent bugs — REPORT, do not fix in Phase 1)

A `violates` that is a **real latent bug** (not a style gap): report it with
`file:line` + a one-line **failure scenario** (concrete input/state → wrong
output/crash) + a **FIX/DEFER** tag:
- **FIX** = high-confidence, safe, non-behaviour-changing, minimal surgical diff
  (a real bug w/ an obvious correct fix, a missing guard, a swallowed error that
  should reach a door, a dead symbol w/ zero consumers). Phase 2 will apply these.
- **DEFER** = changes what a live surface does, touches auth/crypto/secrets/
  payment/data-deletion, needs a schema migration, or you're less than confident.
  Note it; Phase 2 will NOT touch it.
Do NOT re-report pumper's 4 already-fixed issues (credential-injection,
provisioner desync, census 5xx-masking, NAICS double-count) — note "already
fixed" if re-encountered and move on.

## Enrichment (flow-back to the corpus — the "adoption" direction)

Anything the sibling does BETTER than the rubric, or a practice the corpus
lacks. Classify into exactly one bucket + name the frontmatter edge it adds:
- **new-law** — a cross-cutting invariant not among the 9 (rarest, highest value).
- **new-technique under `<subject>`** — a technique the subject's list lacks.
- **new/better-application** — the sibling's stack manifestation of an existing
  technique → an `applications/<stack>--<technique>.md`, or a `counter_evidence`
  witness. Give the specific practice + `file:line`.

## Return (final text — compact, structured, so the orchestrator aggregates)

1. **Bundle header** — repo, bundle name, subjects scanned / n/a-absent / deep vs
   shallow.
2. **Per-subject scorecard** — subject | overall verdict | 1-line note. For
   subjects scored deep, a technique sub-table (technique | verdict | evidence
   `file:line`-or-why-absent).
3. **(b4 only) 9-law scorecard** — law | verdict | `file:line` | note.
4. **APPLY findings** — table: id | file:line | failure scenario | FIX/DEFER.
   (May be zero — a clean bundle is a valid result.)
5. **Enrichment candidates** — bucket | practice | file:line | frontmatter edge.
6. **Coverage honesty** — which subjects deep / shallow / skipped and why. Two-impl
   counts where used, and any disagreement found.

Consistency across all shards is the point — three repos, comparable results.
