# Golden path — cross-device pairing and dispatch

> Situation node: `integrations-security/external-and-host-surfaces/cross-device-pairing` ·
> [situation spine](../situation-spine.md) · recurrence 7 · risk **HIGH** · sides **both** ·
> convergence **converged — tested and REFUTED, see §12.1** · dimensions: **security · function ·
> resilience · ui**
> Composed 2026-08-17 against `master` @ `5d55d6a4a`.
>
> **Sweep.** All **963** non-generated `.rs` files under `src-tauri/` and **4,829** `.ts`/`.tsx`
> under `src/`. Every pairing, enrollment and peer-trust path in the tree enumerated and classified:
> `engine/src/p2p/{protocol,connection,device_pairing,remote_jobs,mdns,transport,manifest_sync}.rs`,
> `engine/src/pairing.rs`, `engine/src/identity.rs`, `engine/src/workspace_sync/crypto.rs`,
> `commands/fleet/{pairing,companion_api}.rs`, `commands/network/{owned_devices,pairing,identity}.rs`,
> `commands/companion/approvals/approval_exec_devices.rs`, `companion/remote_jobs.rs`,
> `cloud/remote_commands.rs`, `browser_bridge/mod.rs`, `db/src/repos/resources/owned_devices.rs`,
> `core/src/models/{identity,owned_device}.rs` read in full or near-full. Client half:
> `src/features/settings/sub_devices/**` (8 components + `pairingMachine.ts` + `pairingRefusal.ts`),
> `src/lib/network/p2pCapability.ts`, `src/features/plugins/fleet/FleetPairDevice.tsx`,
> `src/features/cloud/RemoteApprovalPrompt.tsx`, and the mobile PWA at
> `src-tauri/resources/mobile/{app.js,index.html}`.
>
> **Measured by executing, not reading.**
> 1. **The operator's app was running throughout** (pid 27816). Its listeners were enumerated from
>    the OS (`Get-NetTCPConnection` / `Get-NetUDPEndpoint`) and both shipped binaries were probed for
>    the pairing subsystem's compile-time constants. Results in §0.1. **No socket was opened, no
>    packet sent, nothing paired.**
> 2. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 71 tables, copied with their WAL 2026-08-17) queried for what every trust
>    registry actually holds. **Deleted when the measurement finished.**
> 3. **On-disk ACLs** read for every location that holds pairing material, plus the six
>    `fleet-mcp-*` temp directories.
> 4. The §9 rule was built in a private scratch registry, hand-verified against a
>    brace-matched `#[cfg(test)]` stripper, raced against three rival signals that were refused with
>    numbers, and re-extracted from this document and re-run.
>
> **NEVER PRINT A SECRET.** No token, key, code or fingerprint value appears below. Shapes, lengths,
> paths, ACEs and counts only.
>
> The **Deviations** section is a fix backlog. Nothing in it was applied.

---

## 0. The headline, before anything else

### 0.0 Is any pairing material readable by another account on this machine? — **No, with one qualification you should know about**

Asked first because the brief asks it first. Measured, not reasoned:

| Where pairing material lives | ACL | Verdict |
|---|---|---|
| `%APPDATA%\com.personas.desktop\personas.db` (holds `owned_devices`, `local_identity`, `app_settings`) | **`DOLLARSTORE\mkdol` FullControl — a single ACE, no other principal** | **not readable by another account** |
| `%APPDATA%\com.personas.desktop\` (the directory) | same single ACE | not readable by another account |
| Ed25519 private key | **OS keyring**, user-scoped (`engine/identity.rs:145` `store_private_key` → `keyring::Entry`) | not on disk at all |
| The six `fleet-mcp-*` temp dirs | Owner `DOLLARSTORE\mkdol`, but **five inherited ACEs** including `dollarstore\CodexSandboxUsers` **Modify** and `S-1-5-21-…-1568765756` **Modify** | **two non-owner principals hold Modify** |

The qualification: **four of the six `fleet-mcp-*` directories are empty** (the scrubber ran). The two
that survive — from 2026-08-09, eight days stale — each hold one `mcp.json` of 206 bytes whose only
credential-shaped field is `mcpServers.athena.headers.X-Athena-Session`, a **32-character** session
token for the loopback Athena MCP router. **That is not cross-device pairing material.** No device
token, no peer public key, no `owned_devices` row, and no `device_group_id` has ever been written to
a temp directory. The two non-owner Modify ACEs are inherited from `%LOCALAPPDATA%\Temp` itself and
are a property of this machine's sandbox configuration, not of this app.

So: **no cross-device pairing secret is readable by another account.** The one file class that *is*
group-writable belongs to [second-transport-exposure](./second-transport-exposure.md)'s subject, and
its finding there stands.

### 0.1 The app's entire freshness apparatus lives in the one transport that is not in the binary

This was measured on the running process and on both shipped artifacts, and it is the fact that
reorganises everything below.

```
running app  pid 27816  ->  src-tauri/target/debug/personas-desktop.exe   (started 2026-08-16 18:39)
  UDP  ::/0.0.0.0:4242      NOT BOUND        <- the QUIC peer transport is absent
  UDP  5353 (mDNS)          bound by svchost, NOT by the app
  TCP  127.0.0.1:9420       LISTENING        management + webhook + cloud-pairing
  TCP  127.0.0.1:17400      LISTENING        local_http
  TCP  127.0.0.1:17320      LISTENING        test-automation (debug build)
  TCP  0.0.0.0:17500        NOT LISTENING    <- companion LAN server: nothing paired
```

Probing the two binaries for the pairing subsystem's own compile-time constants settles *why*:

| string | `target/debug` (running) | `target/release` (built 2026-08-09) |
|---|---:|---:|
| `personas-p2p-handshake/v2` | **0** | **1** |
| `personas-p2p-pairing/v1` | **0** | **1** |
| `QUIC endpoint bound` | **0** | **1** |
| `_personas._tcp` | 0 | **12** |
| `mdns` | 0 | **67** |
| `quinn` | 0 | **247** |

> The two domain constants above were renamed by protocol v3 (2026-08-22) and are now
> `personas-p2p-handshake/v3` and `personas-p2p-pairing/v2`. The counts stand as measured against
> the binaries named in the header; re-probe with the new strings, not these.

**What a runtime observer could tell:** everything. The absence is externally legible three ways —
UDP/4242 unbound, no mDNS service registered by the app, and the `#[cfg(feature = "p2p")]` gate on
the `generate_handler!` entries (`lib.rs:3544-3569`) means `pair_request` / `pair_confirm` /
`list_owned_devices` / `send_remote_instruction` are **not dispatchable at all**, so a probe gets a
bare Tauri refusal rather than a structured error. The frontend detects exactly that, structurally,
at `src/lib/network/p2pCapability.ts:54-61`. The running build is `tauri.lite.conf.json` →
`["desktop"]`; `tauri.conf.json` and `tauri.stable.conf.json` both select `["desktop-full"]` =
`desktop + ml + p2p` (`Cargo.toml:57`). **The shipped product has this code; the operator's daily
build does not.**

Now the count that matters. `nonce` occurs **394** times across 963 Rust files. **102 of them —
`protocol.rs` 65, `connection.rs` 24, `device_pairing.rs` 13 — are inside `p2p/`.** That is where
the three-leg mutually-fresh signed handshake lives, and it is compiled out. Of the transports that
**are** in the running binary and that trust a remote party:

| reachable trust path | credential | freshness contributed by the verifier |
|---|---|---|
| `webhook.rs:537` `verify_hmac_sha256(secret, body, signature)` | per-trigger HMAC secret | **none** — the MAC covers the body and nothing else; no timestamp header is read, no nonce store exists, `webhook_request_log` holds **0 rows** |
| `companion_api.rs:223` `authorize` | device bearer token | **none** — LAN-peer check, then a constant-time digest compare |
| `browser_bridge/mod.rs:141` | session token | **none** — and the compare is `==` |
| `companion/orchestration/mcp/mod.rs:108` | `X-Athena-Session` | **none** — and the lookup is `HashMap::get` |
| Tauri IPC `x-ipc-token` | static process token | **none** by design (in-process) |
| `engine/pairing.rs` (cloud-app pairing) | caller-supplied nonce | **yes** — 300 s TTL, single-use claim, origin-bound. **The only reachable path with freshness.** |

**The strongest integrity check in the tree is `verify_hmac_sha256`, and a captured, still-validly-signed
delivery replays forever.** A sibling repo names this exact defect in a comment
(`ascent app/webhook/route.ts:80-81`) and fixes it with a two-tier delivery store. We have neither
tier.

### 0.2 Five trust anchors, five schemes, and none can answer another's question

| # | Anchor | Where it lives | Written by | Read as authorization by | Live rows |
|---|---|---|---|---|---:|
| 1 | `owned_devices` | `personas.db` table | the fingerprint ceremony (`device_pairing.rs:311,:420`) **and** `register_owned_device` (`commands/network/owned_devices.rs:33`) | `remote_jobs.rs:222` (run an instruction), `approval_exec_devices.rs:99` (pick a target) | **0** |
| 2 | `trusted_peers` (`trust_level`) | `personas.db` table | `add_trusted_peer` / `update_trusted_peer` (`commands/network/identity.rs:83,:101,:107`) | `mdns.rs:88` `is_trusted_peer`, **behind a 30-second process-global cache** (`:76-104`) | **0** |
| 3 | `fleet_companion_devices` | a **JSON array in one `app_settings` row** | `fleet_pair_device` (`commands/fleet/pairing.rs:252`) | `companion_api.rs:223` | **absent** (key not in the 32-row table) |
| 4 | `external_api_keys` origin-bound pairing | `personas.db` table | `approve_pairing` (the cloud-app ceremony, `engine/pairing.rs`) | `management_api.rs:414` | 1,029 rows, **0 from this path** |
| 5 | `browser_bridge_pairing_token` | **one plaintext `app_settings` value, 32 chars** | `init_pairing_token` / `set_pairing_token` (`browser_bridge/mod.rs:105,:115`), or the `PERSONAS_BROWSER_BRIDGE_TOKEN` env override (`:89`) | `browser_bridge/mod.rs:141` | 1 |

Five ceremonies. Five credential shapes (proven Ed25519 key · imported identity card · SHA-256 device
token · scoped origin-bound API key · one global shared secret). Five revocation stories. **Zero
shared predicate.** This is [second-transport-exposure](./second-transport-exposure.md)'s P1 —
one scheme per transport, added when the transport was added — reproduced one layer down, on the
question of *who* rather than *what*.

### 0.3 The ceremony's cryptographic product is persisted and never read again

`owned_devices.public_key` is written by `register_paired_device` (`owned_devices.rs:124`), selected
in both read queries (`:380`, `:394`) and mapped into the struct (`:432`). **Outside the repo's own
SQL there is exactly one reader in 963 Rust files and 4,829 TypeScript files, and it is a test
assertion** (`owned_devices.rs:551`). Production readers: **zero**.

The trust gate is `owned_devices_repo::get_owned_device(peer_id)?` matched on `Some(_)`
(`p2p/remote_jobs.rs:222`). Presence is the whole check.

That is *sound* for a ceremony row, because `peer_id = base58(sha256(public_key))`
(`identity.rs:73-76`, full 32-byte digest, not truncated) and the handshake proves possession of the
key that hashes to the claimed id (`protocol.rs:284-304`). Checking the id **is** checking the key.
It is not sound for the other writer:

