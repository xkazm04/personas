//! Signed bundle (.persona) export/import for the Invisible Apps P2P layer.
//!
//! A `.persona` bundle is a ZIP archive containing:
//! - `manifest.json`  -- what's included, exposure settings, owner identity
//! - `signature.json`  -- Ed25519 signature over manifest + content hash
//! - `persona.json`   -- persona definition (filtered by fields_exposed)
//! - `metadata.json`  -- bundle metadata (app version, timestamps)
//!
//! The bundle is deterministically ordered so that the content hash is
//! reproducible.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Instant;

use crate::db::models::{CreateProvenanceInput, ExposedResource};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::exposure as exposure_repo;
use crate::db::DbPool;
use crate::engine::identity;
use crate::error::AppError;

// -- Preview cache (TOCTOU mitigation) -----------------------------------

struct CachedPreview {
    bytes: Vec<u8>,
    bundle_hash: String,
    created_at: Instant,
}

static PREVIEW_CACHE: std::sync::LazyLock<Mutex<HashMap<String, CachedPreview>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Max age for cached previews (5 minutes).
const PREVIEW_TTL_SECS: u64 = 300;

fn cache_preview(preview_id: &str, bytes: Vec<u8>, bundle_hash: String) {
    let mut cache = PREVIEW_CACHE.lock().unwrap();
    // Evict expired entries opportunistically
    cache.retain(|_, v| v.created_at.elapsed().as_secs() < PREVIEW_TTL_SECS);
    cache.insert(preview_id.to_string(), CachedPreview {
        bytes,
        bundle_hash,
        created_at: Instant::now(),
    });
}

/// Consume cached preview bytes and their hash for use during import (TOCTOU mitigation).
/// Returns `(bytes, bundle_hash)` if the cache entry exists and hasn't expired.
pub fn take_cached_preview_bytes(preview_id: &str) -> Option<(Vec<u8>, String)> {
    let mut cache = PREVIEW_CACHE.lock().unwrap();
    if let Some(entry) = cache.remove(preview_id) {
        if entry.created_at.elapsed().as_secs() < PREVIEW_TTL_SECS {
            return Some((entry.bytes, entry.bundle_hash));
        }
    }
    None
}

