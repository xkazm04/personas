//! The persona chat turn, in Rust (PHASE2-SPEC 5.3).
//!
//! Until 2026-10-06 a persona chat turn was orchestrated in the desktop
//! FRONTEND (`chatSlice.sendChatMessage` + `finishChatStream`): the webview
//! inserted the user row, saved the session context, built the input JSON,
//! called `execute_persona`, and - when the terminal status event arrived -
//! assembled the reply from the streamed lines and inserted the assistant
//! row. Nothing in Rust could start a turn, so a phone could not either, and a
//! webview reload mid-turn lost the reply.
//!
//! This module is now the ONE turn path. [`start`] does the five steps and
//! registers a completion hook; the desktop's `sendChatMessage` and its
//! "respond with feedback" background chat (`startFeedbackChat`, which names
//! the new session after the report through [`ChatTurnOptions::title`]) call
//! it through [`start_chat_turn`](super::chat::start_chat_turn), and a paired
//! phone's `chat_send` calls it from `cloud::persona_chat_send`. The streaming
//! display in the desktop is unchanged: it still comes from the execution's
//! `execution-output` events, which this module does not touch.
//!
//! # Parity with the TypeScript path it replaces
//!
//! The input JSON is byte-identical to what `chatSlice.ts` built
//! ([`build_turn_input`], pinned by `fixtures/chat-turn-input-v1.json`, which a
//! vitest test reproduces with a verbatim copy of the old TS builder and the
//! tests below reproduce with this one). So are the session title
//! ([`derive_title`]) and summary ([`build_summary`]): JavaScript `slice` and
//! `length` count UTF-16 units, and so do they.
//!
//! Three places differ, on purpose:
//! * The transcript comes from the database (the session's newest
//!   [`TRANSCRIPT_CAP`] messages, the in-memory cap the slice kept), not from
//!   whatever the webview happened to hold.
//! * The reply is assembled from the execution row's `output_data` (the
//!   engine's assistant text), filtered line by line with the same classifier
//!   the slice applied to streamed lines ([`is_text_line`]). The slice also
//!   kept non-assistant lines that happen to classify as text (a `[FAILOVER]`
//!   notice, the 10 MB truncation marker); the reply no longer does.
//! * The completion write keeps the session's chat mode. The slice's
//!   completion save omitted it, and the repository's `COALESCE(?, 'ops')`
//!   reset every session to `ops` after its first answer.
//!
//! The feedback chat's first turn is pinned the same way
//! (`fixtures/chat-turn-feedback-input-v1.json`: its title and its
//! `_advisory` input). It inherits the differences above, plus one of its
//! own: its `conversation` line now quotes the STORED message, as the desk
//! chat's always did, where the old feedback builder quoted the instruction
//! as typed - the two differ only when a quoted report excerpt holds HTML
//! tags, which the stored copy strips.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use serde::Serialize;
use tauri::AppHandle;
use ts_rs::TS;

use crate::db::models::{
    ChatMessage, ChatRole, CreateChatMessageInput, PersonaExecution, UpsertSessionContextInput,
};
use crate::db::repos::communication::chat as repo;
use crate::db::DbPool;
use crate::engine::types::Continuation;
use crate::error::AppError;
use crate::AppState;

/// The newest messages the transcript (and the summary's window) is read
/// from: the in-memory cap `chatSlice` kept (`MAX_CHAT_MESSAGES`).
pub const TRANSCRIPT_CAP: i64 = 500;

/// How often the completion hook re-reads the execution row while it waits
/// (the engine's completion signal normally wakes it first).
const COMPLETION_POLL: Duration = Duration::from_secs(5);

/// How long the completion hook waits for a turn at most. A queued run can
/// wait a long time behind others; a run still active after this is not one
/// whose reply anybody is waiting on in this process.
const COMPLETION_MAX_WAIT: Duration = Duration::from_secs(24 * 60 * 60);

/// The two input shapes a turn can take. The desktop slice called them
/// `advisory` (a consultant ABOUT the agent, `_advisory`) and `agent` (the
/// agent itself, `_chat`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatTurnMode {
    Advisory,
    Agent,
}

impl ChatTurnMode {
    /// The mode the desktop composer sends: `isAdvisory = chatMode ===
    /// 'advisory'`, so anything else is the agent.
    pub fn from_ui(mode: &str) -> Self {
        if mode == "advisory" {
            Self::Advisory
        } else {
            Self::Agent
        }
    }

