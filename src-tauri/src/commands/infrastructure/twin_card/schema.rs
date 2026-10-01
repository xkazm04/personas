//! The vendored Twin Card 1.0 schema and validation against it.
//!
//! The schema is compiled into the binary from the published copy
//! (`docs/standards/twin-card/1.0/twin-card.schema.json`), so a reader
//! validates against the copy that matches `spec_version` and never reaches
//! for the network (SPEC.md 2). Formats (`date-time`) are asserted, not just
//! annotated.

use serde_json::Value;

use crate::error::AppError;

const SCHEMA_TEXT: &str =
    include_str!("../../../../../docs/standards/twin-card/1.0/twin-card.schema.json");

/// How many violations a report names; the rest are counted.
const ERRORS_REPORTED: usize = 6;

/// The schema's violations for `card`, each prefixed with its JSON pointer,
/// capped at [`ERRORS_REPORTED`] plus one "and N more" line. Empty = valid.
pub(super) fn violations(card: &Value) -> Result<Vec<String>, AppError> {
    let schema: Value = serde_json::from_str(SCHEMA_TEXT)
        .map_err(|e| AppError::Internal(format!("twin card: vendored schema is not JSON: {e}")))?;
    let validator = jsonschema::options()
        .should_validate_formats(true)
        .build(&schema)
        .map_err(|e| {
            AppError::Internal(format!("twin card: vendored schema does not compile: {e}"))
        })?;
    let all: Vec<String> = validator
        .iter_errors(card)
        .map(|err| {
            let path = err.instance_path.to_string();
            if path.is_empty() {
                err.to_string()
            } else {
                format!("{path}: {err}")
            }
        })
        .collect();
    let extra = all.len().saturating_sub(ERRORS_REPORTED);
    let mut shown: Vec<String> = all.into_iter().take(ERRORS_REPORTED).collect();
    if extra > 0 {
        shown.push(format!("and {extra} more"));
    }
    Ok(shown)
}

#[cfg(test)]
mod tests {
    use super::super::types;
    use super::*;
    use serde_json::json;

    const MINIMAL: &str =
        include_str!("../../../../../docs/standards/twin-card/1.0/examples/minimal.twin.json");
    const FULL: &str =
        include_str!("../../../../../docs/standards/twin-card/1.0/examples/full.twin.json");

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).expect("example parses")
    }

    #[test]
    fn both_published_examples_validate() {
        for (name, text) in [("minimal", MINIMAL), ("full", FULL)] {
            let found = violations(&parse(text)).expect("schema compiles");
            assert!(found.is_empty(), "{name}: {found:?}");
        }
    }

    #[test]
    fn a_broken_card_names_the_path() {
        let mut card = parse(FULL);
        card["voice"]["channels"][0]["style"]["dims"]["humor"] = json!(9);
        card["created_at"] = json!("yesterday");
        let found = violations(&card).expect("schema compiles");
        assert!(
            found
                .iter()
                .any(|e| e.starts_with("/voice/channels/0/style/dims/humor")),
            "{found:?}"
        );
        assert!(
            found.iter().any(|e| e.starts_with("/created_at")),
            "date-time is asserted, not annotated: {found:?}"
        );
    }

    #[test]
    fn a_sealed_personal_part_is_valid_and_a_sealed_identity_is_not() {
        let sealed = json!({ "sealed": {
            "alg": "AES-256-GCM", "kdf": "PBKDF2-HMAC-SHA256", "iterations": 600000,
            "salt": "c2FsdA==", "nonce": "bm9uY2U=", "ciphertext": "Y2lwaGVy"
        }});
        let mut card = parse(FULL);
        card["knowledge"] = sealed.clone();
        assert!(violations(&card).expect("compiles").is_empty());
        card["identity"] = sealed;
        assert!(!violations(&card).expect("compiles").is_empty());
    }

    /// The producer's fitting limits (`types.rs`) are the schema's own.
    #[test]
    fn the_producer_limits_are_the_schemas() {
        let schema: Value = serde_json::from_str(SCHEMA_TEXT).expect("schema parses");
        let defs = &schema["$defs"];
        let limit = |v: &Value| v.as_u64().map(|n| n as usize);
        let checks: [(&str, Option<usize>, usize); 16] = [
            (
                "name",
                limit(&defs["identity"]["properties"]["name"]["maxLength"]),
                types::NAME_MAX,
            ),
            (
                "role",
                limit(&defs["identity"]["properties"]["role"]["maxLength"]),
                types::ROLE_MAX,
            ),
            (
                "bio",
                limit(&defs["identity"]["properties"]["bio"]["maxLength"]),
                types::BIO_MAX,
            ),
            (
                "directives",
                limit(&defs["channel"]["properties"]["directives"]["maxLength"]),
                types::DIRECTIVES_MAX,
            ),
            (
                "length_hint",
                limit(&defs["channel"]["properties"]["length_hint"]["maxLength"]),
                types::LENGTH_HINT_MAX,
            ),
            (
                "constraint",
                limit(&defs["channel"]["properties"]["constraints"]["items"]["maxLength"]),
                types::CONSTRAINT_MAX,
            ),
            (
                "constraints",
                limit(&defs["channel"]["properties"]["constraints"]["maxItems"]),
                types::CONSTRAINTS_PER_CHANNEL,
            ),
            (
                "exemplar",
                limit(&defs["exemplar"]["properties"]["text"]["maxLength"]),
                types::EXEMPLAR_MAX,
            ),
            (
                "exemplars",
                limit(&defs["channel"]["properties"]["exemplars"]["maxItems"]),
                types::EXEMPLARS_PER_CHANNEL,
            ),
            (
                "channels",
                limit(&defs["voice"]["properties"]["channels"]["maxItems"]),
                types::CHANNELS_MAX,
            ),
            (
                "memory title",
                limit(
                    &defs["knowledge"]["properties"]["memories"]["items"]["properties"]["title"]
                        ["maxLength"],
                ),
                types::MEMORY_TITLE_MAX,
            ),
            (
                "memory content",
                limit(
                    &defs["knowledge"]["properties"]["memories"]["items"]["properties"]["content"]
                        ["maxLength"],
                ),
                types::MEMORY_CONTENT_MAX,
            ),
            (
                "memories",
                limit(&defs["knowledge"]["properties"]["memories"]["maxItems"]),
                types::MEMORIES_MAX,
            ),
            (
                "fact content",
                limit(
                    &defs["knowledge"]["properties"]["facts"]["items"]["properties"]["content"]
                        ["maxLength"],
                ),
                types::FACT_CONTENT_MAX,
            ),
            (
                "facts",
                limit(&defs["knowledge"]["properties"]["facts"]["maxItems"]),
                types::FACTS_MAX,
            ),
            (
                "qa",
                limit(&defs["training"]["properties"]["qa"]["maxItems"]),
                types::QA_MAX,
            ),
        ];
        for (what, from_schema, ours) in checks {
            assert_eq!(from_schema, Some(ours), "{what}");
        }
        assert_eq!(schema["$id"], json!(types::SCHEMA_ID));
        assert_eq!(
            defs["voice"]["properties"]["scale"]["const"],
            json!(types::STYLE_SCALE)
        );
    }
}
