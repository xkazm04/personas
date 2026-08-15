# Golden path — Column encryption at rest

> Situation node: `integrations-security/vault-security/column-encryption-at-rest` ·
> [situation spine](../situation-spine.md) · recurrence 19 · risk **HIGH** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **security · resilience · function · code-quality**
> Composed 2026-08-15 against `master` @ `e611c326d`.
>
> **Sweep size.** 963 `.rs` files (the full `src-tauri` tree) plus 5,781 files
> across the combined `src` + `src-tauri` roots walked by the census engine. On
> the data side: **read-only copies** of the operator's `personas.db` (347 MB)
> and `personas_data.db` (17.5 MB), with **1,140 text-bearing columns across
> both stores scanned value-by-value for credential shapes**, and the on-disk
> ACLs of `master.key` and `personas.db` compared directly.
>
> **Measured by execution, not by reading.** The IV-reuse question — the one
> decisive measurement nobody had run — was answered with a `GROUP BY` against
> the live table. The redactor's coverage was answered by replaying its four
> exact regexes against synthetic tokens of twenty real-world shapes, in **two
> independent engines** (Node's `RegExp` and the Rust `regex` crate itself, via
> ripgrep — the same crate the app links). They agreed exactly. The census rule
> was validated in a scratch registry unique to this composer, then re-extracted
> from this finished document and re-run: identical.
>
> `cargo` was not run (PreToolUse guard — the operator's app is running). **No
> secret value, prefix, or partial appears anywhere in this document.** Every
> credential finding is reported as shape, length, column and count.
>
> ---
>
> ## The headline: the cipher is correct, the classifier is correct, and the secret is not in the encrypted column
>
> Start with the good news, because it is load-bearing and it is what makes the
> rest of the document a *containment* problem rather than a *cryptography*
> problem.
>
> | property | measured | verdict |
> | --- | --- | --- |
> | sensitive credential fields encrypted at rest | **36 of 36** (`credential_fields`, `is_sensitive = 1`) | ✔ |
> | distinct IVs among those 36 | **36** — `GROUP BY iv HAVING count(*) > 1` returns **0 rows** | ✔ **no nonce reuse** |
> | IV width | **16 chars base64 = 12 raw bytes**, on 36 of 36 | ✔ correct GCM nonce size |
> | nonce generation | `OsRng.fill_bytes(&mut nonce_bytes)` per call (`core/src/crypto.rs:1306`) | ✔ **per-write, not per-row or per-install** |
> | sensitive fields left plaintext (`is_sensitive = 1 AND iv = ''`) | **0** | ✔ |
> | non-sensitive fields (scopes, expiry, org, gateway URL) stored plaintext | 6, by design | ✔ |
> | inbound API keys stored reversibly | **0** — `external_api_keys` holds a SHA-256 hex digest of a 128-bit random token, 1,016 rows, 1,016 distinct hashes | ✔ |
>
> **A GCM nonce reused under one key is a total break, and it does not happen
> here.** The nonce is drawn from `OsRng` inside `encrypt_for_db` on every call,
> and the data confirms the code: 36 ciphertexts, 36 nonces, zero collisions.
> This is the one question in the brief with a clean answer, and the answer is
> that the primitive is sound.
>
> Now the finding.
>
> ### 1 — the secret's problem is not the cipher, it is that the column is not the only place it lands
>
> Scanning **1,140 text columns of both live stores** for credential shapes, then
> classifying every match as TEMPLATE (carries a `{placeholder}`, `YOUR_`, `***`,
> `<token>`) versus LITERAL:
>
> | column | rows | LITERAL credential-shaped values found | encrypted? |
> | --- | ---: | --- | --- |
> | **`persona_executions.tool_steps`** | 1,921 | **7 × Google API key** (len 39) · **1 × GitHub PAT** (len 40) · **1 × `Bearer` header** (len 47) · **1 × PEM `BEGIN … PRIVATE KEY` header** · **104 × labeled `key = <20+ chars>` assignments**, across ≥72 distinct rows | **no** |
> | `persona_executions.output_data` | 2,058 | 2 × labeled assignment | no — **but redacted** |
> | `persona_memories.content` | 6,535 | 2 × labeled assignment | no |
> | `workspace_knowledge.detail_md` | 1,306 | 1 × labeled assignment | no |
> | `persona_design_reviews.design_result` | 113 | 1 × Slack-shaped (len 19) | no |
> | `credential_fields.encrypted_value` | 42 | **0** | **yes** |
> | `connector_definitions.{healthcheck_config,resources,metadata}` | 283 | **0 LITERAL / 124 TEMPLATE** — all `"Authorization": "Bearer {api_key}"` shapes | n/a, correctly |
>
> **120 literal credential-shaped occurrences across 5 columns; 146 template
> occurrences correctly separated out.** Zero of the 120 are in the column
> designed to hold them.
>
> ### 2 — and the reason is three lines of code that cover 3 of 6 fields
>
> This is not a story about a missing feature. The repo has a **good** redactor —
> `core/src/redact.rs`, with correct per-provider prefixes *and* a Shannon-entropy
> sweep (threshold 4.5 bits/byte, min length 20, mixed character classes, never
> pure hex). It is wired at persistence:
>
> ```rust
> // db/src/repos/execution/executions.rs:751
> fn redact_execution_fields(input: &mut UpdateExecutionStatus) {
>     redact::redact_opt(&mut input.output_data);
>     redact::redact_opt(&mut input.error_message);
>     redact::redact_opt(&mut input.business_outcome);
> }
> ```
>
> `UpdateExecutionStatus` carries **six** free-text/JSON fields that can hold
> model or tool output: `output_data`, `error_message`, `business_outcome`,
> **`execution_flows`**, **`tool_steps`**, **`execution_config`**. Three are
> redacted. The other three are bound into the *same* `UPDATE` statement, 50
> lines below, as `?6`, `?13` and `?15` (`executions.rs:794`, `:800`, `:802`).
>
> **This is a controlled experiment the codebase ran on itself.** Same rows, same
> table, same struct, same statement, same transaction — one field redacted, one
> not. The redacted field (`output_data`, 2,058 rows) carries **2** residual
> matches. The unredacted field (`tool_steps`, 1,921 rows) carries **114**,
> including every high-confidence shape: the Google keys, the PAT, the Bearer
> header, the PEM header. **The redactor works. It was pointed at 3 of 6 doors.**
>
> ### 3 — the other redactor cannot match a GitHub token, and there are three copies of it
>
> `core/src/utils/sanitization.rs:50` — the redactor wired into the **execution
> logger** (`engine/src/logger.rs:61`), the **credential metadata ledger**
> (`credentials.rs:643`), the **healthcheck ledger**, the **OAuth body log**, and
> **11 more sites** — carries this prefixed-token rule:
>
> ```rust
> r"\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\b"
> ```
>
> `gh[pous]` is **not followed by `_`**, and `_` is not in `[a-zA-Z0-9]`. GitHub
> issues `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`. **The rule matches a token
> shape GitHub has never issued and cannot match the one it does.** Confirmed in
> two engines:
>
> | input | Node `RegExp` | Rust `regex` crate (via ripgrep) |
> | --- | --- | --- |
> | `ghp_` + 36 alphanumerics (**the real shape**) | **no match** | **no match** |
> | `ghp` + 36 alphanumerics (a shape that does not exist) | matches | matches |
> | real-shape Slack `xoxb-<digits>-<digits>-<24>` | **no match** | **no match** |
> | `AIza` + 35 (Google — **the shape found 7× live**) | **no match** | **no match** |
> | `sk-ant-…` (Anthropic) | **no match** | **no match** |
>
> Replaying all four `sanitize_secrets` passes against synthetic tokens of twenty
> real shapes: **7 masked, 13 leaked.** Everything that masks is masked by the
> *labelled* rules (`api_key: …`, `Authorization: Bearer …`) — a secret that
> appears without a label survives unless it is `AKIA`, `sk_live_`, or a
> hyphen-free `xox`.
>
> **The identical broken literal appears three times**, in three different
> redaction pattern sets, in two languages:
>
> | site | what it guards |
> | --- | --- |
> | `src-tauri/core/src/utils/sanitization.rs:50` | the execution logger, credential metadata, healthcheck ledger, OAuth bodies (16 call sites) |
> | `src-tauri/src/main.rs:201` | the **Sentry** `before_send` PII scrubber — its own doc comment says *"Matches well-known service token prefixes (GitHub PATs, …)"* |
> | `src/lib/utils/sanitizers/maskSensitive.ts:85` | the frontend masker |
>
> The correct form exists in the same tree — `core/src/redact.rs:58`,
> `gh[pousr]_[A-Za-z0-9]{20,}` — with the underscore *and* the `r` variant the
> other three omit. **Four independent pattern sets; a fifth Slack character
> class (`xox[bpoa]-`, `engine/src/ambient_context.rs`) disagrees with the other
> four (`xox[baprs]-`).** A shape added to one never reaches the others.
>
> ### 4 — the key and the database have byte-identical file permissions
>
> The threat model for a local-first desktop app is the interesting question, and
> the answer is narrower than the AES-256-GCM label suggests.
>
> | | `master.key` | `personas.db` |
> | --- | --- | --- |
> | ACL entries | `DOLLARSTORE\mkdol : Allow : FullControl` | `DOLLARSTORE\mkdol : Allow : FullControl` |
> | inherited ACEs | 0 | 0 |
>
> **Identical.** The two files sit in the same directory, 358 bytes and 347 MB,
> readable by exactly the same principal. `master.key` is DPAPI-wrapped
> (`DPAPI:` prefix confirmed on disk) — but `dpapi_protect` passes `None` for
> `pOptionalEntropy` (`core/src/crypto.rs:1229`), so the ciphertext is bound to
> **the user's login credentials and nothing else**. Any process running as that
> user can call `CryptUnprotectData` and recover the key, and can also open the
> database.
>
> So the honest scope of the encryption is: **it defeats an attacker who has the
> disk and not the user's Windows password** (an unencrypted drive pulled from a
> laptop, a stolen backup file, a synced folder, a support bundle). It defeats
> **nothing** that runs as the user — which includes every process the app itself
> spawns with `--dangerously-skip-permissions`. That is a real and worthwhile
> threat model. It is not the one "AES-256-GCM encrypted credentials" implies to
> a reader, and §7 P4 is what happens when the two get conflated.
>
> ### 5 — the read path has a plaintext branch, and no sibling has one
>
> ```rust
> // core/src/crypto.rs:1340,1359
> pub fn is_plaintext(iv: &str) -> bool { iv.is_empty() }
>
> pub fn decrypt_field(encrypted_value: &str, iv: &str) -> Result<String, CryptoError> {
>     if is_plaintext(iv) { return Ok(encrypted_value.to_string()); }
>     decrypt_from_db(encrypted_value, iv)
> }
> ```
>
> An empty IV means "hand back the column verbatim". `credential_fields.iv` is
> `TEXT NOT NULL DEFAULT ''` — so the empty string is not merely representable,
> it is the **default**. `decrypt_field` does not take `is_sensitive`, so at the
> decrypt boundary there is nothing to distinguish *"this field is legitimately
> plaintext"* from *"this field should have been encrypted and wasn't"*.
>
> The convergence oracle looked for this branch in five sibling repos and found
> **zero**. Both siblings that encrypt at all made it structurally impossible —
> `personas-cloud` with `iv TEXT NOT NULL, tag TEXT NOT NULL` (`orchestrator/src/db.ts:281`),
> `ascent` by making `decryptSecret` **throw** (`src/lib/crypto/secret-box.ts:56`).
> **Personas is the only repo in the fleet with a plaintext read fallback.**
>
> ### 6 — the unencrypted blob beside the encrypted column, measured
>
> `persona_credentials.metadata` is a `TEXT` column with no IV, holding **22
> distinct top-level keys across 25 rows, 1,236–6,611 bytes each, 89,613 bytes
> total**. What is actually in it:
>
> | key family | rows | what it is |
> | --- | ---: | --- |
> | `healthcheck_results` (array, up to **5,488 bytes**), `healthcheck_last_message` (up to 160), `healthcheck_last_state/_tested_at/_success` | 25 | **verbatim probe output from the remote API** |
> | `oauth_token_expires_at`, `oauth_refresh_count`, `oauth_refresh_fail_count`, `oauth_predicted_lifetime_secs`, `oauth_refresh_backoff_until`, `needs_reauth` | 2 | OAuth lifecycle bookkeeping |
> | `usage_count`, `last_used_at`, `anomaly_score` (object) | 25 | usage telemetry |
> | `description`, `is_builtin`, `always_active` | 4 | display |
>
> No key holds a secret **by design** — but `healthcheck_last_message` and
> `healthcheck_results` hold *whatever the remote API said*, and an auth failure
> commonly echoes the request. That path is defended (`sanitize_ledger_json`,
> `credentials.rs:642`) and the defence has demonstrably fired: **2 of 25 live
> blobs contain a `[secret]` mask marker**. It also has a silent bypass — see
> §7 P3.
>
> ### 7 — what the brief got wrong, in one line each (full detail in §12)
>
> **BYOM keys are not in `app_settings`.** `byom_policy` is routing policy —
> providers, complexity bands, compliance tags — and `ByomPolicy` (`db/src/byom.rs:59`)
> has **no key field of any kind**. The BYOM/remote-engine key resolves through
> `ModelProfile.auth_token` → **OS keyring** → **environment variable**
> (`src/engine/http_engine/secrets.rs:59`) and never touches `persona_credentials`.
> **`persona_credentials.encrypted_data` is not where the secrets are** — all 25
> rows have `encrypted_data = ''` and `iv = ''`; the blob was retired in favour of
> `credential_fields` and the empty husk remains.
>
> ### Sibling boundaries, settled in prose
>
> [**Secret display and transfer**](./secret-display-and-transfer.md) owns the
> secret **in motion** — the clipboard, the IPC response, the export bundle, the
> `sanitize_secrets` pattern set as a *display* concern. **This path owns the
> secret at rest in a column**: which column, with or without an IV beside it,
> and what the ciphertext is worth against a given attacker. Where we overlap on
> `sanitize_secrets`, that path owns *"is it called on the read path"*; this path
> owns *"does its pattern set match the shape that is in the column"* — and §3
> above answers that with a two-engine measurement it did not have.
>
> [**Structured logging**](./structured-logging.md) owns the log **record** and
> already prescribes routing it through `sanitize_secrets`. **That prescription
> is now measured**: at `logger.rs:61` it is wired, and it masks 7 of 20 shapes.
> That path's item 1 (*"one line: call `sanitize_secrets` inside
> `ExecutionLogger::log`"*) has **landed**; this path supplies the follow-on that
> the line points at the weaker of the repo's two redactors.
>
> [**Retention and pruning**](./retention-and-pruning.md) owns the 2,991 UUID log
> files (406.6 MB, 1,512 orphaned) and their credential contents. **This path
> does not re-litigate the file system.** It supplies the column-side twin of
> that finding and one correction: the same execution whose *log file* leaks also
> leaks into a *column*, and the column copy survives log-file pruning because
> nothing in the retention system reads `tool_steps`.
>
> [**Credential readiness resolution**](./credential-readiness-resolution.md)
> owns the `Ready`/`needs_setup` verdict and the `detached-readiness-verdict`
> census rule. **This path adds the encryption-side half it does not cover:**
> nothing in the readiness computation asserts that the stored ciphertext still
> *decrypts*. The only round-trip verification in the tree runs at write time
> (`credentials.rs:1383`), never afterward — so a credential encrypted under a
> master key that has since been replaced reports `Ready` until it is used.
>
> [**App settings store**](./app-settings-store.md) owns `app_settings` and the
> `settings-key-holding-secret` rule (1 file / 3 matches). **Confirmed and
> extended:** 32 live keys, of which `browser_bridge_pairing_token` (32 chars) is
> a live shared secret in a plaintext `TEXT NOT NULL` column.
>
> [**JSON blob column**](./json-blob-column.md) owns the blob as a *schema*
> choice. **This path owns the blob as a secret *container*** — the `_enc`/`_iv`
> key-pair convention inside `notification_channels` and trigger `config`, and
> the fact that it has **zero live instances** (§7 P6).
>
> [**Second database**](./second-database.md) — checked: `personas_data.db`
> contains **no** secret-named column and **no** credential-shaped value. The
> vault is single-store. That is one asymmetry it does not have.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Where do I store this API key / token / webhook secret / client secret?"
- "Should this column be encrypted?" / "Do I need an `iv` column?"
- "I'm adding a field to a connector — is it sensitive?"
- "This value is a secret but it also needs to be queryable / joinable."
- "The credential is encrypted, so we're fine, right?" (Against *whom*?)
- "I'm persisting the tool transcript / probe response / provider error / audit detail."
- "How do I verify the encryption actually worked?"

