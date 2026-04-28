//! Test-only Tauri commands. Compiled in only when the
//! `test-automation` feature is on, so they don't ship in production
//! builds. The bridge in `src/test/automation/bridge.ts` calls these
//! over the standard IPC plumbing — it just needs the command to exist
//! in the invoke handler.
//!
//! Why this lives in its own module instead of being inlined in
//! `test_automation.rs`: these are real `#[tauri::command]`s that need
//! to run on the Tauri runtime (DB pool, AppHandle, async). The HTTP
//! layer in `test_automation.rs` is a separate axum server that
//! forwards method names to the JS bridge — that's a different shape
//! than what we need here.

pub mod synthesize_review;
