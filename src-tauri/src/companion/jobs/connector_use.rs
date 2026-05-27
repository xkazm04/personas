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
    cred_pool: &crate::db::DbPool,
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
    //
    // Zero-config builtins (`local_drive`, `personas_database`) have no
    // credential — `fields: []` in builtin_connectors.rs. For those we
    // pass an empty HashMap and the handler reaches into in-process
    // resources (pool, managed drive root) instead of an HTTP call.
    // Credentials live in the main `db` pool (persona_credentials table),
    // separate from `user_db` (companion brain / agents' working data).
    // Pass `cred_pool` (`state.db`) to the credential repo, NOT `pool`
    // (`state.user_db`) which lacks the persona_credentials table.
    let fields = match credentials::get_by_service_type(cred_pool, connector_name)?
        .into_iter()
        .next()
    {
        Some(cred) => credentials::get_decrypted_fields(cred_pool, &cred)?,
        None => HashMap::new(),
    };

    // Surface what we're about to do while the (up to 20s) HTTP call is in
    // flight — the inline ConnectorCallCard shows this instead of a bare
    // spinner. The card already renders backend-generated content
    // (result/error markdown), so this short note shares that channel.
    progress.report(format!("Calling {connector_name} · {capability}…"));

    dispatch_capability(pool, connector_name, cap.slug, &args, &fields).await
}

