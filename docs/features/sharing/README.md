# Sharing

Sharing covers everything that moves persona / connector data between machines: bundle export/import (file or clipboard), `personas://` deep links, P2P peer discovery and messaging, network exposure of local resources, and the user's verifiable identity. It complements the [connections vault](../connections/README.md) (where credentials live) with the cross-machine transport layer.

## User surface

The sharing UI does not own a top-level sidebar entry; pieces are mounted from multiple hosts (a Settings → Network tab, deep-link handler at App root, dialogs invoked from the gallery and bundle flows). Components live under `src/features/sharing/components/`:

| Component | Purpose |
| --- | --- |
| `BundleExportDialog.tsx` | Export selected personas/connectors to a portable bundle (file or clipboard) |
| `BundleImportDialog.tsx` | Preview + apply a bundle from file, clipboard, or share URL |
| `BundlePreviewContent.tsx` | The shared preview view rendered inside both export and import |
| `ImportSuccessCelebration.tsx` | Post-import confirmation animation |
| `ShareLinkHandler.tsx` | Global handler for `personas://share` deep links — listens for `personas:share-link` events and auto-opens the import dialog. Mounted at App root. |
| `NetworkDashboard.tsx` | Live P2P status — connection health, messaging metrics, manifest-sync state |
| `ExposureManager.tsx` | List/create/edit/delete locally exposed resources |
| `IdentitySettings.tsx` | Local identity (display name), identity-card export, trusted-peer management |
| `EnclaveVerificationView.tsx` | Verify a sealed bundle's enclave signature before applying |
| `PeerCard.tsx` / `PeerList.tsx` / `PeerDetailDrawer.tsx` | Discovered/connected peer surfaces |
| `ProvenanceBadge.tsx` | Where a resource came from (locally created vs imported, with originating peer) |
| `NetworkAccessScopeBadge.tsx` | Visual marker for an exposed resource's access scope |
| `NetworkIcons.tsx` | Shared icon set |
| `InlineConfirm.tsx` | Inline destructive-action confirmation primitive used across the sharing flows |

The Settings → Network tab (dev-only — see [settings/README.md](../settings/README.md)) hosts `ExposureManager` and the broader sharing/network controls.

## Backend command surface — `commands/network/`

The Rust modules below handle the IPC. The API wrappers live under `src/api/network/`.

### `bundle.rs` — bundle and share-link IPC

| Command | Behavior |
| --- | --- |
| `export_persona_bundle` / `export_bundle_to_clipboard` | Build a signed portable bundle from selected personas + dependencies |
| `preview_bundle_import` / `preview_bundle_from_clipboard` | Parse and validate a bundle without applying (returns the preview shape used by the import dialog) |
| `apply_bundle_import` / `apply_bundle_from_clipboard` | Apply the bundle, creating personas/connectors locally |
| `verify_bundle` | Verify the bundle's signature and integrity standalone |
| `create_share_link` | Produce a `personas://share?...` URL pointing at a hosted bundle |
| `resolve_share_deep_link` | Parse a deep link into `ResolvedShareLink` (host + bundle id + verification metadata) |
| `preview_share_link` / `import_from_share_link` | Fetch + preview, then apply, a remote bundle by URL |

Engine helpers backing these commands live in `engine/bundle.rs` and `engine/share_link.rs` (the share-host whitelist + IPv6-aware host validation lives here — see [network-exposure](../execution/README.md) for the P2P binding semantics that share-link hosts depend on).

### `discovery.rs` — peer discovery and P2P messaging

| Family | Commands |
| --- | --- |
| Peers | `get_discovered_peers`, `connect_to_peer`, `disconnect_peer`, `get_connection_status`, `get_connection_health` |
| Manifest sync | `get_peer_manifest`, `sync_peer_manifest` |
| Network state | `get_network_status`, `get_network_snapshot`, `set_network_config` |
| Messaging | `get_messaging_metrics`, `send_agent_message`, `get_received_messages` |

The frontend `NetworkDashboard` polls `get_connection_health` + `get_messaging_metrics` + `get_network_snapshot` via `usePolling`; threshold colors are derived inline (`<100ms` healthy, `<500ms` warning, missed pings → error).