If you are about to type `encrypt_for_db`, `encrypt_field`, `decrypt_field`,
`is_plaintext`, `iv TEXT`, `nonce`, `Aes256Gcm`, `_enc`/`_iv` JSON keys,
`#[derive(Serialize)]` on a struct with a `token`/`secret`/`password` field, or
a `CREATE TABLE` whose column list contains the word `secret` — you are in this
situation.

**You are also in it, and this is the case people miss, if you are about to
persist any free text produced by a spawned process, an LLM, or a remote API.**
That text is where 120 of this repo's 120 live credential-shaped values are.

**Not this path:** *showing* a secret to a user or copying it to the clipboard is
[secret-display-and-transfer](./secret-display-and-transfer.md); *what a log line
should contain* is [structured-logging](./structured-logging.md); *the
`Ready`/`needs_setup` verdict* is
[credential-readiness-resolution](./credential-readiness-resolution.md); *how
long the row lives* is [retention-and-pruning](./retention-and-pruning.md).

## 2 The one way

**First decide which of three kinds of secret you have, because two of them must
never be encrypted.** A credential *someone presents to you* gets **hashed**, not
encrypted — `external_api_keys` is the shape to copy (SHA-256 of a 128-bit random
token, plaintext returned exactly once, lookup by hash), and 4 of 5 sibling repos
independently reached the same answer. A credential that lives *somewhere else*
gets **referenced, not stored** — `brainiac` persists the *name* of an env var and
resolves it at use time, which is the only design in the fleet where a database
read cannot yield a usable credential. Only the third kind — a credential *you
must present later* — needs reversible encryption, and then: **write it through
`encrypt_field(value, is_sensitive)` into a `(value, iv)` column pair, let
`is_field_sensitive` make the sensitivity decision, and never hand-write the
classification at the call site.** Take the `(ciphertext, nonce)` tuple whole —
never construct a nonce, never reuse one, never derive one from the row id; the
one call to `OsRng.fill_bytes` inside `encrypt_for_db` is the entire nonce policy
and it is correct. **Verify the round trip at write time** the way
`verify_field_roundtrip` (`credentials.rs:1383`) does: read the row back, decrypt
it, compare to what you wrote, and fail the write if it differs — a ciphertext
nobody has ever decrypted is not storage, it is a guess. **Then do the part this
repo gets wrong: enumerate every other column that will see the same value.** A
secret decrypted for use flows into a tool argument, a subprocess environment, a
provider error string, an execution transcript, a probe response and an audit
detail — and each of those is a `TEXT` column with no IV. For every one, route
the write through a **single** redaction chokepoint, and make it
`core/src/redact.rs` — the one with an entropy sweep — never `sanitize_secrets`,
whose prefix list cannot match a GitHub, Google or Anthropic token (§3). **Never
give the read path a plaintext branch**: an absent IV must be a decrypt failure,
not a pass-through, because `TEXT NOT NULL DEFAULT ''` makes the empty IV the
default value of the column and therefore the default behaviour of the system.
And **state the threat model in the same commit**: encryption whose key sits
beside the database under identical ACLs defends against disk theft and against
nothing that runs as the user, so write that sentence down before anyone builds a
feature on the stronger reading.