```rust
// commands/network/owned_devices.rs:33  — a #[tauri::command], Public tier
pub fn register_owned_device(state, peer_id: String, device_group_id: String, display_name: String)
```

`require_auth_sync` is a **documented no-op** returning `Ok(())` unconditionally
(`ipc_auth.rs:477-479`), and the command is **absent from `PRIVILEGED_COMMANDS`** — the only
pairing-adjacent names on that list are `approve_pairing` and `reject_pairing` (`ipc_auth.rs:323-324`).
It writes a row with a caller-chosen `peer_id`, **`paired_at: None` and `public_key: None`**, and
`require_paired` cannot tell it from a ceremony row.

**The type already records the distinction and the predicate does not consult it.** `OwnedDevice`
says so in prose at `core/src/models/owned_device.rs:27-32`: *"`None` for rows registered manually
via `register_owned_device`."*

**And the manual writer has no caller.** `register_owned_device` appears in `src/` exactly twice: as
a union member in `commandNames.generated.ts:1282` and inside a docstring in
`bindings/OwnedDevice.ts:27`. `src/api/network/devices.ts` — the module that wraps every other
owned-device command — **does not export it.** Zero call sites, on either side.

### 0.4 `device_group_id` is an identifier in one module and an AES-256 key seed in another

```rust
// engine/src/workspace_sync/crypto.rs:43
pub fn derive(group_secret: &str) -> Self {
    let hk = Hkdf::<Sha256>::new(None, group_secret.as_bytes());   // <- the device_group_id
```

`SyncKey::derive` HKDFs the device-group anchor into the AES-256-GCM key that seals cross-device
persona snapshots. The same value is, in the same tree:

- described as a shared **identifier** — *"A pairing flow shares it out-of-band (QR/PIN); both devices
  then store the same value so each can recognise the other as its own"* (`owned_devices.rs:20-23`);
- stored **plaintext** in `local_identity.device_group_id` and on every `owned_devices` row;
- returned by `get_device_group_id`, a **Public-tier IPC command** (`commands/network/owned_devices.rs:16`),
  wrapped for the client at `src/api/network/devices.ts:50-51`;
- serialized to the frontend as `OwnedDevice.deviceGroupId` on **every** device row
  (`src/lib/bindings/OwnedDevice.ts:18`);
- **put on the wire in `PairRequest` before any human has confirmed anything**
  (`device_pairing.rs:236-239` — the initiator sends its group id in the opening frame; the human
  decision happens later, on the *responder*, at `:368`).

That last one is the sharp end: the six-digit fingerprint exists to let a human notice a
machine-in-the-middle, and the initiator hands over the key seed *before the human looks at the code*.
Cancelling the ceremony does not take it back.

**Stated as a latent break, not an observed outage.** `SyncKey::derive` has **zero callers**;
`seal_snapshot` and `open_snapshot` have **zero callers**; `workspace_sync` is declared at
`engine/src/lib.rs:162` and consumed by nothing. The Stage 3b transport was never built. What ships
today is a value classified two incompatible ways in two modules, waiting for the module that makes
the classification matter. Live `local_identity.device_group_id` is **NULL**.

### 0.5 What a paired device may do, and what unpairing does not reach

A peer with a row in `owned_devices` can send `RemoteJobRequest`, which reaches
`companion/remote_jobs.rs` and runs **a real Athena turn with her full op set**. The file says so and
gives its reasons (`:20-32`), and one of the three reasons it names **no longer exists**:

> *"Everything that constrains Athena locally still constrains her here, unchanged and unduplicated:
> approval rows for anything gated, **`AUTOAPPROVE_ALLOWLIST`** + the boldness matrix under autonomous
> mode, `validate_fleet_cwd` on every spawn, the role caps."*

`AUTOAPPROVE_ALLOWLIST` was deleted on 2026-08-10, deliberately, with a careful historical note in its
place (`approval_autopilot.rs:13`: *"This module used to carry `AUTOAPPROVE_ALLOWLIST`…"*). Measured at
`5d55d6a4a`: the identifier survives on **10 lines across 6 files, all of them comments, with 0
declarations** (`grep -c '^\s*(pub )?(const|static|fn).*AUTOAPPROVE_ALLOWLIST'` returns 0).
[second-transport-exposure](./second-transport-exposure.md) §7.H reported this on 2026-08-16; **it is
still open one day later**, and it is this leaf's defect rather than that one's, because the borrowed
control is the *entire* safety argument for what a paired device may do.

And on this install `companion_autonomous_mode = "true"`. `gate_remote_instruct`
(`approval_exec_devices.rs:57`) reads: autonomous ON → **`Autofire` to any paired device, no card, no
click**. The rule is well-built — one pure function, both paths through it, asserted absent from the
generic allowlist, reads the persisted row rather than a passed flag — and the setting it reads is
currently the permissive one.

**Revocation.** `forget_owned_device` is a bare `DELETE` (`owned_devices.rs:404-411`). It does not
close the QUIC connection — `disconnect_peer` exists one file away at `connection.rs:931` and is not
called from the unpair path. It does not cancel a running inbound job: `execute` returns immediately
and the turn runs in a spawned task with a **27-minute** ceiling (`REMOTE_TURN_TIMEOUT`,
`companion/remote_jobs.rs:75`). So unpairing stops the *next* frame and nothing that is already
running. The companion side is better by accident of shape: `authorize` re-reads the device store on
every request (`companion_api.rs:237`), and the phone polls, so revocation lands within one poll —
and the PWA self-heals, dropping its token from `localStorage` on any 401 (`resources/mobile/app.js:312-316`).

### 0.6 The client half: the ceremony ends in a bare primary button

| Surface | Anti-misclick arm delay |
|---|---|
| `RemoteApprovalPrompt.tsx:19,:63-67,:152` — approve a run pushed from the cloud | **450 ms**, `disabled={!armed}` |
| `PairApprovalModal.tsx:24,:55-64,:190` — approve a cloud app's pairing | **450 ms**, `disabled={!armed}` |
| Mobile PWA `Kill` (`resources/mobile/app.js:91-113,:258-259`) | two-tap, 3500 ms decay |
| Mobile PWA `Approve` (`app.js:213-217`) | **none** |
| **`IncomingPairingPanel.tsx:72-80` — "Codes match, pair"** | **none.** `variant="primary"`, rightmost position, focusable on mount, no checkbox, no re-type, no dwell |

