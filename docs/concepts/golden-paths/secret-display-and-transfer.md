# Golden path — Secret display and transfer

> Situation node: `integrations-security/vault-security/secret-display-and-transfer` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2a874e692`. Recurrence 27 — composed out of rank order
> because two live credential leaks were confirmed in this repo within 24 hours and both of them
> terminate in this leaf.
> Sweep size: the whole Rust tree (**963 `.rs` files** — exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json), and exactly what the census walker reports),
> **1,667 `#[tauri::command]` functions parsed brace-balanced** (signature + body, not grepped —
> `shared-facts.json` records **1,661**; the 6-function delta is `#[cfg(test)]`-gated commands my
> parser keeps and is noted rather than reconciled away) · `src/**` (**4,829 `.ts`/`.tsx`**,
> `frontend.tsFiles`) · every struct field in `src-tauri` whose *name is a secret noun*, enumerated
> by a line-scanning parser that tracks the enclosing struct and its derive list · the whole
> credential command surface (**15,264 lines across 29 files**) · `data_portability.rs`
> (**12,705 lines**) read at its four crypto boundaries. **No `cargo` was run.**
> Dimensions: **security · ui · function · code-quality · resilience**. **Two-sided:** the Rust
> half decides what may cross the IPC boundary at all, the TypeScript half decides what a human may
> see and move, and the contract between them is the wire type.
> A **convergence sweep** was run against `brainiac` (Rust · sqlx · Postgres), `personas-cloud`
> (TS · node crypto) and `personas-web` (TS · Next.js). One clause came back **physics**, one came
> back **house convention**, and one sibling turned out to have no instance of the condition at all —
> §6 has the ruling and it contradicts part of what this document would otherwise have claimed.
>
> **No secret value appears in this document.** Every credential is described by shape, location and
> count. That constraint held for the scratch files and the subagent reports too.
>
> **Sibling boundaries, settled in prose.**
> [**App settings store**](./app-settings-store.md) owns *where a configuration value lives* and
> proved that three allow-listed keys hold raw credentials in a `TEXT NOT NULL` column with no crypto
> on the write path. It owns the row. **This path owns what happens after** — the moment one of those
> values is asked for by a human eye, a clipboard, a screenshot or an export file. The division is
> load-bearing: `browser_bridge_pairing_token` is that path's finding *at rest* and this path's
> finding *in flight*, and the two fixes are different (one moves the row to the keyring, the other
> stops the command returning the value at all). Neither fix implies the other.
> [**Structured logging**](./structured-logging.md) owns the durable file sink and catalogued the
> repo's five redaction layers. Its P1 finding — *every existing layer guards egress or the UI, none
> guarded the file* — is now half-inverted by this path: the sink was fixed on 2026-08-14, the
> **read** path was not, and `get_execution_log` still serves the 130-day pre-fix corpus verbatim to
> the renderer and to the clipboard. That path owns `ExecutionLogger::log`. This path owns
> `get_execution_log`. Its **Gap 4** — "`SecureString` cannot be used for a value that must also be
> serialized… any secret that crosses IPC drops back to `String`" — is the exact mechanic this
> path's §9 instrument counts.
> [**IPC command authorization**](./ipc-command-authorization.md) owns which gate a command wears.
> This path does not re-litigate that `require_auth_sync` is a documented no-op; it inherits the
> ruling and reports the two secret-returning commands that wear it.
> [**Filesystem boundary**](./filesystem-boundary.md) owns path containment for
> `open_log_file_safely` and the export save dialog. This path takes containment as given and asks
> only what is *inside* the bytes.
> [**Rendering untrusted content**](./rendering-untrusted-content.md) owns the inbound direction
> (a string reaching the DOM as markup). This path is the outbound direction (a secret reaching the
> DOM as text). They share no call sites.
>
> The **Deviations** section is a fix backlog.

---

## 1 Trigger

- "Show the user their API key / pairing token / webhook secret."
- "Add a copy button to this field." / "Let them copy the token."
- "Add a reveal toggle / eye icon so they can check what they pasted."
- "Return the credential so the frontend can display it." / "The panel needs the current value."
- "Export this so they can move it to another machine." / "Generate a share link."
- "Why is the token showing as `••••` but I can still see it in DevTools?"

**If you are about to type any of these, you are in this situation:**
`pub <anything>_token: String` in a struct that derives `Serialize` · `<CopyButton text={secret} />` ·
`type={revealed ? 'text' : 'password'}` · `'*'.repeat(...)` or `slice(0,4) + '…' + slice(-4)` ·
`Ok(the_secret)` from a `#[tauri::command]` · `navigator.clipboard.writeText(key)` ·
`getAppSetting('…_token')`.

---

## 2 The one way

**A secret leaves the backend only as a boolean, a non-reversible prefix, or a one-time
show-once payload that the backend has already decided to surrender — never as a field on a
routine status struct.** Type it `SecureString` (`src-tauri/core/src/crypto.rs:221`) the moment it
exists in Rust: it zeroizes on drop, prints `[REDACTED]` from both `Debug` and `Display`, and
**implements no `Serialize`**, so putting it on the wire is a compile error rather than a review
question. When the product genuinely needs a human to see the value, do the *narrowest* thing that
works, in this order — (1) don't send it, send `configured: bool` and a `key_prefix`
(`get_qwen_status`, `ExternalApiKey.key_prefix`); (2) if it must be shown once at creation, send it
once, from a command whose return type exists only for that purpose, and never again
(`CreateApiKeyResponse`, `FleetPairResult`); (3) if it must be re-readable, gate the command with
`#[requires(privileged)]`, render it through `PasswordToggleField` so it re-masks itself after 8
seconds, and never hold the plaintext in component state before the user asks for it. **Movement is
a separate decision from display, and it is the stricter one:** a value that may be shown may not
automatically be copied, exported or shared — every clipboard write of a secret must wipe itself on
a TTL, and every export that carries credential material must be sealed in the AES-256-GCM +
PBKDF2 envelope with a user passphrase, never in the plain bundle.

If two answers seem correct, reach for **"don't send it"** first. It is the only one of the four
that cannot be got wrong later, and this repo already has a working instance of it
(`get_qwen_status`) sitting three files away from the leak.

---

## 3 Mandated primitives

### Rust

