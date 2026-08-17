# Golden path — handling the master key

> Situation node: `integrations-security/vault-security/vault-key-handling` ·
> [situation spine](../situation-spine.md) · recurrence 9 · risk **HIGH** · sides **server** ·
> spine label **convergence: CONVERGED** — **see §12.1; it holds on 3 clauses of 7, is
> INVERTED on one, and the clause carrying this document's headline is a 5/5 silence** ·
> dimensions: **security · resilience · function · code-quality**
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri/` walked by the census engine and by an
> independently-written walker. Read in full: `core/src/crypto.rs` (2,083 lines — every key
> function, both platform arms), `db/src/lib.rs` permission block, `db/src/backup.rs`,
> `db/src/migrations/helpers.rs`, `db/src/repos/communication/events.rs`,
> `db/src/repos/resources/{credentials,rotation}.rs`, `src/engine/{webhook,cloud_webhook_relay}.rs`,
> `src/commands/credentials/{crud,api_proxy}.rs`, `src/commands/core/data_portability.rs`,
> `src/commands/design/n8n_transform/confirmation.rs`, `src/daemon_bin.rs`,
> `src/features/vault/sub_credentials/manager/VaultTrustBadge.tsx`, `.github/workflows/ci.yml`,
> `lefthook.yml`.
>
> **Measured by executing, not reading.**
> 1. A **read-only copy** of the operator's `personas.db` (347 MB, copied 2026-08-16 18:02 while
>    the app was running), queried for every ciphertext-bearing column in all **244** tables.
>    **Deleted after the run.**
> 2. The **on-disk key artefact inspected directly** — size, mtime, prefix, base64 length and
>    DPAPI blob length — and its ACL, its directory's ACL and the database's ACL read with
>    `icacls`.
> 3. **The DPAPI wrapper reproduced from outside the app**, in PowerShell, on **throwaway bytes**:
>    the blob length for a 32-byte payload, whether a *different process running as the same user*
>    can unwrap a null-entropy blob, and what happens when entropy is present or absent. This is
>    how the key file's shape was established without decrypting one byte of it.
> 4. The §9 rule and its positive control built, run in a **private scratch registry**
>    (`vkh-final-rules.json`, a filename unique to this composer), **fault-injected seven ways**,
>    and **re-extracted from this finished document and re-run: identical**. The full registry was
>    **not** run; two neighbouring rules were re-run alone to measure overlap.
> 5. Two independent implementations of every headline count — the census engine (Node `RegExp`)
>    and a separately-written Node walker — agreeing exactly, with all matches hand-opened.
>
> `cargo` was **not** run. **No secret value, prefix, or partial appears anywhere below.** The
> keyring was not read. `master.key` was never decrypted; every statement about it is derived from
> its length, its mtime, its ACL, its 6-byte plaintext marker, and arithmetic on a DPAPI blob
> produced from bytes of this composer's own choosing.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five checkouts exist and were read.

---

## 0. The headline

**The "fallback" key file is not a fallback.** It is written on the **happy path**, on first run,
by the same function that populates the keychain — and it is a second, permanently sufficient copy
of the master key. `try_keychain` (`core/src/crypto.rs:598-609`) generates the key, calls
`save_local_fallback_key` **before** it calls `entry.set_password`, and returns `Ok` whether or not
the keychain write succeeded. The app then reports `key_source: "keychain"` and the UI renders a
green shield.

| where the master key lives on this machine | evidence |
| --- | --- |
| the OS keychain (`personas-desktop` / `credential-master-key`) | `crypto.rs:568`. **Not read** — this document does not open the keyring |
| `%APPDATA%\com.personas.desktop\master.key` | **358 bytes**, marker `DPAPI:`, mtime **2026-04-04 23:18:31**, ACL `DOLLARSTORE\mkdol:(F)`, zero inherited ACEs |

**The file was written once, 134 days ago, and never again.** In that time the ciphertext it
protects grew to **5,008 encrypted values** (36 `credential_fields.encrypted_value` + 4,972
`persona_events.payload`), the app recorded **9,431 `decrypt` operations** in
`credential_audit_log`, and the boot backup job wrote **three full 347 MB copies of the database**
(997 MB in `backups/`, `db/src/backup.rs:144`). **Nothing backs up the key. Nothing versions it.
Nothing rotates it. Nothing ever re-checks that it still decrypts anything.**

### The key file's own shape proves rotation is unrepresentable

Reproduced in PowerShell against **throwaway bytes**, never the real key:

| probe | result |
| --- | ---: |
| `ProtectedData.Protect(<16 bytes>, entropy=null, CurrentUser)` | 246-byte blob |
| `ProtectedData.Protect(<32 bytes>, entropy=null, CurrentUser)` | **262-byte blob** |
| `ProtectedData.Protect(<64 bytes>, entropy=null, CurrentUser)` | 294-byte blob |
| `master.key` on disk | `DPAPI:` (6) + **352 base64 chars** = **262 ciphertext bytes** |
| first 16 bytes of that blob vs the public DPAPI provider GUID | **identical** |

262 bytes wraps **exactly 32 bytes** and nothing else. The on-disk format is a 6-byte ASCII marker
followed by a bare DPAPI blob: **no version byte, no key id, no creation stamp, no salt, no
associated data.** There is no field in which a second key could announce itself, which is the
structural reason §7.B's rotation gap cannot be closed by a job alone.

### What the DPAPI wrapper is actually worth, measured from outside the app

`dpapi_protect` passes `None` for `pOptionalEntropy` (`crypto.rs:1229`), so the wrapper binds to
the user's login and nothing else. Executed proof of what that costs and what the alternative buys:

| probe (throwaway bytes) | result |
| --- | --- |
| **B.** `powershell.exe` — a process that is not Personas, running as the same user — unwraps a null-entropy blob | **succeeds** |
| **C.** the same blob unwrapped with a 4-byte entropy | **fails** |
| **D.** an entropy-bound blob unwrapped with null entropy | **fails** |
| **F.** does adding entropy change the blob length? | **no** — 262 either way, so the file size cannot be used to audit this |

So the honest scope is: **the key file defeats an attacker with the disk and not the user's Windows
password; it defeats nothing that runs as the user** — including every child this app spawns
(see [credential-injection-into-child](./credential-injection-into-child.md) §0). Probe **C/D**
also shows that `pOptionalEntropy` is a real, one-line hardening that would raise the bar from *any
same-user process* to *any same-user process that also knows our constant*.

### The policy is fail-closed at the producer and fail-open at three consumers

`get_master_key` is the best-reasoned function in this territory. It refuses to invent a key
(`crypto.rs:522-531`), it caches **only a success** so one transient keychain failure cannot brick
the process (`:498-503`), and both of those are post-mortems from a 2026-06-07 bug hunt written
into the code. **That policy stops at the function boundary.**

Measured over the **37** production `encrypt*` call sites in 963 `.rs` files (`#[cfg(test)]`
stripped by brace-matched range), classified by what the `Err` arm does:

| what happens when the key is unavailable | sites |
| --- | ---: |
| **the write proceeds and stores the plaintext**, logging `warn!` | **3** |
| the write is refused / rolled back, with the reason written down | **3** |
| the error is propagated by `?` / `.map_err` at the call site | **22** |
| the operation is silently skipped by `if let Ok(...)` | 1 (`api_proxy.rs:184` — declines to migrate a legacy plaintext file; hand-found, no signal reaches it) |
| the remainder | 8 function *definitions*, not call sites |
| — and, one layer up, **the master key is regenerated, overwriting the only copy** | **1** (`derive_fallback_key`, gated on `PERSONAS_ALLOW_FALLBACK_KEY=1`) |

The first row is §9's census rule. The second row is its positive control — **and two of those
three sites state the rule in a comment before implementing it**: *"Never fall back to the original
plaintext on failure … If the keyring is unavailable, skip this persona and surface a warning"*
(`data_portability.rs:6068-6073`). Same repo, same trigger, opposite answers, and the correct
answer is already documented at the correct sites.

**Everything below follows from three facts: the key exists in two independently-sufficient places
and the app reports only one of them; the on-disk format cannot name which key it is; and the
producer's fail-closed policy is not inherited by its consumers.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A key that unlocks a store must be **inventoried, not narrated**. Ask "where
> are all the places these bytes exist?", never "where did I read them from this time". A
> provenance field records the second question and is routinely read as an answer to the first;
> the two diverge the moment a write path populates more than one store, which is the normal case
> because a single store is a single point of failure.
>
> **P2 — physics, and the sharpest clause here.** A ciphertext must carry **the identity of the key
> that produced it**. Without it, "wrong key" and "corrupt record" are the same observation, a
> second key cannot be introduced, and the first rotation is a migration with no rollback. This is
> cheap at design time and unpayable afterwards: retrofitting a key id means rewriting every
> existing record with the key you are trying to retire.
>
> **P3 — physics.** The failure of a cryptographic step must **not** be handled by proceeding
> without the cryptography. A protection routine that returns the unprotected input on error is a
> routine whose security property is contingent on nothing going wrong, which is the one condition
> security exists to survive. State the failure direction of every consumer, not only of the
> producer — a fail-closed producer with a fail-open consumer is a fail-open system.
>
> **P4 — physics.** Never convert *"I cannot read the key"* into *"there is no key"*. Those are
> different facts and only one of them licenses minting a replacement. An error discarded into an
> absent-shaped value at the top of a key-load path is the one bug in this territory that destroys
> data rather than exposing it, because the replacement overwrites the original.
>
> **P5 — physics.** A platform key-wrapping facility that accepts **application-supplied context**
> (entropy, associated data, an encryption context) should be given some. Wrapping bound only to
> the user account is unwrapped by anything running as that user, including code you spawned and
> code you did not.
>
> **P6 — ergonomics, stated as a failure mode.** Copies of the ciphertext accumulate on their own —
> backups, exports, sync, snapshots — and copies of the key do not, because nobody writes a backup
> job for one 300-byte file. The asymmetry runs the wrong way from durability: you end up with N
> recoverable-looking artefacts and one unbacked, unversioned, un-health-checked dependency they
> all share.
>
> **P7 — ergonomics.** A key's protection level must be **verified, not asserted**. Anything an
> operator is shown about key safety should be computed from an operation that would have failed if
> the claim were untrue — a trial decrypt, a canary record — not from a variable set at the moment
> of loading.
>
> **Scale condition.** P2, P3, P4 and P5 are correctness on the first call. P1 and P6 begin to bite
> the moment a second store or a second copy exists. P7 pays the first time someone asks whether the
> vault is safe and expects an answer rather than a badge.

### Warrant evidence — five siblings, censused independently

`personas-web` (no vault, no key — the structural negative control, but the **claims surface**),
`brainiac` (**no credential vault by design** — zero `encrypt`/`decrypt`/`aes`/`pbkdf2` in the
whole Rust workspace; API keys hashed, provider creds read from env at call time),
`personas-cloud` (`MASTER_KEY` env var + PBKDF2-SHA256 600k, per-record salt),
`vibeman` (credentials in `localStorage`, plaintext), `ascent` (`ENCRYPTION_KEY` env var, 32 bytes
verbatim, AES-256-GCM).

