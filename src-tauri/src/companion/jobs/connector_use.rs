//! `connector_use` job handler — invokes a registered connector
//! capability and returns a markdown summary the chat session can
//! ingest as a system episode.
//!
//! Router validates the (connector, capability) pair against the
//! registry, decrypts the matching vault credential, and dispatches to
//! a per-service HTTP handler. New services slot in as additional
//! match arms in `dispatch_capability` — the surface above (chat
//! grammar, approval bypass, system-episode round-trip) doesn't change.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use crate::companion::connectors;
use crate::companion::jobs::JobProgress;
use crate::db::repos::resources::credentials;
use crate::db::UserDbPool;
use crate::error::AppError;

/// HTTP timeout for outbound connector calls. Tighter than reqwest's
/// global default so a sluggish upstream never holds the worker on one
/// job longer than the user would tolerate.
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

pub async fn run(
    pool: &UserDbPool,
    params: &Value,
    progress: &JobProgress,
) -> Result<String, AppError> {
    let connector_name = params
        .get("connector_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("connector_use: missing `connector_name`".into()))?;
    let capability = params
        .get("capability")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("connector_use: missing `capability`".into()))?;
    let args = params.get("args").cloned().unwrap_or(serde_json::json!({}));

    // Re-validate at job time — the registry could have changed since
    // dispatch (a connector was removed, capability slug renamed).
    let caps = connectors::capabilities_for(connector_name).ok_or_else(|| {
        AppError::Internal(format!(
            "connector_use: `{connector_name}` has no registered capabilities"
        ))
    })?;
    let cap = caps.iter().find(|c| c.slug == capability).ok_or_else(|| {
        AppError::Internal(format!(
            "connector_use: capability `{capability}` not in `{connector_name}` registry"
        ))
    })?;

    // Resolve the vault credential. Companion's pinned-list uses the
    // service_type as the connector_name; first credential of that
    // type wins (one-credential-per-service-type is the v1 invariant —
    // the picker enforces it client-side via useHealthyConnectors).
    let creds = credentials::get_by_service_type(pool, connector_name)?;
    let cred = creds.into_iter().next().ok_or_else(|| {
        AppError::Internal(format!(
            "connector_use: no `{connector_name}` credential in the vault — pin one in Connections first"
        ))
    })?;
    let fields = credentials::get_decrypted_fields(pool, &cred)?;

    // Surface what we're about to do while the (up to 20s) HTTP call is in
    // flight — the inline ConnectorCallCard shows this instead of a bare
    // spinner. The card already renders backend-generated content
    // (result/error markdown), so this short note shares that channel.
    progress.report(format!("Calling {connector_name} · {capability}…"));

    dispatch_capability(connector_name, cap.slug, &args, &fields).await
}

async fn dispatch_capability(
    connector_name: &str,
    capability: &str,
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    match (connector_name, capability) {
        ("sentry", "list_issues") => sentry_list_issues(args, fields).await,
        ("sentry", "get_issue") => sentry_get_issue(args, fields).await,
        ("github", "list_repos") => github_list_repos(args, fields).await,
        ("github", "list_open_prs") => github_list_open_prs(args, fields).await,
        ("slack", "list_channels") => slack_list_channels(args, fields).await,
        ("gmail", "list_recent_threads") | ("google_workspace", "list_recent_threads") => {
            gmail_list_recent_threads(args, fields).await
        }
        _ => Ok(format!(
            "## Connector call: `{connector_name}::{capability}`\n\n\
             _Capability registered but no API handler is wired yet._ \
             Args echoed below; add a match arm in \
             `connector_use::dispatch_capability` to ship a real call.\n\n\
             **Args:**\n\n```json\n{args_pretty}\n```\n",
            args_pretty = serde_json::to_string_pretty(args).unwrap_or_else(|_| "{}".into()),
        )),
    }
}

// ============================================================================
// Shared helpers
// ============================================================================

fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest client build failed — {e}")))
}

fn required_field<'a>(
    fields: &'a HashMap<String, String>,
    service: &str,
    key: &str,
) -> Result<&'a str, AppError> {
    fields
        .get(key)
        .map(String::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            AppError::Internal(format!(
                "{service} credential is missing `{key}` — re-open the connector and re-enter it"
            ))
        })
}

/// Cap an upstream error body so a verbose 500 page doesn't pollute
/// the chat transcript or blow embedder token budgets on the next turn.
fn truncate_for_episode(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s.chars().take(max).collect::<String>();
        out.push_str("…");
        out
    }
}

// ============================================================================
// Sentry
// ============================================================================
//
// Auth: `Authorization: Bearer <auth_token>`. Both endpoints are read-
// only — we never write to Sentry from chat. Errors are returned as
// Athena-friendly markdown so her next turn can explain the failure
// instead of opaque "request failed" prose.

