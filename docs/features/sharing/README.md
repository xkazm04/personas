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
- The exposure manager and the trust roster currently live behind the dev-only `network` tab in Settings; tier-gated exposure is on the roadmap.
- IPv6 mDNS and dual-stack QUIC binding were enabled mid-2026 — share-link hosts on IPv6 LAN addresses now resolve correctly. Pre-fix bundles created against the old IPv4-only formatting may need reissuing if their hosts moved.