- **P4 is convergent, as a 5/5 negative, and Personas is the sole violator in six repos.** No
  sibling generates a key on a read failure. There is no `?? generateKey()`, no `|| randomBytes`,
  no swallow-then-mint anywhere in the five. Both repos with a key fail **closed at boot**:
  `personas-cloud/packages/orchestrator/src/config.ts:39-42` throws
  `Missing required environment variable: MASTER_KEY` and `index.ts:172-175` exits 1;
  `ascent/src/lib/db/org-llm.ts:119-121` returns
  `Secret encryption is not configured (set ENCRYPTION_KEY)` and the API answers 409. **This is the
  strongest single result in the sweep and it is what makes §7.D a defect rather than a design.**
- **P3 is convergent as a *defect*, in the read direction, in both repos that encrypt.**
  `personas-cloud/packages/orchestrator/src/dispatcher.ts:698` skips the entire decrypt block when
  the key is absent and **runs the agent with no credentials**; `:722-724` catches a decrypt failure,
  logs, and continues. `ascent/src/lib/db/org-llm.ts:264-267` is the sharper one and says the quiet
  part out loud — `catch { // Tamper / wrong key / malformed — never crash a scan; fall back to the
  platform provider. return null; }` — so a rotated `ENCRYPTION_KEY` silently reroutes an enterprise
  org's inference **out of the customer's own AWS account into the platform's**, defeating the exact
  property BYOM is sold on. Two independent teams reached the same swallow. **The write-side variant
  this repo has (§7.A) has no sibling instance**, so P3's *read* half is physics and its *write*
  half is a house condition.
- **P2 is convergent as an aspiration and 0/3 as a practice — and Personas is the one that did not
  even ship the marker.** `personas-cloud` stores `(salt, iter)` **per record** beside every
  ciphertext (`db.ts:71-74`, `:284`, `:655-662`) and every decrypt re-derives from the record's own
  parameters (`dispatcher.ts:700-701`, `httpApi.ts:2257-2258`, `tokenManager.ts:17-18`) — a real
  dual-read path, already exercised for pre-migration rows. `ascent` emits a `v1:` prefix on every
  blob (`secret-box.ts:10`, `:41`, enforced `:50`) with the intent stated in the module doc —
  *"Versioned prefix (\"v1:\") leaves room for key rotation"* — though only one version is accepted,
  so it is a placeholder rather than a mechanism. **Neither has a rotation routine; a repo-wide
  `git ls-files | grep -iE 'rotat|rekey'` is empty in both.** Personas has neither the marker nor
  the routine, and its on-disk key format has no field for one.
- **P5 is a 5/5 silence and a fleet-wide blind spot, not a validation.** **Zero `setAAD` calls
  across all five repos**; nothing binds a ciphertext to its owning row, org or record type, so a
  blob moved between records decrypts cleanly everywhere. Personas' `pOptionalEntropy = None` is the
  same omission one layer down, at the key-wrapping layer instead of the record layer. Report it as
  a shared gap; do not report the fix as validated.
- **P7 has one adherent and it is not this repo.** `ascent` computes `encryptionConfigured` and
  threads it to the UI (`api/org/llm-provider/route.ts:1,37` → `LlmProviderSettings.tsx:132`), and
  it also has the only **trial-decrypt** verification in the fleet — `personas-cloud`'s
  `httpApi.ts:2254-2277` `validatePersona` actually decrypts every credential and emits
  *"failed to decrypt — it may be corrupted or encrypted with a different master key"*. **Both are
  on-demand; 0 of 5 verify at boot.**
- **P1 has no external warrant and is offered as an observation.** No sibling has two stores holding
  the same key, because none of them has two stores at all — every one is a single env var or a
  single (absent) vault. The asymmetry P1 names is only visible where a keychain and a file coexist.
- **P6 is a 5/5 silence.** No sibling backs up its ciphertext at all, so none of them can exhibit
  the ratio. Retained because §7.F measures what it costs here: **997 MB of automatic ciphertext
  backups against 358 bytes of unbacked key.**
- **Writing the threat model into the crypto module's own doc is convergent, 2/5, and both wrote it
  where the code is.** `ascent/src/lib/crypto/secret-box.ts:1-6` states the algorithm, the tamper
  behaviour, the rotation affordance, the caller discipline **and** *"FAIL CLOSED: with no/!32-byte
  ENCRYPTION_KEY, isEncryptionConfigured() is false and BYOM is disabled"*.
  `brainiac/console/src/lib/auth.ts:94-103` does the same for its session key, spelling out exactly
  what an attacker gains with and without the secret. **Personas has none** — the gap
  [column-encryption-at-rest](./column-encryption-at-rest.md) §7 P4 opened is still open, and this
  path is where the paragraph belongs.

---

## 1. Trigger

You are in this situation when you are about to type or say any of:

- "where should the encryption key live?" / "use the OS keychain"
- "what if the keychain isn't available?" / "let it fall back to a file"
- "we should rotate the master key" (start by asking whether you *can*)
- "the vault is encrypted, so we're fine" (against *whom*, and for *how long*?)
- "just wrap it with DPAPI / Keychain / libsecret"
- "set `PERSONAS_ALLOW_FALLBACK_KEY=1` to get CI green"
- "what happens if the user's machine changes / they restore a backup / they copy the folder?"
- **If you are about to write `keyring::Entry::new`, `CryptProtectData`, `OnceLock<…Key…>`,
  `fs::write` of key material, an `env::var` that decides whether a key may be created, or an enum
  named `KeySource` — you are in this situation.**
- If you are about to add a **fourth** ciphertext column to this database, you are in this
  situation, because you are adding to the blast radius of one 358-byte file.

### Boundaries with the adjacent paths

- **[`column-encryption-at-rest`](./column-encryption-at-rest.md)** owns the secret **in a column** —
  which column, whether an IV sits beside it, the nonce policy, the redaction pattern sets, and the
  `is_plaintext` **read** branch. **This path owns the key itself** — where it lives, what wraps it,
  whether it can be replaced, and what happens to every one of that path's columns when it cannot be
  read. Its measurements are confirmed and extended, never re-derived; two of its counts are
  corrected in §12.3.
- **[`credential-injection-into-child`](./credential-injection-into-child.md)** owns the capability
  token handed to subprocesses, and measured the `master.key` / `personas.db` ACLs. **Confirmed
  independently and extended**: the *directory* is `DOLLARSTORE\mkdol:(OI)(CI)(F)` with inheritance
  removed, so the whole app-data tree — including the 997 MB of backups — is owner-only. That path
  owns the artefacts in `%TEMP%`; this one owns the artefact in `%APPDATA%`.
- **[`process-global-command-state`](./process-global-command-state.md)** owns `get_cipher`'s
  `OnceLock<Result<…>>` latch (`crypto.rs:1290`) and it is already gated by
  `process-global-caches-a-failure` (3 files / 4 matches). **Confirmed at `2a874e692` and NOT
  re-derived here** — I re-ran that rule alone and its four matches are `auth.rs:155`, `auth.rs:175`,
  `crypto.rs:1290`, `db/src/lib.rs:1939`, with **zero file overlap** with §9's rule. Its relevance to
  this leaf is one sentence: it is the mechanism by which `get_master_key`'s carefully-designed
  retry never runs.
- **[`environment-variable-configuration`](./environment-variable-configuration.md)** owns the shape
  of `std::env::var` hatches in general and already names `PERSONAS_ALLOW_FALLBACK_KEY`. **This path
  owns what that particular hatch does**, which §12.2 shows is not what its own documentation says.
- **[`retention-and-pruning`](./retention-and-pruning.md)** owns the backup rotation policy. This
  path supplies the asymmetry it does not cover: the thing being rotated is the ciphertext, and its
  key is not in the rotation.

---

## 2. The one way

**Treat the key as a versioned, inventoried dependency of every ciphertext you write, not as a
value you fetch.** Concretely: **stamp a key identifier into every record you encrypt** — a
`key_id` column beside the IV, or a version prefix inside the envelope, returned by the encrypt
function itself so no caller can omit it — because that single field is what separates "wrong key"
from "corrupt row", is the entire precondition for ever introducing a second key, and is the one
thing that becomes unpayable later (retrofitting it means rewriting every record with the key you
are retiring). Both sibling repos that encrypt shipped this and neither shipped a rotation job;
**the marker is the part that has to be there first.** **Store the key in the strongest facility
the platform offers, and then write down every other place those bytes also live** — if your load
path populates a second store for resilience, that store is a *copy*, not a fallback, and any
status you show an operator must describe the inventory rather than the last read. **Give the
platform wrapper application context** — `pOptionalEntropy`, `setAAD`, an encryption context — so
the wrapped key is bound to your application and not only to the login session. **Make every
consumer inherit the producer's failure direction**: if `get_key` fails closed, then a caller whose
encryption fails must refuse the write, roll back, or propagate — **never store the plaintext it
was handed**, because that converts an unavailable key into a permanent, silent downgrade of a
column that every reader still believes is ciphertext. **Never turn a read error into an absence**:
`if let Ok(Some(k)) = load_key()` discards the one case — the key is there and you cannot read it —
in which minting a replacement destroys data, and this is the only bug in the territory that loses
information rather than leaking it. **Verify at boot, not at first use**: decrypt one canary record
and surface the result, because a key that stopped working is otherwise discovered by a user
pressing a button weeks later. And **write the threat model into the crypto module's own doc
comment** — what the wrapping binds to, who can unwrap it, and what an attacker with the disk versus
the session gets — the way two sibling repos independently did.

