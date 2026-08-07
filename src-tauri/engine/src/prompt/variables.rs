//! Interpolate `{{var}}` placeholders in persona-authored strings.

use personas_db::models::Persona;

use super::runtime_safety::{sanitize_runtime_variable, MAX_RUNTIME_VAR_LENGTH};

/// Replace {{variable}} placeholders in a string with values from input_data or magic variables.
///
/// Magic variables (now, today, persona_id, etc.) are trusted internal values.
/// Input data values from user execution input are sanitized to prevent prompt injection
/// and structural escaping issues before substitution.
pub fn replace_variables(
    text: &str,
    persona: &Persona,
    input_data: Option<&serde_json::Value>,
) -> String {
    use chrono::Datelike;
    let now = chrono::Utc::now();

    // Define magic variables (trusted -- skip sanitization)
    let mut trusted_vars: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    trusted_vars.insert("now".into(), now.to_rfc3339());
    trusted_vars.insert("today".into(), now.format("%Y-%m-%d").to_string());
    trusted_vars.insert("iso8601".into(), now.to_rfc3339());
    trusted_vars.insert("weekday".into(), now.weekday().to_string());
    trusted_vars.insert("project_id".into(), persona.project_id.clone());
    trusted_vars.insert("persona_id".into(), persona.id.clone());
    trusted_vars.insert("persona_name".into(), persona.name.clone());

    // Inject free parameters as trusted variables (persona-owned, not user-input)
    if let Some(ref params_json) = persona.parameters {
        if let Ok(params) = serde_json::from_str::<Vec<serde_json::Value>>(params_json) {
            for p in &params {
                if let (Some(key), Some(value)) =
                    (p.get("key").and_then(|k| k.as_str()), p.get("value"))
                {
                    let val_str = match value {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        _ => value.to_string(),
                    };
                    trusted_vars.insert(format!("param.{}", key), val_str);
                }
            }
        }
    }

    // Add input_data variables -- these are user-provided and MUST be sanitized.
    // Keys starting with _ are internal metadata (e.g. _use_case, _time_filter)
    // and are not substituted into prompts via {{}} -- they are handled separately.
    let mut user_vars: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // Keys present in input_data but NOT substitutable, and keys whose value was
    // cut by the runtime cap. Both used to happen without a trace. Classification
    // only — nothing is logged unless THIS text actually references the key, so a
    // single assembly (which calls this ~15 times, once per persona field) does
    // not emit the same warning fifteen times.
    let mut non_scalar_keys: Vec<&str> = Vec::new();
    let mut truncated_keys: Vec<&str> = Vec::new();
    if let Some(data) = input_data {
        if let Some(obj) = data.as_object() {
            for (k, v) in obj {
                // Skip internal metadata keys
                if k.starts_with('_') {
                    continue;
                }
                let raw = if let Some(s) = v.as_str() {
                    s.to_string()
                } else if let Some(n) = v.as_f64() {
                    n.to_string()
                } else if let Some(b) = v.as_bool() {
                    b.to_string()
                } else {
                    // Arrays and objects have no scalar rendering, so `{{key}}`
                    // stays literal for them. The DATA is not lost — the whole
                    // input_data JSON is dumped under `## Input Data` — but the
                    // placeholder silently not resolving is worth a trace.
                    non_scalar_keys.push(k.as_str());
                    continue;
                };
                if raw.len() > MAX_RUNTIME_VAR_LENGTH {
                    truncated_keys.push(k.as_str());
                }
                user_vars.insert(k.clone(), sanitize_runtime_variable(&raw));
            }
        }
    }

    // Regex to find {{variable}}
    let re = regex::Regex::new(r"\{\{([^}]+)\}\}").unwrap();
    let mut unresolved: Vec<String> = Vec::new();
    let mut cut: Vec<String> = Vec::new();
    let out = re
        .replace_all(text, |caps: &regex::Captures| {
            let key = caps.get(1).unwrap().as_str().trim();
            // Check trusted vars first, then sanitized user vars
            if let Some(val) = trusted_vars.get(key) {
                val.clone()
            } else if let Some(val) = user_vars.get(key) {
                if truncated_keys.contains(&key) && !cut.iter().any(|k| k == key) {
                    cut.push(key.to_string());
                }
                val.clone()
            } else {
                // Unresolved: the raw `{{key}}` ships to the model as literal
                // template syntax. Nothing downstream validates an assembled
                // prompt, so this log is the only signal that a persona ran
                // against a placeholder it never got a value for — which is
                // exactly what a fix-loop re-entry used to do to EVERY variable.
                // A key that IS present but holds an array/object is named as
                // such: its data still reaches the model under `## Input Data`,
                // so the two cases need different follow-up.
                let label = if non_scalar_keys.contains(&key) {
                    format!("{key} (present but array/object; value is in the Input Data section)")
                } else {
                    key.to_string()
                };
                if !unresolved.contains(&label) {
                    unresolved.push(label);
                }
                caps.get(0).unwrap().as_str().to_string()
            }
        })
        .to_string();

    if !unresolved.is_empty() {
        tracing::warn!(
            persona_id = %persona.id,
            keys = %unresolved.join(", "),
            "prompt: unresolved placeholder(s) shipped to the model as literal template syntax"
        );
    }
    if !cut.is_empty() {
        tracing::warn!(
            persona_id = %persona.id,
            keys = %cut.join(", "),
            max_bytes = MAX_RUNTIME_VAR_LENGTH,
            "prompt: input_data value(s) truncated at the placeholder substitution site \
             (announced inline; the full value remains under the Input Data section)"
        );
    }

    out
}
