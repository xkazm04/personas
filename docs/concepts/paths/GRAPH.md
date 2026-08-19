# The knowledge graph — design contract (v2, session N+1)

**Status:** designed fresh 2026-08-18 per [`knowledge-hierarchy-plan.md`](../knowledge-hierarchy-plan.md) §5,
which made this document the session's first deliverable and explicitly freed it from the
old shapes. What it may not overrule — and does not — are the four layers, their §2
acceptance tests, and the gated boundary.

This file is the **machine contract**: the integrity checker
([`check-corpus-integrity.mjs`](../../../scripts/census/check-corpus-integrity.mjs))
enforces exactly what is specified here, section by section. If you change this contract,
change the checker in the same commit.

---

## 1. Node structure — one folder per subject

```
docs/concepts/paths/
├── GRAPH.md                      # this contract
├── _laws.md                      # cross-cutting laws (stable anchors, cited by Techniques)
├── corpus-map.json               # legacy corpus → subject mapping (upward links for the 247)
└── <subject-slug>/
    ├── <subject-slug>.md         # the GOLDEN PATH (layer 1)
    ├── techniques/
    │   └── <technique-slug>.md   # TECHNIQUES (layer 2)
    └── applications/
        └── <stack>--<technique-slug>.md   # new APPLICATIONS (layer 3)
```

Evaluated against the alternatives before adopting the plan's proposal:

- **Flat directory + frontmatter only** — rejected: discoverability dies at 40–80 subjects
  × ~5 techniques; the situation-spine's fate showed that a flat corpus needs a parallel
  index artifact, and parallel index artifacts drift (that is what the integrity checker
  was born cleaning up).
- **Nested under `golden-paths/`** — rejected: that directory is the legacy Application
  archive; co-locating two generations with different contracts in one tree makes the
  purity gate unenforceable by path.
- **Folder per subject (adopted)** — membership is expressed by *location* and confirmed
  by *frontmatter*; the checker cross-validates the two, so neither can drift alone.

**Legacy corpus:** the 247 documents stay at `docs/concepts/golden-paths/` untouched
(moving breaks ~4,000 links and 201 census `goldenPath` pointers). Their upward links
live in `corpus-map.json`, not in their bodies — mapping 247 files without editing them.
Backfill of the map is a Sessions-N+2 deliverable; the checker treats an unmapped legacy
file as *pending*, printed not failed, until the map declares coverage complete
(`"complete": true`).

## 2. Frontmatter contract (machine-checkable, both directions)

Every file under `paths/<subject>/` opens with YAML frontmatter. The checker fails any
file missing it, any layer/location mismatch, and any one-directional link.

**Golden Path** (`<subject>/<subject>.md`):

```yaml
---
layer: golden-path
subject: <subject-slug>            # must equal folder and filename
status: draft | forged | reconciled | transplant-tested
techniques:                        # downward links — must each exist on disk
  - pagination
  - sorting
evidence:                          # ≥1 required; repo paths, resolved by the checker.
  - src/features/shared/components/display/UnifiedTable.tsx   # canonical manifestation
counter_evidence: []               # optional, at most a few — the key counter-example
deviations: []                     # gaps registered in golden-path-deferred-fixes.md, by anchor
---
```

**Technique** (`<subject>/techniques/<technique>.md`):

```yaml
---
layer: technique
subject: <subject-slug>            # upward link — must equal the enclosing subject folder
technique: <technique-slug>        # must equal filename
status: draft | forged | reconciled | transplant-tested
laws: []                           # optional anchors into _laws.md, e.g. gate-sees-target
shared_with: []                    # other subjects that reference this technique (see §3)
---
```

**Application** (`<subject>/applications/<stack>--<technique>.md`):

```yaml
---
layer: application
subject: <subject-slug>
technique: <technique-slug>        # must name a technique that exists in ../techniques/
stack: react | rust | sql | node | process
---
```