| Primitive | What it gives you |
|---|---|
| `personas_core::crypto::SecureString` (`src-tauri/core/src/crypto.rs:221`) | Zeroize-on-drop; `Debug` **and** `Display` both emit `[REDACTED]` (`:250-260`); `duplicate()` instead of `Clone` so copying secret material is explicit (`:243`). **No `Serialize` impl** — this is the whole point. |
| `#[serde(skip_serializing)]` + `#[ts(skip)]` | The field stays in the Rust struct and vanishes from both the JSON and the generated TypeScript type. **5 uses in the entire tree**, all on secret-bearing fields (`models/credential.rs:40,45,121,124`, `models/external_api_key.rs:17`). |
| `key_prefix` (`models/external_api_key.rs:21`) | The *display shape*: first several chars, stored beside a SHA-256 `key_hash` that is itself `skip_serializing`. Lets the UI identify a key without ever holding it. |
| `personas_core::utils::sanitization::sanitize_secrets` (`core/src/utils/sanitization.rs:22`) | Four `OnceLock`-compiled passes — `Authorization:` headers, `key: value` pairs, prefixed tokens (`ghp_`/`AKIA`/`sk_live_`/`xox?-`), bare `Bearer`, plus emails. Designed for hot paths. |
| `crate::db::repos::resources::credentials::get_decrypted_fields` (`db/src/repos/resources/credentials.rs:1441`) | The **single** decryption entry point. 42 call sites; none of them is a command that returns the result. |
| `ZeroizingFields` (`src/engine/runner/credentials.rs:51`) | Newtype over the decrypted field map that scrubs every value on drop *and* on `replace()`. Shrinks plaintext lifetime from "the whole execution" to "one injection". |
| `#[requires(privileged)]` (`personas_macros`) | The only IPC gate that gates. `require_auth_sync` is a documented no-op (`src/ipc_auth.rs:477-479`). |
| `encrypt_section` / `decrypt_section` (`src/commands/core/data_portability.rs:9160,:9210`) | AES-256-GCM under a PBKDF2-SHA256 key with a per-export salt + nonce and a format marker, so a section pasted into the wrong slot fails loudly. |

### TypeScript

| Primitive | What it gives you |
|---|---|
| `@/features/shared/components/forms/PasswordToggleField` | The secret-input primitive. `type` flips on `revealed`; **auto-reverts to masked 8 s after focus leaves** (`:31,:61-67`), timer resets while focused so it never re-masks mid-glance; toggle is `aria-pressed` and `tabIndex={-1}`. `autoMaskAfterMs` overrides; `0` disables. |
| `copyText` from `@/hooks/utility/interaction/useCopyToClipboard` (`:11`) | The one sanctioned `navigator.clipboard.writeText`. Never throws; posts a Sentry breadcrumb on failure. |
| `useCopyToClipboard()` / `@/features/shared/components/buttons/CopyButton` | Timed *visual* feedback around `copyText`. **The `timeout` is UI-only — it does not clear the clipboard.** |
| `maskSensitiveJson` from `@/lib/utils/sanitizers/maskSensitive` (`:40`) | Parses JSON, replaces values under a sensitive-key regex with a **fixed-width** `********` (`:13`), re-serialises. Length-blind by construction. |
| `sanitizeErrorMessage` (same file, `:91`) | Strips paths, IPs, internal hosts, emails, inline `key: value` secrets and prefixed tokens from a message before display or persistence. |
| The fixed-width bullet literal (`EffectiveConfigPanel.tsx:24`) | `'•' × 8` — the correct mask for a read-only display: it is a constant, so it leaks neither the value nor its length. |

**Do not invent a masking function.** The repo already has one correct read-only mask
(a fixed-width literal), one correct JSON mask (`maskSensitiveJson`) and one correct input mask
(`PasswordToggleField`). A fourth is a regression — see Anti-pattern 5.

---

## 4 Steps

1. **Decide, in Rust, whether the renderer needs the value at all.** Write down the UI's actual
   requirement. "Show whether it is configured" → `bool`. "Let the user recognise which key this is"
   → `key_prefix`. "Let the user paste it into another tool" → show-once. Only the third needs the
   plaintext, and it needs it exactly once.
2. **Type it `SecureString` at birth.** Not at the boundary — at the point the `String` first holds
   secret material. `SecureString` does not implement `Serialize`, so if step 1 was answered wrong,
   step 2 fails to compile. **This is the step that replaces the gate.**
3. **Give the status command a return type that has no secret in it.** Copy
   `get_qwen_status` (`src/commands/infrastructure/qwen_engine.rs:52`) — `QwenStatus` carries
   `configured`, `base_url` and `model`, and the function's own doc comment reads *"Never returns
   the API key itself."* Store the secret in `keyring::Entry`, the non-secret half in
   `app_settings`.
4. **If it must be shown once, make the show-once shape its own type.** `CreateApiKeyResponse`
   (`core/src/models/external_api_key.rs:64`) is `{ record: ExternalApiKey, plaintext_token: String }`
   — a type that exists *only* to be returned from `create_external_api_key`, so no routine list or
   status command can accidentally acquire the field. `FleetPairResult` (`src/commands/fleet/pairing.rs:207`)
   does the same and stores only the SHA-256.
5. **If it must be re-readable, gate the command with `#[requires(privileged)]` and log the
   issuance.** `get_system_api_key` (`src/commands/credentials/external_api_keys.rs:113-119`) is the
   worked example: privileged, plus `tracing::info!("system_api_key issued to privileged caller")`
   so an unexpected caller leaves a trail. **Never `require_auth_sync`** — it returns `Ok(())`
   unconditionally.
6. **Prefer handing the renderer a reference over a value.** `approve_pairing`
   (`external_api_keys.rs:155-201`) mints an origin-bound key and returns `()`; the plaintext is
   stashed server-side for a single-use `/pair/claim`. The credential write path does the mirror
   image: `create_credential` takes an `oauth_session_ref` and redeems it *inside* the command
   (`crud.rs:63-65`), so OAuth token material never crosses IPC in either direction.
7. **On the frontend, do not fetch the secret until the user asks.** A panel that loads plaintext on
   mount has already lost — the value is in React state, in the fiber tree, in a heap snapshot and
   in any DevTools session, before the user has expressed any intent.
8. **Render it through `PasswordToggleField`.** Pass the value as the controlled `value`; the
   primitive owns the reveal state, the ARIA, and the 8-second auto-revert. Do not add your own
   `useState(false)` beside it.
9. **For a read-only display, render a constant, not a transform of the value.** `'•' × 8`. A mask
   derived from the plaintext (`slice(0,4) + '*'.repeat(len-8) + slice(-4)`) publishes the length
   and both ends of the secret and proves the plaintext is in scope.
10. **Copy through `copyText`, and if the value is a secret, wipe it.** Copy the shape at
    `FieldCaptureHelpers.tsx:98-116`: schedule a 30 s timer, on fire compare
    `navigator.clipboard.readText()` against what you wrote, clear only if it still matches — and if
    `readText()` is denied, clear unconditionally rather than skipping the wipe.
11. **For export, seal it.** Credential material goes through `build_encrypted_credentials`
    (`data_portability.rs:9545`) into a `CredentialExportEnvelope`; a section that must always travel
    encrypted goes through `seal_sensitive_sections` (`:9239`), which *fails* rather than shipping a
    plaintext bundle. The plain `PortabilityBundle` and the peer-to-peer `engine/bundle.rs` bundle
    carry connector **names** only.
12. **And then stop.** `PasswordToggleField` owns reveal + auto-revert. `copyText` owns the
    clipboard write. `encrypt_section` owns the envelope. `sanitize_secrets` owns the pattern set.
    If you are writing a timer, a regex or a `useState` next to any of them, you are re-implementing
    a primitive.

---

## 5 Anti-patterns

1. **Putting a secret on a routine status struct.** `BrowserBridgeStatus.pairing_token`
   (`src/commands/companion/browser_test.rs:26`) is `#[ts(export)]`, so the secret is a first-class
   field of a generated TypeScript type that a 5-second poll refetches forever. *Failure mode:* the
   value's exposure is no longer a decision anyone makes — it is a property of a struct, and every
   future consumer of that struct inherits it silently.