If you must get one thing right first: **the key identifier in the record.** Everything else in
this document can be added later. That one cannot.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `core/src/crypto.rs:497` `get_master_key() -> Result<&'static [u8;32]>` | **The one door.** Fail-closed by default; the local file is opt-in behind an env hatch. Caches **only a success**, so one transient keychain failure no longer bricks the process — `:498-503` records the post-mortem. **It has exactly 2 callers in 963 files** (`get_cipher:1292`, and the dead `try_upgrade_to_keychain:920`), which is why the whole territory is auditable |
| `core/src/crypto.rs:463` `fallback_policy()` | The env hatch parsed in **one** place, so the doc comment, the error string and the runtime branch cannot diverge again. `:450-454` records that they once did — the code fell back unless an undocumented `PERSONAS_DENY_FALLBACK_KEY` was set and never read the variable its own error named |
| `core/src/crypto.rs:478` `legacy_key_migration_allowed()` | The same shape for the second hatch. **Refusing an unauthenticated key file by default** (`:726-733`, `:974-988`): a raw 32-byte or plaintext-base64 `master.key` let anyone who could write the app-data dir plant a known key |
| `core/src/crypto.rs:767` `save_local_fallback_key` | **The correct secret-file write**, and the best four lines in the tree: `NamedTempFile::new_in(parent)` → write → **`restrict_file_permissions` → `persist`**. Permissions set *before* the content is visible at its final path, atomic rename, and `Err` — not a warning — if the ACL cannot be set |
| `core/src/crypto.rs:808` / `:844` / `:854` `restrict_file_permissions` | `icacls /inheritance:r /grant:r <user>:(F)` on Windows, `chmod 0600` on Unix, and an arm for every other platform that **refuses to store the key at all** rather than storing it unprotected |
| `core/src/crypto.rs:325` `ProtectedKey` | `Zeroizing<[u8;32]>` + `VirtualLock`/`mlock`, so the master key cannot reach the pagefile |
| `core/src/crypto.rs:221` `SecureString` | zeroize-on-drop, `[REDACTED]` from `Debug` and `Display`, and **deliberately not `Serialize`** (`:268` says why) |
| `core/src/crypto.rs:1004` `derive_unix_local_key` | HKDF-SHA256 over a **random per-machine secret** + machine-id + uid, with `:1035` kept only to migrate files written under the old deterministic derivation. The random secret is the part that matters: it is what stops an attacker who knows the hostname and uid from deriving the wrapper offline |
| `db/src/lib.rs:1608` `restrict_dir_permissions` / `:1597` `restrict_db_file_permissions` | The app-data **directory** and the db + WAL + SHM hardened to owner-only. Verified live: the directory is `(OI)(CI)(F)` with **no** `(I)`, so `backups/` and `logs/` inherit owner-only and nothing else |
| `db/src/repos/resources/rotation.rs` (16 fns) + `credential_rotation_policies` + `credential_rotation_history` | **A complete rotation subsystem — for credentials.** Policies with an interval and a next-due timestamp, history rows, consecutive-failure counting, backoff retry (`:312`), auto-disable (`:344`), anomaly detection. **The pattern this repo needs for its key already exists in this repo, applied to everything the key protects** |
| `scripts/census/` | the ratchet mechanism. §9 |

**Do not exist — this path names them:**

- **Any key identifier on any ciphertext.** Zero `key_version` / `key_id` / `kid` /
  `encryption_version` columns across **244 tables**; the three IV columns
  (`credential_fields.iv`, `persona_credentials.iv`, `persona_events.payload_iv`) have no sibling
  naming the key. The on-disk key file has no field for one either (§0).
- **Any master-key rotation path.** `try_upgrade_to_keychain` (`:915`) moves the *same bytes* to a
  different *store* and its own doc comment says so — *"no credential re-encryption is needed
  because the encryption key itself doesn't change"* — and it is `#[allow(dead_code)]` with **zero
  callers**.
- **Any post-write verification that stored ciphertext still decrypts.** No canary, no boot check,
  no `vault_status` field. `verify_field_roundtrip` (`credentials.rs:1383`) runs inside the write
  and never again.
- **Any inventory of where the key bytes exist.** `KeySource` names the store one read came from.
- **Any backup of the key**, against three automatic backups of the ciphertext.
- **A written threat model.** Still absent, one leaf later.

---

## 4. Steps

1. **Before anything else, decide what identifies the key** — a `key_id` column beside the IV, or a
   version tag inside the envelope. Make the encrypt function *return* it so it cannot be omitted.
   If you skip this step you have decided, permanently, that the key can never be replaced.
2. **Pick the store, then enumerate the copies.** If your load path writes a second store for
   resilience — and it should — say so in the module doc and in whatever status you surface. A
   second store is a copy with an equal ACL, not a weaker tier.
3. **Give the platform wrapper application context.** `pOptionalEntropy` on Windows, `setAAD` on the
   record cipher, an encryption context on a KMS. It costs one constant.
4. **Write the key file through the atomic-write helper**: temp file in the same directory, write,
   **harden, then `persist`**. Return `Err` if the ACL cannot be set. Never chmod after the rename.
5. **Choose the failure direction once, at the top, and make every consumer inherit it.** If the key
   door fails closed, then every `Err` arm downstream refuses, rolls back, or propagates. Grep your
   own encrypt call sites for an error arm that mentions the value you handed in — that is the
   §9 signal and you can run it by eye.
6. **Never `if let Ok(...)` a key load.** Match all three outcomes explicitly: present, absent,
   unreadable. Only *absent* licenses minting. *Unreadable* must be loud, must not overwrite, and
   must be recoverable — the original file is evidence.
7. **Add a boot canary.** One row, encrypted at install, decrypted at every start, counted on the
   status surface beside the counters already there (`legacy_ipc_decrypt_calls`,
   `credential_audit_write_failures`). Two sibling repos have a trial decrypt; neither runs it at
   boot, so this is where to be ahead rather than behind.
8. **Back up the key with the same cadence as the ciphertext, or state in writing that you don't.**
   Three database backups and zero key backups is a decision; make it one.
9. **Write the threat model into the crypto module's doc comment.** What the wrapper binds to, who
   can unwrap it, what the disk-theft attacker gets and what the same-user attacker gets.
10. **And then stop.** The nonce policy, the sensitivity classifier and the redaction patterns belong
    to [column-encryption-at-rest](./column-encryption-at-rest.md); the child's environment belongs
    to [credential-injection-into-child](./credential-injection-into-child.md). Do not re-derive
    either.

### Can the type make the wrong call impossible? — asked before §9

**Yes for step 1, and no for step 5.** Both answers are worked in "Type over gate", below §9 — and
the *no* is the reason §9 exists.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| **A ciphertext with no key identifier** | "wrong key" and "corrupt record" become the same observation, and a second key can never be introduced. **Measured: 0 key-id columns in 244 tables, 5,008 encrypted values, 1 key, 0 rotations in 134 days.** Both sibling repos that encrypt shipped a marker; neither shipped a rotation job — **the marker is the half that has to exist first** |
| **Calling the second store a "fallback"** | It is written on the happy path and is independently sufficient. **Measured: `try_keychain:598-609` writes the file *before* the keychain, and `master.key` on this machine is dated the day of install** |
| **Reporting the store you read from as the protection level** | The read that populated a second store looks identical to the read that did not. **Measured: two paths in `try_keychain` return `Ok` without the keychain holding the key — `:590-596` (loaded from the file, backfill may have failed with only a `warn!`) and `:605-608` (`set_password` failed, `warn!`, `Ok(key)`) — and both are recorded as `KeySource::Keychain` and rendered as a green shield** |
| **`if let Ok(Some(k)) = load_key()`** | Discards *"the key is there and I cannot read it"* — the only case in which minting a replacement destroys data — then mints and overwrites. **Measured: 1 site (`crypto.rs:629`), reachable whenever the fallback hatch is set. 0 of 5 sibling repos do this** |
| **An `Err` arm that hands back the value it was asked to protect** | The column is ciphertext to every reader and plaintext on disk, forever, with a `warn!` as the only trace. **Measured: 3 sites, byte-identical; the compliant form is written twice in the same tree with the rationale attached** |
| **`env::var` deciding whether a key may be created, documented as a confidentiality trade** | The variable's real effect is on the **failure direction**, which is a durability property, and the doc, the error string and the CI comment all describe the other axis. **Measured: §12.2** |
| **Wrapping the key with no application context** | Any process running as the user unwraps it. **Measured by execution: `powershell.exe` unwrapped a null-entropy blob produced by another process as the same user; the same blob with entropy failed** |
| **Backing up the ciphertext and not the key** | Every backup is equally undecryptable after one file is lost. **Measured: 997 MB across 3 automatic snapshots, 358 bytes unbacked** |
| **Verifying the key only when a user needs it** | A key that stopped working is discovered by a failed action weeks later. **Measured: 9,431 recorded decrypts, 0 boot checks, 0 canaries, and `vault_status` reports `key_source` — which is set at load time and cannot fail** |
| **A key-management module with 0 key-management tests** | The tests exercise the cipher and therefore *consume* the key path without *testing* it. **Measured: 14 `#[test]`s in `crypto.rs`; 0 name a keychain, a fallback, DPAPI, a permission, or a rotation** |

---

## 6. Evidence

**The one site to copy: `core/src/crypto.rs:767-802` `save_local_fallback_key`.** Protect →
temp file in the same directory → write → flush → **`restrict_file_permissions(tmp.path())?`** →
`persist`. Permissions are set before the content is visible at its final path, the whole function
returns `Err` if the ACL cannot be set, and the rename is atomic. It is the correct answer to "write
a secret to disk" and it is the reason `master.key`'s ACL is right today.

Also exemplary, each for one property:

| site | the property to copy |
| --- | --- |
| `core/src/crypto.rs:498-503` | **Caching only the success.** Four lines of comment naming the exact prior failure ("bricked all credential encrypt/decrypt for the whole process, recoverable only by restart") and the structural fix (`OnceLock<ProtectedKey>` instead of `OnceLock<Result<…>>`). This is what a post-mortem looks like when it lands in the type |
| `core/src/crypto.rs:449-469` | **One parse site for a policy env var**, with the doc comment recording that the previous code documented one policy and implemented the opposite. A `FallbackPolicy` enum instead of a bare `bool` on a `==` |
| `core/src/crypto.rs:853-858` | The `#[cfg(not(any(windows, unix)))]` arm that **refuses to store the key** rather than storing it unprotected. A platform you have not implemented is a platform you fail closed on |
| `core/src/crypto.rs:996-1030` | **A random per-machine secret mixed into a machine-bound HKDF**, with the doc comment explaining precisely what the randomness buys over machine-id + uid alone ("prevents offline derivation by attackers who only know the hostname and UID") |
| `core/src/crypto.rs:1152-1200` | A **legacy derivation kept solely to migrate**, with an atomic flag that triggers re-encryption under the hardened derivation on the next load. A deprecation that upgrades data as it touches it |
| `db/src/migrations/helpers.rs:116-127` | **The compliant failure direction, with a rollback**: on an encrypt error, `credential_ok = false; break;` — the whole credential rolls back and *"the blob (untouched here) survives intact for the next attempt"* |
| `src/commands/core/data_portability.rs:6068-6073` · `src/commands/design/n8n_transform/confirmation.rs:86-90` | **The rule of §9 stated in prose before being implemented**, twice, independently: *"Never fall back to the original plaintext on failure: downstream reads treat this column as ciphertext, so persisting plaintext would leak webhook secrets / Slack tokens / SMTP passwords on disk and break decryption on every subsequent read. If the keyring is unavailable, skip this persona and surface a warning so the user can re-import once it's healthy."* |
| `db/src/repos/resources/rotation.rs:312` `schedule_failed_retry` · `:344` `disable_policy` · `:281` `get_consecutive_rotation_failures` | **What rotation machinery looks like when this team builds it.** Backoff, failure counting, auto-disable, history rows. It exists for credentials and not for the key that encrypts them |

### The key, measured (2026-08-16)

