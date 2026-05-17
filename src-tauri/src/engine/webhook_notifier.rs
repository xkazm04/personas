//! Outbound webhook notifier — routes persona_events to user-configured
//! Slack/Discord/Teams/generic JSON webhooks via Mustache-style templates.
//!
//! ## Loop architecture
//!
//! A tokio task ticks every `DISPATCH_TICK_INTERVAL`. Each tick:
//! 1. Loads the dispatch watermark (highest event `created_at` already
//!    processed).
//! 2. Fetches persona_events newer than the watermark, bounded by
//!    `MAX_EVENTS_PER_TICK` to bound burst cost.
//! 3. For each enabled subscription, matches the event_type against the
//!    subscription's pattern list (exact match or `prefix.*` wildcard).
//! 4. Hands the event to the subscription's [`EventProcessor`] (currently
//!    only [`WebhookProcessor`]; future processor kinds — chat titler,
//!    audit logger, third-party push — implement the same trait and add
//!    a dispatch arm in [`processor_for_subscription`]).
//! 5. Advances the watermark to the newest event's `created_at`.
//!
//! ## Why polling, not the in-process event bus
//!
//! Tauri's `Emitter` is app→frontend only — there is no in-process backend
//! subscriber. Polling persona_events keeps the dispatcher decoupled from
//! every producer (engine, scheduler, healing, smee/relay, GitLab) and
//! survives restarts via the persisted watermark.

use std::str::FromStr;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value as JsonValue};
use tauri::AppHandle;

use crate::db::models::{NotificationSubscription, PersonaEvent};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::repos::resources::notification_subscriptions as sub_repo;
use crate::db::DbPool;
use crate::error::AppError;

pub const DISPATCH_TICK_INTERVAL: Duration = Duration::from_secs(5);
pub const MAX_EVENTS_PER_TICK: i64 = 200;
/// Per-delivery HTTP timeout. Webhook endpoints that hang shouldn't stall
/// the rest of the tick.
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(8);

// =============================================================================
// NotificationProvider — closed set of webhook body shapes
// =============================================================================

/// Webhook body shape. The DB column `notification_subscriptions.provider`
/// stores the string form (snake_case) for forward-compat with rows written
/// before this enum existed; in-memory dispatch uses the typed form. Unknown
/// string values fall back to [`NotificationProvider::Generic`] so existing
/// subscriptions never fail to dispatch after this refactor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationProvider {
    Slack,
    Discord,
    Teams,
    Generic,
}

impl NotificationProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::Discord => "discord",
            Self::Teams => "teams",
            Self::Generic => "generic",
        }
    }
}

impl FromStr for NotificationProvider {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "slack" => Self::Slack,
            "discord" => Self::Discord,
            "teams" => Self::Teams,
            // Unknown strings (including "generic" and any future typo) all
            // get the generic JSON shape. Infallible by design — keeps
            // dispatch resilient against forward-DB-compat surprises.
            _ => Self::Generic,
        })
    }
}

impl std::fmt::Display for NotificationProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// =============================================================================
// EventProcessor — pluggable interface for handling (event, subscription) pairs
// =============================================================================

/// Encapsulates how a single (event, subscription) pair is processed —
/// URL resolution, body rendering, transport, and delivery bookkeeping.
///
/// Mirrors OpenHands' `EventCallbackProcessor` (DiscriminatedUnionMixin):
/// every concrete processor owns its full dispatch shape, so the central
/// [`tick`] loop only matches on subscription kind and delegates.
///
/// Implementations MUST call [`sub_repo::record_delivery`] on both success
/// and failure paths so the subscription's `last_delivery_*` fields stay
/// accurate.
#[async_trait]
pub trait EventProcessor: Send + Sync {
    async fn process(
        &self,
        pool: &DbPool,
        sub: &NotificationSubscription,
        event: &PersonaEvent,
        event_ctx: &JsonValue,
    ) -> DispatchOutcome;

    /// Short stable identifier for logging / future dispatch routing.
    fn kind(&self) -> &'static str;
}

