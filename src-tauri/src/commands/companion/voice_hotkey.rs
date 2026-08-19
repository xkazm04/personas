//! OS-level push-to-talk accelerator for Athena.
//!
//! Every other half of the voice stack already exists — local whisper STT,
//! Kokoro TTS, `useHoldToTalk`, the orb quick-input bar — but all of it is
//! armed from inside the WebView, so voice was reachable only while the
//! Personas window had focus. This registers a global accelerator so the user
//! can talk to Athena from whatever app they are actually working in.
//!
//! # Shape
//!
//! The frontend owns the binding (persisted in `companionPluginSlice` next to
//! the rest of the voice settings) and pushes it down here on mount and on
//! every change. Rust deliberately holds **no default**: duplicating the
//! accelerator string on both sides is how the two drift, and the window has
//! to exist for a captured turn to go anywhere regardless, so "not registered
//! until the frontend has mounted once" costs nothing real.
//!
//! Registration is last-write-wins — each call unregisters the previous
//! binding first, so a rebind cannot leak the old accelerator. Passing `None`
//! unregisters and stays unregistered, which is how the settings toggle turns
//! the feature off.
//!
//! On fire the window is shown/unminimized/focused (the same sequence the tray
//! click uses in `crate::tray`) and `companion://hotkey` is emitted for the
//! always-mounted chat engine to arm capture. Showing the window is not
//! incidental: the mic, the STT engine and the TTS playback all live in the
//! WebView, so a hidden window has nothing to capture with.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Event the frontend listens on to arm hold-to-talk.
pub const HOTKEY_EVENT: &str = "companion://hotkey";

/// The currently-registered accelerator, so the next rebind knows what to
/// unregister. `None` = nothing registered.
static ACTIVE: Mutex<Option<String>> = Mutex::new(None);

/// Unregister whatever is currently bound. Best-effort: an accelerator that
/// the OS already dropped (or that never took) must not wedge a rebind.
fn clear_active(app: &AppHandle) {
    let mut active = match ACTIVE.lock() {
        Ok(a) => a,
        // A poisoned lock here would permanently disable rebinding, which is
        // worse than re-registering over a stale entry.
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(previous) = active.take() {
        if let Ok(shortcut) = previous.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }
}

/// Bind (or with `accelerator: None`, unbind) Athena's push-to-talk key.
///
/// `accelerator` is a Tauri accelerator string such as `CmdOrCtrl+Shift+A`.
/// A malformed string is a `Validation` error and leaves the previous binding
/// cleared rather than silently keeping it — the user asked for a change, so
/// reporting the failure beats pretending the old key is the new one.
///
/// Returns `true` when a binding is now active, `false` when the feature is
/// off.
#[tauri::command]
pub fn companion_set_voice_hotkey(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    accelerator: Option<String>,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;

    clear_active(&app);

    let Some(accelerator) = accelerator.filter(|a| !a.trim().is_empty()) else {
        tracing::info!("Athena push-to-talk hotkey disabled");
        return Ok(false);
    };

    let shortcut: Shortcut = accelerator.parse().map_err(|_| {
        AppError::Validation(format!("Not a valid shortcut: '{accelerator}'"))
    })?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            // Fire on press only. Without this the release event runs the
            // whole sequence a second time and the turn is armed twice.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if let Err(err) = app.emit(HOTKEY_EVENT, ()) {
                tracing::warn!(error = %err, "Failed to emit companion hotkey event");
            }
        })
        .map_err(|err| {
            // The usual cause is another application already owning the
            // combination. Surface it so the settings UI can tell the user to
            // pick a different one instead of leaving them with a dead key.
            AppError::Validation(format!(
                "Could not register '{accelerator}' — another application may already use it ({err})"
            ))
        })?;

    match ACTIVE.lock() {
        Ok(mut active) => *active = Some(accelerator.clone()),
        Err(poisoned) => *poisoned.into_inner() = Some(accelerator.clone()),
    }
    tracing::info!(accelerator = %accelerator, "Athena push-to-talk hotkey registered");
    Ok(true)
}
