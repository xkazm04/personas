---
layer: application
subject: signed-artifacts
technique: verification-ux
stack: react
---

# Two dialogs, opposite grades — the consent exemplar and the two-state collapse

The repo contains both the technique's exemplar and its counter-example, in
two dialogs that verify sibling artifact formats.

## Exemplar: `BundleImportDialog`'s kind-matched, re-arming consent

`src/features/settings/sub_network/components/BundleImportDialog.tsx`
implements the consent rules almost clause for clause:

- **Kind-matched.** When `preview.signature_valid` is false, the required
  acknowledgment kind is derived from the *specific* danger:
  `preview.signer_trusted ? 'tamper' : 'unknown'`, and the import button
  stays disabled unless `dangerConfirmed` equals that exact kind — the
  in-code comment says it outright: "A 'tamper' ack does not unlock
  'unknown signer' or vice versa" (`:401-427`).
- **Re-arming.** An effect drops any prior consent whenever the danger
  context shifts: `setDangerConfirmed(null)` keyed on
  `preview?.bundle_hash`, `preview?.signer_trusted`,
  `preview?.signature_valid` (`:86-92`), with the comment naming the attack
  it kills — "a preview re-fetch that flips `signer_trusted` could carry an
  old 'tamper' consent into a freshly-rendered 'unknown signer' warning".
- **Visually the exception.** The proceed path renders as the destructive
  red `import_anyway` button with a shield-off icon, disabled until
  acknowledged (`:415-425`), while the verified path gets the primary
  `import_btn`.

The three-state vocabulary is possible here because the verdict type
carries two booleans — `signature_valid` and `signer_trusted` come from
`verify_against_trusted_key` through `BundleImportPreview`
(`src-tauri/src/engine/bundle.rs:379-380`) — so verified / tampered /
unknown-signer are all expressible.

## Counter-example: `DriveVerifyDialog`'s two-color verdict

`src/features/plugins/drive/signing/DriveVerifyDialog.tsx` renders
`VerifyResultCard` (`:184-259`) by branching on `result.valid` alone:
emerald card + check for true, rose card + X for false. Both collapses are
live:

- **Unverifiable → verified.** `VerifyDocumentResult`
  (`src-tauri/core/src/models/signing.rs:41-51`) has *no trust field* — the
  backend never asks the trust store (deferred-fix entry 76) — so a forged
  sidecar from an unknown signer renders the green state, and the card
  prints `result.signer_display_name` (`:213-216`), a string from the
  pasted envelope, under a `<dt>` labeled "Signer". The attacker chooses
  the words next to the green check. The type is upstream of the pixel: a
  field that does not exist cannot be rendered, exactly as the technique
  states.
- **Vocabulary hard-coded at the string layer.** The i18n tokens are
  `valid_signature` / `verification_failed` / `valid` / `invalid`
  (`t.plugins.doc_signing.*`, used at `:206-208`, `:246-248`) — four
  tokens, two states, no words for "unknown signer". Whoever adds the trust
  field must add the vocabulary in the same change.

The card does get **decomposition** right: separate labeled rows for file
integrity (`unchanged` / `modified`, `:225-236`) and cryptographic
signature (`valid` / `invalid`, `:238-249`), so mixed outcomes are
diagnosable. The structure is one field and one vocabulary away from
compliant.

## Badges, and honest loading absence

`useSigning.signedPaths`
(`src/features/plugins/drive/signing/useSigning.ts:192-201`) powers the
Finder's signed-file badges as a `Set` of normalized drive-relative paths.
The absence semantics the technique demands are documented at the
definition: the set is "Empty until both the signatures list and the root
have loaded; consumers should treat 'not present' as 'unknown'" — absence
of a badge is loading-ambiguous by contract, not rendered as "unsigned".
Unsigned files themselves carry no warning styling anywhere in the Finder —
calm absence, alarm budget preserved for the tampered state.