/// Pick the right processor for a subscription. Today every subscription
/// is a webhook; future processor kinds (chat titler, audit logger, third-
/// party push) will add arms here keyed off a future
/// `notification_subscriptions.processor_kind` column or similar.
pub fn processor_for_subscription(_sub: &NotificationSubscription) -> Box<dyn EventProcessor> {
    Box::new(WebhookProcessor)
}

/// Concrete processor — POSTs the rendered template to the subscription's
/// resolved webhook URL using one of the provider body shapes.
pub struct WebhookProcessor;

#[async_trait]
impl EventProcessor for WebhookProcessor {
    async fn process(
        &self,
        pool: &DbPool,
        sub: &NotificationSubscription,
        _event: &PersonaEvent,
        event_ctx: &JsonValue,
    ) -> DispatchOutcome {
        let url = match resolve_webhook_url(
            pool,
            sub.webhook_url.as_deref(),
            sub.credential_id.as_deref(),
        ) {
            Ok(u) => u,
            Err(e) => {
                let err = e.to_string();
                let _ = sub_repo::record_delivery(pool, &sub.id, "failed", Some(&err));
                return DispatchOutcome {
                    ok: false,
                    status_code: None,
                    response_excerpt: None,
                    error: Some(err),
                };
            }
        };

        let rendered = match sub.template_body.as_deref() {
            Some(tmpl) if !tmpl.trim().is_empty() => templating::render(tmpl, event_ctx),
            _ => providers::default_summary(
                event_ctx
                    .get("event_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("event"),
                event_ctx,
            ),
        };
        let provider = NotificationProvider::from_str(&sub.provider).unwrap_or_else(|never| match never {});
        let body = providers::build_body(provider, &rendered, event_ctx);

        let outcome = dispatch_to_url(&url, provider, body).await;
        let status = if outcome.ok { "success" } else { "failed" };
        let _ = sub_repo::record_delivery(pool, &sub.id, status, outcome.error.as_deref());
        outcome
    }

    fn kind(&self) -> &'static str {
        "webhook"
    }
}

// =============================================================================
// Templating: Mustache-style {{path.to.value}} replacement
// =============================================================================

pub mod templating {
    use super::*;

