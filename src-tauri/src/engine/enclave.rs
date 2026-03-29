//! Sovereign Persona Enclaves: cryptographically sealed portable runtime environments.
//!
//! An enclave bundles a persona configuration, capability declarations, cost limits,
//! and a creator signature into a sealed `.enclave` archive. The enclave can be
//! transferred to any Personas Desktop instance and verified without trusting the host.
//!
//! First sprint scope:
//! - `EnclaveManifest` struct with persona config + capabilities + cost limits + signature
//! - `seal()` — bundles and signs an enclave using the local Ed25519 identity
//! - `verify()` — validates the signature chain and policy integrity

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use ts_rs::TS;

use crate::db::repos::core::personas as persona_repo;
use crate::db::DbPool;
use crate::engine::desktop_security::DesktopCapability;
use crate::engine::identity;
use crate::error::AppError;

// -- Enclave policy types ---------------------------------------------------

/// Execution policy constraining what an enclave is allowed to do.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnclavePolicy {
    /// Maximum cost in USD the enclave may spend per execution.
    pub max_cost_usd: f64,
    /// Maximum number of LLM turns per execution.
    pub max_turns: u32,
    /// Allowed tool names (empty = no tool restrictions).
    pub allowed_tools: Vec<String>,
    /// Allowed outbound network domains (empty = no network access).
    pub allowed_domains: Vec<String>,
    /// Desktop capabilities the enclave requires.
    pub required_capabilities: Vec<DesktopCapability>,
    /// Whether the enclave may persist data on the host.
    pub allow_persistence: bool,
}

impl Default for EnclavePolicy {
    fn default() -> Self {
        Self {
            max_cost_usd: 1.0,
            max_turns: 10,
            allowed_tools: vec![],
            allowed_domains: vec![],
            required_capabilities: vec![],
            allow_persistence: false,
        }
    }
}

/// The sealed manifest describing the enclave contents and constraints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnclaveManifest {
    /// Format version for forward compatibility.
    pub format_version: u32,
    /// Unique identifier for this enclave.
    pub enclave_id: String,
    /// PeerId of the enclave creator.
    pub creator_peer_id: String,
    /// Display name of the creator.
    pub creator_display_name: String,
    /// ISO-8601 timestamp of creation.
    pub created_at: String,
    /// The persona ID that was sealed.
    pub persona_id: String,
    /// Human-readable persona name.
    pub persona_name: String,
    /// Execution policy.
    pub policy: EnclavePolicy,
    /// SHA-256 hash of the persona data blob.
    pub content_hash: String,
}

/// Ed25519 signature block for the enclave.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnclaveSignature {
    pub signer_peer_id: String,
    pub signer_public_key_b64: String,
    pub signature_b64: String,
    pub algorithm: String,
}

// -- Public result types (TS-exported) --------------------------------------

/// Result of sealing an enclave.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnclaveSealResult {
    pub enclave_id: String,
    pub enclave_hash: String,
    pub persona_name: String,
    pub byte_size: u64,
}

/// Result of verifying an enclave.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnclaveVerifyResult {
    pub enclave_id: String,
    pub signature_valid: bool,
    pub content_intact: bool,
    pub creator_peer_id: String,
    pub creator_display_name: String,
    pub creator_trusted: bool,
    pub persona_name: String,
    pub policy: EnclavePolicy,
    pub created_at: String,
    pub enclave_hash: String,
}

// -- Seal -------------------------------------------------------------------