If you must get one thing right first: **the enumeration.** The cipher here is
sound, the nonce is sound, the classifier is sound, and 120 credential-shaped
values are in the database anyway.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/crypto.rs:1350` `encrypt_field(value, is_sensitive) -> (String, String)` | the write door. Returns `(ciphertext_b64, nonce_b64)` for a sensitive value and `(value, "")` for a non-sensitive one. **Six production call sites**, all correct |
| `core/src/crypto.rs:1302` `encrypt_for_db(&str)` | the raw pair. `OsRng.fill_bytes(&mut [0u8; 12])` on **every call** — the whole nonce policy, verified as 36 distinct nonces over 36 rows |
| `db/src/repos/resources/credentials.rs:80` `is_field_sensitive` | **the sensitivity decision, and the best small piece of design in this territory.** Three-tier: (1) a *secret-name backstop* that a user- or AI-authored connector schema **cannot** downgrade, (2) the schema flag, (3) fail-secure default — an unknown key is sensitive. Never hand-roll this |
| `db/src/credential_fields.rs:17` `NON_SENSITIVE_KEYS` / `:89` `classify_field_type` | the single source of truth the classifier reads. Its own doc comment records that triplicating it *"was a real encrypt-vs-plaintext-at-rest risk"* |
| `db/src/repos/resources/credentials.rs:1383` `verify_field_roundtrip` | **read-back-and-compare after the write.** Fails the write on either a decrypt error or a value mismatch. The only thing in the tree that proves a ciphertext is recoverable |
| `core/src/redact.rs` — `redact_string` / `redact_opt` (`:82`) | **the correct redactor.** Per-provider patterns with the right delimiters (`gh[pousr]_`, `sk-ant-`, `AIza`, `xox[baprs]-`, `AKIA`, JWT, multiline PEM block) **plus a Shannon-entropy sweep** (4.5 bits/byte, ≥20 chars, mixed classes, never pure hex) that catches shapes no list knows. Kill-switchable, default on |
| `db/src/repos/resources/external_api_keys.rs:31` `hash_token` / `:39` `generate_token` | the **inbound** credential shape: 128 random bits, `pk_`-prefixed, SHA-256 hex stored, plaintext returned once, `key_prefix` kept separately for display |
| `core/src/crypto.rs:221` `SecureString` | zeroize-on-drop, `Debug`/`Display` render `[REDACTED]`, and **deliberately does not implement `Serialize`** — the comment at `:268` says why |
| `core/src/crypto.rs:325` `ProtectedKey` | `Zeroizing<[u8;32]>` + `VirtualLock`/`mlock` so the master key cannot reach the pagefile |
| `core/src/crypto.rs:497` `get_master_key` | fail-closed by default; caches **only a success**, so one transient keychain failure no longer bricks every credential operation for the process lifetime |

**Do not exist — this path names them:**

- **A single redaction chokepoint.** There are **four** pattern sets
  (`redact.rs`, `sanitization.rs`, `main.rs`, `maskSensitive.ts`) plus a fifth
  divergent Slack class in `ambient_context.rs`. Three of the five carry the same
  broken GitHub literal.
- **Any assertion that a secret-bearing column has an `iv` column beside it.**
- **Any post-write, non-write-time verification that stored ciphertext still
  decrypts.** `verify_field_roundtrip` runs once, at write.
- **A key-rotation path.** `try_upgrade_to_keychain` (`crypto.rs:915`) moves the
  *same* key to a new *store* and says so; nothing re-encrypts under a new key,
  and there is no `#[allow(dead_code)]`-free caller.
- **A written threat model.** No file in the tree states what the encryption is
  and is not meant to defeat.

## 4 Steps

1. **Classify the secret before you write any code.** Present-to-me → hash
   (`external_api_keys`). Lives-elsewhere → store the *reference*
   (env-var name, keyring entry id), not the value. Must-present-later →
   continue.
2. **Put it in `credential_fields`.** It already has the `(encrypted_value, iv)`
   pair, the sensitivity classifier, the round-trip verification, the audit log
   and the FK cascade. A new secret-bearing table is almost always the wrong
   answer; if you write one, its DDL must declare `iv TEXT NOT NULL` **with no
   `DEFAULT ''`** (see step 7).
3. **Call `encrypt_field`, never `encrypt_for_db` directly, and never pass a
   hand-written `is_sensitive`.** Let `is_field_sensitive` decide. Its backstop
   exists precisely because a connector schema is authorable by a user or a
   model, and 9 `api_key` fields in the live database are encrypted today
   because of it.
4. **Ask the type-over-gate question now**, before §9. The answer for this leaf
   is below and the type it names is not the one you expect.
5. **Verify the round trip in the same function.** Copy `verify_field_roundtrip`.
   Return `Err` on mismatch. An unverified write is indistinguishable from a
   write that encrypted under a key nobody can reproduce.
6. **Then do the enumeration, and write the list down.** Trace the decrypted
   value forward: which subprocess environment, which tool argument, which
   provider error, which transcript, which cache key, which audit `detail`,
   which Sentry breadcrumb. **Every destination is a column with no IV.** For
   each, route the write through `redact::redact_opt`. `brainiac` redacts
   *upstream of its cache key* (`extract.rs:560`) — that is the level of
   paranoia this step is asking for.
7. **Never give the read path a plaintext branch.** If your column pair can hold
   an empty IV, delete the branch that special-cases it and let decryption fail.
   `iv TEXT NOT NULL DEFAULT ''` makes the bypass the *default*; `iv TEXT NOT
   NULL` with no default makes it unrepresentable, which is what
   `personas-cloud` did and what §9's type answer prescribes.
8. **Write the threat model into the module doc.** One paragraph: what the key
   is bound to, who can read it, and what an attacker with the disk versus an
   attacker with the user's session can do. If you cannot write it, you do not
   know what the encryption is for.
9. **Add nothing to a redaction pattern set without a test that feeds it a
   real-shaped token.** `brainiac`'s `redact.rs:135-167` pins each pattern with a
   sample and pins idempotence; that test is the only reason its `\btoken\b`
   word-boundary bug (`redact.rs:70`) — the same class of bug as this repo's
   missing underscore — was found.
10. **Then stop.** No new pattern set. No new `iv` convention. No second
    encryption helper. No `Option<String>` secret field on a `Serialize` struct.

## 5 Anti-patterns

- **Enumerating the secret shapes you will mask.** `\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\b`.
  *Failure mode:* identical in structure to
  [retention](./retention-and-pruning.md)'s status allowlist — every provider
  invented after the literal was written leaks forever, silently, and the
  function returns a string that *looks* sanitized. **Measured: 13 of 20
  real-world token shapes pass through unchanged, including the exact Google
  shape found 7× in the live database.** Use an entropy sweep as the backstop
  (`redact.rs:151`), so the list is an optimisation and not the policy.
- **Writing a credential prefix without the delimiter the issuer emits.**
  `gh[pous]` matches nothing GitHub has ever issued. *Failure mode:* the rule is
  syntactically valid, compiles, passes its own unit test (which feeds it
  `sk_live_abc123xyz789000000`, not a PAT), and reports success while masking
  nothing. **Three copies in this tree.** `brainiac` and `ascent` independently
  wrote `gh[pousr]_` — the correct form is physics, not taste.
- **Redacting some fields of a struct you are about to persist.** *Failure mode:*
  the ones you missed are in the same `UPDATE`, and their emptiness is invisible
  because the redacted siblings look clean. **Measured: 3 of 6 free-text fields
  covered; the uncovered `tool_steps` holds 114 credential-shaped values, the
  covered `output_data` holds 2.**
- **`if iv.is_empty() { return value }` on the read path.** *Failure mode:* the
  column is `TEXT NOT NULL DEFAULT ''`, so the bypass is the default. Any write
  path that forgets the IV produces a row that reads back as plaintext with no
  error, forever. **0 of 5 sibling repos have this branch; the two that encrypt
  made it structurally impossible.**
- **Treating "encrypted at rest" as a threat model.** *Failure mode:* the key
  file and the database have identical ACLs and the DPAPI wrapper carries no
  application entropy, so any same-user process defeats it — including the CLI
  subprocesses this app spawns with `--dangerously-skip-permissions`. Encryption
  that is real against disk theft gets quoted as though it were real against
  local malware.
- **A secret-named field typed `Option<String>` on a `Serialize` struct.**
  `ModelProfile.auth_token` (`core/src/types.rs:426`) has no
  `skip_serializing_if` — unlike the two fields directly below it — so it always
  round-trips into `personas.model_profile`, a `TEXT` column with no IV.
  *Failure mode:* the encryption question is never asked, because no `iv`
  parameter ever appears to prompt it.
- **Falling back to the raw value when sanitization fails.**
  `sanitize_ledger_json` (`credentials.rs:642`) returns the **unsanitized**
  metadata when masking breaks the JSON. *Failure mode:* the one input whose
  secret is hard to mask is the one written verbatim.
- **Storing an inbound credential reversibly.** If you can decrypt it, so can
  anyone who reaches the key. `vibeman` stores its inbound API key in plaintext
  and authenticates by string equality; the other four hash. Hashing is not an
  optimisation, it is the removal of a liability.
- **Leaving the empty husk of a retired column.** `persona_credentials.encrypted_data`
  is `TEXT NOT NULL` with `''` in all 25 rows and `iv = ''` in all 25.
  *Failure mode:* `migrate_plaintext_credentials` selects exactly those rows on
  every startup and would encrypt the empty string into them; every reader must
  now know that the encrypted column is not where the encryption is.

## 6 Evidence

