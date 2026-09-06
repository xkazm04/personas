//! The three Anthropic OAuth calls the switcher needs — refresh, profile,
//! usage — over the shared HTTP client. Every request goes to the host that
//! issued the token and nowhere else; no token is logged.

use serde_json::Value;

use crate::SHARED_HTTP;

use super::super::claude_usage::{
    as_epoch_ms, parse_windows, ClaudeUsageWindow, OAUTH_BETA, USAGE_URL,
};

/// Claude Code's public OAuth client id — the value the CLI itself sends and
/// the one claude-swap / ccusage refresh with. Public by design (PKCE flow).
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";

/// Never serialized, never leaves this module: the fields are private and
/// the only reader is [`apply_token_set`], which writes them into the CLI's
/// own credentials document.
pub(super) struct TokenSet {
    access_token: String,
    /// Refresh tokens rotate: a new one supersedes the old on every refresh.
    refresh_token: Option<String>,
    expires_at_ms: i64,
    scopes: Option<Vec<String>>,
}

pub(super) enum OauthFailure {
    /// The refresh token is dead — only a fresh `claude login` can fix it.
    InvalidGrant(String),
    Network(String),
    Other(String),
}

pub(super) async fn refresh(refresh_token: &str) -> Result<TokenSet, OauthFailure> {
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
    });
    let resp = SHARED_HTTP
        .post(TOKEN_URL)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| OauthFailure::Network(e.to_string()))?;
    let status = resp.status();
    let json: Value = resp
        .json()
        .await
        .map_err(|e| OauthFailure::Other(format!("token response: {e}")))?;
    if !status.is_success() {
        let err = json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let desc = json
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let msg = format!("{} {} {}", status.as_u16(), err, desc)
            .trim()
            .to_string();
        return Err(
            if err == "invalid_grant" || status.as_u16() == 400 || status.as_u16() == 401 {
                OauthFailure::InvalidGrant(msg)
            } else {
                OauthFailure::Other(msg)
            },
        );
    }
    let access_token = json
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| OauthFailure::Other("token response without access_token".into()))?
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(3600);
    Ok(TokenSet {
        access_token,
        refresh_token: json
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_string),
        expires_at_ms: super::super::claude_usage::now_ms() + expires_in * 1000,
        scopes: json
            .get("scope")
            .and_then(Value::as_str)
            .map(|s| s.split_whitespace().map(str::to_string).collect()),
    })
}

pub(super) struct Profile {
    pub account_uuid: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub organization_uuid: Option<String>,
    pub organization_name: Option<String>,
}

pub(super) async fn profile(access_token: &str) -> Result<Profile, OauthFailure> {
    let resp = SHARED_HTTP
        .get(PROFILE_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| OauthFailure::Network(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(OauthFailure::Other(format!("profile {}", status.as_u16())));
    }
    let json: Value = resp
        .json()
        .await
        .map_err(|e| OauthFailure::Other(format!("profile response: {e}")))?;
    parse_profile(&json).ok_or_else(|| OauthFailure::Other("profile without account uuid".into()))
}

/// Pure half of [`profile`]. Accepts `{account:{uuid,email,...}, organization:{uuid,name}}`
/// and a flat `{uuid,email}` for good measure.
pub(super) fn parse_profile(json: &Value) -> Option<Profile> {
    let account = json.get("account").unwrap_or(json);
    let uuid = account
        .get("uuid")
        .or_else(|| account.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    let org = json.get("organization");
    let str_at = |v: Option<&Value>, k: &str| {
        v.and_then(|o| o.get(k))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Some(Profile {
        account_uuid: uuid.to_string(),
        email: str_at(Some(account), "email").or_else(|| str_at(Some(account), "email_address")),
        display_name: str_at(Some(account), "display_name")
            .or_else(|| str_at(Some(account), "full_name")),
        organization_uuid: str_at(org, "uuid"),
        organization_name: str_at(org, "name"),
    })
}

/// Usage for one token. The error is a machine reason in the same vocabulary
/// `fleet_claude_usage` speaks, so the strip maps both with one table.
pub(super) async fn usage(access_token: &str) -> Result<Vec<ClaudeUsageWindow>, String> {
    let resp = SHARED_HTTP
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", OAUTH_BETA)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "unauthorized",
            429 => "rate_limited",
            _ => "http_error",
        }
        .to_string());
    }
    let body: Value = resp.json().await.map_err(|_| "parse".to_string())?;
    let windows = parse_windows(&body);
    if windows.is_empty() {
        return Err("parse".into());
    }
    Ok(windows)
}

