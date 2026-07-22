//! Shared credential-field classification logic.
//!
//! **Single source of truth** for deciding whether a credential field KEY
//! (e.g. `"api_key"`, `"workspace"`) should be treated as sensitive at rest.
//! This used to be triplicated across `db::migrations::helpers`,
//! `db::repos::resources::credentials`, and
//! `commands::core::data_portability` -- three copies that could (and did)
//! drift, which is a real encrypt-vs-plaintext-at-rest risk: the same field
//! key could classify as `"secret"` on one write path and `"text"` on
//! another, silently persisting a genuinely secret value unencrypted.
//!
//! Any future change to the classification rules should be made HERE ONLY.
//! All three former call sites now import this module.

/// Field keys that are stored as queryable plaintext rather than encrypted.
/// Used by both `create_with_fields` and `save_fields` to classify sensitivity.
pub(crate) const NON_SENSITIVE_KEYS: &[&str] = &[
    "base_url",
    "url",
    "host",
    "hostname",
    "server",
    "port",
    "database",
    "project",
    "organization",
    "org",
    "workspace",
    "team",
    "region",
    "scope",
    "scopes",
    "oauth_client_mode",
    "token_type",
];

/// Legacy camelCase -> canonical snake_case credential field key renames.
///
/// Some credentials were stored with e.g. `refreshToken` instead of
/// `refresh_token`. Shared by the one-time DB migration
/// (`db::migrations::helpers::normalize_credential_field_keys`, which walks
/// this list to rewrite rows) and the read-path normalizer
/// (`normalize_field_key`, which maps an individual key transparently on
/// every read for any row the migration might have missed).
pub(crate) const FIELD_KEY_RENAMES: &[(&str, &str)] = &[
    ("refreshToken", "refresh_token"),
    ("accessToken", "access_token"),
    ("clientId", "client_id"),
    ("clientSecret", "client_secret"),
    ("tokenType", "token_type"),
];

/// Normalize a legacy camelCase credential field key to canonical snake_case.
///
/// Runs on every read so that any camelCase fields missed by the DB
/// migration (e.g. created between migration and app restart) are
/// transparently mapped.
pub(crate) fn normalize_field_key(key: &str) -> String {
    for &(old_key, new_key) in FIELD_KEY_RENAMES {
        if key == old_key {
            return new_key.to_string();
        }
    }
    key.to_string()
}

/// Classify a credential field key into a type hint.
///
/// The `"secret"` classification doubles as the non-negotiable name backstop
/// in `credentials::is_field_sensitive`: a secret-typed, non-allowlisted key
/// is ALWAYS encrypted regardless of what the (user/AI-authorable) connector
/// schema declares. The match list is therefore deliberately broad -- ad-hoc
/// token-shaped keys written by the OAuth refresh path or hand-authored
/// connector schemas (`jwt`, `bearer`, `passphrase`, `pwd`, `credential`,
/// plus any `*token*`/`*key*`/`*secret*`/`*password*` variant) must never be
/// classifiable as plain text. Widening this list only ever upgrades a field
/// to encrypted-at-rest; the `NON_SENSITIVE_KEYS` allowlist still exempts
/// legitimately public names like `token_type`.
///
/// This function is the STRICT UNION of three previously-independent copies
/// (`db::migrations::helpers`, `db::repos::resources::credentials`,
/// `commands::core::data_portability`). Two of the three copies only matched
/// `token`/`key`/`secret`/`password`; the third additionally matched
/// `passphrase`/`credential`/`jwt`/`bearer`/`pwd`/`*_pwd`. Per the fail-safe
/// merge rule, any key the narrower copies would have classified as
/// `"text"`/`"url"`/`"number"`/`"identity"` but the wider copy classifies as
/// `"secret"` is resolved toward `"secret"` here -- i.e. this function IS the
/// wider of the two rule sets, verbatim.
pub(crate) fn classify_field_type(key: &str) -> &'static str {
    let lower = key.to_lowercase();
    if lower.contains("url") || lower.contains("endpoint") || lower == "host" || lower == "server"
    {
        "url"
    } else if lower.contains("token")
        || lower.contains("key")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("passphrase")
        || lower.contains("credential")
        || lower.contains("jwt")
        || lower.contains("bearer")
        || lower == "pwd"
        || lower.ends_with("_pwd")
    {
        "secret"
    } else if lower == "port" {
        "number"
    } else if lower.contains("email") || lower.contains("username") || lower.contains("user") {
        "identity"
    } else {
        "text"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every case the three original copies agreed on.
    #[test]
    fn classifies_common_cases() {
        assert_eq!(classify_field_type("api_key"), "secret");
        assert_eq!(classify_field_type("access_token"), "secret");
        assert_eq!(classify_field_type("client_secret"), "secret");
        assert_eq!(classify_field_type("password"), "secret");
        assert_eq!(classify_field_type("base_url"), "url");
        assert_eq!(classify_field_type("endpoint"), "url");
        assert_eq!(classify_field_type("host"), "url");
        assert_eq!(classify_field_type("server"), "url");
        assert_eq!(classify_field_type("port"), "number");
        assert_eq!(classify_field_type("email"), "identity");
        assert_eq!(classify_field_type("username"), "identity");
        assert_eq!(classify_field_type("user"), "identity");
        assert_eq!(classify_field_type("workspace"), "text");
    }

    /// Cases where the three original copies DISAGREED. The `helpers.rs` and
    /// `data_portability.rs` copies classified these as `"text"`; the
    /// `credentials.rs` copy classified them as `"secret"`. Fail-safe merge
    /// resolves toward `"secret"` in every case.
    #[test]
    fn resolves_disagreements_toward_secret() {
        assert_eq!(classify_field_type("passphrase"), "secret");
        assert_eq!(classify_field_type("credential"), "secret");
        assert_eq!(classify_field_type("jwt"), "secret");
        assert_eq!(classify_field_type("bearer"), "secret");
        assert_eq!(classify_field_type("pwd"), "secret");
        assert_eq!(classify_field_type("db_pwd"), "secret");
    }

    #[test]
    fn normalizes_legacy_camel_case_keys() {
        assert_eq!(normalize_field_key("refreshToken"), "refresh_token");
        assert_eq!(normalize_field_key("accessToken"), "access_token");
        assert_eq!(normalize_field_key("clientId"), "client_id");
        assert_eq!(normalize_field_key("clientSecret"), "client_secret");
        assert_eq!(normalize_field_key("tokenType"), "token_type");
        assert_eq!(normalize_field_key("already_snake"), "already_snake");
    }
}