**The ONE site to copy: `db/src/repos/resources/credentials.rs:262-300` + `:1383`
— the write path with its round-trip verification.** It calls the classifier
rather than deciding sensitivity itself, takes the `(ciphertext, iv)` tuple whole,
binds both columns in one statement, and then reads the row back and decrypts it
before returning `Ok`. It is the only write in the tree that proves its own
output is recoverable.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `db/src/repos/resources/credentials.rs:80` `is_field_sensitive` | a classification whose **secret-name backstop cannot be downgraded by data**, with a `warn!` naming the misconfiguration and never the value, and a fail-secure default for unknown keys |
| `core/src/redact.rs:48-77` + `:151` | per-provider patterns **with correct delimiters**, plus a Shannon-entropy sweep as the backstop. Ahead of all five siblings — **0 of 5 have any entropy heuristic** |
| `core/src/redact.rs:88` `redact_string` | replaces only the matched substring, so *"plain-text and JSON-as-text are both safe"* — a redactor that corrupts JSON gets bypassed (see P3) |
| `db/src/repos/resources/external_api_keys.rs:31-45` | the inbound shape: 128-bit random token, SHA-256 hex, plaintext returned once, display prefix stored separately. `brainiac`'s equivalent migration comment states the doctrine — *"a database read must never yield a usable credential"* |
| `core/src/crypto.rs:497-563` `get_master_key` | fail-closed by default with an opt-in escape hatch (`PERSONAS_ALLOW_FALLBACK_KEY=1`), and **caches only the success** — the comment at `:498-503` records that caching the first *outcome* bricked all credential operations for the process |
| `core/src/crypto.rs:726-739`, `:974-988` | **refusing an unauthenticated key file by default.** A raw 32-byte or plaintext-base64 `master.key` let anyone who could write the app-data dir plant a known key; both paths now fail closed behind `PERSONAS_MIGRATE_LEGACY_KEY=1` |
| `core/src/crypto.rs:129-149` | the legacy plain-RSA IPC branch **rejected by default**, with a counter (`legacy_ipc_decrypt_calls`) surfaced on `vault_status` so the retirement decision has data behind it. This is how a deprecation should look |
| `core/src/crypto.rs:268` | `SecureString` deliberately not `Serialize` — a *withheld* capability, not a documented rule |
| `core/src/crypto.rs:1374-1458` `migrate_plaintext_credentials` | the whole migration in one transaction; encrypt-then-update per row; commit or roll back entirely |

### The vault, measured (read-only copies, 2026-08-15)

| | value |
| --- | ---: |
| `persona_credentials` rows | **25** |
| …with `encrypted_data = ''` **and** `iv = ''` | **25 (100%)** |
| `credential_fields` rows | **42** |
| …`is_sensitive = 1` | 36 |
| …`is_sensitive = 1 AND iv = ''` (**should be 0**) | **0** ✔ |
| …`is_sensitive = 0 AND iv != ''` (needlessly encrypted) | **0** ✔ |
| distinct IVs among the 36 encrypted rows | **36** ✔ |
| IV collisions (`GROUP BY iv HAVING count(*) > 1`) | **0** ✔ |
| IV length, min/max | **16 / 16** chars b64 = 12 bytes ✔ |
| ciphertext length, min/max | 24 / 360 chars b64 |
| `external_api_keys` rows / distinct `key_hash` | **1,016 / 1,016** |
| …revoked / enabled | 1,015 / 1 |
| `key_hash` length | 64 (SHA-256 hex), uniform |

**Field keys carrying an encrypted value today**: `api_key` (9), `access_token`
(3), `personal_access_token` (2), `refresh_token` (2), `anon_key`, `api_token`,
`auth_token`, `base_id`, `binary_path`, `gateway_url`, `organization`,
`organization_slug`, `pooler_url`, `project_url`, `project_id`, `project_name`,
`root_path`, `tech_stack`, `scopes`, `oauth_token_expires_at`. Note the tail:
**the fail-secure default encrypts `project_name`, `root_path` and `tech_stack`
too.** That is the classifier working as designed — over-encrypting a
non-secret costs a decrypt; under-encrypting a secret costs a breach.

### Secret-named columns versus columns that actually hold secrets

Every column in **both** live stores whose *name* claims credential material:

| | count |
| --- | ---: |
| secret-named columns, both stores | **16** |
| …with an `iv`/`nonce` sibling in the same table | **2** (`credential_fields.encrypted_value`, `persona_credentials.encrypted_data`) |
| …without one | 14 |
| …without one **and holding data** | **4** — and all four are `*_credential_id` foreign keys or `requires_credential_type`, i.e. **not secrets** |

**The name-based heuristic finds nothing, and that is the finding.** Secrets in
this repo do not live in columns called `token` or `api_key`. They live inside
JSON in columns called `tool_steps`, `metadata`, `config`,
`notification_channels`, `model_profile`, `detail` and `value` — which is exactly
why `secret-as-bare-string-field` (which keys on the Rust *field* name) and the
DDL-level intuition both miss them, and why §9 does not propose another
name-based rule.

### The redactor coverage matrix, replayed

Twenty synthetic tokens, one per real-world shape, through all four
`sanitize_secrets` passes. **Two engines, identical results.**

| masked (7) | leaked (13) |
| --- | --- |
| AWS `AKIA…`, Stripe `sk_live_…`, hyphen-free `xox…`, `Authorization: Bearer …`, bare `Bearer …`, `api_key = …`, `"token":"…"` | **GitHub PAT (classic + fine-grained + OAuth)**, **Google `AIza…`**, **Anthropic `sk-ant-…`**, OpenAI `sk-proj-…`, ElevenLabs, **real-shape Slack**, JWT, **PEM private key**, Notion `secret_…`, Linear `lin_api_…`, bare high-entropy token |

Everything in the "masked" column is masked by a **label** rule. The prefix rule
contributes `AKIA`, `sk_live_` and a Slack shape that real Slack tokens do not
have. `core/src/redact.rs` masks **all twenty**.

### Behavioural probes, executed

1. **No nonce reuse anywhere.** 36 encrypted rows, 36 distinct 12-byte nonces,
   zero collisions. The `GROUP BY` is the measurement the brief asked for and it
   comes back clean.
2. **The encrypted column is empty.** `persona_credentials.encrypted_data` is
   `''` in 25 of 25 rows. The vault moved to `credential_fields` and left the
   husk `TEXT NOT NULL`.
3. **The JSON `_enc`/`_iv` convention has zero live instances.** 78 personas, 73
   with `notification_channels`, **0** with an `_enc` key and **0** with a
   plaintext `webhook_url`/`bot_token`. 351 triggers, **0** with `webhook_secret`
   in either form. Both migration paths (`migrate_plaintext_notification_secrets`,
   `encrypt_trigger_config`) are correct and completely unexercised.
4. **The metadata sanitizer has fired on live data.** 2 of 25 metadata blobs
   contain a `[secret]` mask marker — proof that remote probe output reaching that
   column really does contain credential-shaped text.
5. **`persona_executions` is the leak.** 1,921 rows carry `tool_steps` totalling
   **26.5 MB**, dated 2026-06-03 → 2026-06-26 (50–73 days old), containing 114
   credential-shaped literals. Nine frontend files render it
   (`ExecutionInspector`, `ReplayToolPanel`, `PipelineWaterfall`, …).
6. **`personas_data.db` is clean.** Zero secret-named columns, zero
   credential-shaped values across its 67 tables.
7. **`credential_audit_log` is safe by shape.** 9,864 rows, 9,850 with a
   `detail`, **max length 70** — too short to carry a token, and the write path
   sanitizes.
8. **The key file and the database are equally readable.** Identical single-ACE
   ACLs, zero inherited ACEs, same directory. `master.key` is 358 bytes with the
   `DPAPI:` prefix.

### Convergence — five siblings, run 2026-08-15

All five checkouts exist and were read. Nothing is reported by omission.

| clause | brainiac | personas-cloud | ascent | vibeman | personas-web | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| column-level crypto | **none, by design** | AES-256-GCM | AES-256-GCM | none | none | **diverged** (2/5) |
| key location | n/a — env-var *name* stored | env `MASTER_KEY` + PBKDF2 600k | env `ENCRYPTION_KEY` | n/a | n/a | env, **2 of 2**; **0 of 5 use a keychain or KMS** |
| per-write random nonce | n/a | ✔ `randomBytes(16)` | ✔ `randomBytes(12)` | n/a | n/a | **physics 2/2** |
| **plaintext read fallback** | n/a | **impossible** (`iv`+`tag` `NOT NULL`) | **impossible** (throws) | n/a | n/a | **0 of 5 — physics by absence** |
| unencrypted metadata beside | ✔ `config jsonb` | ✔ `metadata TEXT` | ✔ incl. `lastValidationError` | n/a | n/a | **physics 2/2** |
| correct `gh[pousr]_` prefix | ✔ `redact.rs:53` | ✗ no redactor | ✔ `eval-log.ts:38` | ✗ | ✗ | **2 of 2 that have one** |
| entropy heuristic | ✗ | ✗ | ✗ | ✗ (base64-shape only) | ✗ | **SILENCE 5/5** |
| inbound key hashed | ✔ sha256 | ✔ salted sha256 | ✔ sha256 + `timingSafeEqual` | **✗ plaintext** | n/a | **physics 4/5** |

**Three results this document rests on, and one it must not claim.**

**(a) The plaintext read fallback is unique to Personas, and the two repos that
could have had it made it unrepresentable.** `personas-cloud` declared
`iv TEXT NOT NULL, tag TEXT NOT NULL` (`orchestrator/src/db.ts:281`);
`ascent`'s `decryptSecret` throws on malformed input and its callers catch and
return `null` (`secret-box.ts:56`, `org-llm.ts:212`). Neither wrote a policy —
they wrote a schema and a signature. **This is the corpus's cleanest instance of
"prefer a type over a gate", arrived at twice independently.** Note the honest
caveat: three of the five "agree" only because they never encrypt, so the real
signal is 2 of 2, not 5 of 5.

**(b) The correct GitHub prefix is physics.** `brainiac/redact.rs:53` and
`ascent/eval-log.ts:38` both write `\bgh[pousr]_[A-Za-z0-9]{20,}\b` — same
delimiter, same five-letter class including the `r` Personas omits, no shared
document. Personas' three copies of `gh[pous]` are not a stylistic difference;
they are the outlier. **And `brainiac` learned the identical class of bug the
hard way and wrote it down:** `redact.rs:70-73` records that `\btoken\b` cannot
match inside `access_token` *because `_` is a word character*, fixed with an
optional prefix group — the same underscore, the same silent miss, found only
because a test fed it a real-shaped string.

**(c) Personas is ahead of all five on the entropy sweep, and it must be
reported as being ahead rather than as validated.** No sibling has a Shannon or
charset-distribution scorer; the nearest thing is `vibeman/src/lib/logger.ts:32`,
a `^[A-Za-z0-9+/]{40,}={0,2}$` shape anchored to the *whole field value*, which
cannot find a secret embedded in prose. `core/src/redact.rs:151` is the best
redactor in the six-repo sample. **That is precisely why §7 P1's fix is "point
the existing good redactor at three more fields" and not "write a redactor".**