2. **Claiming a gate in a comment instead of wearing one.** The same field's doc comment reads
   *"Vault-grade: only surfaced behind the privileged IPC gate"*, and the command is gated by
   `ipc_auth::require_auth_sync`, which is `{ Ok(()) }` (`src/ipc_auth.rs:477-479`). *Failure mode:*
   the comment is what the next reader believes, and it is load-bearing in the wrong direction — it
   stops them checking.

3. **Redacting at the sink and calling the leak closed.** `ExecutionLogger::log` now masks every
   line through `sanitize_secrets` (`engine/src/logger.rs:61`) and says so in its own doc: *"this
   masks NEW writes only."* `get_execution_log` (`src/commands/execution/executions.rs:617`) reads
   the *file* and returns it verbatim. *Failure mode:* a fix at the write boundary is invisible to
   the read boundary, so the historical corpus — the entire reason the fix was made — keeps flowing
   to the screen and the clipboard exactly as before.

4. **Treating `type="password"` as a mask.** It is a rendering mode. The plaintext is the input's
   `value` property, readable from the console with `$0.value`, visible in the React fiber, and
   present in a heap snapshot. *Failure mode:* the mask satisfies the reviewer and the shoulder, and
   nothing else. (This is why step 8 mandates the primitive: the mitigation that actually helps is
   the **auto-revert**, which bounds the window in which a screenshot or a screen-share can catch
   the value.)

5. **Deriving the mask from the plaintext.** `maskValue` (`ByomApiKeyManager.tsx:87-92`) emits
   `slice(0,4) + '*'.repeat(min(len-8,20)) + slice(-4)`, and returns the value **unmasked** when the
   field is flagged `isUrl`. *Failure mode:* three separate ones — the mask publishes the exact
   length for short keys, it publishes both ends, and a mis-set `isUrl` flag prints the secret with
   no visual change to the surrounding UI.

6. **Loading every secret into component state on mount.** `ByomApiKeyManager.tsx:114-139` issues one
   `getAppSettingsBulk(['ollama_api_key','litellm_base_url','litellm_master_key'])` on mount and
   writes each plaintext into both `entry.value` and `entry.savedValue`. *Failure mode:* the reveal
   toggle is now cosmetic — the values were resident from first paint, before any user intent, and a
   crash report, a heap dump or a DevTools screenshot captures all of them at once.

7. **Copying a secret through the generic path.** `copyText` takes a `string` and cannot tell a
   pairing token from a persona name. 11 call sites copy real credential material; **3** wipe the
   clipboard afterwards. *Failure mode:* the value sits in the OS clipboard indefinitely, is read by
   the next app that asks, and — on Windows — is retained by Clipboard History (Win+V) where a 30 s
   wipe cannot reach it.

8. **Masking the render and copying the raw.** `ExecutionDetailContent.tsx:166-167` renders
   `maskSensitiveJson(execution.output_data)` and, one line above, hands `execution.output_data`
   **unmasked** to a `CopyButton`. *Failure mode:* the redaction is theatre for exactly as long as
   nobody presses the button beside it.

9. **Confusing an ingest redactor with an egress one.** `redact_clipboard_content`
   (`engine/src/ambient_context.rs:965`) has **one** production caller, `:460`, on the path where the
   *user's* clipboard enters Athena's ambient window. It has never guarded anything the app writes.
   *Failure mode:* a reviewer greps for "clipboard redaction", finds a thorough one with tests, and
   concludes the clipboard is handled.

10. **Two maskers, neither a superset of the other.** `sanitize_secrets` has a `key = value` rule and
    no PEM rule; `redact_clipboard_content` has JWT/Stripe/Slack rules and no `key = value` rule.
    *Failure mode:* which secrets survive depends on which door the string went through, and nobody
    can state the guarantee in one sentence.

11. **Letting a bearer capability wear a neutral name.** `ShareLinkResult.token`
    (`src/engine/share_link.rs:72`) is documented as *"The token portion for display purposes"* — but
    possession of it fetches the bundle. *Failure mode:* "for display" reads as "not a secret", so
    it gets rendered, copied and logged like an id.

12. **Shipping a plaintext export because the passphrase was optional.** Avoided here, deliberately:
    `seal_sensitive_sections` (`data_portability.rs:9239`) returns a `Validation` error rather than
    emitting an unsealed bundle, and says why in its own doc — *"cheaper than discovering the
    omission in a shipped plaintext bundle."* Copy that posture.

---

## 6 Evidence

**The one site to copy, for the backend half:**
**`src-tauri/src/commands/infrastructure/qwen_engine.rs:51-52`** — `get_qwen_status`. Secret in the
OS keyring, non-secret half in `app_settings`, return type carries `configured` / `base_url` /
`model`, and the doc comment states the invariant: *"Never returns the API key itself."* Its
frontend counterpart `QwenKeyRow` (`ByomApiKeyManager.tsx:257-370`) renders `'•'.repeat(16)` at
`:364` with **no reveal toggle and no copy button**, because there is nothing in memory to reveal.
This is the only end-to-end-correct secret surface in the app.

**The one site to copy, for the clipboard half:**
**`src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:98-116`** — copy,
then a 30 s timer that re-reads the clipboard, compares against what it wrote so a later user copy
is never trampled, and falls back to an unconditional clear when `readText()` is denied rather than
silently skipping the wipe.

Other exemplary sites, each for one specific move:

| Site | What it demonstrates |
|---|---|
| `core/src/crypto.rs:221-260` | `SecureString` — zeroize-on-drop, `[REDACTED]` from `Debug` *and* `Display`, `duplicate()` not `Clone`, **no `Serialize`**. |
| `core/src/models/credential.rs:40-47,121-125` | `#[serde(skip_serializing)] #[ts(skip)]` on `encrypted_data`/`iv`/`encrypted_value` — ciphertext and nonce cannot reach the renderer even by accident. |
| `core/src/models/external_api_key.rs:13-37` | The full pattern in one struct: `key_hash` skipped, `key_prefix` shown, plaintext nowhere. |
| `src/commands/credentials/crud.rs:459-479` | `list_credential_fields` returns `{fieldKey, fieldType, isSensitive, …}` — metadata only, explicitly *"without decrypted values"*. |
| `src/commands/credentials/crud.rs:41-51,382-392,493-499` | The write direction: every secret-bearing input arrives RSA-OAEP+AES-GCM session-encrypted and is decrypted inside the command. |
| `src/commands/credentials/external_api_keys.rs:155-201` | `approve_pairing` returns `()`; the plaintext is handed to a single-use server-side claim, not to the renderer. |
| `src/engine/runner/credentials.rs:51-84` | `ZeroizingFields` — the newtype that bounds plaintext lifetime on the hot path. |
| `src/commands/core/data_portability.rs:9239-9273` | `seal_sensitive_sections` — always-encrypted sections that fail rather than downgrade. |
| `src/features/shared/components/forms/PasswordToggleField.tsx:61-94` | Auto-revert with a focus-aware timer — the mitigation that actually bounds screenshot/screen-share exposure. |
| `src/features/agents/sub_model_config/components/EffectiveConfigPanel.tsx:24,:108` | A constant-width mask for a read-only field. |

**Convergence — measured, and it does not say what a security document wants it to say.**