/// Seal a persona into a cryptographically signed enclave archive.
///
/// The archive is a ZIP containing:
/// - `manifest.json`  — enclave manifest with policy and content hash
/// - `signature.json` — Ed25519 signature over the manifest
/// - `persona.json`   — the full persona configuration
pub fn seal(
    pool: &DbPool,
    persona_id: &str,
    policy: EnclavePolicy,
) -> Result<(Vec<u8>, EnclaveSealResult), AppError> {
    let local_identity = identity::get_or_create_identity(pool)?;

    // Load persona
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    let persona_json = serde_json::to_string_pretty(&persona)?;

    // Content hash for integrity verification
    let content_hash = hex::encode(Sha256::digest(persona_json.as_bytes()));

    let enclave_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let manifest = EnclaveManifest {
        format_version: 1,
        enclave_id: enclave_id.clone(),
        creator_peer_id: local_identity.peer_id.clone(),
        creator_display_name: local_identity.display_name.clone(),
        created_at: now,
        persona_id: persona_id.to_string(),
        persona_name: persona.name.clone(),
        policy,
        content_hash,
    };

    // Sign the manifest
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    let signature_b64 = identity::sign_message(pool, manifest_json.as_bytes())?;

    let sig = EnclaveSignature {
        signer_peer_id: local_identity.peer_id.clone(),
        signer_public_key_b64: local_identity.public_key_b64.clone(),
        signature_b64,
        algorithm: "Ed25519".into(),
    };

    // Build ZIP archive
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

        zip.start_file("persona.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(persona_json.as_bytes())?;

        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finalize error: {e}")))?;
    }

    let enclave_hash = hex::encode(Sha256::digest(&buf));
    let result = EnclaveSealResult {
        enclave_id,
        enclave_hash,
        persona_name: persona.name,
        byte_size: buf.len() as u64,
    };

    Ok((buf, result))
}

// -- Verify -----------------------------------------------------------------

/// Verify an enclave archive's signature and content integrity.
///
/// Checks:
/// 1. Ed25519 signature over the manifest is valid
/// 2. Content hash in the manifest matches the actual persona data
/// 3. Whether the creator is a trusted peer
pub fn verify(
    pool: &DbPool,
    enclave_bytes: &[u8],
) -> Result<EnclaveVerifyResult, AppError> {
    let enclave_hash = hex::encode(Sha256::digest(enclave_bytes));
    let (manifest, sig, persona_json) = parse_enclave(enclave_bytes)?;

    // Verify Ed25519 signature over manifest
    let manifest_json = serde_json::to_string(&manifest)?;
    let signature_valid = identity::verify_signature(
        &sig.signer_public_key_b64,
        manifest_json.as_bytes(),
        &sig.signature_b64,
    )
    .unwrap_or(false);

    // Verify content integrity
    let actual_hash = hex::encode(Sha256::digest(persona_json.as_bytes()));
    let content_intact = actual_hash == manifest.content_hash;

    // Check trust status
    let creator_trusted = crate::db::repos::resources::identity::get_trusted_peer(
        pool,
        &sig.signer_peer_id,
    )
    .map(|p| !p.trust_level.is_revoked())
    .unwrap_or(false);

    Ok(EnclaveVerifyResult {
        enclave_id: manifest.enclave_id,
        signature_valid,
        content_intact,
        creator_peer_id: manifest.creator_peer_id,
        creator_display_name: manifest.creator_display_name,
        creator_trusted,
        persona_name: manifest.persona_name,
        policy: manifest.policy,
        created_at: manifest.created_at,
        enclave_hash,
    })
}

// -- Internal helpers -------------------------------------------------------

/// Maximum decompressed size for enclave ZIP entries (50 MB).
const MAX_DECOMPRESSED_SIZE: u64 = 50 * 1024 * 1024;

fn parse_enclave(
    enclave_bytes: &[u8],
) -> Result<(EnclaveManifest, EnclaveSignature, String), AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(enclave_bytes))
        .map_err(|e| AppError::Validation(format!("Invalid enclave archive: {e}")))?;

    let manifest_json = read_zip_entry(&mut archive, "manifest.json")?;
    let manifest: EnclaveManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| AppError::Validation(format!("Invalid enclave manifest: {e}")))?;

    let sig_json = read_zip_entry(&mut archive, "signature.json")?;
    let sig: EnclaveSignature = serde_json::from_str(&sig_json)
        .map_err(|e| AppError::Validation(format!("Invalid enclave signature: {e}")))?;

    let persona_json = read_zip_entry(&mut archive, "persona.json")?;

    Ok((manifest, sig, persona_json))
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String, AppError> {
    let mut file = archive
        .by_name(name)
        .map_err(|e| AppError::Validation(format!("Missing {name} in enclave: {e}")))?;

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
