//! Boot phase: the `personas://` deep-link handler.

use tauri::Emitter;

use crate::commands;
use crate::engine::event_registry::event_name;

/// A navigation-only `personas://` route: open a persona or an execution.
///
/// These routes never run, cancel, create or change anything, so they need no
/// confirmation. Any web page can open a `personas://` link, so the id is
/// validated here and again on the frontend.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NavLink {
    Persona(String),
    Execution(String),
}

/// The host of a `personas://persona/..` or `personas://execution/..` URL,
/// valid or not, so a malformed one is dropped with a warning instead of
/// falling through to the other routes.
fn nav_host(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "personas" {
        return None;
    }
    match url.host_str() {
        Some(h @ ("persona" | "execution")) => Some(h.to_string()),
        _ => None,
    }
}

/// Parse `personas://persona/<id>` or `personas://execution/<id>`.
///
/// Returns `None` for any other URL, including these hosts with extra path
/// segments or a malformed id. A query or fragment is ignored, never forwarded.
pub(crate) fn parse_nav_link(raw: &str) -> Option<NavLink> {
    let host = nav_host(raw)?;
    let url = url::Url::parse(raw).ok()?;
    let mut segments = url.path_segments()?;
    let id = segments.next()?;
    // Exactly one segment; a trailing slash yields one extra empty segment.
    match segments.next() {
        None | Some("") => {}
        Some(_) => return None,
    }
    if segments.next().is_some() || !is_valid_nav_id(id) {
        return None;
    }
    Some(if host == "persona" {
        NavLink::Persona(id.to_string())
    } else {
        NavLink::Execution(id.to_string())
    })
}

/// `^[A-Za-z0-9_-]{1,64}$`
fn is_valid_nav_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

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
                } else if let Some(host) = nav_host(&url_str) {
                    // Navigation-only routes. Never log the id or the query:
                    // any web page can craft this URL.
                    match parse_nav_link(&url_str) {
                        Some(NavLink::Persona(id)) => {
                            let _ = dl_handle.emit(
                                event_name::PERSONA_LINK_OPENED,
                                serde_json::json!({ "personaId": id }),
                            );
                        }
                        Some(NavLink::Execution(id)) => {
                            let _ = dl_handle.emit(
                                event_name::EXECUTION_LINK_OPENED,
                                serde_json::json!({ "executionId": id }),
                            );
                        }
                        None => {
                            tracing::warn!(host = %host, "dropped malformed navigation deep link")
                        }
                    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str) -> Option<NavLink> {
        Some(NavLink::Persona(id.to_string()))
    }
    fn e(id: &str) -> Option<NavLink> {
        Some(NavLink::Execution(id.to_string()))
    }

    #[test]
    fn valid_ids_route() {
        assert_eq!(
            parse_nav_link("personas://persona/abc-123_X"),
            p("abc-123_X")
        );
        assert_eq!(
            parse_nav_link("personas://execution/0f8fad5b-d9cb-469f-a165-70867728950e"),
            e("0f8fad5b-d9cb-469f-a165-70867728950e")
        );
        let max = "a".repeat(64);
        assert_eq!(
            parse_nav_link(&format!("personas://persona/{max}")),
            p(&max)
        );
    }

    #[test]
    fn trailing_slash_is_allowed() {
        assert_eq!(parse_nav_link("personas://persona/abc/"), p("abc"));
        assert_eq!(parse_nav_link("personas://execution/abc/"), e("abc"));
    }

    #[test]
    fn extra_segments_are_dropped() {
        assert_eq!(parse_nav_link("personas://persona/abc/def"), None);
        assert_eq!(parse_nav_link("personas://execution/abc//"), None);
        assert_eq!(parse_nav_link("personas://persona/abc/def/"), None);
        assert_eq!(parse_nav_link("personas://persona/"), None);
        assert_eq!(parse_nav_link("personas://persona"), None);
    }

    #[test]
    fn query_and_fragment_are_ignored_not_forwarded() {
        assert_eq!(parse_nav_link("personas://persona/abc?x=1"), p("abc"));
        assert_eq!(parse_nav_link("personas://execution/abc#frag"), e("abc"));
    }

    #[test]
    fn ids_failing_the_pattern_are_dropped() {
        for bad in [
            "personas://persona/a%20b",
            "personas://persona/a.b",
            "personas://persona/..",
            "personas://persona/a%2Fb",
            "personas://persona/%C3%A9",
        ] {
            assert_eq!(parse_nav_link(bad), None, "{bad}");
        }
        let long = "a".repeat(65);
        assert_eq!(
            parse_nav_link(&format!("personas://execution/{long}")),
            None
        );
    }

    #[test]
    fn wrong_scheme_or_host_is_not_a_nav_link() {
        assert_eq!(parse_nav_link("https://persona/abc"), None);
        assert_eq!(parse_nav_link("personas://personas/abc"), None);
        assert_eq!(parse_nav_link("personas://persona.evil.com/abc"), None);
    }

    #[test]
    fn existing_routes_are_not_nav_links() {
        for u in [
            "personas://auth/callback?code=x",
            "personas://share?d=x",
            "personas://import/some-slug",
            "personas://ref/code1",
            "personas://pair?origin=x",
        ] {
            assert_eq!(parse_nav_link(u), None, "{u}");
            assert_eq!(nav_host(u), None, "{u}");
        }
    }

    #[test]
    fn nav_host_detects_malformed_nav_urls() {
        assert_eq!(
            nav_host("personas://persona/bad.id").as_deref(),
            Some("persona")
        );
        assert_eq!(
            nav_host("personas://execution").as_deref(),
            Some("execution")
        );
        assert_eq!(nav_host("https://persona/x"), None);
    }
}
