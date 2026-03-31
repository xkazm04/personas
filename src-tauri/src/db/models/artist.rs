use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An asset tracked by the Artist plugin (2D image or 3D model).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArtistAsset {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    /// "2d" or "3d"
    pub asset_type: String,
    /// MIME type or extension-based category (e.g. "image/png", "model/gltf-binary")
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub thumbnail_path: Option<String>,
    pub tags: Option<String>,
    pub source: Option<String>,
    pub created_at: String,
}

/// Blender MCP connection status.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BlenderMcpStatus {
    pub installed: bool,
    pub blender_path: Option<String>,
    pub blender_version: Option<String>,
    pub mcp_installed: bool,
    pub mcp_running: bool,
    pub session_id: Option<String>,
}

/// A tag associated with an artist asset.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArtistTag {
    pub id: String,
    pub asset_id: String,
    pub tag: String,
    pub created_at: String,
}
