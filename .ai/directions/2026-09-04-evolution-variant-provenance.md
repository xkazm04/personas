---
subject: software-engineering/agent-memory
project: personas
raised_by: intake arxiv-27454 (paper, skill-evolution ablation)
source: librarian/sources/2026-09-04-wikiskill.md
stage: `src-tauri/db/src/migrations/schema.rs:1573` (evolution_cycles) and the
  breeding/evaluating loop in `src-tauri/src/engine/evolution.rs` that fills it
size: 3 files / ~120 lines / M
status: coverage-task
kind: coverage
branch: intake/evolution-variant-provenance
---

# The evolution loop keeps a count, a score and a reason — not the diff

## What the tree does today

`evolution_cycles` (`schema.rs:1573-1587`) is the record of one evolution cycle.
It stores `variants_tested INTEGER`, `winner_fitness`, `incumbent_fitness`,
`promoted`, and a prose `summary`. `complete_cycle`
(`src-tauri/db/src/repos/lab/evolution.rs:294-349`) writes all five in one
transaction, correctly and atomically.

There is no variant content anywhere. No `evolution_cycle_variants` table
exists, and no column on any table holds a tested candidate's prompt for this
loop. So a cycle that bred five variants and promoted none records that five
*somethings* were tried, that the best of them scored 0.61 against an incumbent
0.66, and a sentence about why.

Two consequences follow, and neither is visible from inside the loop:

- **The breeder cannot avoid re-proposing a rejected candidate**, because
  nothing tells it what was already tried. The mutation is generated fresh from
  the genome each cycle, and `should_evolve`
  (`engine/evolution.rs:738-763`) re-fires on execution count alone.
- **`variants_tested` is a count with no predicate.** "5" is five of nothing in
  particular; it cannot be joined to a score, an outcome, or a candidate.

## What the tree already knows

This is not a gap the project disagrees with — it is a gap between two of its own
surfaces. The newer, Director-commissioned path (`LabAbExperiment`,
`core/src/models/lab.rs:271-290`) **does** carry `variant_prompt` and
`variant_source` alongside a `provenance_json` snapshot, with a documented status
vocabulary. Its own doc comment says every row "carries its provenance ... so the
experiment is auditable back to the observation that motivated it."

So the surface that keeps the diff does not run yet (`running`/`concluded` are
marked "reserved for the deferred canary-fitness loop"), and the surface that
runs and rejects keeps no diff. Closing that is coverage of an existing context,
not a new capability.

## Step 1 — DONE on this branch

`evolution_cycle_variants`, added to `SCHEMA` beside `evolution_cycles`
(`schema.rs`): the candidate `prompt`, its `variant_source`, its `fitness`, and
an `outcome` from `('winner','rejected','error')` as a stored value rather than
one inferred from whether the incumbent changed. `REFERENCES evolution_cycles(id)
ON DELETE CASCADE` inline, so the FK-hygiene retrofit (`fk_hygiene.rs`) does not
need to reach it. `UNIQUE(cycle_id, variant_index)`.

**There is deliberately no `reason` column.** A reason written at rejection time
is a hypothesis authored at the moment of least information, and it hardens into
a fact later cycles reason from. The prose stays in `evolution_cycles.summary`,
where it already is; this table holds only the two things that are observations —
the candidate and its number.

**Gate reached: the DDL, paired.** Both schema arms applied to a scratch database
with `foreign_keys ON`, the same three candidates offered to each, for one
completed cycle with `promoted = 0` and `variants_tested = 3`:

| arm | schema applies | candidate texts recoverable |
| --- | --- | --- |
| A (HEAD) | yes | **0 of 3** |
| B (this branch) | yes | **3 of 3** |

with the constraints checked rather than assumed: the `outcome` CHECK rejects an
unknown value, the FK rejects an orphan, `UNIQUE` rejects a duplicate index, and
`ON DELETE CASCADE` reaps the children. Arm A applying is the assertion that
makes its 0 a real absence rather than an extraction bug — an earlier run of this
gate returned 0 on *both* arms because the `{{TRIGGER_TYPE_CHECK}}` marker was
substituted wrongly, which is a tie that means nothing ran.

**Gate NOT reached: `cargo check` / `cargo test`.** This branch is a worktree and
the change is inside a `const &str`, so nothing here compiles Rust. The DDL is
verified; the Rust is not. Run `cargo check -p personas-db` before merging.

## Step 2 — the repo function (not taken)

`repos/lab/evolution.rs`: `record_cycle_variants(pool, cycle_id, &[VariantRecord])`,
written inside `complete_cycle`'s existing transaction so a cycle cannot become
`completed` while its variants are missing — the same both-UPDATEs-must-land
reasoning that function's own comment already gives for the policy stats.

## Step 3 — the write path (not taken)

The breeding/evaluating loop in `engine/evolution.rs` currently discards its
candidates after scoring them. It hands them to step 2 instead. Read the loop
before sizing this: it is the only step that touches behaviour rather than
storage.

## Measurable

**Candidate texts recoverable per completed, not-promoted cycle**, as a fraction
of that cycle's `variants_tested`. Today 0/N by construction. After step 3, N/N.
The gate that will see it: a test that runs one cycle to completion with
`promoted = 0` and asserts the count matches `variants_tested`.

## Falsifier

If the breeder is stateless by design and re-derives an identical candidate set
every cycle regardless of history, then persisting the variants buys auditability
but not convergence, and the second consequence above is wrong. Check by running
two cycles against an unchanged genome and diffing their candidate sets — which
is itself only possible after step 3.
