---
slug: the-rot-detector-cannot-see-rot
type: perfect/direction
context: "[[workspace-governance]]"
lens: robustness
status: accepted
size: M
proposed: 2026-08-06
accepted: 2026-08-06
shipped: 2026-08-07
commit: 4eee00e22 + 543006212
---
## What & why

This app ships a stale-documentation detector. It runs against this repo every six hours. In
the same 24 hours it was running, two sessions found documentation asserting the opposite of
the code — and the detector could not have caught either one, for two independent structural
reasons. It is a git-recency signal being consumed as a rot signal.

This is the same shape as [[ask-the-detector-we-already-built]], which was wave 3's best
direction: the capability exists, and the question it answers is not the question people think
it answers.

## Evidence

**It does run here.** `doc_rot_scan` (`doc_rot.rs:307-315`) iterates every `dev_projects` row
with no filter; personas is registered. Triggered from `usePassportData.ts:324`, throttled to
6h (`:319-333`). Output surfaces on the Factory passport (`passportRows.ts:155`) and as a
triage finding origin (`findings/emitters.ts:304`).

**Reason 1 — scope. The rotten docs are not in its search space.**
`list_docs` (`:122-154`) collects exactly: root `README.md` (`:126-128`) plus a bounded walk of
`<root>/docs` (`:129`). Nothing else.
- All five `DESIGN.md` files in this repo are co-located under `src/features/**`
  (`agents/quick-answer/`, `overview/sub_incidents/`,
  `plugins/dev-tools/sub_lifecycle/competitions/`, `plugins/drive/knowledge/`,
  `vault/shared/vector/`) — **outside the walk entirely**. `scripts/docs/feature-doc-map.json`
  has 37 entries, all under `docs/`, so the manifest has no co-located coverage either.
- The "Phase 0 scaffold… real wiring lands in subsequent phases" claim is a Rust `//!` header
  at `src-tauri/src/companion/mod.rs:3`, over an **87-file** module. Not a `.md` file, so not a
  document to this scanner under any configuration.

**Reason 2 — method. Even a tracked doc could not be caught.**
`judge_doc` (`:253-292`) compares the doc's newest commit timestamp against the newest commit
timestamp of its coupled source paths (`:258-273`). **It never reads document content.** A doc
that is factually wrong but recently committed reads clean. "Claims a component is unrendered
when it is rendered" is a semantic contradiction, outside this detector's expressive range by
construction.

**The compounding blind spot.** `heuristic_scope` (`:221-227`) requires a referenced token to
*currently exist on disk*. A doc citing a **renamed or deleted** path couples to nothing →
`scope = None` → **UNSCOPED, and unscoped is "never dirty-able"** (`:16-17`; the test
`unscoped_docs_are_never_dirty` at `:499-507` asserts this is intentional). So the documents
most likely to be rotten — the ones naming paths that moved — are the ones it systematically
excuses.

**Why it is this way, which the fix must respect.** The precision rule at `:216-220` was
deliberately tightened after *"the first fleet scan, where dir-level coupling marked 78% of all
docs dirty."* The fix for false positives was a large step toward false negatives. Do not undo
that trade — improve on it.

## Acceptance criteria

- [x] Co-located docs are in scope. At minimum every `*.md` sitting beside the code it
      describes, not only `docs/**` + root README. The five `DESIGN.md` files must appear.
- [x] **UNSCOPED becomes an honest, reported state, not silent cleanliness.** "We could not
      judge this" and "this is fine" must not render identically — that equivalence is the
      detector's single biggest lie, and it targets the highest-risk docs.
- [x] One content-level check that git timestamps cannot express: a doc that names a path or
      symbol which does not exist is flagged. Narrow and mechanical — not a semantic
      contradiction checker.
- [x] Precision does not regress. Report the dirty-rate against this repo before and after; if
      it approaches the historical 78%, the rule is wrong and you say so rather than shipping it.
- [x] Rust `//!` module headers are explicitly out of scope OR in scope by deliberate decision —
      state which and why. The `companion/mod.rs` case is the motivating example.

## Risks / non-goals

