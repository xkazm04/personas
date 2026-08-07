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

Five Rust modules handle the IPC. The API wrappers live under `src/api/network/`.

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

**Handshake (protocol v2).** Three legs, each signed with the ed25519 identity key: `Hello` (initiator nonce), `HelloAck` (responder nonce, signed over both), `HelloConfirm` (initiator signs the responder's nonce). Two legs would leave the initiator's proof replayable forever, since nothing in `Hello` is chosen by the responder. Every leg checks `peer_id == base58(sha256(public_key))` *before* verifying the signature, so a peer cannot present someone else's key. Refusals log at `warn` with peer id, stage and reason.

**Pairing code.** `SHA256("personas-p2p-pairing/v1" \n lo \n hi \n session_nonce)`, first four bytes mod 1e6, rendered `NNN-NNN`. The two peer ids are sorted lexicographically, which is what makes both devices derive the same code regardless of who initiated.

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

## Storage and engine

- Bundle and share-link semantics live in `src-tauri/src/engine/bundle.rs` + `src-tauri/src/engine/share_link.rs`.
- P2P transport (mDNS, QUIC, manifest sync) lives in `src-tauri/src/engine/p2p/` — see the network-exposure execution surface in code for cancellation discipline and IPv6 dual-stack binding.

## Deep links

`ShareLinkHandler` is mounted at App root and listens for `personas:share-link` `CustomEvent`s. When the OS opens the app via `personas://share?url=...`, the event bridge dispatches a DOM event, and the handler opens the `BundleImportDialog` with the URL pre-filled. A monotonic `shareLinkKey` is bumped on every deep-link arrival so retries with the same URL still trigger a fresh preview fetch.

## Known gaps

- Sharing has no dedicated sidebar route; surface entries are scattered across Settings → Network, Bundle dialogs invoked from the gallery, and the global deep-link handler. A consolidation pass is queued but not landed.
- The exposure manager and the trust roster currently live behind the dev-only `network` tab in Settings; tier-gated exposure is on the roadmap. **Settings → Devices is the exception** — pairing and the device link ship reachable in production builds, since a diagnostics tab is the wrong home for an ordinary operator task.
- **QUIC/TLS authenticates nothing on its own.** Certificates are self-signed and regenerated per bind, unrelated to the ed25519 identity, and the client verifier accepts any certificate. TLS provides encryption; the signed handshake provides authentication. Certificate pinning to the identity key would remove the redundancy but is not implemented.
- **The connect path is deliberately open.** Any LAN peer that completes the handshake becomes a connected peer and can pull the non-`requires_auth` exposure manifest. Trust is enforced per-capability (the job path checks pairing) rather than at the door.
- **Pairing leaves an asymmetric registry in one narrow case.** The responder writes its own row before sending `PairResponse`, so if the initiator then refuses locally (a lying peer, or a device gained mid-flight), the responder lists a device that does not list it back. Nothing is stranded and it matches the shape of any mid-flight decline; a clean fix needs a fourth ceremony leg.
- **The p2p feature is not exercised by CI.** It compiles only under `desktop-full`, while CI runs `--features desktop`. The non-gated pieces (the owned-devices repo, the command-registration structural test) do run there.
- The device link has **not been verified across two live machines.** Everything above is covered by unit tests, wire round-trips and both cargo feature configurations; the handshake, ceremony and job round-trip have never run over real QUIC between two processes.
- IPv6 mDNS and dual-stack QUIC binding were enabled mid-2026 — share-link hosts on IPv6 LAN addresses now resolve correctly. Pre-fix bundles created against the old IPv4-only formatting may need reissuing if their hosts moved.