**The clause the oracle refused to support.** I expected to prescribe "encrypt
secret columns" as general doctrine. **Two of five repos have no reversible
secret to encrypt, and one of those two — `brainiac` — reached that state
deliberately**: `crates/brainiac-publish/src/lib.rs:24` states *"**No credentials
in the database.** A target stores the NAME of an env var"*, and the column is
`secret_ref text`. It is simultaneously the fleet's strongest repo on redaction
and derived-record hygiene. So §2 leads with *classify the secret* rather than
*encrypt the column*: **the strongest answer available is often to not hold the
secret at all**, and a path that opens with "use AES-256-GCM" would have skipped
past it. `vibeman` is the control that makes the point stick — it also has no
column crypto, and that is not a design, it is plaintext inbound keys
authenticated by string equality (`apiMiddleware.ts:94`).

**One sibling hazard worth importing.** `ascent` persists
`lastValidationError` — a raw upstream provider error string, truncated to 500 —
in the same row as the credential it validated (`schema.prisma:739`). That is the
same shape as this repo's `healthcheck_last_message` (§7 P3), reinvented
independently. **A provider error stored beside the credential it failed on is a
convergent hazard, not a local mistake.**

## 7 Deviations

Every entry is live on `master` @ `e611c326d` and measured against the operator's
running installation.

> **Second pass — what is upstream of all of this.** Every item below reduces to
> one structural fact: **the repo has two redactors of very different quality and
> the good one is wired to three fields.** `core/src/redact.rs` has correct
> prefixes and an entropy sweep and reaches `output_data`, `error_message` and
> `business_outcome`. `sanitize_secrets` has a prefix rule that cannot match a
> GitHub, Google or Anthropic token and reaches sixteen call sites, including the
> execution logger, the credential metadata ledger and Sentry. **The fix for P1
> and P2 is the same edit twice: delete the weak redactor and point every call
> site at the strong one.** That single change closes five of the nine entries
> below and requires no new code.

### P0 — 114 credential-shaped values sit unredacted in `persona_executions.tool_steps`

| Path | What's wrong |
| --- | --- |
| `db/src/repos/execution/executions.rs:751-756` | `redact_execution_fields` calls `redact_opt` on `output_data`, `error_message`, `business_outcome` — **3 of the 6 free-text fields on `UpdateExecutionStatus`**. |
| `db/src/repos/execution/executions.rs:794`, `:800`, `:802` | `execution_flows` (`?6`), **`tool_steps` (`?13`)** and `execution_config` (`?15`) are bound into the same `UPDATE`, unredacted. |
| `core/src/models/execution.rs:194,198,200` | The three unredacted fields, declared four lines from the three redacted ones. |

**Verified against the running installation:** `tool_steps` holds **7 Google API
keys** (len 39), **1 GitHub PAT** (len 40), **1 `Bearer` header** (len 47), **1
PEM `BEGIN … PRIVATE KEY` header** and **104 labeled `<secret-word> = <20+ chars>`
assignments**, across ≥72 distinct rows of 1,921, dated 2026-06-03 → 2026-06-26.
The redacted sibling `output_data` — same rows, same statement — holds **2**.
Nine frontend files render `tool_steps`, and export/Sentry/companion-memory all
read the same column.

**Fix — three lines:**
```rust
fn redact_execution_fields(input: &mut UpdateExecutionStatus) {
    redact::redact_opt(&mut input.output_data);
    redact::redact_opt(&mut input.error_message);
    redact::redact_opt(&mut input.business_outcome);
    redact::redact_opt_json(&mut input.execution_flows);   // NEW
    redact::redact_opt_json(&mut input.tool_steps);        // NEW
    redact::redact_opt(&mut input.execution_config);       // NEW
}
```
`redact_string` already documents that *"plain-text and JSON-as-text are both
safe: only the matched secret substring is replaced, so surrounding JSON stays
valid"* — so the JSON variants are a serialize/redact/deserialize wrapper, not
new redaction logic. **The 1,921 existing rows need a one-time backfill;** nothing
sanitizes what is already on disk.

### P0 — `sanitize_secrets` cannot match a GitHub, Google or Anthropic token, in three places

| Path | What's wrong |
| --- | --- |
| `core/src/utils/sanitization.rs:50` | `\b(PMR?S\|gh[pous]\|AKIA\|sk_live_\|xox[baprs]-)[a-zA-Z0-9]{16,}\b` — `gh[pous]` has no `_`, so it cannot match `ghp_…`. No `AIza`, no `sk-ant-`, no JWT, no PEM. **16 call sites**, including `engine/src/logger.rs:61` (every execution log line) and `credentials.rs:643` (the credential metadata ledger). |
| `src/main.rs:201` | Byte-identical literal in the **Sentry** `before_send` scrubber, under a doc comment claiming *"Matches well-known service token prefixes (GitHub PATs, …)"*. |
| `src/lib/utils/sanitizers/maskSensitive.ts:85` | Byte-identical literal on the frontend. |
| `engine/src/ambient_context.rs` | A **fourth** Slack class, `xox[bpoa]-`, disagreeing with the other three's `xox[baprs]-`. |

**Measured: 13 of 20 real-world token shapes pass through unchanged**, verified
in both Node's `RegExp` and the Rust `regex` crate. Its own unit test
(`sanitization.rs:100`) feeds it `sk_live_abc123xyz789000000` — one of the three
shapes the prefix rule *does* handle — so the test passes.

**Fix, in order:** (1) delete `sanitize_secrets` and repoint all 16 call sites at
`redact::redact_string`, which masks all twenty shapes and has an entropy
backstop; (2) if a staged migration is needed, the minimal correction is
`gh[pousr]_` (matching `brainiac` and `ascent`) plus `AIza[0-9A-Za-z_\-]{35}`,
`sk-ant-[A-Za-z0-9_\-]{20,}`, the JWT triple and the PEM block — i.e. copy
`redact.rs:48-66`; (3) delete the frontend copy and mask on the backend, since
the frontend receives an already-persisted value and masking there protects
nothing at rest.

### P1 — the read path returns ciphertext columns as plaintext when the IV is empty

`core/src/crypto.rs:1340` `is_plaintext(iv) == iv.is_empty()`, consumed by
`decrypt_field` (`:1359`) and by `migrations/helpers.rs:68`, `:214`.
`credential_fields.iv` is `TEXT NOT NULL DEFAULT ''` and
`persona_credentials.iv` is `TEXT NOT NULL` holding `''` in 25 of 25 rows — so
the bypass is the column's default value. `decrypt_field` does not receive
`is_sensitive`, so at the decrypt boundary "legitimately plaintext" and "should
have been encrypted" are the same state.

**Live instance count: 0** for sensitive fields — the classifier and the two
startup assurance passes are holding the line. **The class is one forgotten
`encrypt_field` away**, and **0 of 5 sibling repos have this branch**.

**Fix:** make the plaintext case explicit rather than implicit. `decrypt_field`
takes `is_sensitive`; an empty IV on a sensitive field returns `Err`, not the
column. Then drop the `DEFAULT ''` so a write that omits the IV fails at the
database. See "Prefer a type over a gate".

### P2 — the encryption is never re-verified after the write

`credentials.rs:1383` `verify_field_roundtrip` is the only decrypt-and-compare in
the tree and it runs inside the write. Nothing afterward asserts that stored
ciphertext still decrypts: not the readiness resolver, not the healthcheck, not
boot. `get_decrypted_fields` (`credentials.rs:1449`) surfaces a decrypt failure
only when something asks to *use* the credential.

**Consequence:** a credential encrypted under a master key that was subsequently
regenerated — which `derive_fallback_key` does silently when `master.key` is
unreadable and permission repair fails (`crypto.rs:686-698`) — reports `Ready`
and fails at first use. **Fix:** add a boot-time or healthcheck-time
`SELECT id FROM credential_fields WHERE iv != ''` → `decrypt_from_db` → count
failures, surfaced on `vault_status` beside the two counters already there
(`legacy_ipc_decrypt_calls`, `credential_audit_write_failures`). The pattern is
already in the file; this is a third instance of it.

### P3 — the metadata sanitizer falls back to the raw value

```rust
// db/src/repos/resources/credentials.rs:642
fn sanitize_ledger_json(meta: &str) -> String {
    let sanitized = sanitize_secrets(meta);
    if serde_json::from_str::<serde_json::Value>(&sanitized).is_ok() { sanitized }
    else { meta.to_string() }          // ← the unsanitized original
}
```
The guard is well-intentioned — a 2026-06-16 bug-hunt found `sanitize_secrets`
corrupting legitimate OAuth ledger fields — but the failure direction is wrong:
**the one input whose masking breaks the JSON is written verbatim.** The column
holds up to 6,611 bytes per row including a 5,488-byte `healthcheck_results`
array of verbatim remote-API responses, and **2 of 25 live blobs already carry a
`[secret]` marker**, so the path demonstrably sees credential-shaped text.

**Fix:** `redact_string` replaces only the matched substring and cannot break
surrounding JSON (`redact.rs:88`), which removes the reason the fallback exists.
Repoint and delete the branch. If a fallback must remain, it should drop the
field, not keep it.

### P4 — no file in the tree states the threat model

`master.key` and `personas.db` have identical ACLs; `dpapi_protect` passes `None`
for `pOptionalEntropy` (`crypto.rs:1229`), so the wrapper binds to the user's
login and not to the application. Meanwhile `db/src/lib.rs` seeds the
`personas_database` connector description as *"Safe for agent read/write
operations"*, and this app spawns CLI subprocesses with
`--dangerously-skip-permissions` (`core/src/redact.rs:3-5` says so) as the same
user.

**Fix:** one paragraph in `core/src/crypto.rs`'s module doc: the encryption
defends the database against an attacker with the *disk* and not against code
running as the *user*; DPAPI carries no application entropy; the key file and the
database are equally readable. Then check every feature that quotes the vault's
protection against that sentence. Optionally add application entropy to
`CryptProtectData` — a real, small hardening that raises the bar from "any
same-user process" to "any same-user process that also reads our binary".

