use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A stored OCR extraction result.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OcrDocument {
    pub id: String,
    pub file_name: String,
    pub file_path: Option<String>,
    pub provider: String,
    pub model: Option<String>,
    pub extracted_text: String,
    pub structured_data: Option<String>,
    pub prompt: Option<String>,
    pub duration_ms: i64,
    pub token_count: Option<u32>,
    pub created_at: String,
}

/// Result returned from an OCR operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OcrResult {
    pub document: OcrDocument,
    pub raw_response: Option<String>,
}
