//! Boot phase: the `personas://` deep-link handler.

use tauri::Emitter;

use crate::commands;
use crate::engine::event_registry::event_name;

// Deep-link handler for OAuth callbacks and share links
pub fn register_deep_link_handler(app: &tauri::App) {
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let dl_handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
            let urls = event.urls();
            tracing::info!("Deep-link on_open_url fired with {} URL(s)", urls.len());
            for url in urls {
                let url_str = url.to_string();
                tracing::info!("Deep-link URL received: {}", url_str);
                if url_str.starts_with("personas://auth/callback") {
                    let handle = dl_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) =
                            commands::infrastructure::auth::handle_auth_callback(&handle, &url_str)
                                .await
                        {
                            tracing::error!("Auth callback failed: {}", e);
                            let _ = handle.emit(
                                event_name::AUTH_ERROR,
                                serde_json::json!({
                                    "error": format!("{}", e)
                                }),
                            );
                        }
                    });
                } else if url_str.starts_with("personas://share") {
                    // Share link deep link: emit event to frontend so it can
                    // auto-open the import dialog with the deep link URL.
                    tracing::info!("Share deep link received: {}", url_str);
                    let _ = dl_handle.emit(
                        event_name::SHARE_LINK_RECEIVED,
                        serde_json::json!({ "url": url_str }),
                    );
                } else if let Some(slug) = url_str.strip_prefix("personas://import/") {
                    // Gallery import deep link: hand the slug to the frontend,
                    // which calls gallery_import_persona + refreshes the list.
                    let slug = slug.trim_end_matches('/').to_string();
                    tracing::info!("Gallery import deep link received: slug={}", slug);
                    let _ = dl_handle.emit(
                        event_name::GALLERY_IMPORT_REQUESTED,
                        serde_json::json!({ "slug": slug }),
                    );
                } else if let Some(code) = url_str.strip_prefix("personas://ref/") {
                    // Referral deep link: hand the referrer code to the frontend,
                    // which captures it once for attribution on activation.
                    let code = code.trim_end_matches('/').to_string();
                    tracing::info!("Referral deep link received: code={}", code);
                    let _ = dl_handle.emit(
                        event_name::REFERRAL_RECEIVED,
                        serde_json::json!({ "code": code }),
                    );
                } else if url_str.starts_with("personas://pair") {
                    // Pairing deep link (Direction 1): register a pending
                    // pairing and surface the approval modal to the user.
                    match crate::engine::pairing::register_from_deep_link(&url_str) {
                        Ok(view) => {
                            tracing::info!(origin = %view.origin, "pairing deep link received");
                            let _ = dl_handle.emit(event_name::PAIRING_REQUESTED, &view);
                        }
                        Err(e) => tracing::warn!("bad pairing deep link: {}", e),
                    }
                }
            }
        });

        // Register the personas:// protocol handler.
        // Required for OAuth callback deep links in both dev and production.
        #[cfg(feature = "desktop")]
        {
            match app.deep_link().register_all() {
                Ok(_) => tracing::info!("Deep-link protocol registered successfully"),
                Err(e) => tracing::error!("Deep-link protocol registration failed: {}", e),
            }
        }
    }
}
