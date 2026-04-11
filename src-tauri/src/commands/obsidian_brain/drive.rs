//! Google Drive sync module for Obsidian Brain.
//!
//! Uses the Google Drive REST API v3 to store vault snapshots in the user's
//! Google Drive, providing a free alternative to Obsidian's $4/month cloud sync.
//!
//! Architecture:
//! - Files are stored in `Personas/ObsidianSync/<vault-name>/` in the user's Drive
//! - A `.sync-manifest.json` tracks content hashes and sync timestamps
//! - Push/pull operations use content-hash comparison (same strategy as local sync)
//! - The Google access token comes from the Supabase OAuth `provider_token`
//!
//! Prerequisites:
//! - Supabase Google provider must be configured with `drive.file` scope
//! - User must authenticate via `login_with_google_drive` (separate re-auth with scope)

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

use super::markdown::compute_content_hash;

// ============================================================================
// Types
// ============================================================================

/// A single entry in the sync manifest, tracking the last-synced state of a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    /// Google Drive file ID
    pub drive_file_id: String,
    /// Content hash (SHA-256 of file contents) at time of last sync
    pub content_hash: String,
    /// ISO-8601 timestamp of last sync
    pub synced_at: String,
    /// File size in bytes
    pub size_bytes: u64,
}

/// The sync manifest stored as `.sync-manifest.json` in the Drive app folder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    /// Maps relative vault path → manifest entry
    pub files: HashMap<String, ManifestEntry>,
    /// ISO-8601 timestamp of last full sync
    pub last_full_sync: Option<String>,
    /// Vault name this manifest tracks
    pub vault_name: String,
}

/// Result of a Google Drive sync operation, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveSyncResult {
    pub uploaded: u32,
    pub downloaded: u32,
    pub deleted: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

/// Status of the Google Drive connection.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveStatus {
    pub connected: bool,
    pub email: Option<String>,
    pub storage_used_bytes: Option<u64>,
    pub storage_limit_bytes: Option<u64>,
    pub last_sync_at: Option<String>,
    pub manifest_file_count: u32,
}

/// Google Drive API file metadata (subset of the full response).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    name: String,
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileList {
    files: Vec<DriveFile>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveAbout {
    storage_quota: Option<StorageQuota>,
    user: Option<DriveUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageQuota {
    usage: Option<String>,
    limit: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveUser {
    email_address: Option<String>,
}

// ============================================================================
// Google Drive REST API client
// ============================================================================

const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";
const APP_FOLDER_NAME: &str = "Personas";
const SYNC_FOLDER_NAME: &str = "ObsidianSync";
const MANIFEST_FILE_NAME: &str = ".sync-manifest.json";

fn drive_err(e: impl std::fmt::Display) -> AppError {
    AppError::Cloud(format!("Google Drive: {e}"))
}

/// Build an authenticated reqwest client with the Google access token.
fn drive_client(token: &str) -> Result<reqwest::Client, AppError> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| drive_err(format!("invalid token header: {e}")))?,
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(drive_err)
}

// ── Folder operations ──────────────────────────────────────────────────

/// Find or create a folder by name under the given parent (or root).
async fn ensure_folder(
    client: &reqwest::Client,
    name: &str,
    parent_id: Option<&str>,
) -> Result<String, AppError> {
    // Search for existing folder
    let parent_clause = parent_id
        .map(|p| format!(" and '{p}' in parents"))
        .unwrap_or_default();
    let query = format!(
        "name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false{parent_clause}"
    );

    let resp = client
        .get(format!("{DRIVE_API}/files"))
        .query(&[
            ("q", query.as_str()),
            ("fields", "files(id,name)"),
            ("spaces", "drive"),
        ])
        .send()
        .await
        .map_err(drive_err)?;

    let list: DriveFileList = resp.json().await.map_err(drive_err)?;
    if let Some(folder) = list.files.first() {
        return Ok(folder.id.clone());
    }

    // Create the folder
    let mut parents = Vec::new();
    if let Some(pid) = parent_id {
        parents.push(pid.to_string());
    }

    let body = serde_json::json!({
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": parents,
    });

    let resp = client
        .post(format!("{DRIVE_API}/files"))
        .json(&body)
        .send()
        .await
        .map_err(drive_err)?;

    let file: DriveFile = resp.json().await.map_err(drive_err)?;
    Ok(file.id)
}

/// Ensure the full folder path exists: Personas/ObsidianSync/<vault_name>
pub async fn ensure_vault_folder(
    client: &reqwest::Client,
    vault_name: &str,
) -> Result<String, AppError> {
    let app_folder = ensure_folder(client, APP_FOLDER_NAME, None).await?;
    let sync_folder = ensure_folder(client, SYNC_FOLDER_NAME, Some(&app_folder)).await?;
    ensure_folder(client, vault_name, Some(&sync_folder)).await
}

// ── File operations ────────────────────────────────────────────────────

/// Upload a file to Google Drive (create or update).
pub async fn upload_file(
    client: &reqwest::Client,
    parent_id: &str,
    file_name: &str,
    content: &[u8],
    existing_file_id: Option<&str>,
) -> Result<DriveFile, AppError> {
    if let Some(fid) = existing_file_id {
        // Update existing file
        let resp = client
            .patch(format!("{DRIVE_UPLOAD}/files/{fid}?uploadType=media"))
            .header("Content-Type", "text/markdown")
            .body(content.to_vec())
            .send()
            .await
            .map_err(drive_err)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(drive_err(format!("upload update failed ({status}): {body}")));
        }
        resp.json().await.map_err(drive_err)
    } else {
        // Create new file (multipart upload)
        let metadata = serde_json::json!({
            "name": file_name,
            "parents": [parent_id],
        });

        let part_meta = reqwest::multipart::Part::text(metadata.to_string())
            .mime_str("application/json")
            .map_err(drive_err)?;
        let part_content = reqwest::multipart::Part::bytes(content.to_vec())
            .mime_str("text/markdown")
            .map_err(drive_err)?;

        let form = reqwest::multipart::Form::new()
            .part("metadata", part_meta)
            .part("file", part_content);

        let resp = client
            .post(format!("{DRIVE_UPLOAD}/files?uploadType=multipart"))
            .multipart(form)
            .send()
            .await
            .map_err(drive_err)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(drive_err(format!("upload create failed ({status}): {body}")));
        }
        resp.json().await.map_err(drive_err)
    }
}

