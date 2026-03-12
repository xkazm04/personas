# Invisible Apps — Implementation Plan

> Living solution design for peer-to-peer agent orchestration across desktop instances.
> Last updated: 2026-03-12

---

## Current Status

| Phase | Status | Branch |
|-------|--------|--------|
| **Phase 1:** Local Agent Marketplace | **COMPLETE** | `feature/invisible-apps` |
| **Phase 2:** LAN Discovery & P2P Transport | **COMPLETE** | `feature/invisible-apps` |
| **Phase 3:** Internet P2P & Data Exposure | Not started | — |
| **Phase 4:** Dynamic UI & Full Protocol | Not started | — |

---

## Table of Contents

1. [Vision & Architecture Overview](#vision--architecture-overview)
2. [Phase 1: Local Agent Marketplace](#phase-1-local-agent-marketplace)
3. [Phase 2: LAN Discovery](#phase-2-lan-discovery)
4. [Phase 3: Internet P2P](#phase-3-internet-p2p)
5. [Phase 4: Dynamic UI & Full Protocol](#phase-4-dynamic-ui--full-protocol)
6. [Cross-Cutting Concerns](#cross-cutting-concerns)
7. [Risk Registry & Mitigations](#risk-registry--mitigations)
8. [Dependency Map](#dependency-map)
9. [Glossary](#glossary)

---

## Vision & Architecture Overview

### What We're Building

A decentralized agent-to-agent communication network where desktop app instances discover each other, selectively expose local data and agent capabilities, and collaborate through a purpose-built protocol — with no central server owning user data.

### Five Technical Pillars

| # | Pillar | Phase Introduced |
|---|--------|-----------------|
| 1 | Custom P2P Protocol | Phase 2 (LAN) → Phase 3 (Internet) |
| 2 | Local Data Exposure | Phase 1 (files) → Phase 2 (network) |
| 3 | Agent-to-Agent Protocol | Phase 2 (basic) → Phase 4 (full) |
| 4 | Dynamic Frontend | Phase 4 |
| 5 | Identity & Auth | Phase 1 (keypair) → Phase 3 (full Noise protocol) |

### Existing Foundation (What We Already Have)

| System | Location | Relevance |
|--------|----------|-----------|
| 7-stage execution pipeline | `engine/pipeline.rs` | Execution model extends across network |
| Agent chain triggers | `engine/chain.rs` + `engine/bus.rs` | Embryo of inter-agent protocol |
| Event bus + subscriptions | `engine/bus.rs` + `engine/subscription.rs` | Messaging backbone |
| Credential vault (AES-256-GCM + RSA-2048) | `engine/crypto.rs` + `db/models/credential.rs` | Proxy execution model foundation |
| 50+ connectors | `lib/credentials/builtinConnectors.ts` | Capabilities to expose |
| Distributed tracing | `engine/trace.rs` + `db/models/observability.rs` | Cross-instance observability |
| SQLite with r2d2 pool | `db/mod.rs` | Local-first data layer |
| OS keyring integration | `keyring` crate | Identity key storage |
| Tokio async runtime | `Cargo.toml` | P2P networking runtime |
| Tauri 2 desktop shell | `tauri.conf.json` | Native OS integration |

### High-Level Architecture (Target State)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Instance A                                │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ React UI │←→│ Tauri Bridge │←→│ Rust Core                 │  │
│  │          │  │              │  │  ┌─────────────────────┐   │  │
│  │ Dynamic  │  │  IPC + RSA   │  │  │ Execution Engine    │   │  │
│  │ Layout   │  │  Transport   │  │  │ (pipeline, chain,   │   │  │
│  │ Renderer │  │              │  │  │  bus, healing)       │   │  │
│  └──────────┘  └──────────────┘  │  └─────────┬───────────┘   │  │
│                                  │            │               │  │
│                                  │  ┌─────────▼───────────┐   │  │
│                                  │  │ Network Layer        │   │  │
│                                  │  │  ┌───────────────┐   │   │  │
│                                  │  │  │ P2P Transport  │   │   │  │
│                                  │  │  │ (QUIC/quinn)   │   │   │  │
│                                  │  │  └───────┬───────┘   │   │  │
│                                  │  │  ┌───────▼───────┐   │   │  │
│                                  │  │  │ Agent Protocol │   │   │  │
│                                  │  │  │ (messages,     │   │   │  │
│                                  │  │  │  capabilities) │   │   │  │
│                                  │  │  └───────┬───────┘   │   │  │
│                                  │  │  ┌───────▼───────┐   │   │  │
│                                  │  │  │ Identity &     │   │   │  │
│                                  │  │  │ Exposure Mgr   │   │   │  │
│                                  │  │  └───────────────┘   │   │  │
│                                  │  └─────────────────────┘   │  │
│                                  │                             │  │
│                                  │  ┌─────────────────────┐   │  │
│                                  │  │ SQLite + Vault      │   │  │
│                                  │  └─────────────────────┘   │  │
│                                  └───────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              P2P (QUIC/Noise encrypted)
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                        Instance B                                │
│                     (mirror architecture)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Local Agent Marketplace

> **Status: COMPLETE** — Implemented and merged. All deliverables shipped.

**Goal:** Prove the data format, exposure manifest, and identity primitives — without any networking complexity.

**Duration estimate:** 4-6 weeks
**Networking required:** None
**Risk level:** Low

### 1.1 Ed25519 Identity Keypair

Every app instance gets a persistent cryptographic identity on first launch.

#### 1.1.1 Keypair Generation & Storage

**New file:** `src-tauri/src/engine/identity.rs`

```
Module: identity
Dependencies: ed25519-dalek, keyring, serde, zeroize

Functions:
  get_or_create_identity() -> Result<PeerIdentity>
    - Check OS keyring for existing private key bytes
    - If absent: generate Ed25519 keypair, store private key in keyring
    - Derive PeerId from public key (multihash of public key bytes)
    - Return PeerIdentity { peer_id, public_key, created_at }

  sign_message(message: &[u8]) -> Result<Signature>
    - Load private key from keyring
    - Sign with Ed25519
    - Zeroize private key from memory immediately after

  verify_signature(peer_id: &PeerId, message: &[u8], signature: &Signature) -> Result<bool>
    - Recover public key from PeerId or from provided key
    - Verify Ed25519 signature

  export_public_identity() -> Result<PublicIdentity>
    - Returns { peer_id, public_key, display_name, created_at }
    - No private key exposure ever
```

**Data model:**

```rust
// src-tauri/src/db/models/identity.rs
pub struct PeerIdentity {
    pub peer_id: String,           // base58-encoded multihash of public key
    pub public_key: Vec<u8>,       // Ed25519 public key (32 bytes)
    pub display_name: String,      // User-chosen display name
    pub created_at: String,        // ISO 8601
}

pub struct TrustedPeer {
    pub peer_id: String,
    pub public_key: Vec<u8>,
    pub display_name: String,
    pub trust_level: TrustLevel,   // Manual, Verified, Revoked
    pub added_at: String,
    pub last_seen: Option<String>,
    pub notes: Option<String>,
}

pub enum TrustLevel {
    Manual,     // User manually added public key
    Verified,   // Connected and verified via challenge-response
    Revoked,    // User revoked trust
}
```

**Database migration:**

```sql
-- New table: peer identity (always exactly 1 row)
CREATE TABLE IF NOT EXISTS local_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    peer_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Anonymous',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- New table: trusted peers
CREATE TABLE IF NOT EXISTS trusted_peers (
    peer_id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    display_name TEXT NOT NULL,
    trust_level TEXT NOT NULL DEFAULT 'manual',
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT,
    notes TEXT
);
```

**Cargo.toml additions:**

```toml
ed25519-dalek = { version = "2", features = ["serde", "zeroize"] }
multihash = "0.19"
bs58 = "0.5"                # Base58 encoding for PeerId
```

**Tauri commands:**

```
// src-tauri/src/commands/identity.rs
#[tauri::command] get_local_identity() -> PeerIdentity
#[tauri::command] set_display_name(name: String)
#[tauri::command] export_identity_card() -> String  // base64-encoded identity card
#[tauri::command] import_trusted_peer(identity_card: String) -> TrustedPeer
#[tauri::command] list_trusted_peers() -> Vec<TrustedPeer>
#[tauri::command] revoke_peer_trust(peer_id: String)
```

**Frontend:**

```
// src/api/identity/index.ts
// Thin wrappers around Tauri commands

// src/features/settings/IdentitySettings.tsx
// - Shows local PeerId (truncated, copyable)
// - Display name editor
// - "Export my identity" button (generates QR code or copyable string)
// - Trusted peers list with add/revoke controls

// src/stores/identityStore.ts
// Zustand store for identity state
```

#### 1.1.2 Integration Points

- **App startup** (`lib.rs` → `run()`): Call `identity::get_or_create_identity()` during initialization, after DB migration and before engine startup.
- **Keyring key name:** `personas_desktop_ed25519_private_key` in OS keyring (same keyring service as vault encryption key).

---

### 1.2 Exposure Manifest

The manifest declares what local resources a user chooses to share.

#### 1.2.1 Data Model

```rust
// src-tauri/src/db/models/exposure.rs

pub struct ExposureManifest {
    pub version: u32,                    // Schema version for evolution
    pub owner_peer_id: String,
    pub updated_at: String,
    pub resources: Vec<ExposedResource>,
}

pub struct ExposedResource {
    pub id: String,                      // UUID
    pub resource_type: ResourceType,
    pub resource_id: String,             // FK to persona, template, etc.
    pub display_name: String,
    pub description: Option<String>,
    pub fields_exposed: Vec<String>,     // Whitelist of field names
    pub access_level: AccessLevel,
    pub requires_auth: bool,             // Require trusted peer
    pub tags: Vec<String>,               // For capability search
    pub created_at: String,
    pub expires_at: Option<String>,      // Optional TTL
}

pub enum ResourceType {
    Persona,          // Agent definition (system prompt, model config, tools)
    Template,         // Persona template (reusable blueprint)
    ExecutionResult,  // Past execution output
    Knowledge,        // Knowledge graph entries
    Connector,        // Connector capability (proxy execution)
}

pub enum AccessLevel {
    Read,       // Can view the resource
    Execute,    // Can trigger execution of the agent
    Fork,       // Can copy and modify the resource
}
```

**Database migration:**

```sql
CREATE TABLE IF NOT EXISTS exposed_resources (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    fields_exposed TEXT NOT NULL DEFAULT '[]',  -- JSON array
    access_level TEXT NOT NULL DEFAULT 'read',
    requires_auth INTEGER NOT NULL DEFAULT 1,
    tags TEXT NOT NULL DEFAULT '[]',            -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    UNIQUE(resource_type, resource_id)
);

-- Index for capability-based lookup
CREATE INDEX IF NOT EXISTS idx_exposed_tags ON exposed_resources(tags);
CREATE INDEX IF NOT EXISTS idx_exposed_type ON exposed_resources(resource_type);
```

#### 1.2.2 Manifest Builder UI

**New feature module:** `src/features/sharing/`

```
src/features/sharing/
├── ExposureManager.tsx          # Main sharing configuration page
├── ResourceExposureCard.tsx     # Card per exposed resource with toggle/config
├── ExposureFieldPicker.tsx      # Field-level whitelist selector
├── ManifestPreview.tsx          # Read-only preview of what peers will see
└── ExposureBadge.tsx            # Small badge showing "shared" status on entities
```

**UX flow:**
1. User navigates to Settings > Sharing (or a new "Network" section).
2. Sees list of all local resources (personas, templates, etc.).
3. Toggles exposure per resource. When enabled, selects:
   - Which fields to expose (whitelist picker)
   - Access level (read / execute / fork)
   - Whether authentication is required
   - Optional tags for capability discovery
4. Preview panel shows the manifest as peers would see it.

**Integration with existing UI:**
- Add a small "Share" icon/badge on persona cards (`src/features/agents/`) when a persona is exposed.
- Add exposure toggle to persona detail view.

---

### 1.3 Signed Bundle Format (.persona files)

#### 1.3.1 Bundle Structure

A `.persona` bundle is a signed ZIP archive with a deterministic structure:

```
my-agent.persona
├── manifest.json        # ExposureManifest (what's included, versions)
├── signature.json       # Ed25519 signature over manifest + content hash
├── persona.json         # Persona definition (filtered by fields_exposed)
├── system_prompt.md     # System prompt text (if exposed)
├── tools/               # Tool definitions (if exposed)
│   ├── tool_001.json
│   └── tool_002.json
├── templates/           # Template definitions (if exposed)
│   └── template.json
├── knowledge/           # Knowledge entries (if exposed)
│   └── entries.json
└── metadata.json        # Bundle metadata (created_at, app_version, etc.)
```

#### 1.3.2 Bundle Operations

**New file:** `src-tauri/src/engine/bundle.rs`

```
Module: bundle
Dependencies: zip, serde_json, ed25519-dalek, sha2

Functions:
  export_bundle(resource_ids: Vec<String>) -> Result<Vec<u8>>
    - Load each resource from DB
    - Filter fields according to exposure manifest
    - Compute SHA-256 content hash
    - Sign manifest + content hash with local Ed25519 key
    - Package into ZIP with deterministic ordering
    - Return bytes (caller saves to filesystem via Tauri dialog)

  import_bundle(bytes: &[u8]) -> Result<BundleImportPreview>
    - Unzip and parse manifest.json + signature.json
    - Verify Ed25519 signature against included public key
    - Check if signer is in trusted_peers (warn if not)
    - Return preview of what will be imported (no DB writes yet)

  apply_import(preview: BundleImportPreview, options: ImportOptions) -> Result<ImportResult>
    - Write resources to local DB
    - Record provenance (original peer_id, import timestamp)
    - Handle conflicts (skip, overwrite, rename)
    - Return summary of what was imported/skipped

  verify_bundle_signature(bytes: &[u8]) -> Result<BundleVerification>
    - Standalone verification without import
    - Returns signer identity + trust status + content integrity
```

#### 1.3.3 Provenance Tracking

```sql
-- Track where imported resources came from
CREATE TABLE IF NOT EXISTS resource_provenance (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    source_peer_id TEXT NOT NULL,
    source_display_name TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    bundle_hash TEXT,            -- SHA-256 of the .persona file
    signature_verified INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (resource_type, resource_id)
);
```

#### 1.3.4 Tauri Commands

```
#[tauri::command] export_persona_bundle(resource_ids: Vec<String>, save_path: String) -> Result<ExportResult>
#[tauri::command] preview_bundle_import(file_path: String) -> Result<BundleImportPreview>
#[tauri::command] apply_bundle_import(preview_id: String, options: ImportOptions) -> Result<ImportResult>
#[tauri::command] verify_bundle(file_path: String) -> Result<BundleVerification>
```

#### 1.3.5 Frontend: Import/Export Flow

```
src/features/sharing/
├── BundleExportDialog.tsx    # Select resources → preview → export
├── BundleImportDialog.tsx    # Open file → verify → preview → import
├── BundlePreview.tsx         # Show bundle contents + signer info
├── ProvenanceBadge.tsx       # Badge showing "imported from PeerId X"
└── ImportConflictResolver.tsx # Handle duplicate resources
```

**Integration:**
- Add "Export as .persona" to persona context menu (`src/features/agents/`).
- Add "Import .persona" button to home page and persona list.
- Register `.persona` file extension with Tauri deep-link plugin for OS-level double-click import.
- Use existing `tauri-plugin-dialog` for native file picker.

---

### 1.4 Phase 1 Deliverables Checklist

| Deliverable | New Files | Modified Files |
|-------------|-----------|----------------|
| Ed25519 identity keypair | `engine/identity.rs`, `db/models/identity.rs`, `commands/identity.rs` | `lib.rs` (init), `db/migrations.rs` |
| Exposure manifest | `db/models/exposure.rs`, `db/repos/resources/exposure.rs`, `commands/exposure.rs` | `db/migrations.rs` |
| Manifest builder UI | `features/sharing/*` (5+ components), `api/sharing/index.ts`, `stores/sharingStore.ts` | App routing, settings nav |
| Bundle format (.persona) | `engine/bundle.rs` | — |
| Bundle import/export | `commands/bundle.rs` | `tauri.conf.json` (file associations) |
| Import/export UI | `features/sharing/Bundle*.tsx` (4 components) | Persona context menus, home page |
| Provenance tracking | `db/models/provenance.rs` | `db/migrations.rs`, persona detail view |
| Trusted peers management | — (uses identity tables) | Settings page |

### 1.5 Phase 1 Success Criteria

- [x] User A exports a persona as a signed `.persona` file
- [x] User B imports it — signature verification works, provenance tracked
- [x] Exposure manifest correctly filters fields (non-exposed fields absent from bundle)
- [x] Trusted peer management works (add via identity card, revoke)
- [ ] Double-clicking a `.persona` file opens the app and starts import flow
- [x] All existing tests continue to pass (no regressions)

### 1.6 Phase 1 Implementation Notes

**Implemented files (Rust backend):**
- `src-tauri/src/engine/identity.rs` — Ed25519 keypair generation, OS keyring storage, peer_id derivation (base58(sha256(pubkey))), signing/verification, identity card export/import
- `src-tauri/src/engine/bundle.rs` — Signed .persona ZIP bundle export/import with SHA-256 content hashing
- `src-tauri/src/db/models/identity.rs` — PeerIdentity, TrustedPeer, IdentityCard, TrustLevel types
- `src-tauri/src/db/models/exposure.rs` — ExposedResource, ExposureManifest, ResourceProvenance types
- `src-tauri/src/db/repos/resources/identity.rs` — Identity and trusted peer DB operations
- `src-tauri/src/db/repos/resources/exposure.rs` — Exposure and provenance DB operations
- `src-tauri/src/commands/network/identity.rs` — Tauri commands for identity management
- `src-tauri/src/commands/network/exposure.rs` — Tauri commands for exposure management
- `src-tauri/src/commands/network/bundle.rs` — Tauri commands for bundle export/import

**Implemented files (Frontend):**
- `src/api/network/identity.ts` — Identity API wrappers
- `src/api/network/exposure.ts` — Exposure API wrappers
- `src/api/network/bundle.ts` — Bundle API wrappers
- `src/features/sharing/components/IdentitySettings.tsx` — Identity management UI (peer ID display, display name editing, identity card export, trusted peer list with add/revoke/delete)
- `src/features/sharing/components/ExposureManager.tsx` — Main sharing page with resource exposure management
- `src/features/sharing/components/BundleExportDialog.tsx` — Bundle export wizard
- `src/features/sharing/components/BundleImportDialog.tsx` — Bundle import with signature verification and conflict resolution
- `src/features/sharing/components/ProvenanceBadge.tsx` — Provenance indicator on imported resources
- `src/stores/slices/network/networkSlice.ts` — Zustand store slice for all network state

**Key design decisions:**
- Used `keyring` crate for OS-level private key storage (same as vault encryption key)
- peer_id = base58(sha256(ed25519_public_key)) for compact, URL-safe identifiers
- Bundle format is a ZIP with manifest.json, signature.json, and resource data files
- Identity cards are base64-encoded JSON containing peer_id, public_key, display_name
- DB migrations use `CREATE TABLE IF NOT EXISTS` in `run_incremental()` for additive changes

---

## Phase 2: LAN Discovery

> **Status: COMPLETE** — All backend (Rust) and frontend (React/TypeScript) code implemented on branch `feature/invisible-apps`. Compiles clean. Ready for integration testing.

**Goal:** Peers on the same local network discover each other automatically and exchange agent messages over direct connections.

**Duration estimate:** 6-8 weeks
**Networking required:** LAN only (no NAT traversal)
**Risk level:** Medium

### 2.1 mDNS Peer Discovery

#### 2.1.1 Discovery Service

**New file:** `src-tauri/src/engine/discovery.rs`

```
Module: discovery
Dependencies: mdns-sd (or libp2p-mdns), tokio

Service name: "_personas._tcp.local."

Functions:
  start_mdns_discovery(identity: &PeerIdentity) -> Result<DiscoveryHandle>
    - Register mDNS service with:
        service_name: "_personas._tcp.local."
        port: <dynamic QUIC listener port>
        txt_records: {
          "peer_id": <base58 PeerId>,
          "version": <protocol version>,
          "name": <display_name>,
          "caps": <comma-separated capability tags>  // max 255 bytes
        }
    - Start listener for peer announcements
    - Emit DiscoveryEvent::PeerFound / PeerLost to internal channel
    - Return handle for graceful shutdown

  stop_mdns_discovery(handle: DiscoveryHandle)
    - Unregister service
    - Stop listener

  get_discovered_peers() -> Vec<DiscoveredPeer>
    - Returns current snapshot of LAN peers
```

**Data model:**

```rust
// src-tauri/src/engine/discovery.rs (or separate types file)

pub struct DiscoveredPeer {
    pub peer_id: String,
    pub display_name: String,
    pub addresses: Vec<SocketAddr>,    // LAN IPs
    pub protocol_version: String,
    pub capability_summary: Vec<String>,
    pub discovered_at: String,
    pub last_seen: String,
}

pub enum DiscoveryEvent {
    PeerFound(DiscoveredPeer),
    PeerUpdated(DiscoveredPeer),
    PeerLost { peer_id: String },
}
```

**Cargo.toml additions:**

```toml
mdns-sd = "0.11"             # Pure-Rust mDNS/DNS-SD
# OR use libp2p-mdns if adopting libp2p in this phase
```

#### 2.1.2 Frontend: Peer Discovery Panel

```
src/features/network/
├── NetworkDashboard.tsx       # Main network overview page
├── PeerList.tsx               # List of discovered LAN peers
├── PeerCard.tsx               # Individual peer: name, status, capabilities
├── PeerDetailDrawer.tsx       # Expanded view with full manifest
├── ConnectionStatus.tsx       # Network status indicator (header bar)
└── TrustPrompt.tsx            # "New peer found — trust?" dialog
```

**UX flow:**
1. Network icon in header bar shows discovered peer count.
2. Click opens Network Dashboard showing LAN peers in real-time.
3. Each peer shows: display name, PeerId (truncated), capability summary, connection quality.
4. Click a peer → see their full exposure manifest → browse/import/execute resources.

---

### 2.2 Direct QUIC Transport

#### 2.2.1 Transport Layer

**New file:** `src-tauri/src/engine/transport.rs`

```
Module: transport
Dependencies: quinn (QUIC), rustls, ed25519-dalek, tokio

Design: QUIC chosen for multiplexed streams, built-in encryption, NAT-friendlier than TCP.

Functions:
  start_transport(identity: &PeerIdentity, bind_addr: SocketAddr) -> Result<TransportHandle>
    - Generate self-signed TLS cert from Ed25519 identity
    - Bind QUIC endpoint on dynamic port
    - Accept inbound connections (verify peer identity via TLS cert)
    - Return handle with local address + connection management

  connect_to_peer(transport: &TransportHandle, peer: &DiscoveredPeer) -> Result<PeerConnection>
    - Open QUIC connection to peer address
    - Mutual TLS handshake verifies both identities
    - Return connection handle for opening streams

  open_stream(conn: &PeerConnection, stream_type: StreamType) -> Result<BiStream>
    - Open a new bidirectional QUIC stream on existing connection
    - Stream types: ManifestSync, AgentMessage, BundleTransfer

  close_connection(conn: PeerConnection)
    - Graceful connection teardown
```

**Cargo.toml additions:**

```toml
quinn = "0.11"
rustls = { version = "0.23", features = ["ring"] }
rcgen = "0.13"     # Self-signed cert generation from Ed25519 keys
```

#### 2.2.2 Connection Manager

**New file:** `src-tauri/src/engine/connection_manager.rs`

```
Module: connection_manager
Manages lifecycle of all peer connections.

State:
  connections: HashMap<PeerId, PeerConnection>
  pending_connections: HashMap<PeerId, ConnectAttempt>
  connection_events: broadcast::Sender<ConnectionEvent>

Functions:
  ensure_connected(peer_id: &str) -> Result<&PeerConnection>
    - If already connected, return existing connection
    - If not, look up peer in discovered peers → connect → cache
    - Emit ConnectionEvent::Established

  disconnect(peer_id: &str)
    - Close connection, remove from cache
    - Emit ConnectionEvent::Disconnected

  on_inbound_connection(conn: PeerConnection)
    - Verify peer identity
    - Check trust level (reject if revoked)
    - Add to connections map
    - Emit ConnectionEvent::InboundAccepted

  get_connected_peers() -> Vec<ConnectedPeerInfo>
    - Returns all active connections with latency, stream count, etc.

  health_check_loop()
    - Periodic ping on all connections
    - Close stale connections
    - Re-emit PeerLost for disconnected peers
```

---

### 2.3 Manifest Synchronization Protocol

When two peers connect, they exchange exposure manifests so each knows what the other offers.

#### 2.3.1 Protocol Messages

```rust
// src-tauri/src/engine/protocol.rs

/// Wire format: MessagePack-encoded, framed with 4-byte length prefix
/// Each message type has a u8 discriminant byte.

pub enum ProtocolMessage {
    // Handshake (first messages after QUIC connection)
    Hello {
        peer_id: String,
        protocol_version: u32,
        capabilities: Vec<String>,
        manifest_hash: String,        // SHA-256 of current manifest
    },
    HelloAck {
        peer_id: String,
        protocol_version: u32,
        capabilities: Vec<String>,
        manifest_hash: String,
    },

    // Manifest sync
    ManifestRequest,
    ManifestResponse {
        manifest: ExposureManifest,
    },

    // Resource operations
    ResourceRequest {
        request_id: String,
        resource_type: ResourceType,
        resource_id: String,
        fields_requested: Vec<String>,   // Must be subset of fields_exposed
    },
    ResourceResponse {
        request_id: String,
        status: ResponseStatus,
        data: Option<serde_json::Value>,
    },

    // Agent messages (see 2.4)
    AgentMessage(AgentEnvelope),

    // Bundle transfer
    BundleOffer {
        bundle_hash: String,
        bundle_size: u64,
        manifest_preview: ExposureManifest,
    },
    BundleAccept { bundle_hash: String },
    BundleReject { bundle_hash: String, reason: String },
    BundleChunk { bundle_hash: String, offset: u64, data: Vec<u8> },
    BundleComplete { bundle_hash: String },

    // Control
    Ping { timestamp: u64 },
    Pong { timestamp: u64 },
    Error { code: u32, message: String },
    Goodbye { reason: String },
}

pub enum ResponseStatus {
    Ok,
    NotFound,
    AccessDenied,
    RateLimited,
}
```

**Serialization choice:** MessagePack (via `rmp-serde`) — compact binary, schema-flexible, Rust-native. Good enough for Phase 2. Upgrade path to Cap'n Proto in Phase 4 if needed.

```toml
# Cargo.toml
rmp-serde = "1"
```

#### 2.3.2 Sync Flow

```
Peer A                              Peer B
  │                                   │
  │──── QUIC Connect ────────────────>│
  │<─── QUIC Accept ─────────────────│
  │                                   │
  │──── Hello { manifest_hash } ────>│
  │<─── HelloAck { manifest_hash } ──│
  │                                   │
  │  (compare manifest hashes)        │
  │  (if different:)                  │
  │──── ManifestRequest ────────────>│
  │<─── ManifestResponse { ... } ────│
  │                                   │
  │  (manifests cached locally)       │
  │  (UI updated with peer resources) │
```

---

### 2.4 Basic Agent-to-Agent Messaging

#### 2.4.1 Agent Envelope

```rust
// src-tauri/src/engine/agent_protocol.rs

pub struct AgentEnvelope {
    // Addressing
    pub from_peer: String,             // PeerId
    pub from_agent: String,            // Persona ID on source peer
    pub to_peer: String,               // PeerId
    pub to_agent: Option<String>,      // Specific persona, or None for capability routing

    // Semantics
    pub intent: MessageIntent,
    pub capability_required: Option<String>,  // "can-summarize-pdf", "has-github-access"

    // Payload
    pub payload: serde_json::Value,
    pub schema_version: String,

    // Flow control
    pub conversation_id: String,       // Groups multi-turn exchanges
    pub sequence: u32,                 // Ordering within conversation
    pub ttl: u8,                       // Max forwarding hops (prevent infinite loops)
    pub timeout_ms: Option<u64>,       // How long sender will wait for response

    // Auth & integrity
    pub signature: Vec<u8>,            // Ed25519 signature over canonical payload
    pub timestamp: u64,                // Unix timestamp (ms)
}

pub enum MessageIntent {
    Request,        // "Please do X"
    Response,       // "Here is the result of X"
    Stream,         // "Here is partial result N of X"
    Delegate,       // "I can't do X, but peer Y might be able to"
    Negotiate,      // "Before I do X, I need to clarify Y"
    Cancel,         // "Stop working on conversation C"
}
```

#### 2.4.2 Cross-Instance Chain Trigger

The existing chain trigger system (`engine/chain.rs`) is extended to support remote agents.

```rust
// Extension to existing TriggerConfig model
pub struct ChainTriggerConfig {
    pub source_persona_id: String,
    pub condition: ChainCondition,      // existing: success, failure, any, jsonpath
    pub payload_forwarding: bool,

    // NEW: remote chain support
    pub remote_peer_id: Option<String>,        // If set, source is on a remote peer
    pub remote_agent_id: Option<String>,       // Agent ID on remote peer
    pub capability_match: Option<String>,      // Alternative: route by capability
}
```

**Integration with event bus:**
- Remote `AgentEnvelope` messages with `intent: Response` are converted to local `PersonaEvent` entries.
- The event bus (`engine/bus.rs`) evaluates subscriptions against these events.
- Matching subscriptions trigger local chain executions.
- `chain_trace_id` spans across instances (prefixed with peer_id for uniqueness).

#### 2.4.3 Proxy Execution Model

When Peer A asks Peer B to execute a connector action, Peer B runs it locally (using its own credentials) and returns only the result.

```
Peer A (requestor)                  Peer B (executor)
  │                                   │
  │  AgentEnvelope {                  │
  │    intent: Request,               │
  │    capability: "github-read",     │
  │    payload: { action: "list_prs", │
  │               repo: "foo/bar" }   │
  │  }                                │
  │──────────────────────────────────>│
  │                                   │  (B has GitHub credentials)
  │                                   │  (B executes connector locally)
  │                                   │  (B filters response fields)
  │                                   │
  │  AgentEnvelope {                  │
  │    intent: Response,              │
  │    payload: { prs: [...] }        │
  │  }                                │
  │<──────────────────────────────────│
  │                                   │
  │  (A never sees B's GitHub token)  │
```

**Implementation:**
- Extend `engine/connector_strategy.rs` to check if a capability exists locally OR on a connected peer.
- If remote: construct `AgentEnvelope`, send via QUIC stream, await response.
- Timeout handling: if peer doesn't respond within `timeout_ms`, fall back to local execution or fail gracefully.

---

### 2.5 Frontend: Network Features

#### 2.5.1 New UI Components

```
src/features/network/
├── NetworkDashboard.tsx           # Main network page
├── PeerList.tsx                   # Discovered peers
├── PeerCard.tsx                   # Individual peer info
├── PeerDetailDrawer.tsx           # Full peer manifest browser
├── PeerResourceBrowser.tsx        # Browse a peer's exposed resources
├── RemotePersonaCard.tsx          # Remote persona preview
├── RemoteExecutionRequest.tsx     # UI for requesting proxy execution
├── ConversationView.tsx           # Multi-turn agent conversation viewer
├── NetworkTopologyMap.tsx         # Visual graph of connected peers
├── ConnectionStatus.tsx           # Header bar network indicator
└── TrustPrompt.tsx                # Trust new peer dialog
```

#### 2.5.2 New API Layer

```
src/api/network/
├── index.ts                       # Re-exports
├── discovery.ts                   # mDNS discovery commands
├── connections.ts                 # Connection management commands
├── protocol.ts                    # Message send/receive commands
└── remoteResources.ts             # Remote resource browsing commands
```

#### 2.5.3 State Management

```
src/stores/networkStore.ts
  State:
    discoveredPeers: Map<PeerId, DiscoveredPeer>
    connectedPeers: Map<PeerId, ConnectedPeerInfo>
    peerManifests: Map<PeerId, ExposureManifest>
    activeConversations: Map<ConversationId, AgentConversation>
    networkStatus: 'offline' | 'discovering' | 'connected'

  Actions:
    refreshPeers()
    connectToPeer(peerId)
    disconnectFromPeer(peerId)
    sendAgentMessage(envelope)
    browseRemoteResource(peerId, resourceId)
```

---

### 2.6 Tauri Commands (Phase 2)

```
// Discovery
#[tauri::command] start_network_discovery()
#[tauri::command] stop_network_discovery()
#[tauri::command] get_discovered_peers() -> Vec<DiscoveredPeer>

// Connections
#[tauri::command] connect_to_peer(peer_id: String) -> ConnectedPeerInfo
#[tauri::command] disconnect_from_peer(peer_id: String)
#[tauri::command] get_connected_peers() -> Vec<ConnectedPeerInfo>

// Protocol
#[tauri::command] fetch_peer_manifest(peer_id: String) -> ExposureManifest
#[tauri::command] fetch_remote_resource(peer_id: String, resource_type: String, resource_id: String) -> Value
#[tauri::command] send_agent_message(envelope: AgentEnvelope) -> String  // returns conversation_id
#[tauri::command] get_conversation(conversation_id: String) -> Vec<AgentEnvelope>

// Proxy execution
#[tauri::command] request_remote_execution(peer_id: String, capability: String, payload: Value) -> Value

// Network settings
#[tauri::command] get_network_settings() -> NetworkSettings
#[tauri::command] update_network_settings(settings: NetworkSettings)
```

---

### 2.7 Phase 2 Deliverables Checklist

| Deliverable | New Crate/Module | Key Dependencies |
|-------------|-----------------|------------------|
| mDNS discovery | `engine/discovery.rs` | `mdns-sd` |
| QUIC transport | `engine/transport.rs` | `quinn`, `rustls`, `rcgen` |
| Connection manager | `engine/connection_manager.rs` | — |
| Protocol messages | `engine/protocol.rs` | `rmp-serde` |
| Agent protocol | `engine/agent_protocol.rs` | — |
| Manifest sync | integrated in `protocol.rs` | — |
| Remote chain triggers | extends `engine/chain.rs` | — |
| Proxy execution | extends `engine/connector_strategy.rs` | — |
| Network UI | `features/network/*` (10+ components) | — |
| Network store | `stores/networkStore.ts` | — |
| Network API | `api/network/*` | — |

### 2.8 Phase 2 Success Criteria

- [x] Two instances on same LAN discover each other within 5 seconds (mDNS `_personas._tcp.local.`)
- [x] Exposure manifests sync automatically on connection (ManifestRequest/ManifestResponse on connect + periodic 30s re-sync)
- [x] User A can browse User B's exposed personas (PeerDetailDrawer shows synced manifest entries)
- [ ] User A can request proxy execution of a connector on User B's instance (deferred to Phase 3/4)
- [ ] Agent chain triggers work across instances (deferred to Phase 3/4)
- [x] Connections are encrypted (QUIC/TLS with self-signed certs, peer_id verified via Hello/HelloAck handshake)
- [x] Untrusted peers can be rejected (trust level checked, UI shows trusted/unknown badges)
- [x] Network goes gracefully offline when peers disappear (stale peer pruning, health check Ping/Pong, connection state tracking)
- [x] All Phase 1 features continue to work

### 2.9 Phase 2 Implementation Notes

**Module structure (differs from plan — consolidated under `engine/p2p/`):**
```
src-tauri/src/engine/p2p/
├── mod.rs              # NetworkService orchestrator (start/stop/accept_loop/config)
├── mdns.rs             # mDNS registration + browsing (_personas._tcp.local.)
├── transport.rs        # QUIC endpoint (quinn + rustls), self-signed cert generation (rcgen)
├── connection.rs       # ConnectionManager: connect/disconnect, Hello/HelloAck handshake, health checks
├── protocol.rs         # Wire protocol: Message enum (Hello, HelloAck, ManifestRequest/Response, AgentMessage, Ping/Pong)
├── manifest_sync.rs    # ManifestSync: periodic sync (30s), build_local_manifest from exposed_resources
├── messaging.rs        # MessageRouter: in-memory ring buffer (100/persona), rate limiting (10 msgs/sec/peer)
└── types.rs            # NetworkConfig, ConnectionState, DiscoveredPeer, PeerManifestEntry, NetworkStatusInfo
```

**Wire protocol:**
- MessagePack serialization via `rmp-serde`
- 4-byte big-endian length prefix framing
- Max message size: 16 MB
- Protocol version: 1

**QUIC transport:**
- Self-signed X.509 certificates generated from node identity using `rcgen` v0.13
- Custom `SkipServerVerification` — all TLS certs accepted; peer identity verified post-handshake via Hello/HelloAck exchange
- Default port: 4242 (configurable via NetworkConfig)

**mDNS discovery:**
- Service type: `_personas._tcp.local.`
- TXT records: `peer_id`, `display_name`, `version`
- Discovered peers stored in `discovered_peers` SQLite table
- Stale peer pruning based on configurable timeout (default 60s)

**Connection lifecycle:**
1. Resolve peer address from `discovered_peers` DB
2. QUIC connect via quinn
3. Hello/HelloAck handshake (exchange peer_id + display_name + protocol_version)
4. Automatic manifest sync on connect
5. Health check: Ping/Pong every 15s
6. Connection state tracking: Disconnected → Connecting → Connected / Failed

**New DB tables:**
- `discovered_peers` — peer_id, display_name, addresses (JSON), last_seen_at, first_seen_at, is_connected, metadata
- `peer_manifests` — id, peer_id, resource_type, resource_id, display_name, access_level, tags, synced_at (UNIQUE on peer_id + resource_type + resource_id)

**AppState integration:**
- `NetworkService` stored as `Option<Arc<NetworkService>>` in AppState
- Initialized at app startup after identity is loaded
- Auto-starts mDNS + QUIC listener as background tokio task (3s delay after startup)

**Tauri commands (10 new):**
- `get_discovered_peers`, `connect_to_peer`, `disconnect_peer`
- `get_peer_manifest`, `sync_peer_manifest`, `get_connection_status`
- `get_network_status`, `send_agent_message`, `get_received_messages`
- `set_network_config`

**Frontend API:**
- `src/api/network/discovery.ts` — Typed wrappers for all 10 commands with TypeScript interfaces

**Frontend store:**
- Extended `networkSlice.ts` with Phase 2 state: `discoveredPeers`, `peerManifests`, `connectionStates`, `networkStatus`
- Actions: `fetchDiscoveredPeers`, `connectToPeer`, `disconnectPeer`, `fetchPeerManifest`, `syncPeerManifest`, `fetchNetworkStatus`

**Frontend UI components:**
- `NetworkDashboard.tsx` — Real-time network status (online/offline, port, peer counts). Auto-refreshes every 5s.
- `PeerList.tsx` — Lists discovered LAN peers with connect/disconnect actions, refresh button, 5s polling.
- `PeerCard.tsx` — Peer card with connection status dot (green/amber/red/grey), display name, trust badge, relative last-seen time, connect/disconnect/detail buttons.
- `PeerDetailDrawer.tsx` — Slide-over drawer with peer identity info, connection controls, shared resource manifest with sync capability.
- `ExposureManager.tsx` updated — Layout is now: Network Status → Your Identity → Exposed Resources → Discovered Peers.

**Cargo dependencies added:**
```toml
mdns-sd = "0.11"
quinn = "0.11"
rustls = { version = "0.23", features = ["ring"] }
rcgen = "0.13"
rmp-serde = "1.3"
```

**Key deviations from original plan:**
- Proxy execution and remote chain triggers deferred to Phase 3/4 (as originally scoped for later phases)
- UI components placed in `src/features/sharing/components/` (collocated with Phase 1 sharing UI) rather than a separate `src/features/network/` directory, since they share the same settings page
- Agent messaging uses in-memory ring buffer instead of DB persistence (sufficient for Phase 2; Phase 3 will add persistent offline queue)
- No separate `TrustPrompt.tsx` dialog — trust information shown inline via PeerCard badges and PeerDetailDrawer info panel

---

## Phase 3: Internet P2P & Data Exposure

> **Status: NOT STARTED** — Phase 2 complete; this phase is next. Proxy execution and remote chain triggers from Phase 2's stretch goals are included here, combined with the new Data Exposure layer for live database/connector/KB querying across peers.

**Goal:** Extend LAN networking to work across the internet with NAT traversal, relay fallback, and robust identity verification. Simultaneously introduce a Data Exposure system so peers can selectively share live data from any database connector or vector knowledge base — with column-level access control, sensitivity detection, and per-exposure policies.

**Duration estimate:** 10-14 weeks
**Networking required:** Internet (WAN)
**Risk level:** High

### 3.1 libp2p Integration

#### 3.1.1 Why libp2p Over Raw QUIC

Phase 2 uses quinn (raw QUIC) for simplicity on LAN. Phase 3 migrates to libp2p because:
- Built-in NAT traversal (AutoNAT, hole-punching)
- Built-in relay (Circuit Relay v2)
- Kademlia DHT for internet-wide peer discovery
- Noise protocol for authentication (replaces our TLS cert approach)
- Protocol multiplexing (yamux) — multiple logical protocols over one connection
- Battle-tested in IPFS, Filecoin, Polkadot

**Alternative considered:** `iroh` (by n0.computer) — simpler API, built by IPFS veterans, designed for desktop/embedded. Evaluate at implementation time; if iroh is mature enough, prefer it for simpler integration.

#### 3.1.2 Cargo.toml Dependencies

```toml
[dependencies]
libp2p = { version = "0.54", features = [
    "tokio",
    "quic",
    "noise",
    "yamux",
    "kad",             # Kademlia DHT
    "mdns",            # Keep LAN discovery
    "relay",           # Circuit Relay v2
    "autonat",         # NAT type detection
    "dcutr",           # Direct Connection Upgrade through Relay (hole-punching)
    "identify",        # Peer identification protocol
    "ping",            # Liveness checking
    "gossipsub",       # Pub/sub for capability announcements (optional)
    "request-response", # Request/response protocol
    "serde",
] }
```

#### 3.1.3 Network Behaviour Composition

```rust
// src-tauri/src/engine/p2p/behaviour.rs

use libp2p::{
    kad, mdns, relay, autonat, dcutr, identify, ping,
    request_response, gossipsub, swarm::NetworkBehaviour,
};

#[derive(NetworkBehaviour)]
pub struct PersonasBehaviour {
    // Discovery
    pub kademlia: kad::Behaviour<kad::store::MemoryStore>,
    pub mdns: mdns::tokio::Behaviour,         // Keep LAN discovery
    pub identify: identify::Behaviour,

    // NAT traversal
    pub autonat: autonat::Behaviour,
    pub relay_client: relay::client::Behaviour,
    pub dcutr: dcutr::Behaviour,

    // Relay server (every node with public address)
    pub relay_server: relay::Behaviour,

    // Communication
    pub agent_protocol: request_response::cbor::Behaviour<AgentRequest, AgentResponse>,
    pub manifest_sync: request_response::cbor::Behaviour<ManifestRequest, ManifestResponse>,
    pub data_query: request_response::cbor::Behaviour<DataQueryRequest, DataQueryResponse>,

    // Health
    pub ping: ping::Behaviour,
}
```

#### 3.1.4 Swarm Initialization

```rust
// src-tauri/src/engine/p2p/swarm.rs

pub async fn build_swarm(identity: &PeerIdentity) -> Result<Swarm<PersonasBehaviour>> {
    // 1. Load or generate libp2p keypair from our Ed25519 identity
    let keypair = identity_to_libp2p_keypair(identity)?;

    // 2. Build transport: QUIC + Noise + Yamux
    let transport = libp2p::quic::tokio::Transport::new(quic::Config::new(&keypair));

    // 3. Configure behaviours
    let behaviour = PersonasBehaviour {
        kademlia: kad::Behaviour::new(
            peer_id,
            kad::store::MemoryStore::new(peer_id),
        ),
        mdns: mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)?,
        relay_server: relay::Behaviour::new(
            peer_id,
            relay::Config {
                max_reservations: 20,
                max_circuits: 32,
                max_circuit_bytes: 1 << 17,  // 128KB per message cap
                max_circuit_duration: Duration::from_secs(300),
            },
        ),
        relay_client: relay::client::Behaviour::new(peer_id, /* ... */),
        autonat: autonat::Behaviour::new(peer_id, autonat::Config::default()),
        dcutr: dcutr::Behaviour::new(peer_id),
        // ... other behaviours
    };

    // 4. Build swarm
    let swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_quic()
        .with_relay_client(noise::Config::new, yamux::Config::default)
        .with_behaviour(|_| behaviour)?
        .build();

    Ok(swarm)
}
```

#### 3.1.5 Module Structure

```
src-tauri/src/engine/p2p/
├── mod.rs                     # Public API surface
├── swarm.rs                   # Swarm construction + event loop
├── behaviour.rs               # NetworkBehaviour composition
├── discovery.rs               # DHT + mDNS discovery integration
├── transport.rs               # QUIC transport configuration
├── relay.rs                   # Relay server + client logic
├── nat.rs                     # NAT detection + hole-punching
├── protocols/
│   ├── mod.rs
│   ├── agent_protocol.rs      # Agent message request/response codec
│   ├── manifest_sync.rs       # Manifest exchange codec
│   ├── bundle_transfer.rs     # Bundle streaming transfer codec
│   └── data_query.rs          # Data query request/response codec (NEW)
├── peer_manager.rs            # Connection tracking, health, reputation
└── metrics.rs                 # Network metrics collection
```

---

### 3.2 NAT Traversal Strategy

#### 3.2.1 Connection Flow (Layered Fallback)

```
App starts:
  1. Bind QUIC on random port
  2. Try UPnP/NAT-PMP port mapping (via igd-next crate)
  3. Start mDNS (LAN discovery — always active)
  4. Contact bootstrap nodes (DHT entry)
  5. AutoNAT: determine NAT type (public, restricted cone, symmetric)

Connecting to peer:
  Level 1: Direct connection (both public or same LAN)
    → Success rate: ~45%
    → Latency: lowest

  Level 2: Hole-punching via DCUtR (both behind cone NAT)
    → Requires relay for coordination
    → Success rate: ~25% additional
    → Latency: low (direct after punch)

  Level 3: User relay (route through another peer with public address)
    → Any peer with relay_server enabled
    → Success rate: ~25% additional
    → Latency: moderate (one hop)

  Level 4: Bootstrap relay (last resort)
    → Hardcoded bootstrap/relay nodes
    → Success rate: ~5% additional (covers symmetric NAT + strict firewall)
    → Latency: highest

  Total expected success rate: ~95-99%
```

#### 3.2.2 Bootstrap Nodes

```rust
// src-tauri/src/engine/p2p/discovery.rs

const BOOTSTRAP_NODES: &[&str] = &[
    // Free-tier hosted (Oracle Cloud or equivalent)
    "/dns4/bootstrap1.personas.network/udp/4001/quic-v1/p2p/<PEER_ID>",
    "/dns4/bootstrap2.personas.network/udp/4001/quic-v1/p2p/<PEER_ID>",
    // Community-operated (added over time)
];

// Bootstrap nodes run the same app binary with --bootstrap-mode flag
// They only provide: DHT entry + last-resort relay
// They store NO user data, NO credentials, NO manifests
```

**Bootstrap node binary:**
- Same Rust crate, feature-flagged: `cargo build --features bootstrap-node`
- Strips all UI, SQLite, vault functionality
- Runs just: libp2p swarm + Kademlia DHT + Circuit Relay
- Deployable as a single static binary on any Linux VPS

#### 3.2.3 UPnP Port Mapping

```toml
# Cargo.toml
igd-next = "0.15"   # UPnP/NAT-PMP port mapping
```

```rust
// src-tauri/src/engine/p2p/nat.rs
pub async fn try_upnp_mapping(local_port: u16) -> Option<SocketAddr> {
    // Attempt UPnP port mapping
    // Returns external address if successful
    // Silently returns None if UPnP unavailable
}
```

---

### 3.3 Community Relay System

#### 3.3.1 Auto-Relay

Every node that has a publicly reachable address automatically acts as a relay via libp2p Circuit Relay v2. This is opt-out (users can disable in settings).

#### 3.3.2 Volunteer Relay Tier

```rust
// src-tauri/src/engine/p2p/relay.rs

pub struct RelaySettings {
    pub enabled: bool,                       // Default: true (auto-relay)
    pub volunteer_mode: bool,                // Default: false (user opts in)
    pub max_bandwidth_bytes_per_day: u64,    // Default: 50 MB
    pub max_concurrent_circuits: u32,        // Default: 10 (auto) or 50 (volunteer)
    pub priority_boost: bool,                // Volunteers get priority when they need relay
}
```

**Frontend settings:**

```
Settings > Network > Relay
  ┌─────────────────────────────────────────────────┐
  │ Community Relay                                  │
  │                                                  │
  │ [x] Allow relaying for nearby peers (auto)       │
  │ [ ] Volunteer as community relay node             │
  │     Bandwidth limit: [50 MB/day ▾]               │
  │                                                  │
  │ Currently relaying for: 3 peers                  │
  │ Bandwidth used today: 12.4 MB / 50 MB           │
  │                                                  │
  │ Your NAT status: Restricted Cone NAT             │
  │ External address: detected via AutoNAT            │
  └─────────────────────────────────────────────────┘
```

---

### 3.4 Noise Protocol Authentication

libp2p's Noise protocol replaces the Phase 2 TLS approach:

- **Noise XX handshake:** Mutual authentication using Ed25519 keypairs
- **Forward secrecy:** Ephemeral Diffie-Hellman per session
- **Zero infrastructure:** No certificate authorities
- **Identity binding:** Peer identity is cryptographically tied to the connection

The Phase 2 trusted_peers table continues to work — trust decisions are based on PeerId (derived from Ed25519 public key), which is the same across Noise and our original TLS approach.

---

### 3.5 Capability Discovery via DHT

#### 3.5.1 Capability Registration

```rust
// When a user exposes resources, advertise capabilities to DHT

pub async fn advertise_capabilities(
    swarm: &mut Swarm<PersonasBehaviour>,
    manifest: &ExposureManifest,
) {
    for resource in &manifest.resources {
        for tag in &resource.tags {
            // Register in DHT: capability tag → our PeerId
            let key = capability_to_kad_key(tag);
            swarm.behaviour_mut().kademlia.put_record(
                kad::Record::new(key, local_peer_id.to_bytes()),
                kad::Quorum::One,
            );
        }
    }
}

pub async fn find_capability(
    swarm: &mut Swarm<PersonasBehaviour>,
    capability: &str,
) -> Vec<PeerId> {
    let key = capability_to_kad_key(capability);
    swarm.behaviour_mut().kademlia.get_record(key);
    // Results arrive asynchronously via swarm events
}
```

#### 3.5.2 Capability Routing

When an agent needs a capability that doesn't exist locally or on any connected peer:

```
1. Agent requests "can-analyze-pdf"
2. Check local personas → not found
3. Check connected peers' manifests → not found
4. Query DHT for "can-analyze-pdf" → returns [PeerA, PeerC, PeerF]
5. Connect to closest available peer
6. Send AgentEnvelope with intent: Request
7. Receive response
```

---

### 3.6 Offline Peer Handling

Desktop apps go offline. The protocol must handle this gracefully.

#### 3.6.1 Manifest Cache

```sql
-- Cache peer manifests locally
CREATE TABLE IF NOT EXISTS cached_peer_manifests (
    peer_id TEXT PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_verified TEXT,
    peer_was_online INTEGER NOT NULL DEFAULT 1
);
```

#### 3.6.2 Message Queue for Offline Peers

```sql
-- Queue messages for peers that are currently offline
CREATE TABLE IF NOT EXISTS outbound_message_queue (
    id TEXT PRIMARY KEY,
    target_peer_id TEXT NOT NULL,
    envelope_json TEXT NOT NULL,        -- Serialized AgentEnvelope
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,           -- TTL for the message
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'pending'  -- pending, delivered, expired, failed
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_peer ON outbound_message_queue(target_peer_id, status);
```

When a peer comes online:
1. Connection manager detects new connection
2. Check outbound_message_queue for pending messages to that peer
3. Deliver in FIFO order
4. Mark as delivered or expired

---

### 3.7 Rate Limiting & Abuse Prevention

```rust
// src-tauri/src/engine/p2p/rate_limiter.rs

pub struct PeerRateLimiter {
    // Per-peer rate limits
    pub max_messages_per_minute: u32,       // Default: 60
    pub max_bytes_per_minute: u64,          // Default: 1 MB
    pub max_concurrent_requests: u32,       // Default: 10

    // Global limits
    pub max_total_connections: u32,         // Default: 50
    pub max_inbound_per_minute: u32,        // Default: 20

    // Reputation tracking
    pub peer_scores: HashMap<PeerId, f64>, // -100 to +100

    // Data query-specific limits
    pub max_data_queries_per_minute: u32,   // Default: 30
    pub max_data_response_bytes: u64,       // Default: 5 MB per response
}

// Peers that exceed limits get temporarily blocked
// Repeated violations reduce reputation score
// Peers with score < -50 are auto-disconnected
```

---

### 3.8 Authorization Tokens

```rust
// src-tauri/src/engine/p2p/auth.rs

pub struct CapabilityToken {
    pub issuer: String,           // PeerId of the data owner
    pub subject: String,          // PeerId of the authorized peer
    pub resource_type: ResourceType,
    pub resource_id: String,
    pub permissions: Vec<String>, // ["read", "execute", "query"]
    pub data_scope: Option<DataScopeGrant>,  // NEW: data-specific grant
    pub issued_at: u64,
    pub expires_at: u64,
    pub signature: Vec<u8>,       // Issuer's Ed25519 signature
}

/// Grants specific data access within a token. Subset of the full policy.
pub struct DataScopeGrant {
    pub tables_allowed: Vec<String>,   // Empty = all tables in policy
    pub max_rows_per_query: u32,       // Hard cap for this grant
}

// Tokens are passed with AgentEnvelope and DataQueryRequest
// Receiving peer verifies:
//   1. Signature is valid for issuer's public key
//   2. Token is not expired
//   3. Requested action matches token permissions
//   4. Subject PeerId matches the requester
//   5. (For data queries) DataScopeGrant covers the requested table
```

---

### 3.9 Data Exposure Layer

This section introduces per-exposure policies that control what data from database connectors, built-in SQLite, and vector knowledge bases can be queried by peers in real time.

#### 3.9.1 Design Principles

1. **The data owner always executes the query.** The peer sends a query request; the owner's instance runs it against the real connector, applies the policy, and returns the filtered result. The peer never touches credentials or raw data.
2. **Policies are per-exposure, not global.** Each `ExposedResource` of type `connector` or `knowledge` optionally carries a `DataExposurePolicy`. No workspace-level defaults for now.
3. **All connector types supported from day one.** External connectors (Postgres via Supabase, Redis via Upstash, Neon, PlanetScale, etc.), built-in SQLite, and vector knowledge bases are all supported. The existing `db_query.rs` REST execution engine handles external connectors; built-in SQLite and vector KBs use their respective local engines.
4. **Real-time, not snapshot.** Peer queries execute live against the data source. This means the data owner's instance must be online.

#### 3.9.2 Data Model: DataExposurePolicy

```rust
// src-tauri/src/db/models/data_exposure.rs

/// Per-exposure policy defining what data a peer can access from a credential.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DataExposurePolicy {
    pub id: String,                          // UUID
    pub exposure_id: String,                 // FK → exposed_resources.id
    pub credential_id: String,              // FK → persona_credentials.id (the data source)
    pub source_type: DataSourceType,        // connector | vector_kb | builtin_sqlite

    // Layer 1: Scope (what's visible)
    pub tables_allowed: Vec<String>,        // Empty = all tables
    pub tables_denied: Vec<String>,         // Overrides allowed (explicit block)
    pub kb_ids_allowed: Vec<String>,        // For vector_kb source_type

    // Layer 2: Column rules (per-table field control)
    pub column_rules: Vec<ColumnRule>,

    // Layer 3: Row filters (predicate per table)
    pub row_filters: Vec<RowFilter>,

    // Transfer limits
    pub max_rows_per_query: u32,            // Default: 100
    pub max_response_bytes: u64,            // Default: 2 MB
    pub rate_limit_per_minute: u32,         // Default: 10 queries/min

    // Audit
    pub audit_enabled: bool,                // Log every query to audit_log table
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DataSourceType {
    Connector,      // External: Supabase, Neon, Upstash, PlanetScale, etc.
    VectorKb,       // Built-in vector knowledge base (sqlite-vec)
    BuiltinSqlite,  // Built-in SQLite user database
}

/// Controls what happens to a specific column when query results pass through.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ColumnRule {
    pub table: String,              // Table name (or "*" for all tables)
    pub column: String,             // Column name (or "*" for default rule)
    pub action: ColumnAction,
    pub action_config: Option<String>,  // For truncate: max_len; for generalize: strategy
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ColumnAction {
    Allow,                   // Pass through unchanged
    Deny,                    // Column hidden from results entirely
    Redact,                  // Replace with "***"
    Hash,                    // SHA-256 (preserves uniqueness for joins)
    Truncate,                // First N characters only (config: max_len)
    Generalize,              // Reduce precision (date→month, zip→region, config: strategy)
}

/// A WHERE predicate applied server-side before returning rows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RowFilter {
    pub table: String,
    pub where_clause: String,       // SQL WHERE fragment, e.g. "status = 'active'"
}

/// Result of running sensitivity auto-detection on a table's columns.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SensitivityHint {
    pub table: String,
    pub column: String,
    pub sensitivity: SensitivityLevel,
    pub reason: String,             // "Column name matches PII pattern: email"
    pub suggested_action: ColumnAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SensitivityLevel {
    Public,         // Safe to expose
    Internal,       // Not secret, but not public
    Sensitive,      // PII, financial, auth tokens
    Critical,       // Passwords, private keys — should never be exposed
}
```

#### 3.9.3 Database Schema

```sql
-- 3001: Data exposure policies
CREATE TABLE IF NOT EXISTS data_exposure_policies (
    id TEXT PRIMARY KEY,
    exposure_id TEXT NOT NULL REFERENCES exposed_resources(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'connector',  -- connector | vector_kb | builtin_sqlite
    tables_allowed TEXT NOT NULL DEFAULT '[]',       -- JSON array
    tables_denied TEXT NOT NULL DEFAULT '[]',        -- JSON array
    kb_ids_allowed TEXT NOT NULL DEFAULT '[]',       -- JSON array
    column_rules TEXT NOT NULL DEFAULT '[]',         -- JSON array of ColumnRule
    row_filters TEXT NOT NULL DEFAULT '[]',          -- JSON array of RowFilter
    max_rows_per_query INTEGER NOT NULL DEFAULT 100,
    max_response_bytes INTEGER NOT NULL DEFAULT 2097152,  -- 2 MB
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,
    audit_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_data_policy_exposure ON data_exposure_policies(exposure_id);
CREATE INDEX IF NOT EXISTS idx_data_policy_credential ON data_exposure_policies(credential_id);

-- 3002: Data query audit log
CREATE TABLE IF NOT EXISTS data_query_audit (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    requester_peer_id TEXT NOT NULL,
    query_type TEXT NOT NULL,       -- table_query | vector_search | schema_introspect
    query_payload TEXT NOT NULL,    -- JSON of the request (no secrets)
    rows_returned INTEGER NOT NULL DEFAULT 0,
    bytes_returned INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,           -- ok | denied | error | rate_limited
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_data_audit_policy ON data_query_audit(policy_id);
CREATE INDEX IF NOT EXISTS idx_data_audit_peer ON data_query_audit(requester_peer_id);
CREATE INDEX IF NOT EXISTS idx_data_audit_time ON data_query_audit(created_at);
```

#### 3.9.4 P2P Data Query Protocol

New protocol messages for data exchange, routed through the libp2p `data_query` request-response behaviour:

```rust
// src-tauri/src/engine/p2p/protocols/data_query.rs

/// Request from a peer to query data from an exposed credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataQueryRequest {
    pub request_id: String,
    pub exposure_id: String,           // Which exposed resource
    pub token: CapabilityToken,        // Auth token with data_scope
    pub query: DataQuery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataQuery {
    /// Introspect: "What tables/KBs can I see through this exposure?"
    SchemaIntrospect,

    /// Query rows from a table (SQL-backed connectors + built-in SQLite)
    TableQuery {
        table: String,
        columns: Vec<String>,          // Empty = all allowed columns
        where_clause: Option<String>,  // Additional peer-side filter (ANDed with policy row_filter)
        order_by: Option<String>,
        limit: u32,                    // Capped by policy max_rows_per_query
        offset: u32,
    },

    /// Semantic search against a vector knowledge base
    VectorSearch {
        kb_id: String,
        query_text: String,
        top_k: u32,                    // Capped by policy max_rows_per_query
    },
}

/// Response from the data owner back to the requesting peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataQueryResponse {
    pub request_id: String,
    pub status: DataQueryStatus,

    // Schema info (always present on success)
    pub schema: Vec<ColumnDef>,

    // Row data (already filtered + redacted by policy)
    pub rows: Vec<Vec<serde_json::Value>>,

    // For vector search results
    pub vector_results: Vec<VectorSearchResultEntry>,

    // Metadata
    pub total_rows_available: Option<u64>,  // Estimated total (for pagination UI)
    pub has_more: bool,
    pub transfer_bytes: u64,
    pub query_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,            // "text", "integer", "real", "blob", etc.
    pub is_redacted: bool,            // True if policy applied redaction to this column
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorSearchResultEntry {
    pub chunk_id: String,
    pub document_title: String,
    pub content: String,              // Already filtered by policy
    pub score: f64,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataQueryStatus {
    Ok,
    AccessDenied,          // Token invalid or insufficient scope
    TableNotAllowed,       // Table not in policy scope
    RateLimited,           // Exceeded rate limit
    SourceUnavailable,     // Connector unreachable
    PolicyViolation,       // Query violates policy constraints
    Error(String),         // Unexpected error (sanitized)
}
```

#### 3.9.5 Query Execution Pipeline (Data Owner Side)

When a `DataQueryRequest` arrives, the data owner runs it through a 6-stage pipeline:

```
1. AUTH:     Verify CapabilityToken (signature, expiry, subject, permissions)
2. POLICY:   Load DataExposurePolicy for this exposure_id
3. SCOPE:    Validate table/KB is in allowed scope, not in denied list
4. REWRITE:  Inject policy row_filters into query WHERE clause (AND-merge)
             Cap LIMIT to min(requested, policy.max_rows_per_query)
5. EXECUTE:  Run query against actual data source:
             - External connectors: via existing db_query.rs REST engine
             - Built-in SQLite: via user_db pool
             - Vector KB: via kb_search() / kb_list_documents()
6. FILTER:   Apply column rules to result rows:
             - Deny: strip column from response
             - Redact: replace with "***"
             - Hash: replace with hex(SHA-256(value))
             - Truncate: value[..N]
             - Generalize: apply strategy (date→YYYY-MM, zip→first 3 digits)
7. AUDIT:    Write to data_query_audit table
8. RESPOND:  Serialize and return DataQueryResponse
```

```rust
// src-tauri/src/engine/data_exposure.rs

pub struct DataExposureEngine {
    db: DbPool,
    user_db: UserDbPool,
}

impl DataExposureEngine {
    /// Execute a data query request from a remote peer.
    pub async fn handle_query(
        &self,
        request: DataQueryRequest,
        local_identity: &PeerIdentity,
    ) -> DataQueryResponse {
        let timer = std::time::Instant::now();

        // 1. Verify token
        if let Err(e) = self.verify_token(&request.token, &request.exposure_id) {
            return DataQueryResponse::denied(request.request_id, e);
        }

        // 2. Load policy
        let policy = match self.load_policy(&request.exposure_id) {
            Ok(p) => p,
            Err(e) => return DataQueryResponse::error(request.request_id, e),
        };

        // 3. Rate limit check
        if self.is_rate_limited(&policy, &request.token.subject) {
            return DataQueryResponse::rate_limited(request.request_id);
        }

        // 4-6. Execute + filter
        let result = match &request.query {
            DataQuery::SchemaIntrospect => self.handle_introspect(&policy).await,
            DataQuery::TableQuery { .. } => self.handle_table_query(&policy, &request.query).await,
            DataQuery::VectorSearch { .. } => self.handle_vector_search(&policy, &request.query).await,
        };

        // 7. Audit
        let duration_ms = timer.elapsed().as_millis() as u64;
        self.write_audit(&policy, &request, &result, duration_ms);

        result
    }

    /// Apply column rules to a row of data.
    fn apply_column_filters(
        &self,
        columns: &[String],
        row: Vec<serde_json::Value>,
        rules: &[ColumnRule],
        table: &str,
    ) -> (Vec<String>, Vec<serde_json::Value>) {
        // Build effective rule map: most specific wins (table+column > table+* > *+*)
        // Filter columns and transform values according to actions
        // ...
    }
}
```

#### 3.9.6 Sensitivity Auto-Detection

Pattern-matching heuristic run when creating a policy to suggest column rules. No AI required.

```rust
// src-tauri/src/engine/sensitivity.rs

/// Analyze table columns and suggest sensitivity classifications.
pub fn detect_sensitivity(
    table_name: &str,
    columns: &[(String, String)],  // (name, data_type) pairs
) -> Vec<SensitivityHint> {
    let mut hints = Vec::new();

    for (col_name, _col_type) in columns {
        let lower = col_name.to_lowercase();

        // PII patterns
        if matches_any(&lower, &["email", "e_mail", "mail_address"]) {
            hints.push(hint(table_name, col_name, Sensitive, Redact, "Email address pattern"));
        } else if matches_any(&lower, &["phone", "mobile", "tel", "fax"]) {
            hints.push(hint(table_name, col_name, Sensitive, Redact, "Phone number pattern"));
        } else if matches_any(&lower, &["ssn", "social_security", "national_id", "tax_id"]) {
            hints.push(hint(table_name, col_name, Critical, Deny, "Government ID pattern"));
        } else if matches_any(&lower, &["ip_address", "ip_addr", "remote_addr", "client_ip"]) {
            hints.push(hint(table_name, col_name, Sensitive, Hash, "IP address pattern"));
        }

        // Auth/secret patterns
        else if matches_any(&lower, &["password", "passwd", "pwd", "secret", "token",
                                       "api_key", "apikey", "private_key", "auth"]) {
            hints.push(hint(table_name, col_name, Critical, Deny, "Credential/secret pattern"));
        }

        // Financial patterns
        else if matches_any(&lower, &["card", "cvv", "cvc", "routing_number", "account_number",
                                       "iban", "swift", "bank"]) {
            hints.push(hint(table_name, col_name, Critical, Deny, "Financial data pattern"));
        } else if matches_any(&lower, &["cost", "cost_price", "margin", "profit", "salary",
                                          "wage", "compensation"]) {
            hints.push(hint(table_name, col_name, Sensitive, Redact, "Sensitive financial metric"));
        }

        // Address patterns
        else if matches_any(&lower, &["address", "street", "zip", "postal", "city", "state"]) {
            hints.push(hint(table_name, col_name, Internal, Generalize, "Physical address pattern"));
        }

        // Date of birth
        else if matches_any(&lower, &["dob", "date_of_birth", "birthdate", "birthday"]) {
            hints.push(hint(table_name, col_name, Sensitive, Generalize, "Date of birth pattern"));
        }

        // Default: public
        else {
            hints.push(hint(table_name, col_name, Public, Allow, "No sensitive pattern detected"));
        }
    }

    hints
}
```

#### 3.9.7 Integration with Existing Exposure System

The `ExposedResource` model gains an optional link to a `DataExposurePolicy`:

```
ExposedResource (existing, unchanged)
  ├── resource_type: "persona" | "template" | ...  → works as before
  └── resource_type: "connector" | "knowledge"
       └── If exposure has a DataExposurePolicy → data queries are enabled
           If no policy → only metadata is visible (no query access)
```

The manifest sync protocol is extended so peer manifests advertise which exposures have data query support:

```rust
// Extension to PeerManifestEntry (existing)
pub struct PeerManifestEntry {
    // ... existing fields ...
    pub data_queryable: bool,           // NEW: true if exposure has a policy
    pub available_tables: Vec<String>,  // NEW: summary for peer browsing UI
    pub available_kbs: Vec<String>,     // NEW: KB names for vector search
}
```

#### 3.9.8 Tauri Commands (Data Exposure)

```rust
// src-tauri/src/commands/network/data_exposure.rs

// Policy CRUD
#[tauri::command] create_data_exposure_policy(input: CreatePolicyInput) -> DataExposurePolicy
#[tauri::command] get_data_exposure_policy(policy_id: String) -> DataExposurePolicy
#[tauri::command] get_policy_for_exposure(exposure_id: String) -> Option<DataExposurePolicy>
#[tauri::command] update_data_exposure_policy(policy_id: String, input: UpdatePolicyInput) -> DataExposurePolicy
#[tauri::command] delete_data_exposure_policy(policy_id: String)

// Sensitivity detection
#[tauri::command] detect_column_sensitivity(credential_id: String) -> Vec<SensitivityHint>

// Audit
#[tauri::command] list_data_query_audit(policy_id: String, limit: u32, offset: u32) -> Vec<DataQueryAuditEntry>
#[tauri::command] get_data_query_stats(policy_id: String) -> DataQueryStats

// Remote query (peer side — issues query to a connected peer)
#[tauri::command] query_remote_data(peer_id: String, exposure_id: String, query: DataQuery) -> DataQueryResponse
```

#### 3.9.9 Frontend: Data Exposure UI

```
src/features/sharing/components/data_exposure/
├── DataExposurePolicyEditor.tsx      # Main policy creation/editing form
│   ├── ScopeSection.tsx              # Tables allowed/denied picker
│   ├── ColumnRulesSection.tsx        # Per-column action grid
│   ├── RowFiltersSection.tsx         # WHERE clause builder
│   └── TransferLimitsSection.tsx     # Rate limits, max rows, max bytes
├── SensitivityReview.tsx             # Auto-detection results with Apply/Reject
├── DataQueryAuditPanel.tsx           # Audit log viewer for policy owner
├── RemoteDataBrowser.tsx             # Peer-side: browse exposed tables/KBs
├── RemoteDataTable.tsx               # Peer-side: query results table with pagination
├── RemoteVectorSearch.tsx            # Peer-side: semantic search against exposed KB
└── DataExposureBadge.tsx             # Badge on ExposureManager showing data policy status
```

**UX Flow — Data Owner (exposing data):**

```
1. User creates an ExposedResource with resource_type: "connector"
2. If connector is a database type, the UI shows "Configure Data Access" button
3. Opens DataExposurePolicyEditor:
   a. SCOPE: Select which tables to expose (fetched via existing introspection)
   b. SENSITIVITY: Auto-detect button runs sensitivity scan, shows SensitivityReview
      - User sees "⚠ users.email → PII (email pattern)" with suggested action
      - Apply Suggestions → column rules auto-populated
   c. COLUMN RULES: Fine-tune per-column actions (allow/deny/redact/hash/truncate/generalize)
   d. ROW FILTERS: Add WHERE clauses (e.g. "is_active = 1")
   e. LIMITS: Set max rows, rate limit, response size
4. Save → policy created, exposure now shows "Data Queryable" badge
5. Manifest re-syncs automatically → peers see available tables in their UI
```

**UX Flow — Peer (querying remote data):**

```
1. Peer opens PeerDetailDrawer → sees exposed resource with "Data" badge
2. Clicks "Browse Data" → opens RemoteDataBrowser
3. Sees available tables (from manifest summary)
4. Selects a table → sends DataQueryRequest → gets DataQueryResponse
5. Results shown in RemoteDataTable (redacted columns visually marked)
6. For vector KBs: RemoteVectorSearch with query input
```

#### 3.9.10 Proxy Execution Model (Agent-Initiated Data Queries)

Agents can also query exposed data programmatically during execution. When a persona needs data from a peer's exposed connector:

```
Agent A (on Peer X) is processing a task that requires CRM data.
Agent A's connector_strategy checks:
  1. Local credentials? → No CRM connector locally
  2. Connected peers' manifests? → Peer Y exposes "crm-read" with data policy
  3. Construct DataQueryRequest targeting Peer Y's exposure
  4. Peer Y's DataExposureEngine runs the query, applies policy
  5. Agent A receives filtered data and continues execution
```

This reuses the `connector_strategy.rs` extension from the original Phase 2 plan, now backed by real data policies.

---

### 3.10 Phase 3 Deliverables Checklist

| Deliverable | Module | Key Dependency |
|-------------|--------|---------------|
| **Internet P2P** | | |
| libp2p swarm | `engine/p2p/swarm.rs` | `libp2p` |
| NAT traversal (AutoNAT + DCUtR) | `engine/p2p/nat.rs` | `libp2p`, `igd-next` |
| DHT discovery | `engine/p2p/discovery.rs` | `libp2p` (kad) |
| Circuit Relay v2 | `engine/p2p/relay.rs` | `libp2p` (relay) |
| Bootstrap node binary | feature-flagged | `libp2p` |
| Community relay settings | `engine/p2p/relay.rs` | — |
| Capability routing via DHT | `engine/p2p/discovery.rs` | `libp2p` (kad) |
| Noise protocol auth | built into libp2p | `libp2p` (noise) |
| Capability tokens (with DataScopeGrant) | `engine/p2p/auth.rs` | `ed25519-dalek` |
| Offline message queue | `db/repos/resources/message_queue.rs` | — |
| Rate limiter + reputation | `engine/p2p/rate_limiter.rs` | — |
| Manifest caching | `db/repos/resources/cached_manifests.rs` | — |
| Network settings UI (expanded) | `features/network/NetworkSettings.tsx` | — |
| Relay dashboard UI | `features/network/RelayDashboard.tsx` | — |
| **Data Exposure** | | |
| DataExposurePolicy model + DB schema | `db/models/data_exposure.rs`, `db/migrations.rs` | — |
| Data exposure repo (CRUD) | `db/repos/resources/data_exposure.rs` | — |
| Data query protocol (P2P codec) | `engine/p2p/protocols/data_query.rs` | `rmp-serde` / `libp2p` |
| DataExposureEngine (query pipeline) | `engine/data_exposure.rs` | `db_query.rs`, `kb_ingest.rs` |
| Column filter engine | in `data_exposure.rs` | — |
| Sensitivity auto-detection | `engine/sensitivity.rs` | regex patterns |
| Data exposure Tauri commands (10+) | `commands/network/data_exposure.rs` | — |
| Data query audit log + stats | `db/repos/resources/data_audit.rs` | — |
| Policy editor UI | `features/sharing/components/data_exposure/` (7 components) | — |
| Remote data browser UI | `features/sharing/components/data_exposure/RemoteDataBrowser.tsx` | — |
| Remote vector search UI | `features/sharing/components/data_exposure/RemoteVectorSearch.tsx` | — |
| Proxy execution (agent-initiated queries) | extends `engine/connector_strategy.rs` | — |

### 3.11 Phase 3 Success Criteria

**Internet P2P:**
- [ ] Two instances on different networks (behind NAT) connect successfully (>90% success rate)
- [ ] DHT-based peer discovery works across the internet
- [ ] Hole-punching works for cone NAT peers
- [ ] Relay fallback works when direct connection fails
- [ ] Auto-relay: nodes with public addresses relay for NAT-blocked peers
- [ ] Volunteer relay mode works with bandwidth caps
- [ ] Capability discovery via DHT returns relevant peers
- [ ] Offline message queuing delivers when peer comes online
- [ ] Rate limiting prevents abuse
- [ ] Capability tokens enforce access control
- [ ] Bootstrap node binary is deployable as standalone
- [ ] Network status UI shows NAT type, relay status, connected peers

**Data Exposure:**
- [ ] Admin can create a data exposure policy for any connector type (external + built-in)
- [ ] Sensitivity auto-detection correctly flags PII/financial/auth columns
- [ ] Column rules work: allow, deny, redact, hash, truncate, generalize
- [ ] Row filters restrict what rows are returned
- [ ] Transfer limits (max rows, rate limiting) are enforced
- [ ] Peer can browse exposed tables via RemoteDataBrowser
- [ ] Peer can run semantic search against exposed vector KB
- [ ] Schema introspect shows only policy-allowed tables/columns
- [ ] Redacted columns are visually marked in the remote data table
- [ ] Audit log captures all data queries with requester, duration, rows returned
- [ ] Agent-initiated data queries work via connector_strategy proxy execution
- [ ] All Phase 1 and Phase 2 features continue to work

---

## Phase 4: Dynamic UI & Full Protocol

> **Status: NOT STARTED** — Depends on Phase 3 completion.

**Goal:** LLM-generated UI for browsing remote peer data, and a complete multi-turn agent negotiation protocol.

**Duration estimate:** 8-12 weeks
**Networking required:** Full P2P (Phase 3 complete)
**Risk level:** Medium-High

### 4.1 Schema-Driven UI Composition

#### 4.1.1 Design Philosophy

**Not freeform code generation.** Instead: a library of ~25-30 pre-built UI primitives that an LLM selects and composes based on data schema. Think "dynamic dashboard builder," not "AI web designer."

#### 4.1.2 Layout Descriptor Schema

```typescript
// src/lib/types/layoutDescriptor.ts

interface LayoutDescriptor {
  version: 1;
  title: string;
  description?: string;
  root: LayoutNode;
  bindings: DataBinding[];          // Maps data fields to UI slots
  theme?: 'auto' | 'light' | 'dark';
  cached_for_schema_hash?: string;  // Cache key
}

// Recursive layout tree
type LayoutNode =
  | StackNode
  | RowNode
  | CardNode
  | DataTableNode
  | ChartNode
  | TimelineNode
  | HeaderNode
  | TextBlockNode
  | MetricCardNode
  | FormNode
  | ChatThreadNode
  | CodeBlockNode
  | ImageNode
  | EmptyStateNode
  | TabsNode
  | AccordionNode
  | ListNode
  | KeyValueNode
  | ProgressNode
  | BadgeGroupNode
  | SplitPaneNode
  | MarkdownNode
  | JsonViewerNode
  | StatusIndicatorNode
  | ActionButtonNode
  | FilterBarNode;

// Example primitives:
interface StackNode {
  type: 'stack';
  direction: 'vertical' | 'horizontal';
  gap?: 'sm' | 'md' | 'lg';
  children: LayoutNode[];
}

interface DataTableNode {
  type: 'data-table';
  source: string;              // DataBinding reference
  columns: {
    field: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'badge' | 'link';
    sortable?: boolean;
    width?: string;
  }[];
  pagination?: boolean;
  searchable?: boolean;
}

interface ChartNode {
  type: 'chart';
  chart_type: 'line' | 'bar' | 'area' | 'pie' | 'scatter';
  source: string;
  x_axis: string;             // Field name for X
  y_axis: string[];           // Field names for Y series
  title?: string;
}

interface MetricCardNode {
  type: 'metric-card';
  label: string;
  value_field: string;        // DataBinding reference
  format?: 'number' | 'currency' | 'percentage' | 'duration';
  trend_field?: string;       // For up/down indicator
  icon?: string;              // lucide icon name
}

interface FormNode {
  type: 'form';
  fields: {
    field: string;
    label: string;
    input_type: 'text' | 'number' | 'select' | 'toggle' | 'textarea';
    options?: string[];       // For select
    required?: boolean;
    placeholder?: string;
  }[];
  submit_action: string;      // Action identifier
}

interface ChatThreadNode {
  type: 'chat-thread';
  source: string;
  message_field: string;
  sender_field: string;
  timestamp_field: string;
}

// ... (similar definitions for all ~25 primitives)

interface DataBinding {
  id: string;
  source_type: 'remote_resource' | 'agent_response' | 'static';
  peer_id?: string;
  resource_type?: string;
  resource_id?: string;
  field_path?: string;        // JSONPath into the data
  transform?: 'none' | 'flatten' | 'group_by' | 'sort' | 'filter';
  transform_config?: Record<string, unknown>;
}
```

#### 4.1.3 Layout Renderer

**New component tree:**

```
src/features/dynamic-ui/
├── LayoutRenderer.tsx              # Root: takes LayoutDescriptor → renders tree
├── primitives/                     # Pre-built UI primitive components
│   ├── StackPrimitive.tsx
│   ├── RowPrimitive.tsx
│   ├── CardPrimitive.tsx
│   ├── DataTablePrimitive.tsx      # Uses @tanstack/react-virtual for performance
│   ├── ChartPrimitive.tsx          # Uses recharts
│   ├── TimelinePrimitive.tsx
│   ├── HeaderPrimitive.tsx
│   ├── TextBlockPrimitive.tsx
│   ├── MetricCardPrimitive.tsx
│   ├── FormPrimitive.tsx
│   ├── ChatThreadPrimitive.tsx
│   ├── CodeBlockPrimitive.tsx
│   ├── ImagePrimitive.tsx
│   ├── EmptyStatePrimitive.tsx
│   ├── TabsPrimitive.tsx
│   ├── AccordionPrimitive.tsx
│   ├── ListPrimitive.tsx
│   ├── KeyValuePrimitive.tsx
│   ├── ProgressPrimitive.tsx
│   ├── BadgeGroupPrimitive.tsx
│   ├── SplitPanePrimitive.tsx
│   ├── MarkdownPrimitive.tsx
│   ├── JsonViewerPrimitive.tsx
│   ├── StatusIndicatorPrimitive.tsx
│   ├── ActionButtonPrimitive.tsx
│   └── FilterBarPrimitive.tsx
├── DataBindingResolver.tsx         # Resolves DataBinding → actual data
├── LayoutSandbox.tsx               # Security sandbox wrapper
├── LayoutCache.ts                  # Cache layouts by schema hash
└── LayoutGenerator.ts              # LLM layout generation service
```

**Rendering flow:**

```
1. User clicks on a remote peer's resource
2. Fetch resource schema + sample data from peer
3. Check layout cache (keyed by schema hash)
4. If cache miss:
   a. Send schema + sample to LLM (local or API)
   b. LLM returns LayoutDescriptor JSON
   c. Validate descriptor (no unknown node types, bindings valid)
   d. Cache result
5. LayoutRenderer recursively renders the descriptor tree
6. DataBindingResolver fetches actual data and injects into components
7. User sees a functional, interactive view of the remote data
```

#### 4.1.4 LLM Layout Generation

```typescript
// src/features/dynamic-ui/LayoutGenerator.ts

export async function generateLayout(
  schema: ResourceSchema,
  sampleData: unknown,
  context: { resourceType: string; peerName: string }
): Promise<LayoutDescriptor> {

  const prompt = `You are a UI layout generator. Given a data schema and sample data,
produce a LayoutDescriptor JSON that best presents this data.

Available primitive types: stack, row, card, data-table, chart, timeline,
header, text-block, metric-card, form, chat-thread, code-block, image,
empty-state, tabs, accordion, list, key-value, progress, badge-group,
split-pane, markdown, json-viewer, status-indicator, action-button, filter-bar.

Rules:
- Use the simplest layout that effectively presents the data
- Tables for lists of items with >3 fields
- Metric cards for single numeric values
- Charts when there are time-series or categorical numeric data
- Key-value for objects with <8 fields
- Always include a header with the resource name
- Maximum nesting depth: 4 levels
- Return ONLY valid JSON matching the LayoutDescriptor schema

Resource type: ${context.resourceType}
Peer: ${context.peerName}

Schema:
${JSON.stringify(schema, null, 2)}

Sample data (first 3 records):
${JSON.stringify(sampleData, null, 2)}`;

  // Use existing execution engine with layout-generation persona
  const result = await invokeLayoutLLM(prompt);
  const descriptor = JSON.parse(result) as LayoutDescriptor;

  // Validate: ensure all node types are known, bindings reference real fields
  validateDescriptor(descriptor, schema);

  return descriptor;
}
```

#### 4.1.5 Security Sandbox

The LayoutDescriptor is data, not code. Security model:

- **No arbitrary code execution:** LayoutDescriptor is a JSON tree of known node types. The renderer maps type strings to pre-built React components. Unknown types are rejected.
- **No script injection:** All text content is rendered via React (auto-escaped). Markdown is sanitized via existing `dompurify` dependency.
- **No network requests:** Primitives only display data provided through DataBindingResolver. They cannot make their own network calls.
- **Action sandboxing:** `ActionButtonNode` actions are mapped to a whitelist of allowed operations (request proxy execution, fork resource, send message). No arbitrary command execution.
- **Resource limits:** Maximum descriptor size (100KB), maximum nesting depth (6), maximum number of nodes (200).

---

### 4.2 Full Multi-Turn Agent Negotiation Protocol

#### 4.2.1 Extended Agent Protocol

The Phase 2 `AgentEnvelope` is extended for rich multi-turn conversations:

```rust
// src-tauri/src/engine/agent_protocol.rs (extended)

pub struct AgentEnvelope {
    // --- From Phase 2 (unchanged) ---
    pub from_peer: String,
    pub from_agent: String,
    pub to_peer: String,
    pub to_agent: Option<String>,
    pub intent: MessageIntent,
    pub capability_required: Option<String>,
    pub payload: serde_json::Value,
    pub schema_version: String,
    pub conversation_id: String,
    pub sequence: u32,
    pub ttl: u8,
    pub timeout_ms: Option<u64>,
    pub signature: Vec<u8>,
    pub timestamp: u64,

    // --- New in Phase 4 ---
    pub negotiation: Option<NegotiationBlock>,
    pub streaming: Option<StreamingBlock>,
    pub delegation: Option<DelegationBlock>,
    pub context: Option<ConversationContext>,
}

pub struct NegotiationBlock {
    pub stage: NegotiationStage,
    pub proposed_terms: Option<serde_json::Value>,  // What the sender proposes
    pub counter_terms: Option<serde_json::Value>,   // Counter-proposal
    pub constraints: Vec<Constraint>,               // Hard limits
}

pub enum NegotiationStage {
    Propose,       // Initial proposal
    CounterOffer,  // Peer modifies terms
    Accept,        // Agreement reached
    Reject,        // No deal
}

pub struct Constraint {
    pub constraint_type: String,    // "max_tokens", "deadline", "cost_limit"
    pub value: serde_json::Value,
}

pub struct StreamingBlock {
    pub stream_id: String,
    pub chunk_index: u32,
    pub is_final: bool,
    pub total_chunks: Option<u32>,  // If known in advance
}

pub struct DelegationBlock {
    pub delegated_to_peer: String,
    pub delegated_to_agent: Option<String>,
    pub reason: String,
    pub original_conversation_id: String,
    pub delegation_chain: Vec<String>,  // Track delegation path to prevent loops
}

pub struct ConversationContext {
    pub summary_so_far: Option<String>,     // LLM-generated summary for long conversations
    pub shared_state: Option<serde_json::Value>,  // Shared mutable state between turns
    pub turn_count: u32,
    pub started_at: u64,
}
```

#### 4.2.2 Conversation State Machine

```
                    ┌───────────┐
                    │  Initiate │
                    └─────┬─────┘
                          │ Request
                          ▼
                    ┌───────────┐
              ┌────>│ Negotiate │<────┐
              │     └─────┬─────┘     │
              │           │           │
         CounterOffer     │      CounterOffer
              │           │ Accept    │
              │           ▼           │
              │     ┌───────────┐     │
              └─────│ Executing │─────┘
                    └─────┬─────┘
                          │
                ┌─────────┼─────────┐
                │         │         │
           Stream(N)  Response   Delegate
                │         │         │
                ▼         ▼         ▼
           ┌────────┐ ┌───────┐ ┌──────────┐
           │Streaming│ │Complete│ │Delegated │
           └────┬───┘ └───────┘ └─────┬────┘
                │                      │
           Stream(final)          (new conversation
                │                  with delegatee)
                ▼
           ┌───────┐
           │Complete│
           └───────┘

  At any point: Cancel → Cancelled
  At any point: Error → Failed
  Timeout exceeded: → TimedOut
```

#### 4.2.3 Conversation Manager

```rust
// src-tauri/src/engine/conversation_manager.rs

pub struct ConversationManager {
    active_conversations: HashMap<String, Conversation>,
    conversation_store: Arc<dyn ConversationRepository>,
}

pub struct Conversation {
    pub id: String,
    pub state: ConversationState,
    pub participants: Vec<Participant>,
    pub messages: Vec<AgentEnvelope>,
    pub started_at: u64,
    pub last_activity: u64,
    pub timeout_ms: u64,
    pub context: ConversationContext,
}

impl ConversationManager {
    pub async fn start_conversation(
        &mut self,
        target_peer: &str,
        target_agent: Option<&str>,
        capability: &str,
        initial_payload: Value,
    ) -> Result<String>; // Returns conversation_id

    pub async fn handle_inbound_message(
        &mut self,
        envelope: AgentEnvelope,
    ) -> Result<Option<AgentEnvelope>>; // Returns auto-response if applicable

    pub async fn send_response(
        &mut self,
        conversation_id: &str,
        payload: Value,
    ) -> Result<()>;

    pub async fn negotiate(
        &mut self,
        conversation_id: &str,
        terms: Value,
    ) -> Result<()>;

    pub async fn delegate(
        &mut self,
        conversation_id: &str,
        to_peer: &str,
        reason: &str,
    ) -> Result<String>; // Returns new conversation_id with delegatee

    pub async fn cancel_conversation(
        &mut self,
        conversation_id: &str,
        reason: &str,
    ) -> Result<()>;

    pub fn get_active_conversations(&self) -> Vec<ConversationSummary>;

    // Periodic cleanup
    pub async fn timeout_stale_conversations(&mut self);
}
```

#### 4.2.4 Capability-Based Routing

```rust
// src-tauri/src/engine/capability_router.rs

pub struct CapabilityRouter {
    local_capabilities: HashMap<String, Vec<String>>,     // cap → [persona_ids]
    peer_capabilities: HashMap<String, HashMap<String, Vec<String>>>,  // peer → cap → [agent_ids]
    dht_cache: HashMap<String, Vec<PeerId>>,              // cap → [peer_ids from DHT]
}

impl CapabilityRouter {
    /// Find the best agent for a capability, with preference:
    /// 1. Local agent
    /// 2. Connected peer's agent
    /// 3. DHT-discovered peer's agent
    pub async fn route(
        &self,
        capability: &str,
        preferences: RoutingPreferences,
    ) -> Result<RoutingDecision>;
}

pub struct RoutingPreferences {
    pub prefer_local: bool,           // Default: true
    pub max_hops: u8,                 // Default: 3
    pub latency_budget_ms: u64,       // Default: 30000
    pub trust_minimum: TrustLevel,    // Default: Manual
    pub exclude_peers: Vec<String>,   // Blacklist
}

pub enum RoutingDecision {
    Local { persona_id: String },
    Remote { peer_id: String, agent_id: String },
    Unavailable { reason: String },
}
```

---

### 4.3 Conversation UI

```
src/features/network/
├── ConversationList.tsx            # List of active/recent conversations
├── ConversationView.tsx            # Full conversation thread
├── ConversationMessage.tsx         # Individual message in thread
├── NegotiationPanel.tsx            # Visual negotiation flow
├── DelegationTracker.tsx           # Shows delegation chain
├── StreamingIndicator.tsx          # Progress for streaming responses
├── CapabilitySearch.tsx            # Search for agents by capability
└── ConversationInsights.tsx        # Analytics on conversation patterns
```

---

### 4.4 Phase 4 Deliverables Checklist

| Deliverable | Module | Key Dependency |
|-------------|--------|---------------|
| Layout descriptor schema | `lib/types/layoutDescriptor.ts` | — |
| 25 UI primitives | `features/dynamic-ui/primitives/*` | recharts, @tanstack/react-virtual |
| Layout renderer | `features/dynamic-ui/LayoutRenderer.tsx` | — |
| LLM layout generator | `features/dynamic-ui/LayoutGenerator.ts` | Execution engine (existing) |
| Layout cache | `features/dynamic-ui/LayoutCache.ts` | — |
| Security sandbox | `features/dynamic-ui/LayoutSandbox.tsx` | dompurify (existing) |
| Extended agent protocol | `engine/agent_protocol.rs` (extended) | — |
| Conversation manager | `engine/conversation_manager.rs` | — |
| Conversation state machine | in `conversation_manager.rs` | — |
| Capability router | `engine/capability_router.rs` | — |
| Multi-turn conversation UI | `features/network/Conversation*.tsx` | — |
| Negotiation flow UI | `features/network/NegotiationPanel.tsx` | — |
| Delegation tracking | `features/network/DelegationTracker.tsx` | — |

### 4.5 Phase 4 Success Criteria

- [ ] Viewing a remote peer's exposed persona auto-generates a functional UI
- [ ] Layout generation takes <3s (cache hit: instant)
- [ ] Generated layouts correctly display data tables, charts, metrics
- [ ] Multi-turn agent conversations work (request → negotiate → execute → respond)
- [ ] Streaming responses show progressive output
- [ ] Delegation routes requests to capable peers
- [ ] Capability-based routing finds agents across the network
- [ ] Conversation state persists across app restarts
- [ ] Security sandbox prevents malicious layout descriptors
- [ ] All Phase 1-3 features continue to work

---

## Cross-Cutting Concerns

### Database Migration Strategy

Each phase adds new tables. All migrations go through the existing `db/migrations.rs` system.

```
Migration ordering:
  Phase 1: 100x series (1001_local_identity, 1002_trusted_peers, 1003_exposed_resources, ...)
  Phase 2: 200x series (2001_protocol_sessions, 2002_remote_manifests_cache, ...)
  Phase 3: 300x series (3001_message_queue, 3002_capability_tokens, 3003_peer_reputation, ...)
  Phase 4: 400x series (4001_conversations, 4002_layout_cache, 4003_delegation_log, ...)
```

### TypeScript Binding Generation

All new Rust structs with `#[derive(ts_rs::TS)]` auto-generate TypeScript types into `src/lib/bindings/`. This ensures frontend and backend stay in sync.

### Observability

All network operations integrate with the existing tracing system:
- New span types: `NetworkDiscovery`, `PeerConnection`, `ProtocolMessage`, `AgentConversation`, `LayoutGeneration`
- Extend `TraceSpan` model with network-specific metadata
- Cross-instance trace correlation via `conversation_id`

### Testing Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| Unit (Rust) | `cargo test` | Identity, crypto, protocol serialization, manifest validation |
| Unit (TS) | `vitest` | Layout descriptor validation, UI primitives, data bindings |
| Integration | `vitest` + Tauri mock | Full IPC flows for export/import, manifest building |
| E2E (single instance) | `vitest` + Tauri driver | Bundle export/import flow, exposure UI |
| E2E (multi-instance) | Custom test harness | Two app instances on LAN, discovery, messaging |
| Network simulation | `libp2p-swarm-test` | NAT traversal, relay, DHT scenarios |

### Configuration

```rust
// All network-related settings
pub struct NetworkConfig {
    // Discovery
    pub mdns_enabled: bool,                     // Default: true
    pub dht_enabled: bool,                      // Default: true (Phase 3)
    pub bootstrap_nodes: Vec<String>,           // Default: hardcoded list

    // Transport
    pub listen_port: Option<u16>,               // Default: random
    pub max_connections: u32,                    // Default: 50

    // Relay
    pub relay_enabled: bool,                    // Default: true
    pub volunteer_relay: bool,                  // Default: false
    pub relay_bandwidth_limit: u64,             // Default: 50 MB/day

    // Security
    pub require_trusted_peers: bool,            // Default: true for execute/fork
    pub auto_trust_lan_peers: bool,             // Default: false

    // Performance
    pub manifest_sync_interval_secs: u64,       // Default: 60
    pub offline_queue_ttl_hours: u64,           // Default: 72
    pub layout_cache_max_entries: u32,          // Default: 100
}
```

---

## Risk Registry & Mitigations

| # | Risk | Severity | Phase | Mitigation |
|---|------|----------|-------|------------|
| R1 | NAT traversal failures (~15-25% of users) | High | 3 | Layered fallback: direct → hole-punch → user relay → bootstrap relay. Target: 95%+ success |
| R2 | Offline peers (desktop apps sleep/shutdown) | High | 2-4 | Manifest cache + offline message queue + TTL-based expiry |
| R3 | Protocol versioning breaks compatibility | Medium | 2-4 | Schema version in every message. MessagePack is backwards-compatible. Version negotiation in Hello handshake |
| R4 | Abuse/spam from untrusted peers | Medium | 3 | Rate limiting, reputation scores, trust circles, capability tokens |
| R5 | LLM cost for dynamic UI generation | Low | 4 | Cache layouts by schema hash. Local models (Ollama/llama.cpp) for simple schemas |
| R6 | Adoption chicken-and-egg (network useless with 1 user) | High | 1-4 | Phase 1 works solo (file sharing). Built-in demo templates. Value exists before network effects |
| R7 | Complexity explosion (3-4 major systems) | High | All | Strict phased delivery. Each phase independently valuable. No phase depends on all prior phases being perfect |
| R8 | Security vulnerabilities in P2P layer | High | 2-3 | Ed25519 signatures on all messages. Noise protocol for transport. Capability tokens for authorization. Sandbox for dynamic UI |
| R9 | Bootstrap node single point of failure | Medium | 3 | Multiple bootstrap nodes (2-3). Community-operated alternatives. App works on LAN without bootstrap |
| R10 | Layout descriptor injection/XSS | Medium | 4 | Strict schema validation. Known-type whitelist. DOMPurify for text. No code execution in descriptors |

---

## Dependency Map

```
Phase 1 [DONE]             Phase 2 [DONE]           Phase 3                Phase 4
──────────────             ──────────────           ────────               ────────
Ed25519 Identity ─────────> Hello/HelloAck Auth ───> Noise Auth (libp2p)   │
                           │                        │                      │
Exposure Manifest ────────> Manifest Sync ─────────> DHT Capability Ads ──> Capability Router
                           │                        │                      │
Bundle Format ─────────────> Bundle Transfer ───────> Bundle via P2P       │
                           │                        │                      │
Trusted Peers ─────────────> Connection Manager ───> Peer Reputation ──────> Conversation Mgr
                           │                        │                      │
                           mDNS Discovery           DHT Discovery          │
                           │                        │                      │
                           QUIC Transport (quinn) ─> libp2p Transport      │
                           │                        │                      │
                           Basic Agent Messages ───> Relay + Queue ────────> Full Protocol
                           │                        │                      │
                           (Proxy Exec deferred) ──> Proxy Execution       Dynamic UI
                                                    │                      │
                                                    Capability Tokens       Layout Renderer
                                                                           │
                                                                           LLM Generator
```

---

## Glossary

| Term | Definition |
|------|-----------|
| **PeerId** | Unique identifier derived from Ed25519 public key (base58-encoded multihash) |
| **Exposure Manifest** | Declaration of which local resources a user makes available to peers |
| **Bundle (.persona)** | Signed ZIP archive containing exported resources with provenance |
| **Proxy Execution** | Pattern where the credential owner executes an action on behalf of a requesting peer, never exposing the credential |
| **Capability** | A tagged skill an agent offers (e.g., "can-analyze-pdf", "has-github-access") |
| **Capability Routing** | Finding the right agent for a task based on capability tags rather than explicit addressing |
| **Circuit Relay** | libp2p protocol where a publicly-reachable peer relays traffic for NAT-blocked peers |
| **DCUtR** | Direct Connection Upgrade through Relay — hole-punching coordinated via relay |
| **Noise Protocol** | Cryptographic handshake framework used by libp2p for mutual authentication and encrypted channels |
| **Layout Descriptor** | JSON tree of UI primitive types that the frontend renders into a functional interface |
| **Bootstrap Node** | Lightweight server providing initial DHT entry point and last-resort relay |
| **Conversation** | Multi-turn exchange between agents, tracked by conversation_id |
| **Delegation** | When an agent forwards a request to another agent that has the needed capability |

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-03-11 | Initial | Full 4-phase plan created |
| 2026-03-12 | Claude | Phase 1 & Phase 2 marked COMPLETE. Added implementation notes for both phases detailing actual file structure, design decisions, key deviations from plan. Updated success criteria checklists. Phase 3 & 4 marked NOT STARTED. |

---

*This is a living document. Update it as implementation progresses and design decisions are made.*
