//! App focus ambient trigger.
//!
//! Monitors the foreground application window and publishes events when the
//! focused app changes. Uses platform-specific APIs (Windows WinAPI).

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

/// Shared state: last known foreground window info.
pub struct AppFocusState {
    last_app_name: Option<String>,
    last_window_title: Option<String>,
}

impl AppFocusState {
    pub fn new() -> Self {
        Self {
            last_app_name: None,
            last_window_title: None,
        }
    }

    /// Read the last known app name (for ambient context change detection).
    pub fn last_app_name(&self) -> Option<&str> {
        self.last_app_name.as_deref()
    }

    /// Read the last known window title (for ambient context change detection).
    pub fn last_window_title(&self) -> Option<&str> {
        self.last_window_title.as_deref()
    }
}

/// Foreground window info returned by platform-specific code.
#[derive(Debug, Clone)]
struct ForegroundWindow {
    app_name: String,
    window_title: String,
}

/// Get the current foreground window info.
///
/// On Windows, uses GetForegroundWindow + GetWindowText + GetProcessImageFileNameW.
/// On other platforms, returns None (not yet implemented).
fn get_foreground_window() -> Option<ForegroundWindow> {
    #[cfg(target_os = "windows")]
    {
        get_foreground_window_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn get_foreground_window_windows() -> Option<ForegroundWindow> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    use windows::Win32::Foundation::{HWND, CloseHandle};
    use windows::Win32::System::Threading::OpenProcess;
    use windows::Win32::System::Threading::PROCESS_QUERY_INFORMATION;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == HWND::default() {
            return None;
        }

        // Get window title
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let window_title = if title_len > 0 && (title_len as usize) <= title_buf.len() {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        // Get process name
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let app_name = if pid != 0 {
            if let Ok(process) = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) {
                let mut name_buf = [0u16; 512];
                let name_len = GetProcessImageFileNameW(process, &mut name_buf);
                let _ = CloseHandle(process);
                if name_len > 0 && (name_len as usize) <= name_buf.len() {
                    let full_path = String::from_utf16_lossy(&name_buf[..name_len as usize]);
                    // Extract just the executable name
                    full_path
                        .rsplit('\\')
                        .next()
                        .unwrap_or(&full_path)
                        .to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        Some(ForegroundWindow {
            app_name,
            window_title,
        })
    }
}

/// Tick function called by the subscription loop.
///
/// 1. Get the current foreground window.
/// 2. Compare with last known state.
/// 3. If changed, check against all enabled `app_focus` triggers and publish matching events.
pub async fn app_focus_tick(
    pool: &DbPool,
    state: &Arc<Mutex<AppFocusState>>,
) {
    // Get foreground window on a blocking thread (uses FFI)
    let window = tokio::task::spawn_blocking(get_foreground_window).await;

    let window = match window {
        Ok(Some(w)) => w,
        _ => return,
    };

    // Check if focus changed
    let changed = {
        let mut s = state.lock().await;
        let was_different = s.last_app_name.as_ref() != Some(&window.app_name)
            || s.last_window_title.as_ref() != Some(&window.window_title);
        if was_different {
            s.last_app_name = Some(window.app_name.clone());
            s.last_window_title = Some(window.window_title.clone());
        }
        was_different
    };

    if !changed {
        return;
    }

    // Load enabled app_focus triggers (SQL-filtered)
    let focus_triggers = match trigger_repo::get_enabled_by_type(pool, "app_focus") {
        Ok(t) => t,
        Err(_) => return,
    };

    if focus_triggers.is_empty() {
        return;
    }

    for trigger in &focus_triggers {
        let config = trigger.parse_config();
        if let TriggerConfig::AppFocus {
            app_names: ref names,
            title_pattern: ref tp,
            event_type,
            ..
        } = config
        {
            // Check app name filter
            if let Some(ref names_list) = names {
                if !names_list.is_empty() {
                    let name_lower = window.app_name.to_lowercase();
                    let matches = names_list.iter().any(|n| name_lower == n.to_lowercase());
                    if !matches {
                        continue;
                    }
                }
            }

            // Check title pattern
            if let Some(ref pattern) = tp {
                match regex::Regex::new(pattern) {
                    Ok(re) => {
                        if !re.is_match(&window.window_title) {
                            continue;
                        }
                    }
                    Err(_) => {
                        if !window.window_title.contains(pattern.as_str()) {
                            continue;
                        }
                    }
                }
            }

            // Publish event
            let payload = serde_json::json!({
                "app_name": window.app_name,
                "window_title": window.window_title,
            });

            let input = CreatePersonaEventInput {
                event_type: event_type.as_deref().unwrap_or("app_focused").into(),
                source_type: "app_focus".into(),
                project_id: None,
                source_id: Some(trigger.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                payload: Some(serde_json::to_string(&payload).unwrap_or_default()),
                use_case_id: trigger.use_case_id.clone(),
            };

            if let Err(e) = event_repo::publish(pool, input) {
                tracing::warn!(trigger_id = %trigger.id, "app_focus publish error: {e}");
            }
        }
    }
}