/// Download a file's content from Google Drive.
pub async fn download_file(
    client: &reqwest::Client,
    file_id: &str,
) -> Result<String, AppError> {
    let resp = client
        .get(format!("{DRIVE_API}/files/{file_id}"))
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(drive_err)?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(drive_err(format!("download failed ({status})")));
    }
    resp.text().await.map_err(drive_err)
}

/// List all files in a Drive folder.
pub async fn list_files_in_folder(
    client: &reqwest::Client,
    folder_id: &str,
) -> Result<Vec<DriveFile>, AppError> {
    let mut all_files = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let query = format!("'{folder_id}' in parents and trashed = false");
        let mut req = client
            .get(format!("{DRIVE_API}/files"))
            .query(&[
                ("q", query.as_str()),
                ("fields", "files(id,name,mimeType,size),nextPageToken"),
                ("pageSize", "1000"),
            ]);
        if let Some(ref token) = page_token {
            req = req.query(&[("pageToken", token.as_str())]);
        }

        let resp = req.send().await.map_err(drive_err)?;
        let list: DriveFileList = resp.json().await.map_err(drive_err)?;

        all_files.extend(list.files);
        page_token = list.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(all_files)
}

/// Delete a file from Google Drive.
pub async fn delete_file(
    client: &reqwest::Client,
    file_id: &str,
) -> Result<(), AppError> {
    let resp = client
        .delete(format!("{DRIVE_API}/files/{file_id}"))
        .send()
        .await
        .map_err(drive_err)?;

    if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
        let status = resp.status();
        return Err(drive_err(format!("delete failed ({status})")));
    }
    Ok(())
}

// ── Account info ───────────────────────────────────────────────────────

/// Get Google Drive storage quota and user email.
pub async fn get_about(client: &reqwest::Client) -> Result<DriveAbout, AppError> {
    let resp = client
        .get(format!("{DRIVE_API}/about"))
        .query(&[("fields", "storageQuota,user")])
        .send()
        .await
        .map_err(drive_err)?;
    resp.json().await.map_err(drive_err)
}

// ── Manifest operations ────────────────────────────────────────────────