| Clause | `brainiac` (Rust) | `personas-cloud` (TS) | `personas-web` (TS) | Ruling |
|---|---|---|---|---|
| Redact where the value is handed to a *viewer*, not only where it is written | **Reinvented.** `redact.rs` exists because of a real UAT finding (2026-07-13 H4) and its own module doc scopes it to *"where a raw string crosses into a stored memory or an agent-facing payload"*; 7 call sites, including `brainiac-server/src/mcp.rs:2393` — the agent-facing egress | n/a (no display surface) | n/a | **Physics** |
| A credential never goes in the general config store | 3/3 (already measured by [app-settings-store](./app-settings-store.md)) | separate AES-GCM path (`packages/shared/src/crypto.ts`, PBKDF2 600k) | writes no secrets | **Physics** |
| Type the secret so serialising it cannot compile (`SecureString`) | **Absent.** Zero `SecretString` / `Zeroize` / secret-newtype hits across `crates/**` — brainiac redacts at the boundary but keeps `String` everywhere | absent | absent | **House convention** |
| A secret written to the clipboard must wipe itself | n/a | n/a | **Condition absent:** 10 `clipboard.writeText` sites, **0** carry a secret (error digests, template config, anchor URLs, error ids, formatted JSON) | **Untested** |
| Secrets on screen go through one masking primitive | n/a | n/a | **Condition absent:** **0** `type="password"`, **0** reveal toggles — and *two independent* `CopyButton` components (`components/guide/blocks/CopyButton.tsx`, `components/sections/connector-modal/components/CopyButton.tsx`), i.e. no chokepoint at all | **Untested** |

**Report honestly where convergence contradicts this document.** Two of the five clauses could not be
tested because the sibling has no instance of the condition, and one — the `SecureString` clause,
which is §2's *primary* prescription and the answer to "prefer a type over a gate" — **was not
reinvented anywhere**. Under the contract's own rule, an un-rediscovered clause "should be suspected
of being local calibration."

It survives here on a different ground, and the ground must be stated rather than smuggled: the
lesson earned this week is that **convergence measures discoverability, not whether a requirement is
real**, and for a security leaf the diagnostic signature is *the defect converging while the fix does
not*. That is exactly the pattern. The defect converged — brainiac shipped `redact.rs` **after** a
UAT run found verbatim credentials in agent-facing payloads, which is this leaf's condition
rediscovered the expensive way. The *fix* did not converge, because brainiac chose the cheaper
instrument (redact at the boundary) over the stronger one (make it untypable). So: `SecureString` is
a house convention in the sense that no sibling reinvented it, **and** it is the correct
prescription, because the sibling that skipped it paid for the skip. Both halves are true and
neither cancels the other.

The `personas-web` result is a genuine null, not a hidden failure: a repo with no secrets and no
chokepoint is not evidence that a chokepoint is unnecessary — it is evidence that the question does
not arise there. This path's §9 instrument would score **zero** in `personas-web` while the condition
is genuinely **absent**, which is the one shape of zero a gate is allowed to have.

---

## 7 Deviations

Ordered by blast radius. Every entry was read, not inferred.

### D1 — `get_execution_log` serves the pre-fix log corpus verbatim to the screen *and* the clipboard
`src/commands/execution/executions.rs:617-637` (whole file) · `:644-700` (STDOUT lines) ·
`src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:26-48,:92`

`ExecutionLogger::log` was fixed at the sink on 2026-08-14 and its own doc says *"this masks NEW
writes only. Existing files must be purged separately"* (`engine/src/logger.rs:55-57`). The read path
was not touched: `get_execution_log` opens the file and `read_to_string`s it into the response with
**no `sanitize_secrets`**, gated by `require_auth_sync` (a no-op). `ExecutionLogViewer` renders every
line at `:113-120` and puts a `CopyButton` at `:92` whose handler (`:26-48`) copies the **entire raw
log** through `copyText`. The measured pre-fix corpus is 3,018 files / 410 MB over 130 days
containing GitHub PAT shapes (10 files), Google API key shapes (26 files), a PEM private key and a
JWT. Three further consumers read the same unsanitised bytes: `ReplaySandbox.tsx:39`,
`ComparisonDiff.tsx:40-41`, `usePersonaExecution.ts:166`.
**Fix:** run `sanitize_secrets` on the read path in both commands. It is a one-line change per
command against an already-`OnceLock`-compiled matcher, it protects the historical corpus that
purging has not yet reached, and it is idempotent against already-masked new writes.

### D2 — `browser_bridge_status` returns a live bearer token on an ungated poll, and says otherwise
`src/commands/companion/browser_test.rs:21-47` · `src/lib/bindings/BrowserBridgeStatus.ts` ·
`src/features/plugins/companion/sub_setup/BrowserBridgePanel.tsx:25,:31-35,:75-78`

`BrowserBridgeStatus.pairing_token: String` is `#[ts(export)]`, so the secret is a declared field of
the wire type. The command is gated by `require_auth_sync` — a no-op — while the field's doc comment
claims *"Vault-grade: only surfaced behind the privileged IPC gate."* The panel stores the whole
struct in component state and **re-polls every 5,000 ms** for as long as it is mounted (`:31-35`),
then renders the token as a `<code>` text node at `:76`. `truncate` is `text-overflow: ellipsis` —
the full value is in the DOM, selectable, copyable and read by a screen reader. A `CopyButton` at
`:78` writes it raw, with no TTL. Confirmed in the operator's live database by
[app-settings-store](./app-settings-store.md): the row exists, 32 characters, token-shaped,
plaintext, written 2026-06-12.
**Fix, in order of strength:** (a) split the struct — `browser_bridge_status` returns
`{port, extension_connected, env_override, token_prefix}`; a separate `#[requires(privileged)]`
`browser_bridge_reveal_token` returns the value on explicit user action only; (b) failing that, at
minimum apply `#[requires(privileged)]` to the existing command and delete the false comment.

### D3 — 12 secret-named struct fields are bare `String`; only 2 use the type that exists
`src-tauri/**` (whole tree, parsed)

Enumerated by a struct-aware field parser: **15** fields in `src-tauri` whose name *is* a secret noun
and whose type is `String`/`Option<String>`/`SecureString`. **2** are `SecureString`; **13** are bare
`String`. Of the 13, **10** sit in a `Serialize`-deriving struct — and of those 10, one
(`ChainStopReason.reason_token`) is a closed-vocabulary status token, not a credential. So **9
plaintext credentials are typed onto the IPC wire**, 7 of them additionally `#[ts(export)]`:

