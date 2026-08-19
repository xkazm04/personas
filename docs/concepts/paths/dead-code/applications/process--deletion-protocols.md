---
layer: application
subject: dead-code
technique: deletion-protocols
stack: process
---

# Two deletions that followed the protocol — and left the record to prove it

The repo holds two exemplary deletions, one per half of the protocol: a 29-file
island removed with an instrument-established boundary and full downstream
attribution, and a security-shaped gate removed only after its inertness was
proven structurally and its callers checked. Both left the record at the site.

## The island: `src/features/teams/sub_canvas/` — 29 files, 3,200 lines (commit `78e9bff68`, 2026-08-17)

The commit message is a protocol transcript. Stage 1, boundary by instrument
("established by `scripts/analysis/orphan-modules.mjs`, not by name"):

```
delete seed                                   : 29
still reachable from a live entry             :  1  CanvasDragContext.tsx
newly unreachable BECAUSE of the deletion     :  0  (empty transitive closure)
tests referencing the removed set             :  0
```

The three sets the technique demands, each with its number. The one
still-reachable file is where a name-based deletion would have broken the build:
`CanvasDragProvider` wrapped the entire `PersonasPage` tree. Rather than keep it,
the author checked its consumers — `useCanvasDragRef` had **zero callers in 4,829
files**, a context provider with no consumer — and removed it too, naming the
re-pointing edit precisely ("import + two JSX lines + the reindent they forced" —
the only source edit outside the deleted tree). The empty transitive closure was
stated as evidence the boundary was right, not assumed.

Stage 3, one island per unit: the diff is the 29 files, `PersonasPage.tsx`, the
census baselines, and one docs page. Nothing else rode along.

Stage 4, downstream attribution: "Census: 11 rules ratcheted down, every drop
attributable to the deleted files (10 `title=`, 2 `animate-spin`, 3
document-level outside-click listeners, verified against `git show HEAD:<file>`)."
And the negative control the technique asks for: "`unpreventable-wheel-zoom` did
NOT move: its 3 canvas sites are TeamGraphPreview/Gallery2D/TimelinePanel, none in
this tree." A drop that *should not* have happened, confirmed not to have.

What was deliberately not deleted, named: `engine/src/team_handoff.rs` and
`db/src/repos/resources/teams.rs` — "55 of the 70 team edges are still compiled
into live chain triggers; `create_connection` is still reachable from
`useAutoTeam.ts:169`. The canvas is dead, the graph it was built for is not." And
the dependency-retention finding priced honestly: `@xyflow/react` importers fell
from 11 to 3, "the dependency stays."

Verification line: `npx tsc --noEmit 0 · npm run lint 0 · npm run census 0 ·
check-corpus-integrity 0`. Documented downstream at #w7-canvas-graph, whose
composer had to substitute evidence because the brief still named the deleted
tree — the record made that substitution a lookup instead of an archaeology.

## The inert gate: `check_template_integrity` (2026-08-09)

The stricter half of the protocol. `src-tauri/src/commands/design/template_adopt.rs:34-72`
is the tombstone, and it reads in the technique's order:

1. **Inertness proven structurally.** The checksum manifest is keyed by relative
   file path and hashes the whole template file; every real caller passed a bare
   label ("Dev Clone") and payload-only `design_result` JSON — "so
   `is_known_template` was false for 100% of adoptions — and normalising just the
   KEY would not have helped, because the hashed CONTENT is a different document
   from the one the manifest was generated over." The lookup could never bind, for
   two independent reasons.
2. **Callers verified.** "Consequently the 'known but tampered → reject' branch
   was unreachable, and the release build only `tracing::warn!`ed and allowed."
   Nothing branched on the verdict. The comment also records the earlier revision
   that *did* branch — it hard-rejected on "unknown", "which bricked Presets + Dev
   Clone on shipped binaries while passing in dev, where that branch is compiled
   out" — a gate whose behavior differed by build profile.
3. **Removed, with the autopsy at the site.** "A control that looks like security
   and is inert is worse than none, because the docs told the reader it was
   protecting them. It has been removed rather than left as decoration." The
   comment then names where enforcement actually lives (catalog-load checksum
   verification in `templateCatalog.ts`), what survives as a detector-not-gate
   (`verify_template_integrity_batch`, whose caller only logs), and the
   precondition for re-adding a per-adoption check (a payload-keyed second
   manifest from the same generator — "NOT a drop-in").

The companion doc (`docs/features/templates/06-integrity-and-security.md`) carries
the two-row table of what actually gates. A future reader who wants the check back
has to refute the autopsy first.

## Where the protocol is not yet followed

- The 354 non-test orphans and 21 never-invoked commands from the roster are
  candidates nobody has run through stage 1. The `--delete` simulation exists;
  it has been used once.
- `purge-dead-keys.mjs --apply` deletes 118 keys × 14 locales in one operation
  and requires a follow-up `split-locales.mjs` the script names but does not run —
  a two-step act whose second step is easy to forget, with no post-purge assertion
  that the section-locale tree matches the catalogs.
- No deletion here has yet stated the *tripwire* alternative for its uncertain
  members; both exemplars had none, which is why they could be decisive.