| | value |
| --- | ---: |
| `master.key` size / marker | **358 bytes** / `DPAPI:` |
| …base64 payload / DPAPI blob | **352 chars** / **262 bytes** — arithmetically exactly a 32-byte plaintext |
| …mtime | **2026-04-04 23:18:31** (134 days before this sweep) |
| …ACL | `DOLLARSTORE\mkdol:(F)`, 0 inherited ACEs |
| `personas.db` ACL | `DOLLARSTORE\mkdol:(F)` — **identical** |
| app-data **directory** ACL | `DOLLARSTORE\mkdol:(OI)(CI)(F)`, **no `(I)`** — inheritance removed, so `backups/` and `logs/` are owner-only by inheritance from it |
| DPAPI `pOptionalEntropy` | `None` (`crypto.rs:1229`) |
| DPAPI `dwFlags` | `0` — **user-scoped, not `CRYPTPROTECT_LOCAL_MACHINE`** ✔ |
| keychain service / account | `personas-desktop` / `credential-master-key` (`:568`) — **not read** |

### What that one key holds

| store | rows | encrypted | scheme |
| --- | ---: | ---: | --- |
| `credential_fields.encrypted_value` | 42 | **36** (`is_sensitive=1`, 36 distinct IVs, 0 sensitive-plaintext) | `(value, iv)` column pair |
| `persona_events.payload` | 4,972 | **4,972** (4,972 distinct `payload_iv`, **0** null or empty) | `(payload, payload_iv)` column pair |
| `personas.notification_channels` | 73 | 0 | `<key>_enc` / `<key>_iv` inside JSON |
| `persona_triggers.config` | 351 | 0 | same |
| `persona_credentials.encrypted_data` | 25 | 0 (all `''`, retired husk) | `(data, iv)` column pair |
| **total under one key** | | **5,008** | **three schemes, zero key identifiers** |

Written between **2026-04-06** and **2026-08-14**; **9,431** `decrypt` operations recorded in
`credential_audit_log` between 2026-05-19 and 2026-08-16, peaking at 5,886 in June.

### Rotation, measured

| | value |
| --- | ---: |
| key-version / key-id / kid / encryption-version columns, 244 tables | **0** |
| master-key rotation routines in 963 `.rs` files | **0** |
| `try_upgrade_to_keychain` callers | **0** (`#[allow(dead_code)]`) |
| `credential_rotation_policies` rows / enabled | 2 / **0**, both `oauth_keepalive`, both overdue since 2026-06-11 |
| `credential_rotation_history` rows | **2** — both `rotation_type='anomaly'`, both `status='failed'` |
| …rows of any non-anomaly rotation, ever | **0** |
| `master.key` rewrites since install | **0** |

### Two independent implementations

| | census engine (Node `RegExp`) | independent Node walker |
| --- | ---: | ---: |
| `.rs` files walked under `src-tauri` | 963 | 963 |
| §9 rule — `Err` arm reproduces the encrypted binding | **3 files / 3 matches** | **3 files / 3 matches** |
| §9 positive control — `Err` arm does not | **3 / 3** | **3 / 3** |
| sub-anchor — encrypt call with any `Err` arm | 6 | **6** |
| all encrypt calls with a simple named argument | 50 | 50 |

All 6 anchor matches were opened by hand; agreement is reported, not relied on.

### Convergence — five siblings, run 2026-08-16

All five checkouts exist and were read. Nothing is reported by omission.

| clause | brainiac | personas-cloud | ascent | vibeman | personas-web | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| has a master key at all | ✗ by design | ✔ env | ✔ env | ✗ (plaintext localStorage) | ✗ | 2 of 5 |
| OS-facility wrapping (DPAPI/keychain/safeStorage) | n/a | **✗ plaintext env** | **✗ plaintext env** | n/a | n/a | **0 of 5 — Personas is AHEAD** |
| KDF | n/a | PBKDF2-SHA256 **600k**, random per-record salt | none — 32 bytes verbatim | n/a | n/a | 1 of 2 |
| application context bound into the wrapper (`setAAD`/entropy) | n/a | **✗** | **✗** | n/a | n/a | **SILENCE 5/5 — shared blind spot** |
| **key identifier beside the ciphertext** | n/a | ✔ per-record `(salt, iter)` + real dual-read | ✔ `v1:` prefix (one version accepted) | n/a | n/a | **2 of 2 — Personas is BEHIND at 0** |
| an actual rotation routine | n/a | ✗ | ✗ | n/a | n/a | **0 of 3 — physics by absence** |
| fail-closed when the key is absent | n/a | ✔ boot throws + exit 1 | ✔ write refused, API 409 | n/a | n/a | **2 of 2** |
| **mints a key on a read failure** | ✗ | ✗ | ✗ | ✗ | ✗ | **0 of 5 — Personas is the SOLE violator in six** |
| swallows a **decrypt** failure into silent degradation | n/a | ✔ `dispatcher.ts:698,722-724` | ✔ `org-llm.ts:264-267` | n/a | n/a | **2 of 2 — convergent defect** |
| threat model in the crypto module's own doc | ✔ `auth.ts:94-103` | ✗ | ✔ `secret-box.ts:1-6` | ✗ | ✔ (docs, about *this* app) | **2 of 5 in code — Personas has none** |
| trial-decrypt verification | n/a | ✔ on demand `httpApi.ts:2254-2277` | ✔ on demand | n/a | n/a | 2 of 2, **0 at boot** |
| key-state indicator for an operator | ✗ | partial | ✔ `encryptionConfigured` | ✗ | marketing copy | 1 of 5 |

**Three results this document rests on.**

**(a) Nobody mints a key on a read failure, and the two repos that could have made the opposite
choice both fail closed instead.** This is the cleanest negative in the sweep: five independent
codebases, zero instances of the pattern at `crypto.rs:629`. §7.D is therefore a defect, not a
platform necessity.

**(b) The key identifier is convergent and Personas is the one that skipped it.** `personas-cloud`
stores `(salt, iter)` per record and re-derives from the record's own parameters on every decrypt —
a dual-read path already exercised for pre-migration rows. `ascent` writes `v1:` on every blob and
its module doc says why. **Neither wrote a rotation job**, which is the instructive part: the marker
is what you ship on day one and the job is what you ship when you need it. Personas has 5,008
ciphertexts and no marker.

**(c) Personas is AHEAD on the wrapping and it must be reported as ahead rather than validated.**
No sibling wraps its key with any OS facility — both implementing repos hold a plaintext hex or
base64 key in an env var, and `ascent`'s is not even in the tracked `.env.example`. `master.key`'s
DPAPI wrapper plus the keyring plus the HKDF-with-random-machine-secret Unix arm is the best key
storage in the six-repo sample. **That is exactly why §7.C's fix is "add four bytes of entropy",
not "build key storage".**

**One sibling hazard worth importing, and one claim worth reporting upward.**
`ascent/src/lib/db/org-llm.ts:264-267` is the sharpest instance of P3 in the fleet and its comment
names the trade honestly — *"never crash a scan; fall back to the platform provider"*. Import the
shape as a warning, not the choice.

And **`personas-web` publishes three claims about this leaf that the code does not support**
(reported, not edited — sibling repos are report-only). `src/data/guide/content/credentials.ts:46-47`
states *"If the keyring is wiped (factory reset, account deletion), the vault becomes
unrecoverable"* — **false on Windows**, because `try_keychain`'s `NoEntry` branch loads `master.key`
and backfills the keychain (`crypto.rs:588-596`), so a wiped keychain entry costs nothing. `:52`
states *"Vault security is binary: it's either intact … or broken. There's no 'weak' intermediate
state"* — **false**: `KeySource::LocalFallback` is exactly that state, the UI has a dedicated
`fallback_key_detail` string for it, and `PERSONAS_ALLOW_FALLBACK_KEY=1` is the switch that produces
it. And *"the wrapping key lives in the OS keyring and isn't portable"* (`:14`, `:22`, and
`src/data/security.ts:33-36`, localized into 10+ locales) omits the second, equally-sufficient copy
on the same disk. The non-portability half is **true and is worth keeping** — probe C/D confirms
DPAPI does not travel — but the inventory is wrong.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below reduces to one fact, and it
> is not "someone forgot a check". **This repo models the master key as a value to fetch, not as a
> dependency to inventory and version.** That model is why a second copy is called a fallback; why
> the status surface reports a read rather than an inventory; why 5,008 ciphertexts carry no key
> identity; why the ciphertext is backed up three times and the key zero; and why the one function
> that reasons carefully about failure direction is the only one that does. **The edit that closes
> the most entries below is a key identifier in the encrypt/decrypt envelope**, because it makes
> "which key is this" a question the system can answer at all.

### 7.A P0 — three encrypt sites store the plaintext when the key is unavailable

| Path | What's wrong |
| --- | --- |
| `db/src/repos/communication/events.rs:96-101` | `encrypt_optional_payload`: `Err(e) => { warn!("Failed to encrypt event payload, storing plaintext: {}", e); (Some(plaintext.clone()), None) }` |
| `src/engine/webhook.rs:584-589` | Byte-identical block, inline, on the inbound-webhook event insert |
| `src/engine/cloud_webhook_relay.rs:500-505` | Byte-identical block, inline, on the cloud-relay event insert |

`persona_events` holds **4,972 rows, 4,972 with a distinct non-empty `payload_iv`, 0 plaintext** —
so the branch has never fired on this installation. **The class is one key failure away**, the
condition that fires all three at once is a single condition (`get_master_key` returned `Err`), and
the resulting row is indistinguishable from a legitimately-plaintext one at every reader:
`events.rs:531` and `src/cloud/sync/rows.rs:115` and `src/commands/teams/team_channel.rs:255` all
carry `(Some(pt), _) => pt` — *"plaintext fallback (encryption disabled/failed)"* — so a downgraded
row reads back cleanly, forever.

**Fix — copy the two compliant sites in this tree.** `data_portability.rs:6076` pushes a warning and
`continue`s; `n8n_transform/confirmation.rs:93` drops the transaction, records a `rolled_back` status
row, and returns `Err`. For an event the right choice is to **fail the insert**: a webhook that
cannot be stored safely should be retried by the delivery layer, which `webhook.rs:597-600` already
documents as the design for a genuine DB error. Three `Err` arms, no new code.

### 7.B P0 — 5,008 ciphertexts carry no key identity, so rotation is unrepresentable

| Path | What's wrong |
| --- | --- |
| `core/src/crypto.rs:1302` `encrypt_for_db -> (String, String)` | Returns a structurally anonymous `(ciphertext, nonce)` pair. Nothing names the key |
| `core/src/crypto.rs:1317` `decrypt_from_db(ct, nonce)` | Takes the same anonymous pair. A caller cannot ask "was this mine?" |
| `db/src/migrations/schema.rs` — `credential_fields.iv`, `persona_credentials.iv`, `persona_events.payload_iv` | Three IV columns, **zero** key-id siblings, across 244 tables |
| `crypto.rs:767-802` — the on-disk key format | `DPAPI:` + a bare 262-byte blob. **Measured: no version byte, no id, no stamp, no room for one** |

**Consequence, stated precisely.** A wrong key produces `CryptoError::Decrypt("aead::Error")` — a
*clean* failure, never silent garbage, because GCM's tag is checked before any plaintext is returned
(`crypto.rs:1331-1333`). That is the good half. The bad half is that the message names neither the
key nor the row, and there is no field that could distinguish *"encrypted under the previous key"*
from *"this row is corrupt"* — so a partial rotation would be indistinguishable from data loss, and
therefore cannot be attempted.

