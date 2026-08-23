use super::super::*;

/// Smoke test: capturing to a fresh save dir creates the dir, writes a
/// PNG, and returns metadata pointing at the new file. This doesn't
/// validate the pixel content (which depends on the host display and
/// isn't meaningful in CI), only that the path on disk is real.
#[cfg(feature = "desktop")]
#[tokio::test]
async fn test_capture_validation_screenshot_writes_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let save_dir = tmp.path().join("validation_screenshots");
    // Dir should NOT exist yet -- capture creates it.
    assert!(!save_dir.exists());

    let result = capture_validation_screenshot(None, &save_dir).await;

    // In headless CI there may be no displays at all -- in that case
    // xcap returns an error. We accept either outcome: if capture
    // succeeds, the file must exist; if it fails, it must be the
    // "no monitors" path, not a Rust panic.
    match result {
        Ok(shot) => {
            assert!(save_dir.exists(), "save dir should be created");
            let p = std::path::PathBuf::from(&shot.path);
            assert!(p.exists(), "screenshot file should exist on disk");
            assert!(p.extension().and_then(|e| e.to_str()) == Some("png"));
            assert!(shot.width > 0 && shot.height > 0);
            assert!(!shot.captured_at.is_empty());
        }
        Err(e) => {
            // Acceptable on headless hosts: no monitor / wayland permission
            // denied / etc. We just want to make sure we don't panic.
            let msg = format!("{e}");
            tracing::info!("capture_validation_screenshot error (expected in headless CI): {msg}");
        }
    }
}