Bidirectionality, checked: the Golden Path's `techniques:` list and the set of files in
`techniques/` must be identical; every Application's `technique:` must resolve; every
`shared_with:` and `laws:` entry must resolve. A link that resolves in only one
direction is a failure, not a warning.

## 3. Shared techniques — owned, never duplicated

Pagination appears under Table and under Feed. Decision: **a technique is owned by
exactly one subject** — the one where its canonical form lives — and other subjects
reference it by link. No shared-technique nodes floating outside the subject tree.

Rationale: shared nodes recreate the conditions of the v1 flattening — a node with no
single home has no single acceptance test, and the layer boundary was the invariant that
flattened last time precisely where ownership was ambiguous. The cost (a Feed author
follows one link to Table's pagination) is small; the checker keeps the reference alive
in both directions via `shared_with:` on the owning technique and a `techniques:` entry
suffixed with `@<owner-subject>` in the referencing Golden Path (e.g.
`pagination@table`), which the checker resolves to the owning file.

## 4. Cross-cutting laws

The nine v1 convergences (one authority per vocabulary; a gate must see its target;
failure spelled differently from empty success; identity survives reordering/reuse/
restart; a stored derivation names its recomputation; one validation door + enumerate
writers; a count carries its predicate; deletion is not repair; everything created names
its reaper) live in [`_laws.md`](./_laws.md) with stable anchors. **Laws are not
subjects and get no folders.** Techniques cite them via `laws:` frontmatter. The
doctrine donates its transferable sections to these anchors in the closing pass
(plan §7); until then `_laws.md` holds the anchor skeleton plus one-paragraph
statements so `laws:` references resolve from day one.

## 5. Layer purity — the transplant test, statically approximated

Golden Path and Technique **bodies** must survive transplant to a sibling repo
unchanged: zero repo identifiers, file paths, or framework names. The checker enforces
the statically checkable core:

- path-shaped strings (`src/`, `src-tauri/`, `scripts/`, `docs/`, extensions like
  `.tsx` `.rs` `.mjs`) in a golden-path or technique body → **fail**;
- a denylist of stack/product identifiers (React, Tauri, Rust, TypeScript, Zustand,
  Tailwind, Vite, SQLite, Personas, UnifiedTable, …) in those bodies → **fail**;
- frontmatter is exempt (`evidence:` is exactly where repo paths belong);
- Application bodies are exempt (citing real code is their job).

The denylist is a floor, not the test. The real gate — hand the document to an agent in
a sibling repo (`brainiac`, `vibeman`, `ascent`) with no Personas access; it must locate
the subject and sketch an Application without questions — cannot be run statically, and
the checker **says so in its output** rather than pretending green covers it. Passing
the live transplant is what promotes `status:` to `transplant-tested`.

## 6. What the checker enforces (summary table)

| # | Check | Failure mode it kills |
|---|---|---|
| 1 | frontmatter present, layer matches location, slugs match filenames | membership by vibes |
| 2 | bidirectional links (techniques↔golden path, application→technique, shared_with, laws) | one-directional drift |
| 3 | every `evidence:` path exists on disk; ≥1 per golden path | standards with no witness |
| 4 | body purity for golden-path + technique layers (§5) | Application detail leaking upward — the v1 collapse |
| 5 | `corpus-map.json` entries resolve both ways (file exists, subject exists) | transplant bookkeeping rot |
| 6 | every markdown link under `paths/` resolves | the portability-test class of dead link |

Plus the standing rule inherited from the corpus checker: **the instrument is asserted
before the result** — zero subjects found, zero links checked, or an unreadable map are
FATAL (exit 2), never a green report.

## 7. Slugs and naming

Kebab-case, noun phrases, no stack qualifiers in subject slugs (`table`, not
`react-table`; the stack lives in the Application filename). Technique slugs name the
concern (`pagination`, `sorting`, `loading-states`, `client-server-split`). Application
filenames are `<stack>--<technique>.md` so a directory listing reads as a matrix.