| Field | Wire-exported | Note |
|---|---|---|
| `CreateApiKeyResponse.plaintext_token` (`core/src/models/external_api_key.rs:66`) | `ts` | Correct — the show-once type. Its own doc: *"the **only** time it ever leaves the backend."* |
| `FleetPairResult.token` (`src/commands/fleet/pairing.rs:211`) | `ts` | Correct — *"Shown once; the desktop stores only its SHA-256."* |
| `BrowserBridgeStatus.pairing_token` (`src/commands/companion/browser_test.rs:26`) | `ts` | **D2.** Re-readable on a 5 s poll. |
| `CloudDeployment.webhook_secret` (`src/cloud/client.rs:130`) | `ts` | Rendered and copied raw at `CloudWebhooksTab.tsx:290-292`. |
| `ShareLinkResult.token` (`src/engine/share_link.rs:72`) | `ts` | A bearer capability documented *"for display purposes"*. |
| `ResolvedShareLink.token` (`src/engine/share_link.rs:88`) | `ts` | Same capability, inbound. |
| `ModelProfile.auth_token` (`core/src/types.rs:426`) | — | Reaches the UI as `config.authToken`; masked with a constant at `EffectiveConfigPanel.tsx:108`. |
| `TestModelConfig.auth_token` (`engine/src/test_runner.rs:124`) | — | *"passed from the frontend"* — a raw auth token travelling **inbound** unencrypted, where `create_credential` would have used a session envelope. |
| `BridgeConfig.obsidian_api_key` (`engine/src/desktop_runtime.rs:272`) | — | Obsidian REST key in a serialisable config struct. |

The 3 non-serialised ones are still defects of the same kind:
`AuthStateInner.google_provider_refresh_token` (`src/commands/infrastructure/auth.rs:82`) is a bare
`Option<String>` sitting **two fields below** `access_token: Option<SecureString>` and
`google_provider_token: Option<SecureString>` in the *same struct* — the type was chosen twice and
skipped once. `ResolvedToken.token` / `.refresh_token` (`src/engine/connector_strategy.rs:20,:29`)
hold live OAuth material with no zeroization.
**Fix:** `SecureString` for the 3 internal ones (mechanical, and the compiler finds every use site).
For the 9 wire ones, apply step 1 — three are already correct by design and should be annotated as
such, and the other six each need an answer to "does the renderer need the value, or a prefix?"

### D4 — `copyText` cannot tell a secret from a persona name; 8 of 11 secret copies never wipe
`src/hooks/utility/interaction/useCopyToClipboard.ts:11-19` and 11 call sites

The chokepoint is real and enforced — **2** production `navigator.clipboard.writeText` calls exist in
`src/**` (the primitive at `:13`, and one `eslint-disable`d PTY bypass at
`fleetTerminalManager.ts:369`), held by the custom ESLint rule `custom/prefer-shared-clipboard`
(`eslint-rules/prefer-shared-clipboard.cjs`, `"warn"` at `eslint.config.js:109`). What the chokepoint
does **not** have is a sensitivity parameter. Secret-bearing copies, with wipe status:

| Site | Copies | Wipes |
|---|---|---|
| `settings/sub_api_keys/components/CreatedKeyDialog.tsx:69` | the plaintext Personas API key | **no** |
| `…/CreatedKeyDialog.tsx:77` | MCP JSON with the same token inlined in `env` | **no** |
| `settings/sub_byom/components/ByomApiKeyManager.tsx:531` | a BYOM provider API key | **no** |
| `plugins/companion/sub_setup/BrowserBridgePanel.tsx:78` | the bridge pairing token | **no** |
| `plugins/fleet/FleetPairDevice.tsx:65` | the device pairing URL (token in the fragment) | **no** |
| `triggers/sub_triggers/configs/WebhookConfig.tsx:26` | the webhook HMAC signing secret | **no** |
| `triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:292` | `deployment.webhookSecret` | **no** |
| `settings/sub_network/components/IdentitySettings.tsx:52` | the exported identity card | **no** |
| `vault/sub_credentials/…/FieldCaptureHelpers.tsx:91` | any vault field when `isSecret` | **yes, 30 s** |
| `settings/sub_network/components/BundleExportDialog.tsx:167` | the base64 bundle | **yes, 30 s** |
| `…/BundleExportDialog.tsx:189` | the share deep link | **yes, 30 s** |

The two wiping implementations are duplicates of each other (`SECRET_CLIPBOARD_TTL_MS` /
`SENSITIVE_CLIPBOARD_TTL_MS`, both `30_000`).
**Fix:** hoist the wipe into the primitive behind a required classification — see §9's type answer.

### D5 — Windows Clipboard History is entirely unaddressed
`src/**`, `src-tauri/**` — **0** occurrences of `CF_CLIPBOARD_EXCLUDE`,
`ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` or
`ClipboardSetHistoryEnabled`.

Every secret this app copies is retained by Win+V and by any cloud clipboard sync. A 30 s wipe
removes the *current* clipboard contents and does not touch the history entry, so even D4's three
"protected" sites leak. The frontend writes exclusively through the DOM clipboard API — there is no
`@tauri-apps/plugin-clipboard-manager` in `package.json` and no `tauri-plugin-clipboard-manager` in
`Cargo.toml`; Rust's `arboard` (`Cargo.toml:228`) is used for **reads only**
(`engine/src/clipboard_monitor.rs:67`, `src/engine/subscription.rs:562`).
**Fix:** this needs a Rust write path — a small command that sets the clipboard with the
`ExcludeClipboardContentFromMonitorProcessing` format present on Windows, no-oping elsewhere. That is
the honest cost, and it is a Gap as much as a deviation (see Gap 3).

### D6 — Every reveal toggle holds the plaintext while masked; 5 bypass the primitive
6 reveal states; `PasswordToggleField` has **7 importer files / 11 render sites**

| Toggle | File | Uses the primitive |
|---|---|---|
| `revealed` | `shared/components/forms/PasswordToggleField.tsx:47` | is the primitive |
| `showHmacSecret` | `triggers/sub_triggers/configs/WebhookConfig.tsx:14,:38` | no |
| `visibleIds` set | `vault/sub_catalog/components/schemas/ExtraFieldRenderers.tsx:73,:133` | no |
| `isVisible` | `vault/sub_credentials/components/forms/FieldCaptureRow.tsx:61,:119` | no |
| `entry.revealed` | `settings/sub_byom/components/ByomApiKeyManager.tsx:95,:505` | no (display row; the *editor* row does, at `:462`) |
| `showRaw` | `ExecutionDetailContent.tsx:55`, `ExecutionListRow.tsx:69` | n/a (JSON, not an input) |

Plus `QuickAddCredentialModal.tsx:382` and `ConfigurationPopup.tsx:132`, which render
`type='password'` inputs with no toggle at all. None of the five bypassers gets the 8-second
auto-revert, which is the property that bounds screenshot and screen-share exposure — and this app
ships a screenshot command (`capture_validation_screenshot`,
`src/commands/execution/ambient.rs:165`) that a persona can call to capture a named window or the
whole primary display.
**Fix:** replace the five hand-rolled inputs with `PasswordToggleField`. It extends
`InputHTMLAttributes` minus `type`, so the migration is prop-for-prop.

### D7 — `ByomApiKeyManager` fetches all BYOM secrets on mount
`src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:114-139`

One `getAppSettingsBulk(['ollama_api_key','litellm_base_url','litellm_master_key'])` at mount writes
each plaintext into both `entry.value` and `entry.savedValue` (`:123-134`). The reveal toggle at
`:511-525` therefore toggles nothing but a glyph, and the masked branch at `:505` calls `maskValue`
on the live plaintext. The file already contains its own counter-example — `QwenKeyRow` at `:257-370`
— and its own good hygiene elsewhere: `logSecretSafeError` (`:18-21`) logs only the settings key and
the error *name*, with an explicit comment that backend IPC errors can echo the rejected secret.
**Fix:** fetch on reveal, not on mount; delete `maskValue` in favour of a constant.

