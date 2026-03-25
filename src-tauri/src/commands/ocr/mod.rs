use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use chrono::Utc;
use serde::Deserialize;
use tauri::State;

use crate::db::models::{OcrDocument, OcrResult};
use crate::db::repos::resources::ocr as repo;
use crate::engine::path_safety::{validate_file_access_path, ALLOWED_OCR_EXTENSIONS};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;
use crate::SHARED_HTTP;

// ---------------------------------------------------------------------------
// Gemini Vision OCR
// ---------------------------------------------------------------------------

const DEFAULT_GEMINI_MODEL: &str = "gemini-3-flash-preview";
const OCR_SYSTEM_PROMPT: &str =
    "Extract ALL text from this image/document. Preserve the original structure, \
     paragraphs, headers, lists, and tables as closely as possible. \
     Return ONLY the extracted text, no commentary.";

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsage>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiUsage {
    #[serde(rename = "totalTokenCount")]
    total_token_count: Option<u32>,
}

/// Detect MIME type from file extension.
fn mime_from_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("bmp") => "image/bmp",
        Some("tiff" | "tif") => "image/tiff",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub async fn ocr_with_gemini(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    api_key: String,
    model: Option<String>,
    prompt: Option<String>,
) -> Result<OcrResult, AppError> {
    require_auth_sync(&state)?;

    let path = validate_file_access_path(&file_path, Some(ALLOWED_OCR_EXTENSIONS))
        .map_err(AppError::Validation)?;
    if !path.exists() {
        return Err(AppError::Validation(format!("File not found: {file_path}")));
    }

    let file_bytes = tokio::fs::read(&path).await
        .map_err(|e| AppError::Internal(format!("Cannot read file: {e}")))?;
    let b64_data = B64.encode(&file_bytes);
    let mime = mime_from_path(&path);
    let model_name = model.as_deref().unwrap_or(DEFAULT_GEMINI_MODEL);
    let user_prompt = prompt.as_deref().unwrap_or(OCR_SYSTEM_PROMPT);

    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": user_prompt },
                { "inlineData": { "mimeType": mime, "data": b64_data } }
            ]
        }]
    });

    let start = Instant::now();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model_name, api_key
    );

    let resp = SHARED_HTTP.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Gemini API request failed: {e}")))?;

    let status = resp.status();
    let resp_text = resp.text().await
        .map_err(|e| AppError::Internal(format!("Failed to read Gemini response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!("Gemini API error ({}): {}", status, resp_text)));
    }

    let duration_ms = start.elapsed().as_millis() as i64;

    let gemini: GeminiResponse = serde_json::from_str(&resp_text)
        .map_err(|e| AppError::Internal(format!("Failed to parse Gemini response: {e}")))?;

    let extracted_text = gemini.candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.clone())
        .unwrap_or_default();

    let token_count = gemini.usage_metadata
        .and_then(|u| u.total_token_count);

    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let doc = OcrDocument {
        id: id.clone(),
        file_name,
        file_path: Some(file_path),
        provider: "gemini".into(),
        model: Some(model_name.into()),
        extracted_text,
        structured_data: None,
        prompt: prompt,
        duration_ms,
        token_count,
        created_at: now,
    };

    let saved = repo::insert_document(&state.db, &doc)?;

    Ok(OcrResult {
        document: saved,
        raw_response: Some(resp_text),
    })
}

// ---------------------------------------------------------------------------
// Claude CLI OCR (uses subscription, no API key needed)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ocr_with_claude(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    prompt: Option<String>,
) -> Result<OcrResult, AppError> {
    require_auth_sync(&state)?;

    let path = validate_file_access_path(&file_path, Some(ALLOWED_OCR_EXTENSIONS))
        .map_err(AppError::Validation)?;
    if !path.exists() {
        return Err(AppError::Validation(format!("File not found: {file_path}")));
    }

    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let user_prompt = prompt.clone().unwrap_or_else(|| OCR_SYSTEM_PROMPT.to_string());

    // Build the prompt that instructs Claude Code to read the image and extract text
    let full_prompt = format!(
        "Read the file at the following path and extract all text from it.\n\
         Path: {}\n\n\
         Instructions: {}\n\n\
         IMPORTANT: Output ONLY the extracted text. No commentary, no markdown code fences, \
         no explanation. Just the raw extracted text.",
        file_path, user_prompt
    );

    // Find Claude Code binary
    use crate::engine::provider::CliProvider;
    let candidates = crate::engine::provider::claude::ClaudeProvider.binary_candidates();
    let binary = candidates.iter()
        .find_map(|name| which::which(name).ok())
        .ok_or_else(|| AppError::Internal("Claude Code CLI not found in PATH".into()))?;

    let start = Instant::now();

    // Spawn claude with -p flag for non-interactive single-prompt mode
    let output = tokio::process::Command::new(&binary)
        .args(&["-p", &full_prompt, "--output-format", "text"])
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn Claude Code: {e}")))?;

    let duration_ms = start.elapsed().as_millis() as i64;

    let extracted_text = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!("Claude Code failed: {stderr}")));
    };

    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let doc = OcrDocument {
        id,
        file_name,
        file_path: Some(file_path),
        provider: "claude".into(),
        model: Some("claude-code-cli".into()),
        extracted_text,
        structured_data: None,
        prompt,
        duration_ms,
        token_count: None,
        created_at: now,
    };

    let saved = repo::insert_document(&state.db, &doc)?;

    Ok(OcrResult {
        document: saved,
        raw_response: None,
    })
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_ocr_documents(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<OcrDocument>, AppError> {
    require_auth_sync(&state)?;
    repo::list_documents(&state.db)
}

#[tauri::command]
pub fn get_ocr_document(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<OcrDocument, AppError> {
    require_auth_sync(&state)?;
    repo::get_document(&state.db, &id)
}

#[tauri::command]
pub fn delete_ocr_document(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_document(&state.db, &id)
}