// -- Bundle types --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleManifest {
    pub format_version: u32,
    pub owner_peer_id: String,
    pub owner_display_name: String,
    pub created_at: String,
    pub resources: Vec<BundleResourceEntry>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleResourceEntry {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub fields_exposed: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleSignature {
    pub signer_peer_id: String,
    pub signer_public_key_b64: String,
    pub signature_b64: String,
    pub algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleMetadata {
    pub app_version: String,
    pub app_name: String,
    pub created_at: String,
    pub bundle_format: String,
}

// -- Public types for commands -------------------------------------------

use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleExportResult {
    pub bundle_hash: String,
    pub resource_count: u32,
    pub byte_size: u64,
}

/// Network access scope level for an imported bundle.
/// - `"none"` – no detected network access (green)
/// - `"restricted"` – known domains / endpoints only (amber)
/// - `"unrestricted"` – broad or unscoped network access (red)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetworkAccessScope {
    pub level: String,
    pub domains: Vec<String>,
    pub tool_integrations: Vec<String>,
    pub api_endpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportPreview {
    pub preview_id: String,
    pub signer_peer_id: String,
    pub signer_display_name: String,
    pub signature_valid: bool,
    pub signer_trusted: bool,
    pub resources: Vec<BundleResourcePreview>,
    pub network_scope: NetworkAccessScope,
    pub bundle_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleResourcePreview {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub tags: Vec<String>,
    pub conflict: bool,
    pub conflict_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportOptions {
    pub skip_conflicts: bool,
    pub rename_prefix: Option<String>,
    /// When set, apply uses the cached preview bytes instead of re-reading the file.
    pub preview_id: Option<String>,
    /// SHA-256 hash from the preview step. When set, the apply step verifies
    /// the bundle bytes match this hash before importing (TOCTOU mitigation).
    pub expected_bundle_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleVerification {
    pub signature_valid: bool,
    pub signer_peer_id: String,
    pub signer_display_name: String,
    pub signer_trusted: bool,
    pub resource_count: u32,
    pub bundle_hash: String,
    pub created_at: String,
}

// -- Export ---------------------------------------------------------------

/// Export selected exposed resources into a signed .persona bundle.
pub fn export_bundle(
    pool: &DbPool,
    resource_ids: &[String],
) -> Result<(Vec<u8>, BundleExportResult), AppError> {
    let local_identity = identity::get_or_create_identity(pool)?;

    // Gather resources
    let mut entries = Vec::new();
    let mut persona_data: Vec<(String, serde_json::Value)> = Vec::new();

    for id in resource_ids {
        let resource = exposure_repo::get_exposed_resource(pool, id)?;
        let fields: Vec<String> = serde_json::from_str(&resource.fields_exposed)?;
        let tags: Vec<String> = serde_json::from_str(&resource.tags)?;

        entries.push(BundleResourceEntry {
            resource_type: resource.resource_type.to_string(),
            resource_id: resource.resource_id.clone(),
            display_name: resource.display_name.clone(),
            access_level: resource.access_level.to_string(),
            fields_exposed: fields,
            tags,
        });

        // Load the actual resource data and filter fields
        if resource.resource_type == crate::db::models::ResourceType::Persona {
            match persona_repo::get_by_id(pool, &resource.resource_id) {
                Ok(persona) => {
                    let mut value = serde_json::to_value(&persona)?;
                    filter_fields(&mut value, &resource);
                    persona_data.push((resource.resource_id.clone(), value));
                }
                Err(e) => {
                    tracing::warn!(resource_id = %resource.resource_id, "Skipping persona export: {}", e);
                }
            }
        }
    }

    // Build content to hash (deterministic: sorted JSON)
    let mut content_parts: Vec<String> = Vec::new();
    for (id, data) in &persona_data {
        content_parts.push(format!("{}:{}", id, serde_json::to_string(data)?));
    }
    content_parts.sort();
    let content_blob = content_parts.join("\n");
    let content_hash = hex::encode(Sha256::digest(content_blob.as_bytes()));

    let now = chrono::Utc::now().to_rfc3339();

    let manifest = BundleManifest {
        format_version: 1,
        owner_peer_id: local_identity.peer_id.clone(),
        owner_display_name: local_identity.display_name.clone(),
        created_at: now.clone(),
        resources: entries,
        content_hash: content_hash.clone(),
    };

    // Sign the manifest
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    let signature_b64 = identity::sign_message(pool, manifest_json.as_bytes())?;

    let sig = BundleSignature {
        signer_peer_id: local_identity.peer_id.clone(),
        signer_public_key_b64: local_identity.public_key_b64.clone(),
        signature_b64,
        algorithm: "Ed25519".into(),
    };

    let metadata = BundleMetadata {
        app_version: env!("CARGO_PKG_VERSION").into(),
        app_name: "personas-desktop".into(),
        created_at: now,
        bundle_format: "persona-bundle-v1".into(),
    };

    // Build ZIP
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("manifest.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(manifest_json.as_bytes())?;

        zip.start_file("signature.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(serde_json::to_string_pretty(&sig)?.as_bytes())?;

        zip.start_file("metadata.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(serde_json::to_string_pretty(&metadata)?.as_bytes())?;

        // Write persona data files
        for (id, data) in &persona_data {
            let filename = format!("personas/{}.json", id);
            zip.start_file(filename, options)
                .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
            zip.write_all(serde_json::to_string_pretty(data)?.as_bytes())?;
        }

        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finalize error: {e}")))?;
    }

    let bundle_hash = hex::encode(Sha256::digest(&buf));
    let result = BundleExportResult {
        bundle_hash,
        resource_count: resource_ids.len() as u32,
        byte_size: buf.len() as u64,
    };

    Ok((buf, result))
}

// -- Import Preview ------------------------------------------------------

/// Preview a .persona bundle without importing anything.
pub fn preview_bundle(
    pool: &DbPool,
    bundle_bytes: &[u8],
) -> Result<BundleImportPreview, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;

    // Verify signature against a trusted stored key (not the embedded key).
    let manifest_bytes = serde_json::to_string_pretty(&manifest)?;
    let (sig_valid, signer_trusted) =
        verify_against_trusted_key(pool, &sig, manifest_bytes.as_bytes());

    // Batch-fetch all persona resources in a single query for conflict detection
    let persona_ids: Vec<String> = manifest
        .resources
        .iter()
        .filter(|e| e.resource_type == "persona")
        .map(|e| e.resource_id.clone())
        .collect();
    let existing_personas: HashMap<String, String> = persona_repo::get_by_ids(pool, &persona_ids)
        .unwrap_or_default()
        .into_iter()
        .map(|p| (p.id.clone(), p.name))
        .collect();

    // Check for conflicts
    let mut resources = Vec::new();
    for entry in &manifest.resources {
        let (conflict, conflict_name) = if entry.resource_type == "persona" {
            match existing_personas.get(&entry.resource_id) {
                Some(name) => (true, Some(name.clone())),
                None => (false, None),
            }
        } else {
            (false, None)
        };

        resources.push(BundleResourcePreview {
            resource_type: entry.resource_type.clone(),
            resource_id: entry.resource_id.clone(),
            display_name: entry.display_name.clone(),
            access_level: entry.access_level.clone(),
            tags: entry.tags.clone(),
            conflict,
            conflict_name,
        });
    }

    // Extract network access scope from persona data in the bundle
    let network_scope = extract_network_scope(bundle_bytes, &manifest);

    let preview_id = uuid::Uuid::new_v4().to_string();

    // Cache the bundle bytes keyed by preview_id so apply_import can use
    // the exact same data the user previewed (TOCTOU mitigation).
    cache_preview(&preview_id, bundle_bytes.to_vec(), bundle_hash.clone());

    Ok(BundleImportPreview {
        preview_id,
        signer_peer_id: sig.signer_peer_id,
        signer_display_name: manifest.owner_display_name,
        signature_valid: sig_valid,
        signer_trusted,
        resources,
        network_scope,
        bundle_hash,
        created_at: manifest.created_at,
    })
}

// -- Import Apply --------------------------------------------------------

/// Import personas from a .persona bundle into the local database.
pub fn apply_import(
    pool: &DbPool,
    bundle_bytes: &[u8],
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bundle_bytes))
        .map_err(|e| AppError::Validation(format!("Invalid bundle ZIP: {e}")))?;

    let mut imported = 0u32;
    let mut skipped = 0u32;
    let mut errors = Vec::new();
    let mut provenance_batch: Vec<CreateProvenanceInput> = Vec::new();

    // Load all existing persona names once before the loop for O(1) conflict checks
    let existing_names: HashSet<String> = persona_repo::get_all(pool)
        .map(|ps| ps.into_iter().map(|p| p.name).collect())
        .unwrap_or_default();

    for entry in &manifest.resources {
        if entry.resource_type == "persona" {
            let filename = format!("personas/{}.json", entry.resource_id);
            let persona_json = match read_zip_entry(&mut archive, &filename) {
                Ok(data) => data,
                Err(e) => {
                    errors.push(format!("Failed to read {}: {}", filename, e));
                    continue;
                }
            };

            // Check for name conflicts with existing personas
            let mut persona_value: serde_json::Value =
                serde_json::from_str(&persona_json)?;

            // Check if a persona with this exact name already exists
            let original_name = persona_value
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Imported Persona")
                .to_string();
            let name_exists = existing_names.contains(&original_name);

            if name_exists {
                if options.skip_conflicts {
                    skipped += 1;
                    continue;
                }
                // Rename to avoid confusion
                if let Some(obj) = persona_value.as_object_mut() {
                    let prefix = options.rename_prefix.as_deref().unwrap_or("Imported");
                    obj.insert(
                        "name".into(),
                        serde_json::Value::String(format!("[{}] {}", prefix, original_name)),
                    );
                }
            }

            match import_persona_from_value(pool, &persona_value) {
                Ok(new_id) => {
                    provenance_batch.push(CreateProvenanceInput {
                        resource_type: "persona".into(),
                        resource_id: new_id,
                        source_peer_id: sig.signer_peer_id.clone(),
                        source_display_name: None,
                        bundle_hash: Some(bundle_hash.clone()),
                        signature_verified: true,
                    });
                    imported += 1;
                }
                Err(e) => errors.push(format!("Import {}: {}", entry.display_name, e)),
            }
        }
    }

    // Batch-insert all provenance records in a single transaction
    if let Err(e) = exposure_repo::batch_upsert_provenance(pool, provenance_batch) {
        tracing::warn!("Failed to batch-record provenance: {}", e);
    }

    Ok(BundleImportResult {
        imported,
        skipped,
        errors,
    })
}

// -- Verify Only ---------------------------------------------------------

/// Verify a bundle's signature and integrity without importing.
pub fn verify_bundle(
    pool: &DbPool,
    bundle_bytes: &[u8],
) -> Result<BundleVerification, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;

    // Verify signature against a trusted stored key (not the embedded key).
    let manifest_bytes = serde_json::to_string_pretty(&manifest)?;
    let (sig_valid, signer_trusted) =
        verify_against_trusted_key(pool, &sig, manifest_bytes.as_bytes());

    Ok(BundleVerification {
        signature_valid: sig_valid,
        signer_peer_id: sig.signer_peer_id,
        signer_display_name: manifest.owner_display_name,
        signer_trusted,
        resource_count: manifest.resources.len() as u32,
        bundle_hash,
        created_at: manifest.created_at,
    })
}

// -- Internal helpers ----------------------------------------------------

/// Verify a bundle signature against a **stored** trusted key rather than the
/// key embedded in the bundle.  Returns `(signature_valid, signer_trusted)`.
///
/// 1. Look up `signer_peer_id` in `trusted_peers`.  If found and not revoked,
///    verify the signature against the stored public key.
/// 2. Otherwise, check whether the signer is the local identity.  If so, use
///    the local public key.
/// 3. If neither lookup succeeds the signer is unknown — treat as unverifiable.
fn verify_against_trusted_key(
    pool: &DbPool,
    sig: &BundleSignature,
    manifest_bytes: &[u8],
) -> (bool, bool) {
    use crate::db::repos::resources::identity as identity_repo;

    // 1. Try trusted_peers table
    if let Ok(peer) = identity_repo::get_trusted_peer(pool, &sig.signer_peer_id) {
        if peer.trust_level.is_revoked() {
            tracing::warn!(
                peer_id = %sig.signer_peer_id,
                "Bundle signer is a revoked peer — treating as unverifiable"
            );
            return (false, false);
        }
        let valid = identity::verify_signature(
            &peer.public_key_b64,
            manifest_bytes,
            &sig.signature_b64,
        )
        .unwrap_or(false);
        return (valid, true);
    }

    // 2. Try local identity (self-signed bundle imported on the same machine)
    if let Ok(Some(local)) = identity_repo::get_local_identity(pool) {
        if local.peer_id == sig.signer_peer_id {
            let valid = identity::verify_signature(
                &local.public_key_b64,
                manifest_bytes,
                &sig.signature_b64,
            )
            .unwrap_or(false);
            return (valid, true);
        }
    }

    // 3. Unknown signer — unverifiable
    tracing::info!(
        peer_id = %sig.signer_peer_id,
        "Bundle signer is not in trusted peers — signature unverifiable"
    );
    (false, false)
}

fn parse_bundle(
    bundle_bytes: &[u8],
) -> Result<(BundleManifest, BundleSignature), AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bundle_bytes))
        .map_err(|e| AppError::Validation(format!("Invalid bundle ZIP: {e}")))?;

    let manifest_json = read_zip_entry(&mut archive, "manifest.json")?;
    let manifest: BundleManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| AppError::Validation(format!("Invalid manifest.json: {e}")))?;

    let sig_json = read_zip_entry(&mut archive, "signature.json")?;
    let sig: BundleSignature = serde_json::from_str(&sig_json)
        .map_err(|e| AppError::Validation(format!("Invalid signature.json: {e}")))?;

    Ok((manifest, sig))
}