    /// Render a Mustache-style template against a JSON context.
    ///
    /// Supports `{{path.to.value}}` walking nested objects. `{{event}}` returns
    /// the whole event as JSON. Missing paths render as the empty string.
    /// A literal `{{` / `}}` survives if the contents contain a space (so
    /// `{{ literal }}` is not treated as a path).
    pub fn render(template: &str, context: &JsonValue) -> String {
        let mut out = String::with_capacity(template.len());
        let bytes = template.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
                if let Some(end) = find_close(bytes, i + 2) {
                    let raw = &template[i + 2..end];
                    let path = raw.trim();
                    if !path.is_empty() && !path.contains(' ') {
                        out.push_str(&resolve_path(context, path));
                        i = end + 2;
                        continue;
                    }
                }
            }
            out.push(bytes[i] as char);
            i += 1;
        }
        out
    }

    fn find_close(bytes: &[u8], start: usize) -> Option<usize> {
        let mut i = start;
        while i + 1 < bytes.len() {
            if bytes[i] == b'}' && bytes[i + 1] == b'}' {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    fn resolve_path(context: &JsonValue, path: &str) -> String {
        let mut cur = context;
        for seg in path.split('.') {
            match cur {
                JsonValue::Object(map) => match map.get(seg) {
                    Some(v) => cur = v,
                    None => return String::new(),
                },
                JsonValue::Array(arr) => match seg.parse::<usize>() {
                    Ok(idx) => match arr.get(idx) {
                        Some(v) => cur = v,
                        None => return String::new(),
                    },
                    Err(_) => return String::new(),
                },
                _ => return String::new(),
            }
        }
        match cur {
            JsonValue::String(s) => s.clone(),
            JsonValue::Null => String::new(),
            other => other.to_string(),
        }
    }
}

// =============================================================================
// Provider adapters: shape the body for Slack/Discord/Teams/generic JSON
// =============================================================================

pub mod providers {
    use super::*;

    /// Build the HTTP request body for a given provider.
    ///
    /// `rendered` is the user-provided template's output (already substituted)
    /// or, if the subscription has no template, the default summary string.
    /// `event_ctx` is the full event JSON, included for the generic provider.
    pub fn build_body(provider: NotificationProvider, rendered: &str, event_ctx: &JsonValue) -> JsonValue {
        match provider {
            NotificationProvider::Slack => json!({ "text": rendered }),
            NotificationProvider::Discord => json!({ "content": rendered }),
            NotificationProvider::Teams => json!({
                "@type": "MessageCard",
                "@context": "https://schema.org/extensions",
                "text": rendered,
            }),
            NotificationProvider::Generic => json!({
                "text": rendered,
                "event": event_ctx,
            }),
        }
    }

    /// Default summary used when a subscription has no `template_body`.
    pub fn default_summary(event_type: &str, event_ctx: &JsonValue) -> String {
        let source = event_ctx
            .get("source_type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let source_id = event_ctx
            .get("source_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !source.is_empty() && !source_id.is_empty() {
            format!("[Personas] {} — {}/{}", event_type, source, source_id)
        } else {
            format!("[Personas] {}", event_type)
        }
    }
}

// =============================================================================
// Pattern matching: "execution.*" -> "execution.finished" yes
// =============================================================================

pub fn pattern_matches(pattern: &str, event_type: &str) -> bool {
    if pattern == event_type {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix(".*") {
        return event_type.starts_with(prefix)
            && (event_type.len() == prefix.len()
                || event_type.as_bytes().get(prefix.len()) == Some(&b'.'));
    }
    if pattern == "*" {
        return true;
    }
    false
}

fn parse_patterns(event_types_json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(event_types_json).unwrap_or_default()
}

// =============================================================================
// Webhook URL resolution: inline > credential lookup
// =============================================================================

fn resolve_webhook_url(
    pool: &DbPool,
    inline: Option<&str>,
    credential_id: Option<&str>,
) -> Result<String, AppError> {
    if let Some(url) = inline {
        if !url.trim().is_empty() {
            return Ok(url.to_string());
        }
    }
    if let Some(cid) = credential_id {
        let cred = credential_repo::get_by_id(pool, cid)?;
        let fields = credential_repo::get_decrypted_fields(pool, &cred)?;
        for key in &["webhook_url", "url", "incoming_webhook_url", "endpoint"] {
            if let Some(v) = fields.get(*key) {
                if !v.trim().is_empty() {
                    return Ok(v.clone());
                }
            }
        }
        return Err(AppError::Validation(format!(
            "Credential {} has no webhook_url / url / endpoint field",
            cid
        )));
    }
    Err(AppError::Validation(
        "Subscription has no webhook_url and no credential_id".into(),
    ))
}

// =============================================================================
// Event → JSON context for the template
// =============================================================================

fn event_to_json(event: &PersonaEvent) -> JsonValue {
    let payload_json: JsonValue = match event.payload.as_deref() {
        Some(s) => serde_json::from_str(s).unwrap_or(JsonValue::String(s.to_string())),
        None => JsonValue::Null,
    };
    json!({
        "id": event.id,
        "event_type": event.event_type,
        "source_type": event.source_type,
        "source_id": event.source_id,
        "target_persona_id": event.target_persona_id,
        "project_id": event.project_id,
        "status": event.status.to_string(),
        "created_at": event.created_at,
        "payload": payload_json,
    })
}

// =============================================================================
// Single-event dispatch
// =============================================================================

#[derive(Debug, Clone)]
pub struct DispatchOutcome {
    pub ok: bool,
    pub status_code: Option<u16>,
    pub response_excerpt: Option<String>,
    pub error: Option<String>,
}

pub async fn dispatch_to_url(
    url: &str,
    provider: NotificationProvider,
    body: JsonValue,
) -> DispatchOutcome {
    let client = crate::SSRF_SAFE_HTTP.clone();
    let req = client
        .post(url)
        .timeout(DELIVERY_TIMEOUT)
        .header("User-Agent", "Personas-Desktop-Webhook/1")
        .header("X-Personas-Provider", provider.as_str())
        .json(&body)
        .send()
        .await;
    match req {
        Ok(resp) => {
            let status = resp.status();
            let code = status.as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            let excerpt = if body_text.is_empty() {
                None
            } else {
                Some(body_text.chars().take(256).collect::<String>())
            };
            if status.is_success() {
                DispatchOutcome {
                    ok: true,
                    status_code: Some(code),
                    response_excerpt: excerpt,
                    error: None,
                }
            } else {
                DispatchOutcome {
                    ok: false,
                    status_code: Some(code),
                    response_excerpt: excerpt.clone(),
                    error: Some(format!("HTTP {}", code)),
                }
            }
        }
        Err(e) => DispatchOutcome {
            ok: false,
            status_code: None,
            response_excerpt: None,
            error: Some(e.to_string()),
        },
    }
}

// =============================================================================
// Tick — process all unseen events through all matching subscriptions
// =============================================================================

pub async fn tick(pool: &DbPool, app: Option<&AppHandle>) -> Result<usize, AppError> {
    let _ = app; // reserved for future per-delivery emit_event
    let subscriptions = sub_repo::list_enabled(pool)?;
    if subscriptions.is_empty() {
        return Ok(0);
    }

    let watermark = sub_repo::get_watermark(pool)?;
    let events = event_repo::get_recent_after(pool, watermark.as_deref(), MAX_EVENTS_PER_TICK)?;
    if events.is_empty() {
        return Ok(0);
    }

    // Pre-parse each subscription's patterns so we don't reparse per event.
    let sub_patterns: Vec<(usize, Vec<String>)> = subscriptions
        .iter()
        .enumerate()
        .map(|(i, s)| (i, parse_patterns(&s.event_types)))
        .collect();

    let mut delivered = 0usize;
    let mut newest_at: Option<String> = None;

    for event in &events {
        let event_ctx = event_to_json(event);

        for (idx, patterns) in &sub_patterns {
            if !patterns.iter().any(|p| pattern_matches(p, &event.event_type)) {
                continue;
            }
            let sub = &subscriptions[*idx];
            let processor = processor_for_subscription(sub);
            let outcome = processor.process(pool, sub, event, &event_ctx).await;
            if outcome.ok {
                delivered += 1;
            }
        }

        match &newest_at {
            None => newest_at = Some(event.created_at.clone()),
            Some(cur) if event.created_at.as_str() > cur.as_str() => {
                newest_at = Some(event.created_at.clone())
            }
            _ => {}
        }
    }

    if let Some(at) = newest_at {
        sub_repo::set_watermark(pool, &at)?;
    }

    Ok(delivered)
}

// =============================================================================
// One-shot test dispatch — used by `test_notification_subscription` command
// =============================================================================

pub async fn test_dispatch(
    pool: &DbPool,
    sub_id: &str,
) -> Result<DispatchOutcome, AppError> {
    let sub = sub_repo::get_by_id(pool, sub_id)?;
    let url = resolve_webhook_url(
        pool,
        sub.webhook_url.as_deref(),
        sub.credential_id.as_deref(),
    )?;
    let synthetic = json!({
        "id": "test-event",
        "event_type": "test.notification",
        "source_type": "manual",
        "source_id": sub_id,
        "payload": { "message": "Personas test notification" },
        "created_at": chrono::Utc::now().to_rfc3339(),
    });
    let rendered = match sub.template_body.as_deref() {
        Some(tmpl) if !tmpl.trim().is_empty() => templating::render(tmpl, &synthetic),
        _ => format!(
            "[Personas] test notification for subscription \"{}\"",
            sub.label
        ),
    };
    let provider = NotificationProvider::from_str(&sub.provider).unwrap_or_else(|never| match never {});
    let body = providers::build_body(provider, &rendered, &synthetic);
    let outcome = dispatch_to_url(&url, provider, body).await;
    let status = if outcome.ok { "success" } else { "failed" };
    let _ = sub_repo::record_delivery(pool, &sub.id, status, outcome.error.as_deref());
    Ok(outcome)
}

// =============================================================================
// Loop runner — spawned from lib.rs setup
// =============================================================================

pub async fn run_dispatcher(pool: DbPool, app: AppHandle) {
    tokio::time::sleep(Duration::from_secs(10)).await;
    loop {
        match tick(&pool, Some(&app)).await {
            Ok(0) => {}
            Ok(n) => tracing::debug!(delivered = n, "webhook_notifier: dispatched events"),
            Err(e) => tracing::warn!(error = %e, "webhook_notifier tick failed"),
        }
        tokio::time::sleep(DISPATCH_TICK_INTERVAL).await;
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_match_exact() {
        assert!(pattern_matches("execution.finished", "execution.finished"));
        assert!(!pattern_matches("execution.finished", "execution.failed"));
    }

    #[test]
    fn pattern_match_wildcard_prefix() {
        assert!(pattern_matches("execution.*", "execution.finished"));
        assert!(pattern_matches("execution.*", "execution.queued"));
        assert!(!pattern_matches("execution.*", "trigger.fired"));
        // Boundary: prefix-only string must match either exactly or with dot
        assert!(!pattern_matches("exec.*", "execution.finished"));
    }

    #[test]
    fn pattern_match_star_matches_all() {
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("*", "execution.finished"));
    }

    #[test]
    fn templating_walks_nested_paths() {
        let ctx = json!({
            "event_type": "execution.finished",
            "payload": { "persona_id": "p123", "status": "ok" },
        });
        let out = templating::render(
            "Run {{payload.persona_id}} finished with {{payload.status}} ({{event_type}})",
            &ctx,
        );
        assert_eq!(out, "Run p123 finished with ok (execution.finished)");
    }

    #[test]
    fn templating_missing_path_is_empty() {
        let ctx = json!({ "a": 1 });
        assert_eq!(templating::render("[{{nope}}]", &ctx), "[]");
        assert_eq!(templating::render("[{{a.b.c}}]", &ctx), "[]");
    }

    #[test]
    fn provider_slack_uses_text() {
        let body = providers::build_body(NotificationProvider::Slack, "hello", &json!({}));
        assert_eq!(body["text"], "hello");
    }

    #[test]
    fn provider_discord_uses_content() {
        let body = providers::build_body(NotificationProvider::Discord, "hello", &json!({}));
        assert_eq!(body["content"], "hello");
    }

    #[test]
    fn provider_teams_uses_message_card() {
        let body = providers::build_body(NotificationProvider::Teams, "hello", &json!({}));
        assert_eq!(body["@type"], "MessageCard");
        assert_eq!(body["text"], "hello");
    }

    #[test]
    fn provider_generic_includes_event() {
        let body = providers::build_body(
            NotificationProvider::Generic,
            "hello",
            &json!({ "id": "e1" }),
        );
        assert_eq!(body["text"], "hello");
        assert_eq!(body["event"]["id"], "e1");
    }

    #[test]
    fn notification_provider_parses_known_strings() {
        assert_eq!(
            NotificationProvider::from_str("slack").unwrap(),
            NotificationProvider::Slack
        );
        assert_eq!(
            NotificationProvider::from_str("discord").unwrap(),
            NotificationProvider::Discord
        );
        assert_eq!(
            NotificationProvider::from_str("teams").unwrap(),
            NotificationProvider::Teams
        );
        assert_eq!(
            NotificationProvider::from_str("generic").unwrap(),
            NotificationProvider::Generic
        );
    }

    #[test]
    fn notification_provider_unknown_falls_back_to_generic() {
        // Forward-compat: rows written before this enum existed (or future
        // typos) all dispatch as the generic JSON shape rather than failing.
        assert_eq!(
            NotificationProvider::from_str("future-kind").unwrap(),
            NotificationProvider::Generic
        );
        assert_eq!(
            NotificationProvider::from_str("").unwrap(),
            NotificationProvider::Generic
        );
    }

    #[test]
    fn notification_provider_roundtrip_as_str() {
        for p in [
            NotificationProvider::Slack,
            NotificationProvider::Discord,
            NotificationProvider::Teams,
            NotificationProvider::Generic,
        ] {
            let s = p.as_str();
            assert_eq!(NotificationProvider::from_str(s).unwrap(), p);
            assert_eq!(p.to_string(), s);
        }
    }

    #[test]
    fn webhook_processor_kind() {
        let p = WebhookProcessor;
        assert_eq!(p.kind(), "webhook");
    }
}