### P5 — `ModelProfile.auth_token` is a bare `String` serialized into a column with no IV

`core/src/types.rs:426` — `pub auth_token: Option<String>` on a
`#[derive(Serialize, Deserialize)]` struct, with **no `skip_serializing_if`**,
unlike `prompt_cache_policy` (`:429`) and `effort` (`:436`) directly below it. It
is persisted whole into `personas.model_profile` (`db/src/migrations/schema.rs:28`,
`TEXT`), and it is the **first** source consulted by `resolve_api_key`
(`src/engine/http_engine/secrets.rs:60`) — ahead of the OS keyring.

**Live: 78 personas, 4 with a `model_profile`, 0 with `auth_token` set** (max
column length 29 bytes). The class is unexercised and the door is open;
`incremental.rs:1202` already records that `model_profile` is *"logged with
values redacted"*, so the hazard was known at the logging layer and not at the
storage layer.

**Fix:** remove the field. The keyring path
(`secrets.rs:28` `store_qwen_api_key`) already exists, already works, and is the
only one of the three resolution sources that is not a plaintext column or an
ambient environment variable.

### P6 — the JSON `_enc`/`_iv` convention is a second encryption scheme with zero users

`crypto.rs:1557` `migrate_plaintext_notification_secrets` and `:1687`
`encrypt_trigger_config` implement field-level encryption *inside* a JSON blob,
with `<key>_enc` / `<key>_iv` pairs, for `SENSITIVE_CHANNEL_KEYS` (4 keys) and
`SENSITIVE_TRIGGER_KEYS` (2 keys). Both are correct. Both are **completely
unexercised**: 73 personas with `notification_channels` and **0** `_enc` keys and
**0** plaintext `webhook_url`/`bot_token`; 351 triggers and **0** `webhook_secret`
in either form.

This is a deviation because it is a **second convention** — a reader must now
know two encryption shapes, and the JSON one has no round-trip verification, no
classifier, and no audit row. **Fix:** when a real notification secret or webhook
secret appears, route it to `credential_fields` and store its id in the JSON,
rather than growing the parallel scheme.

### P7 — `browser_bridge_pairing_token` is a live shared secret in `app_settings`

32 chars, plaintext, in `app_settings.value` (`TEXT NOT NULL`), one of 32 live
keys. [app-settings-store](./app-settings-store.md) owns the general condition and
already gates it (`settings-key-holding-secret`, 1 file / 3 matches). Recorded
here as the live instance and the confirmation that its rule is not theoretical.

### P8 — 1,015 revoked API-key hashes are retained indefinitely

`external_api_keys` holds 1,016 rows of which 1,015 are revoked, each keeping its
`key_hash` and 9-char `key_prefix` forever. Not a confidentiality defect — the
hash is one-way over 128 random bits — but a revoked credential's derived
material has no reason to outlive the credential.
[retention-and-pruning](./retention-and-pruning.md) owns the sweep; this path
supplies the reason: **the only thing a hash is for is answering a
presentation, and a revoked key will never be presented again.**

### Structural

- **Every deviation above shipped under a green `npm run check`.** No lint rule,
  test, script or CI job in this repo has any opinion about which columns hold
  secrets, whether a redaction pattern matches the shape it names, or whether a
  ciphertext still decrypts.
- **`sanitize_secrets` has a unit test and the test cannot fail.** It is fed
  three labelled pairs, an email, and `sk_live_…` — never a `ghp_`, `AIza`, or
  `sk-ant-` token. **A test that only feeds a matcher inputs it already handles
  is not a test of coverage.**
- **`personas_data.db` is clean** — zero secret-named columns, zero
  credential-shaped values. The vault is single-store, and
  [second-database](./second-database.md)'s asymmetries do not apply here.

## 8 Gaps — what the primitives genuinely cannot do

1. **No cipher can protect a key that lives beside the ciphertext under the same
   ACL.** This is not a defect to fix, it is the definition of local-first. The
   only real levers are DPAPI application entropy (raises the bar to "reads our
   binary"), a user passphrase (destroys unattended operation, which this app
   requires), or a hardware token. **What is missing is not a lever, it is the
   sentence naming which lever was chosen and why** — P4.
2. **No type reaches inside a JSON blob.** `ModelProfile.auth_token` is typed,
   but its home is a `TEXT` column holding `serde_json`, so no column-level or
   parameter-level discipline can see it. Same for `_enc`/`_iv` keys inside
   `notification_channels` and trigger `config`. This is the general form of the
   doctrine's *"inside a SQL string literal"* gap, one layer up.
3. **No regex knows what a credential looks like next year.** Every prefix list
   in every repo in the fleet is a snapshot. This is exactly why the entropy
   sweep (`redact.rs:151`) is the load-bearing half and the prefix list is the
   optimisation — and why **0 of 5 siblings having an entropy heuristic is a
   fleet-wide blind spot rather than a validation of prefix lists.**
4. **Redaction is lossy and irreversible, so it can only be applied at a
   boundary you are certain of.** `redact.rs` is deliberately applied *at
   persistence*, not at stream emission, so the live terminal still shows the
   user their own output. That is correct — and it means every *new* persistence
   site is a new decision, which no type can make for you. It is why P0 exists.
5. **SQLite has no column-level encryption and no `pgcrypto`.** Every byte of
   protection here is application-level, so an encrypted column is opaque to
   `WHERE`, `ORDER BY`, `LIKE` and FTS. That is why `credential_fields` splits
   into `(field_key, encrypted_value)` — the key is queryable and the value is
   not — and why `scopes` and `oauth_token_expires_at` are deliberately left
   plaintext.
6. **Nothing can enumerate "every column that will ever see this value".** Step 6
   is a discipline, not a guarantee. `brainiac` is the only repo in the sample
   that carries it all the way to the cache key (`extract.rs:560`), and it does so
   by hand.
7. **The census cannot assert an absence.** "No column holds an unredacted
   secret" and "every secret column has an IV beside it" are completeness
   conditions, and the engine counts occurrences of a bad shape. The value scan in
   §6 is the instrument for those, and it must be **re-run**, not ratcheted.

## Prefer a type over a gate — the answer for this leaf

Held against all seven qualifications. **The obvious candidate is a `Secret`
newtype that cannot be serialized. My answer is: that is the wrong type. The
right one is `iv TEXT NOT NULL` with no `DEFAULT`, and it is a schema change, not
a Rust change.**

**Q1 — a required type carries only what it actually encodes.** A `Secret(String)`
newtype encodes *"this value is a credential"*. Test it against this document's
defects: it does not prevent P0 (the leak is in a `Vec<ToolCallStep>` of model
output, where no value was ever labelled a secret), P2 (no verification), P3 (a
sanitizer fallback), or P4 (an unwritten threat model). It prevents P5 — one
field, zero live instances. **The type that would have prevented the most is the
one that removes the plaintext read branch**, because that branch is the only
place where an *unencrypted* value can masquerade as an encrypted one.

**Q2 — requiredness is orthogonal to closedness.** `credential_fields.iv` is
already `NOT NULL`. **It made no difference**, because `DEFAULT ''` supplies a
legal value that means "no encryption". Requiredness was present and did nothing;
what is missing is that the *domain* of the column includes a value meaning
"disabled". Removing the default closes it. This qualification is not academic
here — it is the exact shape of the live defect.

**Q3 — a type nobody constructs constrains nothing.** This one **passes, and it
is why the schema fix is cheap**: there are only **six** production call sites of
`encrypt_field` and **four** of `decrypt_field` in 963 files. The construction
surface is tiny and already funnelled. A `SecureString` newtype exists
(`crypto.rs:221`) and is genuinely well-built — zeroizing, `[REDACTED]` on
`Debug`, deliberately not `Serialize`. **Its problem is not construction, it is
that the values in `tool_steps` were never `SecureString`s in the first place**;
they arrived as characters in a model's tool-call transcript.

**Q4 — a type anyone can construct authenticates nothing.** `Secret(pub String)`
would be a comment. And note the live analogue: `is_plaintext` is a *public
function* returning `bool` from an emptiness check — any caller can obtain the
"this is fine unencrypted" verdict by passing `""`, which is the column's default.

**Q5 — withholding beats requiring.** The strongest form of this fix is to
withhold the plaintext *result*. `decrypt_field` currently offers a path that
returns a value **without decrypting anything**. Delete it. Callers that need a
plaintext non-sensitive field should read the column directly and obviously,
under a differently-named function, rather than through the door named "decrypt"
— because the whole hazard is that one door returns two different kinds of thing
and the caller cannot tell which it got.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
**writing a row with no IV**. Withhold *that*, at the schema:
```sql
ALTER TABLE credential_fields  ... iv TEXT NOT NULL          -- no DEFAULT ''
```
so an `INSERT` that omits the IV is a constraint violation instead of a plaintext
row. Do **not** withhold the ability to store a non-sensitive value in plaintext
— that is the *answer*, it is correct for the six live `scopes`/`organization`
fields, and taking it away would break the feature. **`personas-cloud` and
`ascent` reached exactly this split independently** (§6 convergence a), which is
the strongest evidence in this document that it is the right cut.

**Q7 — withholding a requirement only helps when the requirement was forcing the
bad value.** ✔ and this is the check that keeps the scope honest. Nobody is
*forced* to write an empty IV — `encrypt_field` returns `("", …)` voluntarily for
non-sensitive fields, and that is correct behaviour. So relaxing a signature is
inert; **the construction of the ambiguous state is what must be withheld**,
which is why the fix is the schema default and the deletion of the read branch,
not a new parameter.

**And the honest limit, which is P0.** No type reaches a secret that was never a
typed secret. The 114 credential-shaped values in `tool_steps` arrived as
characters inside a JSON transcript of a tool call. There is no signature to
harden, no newtype to introduce, no constructor to withhold — the only instrument
that reaches them is a redaction pass at the persistence boundary, and the
codebase already has an excellent one pointed three fields to the left.
**Recommended, in order:** (1) the three lines of P0 plus a backfill; (2) delete
`sanitize_secrets`, repoint 16 call sites at `redact.rs`; (3) drop
`DEFAULT ''` and delete the `is_plaintext` read branch; (4) write the threat
model; (5) keep §9's ratchet until (2) lands, then delete the rule.

