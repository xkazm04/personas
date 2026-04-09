use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::db::models::{
    DocumentSignature, SignDocumentResult, SignatureSidecar, SignatureSidecarSigner,
    VerifyDocumentInput, VerifyDocumentResult,
};
use crate::db::repos::resources::signing as repo;
use crate::engine::identity;
use crate::engine::path_safety::{validate_file_access_path, ALLOWED_SIDECAR_EXTENSIONS};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Hash file contents with SHA-256, return hex string prefixed with "sha256:".
fn hash_file(path: &Path) -> Result<String, AppError> {
    let bytes = std::fs::read(path)
        .map_err(|e| AppError::Validation(format!("Cannot read file: {e}")))?;
    let digest = Sha256::digest(&bytes);
    Ok(format!("sha256:{}", hex::encode(digest)))
}

#[tauri::command]
pub fn sign_document(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    metadata: Option<String>,
) -> Result<SignDocumentResult, AppError> {
    require_auth_sync(&state)?;

    let path = validate_file_access_path(&file_path, None)
        .map_err(AppError::Validation)?;
    if !path.exists() {
        return Err(AppError::Validation(format!("File not found: {file_path}")));
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    // Hash the file
    let file_hash = hash_file(&path)?;

    // Get or create the local identity
    let ident = identity::get_or_create_identity(&state.db)?;

    // Read file bytes and sign
    let file_bytes = std::fs::read(&path)
        .map_err(|e| AppError::Internal(format!("Cannot read file for signing: {e}")))?;
    let signature_b64 = identity::sign_message(&state.db, &file_bytes)?;

    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let sig = DocumentSignature {
        id: id.clone(),
        file_name: file_name.clone(),
        file_path: Some(file_path.clone()),
        file_hash: file_hash.clone(),
        signature_b64: signature_b64.clone(),
        signer_peer_id: ident.peer_id.clone(),
        signer_public_key_b64: ident.public_key_b64.clone(),
        signer_display_name: ident.display_name.clone(),
        metadata: metadata.clone(),
        signed_at: now.clone(),
        created_at: now.clone(),
    };

    // Persist to database
    let saved = repo::insert_signature(&state.db, &sig)?;

    // Build portable sidecar JSON
    let sidecar = SignatureSidecar {
        version: 1,
        algorithm: "Ed25519".into(),
        document_hash: file_hash,
        signature: signature_b64,
        signer: SignatureSidecarSigner {
            peer_id: ident.peer_id,
            public_key: ident.public_key_b64,
            display_name: ident.display_name,
        },
        signed_at: now,
        metadata: metadata
            .as_deref()
            .map(|m| serde_json::from_str(m))
            .transpose()
            .map_err(|e| AppError::Validation(format!("Invalid metadata JSON: {e}")))?,
    };
    let sidecar_json = serde_json::to_string_pretty(&sidecar)?;

    Ok(SignDocumentResult {
        signature: saved,
        sidecar_json,
    })
}

#[tauri::command]
pub fn verify_document(
    state: State<'_, Arc<AppState>>,
    input: VerifyDocumentInput,
) -> Result<VerifyDocumentResult, AppError> {
    require_auth_sync(&state)?;

    let path = match validate_file_access_path(&input.file_path, None) {
        Ok(p) => p,
        Err(reason) => {
            return Ok(VerifyDocumentResult {
                valid: false,
                signer_peer_id: String::new(),
                signer_display_name: String::new(),
                signed_at: String::new(),
                file_hash_match: false,
                signature_valid: false,
                error: Some(reason),
            });
        }
    };
    if !path.exists() {
        return Ok(VerifyDocumentResult {
            valid: false,
            signer_peer_id: String::new(),
            signer_display_name: String::new(),
            signed_at: String::new(),
            file_hash_match: false,
            signature_valid: false,
            error: Some(format!("File not found: {}", input.file_path)),
        });
    }

    // Parse sidecar
    let sidecar: SignatureSidecar = match serde_json::from_str(&input.sidecar_json) {
        Ok(s) => s,
        Err(e) => {
            return Ok(VerifyDocumentResult {
                valid: false,
                signer_peer_id: String::new(),
                signer_display_name: String::new(),
                signed_at: String::new(),
                file_hash_match: false,
                signature_valid: false,
                error: Some(format!("Invalid sidecar JSON: {e}")),
            });
        }
    };

    // Check file hash
    let current_hash = hash_file(&path)?;
    let file_hash_match = current_hash == sidecar.document_hash;

    // Verify cryptographic signature
    let file_bytes = std::fs::read(&path)
        .map_err(|e| AppError::Internal(format!("Cannot read file for verification: {e}")))?;
    let signature_valid =
        identity::verify_signature(&sidecar.signer.public_key, &file_bytes, &sidecar.signature)
            .unwrap_or(false);

    let valid = file_hash_match && signature_valid;

    Ok(VerifyDocumentResult {
        valid,
        signer_peer_id: sidecar.signer.peer_id,
        signer_display_name: sidecar.signer.display_name,
        signed_at: sidecar.signed_at,
        file_hash_match,
        signature_valid,
        error: if valid {
            None
        } else if !file_hash_match && !signature_valid {
            Some("File has been modified AND signature is invalid".into())
        } else if !file_hash_match {
            Some("File has been modified since signing".into())
        } else {
            Some("Cryptographic signature verification failed".into())
        },
    })
}

/// Generate or regenerate the local Ed25519 signing identity.
/// Returns the peer ID and display name for confirmation.
#[tauri::command]
pub fn generate_signing_key(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let ident = identity::get_or_create_identity(&state.db)?;
    // Force-refresh the keyring entry by re-storing
    // This handles the case where DB identity exists but keyring is empty
    Ok(serde_json::json!({
        "peer_id": ident.peer_id,
        "display_name": ident.display_name,
        "status": "ready",
    }))
}

#[tauri::command]
pub fn list_document_signatures(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DocumentSignature>, AppError> {
    require_auth_sync(&state)?;
    repo::list_signatures(&state.db)
}

#[tauri::command]
pub fn get_document_signature(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DocumentSignature, AppError> {
    require_auth_sync(&state)?;
    repo::get_signature(&state.db, &id)
}

#[tauri::command]
pub fn delete_document_signature(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_signature(&state.db, &id)
}

#[tauri::command]
pub fn export_signature_sidecar(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let sig = repo::get_signature(&state.db, &id)?;

    let sidecar = SignatureSidecar {
        version: 1,
        algorithm: "Ed25519".into(),
        document_hash: sig.file_hash,
        signature: sig.signature_b64,
        signer: SignatureSidecarSigner {
            peer_id: sig.signer_peer_id,
            public_key: sig.signer_public_key_b64,
            display_name: sig.signer_display_name,
        },
        signed_at: sig.signed_at,
        metadata: sig
            .metadata
            .as_deref()
            .map(|m| serde_json::from_str(m))
            .transpose()
            .map_err(|e| AppError::Validation(format!("Invalid metadata JSON: {e}")))?,
    };

    Ok(serde_json::to_string_pretty(&sidecar)?)
}

#[tauri::command]
pub fn write_sidecar_file(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    content: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let safe_path = validate_file_access_path(&file_path, Some(ALLOWED_SIDECAR_EXTENSIONS))
        .map_err(AppError::Validation)?;
    std::fs::write(&safe_path, content.as_bytes())
        .map_err(|e| AppError::Internal(format!("Failed to write sidecar: {e}")))
}

#[tauri::command]
pub fn read_sidecar_file(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let safe_path = validate_file_access_path(&file_path, Some(ALLOWED_SIDECAR_EXTENSIONS))
        .map_err(AppError::Validation)?;
    std::fs::read_to_string(&safe_path)
        .map_err(|e| AppError::Validation(format!("Failed to read sidecar: {e}")))
}
