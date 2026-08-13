# The situation spine — from a judging library to a building library

> Supersedes the concern-first taxonomy as the library's PRIMARY structure.
> Machine-readable tree: [`situation-spine.json`](./situation-spine.json).
> Schema it runs on: [`pattern-fabric.md`](./pattern-fabric.md) §v2 (unchanged).

## What went wrong

The library was harvested against the question *"what durable practices does
this code contain?"* — a question about code. So it returned **properties**:
adjectives a reviewer would use. Atomic. Bounded. Honest. What a developer
actually arrives with is *"how do we do this here?"* — which needs
**procedures**: recipes, with named primitives, in order. We built a library
that judges code. Nobody was ever going to consult it to write any.

Four measurements from the 2026-08-12 audit make the failure concrete:

1. **The consult door has been called once. Ever.** One row in
   `workspace_consult_log`: `"adding a database table"`, which matched two
   playbooks. The retrieval path works; there is nothing on the other side
   worth arriving for.
2. **The taxonomy shatters procedures.** The cold-load doctrine — the single
   most load-bearing UI standard in this codebase, written out in
   `docs/design/overview-loading.md` and enforced app-wide — survives in the
   library as six correct macro items filed across **four different branches**
   (`frontend/motion`, `frontend/motion/loading`, `frontend/components`,
   `frontend/data-fetching`). To reconstruct one readable standard, a
   developer must find four items in four places and reassemble them. Filing
   by concern takes a coherent procedure and scatters its parts by whichever
   property each part happens to be about.
3. **Whole recurring situations are unrepresented.** `modal`: 4 items, 0 at
   macro altitude. `dropdown`: 1. `pagination`: 1. `empty state`: 1. **BYOM:
   zero.** Meanwhile `frontend` holds 220 items behind 9 top-of-tree
   directions, exactly one of which is about components at all.
4. **The situation layer existed but was inert.** 38 playbooks carry excellent
   situation names — *Build a list or table surface*, *Call an LLM*,
   *Integrate a new connector* — but each is a **bookmark list averaging 7.3
   pattern pointers**. A playbook says "read these seven items". It never says
   "here is how we do this".

## The change

**The situation becomes the primary spine, and every situation node holds one
golden path.** Concerns (concurrency, errors, security) survive as attributes
of a practice, not as its address.

A **golden path** is the canonical answer for one recurring situation. It is
prescriptive, it names real primitives, and it is stack-specific at its
manifestation layer while its head stays language-free so a sibling project in
another stack can adopt the same doctrine. Its body carries eight sections:

| Section | Answers |
| --- | --- |
| **Trigger** | how do I know I'm in this situation |
| **The one way** | the prescription, one paragraph |
| **Mandated primitives** | which components / doors / crates you must use |
| **Steps** | the construction order |
| **Anti-patterns** | the wrong moves, and why |
| **Evidence** | exemplary call sites, `path:line` |
| **Deviations** | where this repo currently breaks it — the fix backlog |
| **Gaps** | what the primitive genuinely cannot do |

**No schema change is required.** A golden path is a `principle`-layer row
whose `topic` is the three-segment situation path and whose `detail_md`
carries those sections; per-stack recipes are `manifestation` rows beneath it;
call sites are `workspace_knowledge_evidence` rows; and **deviations are
already modelled** — a `violating` cell in `workspace_practice_context_state`,
which is exactly what the apply campaign consumes. The scan's output becomes
the campaign's input with nothing in between.

## The tree

Three levels, **noun-labelled**: `domain / subdomain / situation`. The
situation leaf IS the golden path — its topic path is its address. Closed
vocabulary; an open one fragmented this library twice already.

Built **bottom-up from the code**, not from the playbooks. Ten Opus scouts
(six client, four server) surveyed the repo for recurring situations and
returned **527 candidates** ([`discovery/`](./discovery/)); semantic fusion
collapsed those to **260 leaves** across **8 domains / 46 subdomains**, every
subdomain holding 4–8 leaves. All 496 post-dedup candidate names are
accounted for in exactly one leaf; none unplaced.

| Domain | Leaves / subdomains |
| --- | --- |
| Backend Command & Runtime | 54 / 10 |
| UI System & Primitives | 44 / 8 |
| Product Surfaces | 33 / 5 |
| Data & Persistence | 31 / 5 |
| Client State & Data Flow | 26 / 5 |
| Platform, Build & Quality | 25 / 4 |
| Integrations & Credentials | 24 / 4 |
| AI & Agent Runtime | 23 / 5 |

**153 of the 260 are `twoSided`** — a scout reported a counterpart across the
IPC boundary — so their golden path must document both halves or it documents
half a path. Only **21** were `fusedAcrossSides` (both halves independently
discovered and merged). The gap is a known limitation of wave 1, not a
finding: the roster handed to the clustering pass dropped the scouts'
`crossCutting` flag, so cross-boundary pairs could only fuse when both sides
happened to choose similar names. The flag has been re-attached
mechanically; **pairing the remaining halves is an open seam pass.**

The earlier 56-topic tree in this document was a top-down hypothesis derived
from the 38 playbooks. Discovery superseded it: it was roughly a fifth of the
real resolution, and it inherited the playbooks' backend skew.

## Playbooks are retired

The concept leaves the UI entirely. Its content is absorbed: each playbook
becomes (or seeds) a topic node, its curated members become candidates for
that node's manifestations, and its `triggers` array becomes the golden path's
Trigger section — which is also what the consult door matches on, so CLI
retrieval keeps working through the migration.

## Sequence

1. **Spine** — this document + the JSON tree. *Done.*
2. **Golden paths, hand-authored** — the first three (tables, modals, page
   loading) written from real call sites, to prove the object before spending
   fleet tokens on it. Doubles as a dry run of the scan contract.
3. **Scan orchestration** — a new harvest contract that asks a *construction*
   question per situation and returns a dossier (proposed golden path +
   deviation list), not an item list. Design handshake with the operator
   before dispatch.
4. **Attach the 1,048** — every existing item is machine-mapped onto a golden
   path as a manifestation or evidence, kept as a cross-cutting invariant, or
   retired. Operator-approved in bulk, not item-by-item.
5. **UI** — three-level graph, topic ledger, re-prototyped detail modal.
6. **Re-point** consult / apply / verify at golden paths and their deviations.

## Risks named now

- **A stale golden path teaches confidently wrong things** — worse than none.
  Each needs an adoption decision, a verification query, and a `verified_at`
  the verify lane refreshes.
- **Node inflation** — 56 must not become 400. New nodes are a taxonomy
  change, not a harvest side effect.
- **A tree without golden paths is the old library re-parented.** The
  procedures are the work; the tree is only how you find them.