## 9 The missing gate

### The condition, stack-free

> **A redaction pattern names a credential-prefix family but omits the delimiter
> the issuer actually emits, so the rule matches a token shape that does not
> exist and cannot match the one that does.**

The pattern compiles, passes review, passes its own unit test, and returns a
string that *looks* sanitized. There is no runtime signal — a redactor that masks
nothing and a redactor with nothing to mask produce byte-identical output. This is
the same silent-success family as
[retention](./retention-and-pruning.md)'s status allowlist, one layer down: a
policy expressed as a hand-written enumeration, where every member you failed to
name is retained forever.

**The proxy, for this stack:** a bracketed GitHub-prefix character class
(`gh[…]`) **not** immediately followed by `_`. GitHub is the discriminating case
because it is the one issuer whose prefix family is conventionally written as a
character class, so the omission is visible in the literal.

### Existing rules checked first

I read all **93** rules in `scripts/census/rules.json` before authoring, and
checked these five by name:

- **`secret-as-bare-string-field`** (`secret-display-and-transfer.md`, 10 files /
  12 matches, `roots: ["src-tauri"]`) — the nearest neighbour named in the brief.
  **I measured its territory directly and declined to re-enter it:** my own
  variant of that shape returns **11 files / 13 matches**, which is ~92% overlap
  with an existing rule. That is worse than the 83%-overlap refusal already in the
  corpus. Declined.
- **`redirect-portable-credential-header`** (`outbound-http-call.md`, 9/22) — keys
  on `.header("x-api-key", …)` on an outbound request. In-flight, not at-rest; no
  SQL, no column, no pattern literal. **Zero overlap**, and it is the natural
  upstream sibling: it governs where the decrypted value goes, this rule governs
  whether the record of that trip is masked.
- **`settings-key-holding-secret`** (`app-settings-store.md`, 1/3,
  `roots: ["src-tauri/db/src"]`) — keys on a `pub const …API_KEY: &str = "` in the
  settings registry. Disjoint by root and by shape. Confirmed live (§7 P7), not
  overlapped.
- **`detached-readiness-verdict`** (`credential-readiness-resolution.md`, 2/3) —
  an `UPDATE personas SET setup_status` with no `setup_detail`. Different verb,
  different table, no pattern literal. No overlap.
- **`unqueryable-log-record`** (`structured-logging.md`, 67/288) — a `tracing!`
  macro interpolating into the message. Adjacent territory (both concern what
  reaches a durable log), but it keys on the *macro call shape* and mine on the
  *content of a regex literal*. **Zero match overlap by construction** — no
  `tracing!` invocation contains a `gh[…]` class.

**Zero of the 93 existing rules look inside the body of a security pattern.**
Every one gates a call site, a declaration, a type or a statement. That is the
territory gap this rule fills, and it is why the failure survived: the pattern is
data, and no rule in the corpus reads data.

### The rule

```json
{
  "id": "delimiterless-credential-prefix-class",
  "goldenPath": "docs/concepts/golden-paths/column-encryption-at-rest.md",
  "title": "A redaction pattern names a credential-prefix family but omits the delimiter the issuer emits — it matches a token shape that does not exist and cannot match the one that does.",
  "roots": ["src", "src-tauri/src", "src-tauri/core", "src-tauri/db", "src-tauri/engine"],
  "extensions": [".ts", ".tsx", ".rs"],
  "signal": {
    "pattern": "gh\\[[A-Za-z]+\\](?!_)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A bracketed GitHub-token prefix character class NOT followed by the underscore GitHub actually emits. PROXY FOR the stack-free condition: a redaction/masking pattern enumerates a credential-prefix family but omits the delimiter the issuer uses, so the rule matches a token shape that does not exist and CANNOT match the one that does. GitHub is the discriminating case because its five prefixes (ghp_ gho_ ghu_ ghs_ ghr_) are conventionally written as one character class, which makes the omission visible in the literal; every other issuer's prefix is a flat string where the delimiter is harder to drop by accident. MEASURED 2026-08-15 at e611c326d: 3 files / 3 matches, ALL THREE HAND-READ AND IDENTICAL (precision 3/3) - src/lib/utils/sanitizers/maskSensitive.ts:85 (frontend masker), src-tauri/src/main.rs:201 (the Sentry before_send PII scrubber, under a doc comment that claims 'Matches well-known service token prefixes (GitHub PATs, ...)'), src-tauri/core/src/utils/sanitization.rs:50 (sanitize_secrets, wired to 16 call sites including engine/src/logger.rs:61, the execution logger, and db/src/repos/resources/credentials.rs:643, the credential metadata ledger). All three carry the byte-identical literal \\b(PMR?S|gh[pous]|AKIA|sk_live_|xox[baprs]-)[a-zA-Z0-9]{16,}\\b. WHY IT IS A DEFECT AND NOT A STYLE CHOICE: _ is not in [a-zA-Z0-9], so after matching 'ghp' the class cannot consume the '_' that follows in every token GitHub issues. VERIFIED IN TWO ENGINES - Node RegExp and the Rust regex crate (via ripgrep, the same crate the app links) both return NO MATCH for ghp_ + 36 alphanumerics and both MATCH ghp + 36 alphanumerics, a shape GitHub has never issued. The same literal also omits AIza (Google), sk-ant- (Anthropic), JWT and PEM entirely; replaying all four sanitize_secrets passes against synthetic tokens of 20 real-world shapes masks 7 and leaks 13, and the 7 are masked by the LABELLED rules, not by this one. LIVE COST: persona_executions.tool_steps holds 7 Google-API-shaped, 1 GitHub-PAT-shaped, 1 Bearer-header and 1 PEM-header value across a 1,921-row table, and 2,991 execution log files carry the same shapes. CONVERGENCE: brainiac/crates/brainiac-core/src/redact.rs:53 and ascent/src/lib/llm/eval-log.ts:38 independently wrote \\bgh[pousr]_[A-Za-z0-9]{20,}\\b - same delimiter, same five-letter class including the 'r' all three Personas copies omit, no shared document. The correct form is physics; these three are the outlier. brainiac also documented the identical class of bug at redact.rs:70-73 (\\btoken\\b cannot match inside access_token because _ is a word character) and found it only by writing a test that fed the pattern a real-shaped string. LEGAL FIX, in order: (1) delete sanitize_secrets and repoint all 16 call sites at personas_core::redact::redact_string (core/src/redact.rs), which has correct delimiters for every family AND a Shannon-entropy backstop at :151 that no sibling repo has; (2) if a staged migration is required, correct the literal to gh[pousr]_ and add AIza[0-9A-Za-z_\\-]{35}, sk-ant-[A-Za-z0-9_\\-]{20,}, the JWT triple and the multiline PEM block - i.e. copy redact.rs:48-66; (3) delete the frontend copy outright, since it masks a value that was already persisted and therefore protects nothing at rest. DO NOT silence a match by rewriting the class as an alternation (gh(p|o|u|s)) or by splitting the literal across two strings - both preserve the defect exactly and merely hide it from this signal; the honest fix always makes the pattern match a real token. AND DO NOT add a test that only feeds the matcher inputs it already handles: sanitization.rs:100 passes today because its fixtures are three labelled pairs, an email, and sk_live_..., never a ghp_ token. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN - DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-15 @ e611c326d — 5,781 files walked across both roots; validated standalone in a scratch registry, then re-extracted from this document and re-run; 3/3 both times; runtime 2.5 s."
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 4000
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "delimiterless-credential-prefix-class-positive-control",
  "goldenPath": "docs/concepts/golden-paths/column-encryption-at-rest.md",
  "title": "POSITIVE CONTROL — not a gate. Credential prefixes written WITH their delimiter, the compliant form the rule must never report.",
  "roots": ["src", "src-tauri/src", "src-tauri/core", "src-tauri/db", "src-tauri/engine"],
  "extensions": [".ts", ".tsx", ".rs"],
  "signal": {
    "pattern": "(?:gh\\[[A-Za-z]+\\]_|github_pat_|sk-ant-|sk_live_|xox\\[[a-z]+\\]-|AIza|AKIA)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the shape-discrimination control for delimiterless-credential-prefix-class, and it carries no baseline by design. Same roots, same extensions, same file walk; pointed at credential-prefix literals that DO carry their delimiter (gh[...]_ , github_pat_, sk-ant-, sk_live_, xox[...]-) plus two families whose prefix has no delimiter at all and is therefore always correct (AIza, AKIA). MEASURED 2026-08-15 at e611c326d: 9 files / 45 matches versus the rule's 3 / 3 - a 15:1 ratio. The two populations are MUTUALLY EXCLUSIVE BY CONSTRUCTION on the gh[...] family: the rule requires the class NOT be followed by _, the control requires it IS. The decisive row is src-tauri/core/src/redact.rs, which contributes 14 control matches including gh[pousr]_ , sk-ant- , AIza , xox[baprs]- and AKIA and ZERO rule matches - the compliant redactor exists in the same tree as the three broken ones, so the rule is discriminating on the delimiter and not on the presence of credential vocabulary. If it were keying on the word 'gh' or on 'credential prefix' generally it would light up redact.rs too and report the repo's best security module as violating. Other control files: db/src/builtin_connectors.rs (9 - connector catalogue examples), engine/src/ambient_context.rs (12 - env-var harvesting, and note it carries a FIFTH Slack class xox[bpoa]- that disagrees with the other four's xox[baprs]-, which is separate evidence of pattern-set divergence and is NOT gated here), src/cloud/sync/rows.rs (2), src-tauri/src/main.rs (3 - the same file as a rule match, since its literal is right about AKIA/sk_live_/xox and wrong only about GitHub: file-level overlap of 1, MATCH-level overlap of 0), core/src/utils/sanitization.rs (5, same reason), src/engine/runner/credentials.rs (2), and two single-match files. Run both together whenever the rule's pattern is edited: if this control's count collapses, the walk or the anchors broke rather than the codebase being fixed. It is expected to RISE as coverage improves - every prefix added to redact.rs increments it - which is exactly why it must never be baselined.",
    "$measured": "2026-08-15 @ e611c326d — 9 files / 45 matches via the real runner (ignoreCommentLines strips 3 further comment-only files that a raw scan reports)."
  },
  "floor": 4000
}
```