The copy does its job (`sharing.incoming_body` = *"Confirm only if the code below matches the one on
the other screen"*; the button is literally labelled **"Codes match, pair"**). Nothing enforces it.
And the repo's own priorities are inverted: **unpairing** an already-trusted device is behind a
two-step `InlineConfirm` (`PairedDevicesPanel.tsx:127-143`); **granting** trust to a new one is one
click. The two 450 ms arms in this codebase are both on *cloud* approvals; neither is on the ceremony
that permanently admits a machine to the device group.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No file
path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *A pairing ceremony produces a fact; every later
> trust decision must be a re-derivation of that fact, not a memory of it.* The ceremony proves
> something expensive — key possession, a human's eyes on a code, an operator's click. What survives
> into the registry is usually a row. If the later check reads only that the row exists, the system's
> real authentication strength is the strength of whatever can write a row, which is never the
> ceremony.
>
> **P2 — physics, and the clause that decides whether P1 bites.** *A trust registry with two writers
> of different strength, and one reader that cannot tell them apart, authenticates at the strength of
> its weakest writer.* This is not a bug in the reader. The reader is asking the only question the
> schema lets it ask. **Count the writers before you trust the reader**, and if any writer skips the
> ceremony, either delete it or make its rows a different type.
>
> **P3 — physics.** *Bind the peer's identifier to the peer's key, so that checking the identifier is
> checking the key.* When the identifier is derived from the credential — a hash of the public key, a
> fingerprint of the token — a registry lookup by identifier is cryptographically equivalent to a
> credential comparison, and the cheap check becomes the strong check for free. When the identifier is
> *claimed* by the peer, every registry read is a second place the binding can be forgotten.
>
> **P4 — physics, and the most reinvented omission in the subject.** *Possession of a credential
> proves possession, never freshness.* A bearer token, a body-only MAC and a signature over a message
> the verifier did not contribute to are all replayable by anyone who ever saw one. Freshness is not a
> property of a secret; it is a property of an exchange, and it costs one value the verifier chose —
> a nonce, a monotonic counter inside the MAC, or a timestamp window with a seen-set. **The verifier
> must contribute something, or there is no freshness at all.**
>
> **P5 — physics.** *A short human-comparable code is a control only if the protocol cannot complete
> without the comparison having happened.* Six digits shown on two screens is a fine mechanism and a
> useless control if the confirm button is a bare primary affordance the human reaches before reading
> the number. The comparison is the security property; rendering the code is only its prerequisite.
>
> **P6 — physics, and the one that costs the most when it is wrong.** *Nothing the ceremony will later
> protect may be disclosed before the ceremony completes.* The opening frame of a handshake is sent to
> a party you have not yet authenticated to a person. Anything of value in it has already left when the
> human declines. Order the exchange so that secrets follow confirmation, never precede it.
>
> **P7 — physics.** *Revocation must reach the work, not merely the door.* Deleting a trust row stops
> the next request. It does not close an open connection, cancel a running task, or interrupt a
> subprocess that the revoked peer started. A revocation that only a future request will notice is a
> policy change, not a control — and the moment the operator reaches for it is precisely the moment
> something is already running.
>
> **P8 — physics.** *A borrowed control leaves no reference the deleter can follow.* When one
> subsystem's safety argument is "everything that constrains this locally still constrains it here",
> that argument is now a dependency with no import, no test and no link. It will rot silently, and it
> will rot in the direction of permissiveness, because the local change that removed the control was
> reasoned about locally and correctly. **Write the dependency as code, or accept that it is prose.**
>
> **P9 — security.** *A value that is key material must never also be an identifier.* The moment the
> same string is both "how two devices recognise each other" and "what their shared key is derived
> from", every surface that legitimately displays, logs, transports or exports the identifier becomes a
> key-disclosure channel — and each of those surfaces was built by someone reading the identifier
> docstring. Separate them at birth: derive the key from the secret, and derive a public identifier
> from the key.
>
> **P10 — ergonomics, and the corollary of P1.** *A paired device's authority must be a written
> allowlist, not "whatever the local user could do".* "The request is the operator's own, arriving over
> a different keyboard" is a true sentence about intent and a false one about blast radius: the
> keyboard is on a device that can be lost, and the population that can reach it is a network, not a
> person. Enumerate the verbs.
>
> **P11 — ergonomics.** *Every trust registry needs a per-decision ledger, and the ledger is how you
> learn the registry has never been used.* Row counts answer "has anyone ever paired"; a decision
> ledger answers "has this gate ever refused anything", which is the only evidence that a gate is a
> control rather than an unexercised branch.
>
> **Scale condition.** P3, P4, P6 and P9 are correctness on day one and are unfixable later without a
> protocol break. P1/P2 bite the moment a second writer appears, which is usually the "let me just add
> a manual override for testing" commit. P5 and P10 bite the first time a device is lost. P7 bites the
> first time somebody revokes in anger. P8 bites six days after an unrelated refactor. P11 bites when
> you first ask whether any of this works.

### Warrant evidence — the sibling cohort, measured before any ratio

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five reachable; nothing reported by omission.**

**Lineage: cohort 5 → 4 independent, and the exclusion is a new tell worth recording.**
`personas-web` is disqualified twice over. It is a port
(`src/styles/tokens.css:4` *"Both personas-desktop and personas-web import this file"*;
`src/styles/themes.css:2` *"adopted from Personas desktop"*; `src/lib/sentry-pii.ts:4`
*"Mirrors the desktop Rust pii module"*; ~15 further `Mirrors the desktop <feature>` docstrings) —
**and, decisively for this subject, it is a client of our pairing decision rather than a reinvention
of it**: `src/lib/supabaseApi.ts:371` selects from `synced_devices` and `:389` inserts
`target_device_id` into `pending_commands`. **A sibling that reads your trust store is not a second
opinion; it is a dependent.** That is a distinct exclusion criterion from the doctrine's textual-port
tell, and it should be added to the oracle's checklist.

`vibeman` carries Personas ports — `src/lib/contexts/fileHashes.ts:9` and
`src/app/db/migrations/234_context_file_hashes.ts:10` share the sentence *"Ports the Personas
dev_context_file_hashes cache"* verbatim — but **all five tells are in its context-map subsystem**;
`src/lib/remote/**` and `src/app/api/remote/**` contain zero `personas|ported|mirrors` hits. Its device
mesh is independently arrived at. `brainiac`, `personas-cloud` and `ascent` carry no Personas tells in
any pairing-adjacent file. **Effective cohort: 4.**

- **P3 is PHYSICS by unanimous absence, and Personas is the only repo in six that has it.**
  **0 of 4** derive the peer's identifier from the peer's key. Every one lets the peer *claim* its own
  identifier and bolts an out-of-band check on afterwards: `brainiac`'s `remote` + `label` are
  caller-supplied strings (`crates/brainiac-server/src/onboard.rs`), `personas-cloud`'s worker id is
  `process.env['WORKER_ID'] || worker-${nanoid(8)}` (`worker/src/config.ts:48`), `vibeman`'s
  `device_id` is wholly unauthenticated (`api/remote/devices/route.ts:62` checks presence only),
  `ascent`'s `installationId` is claimed in the webhook payload — which is why it must re-confirm it
  against GitHub (`app/webhook/route.ts:125` `installationMatchesOwner`). **Nobody uses public-key
  authentication at all**; it is bearer or shared-secret HMAC in 4 of 4. The clause is stated as
  physics rather than house convention because `ascent`'s re-confirmation step is the *cost* of not
  having it, paid explicitly, in a repo that never heard of this one.
- **P4 converges as a split, and the two repos that got it right wrote the reason down.**
  **2 of 4** defend replay in the pairing/inbound path. `personas-cloud` signs `${seq}.${payload}`
  (`packages/shared/src/crypto.ts:221-238`) so the monotonic counter is **inside** the MAC — the
  strongest single mechanism in the sweep, because a counter checked *beside* a signature is forgeable
  by substitution — plus a nonce set and a ±5-minute window on its Kafka path (`crypto.ts:130,:176,:203`).
  `ascent` runs an honest two-tier store: a process-local `Map` with 10-minute TTL and a 2000 cap,
  documented as *"only a fast FIRST-LEVEL filter — it is PROCESS-LOCAL"*, over an authoritative 24-hour
  DB claim (`app/webhook/route.ts:70-90,:512`), and states the physics verbatim: *"a GitHub HMAC never
  expires, so a captured, still-validly-signed delivery can be REPLAYED anytime"* (`:80-81`).
  `brainiac` has a 900-second TTL and a one-shot claim but **zero** nonce, timestamp or HMAC;
  `vibeman` has nothing at all. **Personas' reachable transports are in the `vibeman` half.**
- **P5 converges as a near-total absence, with one attempt — and the attempt has our exact defect.**
  **1 of 4** has a human-comparable code: `brainiac`'s RFC-8628 device flow, whose alphabet constant is
  the best line in the sweep — `onboard.rs:72` `CODE_ALPHABET: &[u8] = b"ACDEFGHJKMNPQRTUVWXY234679"`
  with *"no 0/O, 1/I/L, 5/S, 8/B — the human compares this code across a terminal and a browser."*
  **And its approve endpoint takes `Path(id): Path<Uuid>`, never the `user_code`** (`onboard.rs:466`) —
  so the comparison is advisory there too. Two repos, two ceremonies, two codes nothing forces anyone to
  read. **That is the strongest evidence in this document that P5 is physics and not fussiness.**
  **3 of 4 are pure possession-of-a-link.**
- **P2 converges as a defect, and `vibeman` is the null hypothesis already refuted on this machine.**
  Its `POST /api/remote/devices` takes an unauthenticated self-asserted `device_id`; its own audit
  quotes the source comment — *"Unlike the main commands API, this doesn't require API key
  authentication"* — and names the root cause: *"The data model has no `owner`/`tenant` column on
  `vibeman_devices` or `vibeman_commands`, so 'can this principal act on this device?' cannot be
  answered"* (`docs/harness/bug-ux-scan-2026-06-14/remote-device-control.md:19,:30`). Personas' second
  writer is the same shape with a ceremony sitting beside it.
- **P7 converges as a defect — 1 of 4 reaches in-flight.** Only `personas-cloud` interrupts live work,
  via `ws.close(1008, …)` on a bad HMAC or hello and a `4409` duplicate-id hijack rejection
  (`workerPool.ts:183,:211,:265`). **3 of 4 are next-request-only.** `vibeman` is worse than
  next-request: its command processor polls every 5 s with the *service-role* key
  (`api/remote/devices/route.ts:99`), so a revoked client's already-queued commands still execute.
  Trust store re-read per request in **3 of 3** applicable repos — no hot-path cache anywhere in the
  fleet, which makes **our own 30-second `TRUSTED_PEER_CACHE`** (`mdns.rs:82`) a fleet-unique hazard.
  `brainiac`'s one caching exception is boot-loaded env tokens, unrevocable without a restart
  (`auth.rs:38`).
- **P10 converges as a defect — 2 of 4 bound the verbs.** `brainiac` mints **2 of its 8 scopes**
  (`onboard.rs:68` `ONBOARD_SCOPES: [&str; 2] = ["read","write"]`, never `admin`, with the reason
  *"a leaked laptop key must not mint more keys"*); `personas-cloud` types 4 orchestrator→worker verbs.
  `vibeman` exposes **18 verbs** (`src/lib/remote/types.ts:40-59`) behind 3 coarse flags with no
  per-verb and no per-device mapping. Personas' P2P lane is `vibeman`'s shape with a better ceremony in
  front of it: **one verb that means "run anything"**. Our companion lane is the fleet's best —
  **exactly five allowlisted verbs**, audited.
- **P9 was NOT tested and must be reported as untested.** No sibling derives a key from a value it also
  publishes as an identifier, because **no sibling derives a shared key at all** — 4 of 4 use bearer or
  shared-secret schemes with no KDF over a peer-visible value. The clause rests on this repo's single
  latent instance (§0.4) and on general cryptographic practice. **Do not cite it as convergent.**
- **P8 and P11 were not tested.** The oracle measured ceremonies, credentials and revocation, not
  cross-module control dependencies or per-decision ledgers. Both rest on this repo's own evidence.
- **The clause the sweep produced that this repo should steal.** `brainiac`'s ceremony **derives** the
  target from the request instead of letting the operator choose it: *"the project is DERIVED from the
  remote — the operator confirms, they don't choose, so a key can never land in the wrong project by
  mis-click"* (`onboard.rs:14-16`), with a single `UPDATE … WHERE status='approved'` so *"two racing
  polls mint at most one key"* (`brainiac-store/src/onboard.rs:186-196`), and `MAX_PENDING: i64 = 100`
  with *"the steady state an attacker can hold is exactly this many rows"* (`onboard.rs:60`). Our
  ceremony has the bound (`MAX_PENDING: usize = 16`, `device_pairing.rs:88`) and the TTL
  (`PAIRING_TTL: 300s`, `:86`); it does not have the derive-don't-choose property, and §0.6 is what
  that costs.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "let the phone approve this" · "pair my laptop and my desktop" · "run this on my other machine"
- "add a device token" · "generate a QR to link it" · "scan this to connect"
- "the peer is already authenticated, so it can do X"
- "just add a row to the devices table so I can test it"
- "check whether this peer is one of ours"
- **If you are about to write a table, settings key or in-memory map whose rows mean "this remote party
  is trusted" — you are in this situation.**
- **If you are about to write `if <registry>.get(id).is_some()` as an authorization decision — you are
  in this situation and §0.3 is about you.**
- **If you are about to write a sentence of the form "everything that constrains X locally still
  constrains it here" — you are in this situation and P8 is about you.**

**Not this path:** opening a socket at all is
[second-transport-exposure](./second-transport-exposure.md) — that path owns *the transport*, this one
owns *who is on the other end of it*. Choosing the tier for a `#[tauri::command]` is
[ipc-command-authorization](./ipc-command-authorization.md). What a granted credential is *allowed to
do* is [least-privilege-scope-grant](./least-privilege-scope-grant.md), which already measured this
leaf's commands and found `fleet_pair_device` and `fleet_companion_revoke` Public — **do not
re-derive that**. Where the credential lives at rest and how it is shown once is
[secret-display-and-transfer](./secret-display-and-transfer.md). Ending a grant is
[credential-rotation-and-revocation](./credential-rotation-and-revocation.md); *whether revocation
reaches running work* is here (P7). Whether an unattended loop was allowed to start is
[autonomy-gating](./autonomy-gating.md).

---

## 2. The one way

**Make the peer's identifier a function of the peer's credential — `id = hash(public_key)` — so that
the cheap lookup you will actually write in the trust check is cryptographically the same question as
the expensive comparison you would rather have written; this repo does that
(`identity.rs:73-76`, `protocol.rs:284-304`) and it is the single reason §0.3 is a latent defect and
not a live one.** Then **give the registry exactly one writer, and make it the ceremony** — every
additional writer lowers the system's authentication strength to its own, so a manual-registration
command is not a convenience, it is a downgrade, and the correct fix is to delete it rather than to
gate it. **Authenticate the exchange, not just the party**: three legs, each side signing a nonce the
*other* chose, with a domain-separated transcript per leg — `protocol.rs:199-252` is the reference and
it is better than anything in the sibling fleet — and where the transport is a bearer token instead,
put the counter *inside* the MAC or keep a bounded seen-set with a time window, because a counter
checked beside a signature is forgeable by substitution. **Send nothing of value before the human
confirms**: the opening frame goes to a party no person has vouched for yet, so the group anchor, the
key seed and the device inventory belong in the *response*, after the fingerprint has been compared.
**Make the comparison happen** — arm the confirm control the way the two cloud approvals in this repo
already do (450 ms, `disabled={!armed}`), or better, make the human enter the code rather than assent
to it; a code nobody reads is a code nobody compared. **Enumerate what a paired device may do as an
allowlist of verbs** — `companion_api.rs`'s five is the shape, `remote_instruct`'s "run anything with
her full op set" is not — and **never let one subsystem's safety argument be another subsystem's
uncited runtime behaviour**: if a remote lane depends on a local allowlist, import the allowlist or
assert it in a test, because a comment naming a constant does not fail to compile when the constant is
deleted. **Make revocation reach the work**: unpair must close the connection and cancel the in-flight
task, not merely delete the row, and the registry must be re-read per decision rather than cached.
Finally, **write a decision ledger per trust registry**, because a row count tells you whether anyone
ever paired and only a ledger tells you whether the gate has ever refused anything.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`engine/src/p2p/protocol.rs`** — `hello_transcript` / `hello_ack_transcript` / `hello_confirm_transcript` / `verify_handshake_proof` | **The best authentication mechanism in six codebases, and the one site to copy — after the v3 correction below.** Every transcript now also mixes in `transport::channel_binding`, an RFC 5705 exporter over the QUIC session carrying it; take it from the live connection and never from a wire field. Three legs so freshness is *mutual*: each side ends holding a signature over a nonce it personally chose. `HANDSHAKE_DOMAIN` (`:35`) separates these signatures from every other signature the app makes; the transcript encoding is injective by construction and says why (`:217-223`); `verify_handshake_proof` checks **both** that the key hashes to the claimed id and that the signature verifies (`:284-304`). Enforced on both sides — the responder refuses to establish without leg 3 (`connection.rs:631-660`), the initiator sends it before inserting (`:449-460`). 8 unit tests including replay, key substitution and identity substitution. |
| **`engine/src/identity.rs:73-76`** — `public_key_to_peer_id` | `base58(sha256(public_key))`, full digest. The binding that makes a registry lookup by id equivalent to a key comparison. The private key goes to the **OS keyring** (`:145`), never to disk. |
| **`engine/src/p2p/protocol.rs`** — `pairing_fingerprint` | Order-independent by sorting the two peer ids, fresh per ceremony by mixing the session nonce, domain-separated (`PAIRING_DOMAIN`), and honest in its own docstring about being *"a comparison code, not a secret"*. **Corrected 2026-08-22:** under `PAIRING_DOMAIN` v1 it was a pure function of two *public* peer ids and a nonce an on-path attacker was himself relaying, so a machine-in-the-middle made **both screens show the same code** — the human step confirmed the attack instead of catching it. v2 mixes the channel binding in, so the two ends of a relay derive two different codes. |
| **`engine/src/p2p/device_pairing.rs`** in full | The ceremony. `PairPending` is a **receipt, not an acceptance** (`:31-34`) — the responder never auto-accepts, because the point of the code is that a human looked at it. `PAIRING_TTL` 300 s, `MAX_PENDING` 16. The counter-offer group resolution (`:36-66`) is genuinely good: an unauthenticated wire claim (`devices_at_stake`) is used **only** to choose between counter-offering and refusing, and every write re-checks the predicate locally through `join_device_group`, so *"a peer can never talk us into stranding our own devices"* (`:301-308`). |
| **`engine/src/p2p/remote_jobs.rs:214-228`** — `require_paired`, called once at `:490` | **One gate, one call site, covering every frame of the job protocol including unsolicited progress and results.** The docstring states the leaf's whole thesis: *"An authenticated connection is NOT a trusted one — any LAN peer may complete the signed handshake."* Refusals are logged with the peer id and answered with a reason rather than a timeout. Copy the *placement*; §7.A is about what it reads. |
| **`commands/fleet/companion_api.rs:223`** — `authorize(app, peer, headers)` | **The reference for a trust check on a transport whose population is larger than loopback**, and the fleet's best verb bound. Guard order is the lesson: `is_lan_peer` **first**, so a misconfiguration answers 403 with zero secret-bearing computation; then bearer extraction; then a constant-time digest compare over **every** stored device; then a fixed 350 ms penalty before the 401. Five allowlisted verbs. Every act appended to `fleet_decisions` with the device id. The projection is deliberately data-poor (*"NO PTY bytes, no transcripts, no cwd paths, no credentials"*, `:25-27`). |
| **`commands/fleet/pairing.rs:97-134`** — `token_fingerprint` / `ct_eq` / `verify_token` | The credential half done right: 32 bytes of OS randomness, the plaintext returned exactly once, **only the SHA-256 persisted**, constant-time compare, `revoked` honoured inside the comparison, and a test asserting the persisted JSON does not contain the token (`:397-406`). `MAX_DEVICES: usize = 8` keeps the credential surface enumerable by a human. |
| **`engine/src/pairing.rs`** — the cloud-app ceremony | **The only reachable trust path in this app with freshness.** Caller-supplied nonce with a `MIN_NONCE_LEN` entropy floor, 300 s TTL, `MAX_PENDING` 32, and the token delivered **only** to the approved `Origin` via a single-use claim — never through the deep-link query string, *"deep links leak to OS logs"* (`:1-20`). Idempotent against benign double-submits without resetting a resolved outcome (`:99-110`). |
| **`src/lib/network/p2pCapability.ts`** | The client half of "this build may not have the feature". Classifies the probe rejection **structurally** (`:54-61`) — a structured `AppError` means the command exists, a bare string means Tauri refused to dispatch — never by sniffing message text, and its header documents the substring heuristic it replaced and both directions in which that failed. Indeterminate is deliberately not latched. |
| **`src/features/settings/sub_devices/lib/{pairingMachine,pairingRefusal}.ts`** | The strongest artifact in the client half. A pure reducer with the backend as sole authority, so the push path and the poll-recovery path are literally the same transition; an anti-wedge invariant (a busy lock is released when the peer vanishes from the authoritative list, `:72-85`); and an explicit refusal to guess — `action-failed` deliberately does not touch `pending` because *"whether the request survives a failed confirm is the backend's call"* (`:115-117`). `pairingRefusal` classifies **structurally first** (feature-absent, then `err.kind === 'device_group_conflict'`, then `auth`), and only then falls to 8 ordered text markers anchored on distinctive Rust phrases. 11 codes, an exhaustive `Record` so adding a code without copy is a compile error, 30 unit tests. |

**Do not exist — this path names them:**

- **A trust predicate any registry can share.** Five anchors (§0.2), five predicates, no common
  function. `require_paired` cannot answer for the companion store and `verify_token` cannot answer for
  `owned_devices`.
- **A type that distinguishes a ceremony row from a manual one.** `OwnedDevice.public_key:
  Option<String>` records the distinction in a field nothing reads (§0.3). There is no
  `PairedDevice`/`RegisteredDevice` split.
- **Any freshness on any reachable transport except the cloud-app ceremony.** No nonce store, no
  timestamp window, no monotonic counter inside any MAC. `webhook.rs` verifies a body-only HMAC.
- **A revocation that reaches running work.** `forget_owned_device` is a `DELETE`;
  `disconnect_peer` (`connection.rs:931`) has no caller on that path; there is no
  `cancel_jobs_for_peer`.
- **A decision ledger for four of the five registries.** Only the companion lane writes one
  (`fleet_decisions`, 46 rows). `remote_jobs` (0 rows) records jobs, not refusals — a peer refused by
  `require_paired` leaves a `tracing::warn!` and nothing durable.
- **An expiry on a device credential.** `PairedDevice` carries `created_at_ms`, `last_seen_ms`,
  `revoked` — and no `expires_at`. `owned_devices` carries `paired_at` and no expiry. Both are
  forever-until-revoked, which the oracle found is the fleet norm (3 of 4) and `ascent` is the
  exception.

---

## 4. Steps

1. **Derive the identifier from the credential, before anything else.** `peer_id = base58(sha256(pk))`
   for a keypair; `sha256(token)` for a bearer secret. Write down, at the derivation site, that a
   registry lookup by this identifier *is* a credential check — because that sentence is the licence
   every later `get(id).is_some()` will be relying on.
2. **Give the registry one writer and make it the ceremony.** Then enumerate the writers again and
   delete the ones that are not it. If a manual writer is needed for tests, it belongs behind
   `#[cfg(test)]`, not behind an IPC command.
3. **Design the exchange for mutual freshness.** Three legs, domain-separated transcripts, each side
   signing a nonce the other chose. If the transport is bearer-token instead, put a monotonic counter
   *inside* the MAC, or keep a bounded seen-set plus a clock window — and state in the module docstring
   which of the two you chose and why.
4. **Order the frames so nothing of value precedes confirmation.** Walk your own message enum and ask,
   of every field in the first frame: *would I hand this to a stranger?* Group anchors, key seeds,
   device inventories and display names of other machines all fail that test.
5. **Arm the confirm control, or require the code to be typed.** Match the 450 ms
   `disabled={!armed}` the cloud approvals already use, at minimum. The destructive action in the same
   panel is already behind a two-step confirm; the trust-granting one must be at least as hard.
6. **Write the allowlist of verbs a paired device may invoke, as a constant, in the file that
   dispatches them.** Five is a good number. "Her full op set" is not a number.
7. **If your lane's safety depends on a control in another module, import it or assert it.** A test
   that fails when the borrowed constant disappears costs four lines and is the only thing that makes
   P8 survivable.
8. **Ask the type question now, before §9.** The answer for this leaf is below and it is a *yes* with a
   named shape.
9. **Make revocation reach the work.** Unpair closes the connection, cancels in-flight tasks for that
   peer, and only then deletes the row. Re-read the registry per decision; if you cache it, the cache
   must be invalidated by the revocation path — and note that this repo has an
   `invalidate_trusted_peer_cache()` (`mdns.rs:122`) whose 30-second window is otherwise the
   revocation latency.
10. **Write a ledger row per trust decision, both outcomes.** Then query it and confirm the gate has
    ever refused anything.
11. **And then stop.** The tier of the command is
    [ipc-command-authorization](./ipc-command-authorization.md); what the credential may do once
    granted is [least-privilege-scope-grant](./least-privilege-scope-grant.md); the socket itself is
    [second-transport-exposure](./second-transport-exposure.md); showing the token once is
    [secret-display-and-transfer](./secret-display-and-transfer.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is the cleanest type answer in this batch, because the thing to make unrepresentable is
not the trust decision — it is the untrusted row.**

`require_paired` (`remote_jobs.rs:214`) reads `Option<OwnedDevice>` and matches on `Some(_)`. It cannot
do better, because `OwnedDevice` is one type covering two populations that were authenticated
differently. Split it:

```rust
/// A row written by the fingerprint ceremony. The public key is not optional,
/// because a row without one was never a ceremony row.
pub struct PairedDevice { peer_id: PeerId, public_key: PublicKeyB64, paired_at: String, /* … */ }

pub fn get_paired_device(pool: &DbPool, peer_id: &str) -> Result<Option<PairedDevice>, AppError>;
```

Hold it against the seven qualifications:

**Q1 (a required prop carries only what it encodes).** `PairedDevice` encodes *that a ceremony wrote
this row*, which is precisely the question `require_paired` is asking and cannot currently ask. It does
**not** encode that the ceremony was sound — a compromised ceremony still produces a `PairedDevice`.
Honest limit, and it is why §9's complementary assertion is specified.

**Q2 (requiredness is orthogonal to closedness).** Making `public_key` required on `OwnedDevice` is the
*wrong* edit and would be rejected: `None` is legitimate for the manual population. **Closedness — two
types — is the entire win**, exactly as `Option<Tz>` was for
[scheduled-trigger-firing](./scheduled-trigger-firing.md).

**Q3 (a type nobody constructs constrains nothing).** Construction sites for the trust decision:
`remote_jobs.rs:222` and `approval_exec_devices.rs:99`. Two. Enumerable in one edit. **Passes.**

**Q4 (a type anyone can construct authenticates nothing).** `PairedDevice` must be constructible only
by the repo module from a row where `public_key IS NOT NULL` — private fields, no public constructor.
With a public field it is a comment.

**Q5 (withholding beats requiring), and it is the stronger half here.** The most effective edit is not
adding a type at all — **it is deleting `register_owned_device`.** It has **zero call sites on either
side of the IPC boundary** (§0.3), it is Public-tier, and it is the only writer that produces the
population the new type exists to exclude. Delete it and `owned_devices.public_key` can become
`NOT NULL`, after which the untrusted row is unrepresentable at the schema layer and no Rust type is
needed at all. This is the
[entity-draft-editing](./entity-draft-editing.md) Q7 shape verbatim: *the fix was deleting the helper*.

**Q6 (withhold the dangerous freedom, not the answer).** What to withhold is the ability to *assert* a
peer id into the registry — not the ability to read one, list one, or forget one. All four sibling
commands stay.

**Q7 (relaxing a type is inert where the caller supplies the bad value voluntarily).** Nobody supplies
it: there is no caller. Which is what makes deletion available rather than merely desirable.

**Where the type cannot reach.** It cannot reach **`trusted_peers`**, whose gate is a
`HashSet<String>` of peer ids behind a 30-second cache (`mdns.rs:97-104`) — the keys are dropped by the
`SELECT` itself (`:112`), one layer below where any Rust type could look. It cannot reach
**`fleet_companion_devices`**, which is a JSON array in a settings row and therefore behind a
serialization boundary (doctrine, *where types cannot reach* item 4). And it cannot reach freshness at
all, which is a property of an exchange and not of a value. **So: a real type answer that closes one of
five registries. Ship it, and ship the ratchet.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`if registry.get(id).is_some() { trust }`** | The check is only as strong as the weakest thing that can write a row. Measured: `remote_jobs.rs:222` is sound *only* because `peer_id` is key-derived, and a second writer (`commands/network/owned_devices.rs:33`) inserts caller-chosen ids with no key. |
| **A "manual registration" command beside a ceremony** | It is not a convenience, it is a downgrade of the whole registry. `vibeman` shipped only the manual half and its own audit records the consequence. |
| **A field that records provenance and a predicate that ignores it** | `owned_devices.public_key` is written by the ceremony and read by **one test assertion** in 5,792 files. The distinction exists in the schema, the docstring and the binding, and nowhere in the decision. |
| **Verifying a MAC over the message only** | `verify_hmac_sha256(secret, body, signature)` (`webhook.rs:537`) — the verifier contributes nothing, so a captured delivery replays forever. This is the strongest integrity check in six codebases and it has no freshness at all. |
| **Checking a counter *beside* a signature instead of *inside* it** | Forgeable by substitution. `personas-cloud` signs `${seq}.${payload}`; that ordering is the whole mechanism. |
| **Sending the group anchor / key seed in the opening frame** | `PairRequest` carries `device_group_id` (`device_pairing.rs:236-239`) and the human decision happens later, on the other device. Declining does not take it back. |
| **A confirm button the human reaches before the code** | `IncomingPairingPanel.tsx:72-80`: `variant="primary"`, rightmost, focusable on mount, no arm, no checkbox. The same repo arms two *cloud* approvals at 450 ms and puts the *unpair* action behind a two-step confirm. |
| **"Everything that constrains X locally still constrains it here"** | `companion/remote_jobs.rs:29` names `AUTOAPPROVE_ALLOWLIST` as one of three surviving bounds. It was deleted 2026-08-10. **9 comments, 0 declarations.** A borrowed control leaves no reference the deleter can follow. |
| **A value that is both an identifier and key material** | `device_group_id` is HKDF'd into an AES-256 key (`workspace_sync/crypto.rs:43`) and is simultaneously plaintext in two tables, returned by a Public IPC command, serialized to the client on every device row, and put on the wire pre-confirmation. Every surface that legitimately shows the identifier becomes a key-disclosure channel. |
| **Revoking by deleting the row** | Stops the next frame. Does not close the QUIC connection (`disconnect_peer` at `connection.rs:931` is never called from the unpair path) and does not cancel a turn that has up to 27 minutes left to run. |
| **Caching a trust set on the hot path** | `TRUSTED_PEER_CACHE`, 30 s TTL, process-global (`mdns.rs:76-104`). Fleet-unique: **3 of 3** applicable siblings re-read per request. |
| **A per-device credential with no expiry** | `PairedDevice` has `created_at_ms`, `last_seen_ms`, `revoked` and no `expires_at`. A phone lost eleven months ago still holds a valid LAN bearer token — over **plain HTTP**, since the companion server is `axum::serve` on a bare `TcpListener` (`companion_api.rs:99-102`) and the QR encodes `http://` (`pairing.rs:292`). |
| **Shipping the pairing UI behind `import.meta.env.DEV`** | `FleetSettingsPage.tsx:213` gates `FleetPairDevice` on `DEV`. That removes the *pairing* surface from production — **and the revocation surface with it.** A production user who paired in a dev build has no UI to revoke. |
| **Rendering a "shown once" token as selectable text and copying it to the clipboard** | `FleetPairDevice.tsx:145-147` renders `pair.url` — which *is* the token — in a `<code className="truncate">`; `:65` writes it to the OS clipboard with no clear timer. `BrowserBridgePanel.tsx:76-78` does the same, permanently, and is **not** dev-gated. |

---

## 6. Evidence

### The one site to copy: `src-tauri/engine/src/p2p/protocol.rs:199-304`

The three-leg signed handshake is the best authentication mechanism this sweep found in six
codebases, and the comment block at `:199-215` is the reason:

```
A -> B  Hello        sig_a1 = Sign_A( "hello"        | A | nonce_a )
B -> A  HelloAck     sig_b  = Sign_B( "helloack"     | B | nonce_b | nonce_a )
A -> B  HelloConfirm sig_a2 = Sign_A( "helloconfirm" | A | nonce_a | nonce_b )
```

- **Freshness is mutual, and the file explains why two legs are not enough**: *"`sig_a1` alone proves
  key possession but not liveness — it contains nothing B chose, so a recorded Hello replays forever."*
  **0 of 4 siblings has this property.**
- **Enforced on both sides.** The responder will not establish a connection without leg 3 — a 10-second
  timeout, a message-shape check, and a signature verification, each with its own rejection log
  (`connection.rs:631-660`). The initiator sends it before inserting (`:449-460`).
- **The identity binding is checked, not assumed.** `verify_handshake_proof` refuses when the presented
  key does not hash to the claimed peer id *and* when the signature does not verify, with distinct
  messages (`:290-303`).
- **The transcript is injective by construction and says so** (`:217-223`): newline-separated fields
  drawn from newline-free alphabets, different field counts per label, and `HANDSHAKE_DOMAIN` above all
  of it so *"a signature produced for one purpose … cannot be replayed as a handshake proof."*
- **The version check is a clean break.** v1 peers cannot connect, deliberately, *"because a v1 peer is
  by definition unauthenticated"* (`:18-23`).
- **8 unit tests**, including a replayed signature against a fresh nonce, a foreign key, a claimed
  identity whose key the attacker does not hold, and label/nonce-order separation.

**Also exemplary:**

- **`commands/fleet/companion_api.rs` in full** — guard order (peer, then credential, then constant-time
  compare, then a fixed delay), a five-verb allowlist, a data-poor projection, a decision ledger, and a
  socket whose *existence* is downstream of a pairing (`start_if_paired:73`). If you must trust a device
  over a LAN, copy this file — and add TLS and an expiry, which it does not have.
- **`commands/fleet/pairing.rs:97-134`** — the credential done right: minted once, only the digest
  stored, constant-time compared, `revoked` folded into the comparison so a revoked token cannot match,
  and a test asserting the persisted JSON does not contain the plaintext.
- **`engine/src/p2p/device_pairing.rs:56-66`** — *"Why a lying peer cannot strand your devices."* An
  unauthenticated wire claim steers a *choice* and never authorizes a *write*; every write re-checks the
  predicate against the local registry. This is the correct handling of untrusted input in a negotiation
  and it is rare to see written down.
- **`cloud/remote_commands.rs`** — the inbound cloud approve path, and the best-defended door in the
  app. Poll-only, device-scoped, UUID-validated before the PostgREST filter is built, claimed atomically
  with `status=eq.pending` so a double-approve cannot double-bill, mandatory human click with a 450 ms
  arm. **And the asymmetry [second-transport-exposure](./second-transport-exposure.md) §7.I reported on
  2026-08-16 — that `remote_command_reject` omitted its sibling's device filter — has since been fixed**:
  `:363` carries the dated note *"Until 2026-08-16 this patched `pending_commands?id=eq.{id}` with
  neither"*, and `:377` now filters on `target_device_id` and `status`. That path's §7.I should be
  updated.
- **`src/features/settings/sub_devices/lib/pairingRefusal.ts:71-97`** — structural classification before
  textual, with the reason at `:78-79`: *"the backend gives the most important refusal its own AppError
  variant, so classify it structurally and never on message text."* The 8 fallback markers are anchored
  on distinctive Rust phrases rather than generic words.

### The trust census, exactly

Every path in the tree by which a remote party becomes trusted:

| Ceremony | Credential | Bound to | Freshness | Human step | In running build | Live entries |
|---|---|---|---|---|---|---:|
| **P2P device pairing** (`device_pairing.rs`) | Ed25519 keypair | **`id = base58(sha256(pk))`** | **3-leg mutual nonce** | 6-digit fingerprint, **unarmed** | **no** | **0** |
| **Mobile companion** (`fleet/pairing.rs`) | 32-byte token, SHA-256 at rest | the digest | none | scan a QR | yes | **0** (key absent) |
| **Cloud app** (`engine/pairing.rs`) | scoped origin-bound API key | origin + nonce | **TTL + single-use claim** | approval modal, **450 ms armed** | yes | 0 of 1,029 keys |
| **Browser bridge** (`browser_bridge/mod.rs`) | one 32-char shared token, **plaintext at rest** | nothing | none | copy/paste from a panel | yes | 1 |
| **Identity-card import** (`commands/network/identity.rs:83`) | imported public key | the card | none | user imports out-of-band | **no** (`p2p`) | **0** |
| **Manual registration** (`commands/network/owned_devices.rs:33`) | **none** | **nothing** | none | **none** | **no** (`p2p`) | 0 |
| **Cloud remote approve** (`cloud/remote_commands.rs`) | user OAuth + device id | the account | atomic claim | mandatory click, **450 ms armed** | yes | 0 |

**What each registry has actually carried** — read-only copies, 2026-08-17, since deleted:
`owned_devices` **0** · `remote_jobs` **0** · `remote_job_notes` **0** · `trusted_peers` **0** ·
`discovered_peers` **0** · `peer_manifests` **0** · `exposed_resources` **0** ·
`local_identity` **1** (created 2026-04-04, `device_group_id` **NULL**, `public_key` a 32-byte blob) ·
`app_settings` **32 keys**, including `browser_bridge_pairing_token` (value length **32**) and
**not** including `fleet_companion_devices` · `fleet_decisions` **46**.

**Nothing has ever been paired on this install, by any of the seven ceremonies.** Per the brief's own
framing that is the finding's *context*: this is unexercised security code, which is where the corpus
has repeatedly measured the worst defects — and §0.3, §0.4 and §0.5 are three of them.

### The measurement that corrected itself

The first §9 candidate anchored on *reads of a peer-trust registry consumed as a presence test*. It
returned **3 matches across 2 files** and its positive control returned **1 match, inside the file the
rule excludes** — i.e. **zero reachable compliant sites**. Per the doctrine, a control returning ~0
means the pattern is not discriminating on what you think, and hand-verification agreed:
**precision 1 of 3 (33%)**. The two false positives are `commands/fleet/pairing.rs:65`, which is the
*definition* of `load_devices` (the `Ok(Some(json))` arm matched the presence alternation), and
`:91` `any_active_device`, which is a presence test that is *correct* for its purpose — deciding
whether the LAN server has any reason to run. The raw anchor's population is **30 matches / 8 files, of
which 14 are the registry's own module and 6 more are its CRUD wrappers**; only **3 sites in 963 files
are peer-trust decisions at all**. A ratchet over 2 true positives is a to-do list. Refused. Two further
candidates were raced and refused; the numbers are in §9.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every defect below reduces to one absence:
> **there is no type, table or function that says "this row was produced by a ceremony".** Given that,
> a trust check has only two options — trust the row, or re-derive the ceremony at every decision — and
> the tree contains four instances of the first and zero of the second. `owned_devices.public_key`
> exists to be that marker; nothing reads it. Make the marker load-bearing and §7.A, §7.B and half of
> §7.F become a compile error rather than a judgement.

### 7.A — P1: the peer-trust registry has two writers of different strength and one reader that cannot tell them apart

`p2p/remote_jobs.rs:222` authorizes on `get_owned_device(peer_id)` → `Some(_)`. Writers:

| Writer | Ceremony | `public_key` | `paired_at` | Tier |
|---|---|---|---|---|
| `register_paired_device` (`device_pairing.rs:311`, `:420`) | 3-leg signed handshake + human fingerprint confirm | proven at handshake | set | — |
| **`register_owned_device` (`commands/network/owned_devices.rs:33`)** | **none** | **`None`** | **`None`** | **Public** — `require_auth_sync` is a no-op (`ipc_auth.rs:477-479`) and the name is absent from `PRIVILEGED_COMMANDS` |

The second writer takes `peer_id: String` from the caller and validates exactly one thing: that it is
not the local peer id (`:41-47`). A row it writes is, at the gate, a row that may run any instruction.

**Mitigating, and it is what makes this P1 rather than P0:** the command is `#[cfg(feature = "p2p")]`,
so it is absent from the running build entirely; and **it has zero callers** — `src/api/network/devices.ts`
wraps every sibling command and not this one, and the only occurrences in `src/` are a generated union
member (`commandNames.generated.ts:1282`) and a docstring (`bindings/OwnedDevice.ts:27`).

**Fix (do not apply — the operator's build is live):** delete `register_owned_device` and its repo
function, then make `owned_devices.public_key` `NOT NULL`. §4 records why this is the strongest
available edit and why a required-field change alone would be the wrong one.

### 7.B — P1: the ceremony's proven public key is persisted and has no production reader

`register_paired_device` writes `public_key` (`owned_devices.rs:124`); both read queries select it
(`:380`, `:394`) and `:432` maps it into the struct. Across **963 `.rs` and 4,829 `.ts`/`.tsx` files
the only reader outside that module's own SQL is a test assertion at `:551`.**

The consequence is not that the current check is weak — it is sound, because `peer_id` is key-derived
(§0.3). The consequence is that **the soundness is an unstated coincidence of the identity scheme, and
nothing in the tree records that the check depends on it.** Change `public_key_to_peer_id` to a
truncated digest, or add a registry whose ids are claimed rather than derived, and `require_paired`
silently stops being an authentication.

**Fix:** have `require_paired` take the handshake-proven key
(`ConnectionManager::get_remote_public_key`, `connection.rs:182`, which the pairing ceremony already
calls) and compare it against the stored one. Two lines, at the one call site, and it converts a
coincidence into a check.

### 7.C — P9: `device_group_id` is an identifier in five places and an AES-256 key seed in one

`SyncKey::derive(group_secret)` HKDF-SHA256s the device-group anchor into the key that seals
cross-device snapshots (`engine/src/workspace_sync/crypto.rs:43-50`). The same value is plaintext in
`local_identity.device_group_id` and on every `owned_devices` row; returned by `get_device_group_id`, a
**Public** IPC command; serialized to the client as `OwnedDevice.deviceGroupId`; and **sent in the
`PairRequest` opening frame before any human has confirmed the pairing** (`device_pairing.rs:236-239`
vs the confirm at `:368`).

**Latent, not live.** `SyncKey::derive`, `seal_snapshot` and `open_snapshot` have **zero callers**;
`workspace_sync` is declared at `engine/src/lib.rs:162` and consumed by nothing; live
`local_identity.device_group_id` is **NULL**. Stated as a latent break in the manner of
[second-transport-exposure](./second-transport-exposure.md) §12.9: the classification conflict is real
and shipped in source, the consequence is unobserved because the consuming module was never built.

**Fix:** derive the sync key from a separate `device_group_secret` that is never displayed, exported,
or placed in a pre-confirmation frame, and keep `device_group_id` as the public identifier — ideally
`hash(secret)`, so the identifier is derived from the secret rather than being it. Whoever builds
Stage 3b must do this *before* the first key is derived; afterwards it is a re-pairing of every device.

### 7.D — P6: the initiator discloses its group anchor and device inventory before the human decides

`PairRequest` (`protocol.rs:87-102`) carries `device_group_id`, `display_name` and `devices_at_stake`,
and `request()` sends it immediately (`device_pairing.rs:230-241`). The responder's human decision
happens at `confirm()` (`:368`); the initiator's human never decides at all. So any peer that completes
the v2 handshake and receives a request from this device learns the group anchor (§7.C), this machine's
display name, and **how many devices it has** — before the fingerprint that exists to catch a
machine-in-the-middle has been compared by anyone.

`devices_at_stake` is handled impeccably as *input* (`:56-66`) and is a disclosure as *output* that
nobody weighed. The counter-offer needs only one bit ("do I have anything to lose"), not a count.

**Fix:** move `device_group_id` into `PairResponse` (it is already there, `:107-118`) and drop it from
`PairRequest`; narrow `devices_at_stake: u32` to `bool`.

### 7.E — P5: the ceremony ends in an unarmed primary button, in a repo that arms its two cloud approvals

`IncomingPairingPanel.tsx:72-80` — `variant="primary"`, rightmost, focusable on mount, `isLoading` its
only disabled condition. No arm delay, no checkbox, no re-entry of the code. Compare
`RemoteApprovalPrompt.tsx:19,:152` and `PairApprovalModal.tsx:24,:190`, both **450 ms
`disabled={!armed}`**; and compare `PairedDevicesPanel.tsx:127-143`, where **unpairing** is behind a
two-step `InlineConfirm`. The repo guards its destructive action and not its trust-granting one. The
mobile PWA repeats the inversion exactly: `Kill` is a two-tap with a 3500 ms decay
(`resources/mobile/app.js:91-113,:258-259`), `Approve` is a bare button (`:213-217`).

The copy is not the problem — the button says **"Codes match, pair"**. Nothing makes that true.

**Fix:** the 450 ms arm at minimum; better, require the code to be typed on the confirming device,
which converts P5 from a request into a protocol property.

### 7.F — P8: the remote lane's safety argument names a control that was deleted six days ago

`companion/remote_jobs.rs:22-32` justifies running a remote instruction with Athena's **full op set**
by naming four surviving bounds, one of which is `AUTOAPPROVE_ALLOWLIST`. Measured at `5d55d6a4a`:
**10 mentions across 6 files, every one a comment, 0 declarations.** It was deleted 2026-08-10 with a
careful historical note in its place (`approval_autopilot.rs:13`).

[second-transport-exposure](./second-transport-exposure.md) §7.H reported this on 2026-08-16. **It is
still open.** It belongs here rather than there because the deleted constant is not incidental to the
P2P transport — it is one quarter of the entire written argument for why that transport needs no
deny-list.

Compounding it: `gate_remote_instruct` (`approval_exec_devices.rs:57-62`) autofires to **any** paired
device when autonomous mode is on, and `companion_autonomous_mode` is **`"true"`** on this install.
The gate itself is well-built — one pure function, both paths through it, asserted absent from the
generic allowlist by a named test, and it reads the persisted row rather than a passed flag.

**Fix:** replace the prose with a test that fails when a named bound disappears, and give
`remote_instruct` its own verb allowlist rather than inheriting the local op set (P10).

### 7.G — P7: unpairing reaches the door and not the work

`forget_owned_device` (`owned_devices.rs:404-411`) is `DELETE FROM owned_devices WHERE peer_id = ?1`
and nothing else. It does not call `disconnect_peer` (`connection.rs:931`, no caller on this path), so
the QUIC connection stays open. It does not cancel an accepted inbound job: `execute` returns
immediately and the turn runs in a spawned task under `REMOTE_TURN_TIMEOUT`, **27 minutes**
(`companion/remote_jobs.rs:75`). A peer revoked mid-job keeps running a full-op-set Athena turn on this
machine for up to 27 minutes.

Adjacent, same clause: `TRUSTED_PEER_CACHE` (`mdns.rs:76-104`) is a process-global set with a
**30-second TTL**. `invalidate_trusted_peer_cache()` exists at `:122`; **the revocation commands do not
call it** — so revoking a peer's discovery trust takes effect up to 30 seconds later. **3 of 3
applicable siblings re-read per request; none caches on the hot path.**

**Fix:** make `forget_owned_device` a sequence — disconnect, cancel in-flight jobs for that peer, then
delete — and have `revoke_peer_trust` call the invalidator that was written for it.

### 7.H — P4: the reachable transports have no freshness, and the strongest of them is a replay oracle

`verify_hmac_sha256(secret, body, signature)` (`webhook.rs:537-560`) is constant-time, handles both the
GitHub `sha256=` and bare-hex forms, and routes invalid hex down the same path as a wrong signature so
the failure modes are indistinguishable. It is genuinely well-built, and **it verifies a MAC over the
body and nothing else**. No timestamp header is read; no nonce store exists; `webhook_request_log`
holds **0 rows**, so nothing would notice a duplicate anyway. A captured delivery is valid forever.

The companion bearer token (`companion_api.rs:223`) has the same property and worse transport: the
server is `axum::serve` over a bare `TcpListener` on `0.0.0.0` (`:99-102`) and the QR encodes
`http://<lan-ip>:<port>/m/#t=<token>` (`pairing.rs:292`). **The credential travels in cleartext on the
LAN on every request, has no expiry, and the PWA keeps it in `localStorage` indefinitely**
(`resources/mobile/app.js:14-24`).

**Fix:** a bounded seen-set keyed on the delivery id with a clock window for webhooks (the
`ascent` two-tier shape); an `expires_at` on `PairedDevice`; and, if the companion is ever more than a
LAN convenience, TLS.

### 7.I — P10/P11: the production build has no pairing UI, no revocation UI, and no refusal ledger

`FleetSettingsPage.tsx:213` gates `FleetPairDevice` on `import.meta.env.DEV`. That is defensible for
*pairing* and not for *revocation*: the same component owns the revoke button
(`FleetPairDevice.tsx:200-214`), so **a production user who paired in a dev build cannot revoke.** That
revoke is also unconfirmed and **fails silently** — `silentCatch('FleetPairDevice:revoke')` at `:77`
shows the user nothing when it fails. It is the only lever available after losing a phone.

Two smaller items in the same family. The comment above the gate (`:210-212`) claims the panel is
*"Inert (no backend handshake yet)"*, which is **stale** — `fleet_pair_device` mints a real token and
starts the real LAN server, and `FleetPairDevice.tsx:15-26` says so. Two comments in one repo disagree
about whether a security surface is live. And four of the five registries have no refusal ledger: a
peer turned away by `require_paired` leaves a `tracing::warn!` and nothing durable, so *"has this gate
ever refused anything"* is unanswerable for exactly the gate that matters most.

### 7.J — P3: the promotion the handshake was built to perform was never wired to it

`core/src/models/identity.rs:52-58` documents `TrustLevel::Manual → Verified` and says:
*"**No code path performs this transition automatically yet.** The intended trigger is a
signed-challenge/handshake flow that proves the peer holds the matching private key (and surfaces a
fingerprint match to the user)."*

**That flow shipped.** `protocol.rs`'s v2 handshake proves exactly that, and `device_pairing.rs`
surfaces exactly that fingerprint. Neither touches `trusted_peers`. The v1 → v2 upgrade note
(`protocol.rs:18-23`) records that under v1 *"`trusted_peers` was never consulted"*, and under v2 it
still is not — by `connection.rs`, at least; only `mdns.rs` reads it, for a discovery-UI label.

So the app contains a promotion criterion and its implementation, in two modules, with nothing between
them. This is §7.F's shape with the polarity reversed: there, prose cited a control that had been
deleted; here, prose describes a control as absent that had been built.

### 7.K — P2: what this path cleared

Reported because a path that lists only defects mis-sets priors.

- **The handshake is the best thing in six codebases** and is enforced on both sides, with the third
  leg mandatory on the accept path. §6 details it. **Corrected 2026-08-22 — this clearance was wrong,
  and the way it was wrong is worth more than the finding.** Every property this path checked was
  present and correct: three legs, mutual freshness, domain separation, injective encoding, both
  halves of `verify_handshake_proof`, enforcement on both sides, eight unit tests. The audit asked
  *is this handshake sound?* and the answer was yes. The question it never asked is *is this
  handshake attached to anything?* — no field in any of the three transcripts came from the TLS
  session carrying them, the QUIC certificates are unverified by design (`SkipServerVerification`),
  and there is no application-layer encryption underneath. So an on-path attacker could terminate
  TLS to each side and relay all three signed messages **verbatim**, forging nothing and holding
  neither private key, and both peers would verify each other's genuine signatures. §7.J's
  observation that the promotion criterion and its implementation sat in two modules "with nothing
  between them" was the same shape one layer down, and this path printed it without noticing that
  the handshake and the transport were also two modules with nothing between them. Fixed by
  protocol v3 (channel binding, `transport::channel_binding`). **Generalisation: auditing a
  cryptographic mechanism in isolation certifies the mechanism, not the composition — and every
  MITM lives in the composition.**
- **The companion API's guard order, verb allowlist, data-poor projection and decision ledger** are the
  fleet's best answer to "a device on the LAN". Its five verbs against `vibeman`'s eighteen is the
  whole of P10 in one comparison.
- **The credential half of the companion pairing is correct**: minted once, digest-only at rest,
  constant-time compared, `revoked` folded into the comparison, and tested for the absence of the
  plaintext in the persisted JSON.
- **The counter-offer negotiation** treats an unauthenticated claim as a hint and never as an
  authorization, and re-checks the predicate locally on every write.
- **`pairingMachine.ts` / `pairingRefusal.ts` / `p2pCapability.ts`** are three genuinely strong client
  artifacts: an anti-wedge reducer that refuses to guess, structural-before-textual error
  classification, and a capability probe that classifies a Tauri dispatch refusal structurally rather
  than by message text. 30 unit tests between the first two.
- **Zero hardcoded English** across all five desktop trust surfaces; every string routes through
  `useTranslation`. (The mobile PWA has ~39 and no i18n layer at all — a defensible line for a
  zero-dependency `include_str!`'d artifact, but it means *"Approve"* and *"Confirm kill"* are
  English-only for every locale.)
- **`cloud/remote_commands.rs`'s missing device filter is fixed** (§6), one day after it was reported.

---

## 8. Gaps in the primitive

1. **`OwnedDevice` cannot express its own provenance.** One type, two populations, and the field that
   records the difference (`public_key: Option<String>`) is advisory. Upstream of 7.A and 7.B; §4's
   split is the fix and it reaches **1 of 5 registries**.
2. **There is no shared trust predicate to call.** Five registries, five schemes. A sixth transport has
   nothing to ask, which is [second-transport-exposure](./second-transport-exposure.md)'s P10 for the
   *who* question rather than the *what* question — and it has the same arithmetic consequence.
3. **No type reaches `trusted_peers`.** Its gate is a `HashSet<String>` of ids built by a `SELECT` that
   drops every other column (`mdns.rs:112`), behind a process-global cache. The key material is gone
   one layer below where any Rust type could look.
4. **No type reaches `fleet_companion_devices`.** It is a JSON array inside one `app_settings` value —
   the doctrine's *where types cannot reach* item 4, in the storage direction. A corrupt store is
   silently treated as empty (`pairing.rs:69-72`), which is the right failure direction and is invisible
   to any type.
5. **Freshness is not a property a type can carry.** It is a property of an exchange. No signature over
   `Nonce` can make the *verifier* have contributed one; only the protocol shape can.
6. **`require_paired` returns a display name.** Its signature (`-> Result<String, AppError>`) is why the
   call site cannot compare a key even if it wanted to — the function has already thrown the device
   away. A one-word return type is the whole of Gap 1 in miniature.
7. **No gate can decide whether a device *should* be trusted.** That is a human's job and stays one.
   §9's ratchet can only guarantee that the *mechanism* by which the human's decision is later honoured
   does not silently weaken.

---

## 9. The missing gate

Every deviation in §7 ships green under `npm run check`, under
`cargo test --manifest-path src-tauri/Cargo.toml --features desktop`, and under the existing census.
Per the §9 calibration note, `ci.yml` is red on 10 pre-existing failures, so a gate that lives only
there runs nowhere; the census runner and the `golden-path-census` pre-push job are what execute.

**The condition the signal is a proxy for** (stated so an adopting repo can re-derive its own):
*a credential presented by a remote party is resolved to a trusted identity by a comparison whose
timing depends on the secret.* In this stack that manifests as `==` on a token or a `HashMap::get`
keyed by one; in Node it would be `===` or an object-property lookup where `crypto.timingSafeEqual`
belongs; in Python, `==` where `hmac.compare_digest` belongs. **Do not port the regex.**

**Existing rules checked for overlap** (all **152** in `scripts/census/rules.json` read). Nearest
three: `caller-asserted-owner` (`ownership-verification`, roots `src-tauri`, 11 files / 16 — asks
whether a *caller* asserted an owner id, not how a *credential* is compared),
`unauthenticated-transport-route` (`second-transport-exposure`, 4 / 79 — its violating set is
`test_automation`, `dev_tools_http`, `hooks`, `push`; neither of my two sites is in it, and
`companion/orchestration/mcp/mod.rs` is on its *exclude* list), and `settings-key-holding-secret`
(1 / 3 — counts the settings key at rest, which already covers `browser_bridge_pairing_token`'s
*storage* and says nothing about its *comparison*). **Site-level overlap against the final pattern:
zero.** No rule in the registry matches `==`, `.get(`, `ct_eq` or `constant_time_eq`.

**Why a count and not a type:** §4 answers the type question `yes` and measures its reach at 1 of 5
registries — it cannot reach a `HashSet` of ids, a JSON blob in a settings row, or a comparison
operator. Ship both.

**Signal.** A credential noun at a word boundary compared with `==`, or used as the key of a map
lookup. `\b` before the noun is load-bearing: it is what stops `input_tokens == 0` from matching,
since `_` is a word character. Verified against the whole tree — the pattern returns **2** and a
two-verb widening was not needed.

```json
{
  "id": "peer-credential-compared-by-value",
  "goldenPath": "docs/concepts/golden-paths/cross-device-pairing.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:token|secret|passcode|fingerprint|api_key)\\b\\s*==\\s*|\\.get\\(\\s*&?\\s*(?:token|secret|passcode|api_key)\\b[^)]{0,24}\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A credential presented by a remote party is resolved to a trusted identity by ordinary value equality or a hash-map lookup, in a tree that already owns three constant-time primitives (ct_eq, constant_time_eq, hmac verify_slice). Proxy for: a peer-authentication comparison whose timing depends on the secret. The positive control counts the compliant form of the same decision."
  },
  "exclude": [],
  "baseline": { "files": 2, "matches": 2 },
  "floor": 900
}
```

**The positive control** — the compliant form of the same decision, no baseline:

```json
{
  "id": "peer-credential-compared-by-value-positive-control",
  "goldenPath": "docs/concepts/golden-paths/cross-device-pairing.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:ct_eq|constant_time_eq|ConstantTimeEq::ct_eq|verify_slice)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the same credential decision routed through a constant-time primitive. Must return ~15 across 4 files; a near-zero result means this tree has stopped using its own constant-time primitives and the rule above is no longer measuring a choice."
  },
  "exclude": [],
  "floor": 900
}
```

**Measured, in a private scratch registry, then re-extracted from this document and re-run — identical
both times:**

```
peer-credential-compared-by-value                    2 files    2 matches   (base 2 / 2)   walked 963
peer-credential-compared-by-value-positive-control   4 files   15 matches   (no baseline)  walked 963
```

**Precision: 2 of 2, hand-audited, both production code, neither in a `#[cfg(test)]` module** (verified
with a brace-matched stripper, not a line threshold):

- `src/browser_bridge/mod.rs:141` — `.filter(|s| s.token == token && s.created.elapsed() < SESSION_TTL)`.
  The browser-bridge **session** token, resolved by ordinary equality.
- `src/companion/orchestration/mcp/mod.rs:108` — `reg.tokens.get(token).cloned()`. The
  `X-Athena-Session` token, resolved by `HashMap::get`. Already named as an anti-pattern by
  [second-transport-exposure](./second-transport-exposure.md); this rule is what makes a third one
  visible.

**The control's 15 matches split 6 production / 9 test-module**, and the production six are the
mechanisms this rule routes people to: `commands/fleet/pairing.rs:108,:128` (`ct_eq`, and the device
comparison that uses it), `ipc_auth.rs:629,:668` (`constant_time_eq` and its one call site),
`engine/webhook.rs:558` and `commands/credentials/oauth.rs:1314` (HMAC `verify_slice`). **The violating
and compliant file sets are disjoint** — 2 files and 4 files, no overlap — so the partition is clean
even though the anchors differ by construction (an operator versus a call).

**Fault-injected 8 ways, in-memory, so the tree was never modified** (a composer editing `src-tauri`
while the operator's app is running is its own hazard). Four synthetic violations — `presented.token ==
stored.token`, `registry.get(token)`, `map.get(&token)?`, `secret == expected` — all fire. Four
near-misses that must NOT fire — `input_tokens == 0`, `output_tokens == max_tokens`,
`usage.get(&total_tokens_key)`, `ct_eq(a.as_bytes(), b.as_bytes())` — all stay silent. **8 of 8.** The
`\b` is what buys the second half: `_` is a word character, so `\btoken\b` cannot match inside
`input_tokens`, which is the single largest false-positive family in a repo that counts model tokens on
every execution.

**Allowlist.** None. Every match in this tree is a real instance, and an exemption here would be an
exemption on a peer-authentication comparison — exactly the thing that should require a paragraph
rather than a JSON entry.

**How it fails loudly if its own precondition is absent** — the runner implements four, the rule
supplies the fifth:

- `floor: 900` against a 963-file walk. If `src-tauri` moves or the extension list stops describing the
  tree, the run **fails with "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than reporting a
  clean zero.
- **Zero matches anywhere is fatal**, so a regex that stops matching cannot read as a finished
  migration.
- **A silent drop is fatal under `--check`** — which is the correct prior here, since the whole
  population is 2 and a broken `\b` would take it to 0 while looking like two fixes.
- **A stale `exclude` is fatal** — vacuous today (the list is empty by design) and it is the reason the
  list is empty rather than pre-populated with a "the primitive itself" entry.
- **The positive control is the instrument assertion.** No baseline, so it never ratchets; its job is to
  be read. **If it falls toward zero, this tree has stopped using the constant-time primitives it
  owns**, and the rule above is no longer measuring a choice between two available mechanisms — it is
  measuring an absence, which is a different and unratchetable thing.

**End of life: delete, do not baseline at zero.** Both sites are one-line fixes to an existing
in-tree primitive. When they land, the correct action is to remove the rule, not to ratchet it to 0 —
the census cannot express "must be zero" by construction.

### Three candidates raced and refused, with their numbers

Published because a refusal without numbers is an opinion, and because the next composer on this leaf
should not re-derive them.

| Candidate | Violating | Compliant control | Verdict |
|---|---|---|---|
| **A peer-trust registry read consumed as a presence test** (the obvious rule for §7.A/§7.B) | **3 matches / 2 files, precision 1 of 3 = 33%** | **1 match, and it is inside the excluded primitive → 0 reachable** | **Refused.** The control returning ~0 is the doctrine's own stop condition. The raw anchor is 30 matches / 8 files, of which 20 are the registry module and its CRUD wrappers; only **3 sites in 963 files** are trust decisions at all. |
| **A trust-registry write from a non-ceremony path** | 16 matches / 5 files | 28 matches / 3 files | **Refused.** 25 of the 28 "compliant" and 4 of the 16 "violating" are inside `owned_devices.rs`'s test module; the 4 `save_devices` hits are the ceremony and the revoke path, i.e. false positives. Production precision well under 50%. |
| **A signature/MAC verification entry point with no freshness parameter** | 54 matches / 26 files | — | **Refused.** `fn verify_\w+` is dominated by test function names (`verify_ingest_writes_cells_and_may_flip_but_never_downgrades`, `verify_field_roundtrip_on_conn`, …). The real population is 4 functions; the anchor cannot find them without a vocabulary that would be guessed rather than derived — the doctrine's own warning about a word list distorting both ends at once. |

### The complementary instruments the census cannot host

The census ratchets a count of something present. **Four of this document's findings are absences and
none is gateable by counting.** Each is `assert!`-shaped and belongs beside the thing it guards:

1. **`assert!(owned_devices_public_key_readers >= 1)`** — §7.B. A test in the `owned_devices` repo that
   fails when nothing outside the module reads `public_key` would have fired the day the column was
   added.
2. **A test naming every constant the remote lane's safety argument depends on** — §7.F. Four lines,
   and it fails the day `AUTOAPPROVE_ALLOWLIST` is deleted rather than nine comments later.
3. **A test asserting `forget_owned_device` disconnects before it deletes** — §7.G. P7 is a *sequence*
   property, which no count can see.
4. **A query, and somebody has to run it** — §6's row counts. "Has any of these five gates ever refused
   anything" is not assertable at all while four of them write no ledger. That is P11, and it is the
   reason this document opens with a database probe rather than a code reading.

---

## 12. Corrections to the brief

**1. The spine's `convergence: converged` is WRONG — the thirteenth label tested, the thirteenth
failure — and the failure mode is one the corpus has not yet catalogued.** It is not silence: **3 of 4
independent siblings have a real enrollment ceremony**, so the fleet genuinely converged. It is not
"converged on the disease" either. The mode is **convergence on a weaker substitute, with the leaf's
clauses pointing in opposite directions at once**:

- On **authentication** (P3), the fleet converged on something this repo does *not* do — a
  self-claimed identifier plus a bolted-on out-of-band check, **4 of 4**. Personas is the only codebase
  in six with a key-derived identifier and public-key mutual authentication. Direction backwards, the
  ninth label's mode.
- On **freshness** (P4) and **revocation reach** (P7), the fleet is ahead of the transports this repo
  actually ships — 2 of 4 defend replay, and our reachable paths defend none.

A single `convergence` field cannot carry a leaf whose clauses converge in opposite directions, and an
oracle that only counts agreement will read the P3 result as confirmation of the *opposite* of what we
built. **Ask what the siblings agreed to do, and then ask whether it is the same thing you did.**

**2. A new lineage-exclusion criterion, distinct from the doctrine's textual-port tell.**
`personas-web` is a port by the usual prose test, and it is disqualified a second, stronger way: it
**reads this repo's trust store** — `supabaseApi.ts:371` selects from `synced_devices`, `:389` writes
`target_device_id` into `pending_commands`. **A sibling that consumes your decision is not a second
opinion; it is a dependent**, and counting it inflates exactly the number the oracle exists to deflate.
Recommend adding this to `golden-path-doctrine.md` §5. Cohort for this leaf: **5 opened → 4
independent**, with `vibeman` qualified (it carries Personas ports, but all five tells are in its
context-map subsystem; its device mesh has none).

**3. "`owned_devices` has 0 rows and `remote_jobs` has 0 rows" — confirmed, and the zero is wider than
the brief said.** `owned_devices` 0, `remote_jobs` 0, `remote_job_notes` 0, `trusted_peers` 0,
`discovered_peers` 0, `peer_manifests` 0, `exposed_resources` 0, and `fleet_companion_devices` is
**absent from the 32-row `app_settings` table entirely**. **Nothing has ever been paired on this install
by any of the seven ceremonies.** The brief's framing was right: three of this document's five worst
findings are in that unexercised code.

**4. "P2P may not be in the running binary — measure that" — measured, and the answer is unambiguous in
both directions.** The running debug build contains **zero** occurrences of `personas-p2p-handshake/v2`,
`personas-p2p-pairing/v1`, `QUIC endpoint bound`, `_personas._tcp` or `mdns`; the release build at
`target/release` contains **1, 1, 1, 12 and 67** respectively, plus **247** `quinn`. UDP/4242 is
unbound; mDNS 5353 belongs to `svchost`, not the app. A runtime observer can tell three ways, and the
frontend already does, structurally (`p2pCapability.ts:54-61`). The one string that *did* appear in the
debug binary — "not one of your paired devices" — is from `approval_exec_devices.rs:130`, a different
message on a different path, and mistaking it for `remote_jobs.rs:225` would have inverted the finding.
**Two strings, one substring, opposite conclusions** — the same family as the doctrine's
substring-versus-structural warnings.

**5. "6 `fleet-mcp-*` temp dirs hold tokens with two non-owner Modify ACEs" — confirmed, and it is not
this leaf's material.** Six dirs, two non-owner Modify ACEs each, all **inherited from
`%LOCALAPPDATA%\Temp`**. But **four of the six are empty** and the two survivors hold one 206-byte
`mcp.json` whose only credential field is a 32-character `X-Athena-Session` header — a loopback MCP
session token, not a device token, a peer key, or a group anchor. **No cross-device pairing material has
ever been written to a temp directory**, and the database that holds all of it carries a **single ACE**.
The answer to the brief's first question is *no*.

**6. "The webhook HMAC has no replay defence" — confirmed, and a sibling has already written the reason
down better than I could.** `verify_hmac_sha256(secret, body, signature)` covers the body and nothing
else. `ascent app/webhook/route.ts:80-81`: *"a GitHub HMAC never expires, so a captured, still-validly-signed
delivery can be REPLAYED anytime."* Its two-tier fix (process-local `Map`, 10-min TTL, 2000 cap,
explicitly documented as *"only a fast FIRST-LEVEL filter"*, over an authoritative 24-hour DB claim) is
the artifact to copy. **2 of 4 siblings defend replay; we are in the other half.**

**7. "`personas-cloud` and `personas-web` are one system" — that no longer holds, and the composer who
last checked said so.** [`telemetry-scrubbing`](./telemetry-scrubbing.md) §12 records that the
`@dac-cloud/shared` link no longer exists and the two are independent today; my own sweep agrees —
`personas-cloud` carries no Personas-desktop prose tells in any pairing-adjacent file. So the cohort
reduction for this leaf is **not** the shared-package one; it is `personas-web` alone, for the two
reasons in correction 2. **Establish the cohort per leaf; the reduction that applied last week did not
apply this week.**

**8. The brief asked "whether a pairing can be revoked and whether revocation reaches an in-flight
session" and the honest answer needed splitting into three.** Revocation *exists* for all five
registries. It reaches the **next request** on four. It reaches **in-flight work on none** — and on
`trusted_peers` it does not even reach the next request for up to 30 seconds, because a cache with an
invalidator nothing calls sits in front of it. The question "can it be revoked" is the one everyone
asks and the one that does not discriminate.

**9. The `sides: both` label HOLDS, and it is worth recording as loudly as the convergence failure.**
Four leaves have now reported `sides: "client"` contradicted by measurement. This one is genuinely
two-sided and the halves are not redundant: the server owns §7.A–§7.D and §7.F–§7.H, the client owns
§7.E and §7.I, and **§7.E is not derivable from the server at all** — the protocol is correct and the
control is a button. A composer briefed on the server half alone would have published a document
claiming this repo's ceremony is the fleet's best, which is true of the cryptography and false of the
ceremony.

**10. A correction to my own §9, recorded because the first version nearly shipped.** My opening
candidate was the rule that most directly expresses §7.A — a trust-registry read consumed as a presence
test. It returned 3 matches, and I was about to report it as a small-but-precise rule in the manner of
`adhoc-statement-verb-vocabulary` (2/2). **Then I ran the positive control and it returned one match,
inside the file the rule excludes.** Hand-verification then put precision at 1 of 3. The rule I had
written looked exactly like a working rule and was measuring the shape of a function definition. The
doctrine's clause — *a control returning ~0 means the pattern is not discriminating on what you think*
— is the only thing that caught it, and it caught it after the rule had already produced a green
`census OK` line.

**11. A correction owed to [second-transport-exposure](./second-transport-exposure.md), in both
directions.** Its §7.H `AUTOAPPROVE_ALLOWLIST` finding is **still open** at `5d55d6a4a` (10 mentions
across 6 files, all comments, 0 declarations) and is re-filed here as §7.F, because it is one quarter of the written
safety argument for what a paired device may do. Its §7.I claim that `remote_command_reject` omits its
sibling's device filter is **now fixed** — `remote_commands.rs:363` carries a dated note and `:377`
filters on both `target_device_id` and `status`. That line should be updated where it is published.

**12. A correction owed to [least-privilege-scope-grant](./least-privilege-scope-grant.md).** Its §0.5
table lists `fleet_pair_device` and `fleet_companion_revoke` as Public and ungated, which is correct.
The list is incomplete for this leaf: **`register_owned_device`, `forget_owned_device`, `set_device_home`
and `get_device_group_id` are also Public** (`require_auth_sync` is the no-op at `ipc_auth.rs:477-479`,
and none appears in `PRIVILEGED_COMMANDS`). The only pairing-adjacent names on that allowlist are
`approve_pairing` and `reject_pairing` (`ipc_auth.rs:323-324`) — the *cloud-app* ceremony, which is the
one ceremony a remote party cannot reach without a human clicking an armed button. **The tier tracks
what a command does to a row, not what authority it confers**, exactly as that path concluded; this leaf
adds that the pattern holds for *granting device trust* as well as for spawning processes.