async fn dispatch_capability(
    pool: &UserDbPool,
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
        ("gmail", "mark_thread_read") | ("google_workspace", "mark_thread_read") => {
            gmail_mark_thread_read(args, fields).await
        }
        ("gmail", "send_message") | ("google_workspace", "send_message") => {
            gmail_send_message(args, fields).await
        }
        ("discord", "list_recent_messages") => discord_list_recent_messages(args, fields).await,
        ("discord", "post_message") => discord_post_message(args, fields).await,
        ("notion", "list_pages") => notion_list_pages(args, fields).await,
        ("notion", "get_page") => notion_get_page(args, fields).await,
        ("notion", "delete_page") => notion_delete_page(args, fields).await,
        ("local_drive", "list_files") => local_drive_list_files(args).await,
        ("local_drive", "count_files") => local_drive_count_files(args).await,
        ("local_drive", "write_text_file") => local_drive_write_text_file(args).await,
        ("elevenlabs", "list_voices") => elevenlabs_list_voices(args, fields).await,
        ("elevenlabs", "generate_tts") => elevenlabs_generate_tts(args, fields).await,
        ("personas_database", "list_tables") => personas_db_list_tables(pool).await,
        ("personas_database", "describe_table") => personas_db_describe_table(pool, args).await,
        ("personas_database", "execute_select") => personas_db_execute_select(pool, args).await,
        ("personas_database", "execute_mutation") => personas_db_execute_mutation(pool, args).await,
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

/// Public re-export of the dispatcher for the approval-gated path:
/// when `requires_approval` is true on `ConnectorCapability`, the
/// approval card's `execute_use_connector` calls this directly instead
/// of going through the background-job worker. Same per-service
/// handler, just routed through approval-on-click instead of auto-fire.
pub async fn dispatch_capability_public(
    pool: &UserDbPool,
    connector_name: &str,
    capability: &str,
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    dispatch_capability(pool, connector_name, capability, args, fields).await
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

// ============================================================================
// Gmail — write capabilities (approval-gated)
// ============================================================================

async fn gmail_mark_thread_read(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "gmail", "access_token")?;
    let thread_id = args
        .get("thread_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("gmail mark_thread_read: missing `thread_id`".into()))?;
    let client = http_client()?;
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}/modify"
    );
    let resp = client
        .post(&url)
        .bearer_auth(token)
        .json(&serde_json::json!({ "removeLabelIds": ["UNREAD"] }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("gmail mark_thread_read: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Ok("## Gmail — access token expired\n\nRe-authorize in **Connections → Gmail**, then try again.".into());
    }
    if !status.is_success() {
        return Ok(format!(
            "## Gmail — mark_thread_read failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    Ok(format!(
        "## Gmail — thread `{thread_id}` marked as read\n\nUNREAD label removed."
    ))
}

async fn gmail_send_message(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "gmail", "access_token")?;
    let to = args
        .get("to")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("gmail send_message: missing `to`".into()))?;
    let subject = args.get("subject").and_then(|v| v.as_str()).unwrap_or("");
    let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");

    // RFC-822 message → base64url-safe (Gmail API requirement).
    let raw_message = format!(
        "To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n{body}"
    );
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::URL_SAFE.encode(raw_message.as_bytes());

    let client = http_client()?;
    let url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    let resp = client
        .post(url)
        .bearer_auth(token)
        .json(&serde_json::json!({ "raw": encoded }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("gmail send_message: request failed — {e}")))?;
    let status = resp.status();
    let resp_body = resp.text().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Ok("## Gmail — access token expired\n\nRe-authorize in **Connections → Gmail**, then try again.".into());
    }
    if !status.is_success() {
        return Ok(format!(
            "## Gmail — send_message failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&resp_body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&resp_body).unwrap_or(serde_json::json!({}));
    let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("?");
    Ok(format!(
        "## Gmail — sent to `{to}`\n\nMessage id: `{id}` — subject: \"{subject}\"."
    ))
}

// ============================================================================
// Discord — bot-token capabilities
// ============================================================================
//
// Auth: `Authorization: Bot <bot_token>` against discord.com/api/v10/.
// Bot must already be a member of the target guild for channel access.

async fn discord_list_recent_messages(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "discord", "bot_token")?;
    let channel_id = args
        .get("channel_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("discord list_recent_messages: missing `channel_id`".into()))?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .min(100);
    let client = http_client()?;
    let url = format!(
        "https://discord.com/api/v10/channels/{channel_id}/messages?limit={limit}"
    );
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("discord list_recent_messages: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Discord — list_recent_messages failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```\n\n_(401/403 typically means the bot isn't a member of this channel's guild, or the channel id is wrong.)_",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let messages: Value = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("discord list_recent_messages: malformed JSON — {e}"))
    })?;
    let messages = messages.as_array().cloned().unwrap_or_default();
    if messages.is_empty() {
        return Ok(format!(
            "## Discord — channel `{channel_id}` has no recent messages"
        ));
    }
    let mut out = format!(
        "## Discord — {n} recent message(s) in channel `{channel_id}`\n\n",
        n = messages.len()
    );
    for m in messages.iter() {
        let author = m
            .get("author")
            .and_then(|a| a.get("username"))
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let content = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let content = truncate_for_episode(content, 200);
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        out.push_str(&format!("- **{author}** (`{id}`): {content}\n"));
    }
    Ok(out)
}

async fn discord_post_message(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "discord", "bot_token")?;
    let channel_id = args
        .get("channel_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("discord post_message: missing `channel_id`".into()))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("discord post_message: missing `content`".into()))?;
    let client = http_client()?;
    let url = format!("https://discord.com/api/v10/channels/{channel_id}/messages");
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bot {token}"))
        .json(&serde_json::json!({ "content": content }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("discord post_message: request failed — {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Discord — post_message failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```\n\n_(401/403 typically means the bot doesn't have permission to post in this channel.)_",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
    let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("?");
    Ok(format!(
        "## Discord — posted to channel `{channel_id}`\n\nMessage id: `{id}` — content: \"{content}\"."
    ))
}

// ============================================================================
// Notion — REST API at api.notion.com (Bearer + Notion-Version header)
// ============================================================================

const NOTION_API_VERSION: &str = "2022-06-28";

async fn notion_list_pages(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "notion", "api_key")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .min(100);
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let older_than_days = args.get("older_than_days").and_then(|v| v.as_i64());

    let client = http_client()?;
    let body = serde_json::json!({
        "query": query,
        "filter": { "value": "page", "property": "object" },
        "sort": { "direction": "descending", "timestamp": "last_edited_time" },
        "page_size": limit,
    });
    let resp = client
        .post("https://api.notion.com/v1/search")
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("notion list_pages: request failed -- {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Notion -- list_pages failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("notion list_pages: malformed JSON -- {e}"))
    })?;
    let results = parsed.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let cutoff_iso = older_than_days.map(|days| {
        chrono::Utc::now() - chrono::Duration::days(days)
    });
    let mut rows: Vec<(String, String, String)> = Vec::new();
    for p in results.iter() {
        let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let last_edited = p
            .get("last_edited_time")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(cut) = cutoff_iso {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(last_edited) {
                if t > cut {
                    continue;
                }
            }
        }
        let title = p
            .get("properties")
            .and_then(|props| {
                props
                    .as_object()
                    .and_then(|obj| {
                        obj.values().find_map(|v| {
                            v.get("title")
                                .and_then(|t| t.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|rt| rt.get("plain_text").and_then(|s| s.as_str()))
                        })
                    })
            })
            .unwrap_or("(untitled)")
            .to_string();
        rows.push((id, title, last_edited.to_string()));
    }
    if rows.is_empty() {
        let filter_note = older_than_days
            .map(|d| format!(" older than {d} days"))
            .unwrap_or_default();
        return Ok(format!(
            "## Notion -- no pages found{filter_note}\n\n_(integration token has access to {} pages total; filter excluded all.)_",
            results.len()
        ));
    }
    let filter_note = older_than_days
        .map(|d| format!(" (older than {d} days)"))
        .unwrap_or_default();
    let mut out = format!(
        "## Notion -- {n} page(s){filter_note}\n\n",
        n = rows.len()
    );
    for (id, title, last_edited) in rows.iter() {
        let title = truncate_for_episode(title, 80);
        out.push_str(&format!("- `{id}` -- **{title}** (last edited {last_edited})\n"));
    }
    Ok(out)
}

async fn notion_get_page(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "notion", "api_key")?;
    let page_id = args
        .get("page_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("notion get_page: missing `page_id`".into()))?;
    let client = http_client()?;
    let url = format!("https://api.notion.com/v1/pages/{page_id}");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("notion get_page: request failed -- {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Notion -- get_page failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    Ok(format!(
        "## Notion -- page `{page_id}`\n\n```json\n{body}\n```",
        body = truncate_for_episode(&body, 1500)
    ))
}

async fn notion_delete_page(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let token = required_field(fields, "notion", "api_key")?;
    let page_id = args
        .get("page_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("notion delete_page: missing `page_id`".into()))?;
    let client = http_client()?;
    let url = format!("https://api.notion.com/v1/pages/{page_id}");
    let resp = client
        .patch(&url)
        .bearer_auth(token)
        .header("Notion-Version", NOTION_API_VERSION)
        .json(&serde_json::json!({ "archived": true }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("notion delete_page: request failed -- {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## Notion -- delete_page failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    Ok(format!(
        "## Notion -- page `{page_id}` archived\n\nThe page is now `archived: true` (Notion's soft-delete -- disappears from search and most views; restorable from Notion trash within 30 days)."
    ))
}

// ============================================================================
// Local drive -- zero-config builtin
// ============================================================================

fn drive_root_path() -> Result<std::path::PathBuf, AppError> {
    if let Some(root) = crate::commands::drive::managed_root_cache() {
        return Ok(root);
    }
    if cfg!(debug_assertions) {
        let cwd = std::env::current_dir()
            .map_err(|e| AppError::Internal(format!("cwd unavailable: {e}")))?;
        let candidate = cwd.join(".dev-drive");
        std::fs::create_dir_all(&candidate)?;
        return Ok(candidate);
    }
    Err(AppError::Internal(
        "local_drive: drive root not initialized -- open the Drive plugin panel once so the app sets up the managed root, then ask me again.".into(),
    ))
}

fn resolve_within(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf, AppError> {
    let candidate = root.join(rel.trim_start_matches('/').trim_start_matches('\\'));
    let canon = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.clone());
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if !canon.starts_with(&root_canon) {
        return Err(AppError::Internal(format!(
            "local_drive: rel_path `{rel}` resolves outside the drive root"
        )));
    }
    Ok(canon)
}

async fn local_drive_list_files(args: &Value) -> Result<String, AppError> {
    let rel = args.get("rel_path").and_then(|v| v.as_str()).unwrap_or("");
    let root = drive_root_path()?;
    let target = resolve_within(&root, rel)?;
    if !target.is_dir() {
        return Ok(format!(
            "## Local drive -- `{rel}` is not a directory\n\n_(or doesn't exist yet)_"
        ));
    }
    let mut entries: Vec<(String, bool)> = Vec::new();
    for entry in std::fs::read_dir(&target)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), ".DS_Store" | "Thumbs.db" | "desktop.ini") {
            continue;
        }
        let is_dir = entry.file_type()?.is_dir();
        entries.push((name, is_dir));
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    if entries.is_empty() {
        return Ok(format!("## Local drive -- `{rel}` is empty"));
    }
    let label = if rel.is_empty() { "/".to_string() } else { format!("/{rel}") };
    let mut out = format!("## Local drive -- {n} entr(y/ies) at `{label}`\n\n", n = entries.len());
    for (name, is_dir) in entries.iter().take(50) {
        let kind = if *is_dir { "FOLDER" } else { "FILE" };
        out.push_str(&format!("- [{kind}] `{name}`\n"));
    }
    if entries.len() > 50 {
        out.push_str(&format!("\n_(and {} more -- ask for a specific subpath to drill in.)_\n", entries.len() - 50));
    }
    Ok(out)
}

async fn local_drive_count_files(args: &Value) -> Result<String, AppError> {
    let rel = args.get("rel_path").and_then(|v| v.as_str()).unwrap_or("");
    let root = drive_root_path()?;
    let target = resolve_within(&root, rel)?;
    if !target.exists() {
        return Ok(format!("## Local drive -- `{rel}` doesn't exist"));
    }
    let mut file_count: usize = 0;
    let mut folder_count: usize = 0;
    let mut bytes: u64 = 0;
    let mut stack = vec![target.clone()];
    while let Some(dir) = stack.pop() {
        if !dir.is_dir() {
            file_count += 1;
            if let Ok(md) = std::fs::metadata(&dir) {
                bytes += md.len();
            }
            continue;
        }
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if matches!(name.as_str(), ".DS_Store" | "Thumbs.db" | "desktop.ini") {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                folder_count += 1;
                stack.push(path);
            } else {
                file_count += 1;
                if let Ok(md) = entry.metadata() {
                    bytes += md.len();
                }
            }
        }
    }
    let label = if rel.is_empty() { "/".to_string() } else { format!("/{rel}") };
    let mb = (bytes as f64) / 1_048_576.0;
    Ok(format!(
        "## Local drive -- `{label}` contains **{file_count}** file(s) across **{folder_count}** folder(s) -- {mb:.2} MB total"
    ))
}