/// Maximum decompressed size for bundle ZIP entries (50 MB).
const MAX_DECOMPRESSED_SIZE: u64 = 50 * 1024 * 1024;

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String, AppError> {
    let mut file = archive
        .by_name(name)
        .map_err(|e| AppError::Validation(format!("Missing {name} in bundle: {e}")))?;

    if file.size() > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "{name} decompressed size ({} bytes) exceeds the {} MB limit",
            file.size(),
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    let mut limited = Read::take(&mut file, MAX_DECOMPRESSED_SIZE + 1);
    let mut content = String::new();
    limited.read_to_string(&mut content)?;

    if content.len() as u64 > MAX_DECOMPRESSED_SIZE {
        return Err(AppError::Validation(format!(
            "{name} decompressed content exceeds the {} MB limit",
            MAX_DECOMPRESSED_SIZE / (1024 * 1024)
        )));
    }

    Ok(content)
}

fn filter_fields(value: &mut serde_json::Value, resource: &ExposedResource) {
    let fields: Vec<String> = serde_json::from_str(&resource.fields_exposed).unwrap_or_default();
    if fields.is_empty() {
        return; // Empty whitelist = expose all fields
    }

    // Always include id and name for usability
    let mut allowed: std::collections::HashSet<&str> =
        fields.iter().map(|s| s.as_str()).collect();
    allowed.insert("id");
    allowed.insert("name");
    allowed.insert("created_at");
    allowed.insert("updated_at");

    if let Some(obj) = value.as_object_mut() {
        let keys: Vec<String> = obj.keys().cloned().collect();
        for key in keys {
            if !allowed.contains(key.as_str()) {
                obj.remove(&key);
            }
        }
    }
}

