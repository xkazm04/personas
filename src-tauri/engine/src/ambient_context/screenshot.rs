use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Validation Screenshot Capture
// ---------------------------------------------------------------------------
//
// Lets a persona screenshot a target window (or the full primary screen) and
// feed the resulting PNG back into the LLM for visual verification -- e.g.
// confirming a UI change landed after editing a file or restarting an app.
//
// This is a *capability*, not a default behaviour. runner.rs does NOT
// auto-screenshot; a persona opts in by calling
// `capture_validation_screenshot` explicitly. The resulting file lives under
// `<app_data_dir>/validation_screenshots/` so downstream tools can read it
// back via the standard multimodal Read path.

/// Metadata returned from a validation screenshot capture.
#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValidationScreenshot {
    /// Absolute path to the saved PNG on disk.
    pub path: String,
    /// RFC3339 timestamp when the capture completed.
    pub captured_at: String,
    /// The window title we captured. For full-screen captures this is the
    /// display name (e.g. "Screen 1").
    pub window_title: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

/// Maximum age of a stored validation screenshot before the auto-prune
/// housekeeping sweep deletes it. Keeps the directory from growing unbounded
/// when a persona loops on validation-heavy tasks.
#[cfg(feature = "desktop")]
const VALIDATION_SCREENSHOT_MAX_AGE: std::time::Duration =
    std::time::Duration::from_secs(24 * 60 * 60); // 24 hours

/// Capture a screenshot of a target window (if its title matches
/// `target_window_title`) or the primary display when no title is given or
/// no matching window is found. Saves the result as a PNG under
/// `<save_dir>/validation_<timestamp>.png` and returns metadata the agent
/// can use to read it back.
///
/// Designed for visual validation loops:
///   1. Agent makes a UI change (writes a file, restarts an app, etc.)
///   2. Agent calls this function to capture the current state
///   3. Agent reads the resulting PNG via its multimodal Read path
///   4. Agent confirms the change worked or iterates
///
/// NOTE: full-screen capture is the current fallback. `xcap 0.7`
/// per-window captures are inconsistent on Wayland, so the match logic
/// stays conservative until upstream stabilizes.
#[cfg(feature = "desktop")]
pub async fn capture_validation_screenshot(
    target_window_title: Option<&str>,
    save_dir: &std::path::Path,
) -> Result<ValidationScreenshot, personas_core::error::AppError> {
    use personas_core::error::AppError;

    // Ensure the save dir exists before any capture attempts.
    tokio::fs::create_dir_all(save_dir).await.map_err(|e| {
        AppError::Internal(format!(
            "Failed to create validation screenshot dir {}: {e}",
            save_dir.display()
        ))
    })?;

    // Opportunistic prune of old captures. Failures here are non-fatal --
    // we don't want a housekeeping hiccup to block the primary operation.
    if let Err(e) = prune_old_validation_screenshots(save_dir).await {
        tracing::debug!("Validation screenshot prune failed (non-fatal): {e}");
    }

    // Clone the target title into an owned String so the synchronous
    // spawn_blocking closure can own its captured data.
    let target_title_owned = target_window_title.map(|s| s.to_string());
    let save_dir_owned = save_dir.to_path_buf();

    // xcap's capture API is blocking + not Send-safe across awaits, so run
    // it on a blocking thread.
    let result = tokio::task::spawn_blocking(
        move || -> Result<ValidationScreenshot, String> {
            use xcap::{Monitor, Window};

            // First, try to find a window by title (exact, then substring).
            let mut captured: Option<(image::RgbaImage, String)> = None;

            if let Some(ref wanted) = target_title_owned {
                if let Ok(windows) = Window::all() {
                    // Prefer an exact title match.
                    let hit = windows
                        .iter()
                        .find(|w| w.title().map(|t| t == *wanted).unwrap_or(false))
                        .or_else(|| {
                            // Fall back to substring match.
                            windows.iter().find(|w| {
                                w.title()
                                    .map(|t| t.contains(wanted.as_str()))
                                    .unwrap_or(false)
                            })
                        });
                    if let Some(w) = hit {
                        match w.capture_image() {
                            Ok(img) => {
                                let title = w
                                    .title()
                                    .ok()
                                    .unwrap_or_else(|| wanted.clone());
                                captured = Some((img, title));
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Per-window capture failed for '{wanted}': {e}. Falling back to primary display."
                                );
                            }
                        }
                    }
                }
            }

            // Fall back to the primary monitor when window capture didn't
            // happen (no target supplied, no match, or capture failure).
            if captured.is_none() {
                let monitors = Monitor::all()
                    .map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
                let primary = monitors
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No monitors available for capture".to_string())?;
                let title = primary
                    .name()
                    .ok()
                    .unwrap_or_else(|| "Primary Display".to_string());
                let img = primary
                    .capture_image()
                    .map_err(|e| format!("Monitor capture failed: {e}"))?;
                captured = Some((img, title));
            }

            let (img, window_title) =
                captured.ok_or_else(|| "No capture produced".to_string())?;
            let width = img.width();
            let height = img.height();

            let ts = chrono::Utc::now();
            let filename = format!(
                "validation_{}.png",
                ts.format("%Y%m%dT%H%M%S%.3fZ")
            );
            let path = save_dir_owned.join(&filename);
            img.save(&path)
                .map_err(|e| format!("Failed to write PNG to {}: {e}", path.display()))?;

            Ok(ValidationScreenshot {
                path: path.to_string_lossy().to_string(),
                captured_at: ts.to_rfc3339(),
                window_title,
                width,
                height,
            })
        },
    )
    .await
    .map_err(|e| AppError::Internal(format!("Capture task join error: {e}")))?;

    result.map_err(AppError::Internal)
}

/// Delete screenshots older than `VALIDATION_SCREENSHOT_MAX_AGE` from the
/// save directory. Silently skips files it can't stat.
#[cfg(feature = "desktop")]
async fn prune_old_validation_screenshots(
    save_dir: &std::path::Path,
) -> Result<(), std::io::Error> {
    let mut entries = match tokio::fs::read_dir(save_dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(VALIDATION_SCREENSHOT_MAX_AGE)
        .unwrap_or(std::time::UNIX_EPOCH);
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        if let Ok(meta) = entry.metadata().await {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = tokio::fs::remove_file(&path).await;
                }
            }
        }
    }
    Ok(())
}