/// Apply a refreshed token set to a credentials-file document in place, so
/// what goes back to disk is the CLI's own shape with three fields renewed.
pub(super) fn apply_token_set(doc: &mut Value, set: &TokenSet) {
    let oauth = match doc.get_mut("claudeAiOauth") {
        Some(o) if o.is_object() => o,
        _ => {
            doc["claudeAiOauth"] = Value::Object(Default::default());
            &mut doc["claudeAiOauth"]
        }
    };
    oauth["accessToken"] = Value::String(set.access_token.clone());
    if let Some(r) = &set.refresh_token {
        oauth["refreshToken"] = Value::String(r.clone());
    }
    oauth["expiresAt"] = Value::from(set.expires_at_ms);
    if let Some(s) = &set.scopes {
        oauth["scopes"] = Value::Array(s.iter().map(|x| Value::String(x.clone())).collect());
    }
}

/// The stored refresh token, if the document carries one.
pub(super) fn refresh_token_of(doc: &Value) -> Option<String> {
    doc.get("claudeAiOauth")
        .and_then(|o| o.get("refreshToken"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Expiry from the document, for the "refresh before it dies" decision.
pub(super) fn expires_at_of(doc: &Value) -> Option<i64> {
    doc.get("claudeAiOauth")
        .and_then(|o| o.get("expiresAt"))
        .and_then(as_epoch_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_nested_and_flat_profiles() {
        let p = parse_profile(&json!({
            "account": { "uuid": "u1", "email": "a@b.c", "display_name": "A" },
            "organization": { "uuid": "o1", "name": "Org" }
        }))
        .expect("nested");
        assert_eq!(p.account_uuid, "u1");
        assert_eq!(p.email.as_deref(), Some("a@b.c"));
        assert_eq!(p.organization_name.as_deref(), Some("Org"));

        let flat = parse_profile(&json!({ "uuid": "u2", "email_address": "x@y.z" })).expect("flat");
        assert_eq!(flat.account_uuid, "u2");
        assert_eq!(flat.email.as_deref(), Some("x@y.z"));
        assert!(parse_profile(&json!({ "account": { "email": "no-uuid" } })).is_none());
    }

    #[test]
    fn applies_a_refreshed_token_in_place_and_keeps_the_rest() {
        let mut doc = json!({ "claudeAiOauth": {
            "accessToken": "old", "refreshToken": "r0", "expiresAt": 1,
            "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x"
        }});
        apply_token_set(
            &mut doc,
            &TokenSet {
                access_token: "new".into(),
                refresh_token: Some("r1".into()),
                expires_at_ms: 99,
                scopes: Some(vec!["user:inference".into()]),
            },
        );
        let o = &doc["claudeAiOauth"];
        assert_eq!(o["accessToken"], "new");
        assert_eq!(o["refreshToken"], "r1");
        assert_eq!(o["expiresAt"], 99);
        assert_eq!(o["subscriptionType"], "max");
        assert_eq!(refresh_token_of(&doc).as_deref(), Some("r1"));
        assert_eq!(
            expires_at_of(&doc),
            Some(99_000),
            "sub-2001 numbers are seconds"
        );

        // A refresh that returned no new refresh token keeps the old one.
        apply_token_set(
            &mut doc,
            &TokenSet {
                access_token: "n2".into(),
                refresh_token: None,
                expires_at_ms: 5,
                scopes: None,
            },
        );
        assert_eq!(doc["claudeAiOauth"]["refreshToken"], "r1");
    }
}
