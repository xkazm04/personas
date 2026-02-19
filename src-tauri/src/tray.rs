use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::db::repos::executions as exec_repo;
use crate::engine::background;
use crate::AppState;

/// Set up the system tray. Called once from `lib.rs` setup.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app)?;

    TrayIconBuilder::with_id("main")
        .tooltip("Personas Desktop")
        .menu(&menu)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Rebuild the tray menu to reflect current state. Safe to call from any thread.
pub fn refresh_tray(app: &AppHandle) {
    if let Ok(menu) = build_tray_menu(app) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------

fn build_tray_menu(
    app: &AppHandle,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let state: &Arc<AppState> = &app.state::<Arc<AppState>>();
    let scheduler_running = state.scheduler.is_running();

    let status_label = if scheduler_running {
        "Scheduler: Active"
    } else {
        "Scheduler: Paused"
    };

    let toggle_label = if scheduler_running {
        "Pause Scheduler"
    } else {
        "Resume Scheduler"
    };

    // Recent executions
    let recent_labels = recent_execution_labels(state, 3);

    let mut builder = MenuBuilder::new(app);

    builder = builder
        .item(
            &MenuItemBuilder::with_id("show_hide", "Show / Hide Window").build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("scheduler_status", status_label)
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_scheduler", toggle_label).build(app)?,
        )
        .separator();

    if recent_labels.is_empty() {
        builder = builder.item(
            &MenuItemBuilder::with_id("no_recent", "No recent executions")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for (i, label) in recent_labels.iter().enumerate() {
            builder = builder.item(
                &MenuItemBuilder::with_id(format!("recent_{}", i), label.as_str())
                    .enabled(false)
                    .build(app)?,
            );
        }
    }

    builder = builder.separator().item(
        &MenuItemBuilder::with_id("quit", "Quit Personas").build(app)?,
    );

    Ok(builder.build()?)
}

// ---------------------------------------------------------------------------
// Menu event handler
// ---------------------------------------------------------------------------

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "show_hide" => {
            if let Some(win) = app.get_webview_window("main") {
                if win.is_visible().unwrap_or(false) {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        }
        "toggle_scheduler" => {
            let state: &Arc<AppState> = &app.state::<Arc<AppState>>();
            if state.scheduler.is_running() {
                background::stop_loops(&state.scheduler);
            } else {
                background::start_loops(
                    state.scheduler.clone(),
                    app.clone(),
                    state.db.clone(),
                    state.engine.clone(),
                );
            }
            refresh_tray(app);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn recent_execution_labels(state: &AppState, limit: usize) -> Vec<String> {
    let execs = match exec_repo::get_recent(&state.db, Some(limit as i64)) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    // Look up persona names
    let personas = crate::db::repos::personas::get_all(&state.db).unwrap_or_default();
    let name_for = |pid: &str| -> &str {
        personas
            .iter()
            .find(|p| p.id == pid)
            .map(|p| p.name.as_str())
            .unwrap_or("Unknown")
    };

    execs
        .iter()
        .map(|e| {
            let icon = match e.status.as_str() {
                "completed" => "OK",
                "failed" => "FAIL",
                "running" => "RUN",
                "cancelled" => "STOP",
                _ => &e.status,
            };
            let short_ts = if e.created_at.len() >= 16 {
                &e.created_at[..16]
            } else {
                &e.created_at
            };
            format!("[{}] {} - {}", icon, name_for(&e.persona_id), short_ts)
        })
        .collect()
}