/// Import a persona from a JSON value using the standard create path.
/// Returns the newly created persona's ID.
fn import_persona_from_value(
    pool: &DbPool,
    value: &serde_json::Value,
) -> Result<String, AppError> {
    use crate::db::models::CreatePersonaInput;

    let obj = value
        .as_object()
        .ok_or_else(|| AppError::Validation("Persona data must be a JSON object".into()))?;

    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Persona")
        .to_string();
    let system_prompt = obj
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let input = CreatePersonaInput {
        name,
        description,
        system_prompt,
        structured_prompt: obj.get("structured_prompt").and_then(|v| v.as_str()).map(|s| s.to_string()),
        icon: obj.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
        color: obj.get("color").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_profile: obj.get("model_profile").and_then(|v| v.as_str()).map(|s| s.to_string()),
        max_budget_usd: obj.get("max_budget_usd").and_then(|v| v.as_f64()),
        max_turns: obj.get("max_turns").and_then(|v| v.as_i64()).map(|n| n as i32),
        group_id: None,
        project_id: None,
        enabled: Some(true),
        max_concurrent: None,
        timeout_ms: None,
        design_context: obj.get("design_context").and_then(|v| v.as_str()).map(|s| s.to_string()),
        notification_channels: None,
    };

    let persona = persona_repo::create(pool, input)?;
    Ok(persona.id)
}