async fn sentry_list_issues(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let auth_token = required_field(fields, "sentry", "auth_token")?;
    let org = required_field(fields, "sentry", "organization_slug")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .min(100);

    let client = http_client()?;
    let url = format!(
        "https://sentry.io/api/0/organizations/{org}/issues/?query=is%3Aunresolved&limit={limit}"
    );
    let resp = client
        .get(&url)
        .bearer_auth(auth_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("sentry list_issues: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Sentry — list_issues failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let issues: Vec<Value> = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("sentry list_issues: malformed JSON — {e}"))
    })?;
    if issues.is_empty() {
        return Ok(format!(
            "## Sentry — no unresolved issues for `{org}`\n\nThe project is currently quiet."
        ));
    }
    let mut out = format!(
        "## Sentry — {n} unresolved issue(s) for `{org}`\n\n",
        n = issues.len()
    );
    for issue in issues.iter() {
        let id = issue
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("(no id)");
        let short_id = issue
            .get("shortId")
            .and_then(|v| v.as_str())
            .unwrap_or(id);
        let title = issue
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("(untitled)");
        let count = issue.get("count").and_then(|v| v.as_str()).unwrap_or("?");
        let last_seen = issue
            .get("lastSeen")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let level = issue
            .get("level")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        out.push_str(&format!(
            "- **{short_id}** — {title}\n  · level: `{level}` · events: `{count}` · last seen: `{last_seen}`\n  · id: `{id}`\n"
        ));
    }
    Ok(out)
}

async fn sentry_get_issue(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let auth_token = required_field(fields, "sentry", "auth_token")?;
    let issue_id = args
        .get("issue_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("sentry get_issue: missing `issue_id`".into()))?;

    let client = http_client()?;
    let url = format!("https://sentry.io/api/0/issues/{issue_id}/");
    let resp = client
        .get(&url)
        .bearer_auth(auth_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("sentry get_issue: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Sentry — get_issue `{issue_id}` failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let issue: Value = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("sentry get_issue: malformed JSON — {e}"))
    })?;
    let title = issue
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("(untitled)");
    let short_id = issue
        .get("shortId")
        .and_then(|v| v.as_str())
        .unwrap_or(issue_id);
    let count = issue.get("count").and_then(|v| v.as_str()).unwrap_or("?");
    let user_count = issue
        .get("userCount")
        .and_then(|v| v.as_u64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "?".into());
    let level = issue.get("level").and_then(|v| v.as_str()).unwrap_or("?");
    let status_field = issue
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    let first_seen = issue
        .get("firstSeen")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    let last_seen = issue
        .get("lastSeen")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    let permalink = issue
        .get("permalink")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut out = format!("## Sentry issue `{short_id}`\n\n**{title}**\n\n");
    out.push_str(&format!(
        "- status: `{status_field}` · level: `{level}`\n\
         - events: `{count}` · users affected: `{user_count}`\n\
         - first seen: `{first_seen}` · last seen: `{last_seen}`\n"
    ));
    if !permalink.is_empty() {
        out.push_str(&format!("- link: {permalink}\n"));
    }
    Ok(out)
}

// ============================================================================
// GitHub
// ============================================================================
//
// Auth: `Authorization: Bearer <personal_access_token>`. GitHub also
// requires a `User-Agent` header on every request (returns 403 with a
// no-UA error message otherwise) and a specific `Accept` to get the
// v3 JSON shape stable across token types.

async fn github_list_repos(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "github", "personal_access_token")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .min(100);

    let client = http_client()?;
    let url = format!(
        "https://api.github.com/user/repos?per_page={limit}&sort=updated&affiliation=owner,collaborator,organization_member"
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "personas-desktop")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("github list_repos: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## GitHub — list_repos failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let repos: Vec<Value> = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("github list_repos: malformed JSON — {e}")))?;
    if repos.is_empty() {
        return Ok("## GitHub — no repositories visible\n\nThe token can't see any repos. Check its scopes.".into());
    }
    let mut out = format!("## GitHub — {n} repositor(ies)\n\n", n = repos.len());
    for repo in repos.iter() {
        let full_name = repo
            .get("full_name")
            .and_then(|v| v.as_str())
            .unwrap_or("(no name)");
        let private = repo.get("private").and_then(|v| v.as_bool()).unwrap_or(false);
        let desc = repo
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let pushed_at = repo
            .get("pushed_at")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let default_branch = repo
            .get("default_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let visibility = if private { "private" } else { "public" };
        out.push_str(&format!(
            "- **{full_name}** ({visibility}) — branch `{default_branch}`, last push `{pushed_at}`\n"
        ));
        if !desc.is_empty() {
            out.push_str(&format!("  · {desc}\n"));
        }
    }
    Ok(out)
}

async fn github_list_open_prs(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "github", "personal_access_token")?;
    let owner = args
        .get("owner")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("github list_open_prs: missing `owner`".into()))?;
    let repo = args
        .get("repo")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("github list_open_prs: missing `repo`".into()))?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .min(100);

    let client = http_client()?;
    let url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page={limit}&sort=updated&direction=desc"
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "personas-desktop")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("github list_open_prs: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## GitHub — list_open_prs `{owner}/{repo}` failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let prs: Vec<Value> = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("github list_open_prs: malformed JSON — {e}")))?;
    if prs.is_empty() {
        return Ok(format!(
            "## GitHub — no open PRs in `{owner}/{repo}`\n\nThe repo is currently clear."
        ));
    }
    let mut out = format!(
        "## GitHub — {n} open PR(s) in `{owner}/{repo}`\n\n",
        n = prs.len()
    );
    for pr in prs.iter() {
        let number = pr.get("number").and_then(|v| v.as_u64()).unwrap_or(0);
        let title = pr
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("(untitled)");
        let user = pr
            .get("user")
            .and_then(|v| v.get("login"))
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let draft = pr.get("draft").and_then(|v| v.as_bool()).unwrap_or(false);
        let updated_at = pr
            .get("updated_at")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let url = pr.get("html_url").and_then(|v| v.as_str()).unwrap_or("");
        let draft_marker = if draft { " (draft)" } else { "" };
        out.push_str(&format!(
            "- **#{number}{draft_marker}** — {title}\n  · by `{user}` · updated `{updated_at}`"
        ));
        if !url.is_empty() {
            out.push_str(&format!(" · {url}"));
        }
        out.push('\n');
    }
    Ok(out)
}