### D8 — the render is masked and the copy button beside it is not
`src/features/shared/components/modals/ExecutionDetailModal/ExecutionDetailContent.tsx:166-167`

`<CopyButton text={execution.output_data} />` sits one line above
`maskSensitiveJson(execution.output_data)`. Same value, two policies, four columns apart.
**Fix:** copy the same expression the block renders.

### D9 — a replay `curl` is reconstructed from a captured request, headers included
`src/features/triggers/sub_triggers/WebhookRequestInspector.tsx:211`

`webhookRequestToCurl(logId)` rebuilds an executable command from a stored inbound webhook request.
By construction that carries the sender's original `Authorization` / signature headers, and it goes
to the clipboard with no wipe.
**Fix:** strip auth-shaped headers from the generated command, or run it through
`sanitizeErrorMessage`'s `INLINE_SECRET_RE` before copying.

### D10 — two maskers, neither a superset of the other; three more with near-zero adoption
`core/src/utils/sanitization.rs:22` vs `engine/src/ambient_context.rs:965`

`sanitize_secrets` has `key = value` and `Authorization:` rules and **no PEM rule** — while a PEM
private key is the single highest-value artefact found in the log store.
`redact_clipboard_content` has JWT / Stripe / Slack / AWS rules and **no `key = value` rule**, and
exactly **one** production caller (`:460`, ingest). On the TypeScript side, `maskSensitiveJson` has
3 importers, `sanitizeErrorMessage` has 2, and `maskValue` has 0 (module-local). Five maskers, no
stated guarantee.
**Fix:** one pattern set, in Rust, with the union of both rule lists plus a PEM block rule ported
from `brainiac/crates/brainiac-core/src/redact.rs:40-43`; `redact_clipboard_content` becomes a
length-capped wrapper over it.

### Cleared — claims this sweep tried to confirm and could not

These are reported because a cleared security claim is worth as much as a confirmed one.

- **No command reveals a vault credential.** All 1,667 `#[tauri::command]` functions were parsed with
  a brace-balanced body extractor. **10** reach a decryption primitive; **none** returns the
  plaintext (`export_credentials → bool`, `update_credential_field → bool`,
  `create_credential`/`update_credential → PersonaCredential`, whose `encrypted_data` and `iv` are
  both `skip_serializing`). `get_decrypted_fields` — the single decryption entry point — has **42**
  call sites; the 8 inside command bodies all consume the map and discard it. There is **no
  `reveal_credential`, no `get_field_value`, no decrypt-for-display command anywhere.** The vault is
  a one-way door and the write direction is session-encrypted end to end.
- **No export path carries a decrypted credential in the clear.** `export_credentials`
  (`data_portability.rs:9554`) requires a ≥8-char passphrase and emits only a
  `CredentialExportEnvelope` (AES-256-GCM, PBKDF2-SHA256, per-export salt + nonce).
  `build_encrypted_credentials` (`:9545`) does the same inside the unified bundle.
  `seal_sensitive_sections` (`:9239`) *errors* rather than shipping twins or Athena's memory
  unsealed.
- **The plaintext `app_settings` secrets do not travel in an export.** `PortabilityBundle`
  (`data_portability.rs:215-272`) has no `app_settings` section, so
  `browser_bridge_pairing_token` / `ollama_api_key` / `litellm_master_key` are not in any bundle.
- **Share links and clipboard bundles carry no credential values.** `engine/bundle.rs` (1,010 lines)
  touches credentials in exactly one place — `:892-897`, where it reads the **keys** of
  `design_context.credentialLinks` (connector *names*) into a `tool_integrations` set. `export_bundle`
  is the shared producer for `export_persona_bundle`, `export_bundle_to_clipboard` and
  `create_share_link`, so all three are clean of secret material. (The link's own `token` is a
  separate issue — D3.)
- **Share-link and bundle import are integrity-checked.** `verify_share_link_hash`
  (`network/bundle.rs:352-388`) pins the advertised SHA-256, **rejects** a hashless
  `personas://share` deep link, and has four unit tests at `:453-493`. File and clipboard imports
  carry the same TOCTOU guard.
- **`-webkit-text-security` is not used anywhere.** Zero occurrences repo-wide. There is no CSS-only
  mask in this codebase — every mask is either `type="password"` (a rendering mode, still a defect
  per Anti-pattern 4) or a real string transform.
- **`maskSensitiveJson` is length-blind.** Fixed-width `MASK = '********'` (`maskSensitive.ts:13`),
  so unlike `maskValue` it publishes nothing about the value.
- **The clipboard chokepoint holds.** Two production `writeText` calls in 4,829 files, one of them
  the primitive and one an explicitly `eslint-disable`d PTY selection copy.

---

## 8 Gaps in the primitives

1. **`SecureString` cannot be serialized — which is correct, and is also why it stops at the
   boundary.** Any secret that must cross IPC drops back to `String` and loses zeroization, redacted
   `Debug`, and redacted `Display` for the rest of its life. This is the same gap
   [structured-logging](./structured-logging.md) records as its Gap 4, seen from the other side. A
   `SecureString` that serializes as `[REDACTED]` unless routed through an explicit
   `ExposeOnce<T>` wrapper would extend the guarantee across the boundary instead of terminating it
   there. Until that exists, §2's rule "don't send it" is doing work the type system could be doing.

2. **`copyText` has no classification, and the two sites that compensate duplicate each other.**
   The primitive's signature is `(text: string) => Promise<boolean>` — a secret and a persona name
   are the same type. The TTL wipe exists twice, at `FieldCaptureHelpers.tsx:98-116` and
   `BundleExportDialog.tsx:25-50`, with the same 30 s constant under two names. This is a genuine
   primitive gap, not laziness: **D4, D7's copy row, D8 and D9 are all downstream of it.**

3. **There is no clipboard *write* path in Rust, so history exclusion is unreachable from where the
   app currently copies.** The DOM `navigator.clipboard.writeText` cannot set
   `ExcludeClipboardContentFromMonitorProcessing`; `arboard` is present but used only for reads. D5
   cannot be fixed in TypeScript at all — it needs a new command, and that cost should be weighed
   honestly rather than filed as a lint.

4. **A screenshot cannot be redacted, so exposure time is the only lever.** `capture_validation_screenshot`
   (`src/commands/execution/ambient.rs:165`) writes a PNG of a named window or the primary display.
   Nothing downstream can mask what was on screen. This is why `PasswordToggleField`'s 8-second
   auto-revert is a real control and not decoration, and why D6's five bypassers matter more than
   their count suggests.

5. **React state is a disclosure surface with no primitive at all.** Every reveal toggle in the app
   keeps the plaintext in props or state while masked, so the fiber tree, a heap snapshot and a
   crash report all contain it. There is no `useSecret()` hook, no opaque-handle pattern, and the
   only correct instance in the codebase (`QwenKeyRow`) achieves it by *never fetching the value* —
   a backend-shaped fix to a frontend-shaped problem. A frontend primitive here would need runtime
   support this stack does not offer; the honest guidance is step 7 (fetch on intent), not a
   component.

