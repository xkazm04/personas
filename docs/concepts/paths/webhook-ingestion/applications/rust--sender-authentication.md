---
layer: application
subject: webhook-ingestion
technique: sender-authentication
stack: rust
---

# HMAC sender authentication in the Rust webhook receiver

The repo's compliant exemplar is the direct webhook listener at
`src-tauri/src/engine/webhook.rs` — mandatory HMAC-SHA256, constant-time,
fail-closed — with the smee relay (`src-tauri/src/engine/smee_relay.rs`) as
the instructive counter-example on the same technique.

## Fail-closed, enumerated (`webhook.rs:373-428`)

The `process_webhook` admission path enumerates exactly the degenerate states
the standard demands, each with its own rejection:

```rust
// webhook.rs:373-375 — the posture, stated in a comment:
// "HMAC validation is mandatory. Webhook triggers must have a non-empty
//  secret (enforced at creation time). Reject unsigned or secretless requests."
match webhook_secret {
    Some(ref secret) if !secret.is_empty() => { /* verify */ }
    _ => { /* 403: "Webhook trigger has no HMAC secret configured" */ }
}
```

- **No secret / empty secret** → `403` + `tracing::warn!` (`:412-427`). A
  misconfigured trigger rejects rather than waving traffic through — the
  exact "unverifiable webhook is a rejected webhook" rule.
- **Missing signature header** → `401`, after trying three header spellings
  (`x-hub-signature-256`, `x-signature-256`, `x-webhook-signature`,
  `:377-381`) — sender-convention tolerance in the *lookup*, never in the
  *verdict*.
- **Invalid signature** → `401` (`:385-395`).

The rejection bodies name the reason (`"Invalid HMAC signature"`, `"Missing
signature header (…)"`). The standard prefers blander responses to
unauthenticated callers — this receiver is loopback-bound (`:80`,
`:140`), which shrinks the oracle's audience, but the detail would still be
better confined to `webhook_request_log`.

## Constant-time comparison, including the failure path (`webhook.rs:537-559`)

`verify_hmac_sha256` goes one step past the usual "use the constant-time
verifier": it keeps the **invalid-hex** path on the same timing profile as
the valid-hex path.

```rust
// webhook.rs:544-548 — dummy value when hex decode fails, so both paths
// run the same constant-time comparison:
let dummy = [0u8; 32];
let (expected_bytes, hex_valid) = match hex::decode(hex_sig) {
    Ok(b) => (b, true),
    Err(_) => (dummy.to_vec(), false),
};
// :555-558
mac.update(body);
mac.verify_slice(&expected_bytes).is_ok() && hex_valid
```

An early-return on bad hex would leak "your guess wasn't even hex" through
timing; here malformed and well-formed-but-wrong signatures are
indistinguishable on the wire. It also accepts both `sha256=<hex>` and bare
hex (`:539`), and verifies over the raw `body: Bytes` extractor — the exact
received bytes, upstream of any parsing (parsing happens at `:469`, *after*
the verdict), satisfying the verify-the-bytes-you-parse rule. The function is
`pub(crate)` precisely so the relay reuses it "instead of duplicating crypto"
(`:535-536`) — one verifier, all mouths.

## What is missing here: the timestamp window

The signature has no freshness component — no signed timestamp, no window.
A captured legitimate delivery replays forever with its signature intact.
The sibling corpus document (`docs/concepts/golden-paths/inbound-endpoint-surface.md`
§0.2) makes the point sharply: the OAuth callback listener in the same crate
(`src-tauri/src/commands/credentials/oauth.rs:281-296`, `:1232`) implements
HMAC-signed state *with an embedded timestamp verified against a freshness
window* — the replay defence exists 900 lines away and was not copied. This
is the deviation, not a different design.

## The counter-example: opt-in, fail-open, over re-serialized bytes

`smee_relay.rs` shows what the same technique looks like when eroded by
back-compat:

- **Opt-in and fail-open** (`:48-53`, `:418-438`): verification runs only
  when `PERSONAS_SMEE_WEBHOOK_SECRET` is set; unset (the default) accepts
  unauthenticated events — the in-file comment is candid that the channel
  URL is "an unauthenticated bearer credential". When the secret *is* set it
  fails closed on missing/invalid signatures, correctly.
- **Gate sees a rendition** (`:414-423`): the relay hashes
  `serde_json::to_vec(&body)` — a re-serialization, because the relay
  transport re-encodes the JSON — and the comment admits "the bytes we hash
  may not be byte-identical to what GitHub signed". Verification over
  reconstructed bytes is exactly the drift the raw-bytes rule exists to
  prevent; here it makes enabled verification strict-to-flaky.
- **Routing filters are labeled non-security** (`:212-217`, `:440-446`):
  `allowed_repos` matches an attacker-controllable payload field, and the
  comments say so twice — the discipline of *naming* which checks
  authenticate and which merely route is itself standard-compliant, even
  where the authentication posture is not.