async fn local_drive_write_text_file(args: &Value) -> Result<String, AppError> {
    let rel = args
        .get("rel_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("local_drive write_text_file: missing `rel_path`".into()))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("local_drive write_text_file: missing `content`".into()))?;
    let root = drive_root_path()?;
    let target = resolve_within(&root, rel)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, content.as_bytes())?;
    Ok(format!(
        "## Local drive -- wrote `{}` ({} bytes)",
        target
            .strip_prefix(&root)
            .unwrap_or(&target)
            .to_string_lossy(),
        content.len()
    ))
}

// ============================================================================
// ElevenLabs -- voice listing + TTS
// ============================================================================

async fn elevenlabs_list_voices(
    _args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let api_key = required_field(fields, "elevenlabs", "api_key")?;
    let client = http_client()?;
    let resp = client
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", api_key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("elevenlabs list_voices: request failed -- {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Ok(format!(
            "## ElevenLabs -- list_voices failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let parsed: Value = serde_json::from_str(&body).map_err(|e| {
        AppError::Internal(format!("elevenlabs list_voices: malformed JSON -- {e}"))
    })?;
    let voices = parsed.get("voices").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if voices.is_empty() {
        return Ok("## ElevenLabs -- no voices available".into());
    }
    let mut out = format!("## ElevenLabs -- {n} voice(s)\n\n", n = voices.len());
    for v in voices.iter().take(50) {
        let name = v.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        let id = v.get("voice_id").and_then(|v| v.as_str()).unwrap_or("?");
        let category = v.get("category").and_then(|v| v.as_str()).unwrap_or("");
        out.push_str(&format!("- **{name}** (`{id}`) -- _{category}_\n"));
    }
    if voices.len() > 50 {
        out.push_str(&format!("\n_(and {} more.)_\n", voices.len() - 50));
    }
    Ok(out)
}

async fn elevenlabs_generate_tts(
    args: &Value,
    fields: &HashMap<String, String>,
) -> Result<String, AppError> {
    let api_key = required_field(fields, "elevenlabs", "api_key")?;
    let voice_id = args
        .get("voice_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("elevenlabs generate_tts: missing `voice_id`".into()))?;
    let text = args
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("elevenlabs generate_tts: missing `text`".into()))?;
    if text.len() > 1000 {
        return Err(AppError::Internal(format!(
            "elevenlabs generate_tts: text is {} chars (cap: 1000). Split into shorter clips or use the ElevenLabs UI for long-form.",
            text.len()
        )));
    }
    let default_path = format!("tts/clip-{}.mp3", chrono::Utc::now().timestamp());
    let out_rel = args
        .get("out_rel_path")
        .and_then(|v| v.as_str())
        .unwrap_or(&default_path);

    let client = http_client()?;
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}");
    let resp = client
        .post(&url)
        .header("xi-api-key", api_key)
        .header("Accept", "audio/mpeg")
        .json(&serde_json::json!({
            "text": text,
            "model_id": "eleven_turbo_v2_5",
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("elevenlabs generate_tts: request failed -- {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(format!(
            "## ElevenLabs -- generate_tts failed\n\nUpstream returned **{status}**.\n\n```\n{body}\n```",
            body = truncate_for_episode(&body, 500)
        ));
    }
    let audio_bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("elevenlabs generate_tts: body read failed -- {e}")))?;

    let root = drive_root_path()?;
    let target = resolve_within(&root, out_rel)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, &audio_bytes)?;
    Ok(format!(
        "## ElevenLabs -- generated {bytes} bytes\n\nSaved to `{}` ({} characters of text).",
        target
            .strip_prefix(&root)
            .unwrap_or(&target)
            .to_string_lossy(),
        text.len(),
        bytes = audio_bytes.len()
    ))
}