6. **`sanitize_secrets` cannot recognise a bare token value.** It keys on a *label* (`api_key:`,
   `Authorization:`) or a known *prefix* (`ghp_`, `AKIA`). A 32-character opaque token on its own
   line survives every pass. `repos/core/settings.rs:45-49` already says this in its own words and
   compensates structurally by redacting a whole audit category. Any read-path sanitisation added by
   D1 inherits this limit, which is an argument for purging the historical files as well as
   sanitising the reads — not instead of.

7. **No sink distinguishes "safe to keep" from "safe to show once".** A show-once value
   (`CreateApiKeyResponse.plaintext_token`, `FleetPairResult.token`) is typed identically to a
   re-readable one once it reaches TypeScript. The show-once contract lives entirely in a doc
   comment on the Rust side and evaporates at the boundary.

---

## 9 The missing gate

### The condition, stack-free

> **A credential is held in a value type that says nothing about it being a credential, so nothing
> prevents it from being serialized to a viewer, rendered, copied or exported.**

An adopting repo must re-derive its own proxy. The proxy below keys on Rust struct-field syntax and
on this repo's naming habits; it will score zero in a codebase whose secrets are dynamic map keys, a
TypeScript interface, or an env-var list — while the condition is fully present. `personas-web`
scores zero for the *other* reason: it has no instance of the condition.

### Prefer a type over a gate — answered explicitly

**Yes, and the type already exists and already works. The gate is the ratchet, not the fix.**

`SecureString` (`src-tauri/core/src/crypto.rs:221`) makes the wrong call **unrepresentable**, not
merely detectable: it implements no `Serialize`, so a field typed `SecureString` inside a
`#[derive(Serialize)]` struct **fails to compile**. Verified by grep — there is no
`impl Serialize for SecureString` and no `#[derive(Serialize)]` on it. It also carries
zeroize-on-drop and `[REDACTED]` from both `Debug` and `Display`, so the same one-word type change
closes the log-leak surface and the memory-residency surface at the same time. Its own doc names the
exact fields this leaf is about: *"`client_secret`, `refresh_token`, `code_verifier`,
`access_token`."*

Adoption is **2 of 15**. Both instances are in one struct (`AuthStateInner`), and the third secret in
that same struct was left as `String`. This is the contract's `FacetedDecisionTable` shape exactly —
where the constraint is expressible in the type it holds, and where it is a convention it does not —
except that here the type is not even optional-with-a-default; it is simply not reached for.

**The type change is the fix. The census rule below is the ratchet that stops the number rising
while the 13 are migrated.** Fixing the type is one edit per field and the compiler finds every use
site; no ratchet moves a single one on its own.

A **second** type change is owed on the TypeScript side, and it is cheaper than it looks. `copyText`'s
dangerous parameter should be owned by the signature rather than by 11 call sites remembering:

```ts
// today — a secret and a persona name are the same type
export async function copyText(text: string): Promise<boolean>

// proposed — the classification is required, so it cannot be forgotten
export async function copyText(text: string, kind: 'public' | 'secret'): Promise<boolean>
// 'secret' folds in the 30 s verify-then-wipe already written twice
// (FieldCaptureHelpers.tsx:98-116, BundleExportDialog.tsx:25-50)
```

A **required** second parameter is the load-bearing detail — the contract's own measurement is that
`FacetedDecisionTable`'s required `emptyTitle` gets 3/3 real copy while its optional-prop siblings
get 5 of 20 falling through to a default. An optional `sensitive?: boolean` would reproduce the
`<Numeric>` failure: a green gate pointing at a primitive nobody configured. `CopyButton` grows the
same required prop and forwards it.

### The proposed instrument

**Check first that this is not already gated — it is not.** `settings-key-holding-secret`
(`app-settings-store.md`) keys on `pub const NAME: &str` in `src-tauri/db/src` and measures *which
configuration keys hold credentials* — a different tree, a different syntax, a different question
(storage, not movement). Its 3 matches and this rule's 12 are **disjoint**: no file appears in both
(`settings_keys.rs` declares key *names*, never a struct field). `unqueryable-log-record`
(`structured-logging.md`) keys on `tracing::` macro argument position. `raw-inner-html`
(`rendering-untrusted-content.md`) is the inbound direction.

**Measured, and it corrects a claim this section originally made.** Running all four rules and
intersecting their hit sets: overlap with `settings-key-holding-secret` and `raw-inner-html` is
**0 files**, but overlap with `unqueryable-log-record` is **2 files** —
`engine/src/test_runner.rs` and `src/commands/infrastructure/auth.rs`. That is *file* co-occurrence,
not condition duplication: in those two files one rule matches a `tracing::` macro's argument
position and this one matches a struct field declaration, and neither match is at a line the other
sees. The honest statement is therefore "no condition overlap, 2 files in common", not "no overlap".

- **Signal:** a `pub` struct field whose *name is a secret noun* and whose type is `String` /
  `Option<String>`, with no `#[serde(skip_serializing)]` between the previous field and it.
- **Mechanism:** a `scripts/census/rules.json` entry — the ratcheting-baseline mechanism the contract
  mandates instead of a bespoke script. It inherits the fail-loud guarantees: a `floor` violation, a
  zero-match run, a stale `exclude`, a rise **and** a silent drop are all fatal.
- **Allowlist:** exactly one entry, named and reasoned — `chain_stop_reasons.rs`, whose
  `reason_token` is a closed-vocabulary *machine* token resolved through `status_tokens.chain_stop`.
  It is the only `_token` field in 963 files that names a status rather than a secret, and excluding
  it is the difference between a gate that fires on correct content and one that does not.
- **How it fails loudly if its own precondition is absent:** the `floor: 900` assertion fails if the
  walk sees fewer than 900 `.rs` files (the tree is 963), so a moved root reports "matcher broken,
  not codebase clean" rather than green. A **positive control** rule is shipped alongside it (below)
  whose only job is to prove the same roots and extensions still reach the primitive this rule
  points at.

**Verified against the real tree before publishing.** Both rules were run through
`scripts/census/lib/engine.mjs` — the same code `npm run census` uses — from a scratch copy of the
registry, never by editing `rules.json`.

