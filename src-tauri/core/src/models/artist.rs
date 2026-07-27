use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Canonical 2D / 3D classification for artist assets.
///
/// Replaces the prior stringly-typed `"2d"` / `"3d"` tokens. The DB column
/// still stores a string for backwards compatibility (see `ArtistAsset`),
/// but every code path that produces an asset_type now goes through this
/// enum so a typo at the boundary becomes a compile error.
///
/// Classification CONTRACT (see `commands/artist/mod.rs::scan_dir_recursive`
/// for the implementation):
///
///   1. The asset_type is derived ONLY from the immediate child of the
///      artist root that contains the file ("2d/..." or "3d/...").
///      Walking arbitrary ancestors looking for a "2d"/"3d" segment was
///      the prior behavior and produced silent miscategorization (a PNG
///      under `.../2d/sketches/refs/3d/` was tagged 3D).
///   2. If the file is not under either bucket directly under the root,
///      classification falls back to the extension table.
///   3. If both `2d` and `3d` segments appear in the path between the
///      file and the root, the tree is ambiguous — `scan_dir_recursive`
///      logs a warning and skips the file rather than picking one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AssetType {
    #[serde(rename = "2d")]
    TwoD,
    #[serde(rename = "3d")]
    ThreeD,
}

impl AssetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TwoD => "2d",
            Self::ThreeD => "3d",
        }
    }

    pub fn from_token(s: &str) -> Option<Self> {
        match s {
            "2d" => Some(Self::TwoD),
            "3d" => Some(Self::ThreeD),
            _ => None,
        }
    }
}

/// An asset tracked by the Artist plugin (2D image or 3D model).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArtistAsset {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    /// Canonical token: "2d" or "3d". Set via `AssetType::as_str` at every
    /// write site so this column never receives an unexpected value.
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
