---
layer: application
subject: signed-artifacts
technique: import-verification-flow
stack: rust
---

# Preview→commit pinning on three ingress channels — and the gate that lives in the view

`src-tauri/src/commands/network/bundle.rs` is the door layer for the
persona-share bundle, and it implements act three of the technique with
unusual completeness across **three ingress channels** converging on one
core (`bundle::preview_bundle` / `bundle::apply_import`):

- **File** (`apply_bundle_import`, `:61-124`): commits from cached preview
  bytes when `options.preview_id` resolves (`take_cached_preview_bytes`,
  `:70-77`); on cache miss it re-reads *and* the hash pin is **mandatory** —
  a preview_id without `expected_bundle_hash` is refused outright
  (`:89-95`), and the re-hashed bytes must equal the previewed hash
  (`:96-110`, "file may have been swapped after preview").
- **Clipboard** (`apply_bundle_from_clipboard`, `:203-275`): the identical
  guard pair, with the comment noting it "mirrors `apply_bundle_import`'s
  file-path guard" (`:236-246`).
- **Share link** (`import_from_share_link`, `:390-432`): the deep link
  carries the producer's hash; fetched bytes are re-hashed before any DB
  write (`verify_share_link_hash`, `:352-388`). The hashless policy is
  decided explicitly, per channel, in a doc comment (`:342-351`): a
  `personas://share` link without `hash=` is **refused** ("our generator
  always emits one, so its absence is anomalous"), while a raw pasted HTTP
  URL warns and proceeds. All four cases are pinned by unit tests
  (`share_link_hash_tests`, `:453-493`) — the technique's "decide it,
  write it beside the code, test it" clause, verbatim.

Parse defense sits in the core: `read_zip_entry` caps decompressed size on
the declared size *and* on the actual read
(`src-tauri/engine/src/enclave.rs:294-321`; same shape in
`src/engine/bundle.rs:626`), and the full-portability importer hard-rejects
unknown format versions before reading a row
(`commands/core/data_portability.rs:2236-2241` — the legacy convergence
sweep found this repo is the only one of six that refuses an absent
version).

## The deviation: verdict computed in the backend, enforced by a button

`bundle::apply_import` computes the signature verdict
(`src/engine/bundle.rs:405-407`, `verify_against_trusted_key`) — and then
uses it only as a provenance field on the rows it writes:
`signature_verified: sig_valid` (`:497`). The refusal lives in
`src/features/settings/sub_network/components/BundleImportDialog.tsx:401-427`:
`preview.signature_valid` gates which button renders, and the
proceed-anyway path demands kind-matched consent. The component is good —
but it is the *entire* enforcement; the command layer spends 40 lines on
TOCTOU (`network/bundle.rs:67-110`) and zero on the signature verdict, so a
direct invoker imports an unknown-signer or tampered bundle with no consent
step. The same file family already wrote the rule this breaks:
"the frontend is not the boundary — anything that can invoke can skip it"
(`data_portability.rs:1898-1899`, guarding a *weaker* claim). This is the
technique's marker-written-never-read shape with the verdict as the marker,
identified in the legacy analysis
(`docs/concepts/golden-paths/portable-export-bundle.md` §0.1). Recording
`signature_verified` on rows is right; it must be *in addition to* a
backend gate (or a backend-enforced consent token), not its residue.

## What commit writes

Quarantine defaults are implemented and tested: imported personas land
disabled — the test `imported_persona_lands_disabled`
(`src/engine/bundle.rs:957`) pins it, and the comment at `:739` states the
reason ("signature verification only proves *who* built the bundle", not
that it is safe to run). Preview surfaces reach: `extract_network_scope`
(`:829`) mines the bundle for the domains its contents would touch, feeding
the preview's provenance-plus-reach display.

The counter-case for identity minting sits in the *other* importer:
`import_bundle` in `data_portability.rs` names credential shells
`"{} (imported)"` and dedupes on that mutated name — the legacy measurement
found 11 of 25 live credential rows carrying `(imported) (imported)`
(portable-export-bundle §0.5), the round-trip-duplication failure the
technique's mint-or-match-on-stable-key rule exists to prevent. Its import
ledger rows likewise all carry `entity_results = '[]'` — a ledger that
cannot answer what any import actually did.