```json
{
  "id": "secret-as-bare-string-field",
  "goldenPath": "docs/concepts/golden-paths/secret-display-and-transfer.md",
  "title": "A credential held in a struct field as a bare String instead of SecureString",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "[,{][ \\t]*\\r?\\n(?:[ \\t]*(?:#\\[|//)(?![^\\n]*skip_serializing)[^\\n]*\\r?\\n){0,6}[ \\t]*pub (?:[a-z0-9_]*_)?(?:token|secret|password|passwd|passphrase|api_key|apikey|private_key|master_key|access_key)[ \\t]*:[ \\t]*(?:Option<[ \\t]*)?String",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A `pub` struct field whose NAME is a secret noun, typed as a bare String/Option<String>, with no `#[serde(skip_serializing)]` on any attribute or doc line between the previous field and it. PROXY FOR the stack-free condition \"a credential is held in a value type that says nothing about it being a credential, so nothing prevents it from being serialized to a viewer, rendered, copied or exported\". LEGAL DESTINATION: `personas_core::crypto::SecureString` (core/src/crypto.rs:221) — Zeroize + ZeroizeOnDrop, `[REDACTED]` from both Debug and Display, and NO `Serialize` impl (verified: no `impl Serialize for SecureString`, no derive), so a SecureString field inside a `#[derive(Serialize)]` struct is a COMPILE ERROR. Where the value genuinely must cross IPC once, the legal shapes are `#[serde(skip_serializing)] #[ts(skip)]` (5 uses, models/credential.rs:40,45,121,124 + models/external_api_key.rs:17) or a dedicated show-once response type (CreateApiKeyResponse, FleetPairResult). TWO INDEPENDENT IMPLEMENTATIONS RECONCILE EXACTLY: this regex reports 12 matches in 10 files, and a struct-aware line parser that tracks the enclosing struct and its derive list independently enumerates 15 secret-named String/SecureString fields = 2 SecureString (not matched, correctly) + 13 bare String, minus the 1 excluded file = 12. Zero disagreeing files. Of the 12, 9 sit in a `Serialize`-deriving struct and therefore reach the renderer (7 of those are additionally `#[ts(export)]`); the other 3 are internal but hold live OAuth material with no zeroization, including auth.rs:82 which sits two fields below two SecureString siblings in the SAME struct. PRECISION on the stated condition is 12/12 after the exclude; before it, 12/13 — the single false positive is ChainStopReason.reason_token, a closed-vocabulary STATUS token, which is why the exclude exists rather than a broader vocabulary. The `(?:#\\[|//)` line class is load-bearing in both directions: it lets the match skip doc comments and unrelated attributes, and the inline `(?![^\\n]*skip_serializing)` makes a compliant field unmatched without any lookbehind (a variable-length lookbehind cost 73s in an earlier campaign rule; this pattern runs in 864ms over 963 files). PRECONDITION (must be re-derived per repo): this repo declares wire types as Rust structs with `pub <snake_case_name>: String` fields and names credential-bearing fields with token/secret/password/api_key. A repo whose secrets are dynamic map keys, a TypeScript interface, or environment variables has the SAME condition wearing markup this pattern cannot see and scores zero — personas-web scores zero for a different and legitimate reason: it holds no secrets at all (0 type=password, 0 reveal toggles, 0 secret-bearing clipboard writes of 10). Do NOT silence a match by renaming the field."
  },
  "exclude": [
    {
      "path": "src-tauri/db/src/repos/execution/chain_stop_reasons.rs",
      "reason": "ChainStopReason.reason_token is a closed-vocabulary MACHINE token resolved through status_tokens.chain_stop on the frontend, not a credential — the only `_token` field in 963 .rs files that names a status rather than a secret, and the one false positive this vocabulary produces"
    }
  ],
  "baseline": { "files": 10, "matches": 12 },
  "floor": 900
}
```

```json
{
  "id": "secret-as-bare-string-field-positive-control",
  "goldenPath": "docs/concepts/golden-paths/secret-display-and-transfer.md",
  "title": "POSITIVE CONTROL — the SecureString primitive must remain reachable from these roots",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "pub struct SecureString \\{",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for `secret-as-bare-string-field`. It matches the DESTINATION the sibling rule routes callers to, not a violation, and therefore must never be baselined or ratcheted. Its only job is to prove that `roots: [src-tauri]` + `extensions: [.rs]` still reach personas_core::crypto — so that a zero on the sibling rule can be read as 'the migration finished' rather than 'the walk broke'. Measured 2026-08-14: 1 file / 1 match (src-tauri/core/src/crypto.rs:221), 511ms, and its match population is DISJOINT from the sibling's 12 (the sibling matches `pub <secret>: String` field declarations; crypto.rs:221 is a struct header whose one field is `inner: String`, neither `pub` nor secret-named). Deliberately shipped with NO `baseline` key so the registry merger skips it."
  },
  "floor": 900
}
```

**Measured populations and overlap**

| Rule | Files | Matches | Runtime | Overlap with the other |
|---|---:|---:|---:|---|
| `secret-as-bare-string-field` | 10 | 12 | 864 ms | **0 files** |
| `secret-as-bare-string-field-positive-control` | 1 | 1 | 511 ms | **0 files** |

The 10 violating files: `src/engine/connector_strategy.rs` (×2), `src/engine/share_link.rs` (×2),
`core/src/models/external_api_key.rs`, `core/src/types.rs`, `engine/src/desktop_runtime.rs`,
`engine/src/test_runner.rs`, `src/cloud/client.rs`, `src/commands/companion/browser_test.rs`,
`src/commands/fleet/pairing.rs`, `src/commands/infrastructure/auth.rs`. The control's single file is
`core/src/crypto.rs`. No file appears in both, and neither appears in
`settings-key-holding-secret`'s single file (`src-tauri/db/src/settings_keys.rs`).

### Two conditions this leaf will not gate, and why refusing is the right answer

**Refusing to gate is first-class — with measurement.** Both refusals below are supported by counts,
and both name the instrument that *would* work.

1. **"A secret reaches the clipboard without a wipe."** This is D4, the highest-frequency defect in
   the leaf (8 of 11 sites), and it is **not gateable by counting**. The signal would have to be
   "this `text=` expression is a secret", which is a value-provenance question no regex and no
   single-file AST rule can answer — `CopyButton text={row.deployment.webhookSecret}` and
   `CopyButton text={row.deployment.slug}` are the same shape. Counting `<CopyButton` instead would
   fire on all **26** render sites, of which 8 are the defect: a 31% precision gate that fires on
   correct content, which the contract rates as **worse than no gate**. The correct instrument is
   the **required-parameter type change** above: it converts an undetectable value-provenance
   question into a compile error at every one of the 26 sites at once, and it needs no census rule
   at all. Note also that the *existing* gate here (`custom/prefer-shared-clipboard`) already
   demonstrates the contract's fifth failure mode — it verifies you reached `copyText` and can say
   nothing about whether `copyText` was worth reaching.

2. **"`get_execution_log` must never return an unsanitised log line."** This is D1, the most
   dangerous item in the leaf, and it is a **must-be-zero** condition. **The census engine cannot
   express "must be zero"**: `assertRule` raises a structural `zero-matches` failure for any rule
   matching nothing (`engine.mjs:264-273`, whose own message says a rule pinned at 0 *"is a gate
   that can never fail"*). A must-never-happen condition therefore needs a **test**, not a census
   rule. The concrete instrument: a Rust unit test beside `get_execution_log` that writes a fixture
   log containing one of each shape `sanitize_secrets` recognises (a `ghp_`-prefixed token, an
   `AKIA` key, an `Authorization: Bearer` line, a `key = value` pair), calls the read path, and
   asserts the returned string contains `[secret]` and none of the fixture values. Run it with
   `npm run test:rust` (the manifest-embedding wrapper — a bare `cargo test` exits 127 on Windows
   before `main()`). That test fails the moment someone removes the sanitiser, which no count can do.

### One more thing a gate cannot see, stated so the next reader does not assume it can

The census rule counts *types*. It cannot see that `browser_bridge_status` is polled every 5 seconds,
that `ByomApiKeyManager` fetches on mount rather than on intent, or that a `truncate` class is
ellipsis rather than elision. Those are D2, D6 and D7, and they are found by reading the component,
which is what §4 step 7 and §5 anti-pattern 6 exist to prevent in the first place.
