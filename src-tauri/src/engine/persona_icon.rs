//! Persona icon value-scheme helpers shared across the export paths.
//!
//! A persona's `icon` column is a free-form string. One of its shapes,
//! `custom-icon:{sha256}`, points at a user-uploaded file under the local
//! `{app_data_dir}/persona-icons/` directory — see
//! `commands/core/persona_icons.rs`. Those files are **local-only**: they do
//! not travel with a persona through export, `.persona` bundles, or share
//! links.
//!
//! So at every serialization boundary a `custom-icon:` value is downgraded to
//! an inferred built-in `agent-icon:` — the receiving machine then shows a
//! sensible catalog icon instead of a dead reference that renders as the
//! generic Bot fallback. Non-custom icon values pass through untouched.

/// Prefix of a user-uploaded custom icon value. Mirrors `CUSTOM_ICON_PREFIX`
/// in `src/lib/icons/customIconStore.ts`.
pub const CUSTOM_ICON_PREFIX: &str = "custom-icon:";

/// Prefix of a built-in catalog icon value. Mirrors `AGENT_ICON_PREFIX` in
/// `src/lib/icons/agentIconCatalog.ts`.
pub const AGENT_ICON_PREFIX: &str = "agent-icon:";

/// Map a lowercase template category to the best-matching built-in icon id.
///
/// Mirrors the first-match-wins `CATEGORY_TO_ICON` table built from
/// `AGENT_ICONS` in `src/lib/icons/agentIconCatalog.ts`. Keep the two in sync.
fn icon_id_for_category(category: &str) -> &'static str {
    match category {
        "productivity" => "assistant",
        "development" => "code",
        "data" | "analytics" => "data",
        "security" => "security",
        "monitoring" => "monitor",
        "devops" => "monitor",
        "email" | "communication" => "email",
        "content" => "document",
        "support" => "support",
        "automation" | "workflow" => "automation",
        "research" => "research",
        "finance" => "finance",
        "marketing" => "marketing",
        "infrastructure" => "devops",
        "sales" | "ecommerce" => "sales",
        "hr" => "hr",
        "legal" => "legal",
        "notification" | "alerts" => "notification",
        "project_management" | "scheduling" => "calendar",
        "intelligence" => "search",
        _ => "assistant",
    }
}

/// Return an export-safe icon value: a `custom-icon:` reference is downgraded
/// to an inferred built-in `agent-icon:`; every other value (built-in, emoji,
/// URL, `None`) passes through unchanged.
pub fn export_safe_icon(icon: Option<&str>, template_category: Option<&str>) -> Option<String> {
    match icon {
        Some(value) if value.starts_with(CUSTOM_ICON_PREFIX) => {
            let id = template_category.map(icon_id_for_category).unwrap_or("assistant");
            Some(format!("{AGENT_ICON_PREFIX}{id}"))
        }
        other => other.map(str::to_string),
    }
}

/// In a serialized persona JSON object, downgrade a `custom-icon:` `icon`
/// field in place. No-op when the field is missing, not a string, or not a
/// custom-icon value.
pub fn downgrade_custom_icon_field(value: &mut serde_json::Value, template_category: Option<&str>) {
    let Some(icon) = value.get("icon").and_then(|v| v.as_str()) else {
        return;
    };
    if !icon.starts_with(CUSTOM_ICON_PREFIX) {
        return;
    }
    if let Some(safe) = export_safe_icon(Some(icon), template_category) {
        value["icon"] = serde_json::Value::String(safe);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_icon_downgrades_to_category_inferred_builtin() {
        assert_eq!(
            export_safe_icon(Some("custom-icon:abc123"), Some("finance")).as_deref(),
            Some("agent-icon:finance"),
        );
        assert_eq!(
            export_safe_icon(Some("custom-icon:abc123"), Some("development")).as_deref(),
            Some("agent-icon:code"),
        );
    }

    #[test]
    fn custom_icon_without_category_falls_back_to_assistant() {
        assert_eq!(
            export_safe_icon(Some("custom-icon:abc123"), None).as_deref(),
            Some("agent-icon:assistant"),
        );
        assert_eq!(
            export_safe_icon(Some("custom-icon:abc123"), Some("unknown-category")).as_deref(),
            Some("agent-icon:assistant"),
        );
    }

    #[test]
    fn non_custom_icons_pass_through_untouched() {
        assert_eq!(
            export_safe_icon(Some("agent-icon:code"), Some("finance")).as_deref(),
            Some("agent-icon:code"),
        );
        assert_eq!(export_safe_icon(Some("🤖"), None).as_deref(), Some("🤖"));
        assert_eq!(export_safe_icon(None, Some("finance")), None);
    }

    #[test]
    fn downgrade_field_mutates_only_custom_icon() {
        let mut v = serde_json::json!({ "icon": "custom-icon:deadbeef", "name": "X" });
        downgrade_custom_icon_field(&mut v, Some("legal"));
        assert_eq!(v["icon"], serde_json::json!("agent-icon:legal"));

        let mut v2 = serde_json::json!({ "icon": "agent-icon:data" });
        downgrade_custom_icon_field(&mut v2, None);
        assert_eq!(v2["icon"], serde_json::json!("agent-icon:data"));

        let mut v3 = serde_json::json!({ "name": "no icon field" });
        downgrade_custom_icon_field(&mut v3, None);
        assert_eq!(v3.get("icon"), None);
    }
}