### Verification of this gate's own preconditions

- **`floor: 4000`** against **5,781** files actually walked, matching the
  `unknown-money-as-zero` precedent for this same root set — several rules over
  one root must not hold different opinions about what "the tree is intact"
  means. A typo'd root walks 0 files and trips both `floor` and the zero-match
  structural failure.
- **Backtracking checked, not assumed.** The pattern is `gh\[[A-Za-z]+\](?!_)`:
  one bounded character class, one quantifier, one zero-width lookahead. **No
  nested quantifier, no alternation inside a quantifier, no variable-length
  lookbehind.** Real-runner wall time over 5,781 files: **2.5 s** for both rules
  together. (The last batch's `(?:\s|//[^\n]*)*` bomb is a nested quantifier over
  an alternation whose branches can both match empty-adjacent input; nothing of
  that shape appears here.)
- **The rule must reach zero and then be DELETED**, not baselined at 0 — the
  census cannot express "must be zero", and a rule pinned at 0 is a gate that can
  never fail. Fix P0's item (2) and all three matches disappear at once.
- **Re-extraction check performed.** Both blocks above were pasted back out of
  this finished document into a scratch registry unique to this composer
  (`rules-column-encryption-at-rest-probe.json`) and re-run through the real
  runner — `node scripts/census/run-census.mjs --rules <scratch>/…` — not a
  re-implementation. Results identical: **3 files / 3 matches / 5,781 walked /
  floor 4000** and **9 files / 45 matches**, no baseline, no structural problems.
- **No `exclude` entries.** All three matches are true positives, so there is no
  legitimate exemption and no stale suppression can accumulate.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.
- **A note on the lookahead.** `(?!_)` is legal because the census engine is
  Node/JS. The Rust `regex` crate rejects it outright (verified — ripgrep refuses
  the pattern), so this signal cannot be ported to a Rust-side checker as
  written; the equivalent there is `gh\[[A-Za-z]+\]([^_]|$)`.

### Gates I rejected, with numbers

Refusing to gate is first-class, so here are the four candidates I measured and
declined:

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **secret-named struct field with no encryption** | 11 files / 13 | — | **~92% overlap with `secret-as-bare-string-field`** (10 files / 12), which already gates this shape for `secret-display-and-transfer.md`. The corpus has already refused a gate at 83% overlap; this is worse. Confirmed live as P5 instead. |
| **`CREATE TABLE` with a secret column and no `iv`/`nonce` column** | 2 files / 3 | 2 files / 3 | A clean 50/50 partition — and only 3 matches, of which the schema fix in "Prefer a type over a gate" removes some. More importantly it is **the wrong instrument for the measured reality**: only 16 secret-*named* columns exist in the whole live schema and **none of the 120 live credential-shaped values is in one**. A DDL name gate would report green while `tool_steps` leaks. |
| **`INSERT`/`UPDATE` naming a secret column with no `iv` in the same statement** | 14 files / 26 | 10 files / 20 | **Not a partition — it is the same statements twice.** The violating and compliant sets share 10 files and overlap at the line level (`credentials.rs:254,277,1242,1345,1348,1538` appear in both), because a Rust SQL literal is assembled from concatenated strings and a tempered class cannot bound the statement. Two implementations of a bad idea agreeing is not evidence; I hand-checked the overlap and discarded it. |
| **a regex literal enumerating ≥2 credential-prefix families** (i.e. "you are using a shape allowlist at all") | 3 files / 3 | **0** | Fires on **100% of the population including the correct one** — `redact.rs:181` is a match, and `redact.rs` is the module this document tells you to use. A gate with no compliant form to point at is a to-do list, not a ratchet, and its positive control would match zero and fail the runner structurally. The genuine condition here — *"a prefix allowlist with no entropy backstop"* — requires comparing two facts in different parts of a file and is carried as §8 Gap 3 instead. |

The last row is the general limit worth stating: **the census can ratchet a
condition that is present in a literal, and can say nothing about a condition
that is a relationship** — between a pattern and the tokens it must match,
between a redaction call and the fields it must cover, between a ciphertext and
whether it still decrypts. Every largest finding in this document is one of those
relationships, and each was found by **executing something** — replaying the
regexes against real token shapes, scanning 1,140 columns for what is actually
in them, and running one `GROUP BY` that proved the cipher was never the problem.

## 12 Corrections to the brief

The brief primed five leads. **Two are wrong, one is right but misattributed, and
two are right.** All five were tested rather than assumed.

**1. "BYOM API keys are stored in `app_settings`, outside the encrypted
credential path." — WRONG on the storage location, right that they are outside
the encrypted path.** `app_settings.byom_policy` holds a `ByomPolicy`
(`db/src/byom.rs:59`) whose fields are `enabled`, `allowed_providers`,
`blocked_providers`, `routing_rules`, `compliance_rules`. **There is no key field
of any kind**, and the 32 live `app_settings` keys contain no provider
credential. The real BYOM/remote-engine key resolves through
`resolve_api_key` (`src/engine/http_engine/secrets.rs:59`) in this order:
`ModelProfile.auth_token` → **OS keyring** (`personas-desktop` / `qwen-api-key`)
→ **environment variable** (`QWEN_API_KEY`, `DASHSCOPE_API_KEY`). So the lead's
conclusion survives — the BYOM key never enters `persona_credentials` — but the
storage location is a *keyring entry* and an *ambient env var*, which is a
materially different (and mostly better) finding. The one genuinely bad door is
`ModelProfile.auth_token`, and it is consulted **first**; it is now P5.

**2. "`persona_credentials` keeps everything inside `encrypted_data`/`iv`." —
WRONG, and this reframes the whole leaf.** All **25** rows have
`encrypted_data = ''` **and** `iv = ''`. The credential-level blob was retired in
favour of per-field rows in `credential_fields`, and the empty `TEXT NOT NULL`
husk was left behind. Every secret in this vault lives in
`credential_fields.encrypted_value` with its own IV. This matters because
`migrate_plaintext_credentials` (`crypto.rs:1374`) still selects
`WHERE iv = ''` on the retired column at every startup.

**3. "A `metadata` JSON blob sits alongside, and it is NOT encrypted." —
CORRECT.** Measured: 22 distinct top-level keys across 25 rows, 89,613 bytes
total, up to 6,611 per row. It holds healthcheck history (including a
5,488-byte array of verbatim remote-API responses), OAuth lifecycle counters, and
usage telemetry — no key holds a secret by design. It *is* sanitized on write
(`sanitize_ledger_json`), the sanitizer has demonstrably fired (**2 of 25 blobs
carry a `[secret]` marker**), and it has a silent bypass (P3). The lead was right
and the interesting part is the bypass, not the absence of encryption.

**4. "Execution logs contain credential-shaped strings; a `sanitize_secrets` call
was recently added to the logger — find out what it covers." — CORRECT, and the
answer is worse than the framing.** The call is real (`engine/src/logger.rs:61`)
and it is the *weak* redactor: replayed in two engines against synthetic tokens
of twenty shapes, it masks **7 and leaks 13**, and its GitHub rule cannot match a
GitHub token at all because `gh[pous]` omits the `_`. The brief's own log census
(25 PAT-shaped, 58 Google-shaped, 3 PEM) is the confirmation: **the two most
common shapes on disk are both shapes this redactor structurally cannot see.**
Nothing sanitizes the 406 MB already written — the call covers new lines only.
*(I did not re-measure the log directory; those figures belong to
[retention-and-pruning](./retention-and-pruning.md) and I confirmed the column-side
twin instead.)*

**5. "A revoked credential still resolves as `Ready`." — not re-tested; owned
elsewhere, and the encryption-side half is a different and unclaimed defect.**
The readiness verdict belongs to
[credential-readiness-resolution](./credential-readiness-resolution.md) and its
`detached-readiness-verdict` rule. What I *can* add from this leaf is that
nothing in the readiness path verifies that stored ciphertext still **decrypts** —
`verify_field_roundtrip` runs once, at write time, and never again (P2). A
credential whose master key changed underneath it reports `Ready` until it is
used, and that is an encryption-lifecycle defect rather than a status-column one.

**Two corrections to my own first draft, both earned by measurement.**

**(a) I expected the headline to be "the encryption is broken." It is not.** The
nonce is per-write random with zero reuse across 36 rows, the sensitivity
classifier is fail-secure with a backstop that data cannot downgrade, the
inbound/outbound distinction (hash vs encrypt) is right, and the write path
verifies its own round trip. **The cipher was never the problem, and I only know
that because I ran the `GROUP BY` instead of reading `encrypt_for_db`.** A
composer who had only read the code could honestly have written "AES-256-GCM,
looks fine" or "unverified nonce handling, needs audit" — and both would have
missed that 120 credential-shaped values are sitting in five *other* columns.

**(b) I nearly proposed a `Secret` newtype and the qualifications killed it.**
The obvious type-over-gate answer for a leaf about secrets is a non-serializable
wrapper. But Q1 shows it prevents exactly one of this document's nine deviations,
and the 114 values in `tool_steps` were never typed secrets in the first place —
they are characters inside a model's tool-call transcript, where no signature
exists to harden. The type that would actually have helped is `iv TEXT NOT NULL`
**without** `DEFAULT ''`, which is a schema change and which two sibling repos
reached independently. **The strongest type for a leaf about a Rust value turned
out to live in the DDL.**

**And one correction to the corpus's framing, offered upward.** The brief warned
about the `(?:\s|//[^\n]*)*` backtracking bomb and asked for a backtracking check
rather than only a precision check. Doing that check surfaced a second, unrelated
portability hazard worth recording: **the census engine is Node, so its patterns
may use lookarounds that the Rust `regex` crate rejects outright.** This rule's
`(?!_)` is legal in the census and is a hard parse error in ripgrep — meaning a
census signal is not automatically transplantable to a Rust-side checker, and a
composer who validates a pattern with `rg` will get a different answer than the
runner. Worth a line in the doctrine's mechanics section.