// -- Network scope extraction -------------------------------------------

/// Simple URL regex: matches http(s)://domain paths.
fn extract_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for word in text.split_whitespace() {
        let trimmed = word.trim_matches(|c: char| c == '"' || c == '\'' || c == ',' || c == ')' || c == ']');
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            urls.push(trimmed.to_string());
        }
    }
    urls
}

/// Extract domain from a URL string (e.g. "https://api.example.com/v1" -> "api.example.com").
fn domain_from_url(url: &str) -> Option<String> {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let domain = without_scheme.split('/').next()?;
    let domain = domain.split(':').next()?; // strip port
    if domain.is_empty() || domain == "localhost" {
        return None;
    }
    Some(domain.to_string())
}

/// Patterns that indicate unrestricted / broad network access in a prompt.
const UNRESTRICTED_PATTERNS: &[&str] = &[
    "access any url",
    "access any api",
    "make http requests",
    "make api calls to any",
    "unrestricted network",
    "fetch any url",
    "curl any",
    "any external api",
    "arbitrary url",
    "arbitrary endpoint",
];

/// Analyze persona data inside a bundle to determine network access scope.
fn extract_network_scope(bundle_bytes: &[u8], manifest: &BundleManifest) -> NetworkAccessScope {
    let mut domains: HashSet<String> = HashSet::new();
    let mut tool_integrations: HashSet<String> = HashSet::new();
    let mut api_endpoints: Vec<String> = Vec::new();
    let mut has_unrestricted = false;

    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(bundle_bytes)) {
        Ok(a) => a,
        Err(_) => {
            return NetworkAccessScope {
                level: "none".into(),
                domains: vec![],
                tool_integrations: vec![],
                api_endpoints: vec![],
            };
        }
    };

    for entry in &manifest.resources {
        if entry.resource_type != "persona" {
            continue;
        }

        let filename = format!("personas/{}.json", entry.resource_id);
        let persona_json = match read_zip_entry(&mut archive, &filename) {
            Ok(data) => data,
            Err(_) => continue,
        };

        let obj: serde_json::Value = match serde_json::from_str(&persona_json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Scan system_prompt and structured_prompt for URLs and unrestricted patterns
        for field in &["system_prompt", "structured_prompt"] {
            if let Some(text) = obj.get(field).and_then(|v| v.as_str()) {
                let lower = text.to_lowercase();
                for pattern in UNRESTRICTED_PATTERNS {
                    if lower.contains(pattern) {
                        has_unrestricted = true;
                    }
                }
                for url in extract_urls(text) {
                    if let Some(d) = domain_from_url(&url) {
                        domains.insert(d);
                    }
                    api_endpoints.push(url);
                }
            }
        }

        // Scan design_context for connector pipeline and credential links
        if let Some(dc_str) = obj.get("design_context").and_then(|v| v.as_str()) {
            if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_str) {
                // Connector pipeline entries
                if let Some(pipeline) = dc.get("connectorPipeline").and_then(|v| v.as_array()) {
                    for step in pipeline {
                        if let Some(name) = step.get("connectorName").and_then(|v| v.as_str()) {
                            tool_integrations.insert(name.to_string());
                        }
                    }
                }
                // Credential links (connector name -> credential id)
                if let Some(links) = dc.get("credentialLinks").and_then(|v| v.as_object()) {
                    for key in links.keys() {
                        tool_integrations.insert(key.clone());
                    }
                }
                // Design file references (URLs)
                if let Some(df) = dc.get("designFiles") {
                    if let Some(refs) = df.get("references").and_then(|v| v.as_array()) {
                        for r in refs {
                            if let Some(url) = r.as_str() {
                                if let Some(d) = domain_from_url(url) {
                                    domains.insert(d);
                                }
                                api_endpoints.push(url.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Check tags for network-related keywords
        for tag in &entry.tags {
            let lower = tag.to_lowercase();
            if lower.contains("api") || lower.contains("http") || lower.contains("webhook") {
                tool_integrations.insert(tag.clone());
            }
        }
    }

    // Deduplicate endpoints
    api_endpoints.sort();
    api_endpoints.dedup();

    let mut sorted_domains: Vec<String> = domains.into_iter().collect();
    sorted_domains.sort();
    let mut sorted_tools: Vec<String> = tool_integrations.into_iter().collect();
    sorted_tools.sort();

    let level = if has_unrestricted {
        "unrestricted"
    } else if !sorted_domains.is_empty() || !sorted_tools.is_empty() || !api_endpoints.is_empty() {
        "restricted"
    } else {
        "none"
    };

    NetworkAccessScope {
        level: level.into(),
        domains: sorted_domains,
        tool_integrations: sorted_tools,
        api_endpoints,
    }
}