Not a semantic doc checker. Not an LLM pass. The value is making a mechanical detector honest
about what it can and cannot see, and widening it to the documents that actually exist.

Do not make doc-rot findings blocking.

## Build record

Shipped `4eee00e22` (scanner) + `543006212` (surfaces + docs).

### Measurement, before and after

Both runs are the real pipeline against this working tree, via the `#[ignore]`d harness
`doc_rot::tests::doc_rot_measure_against_this_repo`
(`node scripts/build/run-rust-tests.mjs -- --ignored --nocapture doc_rot_measure`).

| | before | after |
|---|---|---|
| docs found | 400 (truncated) | 400 (truncated) |
| …co-located | 0 | 39 |
| judged / scoped | 289 | 280 |
| …via doc-map | **0** | **36** |
| unscoped → unverifiable | 111 (27.8%) | 114 (28.5%) |
| broken refs | — (inexpressible) | 108 (27.0%) |
| dirty / stale | 267 (**66.8%**) | 258 (64.5%) |
| dirty-rate among judged | 92.4% | 92.1% |

### A premise in the note was incomplete, and it mattered

The note frames the detector as under-reporting. It is also, simultaneously, **already
crying wolf**: 66.8% of tracked docs were dirty before any change — near the historical 78%
that the precision rule was tightened to escape. Two findings explain it, neither in the note:

1. **The doc-map tier was dead.** `list_docs`' depth-first walk spent the whole 400-doc
   budget inside `docs/_archive`, `docs/harness`, `docs/plans` and `docs/tests`. **0 of 37**
   doc-map-managed docs were in the search space, and `docs/features/**` was absent
   entirely. The "freshness is managed" authority tier never once applied on this repo.
2. **What it was judging was the archive.** 711 of 1062 pages under `docs/` are generated
   `docs/harness/**` run reports — date-stamped artifacts that will never be updated and are
   therefore permanently dirty by construction. That is the bulk of the 267.

Priority ordering fixes both: managed + co-located docs now always survive the budget, and a
per-directory cap stops one generated tree crowding out maintained pages.

### The staleness predicate saturates — reported, not masked

92% of judged docs are stale, before and after. The predicate is `∃ file in the coupled scope
with a commit newer than the doc`, which on an actively developed repo is true for virtually
any doc older than a week. Widening scope cannot fix that, and tuning it was out of scope
here — doing it by feel is exactly how the first fleet scan's 78% happened. **Next
direction:** make `stale` discriminating (magnitude of change, or coupling at the section
level) rather than a predicate that mostly reports "this repo is under development".

The two signals added here do not share that flaw: `broken` is a positive content fact, and a
sample of the 108 was hand-verified — dominated by the `src-tauri/src/engine/**` →
`src-tauri/engine/src/**` crate extraction and by moves such as
`shared/components/overlays/CommandPalette.tsx` → `shared/chrome/CommandPalette.tsx`.
Both false positives in the first measured pass (an ellipsis placeholder `src/.../File.tsx`;
a glob truncated to `.../domain-`) are now pinned by tests, along with the directory-name-
with-a-space case.

### Rust `//!` headers: OUT of scope, deliberately

Three reasons, in order of weight. (a) A header has no git history independent of the file it
lives in, so the only coupling available is that file's own directory — the dir-level rule
that produced the 78% scan. (b) `doc_status` and `doc_read_events` key on a document path;
a header is read whenever its source file is read, so the `was_dirty` harm-ranking signal
would be meaningless for it. (c) Decisively: the motivating example — `companion/mod.rs`'s
"Phase 0 scaffold … real wiring lands in subsequent phases" over 87 files — names **no
vanished path**. Neither signal in this detector would catch it. Only a semantic checker
would, and that is an explicit non-goal. Including headers would buy noise and not that
defect. The decision is recorded in the module header so it is not relitigated.

### Known gap left standing

The 400-doc budget still truncates this repo (~700 candidates), and `docs_truncated` is
returned by `doc_rot_scan` but not yet displayed — the passport says "N tracked" without
saying how many were never looked at. Smaller than the three holes closed here, but it is the
same species of silence.
