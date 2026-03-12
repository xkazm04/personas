use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Exposed Resources ───────────────────────────────────────────────────

/// A resource the user has chosen to expose to the P2P network.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExposedResource {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub fields_exposed: String,     // JSON array of field names
    pub access_level: String,       // "read" | "execute" | "fork"
    pub requires_auth: bool,
    pub tags: String,               // JSON array of capability tags
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateExposedResourceInput {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub fields_exposed: Vec<String>,
    pub access_level: String,
    pub requires_auth: bool,
    pub tags: Vec<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateExposedResourceInput {
    pub display_name: Option<String>,
    pub description: Option<Option<String>>,
    pub fields_exposed: Option<Vec<String>>,
    pub access_level: Option<String>,
    pub requires_auth: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub expires_at: Option<Option<String>>,
}

// ── Exposure Manifest ───────────────────────────────────────────────────

/// Full manifest of everything the local instance exposes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExposureManifest {
    pub version: u32,
    pub owner_peer_id: String,
    pub owner_display_name: String,
    pub updated_at: String,
    pub resources: Vec<ExposedResource>,
}

// ── Resource Provenance ─────────────────────────────────────────────────

/// Tracks where an imported resource originally came from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceProvenance {
    pub resource_type: String,
    pub resource_id: String,
    pub source_peer_id: String,
    pub source_display_name: Option<String>,
    pub imported_at: String,
    pub bundle_hash: Option<String>,
    pub signature_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateProvenanceInput {
    pub resource_type: String,
    pub resource_id: String,
    pub source_peer_id: String,
    pub source_display_name: Option<String>,
    pub bundle_hash: Option<String>,
    pub signature_verified: bool,
}
