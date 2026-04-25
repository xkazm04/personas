use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use chrono::Utc;
use serde::Deserialize;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::db::models::{OcrDocument, OcrResult};
use crate::db::repos::resources::{credentials, ocr as repo};
use crate::db::DbPool;
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

/// Hard cap on bytes sent to a Vision OCR backend. 20 MB matches Gemini's
/// documented inline-data ceiling and keeps base64-encoded payloads within
/// reasonable HTTP body size for any provider; larger files should be
/// pre-split or run through a native PDF text path.
const MAX_OCR_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// Registry of in-flight OCR cancellation tokens, keyed by client-supplied
/// `operation_id`. The `cancel_ocr_operation` command pulls the token out
/// and signals it; the OCR call's `tokio::select!` resolves to the
/// cancellation arm and returns an "OCR cancelled" error.
static OCR_CANCEL_TOKENS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_cancel_token(operation_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    let mut map = OCR_CANCEL_TOKENS.lock().unwrap_or_else(|e| e.into_inner());
    map.insert(operation_id.to_string(), token.clone());
    token
}

fn deregister_cancel_token(operation_id: &str) {
    let mut map = OCR_CANCEL_TOKENS.lock().unwrap_or_else(|e| e.into_inner());
    map.remove(operation_id);
}

/// RAII guard that removes the cancellation token from the registry when
/// the OCR call returns or panics, preventing the map from growing on
/// dropped futures.
struct CancelGuard<'a>(&'a str);
impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        deregister_cancel_token(self.0);
    }
}

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
    operation_id: Option<String>,
) -> Result<OcrResult, AppError> {
    require_auth_sync(&state)?;

    let path = validate_file_access_path(&file_path, Some(ALLOWED_OCR_EXTENSIONS))
        .map_err(AppError::Validation)?;
    if !path.exists() {
        return Err(AppError::Validation(format!("File not found: {file_path}")));
    }
    run_gemini_ocr(&state.db, &path, file_path, &api_key, model, prompt, operation_id).await
}

/// Shared Gemini OCR core. Reads the file, POSTs it to the Generative
/// Language API, parses the response, persists an `OcrDocument` row and
/// returns the result. Used by both `ocr_with_gemini` (API key from form
/// input) and `ocr_drive_file_gemini` (API key resolved from a vault
/// credential).
///
/// When `operation_id` is `Some`, registers a `CancellationToken` so the
/// frontend can call `cancel_ocr_operation` to abort the in-flight
/// reqwest call instead of letting the user pay for tokens on a closed
/// drawer.
async fn run_gemini_ocr(
    pool: &DbPool,
    path: &Path,
    file_path_for_record: String,
    api_key: &str,
    model: Option<String>,
    prompt: Option<String>,
    operation_id: Option<String>,
) -> Result<OcrResult, AppError> {
    let file_size = tokio::fs::metadata(path).await
        .map_err(|e| AppError::Internal(format!("Cannot stat file: {e}")))?
        .len();
    if file_size > MAX_OCR_FILE_BYTES {
        return Err(AppError::Validation(format!(
            "File is too large for OCR ({} MB). Limit is {} MB.",
            file_size / (1024 * 1024),
            MAX_OCR_FILE_BYTES / (1024 * 1024),
        )));
    }

    let file_bytes = tokio::fs::read(path).await
        .map_err(|e| AppError::Internal(format!("Cannot read file: {e}")))?;
    let b64_data = B64.encode(&file_bytes);
    let mime = mime_from_path(path);
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

    let cancel_token = operation_id.as_deref().map(register_cancel_token);
    let _guard = operation_id.as_deref().map(CancelGuard);

    let request_future = SHARED_HTTP.post(&url).json(&body).send();
    let resp = match cancel_token.as_ref() {
        Some(token) => tokio::select! {
            biased;
            _ = token.cancelled() => return Err(AppError::Internal("OCR cancelled".into())),
            r = request_future => r,
        },
        None => request_future.await,
    }
    .map_err(|e| AppError::Internal(format!("Gemini API request failed: {e}")))?;

    let status = resp.status();
    let read_body = resp.text();
    let resp_text = match cancel_token.as_ref() {
        Some(token) => tokio::select! {
            biased;
            _ = token.cancelled() => return Err(AppError::Internal("OCR cancelled".into())),
            t = read_body => t,
        },
        None => read_body.await,
    }
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
        id,
        file_name,
        file_path: Some(file_path_for_record),
        provider: "gemini".into(),
        model: Some(model_name.into()),
        extracted_text,
        structured_data: None,
        prompt,
        duration_ms,
        token_count,
        created_at: now,
    };

    let saved = repo::insert_document(pool, &doc)?;

    Ok(OcrResult {
        document: saved,
        raw_response: Some(resp_text),
    })
}

