use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A stored document signature record.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DocumentSignature {
    pub id: String,
    pub file_name: String,
    pub file_path: Option<String>,
    pub file_hash: String,
    pub signature_b64: String,
    pub signer_peer_id: String,
    pub signer_public_key_b64: String,
    pub signer_display_name: String,
    pub metadata: Option<String>,
    pub signed_at: String,
    pub created_at: String,
}

/// Input for creating a new signature (returned by sign operation).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SignDocumentResult {
    pub signature: DocumentSignature,
    /// The detached signature JSON that can be saved alongside the document.
    pub sidecar_json: String,
}

/// Input for verifying a document signature.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyDocumentInput {
    /// Path to the file to verify.
    pub file_path: String,
    /// The sidecar JSON string (contents of .sig.json).
    pub sidecar_json: String,
}

/// Result of a document verification.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyDocumentResult {
    pub valid: bool,
    pub signer_peer_id: String,
    pub signer_display_name: String,
    pub signed_at: String,
    pub file_hash_match: bool,
    pub signature_valid: bool,
    pub error: Option<String>,
}

/// The portable sidecar format written to .sig.json files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureSidecar {
    pub version: u32,
    pub algorithm: String,
    pub document_hash: String,
    pub signature: String,
    pub signer: SignatureSidecarSigner,
    pub signed_at: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureSidecarSigner {
    pub peer_id: String,
    pub public_key: String,
    pub display_name: String,
}