// ============================================================================
// Personas SQLite database -- zero-config builtin
// ============================================================================

fn is_single_statement(sql: &str) -> bool {
    let trimmed = sql.trim().trim_end_matches(';');
    !trimmed.contains(';')
}

async fn personas_db_list_tables(pool: &UserDbPool) -> Result<String, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' \
         AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if names.is_empty() {
        return Ok("## Personas database -- no user tables".into());
    }
    let mut out = format!("## Personas database -- {n} table(s)\n\n", n = names.len());
    for n in names.iter() {
        out.push_str(&format!("- `{n}`\n"));
    }
    Ok(out)
}

async fn personas_db_describe_table(
    pool: &UserDbPool,
    args: &Value,
) -> Result<String, AppError> {
    let name = args
        .get("table_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("personas_database describe_table: missing `table_name`".into()))?;
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::Internal(format!(
            "personas_database describe_table: invalid table name `{name}` (alphanumeric + underscore only)"
        )));
    }
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{name}\")"))?;
    let rows: Vec<(String, String, i64)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Ok(format!("## Personas database -- table `{name}` not found"));
    }
    let mut out = format!("## Personas database -- `{name}` schema\n\n");
    for (col, ty, notnull) in rows.iter() {
        let nullable = if *notnull == 1 { "NOT NULL" } else { "nullable" };
        out.push_str(&format!("- `{col}` -- `{ty}` ({nullable})\n"));
    }
    Ok(out)
}

