use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Vault Discovery ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DetectedVault {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultConnectionResult {
    pub valid: bool,
    pub note_count: i64,
    pub vault_name: String,
    pub error: Option<String>,
}

// ── Vault Config ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FolderMapping {
    pub memories_folder: String,
    pub personas_folder: String,
    pub connectors_folder: String,
}

impl Default for FolderMapping {
    fn default() -> Self {
        Self {
            memories_folder: "memories".into(),
            personas_folder: "Personas".into(),
            connectors_folder: "Connectors".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVaultConfig {
    pub vault_path: String,
    pub vault_name: String,
    pub sync_memories: bool,
    pub sync_personas: bool,
    pub sync_connectors: bool,
    pub auto_sync: bool,
    pub folder_mapping: FolderMapping,
}

impl Default for ObsidianVaultConfig {
    fn default() -> Self {
        Self {
            vault_path: String::new(),
            vault_name: String::new(),
            sync_memories: true,
            sync_personas: true,
            sync_connectors: false,
            auto_sync: false,
            folder_mapping: FolderMapping::default(),
        }
    }
}

// ── Sync State ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub vault_file_path: String,
    pub content_hash: String,
    pub sync_direction: String,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogEntry {
    pub id: String,
    pub sync_type: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub vault_file_path: Option<String>,
    pub action: String,
    pub details: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub file_path: String,
    pub app_content: String,
    pub vault_content: String,
    pub app_hash: String,
    pub vault_hash: String,
    pub base_hash: String,
    pub detected_at: String,
}

// ── Sync Results ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PushSyncResult {
    pub created: i64,
    pub updated: i64,
    pub skipped: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PullSyncResult {
    pub created: i64,
    pub updated: i64,
    pub conflicts: Vec<SyncConflict>,
    pub errors: Vec<String>,
}

// ── Vault Browser ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<VaultTreeNode>,
    pub note_count: i64,
}