/// Load the sync manifest from Google Drive.
pub async fn load_manifest(
    client: &reqwest::Client,
    vault_folder_id: &str,
) -> Result<(Option<String>, SyncManifest), AppError> {
    let query = format!(
        "name = '{MANIFEST_FILE_NAME}' and '{vault_folder_id}' in parents and trashed = false"
    );

    let resp = client
        .get(format!("{DRIVE_API}/files"))
        .query(&[
            ("q", query.as_str()),
            ("fields", "files(id,name)"),
        ])
        .send()
        .await
        .map_err(drive_err)?;

    let list: DriveFileList = resp.json().await.map_err(drive_err)?;

    if let Some(manifest_file) = list.files.first() {
        let content = download_file(client, &manifest_file.id).await?;
        let manifest: SyncManifest =
            serde_json::from_str(&content).unwrap_or_default();
        Ok((Some(manifest_file.id.clone()), manifest))
    } else {
        Ok((None, SyncManifest::default()))
    }
}

/// Save the sync manifest back to Google Drive.
pub async fn save_manifest(
    client: &reqwest::Client,
    vault_folder_id: &str,
    manifest_file_id: Option<&str>,
    manifest: &SyncManifest,
) -> Result<String, AppError> {
    let content = serde_json::to_string_pretty(manifest).map_err(drive_err)?;
    let file = upload_file(
        client,
        vault_folder_id,
        MANIFEST_FILE_NAME,
        content.as_bytes(),
        manifest_file_id,
    )
    .await?;
    Ok(file.id)
}

// ============================================================================
// High-level sync operations (called by Tauri commands)
// ============================================================================

