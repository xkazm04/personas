pub mod analysis;
pub mod archetypes;
pub mod build_sessions;
pub mod build_simulate;
pub mod connector_explorer;
pub mod connector_readiness;
pub mod conversations;
pub mod n8n_limits;
pub mod n8n_sessions;
pub mod n8n_transform;
pub mod platform_definitions;
pub mod reviews;
pub mod smart_search;
pub mod team_presets;
pub mod team_synthesis;
pub mod template_adopt;
pub mod template_feedback;

/// Sanitize a `persona_meta.model_profile` blob lifted out of template JSON
/// before it is persisted onto a persona.
///
/// Template JSON is untrusted content, and `model_profile` is the one field in
/// it that decides WHERE a persona's inference goes: `base_url` replaces the
/// endpoint wholesale (scheme + authority) and `auth_token` decides what
/// credential rides along. Both are machine-local configuration set in the
/// persona editor, not properties of a shared artifact. This strips the token,
/// rejects a `base_url` that is not a usable http(s) URL, and drops the field
/// rather than failing the adoption on a malformed blob.
///
/// Shared by `template_adopt` and `team_synthesis`, which read the same field
/// out of the same shape.
pub(crate) fn sanitized_model_profile(raw: &str, source: &str) -> Option<String> {
    match crate::engine::types::sanitize_untrusted_model_profile(raw) {
        Ok(clean) if clean.is_empty() => None,
        Ok(clean) => Some(clean),
        Err(reason) => {
            tracing::warn!(%source, %reason, "dropped an unusable model_profile from template JSON");
            None
        }
    }
}