**Fix, in the order that matters:** (1) add `key_id TEXT` beside each IV, defaulted to a constant
naming today's key, and have `encrypt_for_db` return it so no call site can omit it (§9, Type 1);
(2) teach `decrypt_from_db` to select a key by id, which makes a dual-key read path expressible;
(3) only then write the rotation job — the two sibling repos that shipped step 1 and skipped step 3
are in a strictly better position than this one.

### 7.C P1 — the DPAPI wrapper carries no application entropy

`crypto.rs:1229` passes `None` for `pOptionalEntropy`. **Measured by execution** (probes B/C/D,
throwaway bytes): a null-entropy blob is unwrapped by any process running as the user — proved by
unwrapping one from `powershell.exe` — and the same blob with a 4-byte entropy is not.

**Fix:** a module constant passed as `pOptionalEntropy` to both `CryptProtectData` and
`CryptUnprotectData`, with a one-time re-wrap on load for files written without it (the exact shape
`crypto.rs:1152-1200` already implements for the Unix legacy derivation). It raises the bar from
*any same-user process* to *any same-user process that also reads our binary* — small, real, and
**the fleet is silent on this at every layer (0 of 5 use `setAAD` either)**, so it is a place to be
ahead rather than a place to catch up.

### 7.D P1 — a read error on the key file is discarded, and the replacement overwrites the evidence

```rust
// core/src/crypto.rs:627-650
fn derive_fallback_key() -> [u8; 32] {
    if let Ok(Some(existing)) = load_local_fallback_key() {   // ← Err falls through
        …
        return existing;
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    if let Err(e) = save_local_fallback_key(&key) { tracing::error!(…); }   // ← overwrites master.key
    …
}
```

`load_local_fallback_key` returns `Err` — not `Ok(None)` — for **five distinct causes**: a
non-permission I/O error (`:700-705`), a base64 decode failure (`:712`), a `platform_unprotect`
failure (`:713` — i.e. the file was copied from another machine or user, or DPAPI was invalidated),
a wrong key length (`:742-748`), and an unauthenticated legacy file with the migration hatch unset
(`:726-733`). **`if let Ok(...)` collapses all five into "there is no key"**, and the function then
mints a fresh one and writes it over the original. Every one of the 5,008 ciphertexts becomes
permanently undecryptable, and the artefact that could have been recovered is gone.

`load_local_fallback_key` itself gets the *permission* case right — it repairs, retries, and only
then deletes (`:675-698`), a deliberate and correct piece of recovery. **The caller discards the
distinction that function worked to preserve.**

**Reachability:** only under `FallbackPolicy::Allow`, i.e. `PERSONAS_ALLOW_FALLBACK_KEY=1` — see
§12.2 for exactly who can set it. **Convergence: 0 of 5 sibling repos mint a key on a read failure.**

**Fix:** match all three outcomes. `Ok(Some(k))` → use it. `Ok(None)` → mint. `Err(e)` → **return
the error and do not write**. The existing file is evidence and must survive.

### 7.E P1 — `key_source` reports which store one read came from, and the UI renders it as protection level

| Path | What's wrong |
| --- | --- |
| `core/src/crypto.rs:588-596` | `NoEntry` → load from `master.key` → backfill the keychain, **failure is a `warn!`** → `return Ok(local_key)`. `get_master_key:513` then records `KeySource::Keychain`. The `info!` one line above says *"Master key loaded from local fallback key file"* |
| `core/src/crypto.rs:598-609` | Generate → **`save_local_fallback_key` first** → `entry.set_password`, **failure is a `warn!`** → `Ok(key)`. Same recording |
| `core/src/crypto.rs:410-417` | `KeySource::Keychain` is documented *"(most secure)"*; `LocalFallback` *"(fallback for missing keychain)"* — a tier ordering the write path does not establish |
| `src/commands/credentials/crud.rs:431` | `vault_status` returns `key_source` — a **public command, no IPC token required** |
| `.../manager/VaultTrustBadge.tsx:52,89-93` | `const fallbackKey = status.key_source !== 'keychain'` selects between `keychain_title`/`keychain_detail` and `fallback_key_title`/`fallback_key_detail`, the latter with `warn` styling. The component's own docstring claims it *"reflects the OS-keychain vs machine-fallback master-key state accurately"* |
| `.../components/forms/FormActions.tsx:46` | The same ternary picks `Encrypted with OS Keychain` vs `Encrypted at rest` |

The rendered copy is `en.json` → `vault.vault_badge.keychain_detail`: *"Your master encryption key is
stored in the Windows Credential Manager (or macOS Keychain), protected by your OS login."* **On
this machine that sentence is true and incomplete**: the key is *also* in `master.key`, DPAPI-wrapped
with no application entropy, in the same directory as the database, under an identical ACL. And on
either of the two paths above it can be true of the *file only*.

**Fix:** report the inventory, not the read. `vault_status` gains `key_in_keychain: bool` and
`key_file_present: bool`, both computed by probing (existence, not content), and the badge describes
both. That is one Rust function and one string.

### 7.F P2 — three automatic backups of the ciphertext, zero of the key

`db/src/backup.rs:144` snapshots the database on every boot and keeps `MAX_BACKUPS = 3`. Measured:
`backups/` holds **3 × 347 MB = 997 MB**, newest 2026-08-16 17:51. `SIDECAR_EXTENSIONS` copies the
WAL and SHM. **`master.key` is not in the set**, and no other code path copies it.

Not a confidentiality defect — the backups inherit the app-data directory's owner-only ACL, verified
with `icacls`. It is a **durability inversion**: four independent copies of the ciphertext, one copy
of the key, and the key is the artefact with no version, no health check and a `derive_fallback_key`
that overwrites it (7.D).