// ============================================================================
// Slack
// ============================================================================
//
// Auth: `Authorization: Bearer xoxb-...`. Slack responds HTTP 200 with
// `{"ok": false, "error": "..."}` for most failures, so checking
// status alone isn't enough — we explicitly look at the `ok` field.

async fn slack_list_channels(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "slack", "bot_token")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50)
        .min(200);

    let client = http_client()?;
    let url = format!(
        "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit={limit}"
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("slack list_channels: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Slack — list_channels failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("slack list_channels: malformed JSON — {e}")))?;
    let ok = parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        let err = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("(no error message)");
        return Ok(format!(
            "## Slack — list_channels rejected\n\n`{err}` — common causes: missing `channels:read`/`groups:read` scope on the bot token."
        ));
    }
    let channels = parsed
        .get("channels")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if channels.is_empty() {
        return Ok("## Slack — no channels visible\n\nThe bot isn't a member of any channel yet. Invite it (`/invite @<bot>`) and retry.".into());
    }
    let mut out = format!("## Slack — {n} channel(s)\n\n", n = channels.len());
    for c in channels.iter() {
        let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        let is_private = c.get("is_private").and_then(|v| v.as_bool()).unwrap_or(false);
        let num_members = c.get("num_members").and_then(|v| v.as_u64()).unwrap_or(0);
        let topic = c
            .get("topic")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let kind = if is_private { "private" } else { "public" };
        out.push_str(&format!(
            "- **#{name}** ({kind}, {num_members} member(s)) — id `{id}`\n"
        ));
        if !topic.is_empty() {
            out.push_str(&format!("  · topic: {topic}\n"));
        }
    }
    Ok(out)
}

// ============================================================================
// Gmail
// ============================================================================
//
// Auth: `Authorization: Bearer <access_token>` (Google OAuth). The
// stored token may have expired — when that happens upstream returns
// 401; we surface that as a friendly markdown error so Athena can
// suggest re-authorizing instead of trying again.
//
// The list endpoint returns only thread metadata (id + snippet +
// historyId); to get a Subject/From, you'd need an N+1 fetch per
// thread. For v1 we show the snippet — enough for a quick "what's in
// my inbox" answer without burning rate-limit budget.

async fn gmail_list_recent_threads(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "gmail", "access_token")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .min(50);

    let client = http_client()?;
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults={limit}&labelIds=INBOX"
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("gmail list_recent_threads: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Ok("## Gmail — access token expired\n\nRe-authorize the Gmail connector in **Connections → Gmail**, then ask me again.".into());
    }
    if !status.is_success() {
        return Ok(format!(
            "## Gmail — list_recent_threads failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("gmail list_recent_threads: malformed JSON — {e}"))
    })?;
    let threads = parsed
        .get("threads")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if threads.is_empty() {
        return Ok("## Gmail — inbox is empty (no threads under INBOX label)".into());
    }
    let mut out = format!("## Gmail — {n} recent inbox thread(s)\n\n", n = threads.len());
    for t in threads.iter() {
        let id = t.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        let snippet = t.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
        let snippet = truncate_for_episode(snippet, 160);
        out.push_str(&format!("- `{id}` — {snippet}\n"));
    }
    out.push_str("\n_(Snippets only; ask me to fetch a specific thread by id for subject/sender/body.)_\n");
    Ok(out)
}