    /// The mode a stored session reopens in: `restoreChatSession` maps
    /// `ctx.chatMode === 'agent' ? 'agent' : 'advisory'`.
    pub fn from_stored(mode: &str) -> Self {
        if mode == "agent" {
            Self::Agent
        } else {
            Self::Advisory
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Advisory => "advisory",
            Self::Agent => "agent",
        }
    }
}

/// One message of the transcript, as the builder reads it.
#[derive(Debug, Clone, Copy)]
pub struct Line<'a> {
    pub role: &'a str,
    pub content: &'a str,
}

/// The `{_chat:true, latest_message}` of a resumed turn.
#[derive(Serialize)]
struct ResumedInput<'a> {
    #[serde(rename = "_chat")]
    chat: bool,
    latest_message: &'a str,
}

/// The first-turn (or no-session) input, agent mode.
#[derive(Serialize)]
struct ChatInput<'a> {
    #[serde(rename = "_chat")]
    chat: bool,
    conversation: &'a str,
    latest_message: &'a str,
}

/// The first-turn (or no-session) input, advisory mode.
#[derive(Serialize)]
struct AdvisoryInput<'a> {
    #[serde(rename = "_advisory")]
    advisory: bool,
    conversation: &'a str,
    latest_message: &'a str,
}

/// What `execute_persona` is called with.
#[derive(Debug, Clone)]
pub struct TurnInput {
    pub input: String,
    pub continuation: Option<Continuation>,
}

/// `Human` / `Assistant`, as the slice wrote them: every role that is not
/// `user` reads as the assistant.
fn speaker(role: &str) -> &'static str {
    if role == "user" {
        "Human"
    } else {
        "Assistant"
    }
}