**Fix:** either copy `master.key` alongside the snapshot (through
`save_local_fallback_key`'s hardening path, never `fs::copy`), or state in `backup.rs`'s module doc
that a snapshot is only restorable on a machine whose keychain still holds the key. Both are
defensible; the current state is neither, because nobody chose.

### 7.G P2 — nothing ever re-verifies that the stored ciphertext still decrypts

`verify_field_roundtrip` (`credentials.rs:1383`) is the only decrypt-and-compare in the tree and it
runs inside the write. Nothing afterward checks: not boot, not the healthcheck sweep, not
`vault_status`. A key that stopped working is discovered when `get_decrypted_fields`
(`credentials.rs:1449`) fails at first use — and **6 of the 8 call sites that reach it swallow the
error into an absence** (`.ok()` / `.unwrap_or_default()`: `discord_poller.rs:675`,
`slack_poller.rs:1203`, `kpi_binding.rs:435`, `runner/credentials.rs:310`,
`data_portability.rs:9362`, `:9585`), so a wrong key presents to the user as *"this credential has
no fields configured"*.

**This is where P7 and the `Ready` verdict meet**, and it is the encryption-lifecycle half that
[credential-readiness-resolution](./credential-readiness-resolution.md) does not cover:
[column-encryption-at-rest](./column-encryption-at-rest.md) §7 P2 named the gap; this path names the
consequence. **Fix:** one canary row written at install and decrypted at boot, counted on
`vault_status` beside `legacy_ipc_decrypt_calls` and `credential_audit_write_failures`. The counter
pattern is already in the file twice.

### 7.H P2 — the key-management module has 14 tests and none of them manage a key

`crypto.rs:1867-2083` contains 14 `#[test]`s: encrypt/decrypt round-trip, unique nonces, wrong
nonce, tampered ciphertext, empty string, hybrid RSA, unicode, `is_plaintext`, and four
trigger-config cases. **Zero name `get_master_key`, `try_keychain`, `load_local_fallback_key`,
`save_local_fallback_key`, `derive_fallback_key`, `fallback_policy`, `restrict_file_permissions`,
`dpapi_protect` or `try_upgrade_to_keychain`.** A repo-wide grep for a test function naming a
keychain, a fallback key, DPAPI or a master key returns **0**.

The sharpest form of this: **the reason CI needed `PERSONAS_ALLOW_FALLBACK_KEY=1` is that all 14
cipher tests need a master key to run at all** — and not one of them tests the thing the flag
changes. The hatch was added to make tests that *consume* the key path go green.

**Fix:** three tests that need no keychain. (1) `fallback_policy()` returns `Deny` for unset, `"0"`,
`"true"`, and `Allow` only for `"1"`. (2) `load_local_fallback_key` on a corrupted file returns
`Err`, and the file is **still on disk afterwards**. (3) `restrict_file_permissions` on a temp file
returns `Ok` and the resulting ACL grants exactly one principal. All three are pure filesystem tests.

### 7.I P3 — two dead or unreachable key affordances

`try_upgrade_to_keychain` (`:915`) is `#[allow(dead_code)]` with **0 callers** — the one function
whose name suggests key lifecycle moves the same bytes to a different store and cannot be invoked.
`KeySource` derives `Serialize` but the only surface is `key_source_label()`'s three strings, so the
enum's `#[derive(Serialize)]` has no consumer. Neither is a bug; both are the shape of a lifecycle
that was designed and never wired.

### 7.J What this path CLEARED

- **"A wrong key produces silent garbage."** **No.** `decrypt_from_db` (`crypto.rs:1331-1333`)
  checks the GCM tag before returning anything, so a wrong key yields `CryptoError::Decrypt` and
  never a corrupted plaintext. The nonce length is validated separately at `:1323`. **The cipher's
  failure behaviour is correct; the problem is that the error is opaque (`aead::Error`) and that six
  call sites convert it into an absence (7.G).**
- **"The keychain is the strong store and the file is the weak one."** **No** — they are two copies
  of the same 32 bytes, and on Windows both are unwrappable by any process running as the user. The
  meaningful difference is that the file is also readable by an attacker with the *disk*, and only
  if they also have the user's Windows password.
- **"`master.key` is the single point of failure."** **Not quite** — either store alone is
  sufficient, so losing one costs nothing (which is why `personas-web`'s "keyring wiped → vault
  unrecoverable" claim is wrong). Losing **both** is total, and 7.D is a path that destroys one of
  them without being asked to.
- **"The app-data directory is world-readable / inherits a group."** **No.** Verified with `icacls`:
  the directory is `DOLLARSTORE\mkdol:(OI)(CI)(F)` with inheritance removed, and `backups/` and
  `logs/` inherit exactly that. This is materially better than `%TEMP%`, where
  [credential-injection-into-child](./credential-injection-into-child.md) §0 measured a group
  containing two other accounts.
- **"`get_cipher`'s `OnceLock<Result<…>>` is a finding of this leaf."** **No** — it is already
  measured, gated (`process-global-caches-a-failure`, 3 files / 4 matches, re-run alone at
  `2a874e692`) and owned by [process-global-command-state](./process-global-command-state.md) §A.
  Confirmed and deferred.

---

## 8. Gaps in the primitives

### 8.1 A key identifier cannot be retrofitted without the key it is meant to retire

Adding `key_id` to 5,008 existing rows requires reading them, which requires the current key. That is
fine *today* and impossible on the day the key is gone — which is precisely the day you want it. So
this is not a gap that gets better by waiting; it is the one item in this document whose cost rises
monotonically. **Both sibling repos that encrypt paid it on day one.**

### 8.2 No cipher can protect a key that lives beside its ciphertext under the same ACL

Named in [column-encryption-at-rest](./column-encryption-at-rest.md) §8.1 and confirmed here by
execution rather than by reading: a same-user process unwrapped a DPAPI blob. The available levers
are application entropy (7.C — raises the bar, does not remove it), a user passphrase (destroys
unattended operation, which this app requires), or hardware. **The gap is not a missing lever; it is
the missing sentence naming which lever was chosen.**

### 8.3 `KeySource` cannot express "both", and no type can compute it

The enum has two variants and the load path can populate two stores. But the honest inventory is not
derivable from a load: the keychain write is best-effort (`warn!` on failure), so after
`try_keychain` returns, the process genuinely does not know whether the keychain holds the key. The
only way to know is to **probe**, which is an operation, not a type. 7.E's fix is therefore two
booleans computed by probing, not a third enum variant.

### 8.4 The census cannot assert an absence, and every largest finding here is one

"No ciphertext lacks a key id", "no rotation has ever run", "nothing verifies the key at boot", "the
key is not in the backup set" are completeness conditions. The engine ratchets occurrences of a bad
shape. §9 gates the one condition in this document that is *present in a literal* — a failure arm
that hands back its input — and says so. The rest are answered by the value scan and the file
inspection in §6, and those must be **re-run**, not baselined.

### 8.5 A DPAPI-wrapped file cannot be audited from outside for its entropy

Probe **F**: entropy does not change the blob length, and the blob is opaque. So there is no way to
verify from disk that `pOptionalEntropy` was supplied — only the source can tell you, and only a
successful unwrap with the wrong entropy could disprove it. **A security property that leaves no
observable trace cannot be gated, only reviewed.** If 7.C lands, its evidence must be a test, not an
inspection.

### 8.6 `credential_audit_log` records 9,431 decrypts and cannot answer "under which key"

The schema is `(credential_id, credential_name, operation, persona_id, persona_name, detail,
created_at)`. Every one of those 9,431 rows is a successful use of one key, and none of them names
it. When a second key exists this table becomes the natural place to notice a mixed population, and
it has no column for that. **Adding `key_id` to the audit row is the same edit as 7.B and should
land in the same change.**

---

## 9. The missing gate

### Where it runs

`npm run census:check` is wired into **two** places on this machine: `npm run check` — the local
aggregate gate, which chains it before `tsc` and `eslint` — and the **`golden-path-census` pre-push
job in `lefthook.yml`**, added 2026-08-16 with a comment recording that the census "was enforced
NOWHERE" before that. So this rule executes on every developer push, before the branch leaves the
box. It is **not** relied on in CI, which per this batch's calibration is currently red on 10
pre-existing failures and therefore runs nowhere. Verified by exit code, never through a pipe.

### Checked first — the existing 125 census rules

I read every rule id in `scripts/census/rules.json` and checked these by name:

| Rule | Overlaps? |
| --- | --- |
| `process-global-caches-a-failure` (3 / 4) | **The closest neighbour, and disjoint.** Re-run alone at `2a874e692`: `auth.rs:155`, `auth.rs:175`, `crypto.rs:1290`, `db/src/lib.rs:1939`. **Zero file overlap** with my 3. It gates a `static … OnceLock<Result<…>>` *declaration*; mine gates an `Err` *arm*. Its `crypto.rs:1290` match is `get_cipher` — the same territory, already owned (§7.J) |
| `secret-as-bare-string-field` (10 / 12) | Struct-field declarations. Re-run: no file in its match set is in mine. Different anchor, different concern (where a secret rests vs. what happens when it cannot be protected) |
| `settings-key-holding-secret` (1 / 3, roots `src-tauri/db/src`) | A `pub const …API_KEY: &str = "` in the settings registry. Disjoint by root and shape |
| `unescaped-like-pattern` (10 / 12) | Unrelated to crypto — but see §12.4, where I reproduced its exact condition inside my own probe and it cost me a wrong number |
| `env-default-conflates-unset-with-empty` (4 / 4, roots `src`/`scripts`, TS only) | An env read whose `??` conflates unset and empty. Different language, and `fallback_policy()`'s `== "1"` is deliberately the *correct* form of that shape |
| `wholesale-inherited-child-env` (10 / 13) | The neighbouring path's rule. Spawn regions; no crypto call, no `Err` arm. Zero overlap |
| `unqueryable-log-record` (67 / 288) · `discarded-guard-verdict` (7 / 11) · `privately-reclassified-failure` (14 / 28) · `read-failure-as-empty-value` (32 / 68, roots `src`, TS) | All checked. The last is the nearest *conceptual* neighbour — a read failure rendered as an empty value — but it is TypeScript-only and frontend-rooted, so it cannot see 7.G's six Rust `.ok()` sites and does not see mine either |
| `unverified-effect-dispatch`, `unatomic-sequence-rewrite`, `unresumable-migration-step`, `constraintless-table-declaration`, `nullable-default-column` | Checked; no condition overlap |

**No existing rule looks at what a cryptographic call does when it fails.** Every one gates a
declaration, a call site, a type or a statement's presence. That is the territory gap this rule
fills.

### The semantic conditions, stated stack-free

**C1 — a cryptographic protection step's failure arm yields the unprotected input.** *Gated below.*

**C2 — a ciphertext carries no identifier of the key that produced it.** *Not gateable; the
condition is an absence spanning a schema, a return type and a file format. This is the **type**,
specified below.*

**C3 — a key-load error is discarded into an absent-shaped value, and the code then mints a
replacement.** *Measured, declined on population — see below.*

**C4 — a platform key wrapper is invoked with no application context.** *Measured, declined on
population and unfalsifiability.*

**C5 — a protection-level claim is computed from a load-time variable rather than from a
verification.** *Not gateable; specification below.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C3 (`if let Ok(...)` on a key load) — declined on population, and the number is the finding.**
  My candidate signal scores **1 file / 1 match** in 963 files (`crypto.rs:629`). A rule with a
  baseline of 1 is a one-shot: it fires once, gets fixed, and must then be deleted rather than
  baselined at 0, because `assertRule` treats a zero-match rule as a structural failure. **A
  population of 1 is what makes 7.D a fix rather than a campaign**, and the better instrument is a
  `#[test]` asserting that a corrupted key file leaves the file on disk — which costs one function
  and is listed in 7.H.
- **C4 (wrapper with no application context) — declined, and 8.5 explains why it can never be
  gated well.** There are **2** call sites in the tree (`dpapi_protect:1229`, `dpapi_unprotect:1258`)
  and the compliant form has **0** instances anywhere, so a positive control would match zero and
  fail the runner structurally — the same disqualifier the corpus already applied to
  "a regex literal enumerating ≥2 credential-prefix families". Worse, probe **F** shows the property
  leaves **no observable trace on disk**, so even a passing gate would prove nothing about the
  artefact. This belongs in a test, next to the fix.
- **C5 (asserted rather than verified protection level) — not gateable, and the honest §9 says so.**
  The defect is that `key_source` answers a different question than the UI asks. No regex compares a
  Rust enum's semantics to a React ternary's copy. The instrument is 7.E's two probed booleans plus
  a Vitest assertion that `VaultTrustBadge` renders the keychain row **only** when the keychain
  boolean is true — an ESLint/AST rule cannot express it and the census cannot count it.
- **C2 (no key identifier) — the type, not a gate.** A census rule would have to count the *absence*
  of a column across a schema written as SQL string literals, which is the doctrine's canonical
  "where types cannot reach" case pointed backwards. Specified under "Type over gate".

### The rule — validated

```json
{
  "rules": [
    {
      "id": "crypto-failure-yields-the-plaintext",
      "goldenPath": "docs/concepts/golden-paths/vault-key-handling.md",
      "title": "An encryption call's error arm hands back the very value it was asked to protect — so losing the master key silently converts an encrypted-at-rest column into a plaintext one",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bencrypt[a-z_]*\\s*\\(\\s*&?(\\w+)(?:\\s*,[^)]{0,40})?\\)(?:(?!\\bfn\\b)[\\s\\S]){0,300}?Err\\s*\\([^)]{0,24}\\)\\s*=>(?:(?!\\bfn\\b)[\\s\\S]){0,240}?\\b\\1\\b",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An encrypt call taking a single named binding, whose Err arm mentions that SAME binding again (backreference) within 240 chars -- i.e. the failure arm evaluates to the unprotected input. PROXY FOR the stack-free condition: a cryptographic protection step's failure is handled by proceeding with the unprotected value, so the unavailability of the key silently downgrades protected storage to unprotected storage instead of failing. MEASURED 2026-08-16: 3 files / 3 matches, all three hand-opened, precision 3/3 -- db/src/repos/communication/events.rs:96, src/engine/cloud_webhook_relay.rs:500, src/engine/webhook.rs:584. All three carry the byte-identical block `Err(e) => { tracing::warn!(\"Failed to encrypt event payload, storing plaintext: {}\", e); (Some(plaintext.clone()), None) }`. THE BACKREFERENCE IS THE DISCRIMINATOR, and it is what makes this a fact rather than a style opinion: the sub-anchor `an encrypt call that is matched with an Err arm at all` scores 6, the positive control (same anchor, lookahead inverted so the Err arm does NOT reproduce the binding) scores 3, and 3 + 3 = 6 EXACTLY -- a complete partition of the anchor population. Replacing the backreference \\1 with \\w+ takes the count from 3 to 6, i.e. it then fires on 100% of the population INCLUDING the three correct sites, which is the fault injection that proves the backreference is carrying the whole signal. The rule therefore measures FAILURE DIRECTION, not `how many encrypt calls exist` (there are 50 encrypt calls with a simple named argument in 963 .rs files, and 44 of them are deliberately invisible here because they never write an Err arm at all). WHY IT MATTERS IN THIS REPO: personas_core::crypto::get_master_key is fail-closed by design and says so in its own doc comment (core/src/crypto.rs:488-496); it returns Err rather than inventing a key. That policy stops at the function boundary. persona_events currently holds 4,972 rows, 4,972 of them with a non-empty distinct payload_iv, i.e. the fail-open branch has never fired -- but every one of those rows is a webhook/trigger payload, the single condition that fires all three arms at once is `the master key is not available`, and a downgraded row reads back cleanly forever because three readers (events.rs:531, cloud/sync/rows.rs:115, teams/team_channel.rs:255) all carry a `(Some(pt), _) => pt` plaintext branch. THE COMPLIANT FORM IS ALREADY WRITTEN DOWN IN THIS TREE, TWICE, WITH THE RATIONALE: src/commands/core/data_portability.rs:6068-6073 and src/commands/design/n8n_transform/confirmation.rs:86-90 both say `Never fall back to the original plaintext on failure ... If the keyring is unavailable, skip this persona and surface a warning`. Those two are positive-control matches. The fix is to copy them. DO NOT silence a match by renaming the binding before the Err arm or by moving the encrypt call more than 300 characters away from its own error handling -- both preserve the defect and merely hide it from this signal; the honest fix always makes the failure propagate. CONVERGENCE: 0 of 5 sibling repos mint or substitute unprotected data on a crypto WRITE failure, so the exact shape gated here is a house condition and is labelled as one; but the READ-side twin is convergent as a defect in 2 of the 2 siblings that encrypt (personas-cloud/packages/orchestrator/src/dispatcher.ts:698,722-724 runs the agent with no credentials; ascent/src/lib/db/org-llm.ts:264-267 silently reroutes an enterprise org's inference to the platform provider, with the comment `never crash a scan; fall back to the platform provider`). PRECONDITION (must be re-derived per repo): this repo encrypts inside a fallible function whose error is handled at the call site with a Rust match. A repo that encrypts through a throwing API, or that has no encryption, scores ZERO here and must write its own proxy for the same condition. END OF LIFE: this rule is designed to reach zero. The runner fails structurally on zero matches BY DESIGN -- DELETE the rule then, do not baseline it at 0.",
        "$measured": "2026-08-16 @ 2a874e692 — 963 .rs files walked under src-tauri; validated standalone in a private scratch registry (vkh-final-rules.json), fault-injected seven ways, then re-extracted from this finished document and re-run: identical. Two independent implementations (the census engine and a separately written Node walker) agree at 3/3, 3/3, and 6/6 on the sub-anchor. Runtime 1.77 s for both rules together."
      },
      "exclude": [],
      "baseline": { "files": 3, "matches": 3 },
      "floor": 900
    }
  ]
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "rules": [
    {
      "id": "crypto-failure-yields-the-plaintext-positive-control",
      "goldenPath": "docs/concepts/golden-paths/vault-key-handling.md",
      "title": "POSITIVE CONTROL — not a gate. The identical anchor whose Err arm does NOT hand back the protected input.",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bencrypt[a-z_]*\\s*\\(\\s*&?(\\w+)(?:\\s*,[^)]{0,40})?\\)(?:(?!\\bfn\\b)[\\s\\S]){0,300}?Err\\s*\\([^)]{0,24}\\)\\s*=>(?!(?:(?!\\bfn\\b)[\\s\\S]){0,240}?\\b\\1\\b)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "NOT A GATE, and it carries no baseline by design. The COMPLIANT half of crypto-failure-yields-the-plaintext: same anchor, same window, the trailing backreference inverted from a consuming match to a negative lookahead, so it selects encrypt calls whose Err arm does NOT reproduce the binding it was handed. MEASURED 2026-08-16: 3 matches in 3 files -- db/src/migrations/helpers.rs:116 (sets credential_ok = false and breaks, rolling the whole credential back with the blob preserved for retry), src/commands/core/data_portability.rs:6076 (pushes a warning and `continue`s, skipping the persona), src/commands/design/n8n_transform/confirmation.rs:93 (drops the transaction, records a rolled_back status row, returns Err). 3 violating + 3 compliant = 6, and the bare sub-anchor `an encrypt call matched with an Err arm` is also 6 -- A COMPLETE PARTITION, which is stronger evidence than a ratio because it proves the signal discriminates on what the error arm DOES rather than on the presence of encryption vocabulary. The decisive rows are the two compliant sites that state the doctrine in a comment before implementing it: `Never fall back to the original plaintext on failure: downstream reads treat this column as ciphertext, so persisting plaintext would leak webhook secrets / Slack tokens / SMTP passwords on disk and break decryption on every subsequent read. If the keyring is unavailable, skip this persona and surface a warning` (data_portability.rs:6068-6073) and the same reasoning at confirmation.rs:86-90. If this control's count ever collapses to 0 the walk or the anchor broke rather than the codebase being fixed; it is expected to RISE as the three violating sites are repaired, which is exactly why it must never be baselined.",
        "$measured": "2026-08-16 @ 2a874e692 — 3 files / 3 matches via the real runner; sub-anchor (Err arm present, no backreference constraint) = 3 files / 6 matches; anchor (any encrypt call with a simple named argument) = 50 matches."
      },
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, fault-injected, positive-controlled, re-extracted

