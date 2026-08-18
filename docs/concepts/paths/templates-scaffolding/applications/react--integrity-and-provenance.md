---
layer: application
subject: templates-scaffolding
technique: integrity-and-provenance
stack: react
---

# Template integrity in the catalog loader — and the autopsy of the gate that wasn't

This repo carries both halves of the technique in one feature: a working
integrity gate at the catalog door (`templateCatalog.ts`) and, thirty lines
of comment away in the backend, the complete autopsy of a deleted gate that
ran for months while verifying nothing (`template_adopt.rs:34-72`). Read
together they are the technique's decoration-vs-protection distinction with
line numbers.

## The manifest: one generator, two consumers, representation pinned

`scripts/generate-template-checksums.mjs` walks `scripts/templates/`,
hashes each canonical template, and emits **two** manifests from the one
run: `src/lib/personas/templates/templateChecksums.ts` (frontend) and
`src-tauri/engine/src/template_checksums.rs` (compiled into the binary).
One generator, invokable by name, is the derivation-names-recomputation
half done right; locale overlay files (`name.cs.json`) are excluded and
"have no independent checksum" — the canonical set is defined once, at the
generator.

The canonical representation is pinned by construction: the loader hashes
`JSON.stringify(template)` of the *imported module*
(`templateCatalog.ts:166-167`) with the same string-hash function the
generator uses — same identity (relative path under the templates dir),
same bytes-as-seen. The docs even record the failure class this prevents:
a JSON tool that re-canonicalizes (number precision, key order) changes
every hash while changing nothing real.

## The gate that works: skip-with-reason at the catalog door

`loadAndVerify` (`templateCatalog.ts:129-186`) is verify-at-seed, and every
verdict is spelled distinctly (`CatalogSkipReason`, `:77`):

- `missing_checksum` (`:160-164`) — **absence**: no manifest entry; a
  build-time bug, skipped with its own reason, never conflated with
  tampering.
- `checksum_mismatch` (`:168-172`) — **mismatch**: the entry is dropped
  from the catalog. Not log-and-continue-accepting: a template failing
  verification never enters the gallery, never seeds, never becomes
  adoptable. The mismatch is recorded per entry in `skipped`.
- `schema_invalid` (`:178-183`) — shape validation runs **after** the
  checksum, with the ordering rationale in place: the checksum trusts
  whatever shape was hashed, so authentic-but-malformed is a distinct
  verdict.
- `unpublished` — intentional absence, not an error.

The rollup is the failure-not-empty-success law as a type:
`CatalogLoadStatus = ok | partial | failed | empty` (`:108-117`) — "every
template failed verification" (`failed`) is distinguishable from "no
published templates" (`empty`), so the gallery can tell a broken
instrument from an empty result. `CatalogIntegrityError` (`:85-98`)
additionally refuses to serve a catalog with duplicate ids, because
last-wins dedupe depends on platform glob order — identity must be unique
before anyone maps by it.

## The gate that wasn't: `check_template_integrity`, deleted 2026-08-09

The comment block at `template_adopt.rs:34-72` preserves the autopsy of
the per-adoption gate this feature used to document as "the authoritative
security gate":

- The manifest is keyed by **relative file path** and hashes the **entire
  template file**. Every real caller passed a **bare label** ("Dev Clone")
  and the **payload-only** `design_result` JSON — wrong key *and* wrong
  representation, so `is_known_template` was false for **100% of
  adoptions** and the "known but tampered → reject" branch was
  unreachable. Fixing the key alone could not help: the hashed content was
  a different document from the one the manifest was generated over.
- The release build only warned on "unknown". An **earlier revision
  hard-rejected** — which bricked two first-party adoption paths on
  shipped binaries *while passing in dev*, where that branch compiled out:
  a gate whose behavior differed by build profile, failing open in one and
  closed in the other.
- The deletion followed the technique's honest sequence: prove inertness
  structurally (the lookup can never bind), verify the callers (nothing
  ever branched on the verdict), then remove — with the reasoning left at
  the deletion site: "a control that looks like security and is inert is
  worse than none, because the docs told the reader it was protecting
  them." The companion doc (`docs/features/templates/06-integrity-and-security.md`,
  "Where enforcement actually lives") now carries a two-row table of what
  actually gates, and names the precondition for ever re-adding a
  per-adoption check: a **payload-keyed** second manifest emitted by the
  same generator.

`verify_template_integrity_batch` (`template_adopt.rs:2140`) survives as
layer 2 — the compiled-in second opinion over the same (path, whole-file)
pairs. Its caller only logs; the comment labels it "a detector, not a
gate", which is the honest name for a mismatch handler that doesn't block.
The legacy corpus audit (`catalog-browse-and-apply.md` D10/P7) pushed
further: layer 2 receives `{path, content}` **over IPC from layer 1** and
never opens the file itself — so the two manifests were observed to agree
0-disagreements-in-111 by construction, two copies of one hash compared
over bytes one party supplied. The technique's independence rule (a second
layer needs its own input path) is measured here, not hypothetical.

## Where the implementation sits below the standard

- **No tamper test.** Nothing in the test suite flips a byte in a template
  and asserts a `checksum_mismatch` skip; the working gate has never been
  seen to fail on demand — the exact epistemic gap that let the deleted
  gate pass as protection for months.
- **The hash is not cryptographic** (a 64-bit string hash): fine against
  corruption and edit-without-regen, decorative against a deliberate
  attacker who can also regenerate the frontend manifest — the threat
  model leans on layer 2's compiled-in copy, which only logs.
- **Provenance is thin**: the manifest records hashes but not generator
  run, source, or time; the adopted instance's stamp does not chain to a
  manifest version.
