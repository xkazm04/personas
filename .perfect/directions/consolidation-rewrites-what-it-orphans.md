---
slug: consolidation-rewrites-what-it-orphans
type: perfect/direction
context: "[[workspace-governance]]"
lens: robustness
status: shipped
size: M
proposed: 2026-08-06
accepted: 2026-08-06
shipped: 2026-08-06
commit: c02ef1bd9
---
## What & why

Merging two contexts orphans every reference to the one that disappeared. The consolidation
pass knows this for six kinds of anchored artifact and re-points all of them. It forgets the
seventh, which happens to be the one describing how contexts relate to each other — so the map
lost its entire topology layer in a single transaction and nothing noticed for two days.

## Evidence

- `context_consolidate.rs:399-473` — `apply()` re-points `dev_kpis` (`:432`), `dev_ideas`
  (`:433`), `dev_goals` (`:434`), `memory_nodes` (`:435`), `dev_use_cases` (`:436`) and
  `dev_use_case_contexts` (`:438`) to the survivor, then hard-deletes absorbed rows (`:446`).
  **`cross_refs` appears nowhere in the transaction** and is not even loaded into the `Ctx`
  working struct (`:102-113`).
- **Two ghost paths, not one.** Absorbed rows are deleted (`:446`) *and* survivors are renamed
  (`:412-427` via `unit_name()` `:284-298`), so a surviving row still orphans inbound
  references to its previous name.
- Damage on the shipped map: 449 dangling refs across 199 of 208 contexts, naming 310 distinct
  ghosts. Parsing the `[Consolidated …: absorbed …]` markers the pass itself writes
  (`:336-345`): **248 of 310 (80%) provably match an absorbed name.**
- The pass is deterministic and zero-LLM (`:12`), so this half is exactly fixable — unlike the
  ~62 residual hallucinated refs, which are a generator-prompt problem.
- **The invariant is untested.** `context_consolidate.rs` has 3 tests (`:479-529`) covering
  directory-signature derivation, name derivation and sibling absorption. None asserts anything
  about references to merged names.
- Precedent for the missing discipline is in the sibling file:
  `context_generation.rs:1795-1863` `prune_dangling_file_paths` runs after every scan, and its
  docstring (`:1792-1794`) states the contract outright — *"a published context map contains no
  reference to a path that isn't on disk."* Enforced for files, absent for refs. The one
  reference class validatable purely in memory is the unguarded one.

## Acceptance criteria

- [ ] `apply()` rewrites `cross_refs` inside the same transaction, covering **both** paths:
      absorbed-name → survivor-name, and old-survivor-name → new-survivor-name after rename.
- [ ] A ref that would become self-referential after remap is dropped, not written.
- [ ] Duplicates after remap are collapsed.
- [ ] A test asserting the invariant directly: **after any consolidation, no surviving context
      references a name that does not exist.** This is the assertion the suite never had.
- [ ] Repair for the existing 449: a command that resolves ghosts via the `[Consolidated]`
      markers. **Dry-run by default**, mirroring `consolidate_contexts`' own `dry_run`
      (`:232-236`, `:377-379`). It reports the plan; applying is a separate explicit act.
- [ ] The repair reports what it could NOT resolve (the ~62 hallucination residue) rather than
      silently leaving or deleting them.

## Risks / non-goals

**The backfill mutates data that has no history.** `dev_contexts` has no version column, no
soft-delete, no `absorbed_from`; consolidation hard-deletes and context scans are never recorded
in `dev_scans`. So a bad repair cannot be rolled back from within the app — hence dry-run by
default and no auto-apply. Do not add auto-repair to any scan hook.

Not a fix for the generator. The ~62 hallucinated refs need a write-site validator — that is
[[validate-what-the-model-asserts]].

## Build record

Shipped `c02ef1bd9`. Director verdict: **merge** — diff reviewed against every criterion.

`apply()` now rewrites `cross_refs` in-transaction across BOTH ghost paths (absorbed→survivor,
and old-name→new-name after a rename). Self-referential refs dropped, duplicates collapsed.

**The invariant the suite never had:** `consolidation_never_orphans_a_cross_ref` — DB-backed,
seeds a map whose refs all resolve (asserted as a precondition), runs the real
`consolidate_contexts`, then asserts every surviving ref names a surviving context. Plus
`renaming_a_survivor_rewrites_inbound_refs_to_its_old_name` for the second path. Tests across
these two files went 9 → 18.

**Dry-run against the real 208-context map — the direction's actual outcome:**

```
danglingBefore 449    ghostNames 310
rewritten      341    (76%)     selfDropped 152    deduped 39
contextsTouched 182
unresolved     108    across 62 names       ambiguous 0
```

341 of 449 resolved. The 108 remaining are the generator-hallucination residue — no
`[Consolidated]` marker explains those 62 names, so they are listed by name and **left
untouched rather than deleted**. Zero ambiguous ghosts (no name claimed by two survivors).

**Safety verified by the Director, not taken on the builder's report:**
`repair_cross_refs(pool, project, apply_changes)` is dry-run by default; the HTTP body marks
`apply` as `#[serde(default)]` → false; and a repo-wide grep confirms the only reachable
callers are the explicit command and route — it is in no scan hook. It also refuses to repoint
a ref away from a live context (that would be the repair inventing topology), and refuses to
guess when two survivors claim the same ghost.