/// Drive-integrated Gemini OCR. Takes a drive-relative path and a vault
/// credential ID, resolves the managed drive root + sandbox-validates the
/// path, fetches the credential's decrypted `api_key` field, and runs
/// Gemini OCR pinned to the backend default model (`gemini-3-flash-preview`).
///
/// This is the entry point used by the Drive plugin's "Extract text" flow.
#[tauri::command]
pub async fn ocr_drive_file_gemini(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    rel_path: String,
    credential_id: String,
    prompt: Option<String>,
    operation_id: Option<String>,
) -> Result<OcrResult, AppError> {
    require_auth_sync(&state)?;

    // Resolve + sandbox the drive-relative path.
    let root = crate::commands::drive::managed_root(&app)?;
    let abs = crate::commands::drive::resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Drive file not found: {rel_path}")));
    }
    // Extension check — path_safety::ALLOWED_OCR_EXTENSIONS is the source of
    // truth for which file types Gemini OCR accepts.
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_OCR_EXTENSIONS.iter().any(|allowed| *allowed == ext) {
        return Err(AppError::Validation(format!(
            "File type not supported for OCR: .{ext}"
        )));
    }

    // Resolve the Gemini API key from the vault credential.
    let cred = credentials::get_by_id(&state.db, &credential_id)?;
    if cred.service_type != "google_gemini" {
        return Err(AppError::Validation(format!(
            "Credential '{}' is not a Google Gemini credential (service_type='{}')",
            cred.name, cred.service_type
        )));
    }
    let fields = credentials::get_decrypted_fields(&state.db, &cred)?;
    let api_key = fields
        .get("api_key")
        .or_else(|| fields.get("apiKey"))
        .ok_or_else(|| {
            AppError::Validation("Gemini credential is missing an 'api_key' field".into())
        })?
        .clone();

    let abs_display = abs.to_string_lossy().to_string();
    run_gemini_ocr(&state.db, &abs, abs_display, &api_key, None, prompt, operation_id).await
}

/// Cancel an in-flight OCR operation by its client-supplied `operation_id`.
/// Idempotent: returns `Ok(false)` if no token is registered (operation
/// already finished, never started, or already cancelled).
#[tauri::command]
pub async fn cancel_ocr_operation(
    state: State<'_, Arc<AppState>>,
    operation_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let map = OCR_CANCEL_TOKENS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(token) = map.get(&operation_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
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
    run_claude_ocr(&state.db, &path, file_path, prompt).await
}

/// Drive-integrated Claude CLI OCR. Resolves the managed-root sandbox and
/// extension allowlist exactly like `ocr_drive_file_gemini`, then runs the
/// shared Claude OCR core. Uses the user's existing Claude subscription
/// (no vault credential lookup; Claude binary discovery happens inside
/// the core).
#[tauri::command]
pub async fn ocr_drive_file_claude(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    rel_path: String,
    prompt: Option<String>,
) -> Result<OcrResult, AppError> {
    require_auth_sync(&state)?;

    let root = crate::commands::drive::managed_root(&app)?;
    let abs = crate::commands::drive::resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Drive file not found: {rel_path}")));
    }
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_OCR_EXTENSIONS.iter().any(|allowed| *allowed == ext) {
        return Err(AppError::Validation(format!(
            "File type not supported for OCR: .{ext}"
        )));
    }

    let abs_display = abs.to_string_lossy().to_string();
    run_claude_ocr(&state.db, &abs, abs_display, prompt).await
}