async fn personas_db_execute_select(
    pool: &UserDbPool,
    args: &Value,
) -> Result<String, AppError> {
    let sql = args
        .get("sql")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("personas_database execute_select: missing `sql`".into()))?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50)
        .min(200) as usize;
    let trimmed = sql.trim();
    if !trimmed.to_lowercase().starts_with("select") {
        return Err(AppError::Internal(
            "personas_database execute_select: only SELECT is allowed here. Use `execute_mutation` for writes (approval-gated).".into(),
        ));
    }
    if !is_single_statement(trimmed) {
        return Err(AppError::Internal(
            "personas_database execute_select: only one statement per call.".into(),
        ));
    }
    let conn = pool.get()?;
    let mut stmt = conn.prepare(trimmed)?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut iter = stmt.query([])?;
    while let Some(row) = iter.next()? {
        if rows.len() >= limit {
            break;
        }
        let mut r: Vec<String> = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let val: rusqlite::types::Value = row.get(i)?;
            let s = match val {
                rusqlite::types::Value::Null => "NULL".to_string(),
                rusqlite::types::Value::Integer(i) => i.to_string(),
                rusqlite::types::Value::Real(f) => format!("{f}"),
                rusqlite::types::Value::Text(t) => truncate_for_episode(&t, 80),
                rusqlite::types::Value::Blob(b) => format!("<{}b blob>", b.len()),
            };
            r.push(s);
        }
        rows.push(r);
    }
    if rows.is_empty() {
        return Ok(format!(
            "## Personas database -- SELECT returned 0 rows\n\nQuery:\n```sql\n{trimmed}\n```"
        ));
    }
    let mut out = format!(
        "## Personas database -- SELECT returned {} row(s)\n\n| {} |\n| {} |\n",
        rows.len(),
        col_names.join(" | "),
        col_names.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")
    );
    for r in rows.iter() {
        out.push_str(&format!("| {} |\n", r.join(" | ")));
    }
    Ok(out)
}

async fn personas_db_execute_mutation(
    pool: &UserDbPool,
    args: &Value,
) -> Result<String, AppError> {
    let sql = args
        .get("sql")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("personas_database execute_mutation: missing `sql`".into()))?;
    let trimmed = sql.trim();
    let lower = trimmed.to_lowercase();
    let allowed_starts =
        ["create", "insert", "update", "delete", "drop", "alter", "replace"];
    if !allowed_starts.iter().any(|v| lower.starts_with(v)) {
        return Err(AppError::Internal(format!(
            "personas_database execute_mutation: rejected -- must start with one of {allowed_starts:?}"
        )));
    }
    if !is_single_statement(trimmed) {
        return Err(AppError::Internal(
            "personas_database execute_mutation: only one statement per call.".into(),
        ));
    }
    let conn = pool.get()?;
    let changed = conn.execute(trimmed, [])?;
    Ok(format!(
        "## Personas database -- mutation executed\n\nQuery:\n```sql\n{trimmed}\n```\n\nRows affected: **{changed}**."
    ))
}