Run against a private registry with a filename unique to this composer (`vkh-final-rules.json`),
never `scripts/census/rules.json`, per the contract's concurrent-writer warning. **The full registry
was not run**; two individual neighbouring rules were re-run alone for the overlap table.

| Check | Result |
| --- | --- |
| Baseline reproduces | `OK` — 3 files / 3 matches / 963 walked / floor 900 · **exit 0** |
| `--check` mode | **exit 0** |
| Runtime | **1.77 s** for both rules. One bounded backreference, one negatively-tempered lazy `{0,300}` and one `{0,240}`; **no nested quantifier, no variable-length lookbehind, no alternation inside a quantifier** |
| Precision | **3/3**, all opened by hand: `events.rs:96`, `cloud_webhook_relay.rs:500`, `webhook.rs:584` — byte-identical blocks |
| **Positive control** | **3 matches / 3 files.** 3 + 3 = **6**, and the bare sub-anchor is **6** — a complete partition |
| Second implementation | an independently-written Node walker: **3/3, 3/3, 6 on the sub-anchor, 50 on the anchor**, 963 files, identical |
| Fault: baseline `2/2` (a new violation) | `[drift]` · **exit 1** |
| Fault: baseline `4/4` (a silent drop) | `[drift]` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` · **exit 1** |
| Fault: `extensions` → `.kt` | `[structural] walked 11 files but floor is 900` · **exit 1** |
| Fault: a stale `exclude` entry | `[structural] exclude … matched no file` · **exit 1** |
| Fault: the positive control given a `baseline` | `validateRule` rejects it · **exit 1**, 0 rules scanned |
| **Fault: backreference `\1` replaced by `\w+`** | **3 → 6.** It then fires on the entire anchor population *including all three correct sites*. The backreference is carrying the whole signal |
| **Re-extraction** — both blocks pulled back out of this document's fenced JSON and re-run through the real runner | **identical: 3 files / 3 matches, 3 control matches, 963 walked, exit 0** |

**The positive control is the load-bearing check**, and here it is stronger than a ratio: the
anchor's `Err`-arm sub-population is exactly 6, the rule takes 3 and the control takes the other 3,
so the signal provably discriminates on *what the error arm does* rather than on the presence of
encryption vocabulary. The backreference fault injection is the confirmation from the other side.

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files — the same floor `wholesale-inherited-child-env` uses for the
same root, deliberately, so two rules over one root do not hold different opinions about what "the
tree is intact" means. A `roots`/`extensions` drift reports **"THE MATCHER IS BROKEN, NOT THE
CODEBASE CLEAN"** rather than a clean run, verified by two independent fault injections. The
`zero-matches` structural check means a port to a repo that encrypts through a throwing API fails
immediately rather than baselining at 0 — which is the correct outcome, since **all five siblings
score 0 here and the read-side twin of the condition is present in two of them in different
syntax**. `exclude` is empty by design, so there is no stale-exemption surface.

### The census cannot express "must be zero"

This condition **should** reach zero: there is no write in this app that benefits from persisting a
value the encryptor refused to protect. The runner cannot say that — a rule pinned at 0 is a gate
that can never fail — so the sequence is: fix `events.rs:96` first (it is the shared helper the other
two were copied from), ratchet 3→2→1, and when the last one lands, **delete the rule and this
section**.

### Prefer a type over a gate — held against all seven qualifications

**Type 1 — an envelope that carries the key's identity: `encrypt_for_db(&str) -> Result<Envelope>`
where `Envelope { ciphertext, nonce, key_id }`, with a `key_id TEXT NOT NULL` column beside each IV
and `decrypt_from_db(&Envelope)` selecting the key by id.**

- **Q1 — a required type carries only what it encodes.** ✔ `key_id` encodes exactly *"which key
  material produced this ciphertext"* and nothing more. It deliberately does **not** encode whether
  the key is safe, where it lives, or how it was wrapped — those are 7.C/7.E/7.F and no type reaches
  them. Test it against this document's defects: it prevents 7.B outright, makes 7.G's canary
  meaningful (a canary without a key id cannot tell you *which* key stopped working), turns 7.J's
  opaque `aead::Error` into a named condition, and gives 8.6's audit row the missing column. **It
  does not prevent 7.A, 7.D or 7.E**, which is why §9 ships a gate as well.
- **Q2 — requiredness is orthogonal to closedness.** The instructive part. Making the existing
  fields required changes nothing: `credential_fields.iv` is *already* `TEXT NOT NULL` and
  `persona_events.payload_iv` already carries a distinct value in 4,972 of 4,972 rows. **Requiredness
  is present and does nothing**, because the domain has no member meaning "key #2". This is an
  **addition to the domain**, not a tightening of it, and stating that honestly is what keeps the fix
  from being mis-scoped as "add `NOT NULL`".
- **Q3 — a type nobody constructs constrains nothing.** ✔ and it is why this is cheap: **16 production
  call sites of `encrypt_for_db`, 13 of `decrypt_from_db` and 7 of `encrypt_field`/`decrypt_field`
  in 963 files**, all funnelled through two functions in one module. The construction surface is
  small and already centralized.
- **Q4 — a type anyone can construct authenticates nothing.** Partial, and worth saying. `Envelope`
  with a public `key_id` can be forged by any caller. But the forgery is not the threat here — the
  threat is *omission*, and returning the id from the encryptor makes omission impossible while
  leaving forgery merely pointless (a wrong id selects a key that fails the GCM tag).
- **Q5 — withholding beats requiring.** ✔ The dangerous freedom is **writing a ciphertext with no key
  identity**, and the way to withhold it is to stop returning a bare `(String, String)`. A tuple of
  two anonymous strings is exactly the shape that lets a caller bind two columns and think it is
  done.
- **Q6 — withhold the dangerous freedom, not the answer.** ✔ Do **not** withhold the ability to write
  a plaintext non-sensitive field — that is the answer, it is correct for the six live
  `scopes`/`organization` rows, and [column-encryption-at-rest](./column-encryption-at-rest.md) §9
  already made this cut. **`personas-cloud` and `ascent` reached the same split independently**,
  which is the strongest evidence in this document that it is the right one.
- **Q7 — withholding a requirement only helps when the requirement was forcing the bad value.** ✔ and
  this is the check that keeps the scope honest: nobody is *forced* to omit the key id — the field
  does not exist. So relaxing a signature is inert; the fix is to **add a construction**, and the
  qualification's real contribution is telling you that this is an additive change with a data
  migration, not a signature edit.
- **Verdict: ship it, and ship it first.** It is the only item in this document whose cost rises
  every day (8.1).

**Type 2, considered and rejected — `encrypt_for_db(value: Zeroizing<String>)` taking ownership, so
the `Err` arm has no plaintext to hand back.** The instinct is right — it is a direct application of
Q5 to §9's condition — and **Q4 kills it**: a caller writes `encrypt_for_db(plaintext.clone())` and
still holds the original, and the compiler is content. It would make the defect *visible* (a
suspicious `.clone()` at the call site) without making it impossible, which is a lint, not a type.
**This is the honest "no type reaches the condition" case the doctrine asks composers to name**, and
it is exactly why §9's gate is a ratchet on `Err` arms rather than a signature change.

**Type 3, considered and rejected — a `VerifiedKeySource` newtype that `vault_status` must return.**
Fails **Q1**: the property the UI needs is *"which stores currently hold these bytes"*, which is not
a property of the value at all — it is the result of two probes at a point in time. A type would
name a property it does not carry, the same error `successRateSource` made with units. **The right
instrument for 7.E is an operation and two booleans**, and §9 says so rather than pretending
otherwise.

---

## 12. Corrections to the brief

### 12.1 The `CONVERGED` label does not hold as stated — 3 clauses of 7, with one INVERTED

The brief warned that five CONVERGED labels have been tested in this campaign and all five failed.
This one is a mixed result and the failure is instructive rather than total:

| clause | oracle result | verdict |
| --- | --- | --- |
| **P4** — never turn "cannot read the key" into "no key" | **0 of 5 mint on a read failure**; both repos with a key fail closed at boot, in writing | **CONVERGED — and Personas is the sole violator in six repos** |
| **P3** — a crypto failure must not proceed without the crypto | **2 of the 2 repos that encrypt** swallow a decrypt failure into silent degradation, one with the rationale in a comment | **CONVERGED as a defect. The WRITE-side variant this repo has is a 5/5 silence — house condition** |
| threat model in the crypto module's own doc | 2 of 5 wrote one **in code** (`ascent/secret-box.ts:1-6`, `brainiac/auth.ts:94-103`) | **CONVERGED — Personas has none** |
| **P2** — a ciphertext must carry its key's identity | 2 of the 2 that encrypt shipped a marker; **0 of 3 shipped a rotation routine** | **CONVERGED on the marker, SILENT on the routine — and Personas is BEHIND, at 0 of both** |
| **P5** — bind application context into the wrapper | **0 of 5** — zero `setAAD` calls anywhere | **SILENCE 5/5 — a shared blind spot, not a validation** |
| **P1** — inventory the key's copies, do not narrate the last read | no sibling has two stores at all | **SILENCE 5/5 — an INVENTION, labelled a house convention** |
| **P6** — back the key up like you back the ciphertext up | no sibling backs up ciphertext | **SILENCE 5/5 — untestable externally** |
| **P7** — verify, do not assert | 2 of 2 have a trial decrypt; **0 of 5 run it at boot**; 1 of 5 surfaces key state | **PARTIAL — the practice exists, the timing does not** |

**And one clause the oracle INVERTED.** I expected to prescribe "prefer the OS keychain over a
file". **0 of 5 siblings use any OS facility** — both implementing repos hold a plaintext key in an
env var. Personas' storage is the best in the six-repo sample and the document had to be rewritten
around that: the finding is not *"use a stronger store"*, it is *"you already have two strong stores
and you cannot tell which one is holding your key, cannot replace what is in them, and cannot verify
they still work."* A composer who assumed the keychain-vs-file axis was the story would have written
the wrong document.

### 12.2 `PERSONAS_ALLOW_FALLBACK_KEY` does not weaken the derivation — it inverts the failure direction, and the CI comment says otherwise

The brief asked me to establish exactly what it weakens and whether a packaged build can reach it.

**What it does NOT do.** The key is 32 bytes from `OsRng` on **both** branches
(`crypto.rs:600` and `:639`) and it is DPAPI-wrapped in both. `.github/workflows/ci.yml:233-234`
says *"it does not weaken the key derivation used by a packaged build"* — **that half is correct,
and it is correct about the wrong axis**: there is no derivation difference to weaken.

**What it actually does, in three steps.** (1) It converts `get_master_key`'s `Err` into a success
(`:522-541`). (2) That success routes through `derive_fallback_key`, whose `if let Ok(Some(...))`
**discards a read error** (7.D). (3) The replacement key is then written **over** `master.key`. So
the flag's real effect is to turn *"the key file is unreadable"* — a recoverable, evidence-preserving
error — into *"mint a new key and destroy the old one"*. That is a **durability** property, and it
appears in none of: the doc comment (`:449-460`, which describes an opt-in for "CI / headless /
tests"), the error string (`:557-561`), the daemon help text, or the CI comment.

**Can a packaged build reach it?** `fallback_policy()` reads `std::env::var` at **runtime**, so the
question is not whether the build sets it but whether the process inherits it. Three findings:

- The installer bundle ships no environment (`tauri.conf.json`'s `resources` lists only
  `resources/skills`), so a double-clicked desktop app does not have it — **the CI comment's "which
  never sets it" is true of that path.**
- `personas-daemon` is a separate `[[bin]]` (`Cargo.toml:294-297`, `required-features = ["daemon"]`)
  and its own `--help` **advertises the flag to operators**: `daemon_bin.rs:298` prints
  `PERSONAS_ALLOW_FALLBACK_KEY=1    allow DPAPI-wrapped fallback credential key`. It is not in the
  Tauri bundle, so it reaches whoever builds or deploys it — which is precisely the headless
  operator whose key file is most likely to be a copied artefact.
- The flag is set in **two CI jobs** (`ci.yml:235`, `:356`), added 2026-08-16, and a developer shell
  that exported it for a test run passes it to every process started from that shell, including
  `npm run tauri:dev`. Per [credential-injection-into-child](./credential-injection-into-child.md),
  environment inheritance in this tree is total: **127 of 129 spawn sites pass the parent's
  environment through unchanged.**

**And the CI comment names a function that does not exist.** `ci.yml:224` says *"`resolve_master_key`
refuses to invent one"*. `resolve_master_key` appears **0 times in 963 `.rs` files**; the function is
`get_master_key`. Small, but the comment is the only written explanation of why the flag is in CI.

**Recommendation, reported rather than done** (per the runbook, a behavioural change to a security
control whose current setting may be deliberate goes to the operator): keep the flag in CI — it is
the documented hatch and CI has no keychain — and fix 7.D so the flag stops carrying a destructive
side effect it was never meant to have. Then correct the two comments.

### 12.3 Two of the brief's primed leads are confirmed, and two corrections to a neighbouring path

- **"358 bytes with a `DPAPI:` marker" — CONFIRMED and given a mechanism.** 6 marker bytes + 352
  base64 chars = a 262-byte DPAPI blob, and a blob of exactly 262 bytes wraps exactly 32 bytes
  (measured against 16/32/64-byte probes). The file is one key and nothing else — **no version, no
  id, no salt**, which is 7.B's structural half.
- **"`dpapi_protect` passes `None` for `pOptionalEntropy`, so nothing binds the wrapper to this
  app" — CONFIRMED, and the cost measured from outside.** `powershell.exe` unwrapped a null-entropy
  blob produced by a different process as the same user; the same blob with entropy did not unwrap.
  **Caveat the brief could not have known:** entropy does not change the blob length, so this
  property is unauditable from the artefact (8.5).
- **"`master.key` and `personas.db` have byte-identical ACLs" — CONFIRMED and extended.** Both are
  `DOLLARSTORE\mkdol:(F)` with zero inherited ACEs. The **directory** is
  `DOLLARSTORE\mkdol:(OI)(CI)(F)` with inheritance removed, so `backups/` and `logs/` inherit
  owner-only — materially better than the `%TEMP%` artefacts the neighbouring path measured.
- **"1,027 rows, all with `expires_at` NULL" — CONFIRMED and drifted to 1,028.** The app minted one
  more system key between that sweep and this one. All 1,028 still have no expiry. That surface is
  owned by [credential-injection-into-child](./credential-injection-into-child.md) §0 and is not
  re-litigated here.
- **Correction to [column-encryption-at-rest](./column-encryption-at-rest.md): its ciphertext
  inventory is short by 4,972 rows.** That path's value scan covered `credential_fields` (36
  encrypted), `persona_credentials` (0), and the JSON `_enc` scheme (0 live), and concluded the vault
  is small. **`persona_events.payload_iv` — 4,972 rows, 4,972 distinct nonces, 0 plaintext — is a
  third `(value, iv)` column pair encrypted under the same master key**, written by three different
  functions, and it does not appear in that document. It is **138× larger than the credential
  vault**. Its nonce hygiene is as clean as the vault's (4,972 distinct), so the *cipher* conclusion
  survives intact; the *scope* conclusion does not.
- **Correction to the same path's P6, in its favour.** It reported the JSON `_enc`/`_iv` convention
  as having "zero live instances", measuring `webhook_secret` specifically. I re-measured the whole
  convention with a literal `instr()` search across `personas.notification_channels` (73 rows) and
  `persona_triggers.config` (351 rows): **0 and 0.** The claim is stronger than it was stated, not
  weaker.

### 12.4 A correction to my own instrument, which nearly published a false number

My first measurement of the JSON `_enc` scheme used
`WHERE config LIKE '%_enc%'` and returned **23 rows**, which I was one step from writing up as "the
second encryption scheme has 23 live users, contradicting the neighbouring path". **`_` is a
single-character wildcard in SQLite `LIKE`**, so the query asked "any character followed by `enc`"
and matched words like `sequence`. The true count is **0**, confirmed with `instr(config,'_enc')>0`.

Two things worth recording upward. First, this is exactly the doctrine's *"the tool answered a
different question than the one asked, and the answer looked plausible"* — and what caught it was
not a second implementation (a second `LIKE` would have agreed) but **opening the matched rows and
finding no `_enc` key in the parsed JSON**. Hand-verification found what agreement could not.
Second, **this repo already gates that exact condition** — `unescaped-like-pattern`, 10 files / 12
matches — and I reproduced it in an ad-hoc probe that no gate can see. A census rule protects the
codebase and not the instruments a composer builds to measure it; the defence there is still to open
the rows.

### 12.5 What the brief primed that turned out to belong to someone else

- **`get_cipher`'s `OnceLock<Result<Aes256Gcm, String>>` latch (`crypto.rs:1290`)** is the mechanism
  by which `get_master_key`'s success-only caching is defeated one layer up — a genuinely sharp
  finding, and **already measured, gated and published** by
  [process-global-command-state](./process-global-command-state.md) §A, whose
  `process-global-caches-a-failure` rule (3 files / 4 matches) matches it directly. I re-ran that
  rule alone to confirm it still fires at `2a874e692` and to establish **zero file overlap** with
  §9's rule. Re-reporting it would have been a second path on one leaf.
- **"IV reuse came back clean: 36 rows, 36 distinct nonces" — CONFIRMED, and extended to the column
  the earlier sweep missed.** `persona_events` adds 4,972 rows with 4,972 distinct `payload_iv`.
  **5,008 ciphertexts, 5,008 distinct nonces, one key.** The brief's framing — *"encryption is sound;
  containment was the problem"* — holds, and this leaf adds the third axis: the encryption is sound,
  the containment is a neighbouring path's problem, and **the key's lifecycle is this one's** — it
  cannot be named, replaced, verified or restored.