/// Shared Claude CLI OCR core. Reads the file, base64-encodes it into a
/// stdin-piped prompt, spawns the Claude binary, and persists an
/// `OcrDocument`. Used by both `ocr_with_claude` (legacy form-input flow)
/// and `ocr_drive_file_claude` (drive sandbox flow).
async fn run_claude_ocr(
    pool: &DbPool,
    path: &Path,
    file_path_for_record: String,
    prompt: Option<String>,
) -> Result<OcrResult, AppError> {
    let file_size = std::fs::metadata(path)
        .map_err(|e| AppError::Internal(format!("Cannot stat file: {e}")))?
        .len();
    if file_size > MAX_OCR_FILE_BYTES {
        return Err(AppError::Validation(format!(
            "File is too large for OCR ({} MB). Limit is {} MB.",
            file_size / (1024 * 1024),
            MAX_OCR_FILE_BYTES / (1024 * 1024),
        )));
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let user_prompt = prompt.clone().unwrap_or_else(|| OCR_SYSTEM_PROMPT.to_string());

    // Read the file and encode as base64 so Claude can process it directly
    let file_bytes = std::fs::read(path)
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;
    let file_b64 = B64.encode(&file_bytes);

    // Detect MIME type from extension
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };

    // Build prompt with embedded file content for Claude to process
    let full_prompt = format!(
        "I have a file named '{}' (type: {}) encoded in base64 below. \
         Extract all text from this image/document.\n\n\
         Instructions: {}\n\n\
         Base64 content:\ndata:{};base64,{}\n\n\
         IMPORTANT: Output ONLY the extracted text. No commentary, no markdown code fences, \
         no explanation. Just the raw extracted text.",
        file_name, mime, user_prompt, mime, file_b64
    );

    // Find Claude Code binary
    use crate::engine::provider::CliProvider;
    let candidates = crate::engine::provider::claude::ClaudeProvider.binary_candidates();
    #[cfg(any(feature = "desktop", feature = "test-automation"))]
    let binary = candidates.iter()
        .find_map(|name| which::which(name).ok())
        .ok_or_else(|| AppError::Internal("Claude Code CLI not found in PATH".into()))?;
    // Fallback PATH search when the `which` crate isn't linked (default-feature
    // builds). Mirrors which::which's behavior: look for each candidate name
    // in each PATH entry, honoring platform-specific extension suffixes.
    #[cfg(not(any(feature = "desktop", feature = "test-automation")))]
    let binary = {
        let path_var = std::env::var_os("PATH").unwrap_or_default();
        let exts: &[&str] = if cfg!(target_os = "windows") {
            &["", ".exe", ".cmd", ".bat"]
        } else {
            &[""]
        };
        candidates.iter().find_map(|name| {
            std::env::split_paths(&path_var).find_map(|dir| {
                for ext in exts {
                    let candidate = dir.join(format!("{name}{ext}"));
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
                None
            })
        })
        .ok_or_else(|| AppError::Internal("Claude Code CLI not found in PATH".into()))?
    };

    let start = Instant::now();

    // Spawn Claude CLI with prompt piped via stdin to avoid OS argument length limits
    // (base64-encoded images can be very large).
    // On Windows, Claude CLI is a .cmd wrapper — must use cmd /c.
    let output = {
        use tokio::io::AsyncWriteExt;

        #[cfg(target_os = "windows")]
        let mut child = tokio::process::Command::new("cmd")
            .args(["/c", binary.to_str().unwrap_or("claude"), "-p", "-", "--output-format", "text"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to spawn Claude Code: {e}")))?;

        #[cfg(not(target_os = "windows"))]
        let mut child = tokio::process::Command::new(&binary)
            .args(&["-p", "-", "--output-format", "text"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to spawn Claude Code: {e}")))?;

        // Write prompt to stdin then close it
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(full_prompt.as_bytes()).await
                .map_err(|e| AppError::Internal(format!("Failed to write to Claude stdin: {e}")))?;
            drop(stdin); // Close stdin so Claude starts processing
        }

        child.wait_with_output().await
            .map_err(|e| AppError::Internal(format!("Failed to read Claude output: {e}")))?
    };

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
        file_path: Some(file_path_for_record),
        provider: "claude".into(),
        model: Some("claude-code-cli".into()),
        extracted_text,
        structured_data: None,
        prompt,
        duration_ms,
        token_count: None,
        created_at: now,
    };

    let saved = repo::insert_document(pool, &doc)?;

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
