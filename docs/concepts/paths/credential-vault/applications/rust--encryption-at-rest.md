---
layer: application
subject: credential-vault
technique: encryption-at-rest
stack: rust
---

# Encryption at rest in the Rust core

The single seal/unseal door is `src-tauri/core/src/crypto.rs`:
`encrypt_for_db` / `decrypt_from_db` (`:1302-1337`) plus the
`encrypt_field` / `decrypt_field` sensitivity wrappers (`:1350-1364`). All
credential-field writers converge on it through the repository insert path —
`is_field_sensitive` runs *inside* `insert_credential_and_fields_tx`
(`src-tauri/db/src/repos/resources/credentials.rs:242-294`), which is why the
legacy corpus measured that control at 4-of-4 admission doors while
command-level controls covered 1 or 2 (the altitude lesson, measured).

## The sealing

AES-256-GCM under a process-cached cipher (`get_cipher`, `:1289-1299`), with
a fresh 12-byte `OsRng` nonce per seal (`:1305-1307`). Nonce discipline is
not just read from the code — the `column-encryption-at-rest` audit ran
`GROUP BY iv HAVING count(*) > 1` against the live store: 36 sensitive
ciphertexts, 36 distinct IVs, zero collisions, correct GCM nonce width on
every row.

Non-sensitive fields store plaintext with an empty IV; `is_plaintext`
(`:1340-1342`) is the discriminator, and `migrate_plaintext_credentials`
(`:1374`) sweeps legacy plaintext rows inside a single transaction — the
standard's proactive sweep for records that would never migrate via
read-upgrade.

## Master-key custody

`get_master_key` (`:497-563`) implements the custody ladder with an explicit,
single-point policy:

- **Platform keystore first** (`try_keychain`, `:567`), key material wrapped
  and cached in a `ProtectedKey` (`:325-353`) that zeroizes on drop and
  memory-locks its page (VirtualLock/mlock, `:373-408`).
- **Fail-closed by default** when the keystore is unavailable; the local
  fallback file is opt-in via `PERSONAS_ALLOW_FALLBACK_KEY=1` and logged as
  weaker (`:516-543`). The `FallbackPolicy` enum's doc comment (`:449-461`)
  records why it exists as *one parsed authority*: the previous code
  documented fail-closed and implemented fail-open, because the doc, the
  error text, and the branch were three hand-maintained copies of one policy.
- **Custody migration is explicit**: `try_upgrade_to_keychain` (`:915`)
  re-homes a fallback key into the keystore, and legacy *unauthenticated* key
  files are refused unless a one-shot migration flag is set — because
  accepting any 32-byte file as the key let a local attacker plant a known
  key (`legacy_key_migration_allowed`, `:471-480`).
- **Only success is cached** (`:498-503`): the earlier `OnceLock<Result>`
  cached a transient keystore failure and bricked all vault crypto until
  restart — cache derived successes, retry failures.

Memory hygiene beyond the key: `SecureString` (`:204-262`) zeroizes on drop
and redacts in both `Debug` and `Display`, so a secret held in the right type
cannot be formatted into a log by accident.

## Deprecating the weak path — the full six-rung sequence, live

The hybrid IPC envelope (`SessionKeyPair::decrypt`, `:80-169`) superseded a
plain-RSA path, and the retirement is textbook instrument-drain-reject:

1. New writes use the hybrid format; the legacy branch survives only for
   in-flight callers (docblock `:58-79` — including the dated retirement
   plan).
2. Every legacy hit increments `LEGACY_IPC_DECRYPT_CALLS` (`:176-181`),
   surfaced on `vault_status` — the counter carries its predicate and is
   visible, not buried in a log.
3. Because the dispatch (presence of a `.` separator) is
   **attacker/frontend-controllable**, the branch was flipped to
   **reject-by-default** with an explicit migration override
   (`PERSONAS_ALLOW_LEGACY_IPC=1`, `:129-155`) — the rung the technique makes
   mandatory when the caller can select the downgrade.
4. Deletion is scheduled on evidence: "once the counter has stayed at zero
   for a full release cycle" (`:76-79`).

The same file also guards the hybrid path's own edges: a malformed RSA-wrapped
key is length-checked before the panic-prone slice conversion (`:98-108`).

## Where the implementation sits below the standard

Three gaps, all named by the `vault-key-handling` audit and all shapes the
technique warns about:

- **No envelope layering at rest**: fields are sealed directly under the one
  master key — no per-record data keys, so master-key rotation implies
  re-encrypting the corpus, and there is no re-key sweep.
- **No key identity on ciphertexts** (5,008 measured): rotation is
  unrepresentable and a wrong-key decrypt is indistinguishable from
  corruption (`aead::Error` either way).
- **No associated data**: `encrypt_for_db` binds the ciphertext to nothing,
  so a store-level swap of one record's ciphertext into another would decrypt
  cleanly.