/// Push local vault files to Google Drive.
///
/// Walks the local vault directory, compares content hashes against the manifest,
/// and uploads changed/new files. Updates the manifest after each file.
pub async fn push_to_drive(
    token: &str,
    vault_path: &Path,
    vault_name: &str,
    folders_to_sync: &[String],
) -> Result<DriveSyncResult, AppError> {
    let client = drive_client(token)?;
    let vault_folder_id = ensure_vault_folder(&client, vault_name).await?;
    let (manifest_id, mut manifest) = load_manifest(&client, &vault_folder_id).await?;
    manifest.vault_name = vault_name.to_string();

    let mut result = DriveSyncResult {
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    // Walk each configured sync folder
    for folder_name in folders_to_sync {
        let local_folder = vault_path.join(folder_name);
        if !local_folder.exists() {
            continue;
        }

        // Ensure the subfolder exists on Drive
        let drive_subfolder = ensure_folder(&client, folder_name, Some(&vault_folder_id)).await?;

        // Walk local files
        match walk_markdown_files(&local_folder) {
            Ok(files) => {
                for (relative_path, full_path) in files {
                    let file_key = format!("{folder_name}/{relative_path}");

                    match std::fs::read_to_string(&full_path) {
                        Ok(content) => {
                            let hash = compute_content_hash(&content);

                            // Check if file has changed since last sync
                            if let Some(entry) = manifest.files.get(&file_key) {
                                if entry.content_hash == hash {
                                    result.skipped += 1;
                                    continue;
                                }
                            }

                            // Upload to Drive
                            let existing_id =
                                manifest.files.get(&file_key).map(|e| e.drive_file_id.as_str());
                            match upload_file(
                                &client,
                                &drive_subfolder,
                                &relative_path,
                                content.as_bytes(),
                                existing_id,
                            )
                            .await
                            {
                                Ok(file) => {
                                    manifest.files.insert(
                                        file_key,
                                        ManifestEntry {
                                            drive_file_id: file.id,
                                            content_hash: hash,
                                            synced_at: Utc::now().to_rfc3339(),
                                            size_bytes: content.len() as u64,
                                        },
                                    );
                                    result.uploaded += 1;
                                }
                                Err(e) => {
                                    result.errors.push(format!("{file_key}: {e}"));
                                }
                            }
                        }
                        Err(e) => {
                            result.errors.push(format!("read {file_key}: {e}"));
                        }
                    }
                }
            }
            Err(e) => {
                result.errors.push(format!("walk {folder_name}: {e}"));
            }
        }
    }

    manifest.last_full_sync = Some(Utc::now().to_rfc3339());
    if let Err(e) = save_manifest(&client, &vault_folder_id, manifest_id.as_deref(), &manifest).await {
        result.errors.push(format!("save manifest: {e}"));
    }

    Ok(result)
}

/// Pull files from Google Drive to local vault.
pub async fn pull_from_drive(
    token: &str,
    vault_path: &Path,
    vault_name: &str,
    folders_to_sync: &[String],
) -> Result<DriveSyncResult, AppError> {
    let client = drive_client(token)?;
    let vault_folder_id = ensure_vault_folder(&client, vault_name).await?;
    let (manifest_id, mut manifest) = load_manifest(&client, &vault_folder_id).await?;

    let mut result = DriveSyncResult {
        uploaded: 0,
        downloaded: 0,
        deleted: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    for folder_name in folders_to_sync {
        let local_folder = vault_path.join(folder_name);
        std::fs::create_dir_all(&local_folder).map_err(drive_err)?;

        // Find the subfolder on Drive
        let query = format!(
            "name = '{folder_name}' and '{vault_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        );
        let resp = client
            .get(format!("{DRIVE_API}/files"))
            .query(&[("q", query.as_str()), ("fields", "files(id)")])
            .send()
            .await
            .map_err(drive_err)?;
        let list: DriveFileList = resp.json().await.map_err(drive_err)?;

        let Some(drive_subfolder) = list.files.first() else {
            continue;
        };

        // List files on Drive
        let drive_files = list_files_in_folder(&client, &drive_subfolder.id).await?;

        for df in drive_files {
            if df.mime_type == "application/vnd.google-apps.folder" {
                continue; // Skip subdirectories for now
            }

            let file_key = format!("{folder_name}/{}", df.name);
            let local_path = local_folder.join(&df.name);

            // Check if local file is already up-to-date
            if local_path.exists() {
                if let Ok(local_content) = std::fs::read_to_string(&local_path) {
                    let local_hash = compute_content_hash(&local_content);
                    if let Some(entry) = manifest.files.get(&file_key) {
                        if entry.content_hash == local_hash {
                            result.skipped += 1;
                            continue;
                        }
                    }
                }
            }

            // Download from Drive
            match download_file(&client, &df.id).await {
                Ok(content) => {
                    if let Err(e) = std::fs::write(&local_path, &content) {
                        result.errors.push(format!("write {file_key}: {e}"));
                        continue;
                    }
                    let hash = compute_content_hash(&content);
                    manifest.files.insert(
                        file_key,
                        ManifestEntry {
                            drive_file_id: df.id,
                            content_hash: hash,
                            synced_at: Utc::now().to_rfc3339(),
                            size_bytes: content.len() as u64,
                        },
                    );
                    result.downloaded += 1;
                }
                Err(e) => {
                    result.errors.push(format!("download {file_key}: {e}"));
                }
            }
        }
    }

    manifest.last_full_sync = Some(Utc::now().to_rfc3339());
    if let Err(e) = save_manifest(&client, &vault_folder_id, manifest_id.as_deref(), &manifest).await {
        result.errors.push(format!("save manifest: {e}"));
    }

    Ok(result)
}

/// Get Drive connection status and storage info.
pub async fn get_drive_status(
    token: &str,
    vault_name: &str,
) -> Result<DriveStatus, AppError> {
    let client = drive_client(token)?;

    let about = get_about(&client).await?;

    // Try to load manifest for file count
    let manifest_count = match ensure_vault_folder(&client, vault_name).await {
        Ok(vault_folder_id) => {
            load_manifest(&client, &vault_folder_id)
                .await
                .map(|(_, m)| m.files.len() as u32)
                .unwrap_or(0)
        }
        Err(_) => 0,
    };

    Ok(DriveStatus {
        connected: true,
        email: about.user.and_then(|u| u.email_address),
        storage_used_bytes: about
            .storage_quota
            .as_ref()
            .and_then(|q| q.usage.as_ref())
            .and_then(|u| u.parse().ok()),
        storage_limit_bytes: about
            .storage_quota
            .as_ref()
            .and_then(|q| q.limit.as_ref())
            .and_then(|l| l.parse().ok()),
        last_sync_at: None, // Loaded from manifest
        manifest_file_count: manifest_count,
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Recursively walk a directory and collect all .md files with their relative paths.
fn walk_markdown_files(dir: &Path) -> Result<Vec<(String, std::path::PathBuf)>, std::io::Error> {
    let mut files = Vec::new();
    walk_dir_recursive(dir, dir, &mut files)?;
    Ok(files)
}

fn walk_dir_recursive(
    base: &Path,
    current: &Path,
    files: &mut Vec<(String, std::path::PathBuf)>,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            // Skip hidden directories
            if path
                .file_name()
                .map(|n| n.to_string_lossy().starts_with('.'))
                .unwrap_or(true)
            {
                continue;
            }
            walk_dir_recursive(base, &path, files)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            let relative = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            files.push((relative, path));
        }
    }
    Ok(())
}