/// The input JSON of a turn - `chatSlice.ts` (steps 3-4 of the old
/// `sendChatMessage`), rule for rule:
///
/// * a follow-up with a Claude session to resume (`claude_session_id`
///   non-empty and not the first message) sends `{_chat:true,
///   latest_message}` and continues natively with `SessionResume`; advisory
///   mode is NOT re-flagged on resume, because the resumed session already
///   holds the advisory prompt from its first turn;
/// * otherwise the whole transcript is sent: `{_advisory|_chat: true,
///   conversation, latest_message}`, the conversation being every message as
///   `Human: …` / `Assistant: …` joined by a blank line.
///
/// `transcript` includes the message being sent (it was inserted first), and
/// `latest_message` is the message as typed, before the repository stripped
/// any HTML from the stored copy - both exactly as the slice did.
pub fn build_turn_input(
    mode: ChatTurnMode,
    is_first: bool,
    claude_session_id: Option<&str>,
    transcript: &[Line<'_>],
    message: &str,
) -> Result<TurnInput, AppError> {
    let encode = |r: Result<String, serde_json::Error>| {
        r.map_err(|e| AppError::Internal(format!("chat turn input encode: {e}")))
    };
    if let Some(resume) = claude_session_id.filter(|s| !s.is_empty() && !is_first) {
        return Ok(TurnInput {
            input: encode(serde_json::to_string(&ResumedInput {
                chat: true,
                latest_message: message,
            }))?,
            continuation: Some(Continuation::SessionResume(resume.to_string())),
        });
    }
    let conversation = transcript
        .iter()
        .map(|l| format!("{}: {}", speaker(l.role), l.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    let input = match mode {
        ChatTurnMode::Advisory => serde_json::to_string(&AdvisoryInput {
            advisory: true,
            conversation: &conversation,
            latest_message: message,
        }),
        ChatTurnMode::Agent => serde_json::to_string(&ChatInput {
            chat: true,
            conversation: &conversation,
            latest_message: message,
        }),
    };
    Ok(TurnInput {
        input: encode(input)?,
        continuation: None,
    })
}

/// JavaScript's `\s` (and `trim`): Unicode White_Space without U+0085, plus
/// the BOM.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// The longest prefix of `s` of at most `units` UTF-16 code units - JS
/// `s.slice(0, units)`, except that a surrogate pair is never split (JS would
/// keep a lone high surrogate, which a Rust string cannot hold).
fn utf16_prefix(s: &str, units: usize) -> &str {
    let mut used = 0;
    for (i, c) in s.char_indices() {
        used += c.len_utf16();
        if used > units {
            return &s[..i];
        }
    }
    s
}

fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// A session's title from its first message (`deriveTitle`): whitespace runs
/// collapsed, trimmed, at most 60 UTF-16 units (57 plus `...`).
pub fn derive_title(content: &str) -> String {
    let mut collapsed = String::with_capacity(content.len());
    let mut in_space = false;
    for c in content.chars() {
        if is_js_space(c) {
            if !in_space {
                collapsed.push(' ');
            }
            in_space = true;
        } else {
            collapsed.push(c);
            in_space = false;
        }
    }
    shorten_title(collapsed.trim_matches(is_js_space)).0
}

/// A cleaned title at most 60 UTF-16 units long, and whether it was cut (57
/// units plus `...`, the slice's rule). The flag is the record of the cut;
/// the ellipsis is only what the reader sees.
fn shorten_title(clean: &str) -> (String, bool) {
    if utf16_len(clean) <= 60 {
        return (clean.to_string(), false);
    }
    let mut cut = utf16_prefix(clean, 57).to_string();
    cut.push_str("...");
    (cut, true)
}

/// The session summary (`buildSummary`): the last 20 messages, each cut to
/// 300 UTF-16 units, as `Human: …` / `Assistant: …`, joined by a blank line.
pub fn build_summary(messages: &[Line<'_>]) -> String {
    let start = messages.len().saturating_sub(20);
    messages[start..]
        .iter()
        .map(|l| format!("{}: {}", speaker(l.role), utf16_prefix(l.content, 300)))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `classifyLine(line) === 'text'` (`src/lib/utils/terminalColors.ts`), the
/// filter the slice applied to streamed lines before saving a reply.
pub fn is_text_line(line: &str) -> bool {
    const NOT_TEXT_PREFIXES: &[&str] = &[
        "[ERROR]",
        "[TIMEOUT]",
        "[WARN]",
        "[SUMMARY]",
        "[System]",
        "> Using tool:",
        "  Tool result:",
        "  subagent",
        "> Analyzing",
        "> Attempt",
        "> Resuming",
        "> Query succeeded",
        "> Max retries",
        "> Cancelled",
        "Session started",
        "Completed in",
        "Cost: $",
        "=== ",
        "Process exited",
    ];
    if NOT_TEXT_PREFIXES.iter().any(|p| line.starts_with(p)) {
        return false;
    }
    // Any other `> ` line is CLI code, except `> _`.
    !line.starts_with("> ") || line.starts_with("> _")
}

/// The assistant reply of a finished execution: its assistant text, line by
/// line through [`is_text_line`], joined and trimmed (the slice's
/// `textLines.join('\n').trim()`).
pub fn assemble_reply(output_data: Option<&str>) -> String {
    let Some(out) = output_data else {
        return String::new();
    };
    out.split('\n')
        .filter(|l| is_text_line(l))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// A new session id, in the shape the desktop mints
/// (`chat-<ms>-<8 hex>`; `startNewChatSession`).
pub fn new_session_id() -> String {
    let hex = uuid::Uuid::new_v4().simple().to_string();
    format!(
        "chat-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        &hex[..8]
    )
}

/// A turn to start.
#[derive(Debug, Clone)]
pub struct ChatTurnRequest {
    /// `None` = a new session.
    pub session_id: Option<String>,
    pub message: String,
    /// `None` = the session's stored mode ([`ChatTurnMode::from_stored`]), or
    /// [`ChatTurnMode::Agent`] for a new session.
    pub mode: Option<ChatTurnMode>,
}

/// What a caller may set beyond the request. Kept apart from
/// [`ChatTurnRequest`] so the callers that need none of it build their
/// request unchanged.
#[derive(Debug, Clone, Default)]
pub struct ChatTurnOptions {
    /// The title of a NEW session, instead of the one derived from its first
    /// message: the desktop's feedback chat names the session after the
    /// report it answers. Cut like any title (at most 60 UTF-16 units, 57
    /// plus `...`, without collapsing whitespace - the feedback slice's rule).
    /// Ignored on a follow-up: only the first message names a session.
    pub title: Option<String>,
}

/// A started turn: what the desktop slice and the remote `chat_send` need.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnStarted {
    pub session_id: String,
    /// The user's message as stored (the repository strips HTML).
    pub user_message: ChatMessage,
    /// The execution the turn runs as; its `execution-output` events carry
    /// the streamed reply.
    pub execution_id: String,
}

/// Steps 1-3 of a turn, database only: insert the user row, save the
/// session context, build the input.
#[derive(Debug, Clone)]
pub struct PreparedTurn {
    pub session_id: String,
    pub user_message: ChatMessage,
    pub mode: ChatTurnMode,
    pub input: TurnInput,
}

/// The mode a turn runs in when the caller did not choose one.
fn resolve_mode(requested: Option<ChatTurnMode>, stored: Option<&str>) -> ChatTurnMode {
    match (requested, stored) {
        (Some(m), _) => m,
        (None, Some(s)) => ChatTurnMode::from_stored(s),
        (None, None) => ChatTurnMode::Agent,
    }
}

/// [`prepare_with`] without options. Only tests call steps 1-3 alone (the
/// remote-command plane's executor double among them); production goes
/// through [`start`] / [`start_with`].
#[cfg(test)]
pub fn prepare(
    pool: &DbPool,
    persona_id: &str,
    req: &ChatTurnRequest,
) -> Result<PreparedTurn, AppError> {
    prepare_with(pool, persona_id, req, &ChatTurnOptions::default())
}

/// [`prepare`], with the caller's [`ChatTurnOptions`].
pub fn prepare_with(
    pool: &DbPool,
    persona_id: &str,
    req: &ChatTurnRequest,
    opts: &ChatTurnOptions,
) -> Result<PreparedTurn, AppError> {
    let session_id = req.session_id.clone().unwrap_or_else(new_session_id);
    let stored = repo::get_session_context(pool, &session_id)?;
    let mode = resolve_mode(req.mode, stored.as_ref().map(|c| c.chat_mode.as_str()));

    // 1. The user row.
    let user_message = repo::create(
        pool,
        CreateChatMessageInput {
            persona_id: persona_id.to_string(),
            session_id: session_id.clone(),
            role: ChatRole::User,
            content: req.message.clone(),
            execution_id: None,
            metadata: None,
        },
    )?;

    // 2. The session context: the mode, the title on the first message, the
    //    summary. The transcript is what the slice held in memory.
    let history = repo::get_session_messages(pool, persona_id, &session_id, Some(TRANSCRIPT_CAP))?;
    let lines: Vec<Line<'_>> = history
        .iter()
        .map(|m| Line {
            role: role_str(m.role),
            content: &m.content,
        })
        .collect();
    let is_first = history.len() == 1;
    let ctx = repo::upsert_session_context(
        pool,
        UpsertSessionContextInput {
            session_id: session_id.clone(),
            persona_id: persona_id.to_string(),
            title: is_first.then(|| match opts.title.as_deref() {
                Some(title) => shorten_title(title).0,
                None => derive_title(&req.message),
            }),
            summary: Some(build_summary(&lines)),
            system_prompt_hash: None,
            working_memory: None,
            chat_mode: Some(mode.as_str().to_string()),
            claude_session_id: None,
        },
    )?;

    // 3. The input. The context belongs to this session by construction (it
    //    was read by this session's id), which is the check the slice made
    //    before trusting a stored Claude session.
    let input = build_turn_input(
        mode,
        is_first,
        ctx.claude_session_id.as_deref(),
        &lines,
        &req.message,
    )?;
    Ok(PreparedTurn {
        session_id,
        user_message,
        mode,
        input,
    })
}

fn role_str(role: ChatRole) -> &'static str {
    match role {
        ChatRole::User => "user",
        ChatRole::Assistant => "assistant",
        ChatRole::System => "system",
        ChatRole::Tool => "tool",
    }
}

/// Start one persona chat turn: insert the user row, save the context, build
/// the input, start the execution (with `idempotency_key`, so a re-delivered
/// request returns the run it already started), and register the completion
/// hook that writes the reply. Returns when the execution has STARTED (or is
/// queued); the reply arrives later, as a row.
pub async fn start(
    state: &Arc<AppState>,
    app: AppHandle,
    persona_id: &str,
    req: ChatTurnRequest,
    idempotency_key: String,
) -> Result<ChatTurnStarted, AppError> {
    start_with(
        state,
        app,
        persona_id,
        req,
        &ChatTurnOptions::default(),
        idempotency_key,
    )
    .await
}

/// [`start`], with the caller's [`ChatTurnOptions`].
pub async fn start_with(
    state: &Arc<AppState>,
    app: AppHandle,
    persona_id: &str,
    req: ChatTurnRequest,
    opts: &ChatTurnOptions,
    idempotency_key: String,
) -> Result<ChatTurnStarted, AppError> {
    let prepared = prepare_with(&state.db, persona_id, &req, opts)?;
    // 4. The run. A refusal here (project off, connectors not set up) leaves
    //    the user row in place, as the slice did.
    let exec = crate::commands::execution::executions::execute_persona_inner(
        state,
        app,
        persona_id.to_string(),
        None,
        Some(prepared.input.input.clone()),
        None,
        prepared.input.continuation.clone(),
        Some(idempotency_key),
        false,
    )
    .await?;
    // 5. The reply, when the run ends.
    spawn_completion_hook(
        state.clone(),
        persona_id.to_string(),
        prepared.session_id.clone(),
        exec.id.clone(),
        prepared.mode,
    );
    Ok(ChatTurnStarted {
        session_id: prepared.session_id,
        user_message: prepared.user_message,
        execution_id: exec.id,
    })
}

/// Whether the session already holds the reply of `execution_id`, so a hook
/// registered twice (a re-delivered request) never writes it twice.
fn reply_exists(pool: &DbPool, execution_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_messages WHERE execution_id = ?1 AND role = 'assistant'",
        rusqlite::params![execution_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Step 5, database only: on a COMPLETED run with a non-empty reply, insert
/// the assistant row and store the summary and the Claude session id for the
/// next turn's `--resume`. Any other terminal state writes nothing (the
/// slice's rule: a failed, cancelled or incomplete run's partial text must not
/// become an authoritative answer that is re-sent and resumed). Returns the
/// assistant row it wrote.
pub fn finish(
    pool: &DbPool,
    persona_id: &str,
    session_id: &str,
    exec: &PersonaExecution,
    mode: ChatTurnMode,
) -> Result<Option<ChatMessage>, AppError> {
    if exec.status != "completed" {
        return Ok(None);
    }
    let mut reply = assemble_reply(exec.output_data.as_deref());
    if reply.is_empty() || reply_exists(pool, &exec.id)? {
        return Ok(None);
    }
    // The repository refuses content above its cap; a long answer is kept
    // (cut at a character boundary) rather than lost.
    let cap = personas_core::validation::chat::MAX_CONTENT_BYTES;
    if reply.len() > cap {
        reply = personas_core::utils::text::truncate_on_char_boundary(&reply, cap).to_string();
    }
    let assistant = repo::create(
        pool,
        CreateChatMessageInput {
            persona_id: persona_id.to_string(),
            session_id: session_id.to_string(),
            role: ChatRole::Assistant,
            content: reply,
            execution_id: Some(exec.id.clone()),
            metadata: None,
        },
    )?;
    let history = repo::get_session_messages(pool, persona_id, session_id, Some(TRANSCRIPT_CAP))?;
    let lines: Vec<Line<'_>> = history
        .iter()
        .map(|m| Line {
            role: role_str(m.role),
            content: &m.content,
        })
        .collect();
    repo::upsert_session_context(
        pool,
        UpsertSessionContextInput {
            session_id: session_id.to_string(),
            persona_id: persona_id.to_string(),
            title: None,
            summary: Some(build_summary(&lines)),
            system_prompt_hash: None,
            working_memory: None,
            chat_mode: Some(mode.as_str().to_string()),
            claude_session_id: exec.claude_session_id.clone().filter(|s| !s.is_empty()),
        },
    )?;
    Ok(Some(assistant))
}

fn is_terminal(status: &str) -> bool {
    status
        .parse::<crate::engine::types::ExecutionState>()
        .map(|s| s.is_terminal())
        .unwrap_or(false)
}

/// Wait for the execution to reach a terminal state: the engine's completion
/// signal, with a periodic re-read of the row as the fallback (a run cancelled
/// while still queued, or one that finished before the hook subscribed, never
/// fires the signal). `None` when the row is gone or the wait ran out.
async fn wait_terminal(state: &Arc<AppState>, execution_id: &str) -> Option<PersonaExecution> {
    let mut signal = Some(state.engine.subscribe_completion(execution_id).await);
    let deadline = tokio::time::Instant::now() + COMPLETION_MAX_WAIT;
    loop {
        match crate::db::repos::execution::executions::get_by_id(&state.db, execution_id) {
            Ok(exec) if is_terminal(&exec.status) => return Some(exec),
            Ok(_) => {}
            Err(AppError::NotFound(_)) => return None,
            Err(e) => {
                tracing::warn!(execution_id, error = %e, "chat turn: execution read failed; retrying");
            }
        }
        if tokio::time::Instant::now() >= deadline {
            tracing::warn!(
                execution_id,
                "chat turn: gave up waiting for the run to end"
            );
            return None;
        }
        match signal.as_mut() {
            Some(rx) => {
                tokio::select! {
                    _ = rx => { signal = None; }
                    _ = tokio::time::sleep(COMPLETION_POLL) => {}
                }
            }
            None => tokio::time::sleep(COMPLETION_POLL).await,
        }
    }
}

/// Register step 5: a detached task, inside a panic boundary, that waits for
/// the run and then calls [`finish`].
fn spawn_completion_hook(
    state: Arc<AppState>,
    persona_id: String,
    session_id: String,
    execution_id: String,
    mode: ChatTurnMode,
) {
    tauri::async_runtime::spawn(async move {
        let work = AssertUnwindSafe(async {
            let Some(exec) = wait_terminal(&state, &execution_id).await else {
                return;
            };
            if let Err(e) = finish(&state.db, &persona_id, &session_id, &exec, mode) {
                tracing::warn!(
                    execution_id = %execution_id,
                    error = %e,
                    "chat turn: the reply could not be saved"
                );
            }
        })
        .catch_unwind()
        .await;
        if let Err(panic) = work {
            tracing::error!(
                execution_id = %execution_id,
                panic = %crate::utils::extract_panic_message(panic),
                "chat turn: completion hook panicked"
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The shared fixture: what the TypeScript builder produced (a vitest
    /// test re-derives every case with a verbatim copy of it).
    const FIXTURE: &str = include_str!("../../../../fixtures/chat-turn-input-v1.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).expect("fixture json")
    }

    fn lines(v: &Value) -> Vec<(String, String)> {
        v.as_array()
            .expect("transcript array")
            .iter()
            .map(|m| {
                (
                    m["role"].as_str().expect("role").to_string(),
                    m["content"].as_str().expect("content").to_string(),
                )
            })
            .collect()
    }

    #[test]
    fn the_input_json_matches_the_typescript_builder_for_every_session_state() {
        let fx = fixture();
        let cases = fx["inputs"].as_array().expect("inputs");
        assert!(cases.len() >= 8, "the fixture covers the session states");
        for case in cases {
            let name = case["name"].as_str().expect("name");
            let owned = lines(&case["transcript"]);
            let transcript: Vec<Line<'_>> = owned
                .iter()
                .map(|(r, c)| Line {
                    role: r,
                    content: c,
                })
                .collect();
            let built = build_turn_input(
                ChatTurnMode::from_ui(case["chatMode"].as_str().expect("mode")),
                case["isFirstMessage"].as_bool().expect("isFirstMessage"),
                case["claudeSessionId"].as_str(),
                &transcript,
                case["message"].as_str().expect("message"),
            )
            .expect("build");
            assert_eq!(
                built.input,
                case["expected"]["input"].as_str().expect("expected input"),
                "{name}: input JSON"
            );
            let continuation = built
                .continuation
                .map(|c| serde_json::to_value(c).expect("continuation"))
                .unwrap_or(Value::Null);
            assert_eq!(
                continuation, case["expected"]["continuation"],
                "{name}: continuation"
            );
        }
    }

    #[test]
    fn titles_and_summaries_match_the_typescript_helpers() {
        let fx = fixture();
        for case in fx["titles"].as_array().expect("titles") {
            assert_eq!(
                derive_title(case["content"].as_str().expect("content")),
                case["expected"].as_str().expect("expected"),
                "title of {:?}",
                case["content"]
            );
        }
        for case in fx["summaries"].as_array().expect("summaries") {
            let owned = lines(&case["messages"]);
            let msgs: Vec<Line<'_>> = owned
                .iter()
                .map(|(r, c)| Line {
                    role: r,
                    content: c,
                })
                .collect();
            assert_eq!(
                build_summary(&msgs),
                case["expected"].as_str().expect("expected"),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn a_title_reports_when_it_was_cut() {
        assert_eq!(shorten_title("short"), ("short".to_string(), false));
        let (cut, was_cut) = shorten_title(&"z".repeat(61));
        assert!(was_cut);
        assert_eq!(cut, "z".repeat(57) + "...");
    }

    #[test]
    fn the_reply_filter_matches_classify_line() {
        let fx = fixture();
        for case in fx["lines"].as_array().expect("lines") {
            let line = case["line"].as_str().expect("line");
            assert_eq!(
                is_text_line(line),
                case["isText"].as_bool().expect("isText"),
                "{line:?}"
            );
        }
    }

    #[test]
    fn modes_map_as_the_slice_mapped_them() {
        assert_eq!(ChatTurnMode::from_ui("advisory"), ChatTurnMode::Advisory);
        assert_eq!(ChatTurnMode::from_ui("agent"), ChatTurnMode::Agent);
        assert_eq!(ChatTurnMode::from_stored("agent"), ChatTurnMode::Agent);
        assert_eq!(ChatTurnMode::from_stored("ops"), ChatTurnMode::Advisory);
        assert_eq!(resolve_mode(None, None), ChatTurnMode::Agent);
        assert_eq!(resolve_mode(None, Some("advisory")), ChatTurnMode::Advisory);
        assert_eq!(
            resolve_mode(Some(ChatTurnMode::Advisory), Some("agent")),
            ChatTurnMode::Advisory
        );
    }

    #[test]
    fn the_reply_is_the_assistant_text_without_run_noise() {
        assert_eq!(
            assemble_reply(Some(
                "Here is the plan.\n> Using tool: Read\n\nStep one.\n[WARN] slow\n"
            )),
            "Here is the plan.\n\nStep one."
        );
        assert_eq!(assemble_reply(None), "");
        assert_eq!(assemble_reply(Some("[ERROR] boom\n")), "");
    }

    fn seed_persona(pool: &DbPool) -> String {
        crate::db::repos::core::personas::create(
            pool,
            crate::db::models::CreatePersonaInput {
                name: "Chat target".to_string(),
                system_prompt: "You are a chat test persona.".to_string(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .expect("persona")
        .id
    }

    fn execution(pool: &DbPool, persona: &str, status: &str, output: &str) -> PersonaExecution {
        let exec =
            crate::db::repos::execution::executions::create(pool, persona, None, None, None, None)
                .expect("execution");
        let state: crate::engine::types::ExecutionState = status.parse().expect("state");
        if status != "queued" {
            crate::db::repos::execution::executions::update_status(
                pool,
                &exec.id,
                crate::db::models::UpdateExecutionStatus {
                    status: crate::engine::types::ExecutionState::Running,
                    ..Default::default()
                },
            )
            .expect("running");
            crate::db::repos::execution::executions::update_status(
                pool,
                &exec.id,
                crate::db::models::UpdateExecutionStatus {
                    status: state,
                    output_data: Some(output.to_string()),
                    claude_session_id: Some("claude-sess-1".into()),
                    ..Default::default()
                },
            )
            .expect("terminal");
        }
        crate::db::repos::execution::executions::get_by_id(pool, &exec.id).expect("read")
    }

    #[test]
    fn a_first_turn_sends_the_transcript_and_a_follow_up_resumes() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool);
        let first = prepare(
            &pool,
            &persona,
            &ChatTurnRequest {
                session_id: None,
                message: "What did you do today?".into(),
                mode: Some(ChatTurnMode::Agent),
            },
        )
        .expect("first");
        assert!(
            first.session_id.starts_with("chat-"),
            "{}",
            first.session_id
        );
        assert_eq!(
            first.input.input,
            r#"{"_chat":true,"conversation":"Human: What did you do today?","latest_message":"What did you do today?"}"#
        );
        assert!(first.input.continuation.is_none());
        let ctx = repo::get_session_context(&pool, &first.session_id)
            .expect("ctx")
            .expect("saved");
        assert_eq!(ctx.title.as_deref(), Some("What did you do today?"));
        assert_eq!(ctx.chat_mode, "agent");

        // The run completes: the reply lands and the Claude session is kept.
        let exec = execution(&pool, &persona, "completed", "I triaged the inbox.\n");
        let reply = finish(&pool, &persona, &first.session_id, &exec, first.mode)
            .expect("finish")
            .expect("a reply");
        assert_eq!(reply.content, "I triaged the inbox.");
        assert_eq!(reply.execution_id.as_deref(), Some(exec.id.as_str()));
        // A second hook for the same run writes nothing.
        assert!(
            finish(&pool, &persona, &first.session_id, &exec, first.mode)
                .expect("again")
                .is_none()
        );

        let follow = prepare(
            &pool,
            &persona,
            &ChatTurnRequest {
                session_id: Some(first.session_id.clone()),
                message: "And tomorrow?".into(),
                mode: None,
            },
        )
        .expect("follow-up");
        assert_eq!(follow.mode, ChatTurnMode::Agent, "the stored mode survives");
        assert_eq!(
            follow.input.input,
            r#"{"_chat":true,"latest_message":"And tomorrow?"}"#
        );
        assert!(matches!(
            follow.input.continuation,
            Some(Continuation::SessionResume(ref s)) if s == "claude-sess-1"
        ));
        let ctx = repo::get_session_context(&pool, &first.session_id)
            .expect("ctx")
            .expect("saved");
        assert_eq!(
            ctx.title.as_deref(),
            Some("What did you do today?"),
            "only the first message names the session"
        );
    }

    /// The feedback (background) chat's first turn, through the production
    /// `prepare_with`: the same input JSON and session title the old
    /// TypeScript builder in `backgroundChatSlice.ts` produced
    /// (`fixtures/chat-turn-feedback-input-v1.json`, re-derived by vitest
    /// with a verbatim copy of that builder).
    #[test]
    fn the_feedback_chat_turn_matches_the_typescript_builder() {
        let fx: Value = serde_json::from_str(include_str!(
            "../../../../fixtures/chat-turn-feedback-input-v1.json"
        ))
        .expect("fixture json");
        let cases = fx["cases"].as_array().expect("cases");
        assert!(
            cases.len() >= 5,
            "the fixture covers the title and escaping cases"
        );
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool);
        for (i, case) in cases.iter().enumerate() {
            let name = case["name"].as_str().expect("name");
            let session_id = format!("bgchat-1700000000000-{i:08x}");
            let turn = prepare_with(
                &pool,
                &persona,
                &ChatTurnRequest {
                    session_id: Some(session_id.clone()),
                    message: case["instruction"].as_str().expect("instruction").into(),
                    mode: Some(ChatTurnMode::from_ui("advisory")),
                },
                &ChatTurnOptions {
                    title: Some(case["title"].as_str().expect("title").into()),
                },
            )
            .expect(name);
            assert_eq!(
                turn.input.input,
                case["expected"]["input"].as_str().expect("expected input"),
                "{name}: input JSON"
            );
            assert!(turn.input.continuation.is_none(), "{name}: no continuation");
            let ctx = repo::get_session_context(&pool, &session_id)
                .expect("ctx")
                .expect("saved");
            assert_eq!(
                ctx.title.as_deref(),
                case["expected"]["title"].as_str(),
                "{name}: title"
            );
            assert_eq!(
                ctx.chat_mode,
                case["expected"]["chatMode"].as_str().expect("mode"),
                "{name}: mode"
            );
        }
    }

    #[test]
    fn a_run_that_did_not_complete_writes_no_reply() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool);
        let turn = prepare(
            &pool,
            &persona,
            &ChatTurnRequest {
                session_id: None,
                message: "hi".into(),
                mode: Some(ChatTurnMode::Advisory),
            },
        )
        .expect("turn");
        for status in ["failed", "cancelled", "incomplete"] {
            let exec = execution(&pool, &persona, status, "partial answer\n");
            assert!(finish(&pool, &persona, &turn.session_id, &exec, turn.mode)
                .expect("finish")
                .is_none());
        }
        let msgs =
            repo::get_session_messages(&pool, &persona, &turn.session_id, None).expect("messages");
        assert_eq!(msgs.len(), 1, "only the user's message");
        let ctx = repo::get_session_context(&pool, &turn.session_id)
            .expect("ctx")
            .expect("saved");
        assert_eq!(ctx.claude_session_id, None, "nothing to resume");
    }
}