> Several commands in this table were defined but **never reachable** until the device-link work: stacked `#[cfg(feature = "p2p")]` attributes with no item between them in `lib.rs` silently attached to the following item, dropping fifteen `commands/network/` registrations (plus two elsewhere in the app). Rust accepts that without a warning. A structural test now asserts every `#[tauri::command]` under `commands/network/` appears in `generate_handler!`, so the failure mode cannot return silently.

### `pairing.rs` + `owned_devices.rs` — the device link

Pairing turns two installs that merely *see* each other into two installs that *trust* each other. It is the prerequisite for remote jobs, and the only trust boundary on that path.

| Command | Behavior |
| --- | --- |
| `pair_request` | Ask a discovered peer to pair; mints the session nonce both sides derive the code from |
| `pair_confirm` | Accept an inbound request after the operator has compared the code |
| `pair_cancel` | Withdraw or decline a pairing in flight |
| `list_pending_device_pairings` | Recovery path when the `network:device-pairing-requested` event was missed |
| `list_owned_devices` / `forget_owned_device` | The paired-device roster |
| `set_device_home` | Mark the home device (exactly one, enforced by a partial unique index) |
| `get_device_group_id` | The local group anchor |

**Handshake (protocol v3).** Three legs, each signed with the ed25519 identity key: `Hello` (initiator nonce), `HelloAck` (responder nonce, signed over both), `HelloConfirm` (initiator signs the responder's nonce). Two legs would leave the initiator's proof replayable forever, since nothing in `Hello` is chosen by the responder. Every leg checks `peer_id == base58(sha256(public_key))` *before* verifying the signature, so a peer cannot present someone else's key. Refusals log at `warn` with peer id, stage and reason.

Every transcript additionally mixes in a **channel binding** — `transport::channel_binding`, a 32-byte RFC 5705 exporter over the QUIC/TLS session carrying the message — taken from the live connection and never from the wire. This is what makes the proofs non-portable, and v2 did not have it: because the certificates are unverified (below) and there is no application-layer encryption, an on-path attacker could terminate TLS to each side and relay all three signed messages verbatim, forging nothing and holding neither key, and both peers would verify each other's real signatures. Two TLS sessions export two different values, so a relayed proof fails at the first signature check.

**The version bump 2 → 3 is a hard break and is meant to be.** Both sides reject a version mismatch by name before any signature is checked, and there is deliberately no negotiation — an attacker offered the choice would simply advertise v2. Already-paired devices are unaffected: `owned_devices` records a peer id, group and public key, none of which is derived from a transcript.

**Pairing code.** `SHA256("personas-p2p-pairing/v2" \n lo \n hi \n session_nonce \n channel_binding)`, first four bytes mod 1e6, rendered `NNN-NNN`. The two peer ids are sorted lexicographically, which is what makes both devices derive the same code regardless of who initiated. The channel binding is the same exporter the handshake signs over, and it is what lets the human comparison catch a relay *independently* of the handshake: under v1 the derivation read only two public peer ids and a nonce the attacker was himself forwarding, so both screens showed the same code and the operator would have confirmed the machine-in-the-middle.

**Device groups.** `local_identity.device_group_id` is a single local anchor and each `owned_devices` row records the group it was registered under, so re-anchoring a device that has others behind it would strand them. Pairing therefore resolves toward whichever side has something to lose: if only one side has other devices, that side's group survives and the other joins it (the responder states its own claim in `PairResponse`); if both do, pairing is refused with `AppError::DeviceGroupConflict`, which names the devices that would be stranded and tells the operator to unpair on one side first. Counts arriving over the wire are untrusted — each side re-checks its own registry before re-anchoring, so a peer lying about being empty can only cause a counter-offer or a refusal, never a local re-anchor.

### `remote_jobs.rs` — instructing a paired device

| Command | Behavior |
| --- | --- |
| `send_remote_instruction` | Hand a natural-language instruction to a paired device; resolves when the peer acks |
| `list_remote_jobs` | Job history, both directions (`outbound` = we asked, `inbound` = we were asked) |
| `list_remote_job_notes` | Progress notes for one job, in sequence order |

**Trust.** `RemoteJobs::handle_message` runs `require_paired` before touching the database or the executor, on *every* remote-job frame. This is the only enforcement point on the job path, and it is deliberately separate from the connect path: any LAN peer may complete the signed handshake and pull the public manifest, so **an authenticated connection is not a trusted one**. An unpaired peer's request gets a refusal ack with a reason; unsolicited progress or result frames get no answer at all. A paired peer is further confined to its own jobs by peer id and direction.

**Delivery.** Notes are keyed `(job_id, seq)`. Each side tracks the highest *contiguous* prefix it holds, not the maximum sequence seen — a note landing over a gap would otherwise orphan the missing one permanently. On every reconnect, `RemoteJobResume` states what the asking side already holds and the runner replays only the difference, so a dropped link costs nothing and nothing is delivered twice.

**Failure.** Sending to an unreachable device fails immediately with `AppError::NetworkOffline`, checked before any row is written so no phantom job is left behind. A job whose runner crashed is failed at startup by a sweep and the result reaches the asker through the same resume exchange.

Athena's side of this (the `remote_instruct` op, the inbound turn, and the mode-conditional consent rule) is documented in [companion](../companion/README.md).

### `remote_sessions.rs` — running a fleet session on a paired device

The second job kind on the same lane. `instruction` (above) hands a paired device a sentence and lets its Athena decide what to do; `fleet_session` hands it a **fleet session to run exactly as sent**, so both machines can track the real session.

| Command | Behavior |
| --- | --- |
| `dispatch_remote_fleet_session(peerId, payload)` | Send one fleet session. Returns the persisted outbound job: `pending`/`running` when the peer answered, `queued` when it is offline (the job waits in this device's outbox and goes out on the next link-up), or `refused` with the peer's reason (e.g. `project_not_found`). The branch is minted here, never by the caller: the frontend sends `branch: ""` on purpose. |
| `list_remote_sessions` | The sessions this device sent: every outbound `fleet_session` job that is live, or finished within the last hour, as `RemoteSessionView`s. A DB read, so it answers with the network stopped. |
| `remote_session_command(jobId, command, text)` | Steer: `send_input` (with `text`), `kill`, `wake`. A closed grammar; there is no keystroke stream. |
| `remote_session_subscribe_output(jobId, subscribe)` | Start or stop the lossy terminal tail. Unsubscribing never cancels the session. |
| `list_dispatch_devices` | The paired devices as dispatch targets (never this one), each with `reachability`: `connected` / `stale` / `offline`. |

Events: `network:remote-session-updated` (one whole `RemoteSessionView`) and `network:remote-session-output` (`{ jobId, seq, chunkB64 }`, lossy). The existing `network:remote-job-updated` is unchanged.

**The payload** (`FleetSessionJobPayload`) carries the project as three keys (`projectId`, `githubUrl`, `projectName`) because the two machines share no project id yet; the receiver resolves the git remote first. A project needs a git remote for this kind at all: the work comes back as a pushed branch, and the **receipt** (`FleetSessionJobReceipt`) names the branch and the SHA read from `git ls-remote` on the running device. The asking device fetches the branch and fills `verified`: `true` (the commit is here), `false` (it is not), or `null` (this device has no checkout to look in, which is "could not verify", not "broken").

#### The device lane: outbox, reconnection and remote sessions

Paired devices talk over the LAN lane (QUIC on :4242, protocol **v4**, a channel-bound Ed25519
handshake). Only a device with a row in **Settings > Devices** (`owned_devices`) can send this
device work or report on work it asked for. Every job and remote-session frame from any other
peer is refused and logged, and nothing is written for it.

##### Sending work to a device that is asleep

- A job sent to a paired device that is **not connected** is kept in this device's **outbox**
  with the status `queued`. It is not an error.
- When the link next comes up, the outbox is sent oldest first, before anything else is
  resumed. A job whose send gets no answer goes back to `queued`. The other device re-acks a
  job it already accepted and never runs it twice.
- If the app restarts in the middle of a send, the job goes back to the outbox at the next
  start.

##### Staying connected

- **Owned devices always connect on their own.** This happens when mDNS discovers them, when
  the network starts (for devices seen in an earlier session), and on every health-check tick
  after a drop. **Auto-connect** in the network settings also adds trusted peers that are not
  your own devices.
- Only one side dials: the device whose peer id sorts first. If both dial anyway, one
  connection is kept deterministically.
- A device that disappears from the LAN is **not forgotten**. Its entry stays and reads as
  *stale*. Other peers' entries are removed after 7 days away. Your own devices' entries are
  removed only when you unpair them.
- Reachability, as the "Run on" pickers show it:
  - **connected**: a verified connection is up.
  - **stale**: this device has seen it on the LAN, but it is not connected now.
  - **offline**: never seen on this LAN. Work sent now waits in the outbox until it wakes.

##### Remote sessions: watching and steering

A `fleet_session` job runs a fleet session on the other device. On top of the durable job
record (acknowledgement, progress notes, result), it carries three live streams. None of them is
replayed after a reconnect:

- **Mirror.** The other device's current view of the session: its state, title and reason.
  Only the latest mirror counts. This device keeps the last one, so a restart shows the last
  known state.
  - A running session with no mirror for **45 seconds** reads as **unknown**, never as running.
- **Output tail.** Sent only while a viewer is open, and it can drop output. At most 64 chunks
  wait on the other device, and when the queue is full the oldest chunk is dropped. A gap in
  the chunk numbers shows that output was skipped. A slow link never slows the session itself.
  - Closing the viewer stops the tail. It never stops the session.
  - An open viewer re-subscribes by itself after a reconnect.
- **Commands.** Send input, kill and wake go to the other device, and each waits for its
  answer. An unreachable device or a refusal comes back as a clear error.

When the session finishes, the result carries a **receipt**: the branch and the pushed commit,
read from the remote. This device stores the receipt once and never overwrites it with a
replayed result.

#### The running device: the fleet's remote executor

A `fleet_session` job is run by `src-tauri/src/commands/fleet/remote_exec.rs`,
installed through the same executor seam as `instruction` jobs
(`companion/remote_jobs.rs` routes by job kind; `instruction` is unchanged).

- **Admission, before any row exists.** The payload must parse and carry a
  `remote/…` branch (`bad_payload`), the project must exist here, matched by
  git remote first (case, `.git` suffix and trailing slash ignored), then by
  project id, then by exact name (`project_not_found`), and it must be a git
  checkout with a main branch that resolves (`branch_setup_failed: …`). The
  refusal reason becomes the asking device's `refusal_reason`. Admission only
  looks things up; nothing is written, because the asking device's ack waits
  on it.
- **Where the session works: an isolated worktree, never the project folder.**
  After acceptance the executor creates a `git worktree` for the branch under
  the app data directory (`<app data>/worktrees/<project8>/<hash8>`, the same
  place and the same dependency borrowing the unattended workers use), off the
  project's main branch. The operator's own checkout on that machine is never
  switched to another branch, and two sessions sent to the same project do not
  collide. A worktree that cannot be made fails the job with
  `branch_setup_failed: <git's first line>`.
- **The session.** It is admitted through the fleet queue like any other
  (`DispatchOrigin::Remote`, run label `remote:<job8>`), so it waits its turn
  at the cap. Its prompt is the sent prompt plus the branch rules: commit on
  this branch, do not push, do not switch branches. On this machine its tile is
  an ordinary fleet tile that says **From <device>** (`FleetSession.originPeerId`,
  persisted in `fleet_sessions.origin_peer_id` so a restart keeps it).
- **Live view.** Every state transition sends one mirror of the session to the
  asking device and writes one progress note in plain words ("running",
  "waiting for input", "finished", "exited (code 1)"). A running session is
  also re-mirrored every 15 s, because the asking device reads a session it has
  not heard from for 45 s as `unknown`. Terminal output is forwarded only while
  the asking device has a viewer open; it is lossy and never slows the session.
- **Steering.** `send_input` types the text into the session and submits it,
  `kill` is the local kill, `wake` is the local wake (a woken session keeps its
  job across the new session id). A command for a session that has ended is
  refused with `remote_command_refused: session_exited`.
- **Completion.** The job ends when the session exits. A headless session ends
  when its turn finishes: it is settled like a one-shot worker, the receipt is
  sent, and then its process is ended to free the slot. The receipt is built on
  this machine: commits ahead of the main branch are pushed
  (`git push -u origin <branch>`, 2 minute limit) unless the remote already has
  them, and `pushedSha` is read back with `git ls-remote`, never taken from the
  model. No commits gives `pushError: "no commits"` and no SHA. The job
  **completes** when the session exited cleanly, reached `finished`, or was
  ended by the asking device's `kill`; otherwise it **fails**, and the failure
  summary names the branch and what happened to it (a failed job carries no
  receipt). The worktree is removed afterwards when it is clean, and kept when
  anything is uncommitted.
- **After a restart** the running device fails the job (the startup sweep
  covers both kinds) and the tile comes back with its **From <device>** chip.

#### The asking device: the harvest

When a sent session finishes, the asking device harvests it before it records
anything (`companion/remote_jobs.rs`): it finds its own copy of the project by
git remote, runs `git fetch origin <branch>` and `git cat-file -e <sha>`, and
writes `verified` into the stored receipt: `true`, `false`, or left `null` when
this machine has no copy of the project or nothing was pushed. It then
re-announces the job (`network:remote-job-updated`, and the rebuilt
`network:remote-session-updated`) so the Devices history and the Monitor tile
show the verdict, and writes one Athena memory such as "Desk finished personas:
branch remote/ab12cd34/ef56ab78 at 0123456, verified".

**Offline is a queue, not an error.** Since the outbox landed, a send to a
paired device that is not connected returns a `queued` job instead of failing
with `NetworkOffline`. It goes out when the two devices next see each other.

### `exposure.rs` — locally exposed resources

| Command | Behavior |
| --- | --- |
| `list_exposed_resources` / `get_exposed_resource` | Read |
| `create_exposed_resource` / `update_exposed_resource` / `delete_exposed_resource` | Write |
| `get_exposure_manifest` | Returns the signed manifest a peer would receive when syncing |
| `list_provenance` / `get_resource_provenance` | Where a given resource came from (originating peer / bundle / local) |

### `identity.rs` — local identity + trusted peers

| Command | Behavior |
| --- | --- |
| `get_local_identity` | Returns the local `PeerIdentity` (id + public key + display name) |
| `set_display_name` | Update the local display name surfaced to peers |
| `export_identity_card` | Produce a shareable identity card string for OOB trust establishment |
| `reinitialize_identity` | Rotate the local identity (advanced — destructive on existing trust) |
| `list_trusted_peers` / `import_trusted_peer` / `update_trusted_peer` / `revoke_peer_trust` / `delete_trusted_peer` | Trust roster CRUD |

### `enclave.rs` — sealed-bundle attestation

| Command | Behavior |
| --- | --- |
| `seal_enclave` | Wrap a bundle in an enclave-attested envelope |
| `verify_enclave` | Verify an envelope's attestation; surfaces in `EnclaveVerificationView` before apply |

## Devices: run a session on another device

Pairing (above) makes two of the operator's own machines trust each other. Once they do, any dispatch door can send the work to the other one instead of running it here.

**Where you pick it.** A **Run on** picker (`src/features/shared/dispatch/RunOnSelect.tsx`) sits in the universal dispatch chooser (`DispatchChooser`, reached from Ship, Features, the passport, Council, Athena's panel and the notepad) and in the Monitor's dispatch dock. It lists **This machine** plus every paired device with a reachability dot, and it is **hidden entirely** when the build has no p2p or no device is paired.

- An **offline** device stays selectable: the dispatch is queued and goes out when that device wakes, and the option says so.
- Every remote device is **disabled, with the reason**, when the project has no git remote (the work could not come back), or when the dispatch first prepares files on this machine (a skill install, a brief file) that the other machine would not have.
- On another device only two transports cross: **Fleet** becomes an interactive session and **Claude CLI** a headless one. The dev runner and the console are disabled with "Runs on this machine only".
- A refusal from the other device (for example "that project is not on the other device") is shown in a toast through the error registry (`remote_peer_offline`, `project_not_found`, `remote_command_refused`, `remote_dispatch_failed`).

**Where you watch it.** A sent session appears in the Monitor's Activity board as a remote tile (see [Monitor](../monitor.md#remote-sessions)). On the machine that runs it, the ordinary local tile says **From <device>**.

**Where it is recorded.** Settings → Devices keeps the history of both kinds. Each row carries a kind label (**Instruction** or **Fleet session**); a finished fleet session shows its **Returned work** line (branch, short SHA, and verified / not found after fetch / could not verify here) under the row, and a job still waiting in the outbox reads **Queued**.

Code: `src/stores/slices/network/remoteSessionsSlice.ts` (state, the p2p gate, the reconcile), `src/lib/network/remoteSessionModel.ts` (the client liveness rule, merge and receipt verdict, pure and tested), `src/features/shared/dispatch/` (the picker, the remote dispatch, the receipt line), `src/features/settings/sub_devices/` (the history).

## Storage and engine

- Bundle and share-link semantics live in `src-tauri/src/engine/bundle.rs` + `src-tauri/src/engine/share_link.rs`.
- P2P transport (mDNS, QUIC, manifest sync) lives in `src-tauri/src/engine/p2p/` — see the network-exposure execution surface in code for cancellation discipline and IPv6 dual-stack binding.

## Deep links

`ShareLinkHandler` is mounted at App root and listens for `personas:share-link` `CustomEvent`s. When the OS opens the app via `personas://share?url=...`, the event bridge dispatches a DOM event, and the handler opens the `BundleImportDialog` with the URL pre-filled. A monotonic `shareLinkKey` is bumped on every deep-link arrival so retries with the same URL still trigger a fresh preview fetch.

## Known gaps

- Sharing has no dedicated sidebar route; surface entries are scattered across Settings → Network, Bundle dialogs invoked from the gallery, and the global deep-link handler. A consolidation pass is queued but not landed.
- The exposure manager and the trust roster currently live behind the dev-only `network` tab in Settings; tier-gated exposure is on the roadmap. **Settings → Devices is the exception** — pairing and the device link ship reachable in production builds, since a diagnostics tab is the wrong home for an ordinary operator task.
- **QUIC/TLS authenticates nothing on its own.** Certificates are self-signed and regenerated per bind, unrelated to the ed25519 identity, and the client verifier accepts any certificate. TLS provides encryption against a *passive* observer; the signed handshake provides authentication. Against an *active* on-path attacker neither is sufficient alone — that is what the channel binding above supplies, by tying the ed25519 proofs to the specific TLS session that carried them. Certificate pinning to the identity key remains unimplemented and is now redundancy rather than a gap; **do not remove the channel binding on the grounds that the handshake is signed.** Being signed was never the missing property.
- **The connect path is deliberately open.** Any LAN peer that completes the handshake becomes a connected peer and can pull the non-`requires_auth` exposure manifest. Trust is enforced per-capability (the job path checks pairing) rather than at the door.
- **Pairing leaves an asymmetric registry in one narrow case.** The responder writes its own row before sending `PairResponse`, so if the initiator then refuses locally (a lying peer, or a device gained mid-flight), the responder lists a device that does not list it back. Nothing is stranded and it matches the shape of any mid-flight decline; a clean fix needs a fourth ceremony leg.
- **The p2p feature is not exercised by CI.** It compiles only under `desktop-full`, while CI runs `--features desktop`. The non-gated pieces (the owned-devices repo, the command-registration structural test) do run there.
- The device link has **not been verified across two live machines.** Everything above is covered by unit tests, wire round-trips and both cargo feature configurations; the handshake, ceremony and job round-trip have never run over real QUIC between two processes.
- IPv6 mDNS and dual-stack QUIC binding were enabled mid-2026 — share-link hosts on IPv6 LAN addresses now resolve correctly. Pre-fix bundles created against the old IPv4-only formatting may need reissuing if their hosts moved.
