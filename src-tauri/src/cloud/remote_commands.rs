//! Remote commands from the web dashboard, for THIS device.
//!
//! The web inserts a `pending_commands` row; this module polls the rows
//! targeted at this device and resolves every one of them - `completed`,
//! `failed`, `rejected` or `expired`, never silence. Execution is always
//! **local**, through the same paths the desktop UI uses: credentials and
//! execution never leave the device, and the effect syncs back up through the
//! Phase-1a writer.
//!
//! ## Who may act without a click here (owner decisions D1 / M9 / M17, 2026-10-06)
//!
//! Until 2026-10-06 this module NEVER auto-executed: every request waited for
//! the operator's Approve. That rule is replaced, on purpose, by device-level
//! trust. These six rules are the whole policy:
//!
//! 1. **A paired phone's command runs with no desktop prompt** - if, and only
//!    if, `cloud::trust::check` returns `Paired`: the row names a controller in
//!    this desktop's `cloud_controllers` list; that controller is not revoked;
//!    its Ed25519 signature verifies over the exact stored envelope text; the
//!    envelope's `id`, target device, verb, persona and controller agree with
//!    the row and with this desktop; and the envelope is inside its window
//!    (`exp` not passed, `iat` at most 5 min old, +-30 s for this clock). The
//!    command executed is the one parsed FROM the signed envelope, never from
//!    the row's columns.
//! 2. **The auto-run set is closed**: `run_persona`, `pause_persona`,
//!    `resume_persona`, `cancel_execution` and `chat_send` ([`auto_verb`]).
//!    Two of them spend money on the user's plan with no desktop prompt and no
//!    daily cap (M17): `run_persona`, and `chat_send`, which starts one chat
//!    turn - with Athena (`persona_id = 'athena'`, `cloud::athena_send`) or
//!    with a persona (its id, `cloud::persona_chat_send`: one persona
//!    execution, through the same Rust turn the desktop chat uses). A
//!    persona `chat_send` is refused `persona_paused` while that persona is
//!    paused. `chat_send` runs only while the operator has "Sync chats" on,
//!    because its reply reaches the phone as synced data. The trust boundary
//!    is the phone's non-extractable key plus revocation from this desk.
//! 3. **Everything else still needs the operator's click.** An unsigned
//!    `run_persona` (an older web build, or a browser that was never paired)
//!    surfaces the approval card exactly as before. The queue verbs
//!    ([`QUEUE_VERBS`]) stay approval-gated even when signed. An unsigned v1
//!    verb is refused `controller_not_paired`, and a signed command that fails
//!    a check is refused with its reason (`controller_not_paired`,
//!    `controller_revoked`, `bad_signature`, `envelope_mismatch`).
//! 4. **Nothing is queued (D4 / M12).** A row past its `expires_at` - or, for
//!    a row without one, older than one hour - is marked `expired` and never
//!    executed, paired or not. So is a signed envelope outside its window.
//! 5. **One claim, one dispatch.** The approval path and the auto path share
//!    [`claim_and_execute`]: a compare-and-set `pending -> executing` scoped to
//!    this device (exactly one caller wins), then one `match` on the verb. A
//!    queue verb refuses to dispatch under any authority but the operator's
//!    approval, so no auto path can reach it. The claim alone does not stop a
//!    replay - the user's JWT can set a finished row back to `pending` - so a
//!    paired command runs at most once per envelope here, and a signed row
//!    that returns after its claim is refused `replayed`.
//! 6. **Revocation is decided here.** Revoke (or Revoke all) in Settings takes
//!    effect at the next poll - every 5 s while a phone is paired. A web-side
//!    "Unpair this phone" is honoured before any signed command of the same
//!    poll. A command already claimed finishes.
//!
//! What a paired phone can NOT do: edit a persona, read or touch credentials,
//! chat with a paused persona, use a queue verb without a click here, or send
//! any verb outside rule 2.
//!
//! ## Queue verbs
//!
//! The web can also *ask* to act on the fleet dispatch queue it reads out of
//! `synced_fleet_queue`. Those asks are the same shape and ride the same lane:
//! a `pending_commands` row whose `command_type` is one of [`QUEUE_VERBS`],
//! polled here, surfaced to the operator, and executed only on approval
//! through the fleet's own already-validated commands. Three rules hold:
//!
//! 1. **Through the gate, not around it.** A queue verb is a REQUEST. There is
//!    no second path that executes one directly and no auto-approval - not for
//!    `queue_cancel`, which looks harmless and is not (cancelling the head of
//!    a night shift's queue is a real act). Device-level trust (above) does
//!    not extend to them.
//! 2. **The grant is scoped, never total.** Exactly three verbs, each naming
//!    one row (or, for a reorder, an explicit list of rows that already exist
//!    in the queue). **Dispatching NEW work from the web is deliberately NOT
//!    here.** Reordering, lane-assigning and cancelling act on work the
//!    operator already admitted; dispatch mints work, chooses a `cwd` and
//!    spends money, and that is a different and much larger grant that needs
//!    its own design (an allowlist of roots at minimum). `run_persona`
//!    predates this module's rules and is the one creating verb; it is not a
//!    precedent for widening the queue lane.
//! 3. **Ungated is not unrecorded.** Every resolution writes back to the row -
//!    `completed`, `failed`, `rejected` or `expired` - including a refusal of
//!    a verb this build does not understand.
//!
//! ### A verb names a SESSION ID, never a rank
//!
//! The half-second problem decides this and there is only one defensible
//! answer. A rank is a *position in a list that renumbers on every mutation*:
//! a reorder, a promotion, a cancel, a lane assignment and a band claim each
//! densely renumber the whole queue. Between the web client reading rank 4 and
//! the operator approving the request - a window bounded only by the one-hour
//! expiry - rank 4 can be a different session, and the approval prompt would
//! be telling the operator the truth about a row that no longer exists at that
//! position. A session id is the row's stable identity; it is what every
//! surface in the app already holds, and if the row has left the queue by
//! approval time the fleet's own commands refuse it by id with a real error
//! instead of acting on an innocent neighbour. This is settled; do not
//! re-open it.

use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use personas_macros::requires;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::cloud::athena_send;
use crate::cloud::persona_chat_send;
use crate::cloud::sync::client::SyncClient;
use crate::cloud::sync::cursor;
use crate::cloud::trust::{self, Controller, Trust, Verified};
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

/// Commands already surfaced to the UI this session, so the poll doesn't
/// re-emit the same prompt every tick.
static SURFACED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// The poll loop's own memory, owned by the loop (not process-global): what
/// drives the adaptive cadence and the revocation-check cadence. Losing it on a
/// restart costs one slow tick and one extra revocation check, nothing more.
#[derive(Debug, Default)]
struct PollMemory {
    /// When the poll last saw any pending command for this device.
    last_command_seen: Option<Instant>,
    /// When the poll last asked the cloud for web-side revocation requests.
    last_revocation_check: Option<Instant>,
}

impl PollMemory {
    /// Whether this poll must ask the cloud for web-side revocations first.
    fn revocation_check_due(&mut self, has_signed: bool) -> bool {
        let due = has_signed
            || self
                .last_revocation_check
                .map_or(true, |t| t.elapsed() >= REVOCATION_CHECK_EVERY);
        if due {
            self.last_revocation_check = Some(Instant::now());
        }
        due
    }
}

/// Rows without an `expires_at` (older web builds) expire after this, so a
/// stale prompt can't pop days later.
fn expiry_window() -> chrono::Duration {
    chrono::Duration::hours(1)
}

/// `error_message` of a row this desktop expired (PHASE2-SPEC 2.3).
const EXPIRED_MESSAGE: &str = "expired: desktop did not pick it up";

/// Poll cadence while a phone is paired, or for [`RECENT_COMMAND_WINDOW`]
/// after any command was seen.
const FAST_POLL: Duration = Duration::from_secs(5);
/// Poll cadence otherwise (today's 15 s).
const SLOW_POLL: Duration = Duration::from_secs(15);
const RECENT_COMMAND_WINDOW: Duration = Duration::from_secs(120);
/// How often a poll with no signed command still checks for web-side
/// revocation requests, so the Settings list does not show a phone the web
/// already unpaired.
const REVOCATION_CHECK_EVERY: Duration = Duration::from_secs(60);

/// Raw `pending_commands` row (subset we select).
#[derive(Debug, Clone, Deserialize)]
struct CommandRow {
    id: String,
    persona_id: Option<String>,
    command_type: String,
    prompt: Option<String>,
    status: String,
    requested_at: String,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    controller_id: Option<String>,
    #[serde(default)]
    envelope: Option<String>,
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
}

/// Approval-prompt payload sent to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommand {
    pub id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    pub command_type: String,
    pub prompt: Option<String>,
    pub requested_at: String,
}

/// The closed set of queue verbs this build understands, as they appear in
/// `pending_commands.command_type`. Adding one here is the whole extension
/// point - there is no parallel table and no dynamic registry.
const QUEUE_VERBS: &[&str] = &["queue_reorder", "queue_set_lane", "queue_cancel"];

/// The v1 verbs of the mobile command plane (PHASE2-SPEC 2.2), besides
/// `run_persona`. `chat_send` is served for Athena
/// ([`athena_send::is_supported_target`]) and for any persona
/// (`persona_chat_send`).
const V1_VERBS: &[&str] = &[
    "pause_persona",
    "resume_persona",
    "cancel_execution",
    "chat_send",
];

/// Everything this desktop will act on. Anything else is refused and recorded.
fn is_known_command_type(t: &str) -> bool {
    t == "run_persona" || QUEUE_VERBS.contains(&t) || V1_VERBS.contains(&t)
}

/// Verbs a PAIRED controller runs with no desktop prompt (rule 2, M17).
fn auto_verb(t: &str) -> bool {
    t == "run_persona" || V1_VERBS.contains(&t)
}

/// Verbs the operator may approve from the card: the legacy run request and
/// the queue verbs. A v1 verb is never surfaced for approval - it runs from a
/// paired phone or not at all.
fn is_approvable(t: &str) -> bool {
    t == "run_persona" || QUEUE_VERBS.contains(&t)
}

/// The list query's filter for the approval UI, built from the constants
/// above so the URL cannot drift from [`is_approvable`]. Only unsigned rows:
/// a signed one is judged by the poll, never pre-surfaced on mount.
fn approvable_filter() -> String {
    let mut all = vec!["run_persona"];
    all.extend_from_slice(QUEUE_VERBS);
    format!("command_type=in.({})&controller_id=is.null", all.join(","))
}

/// A queue verb's parameters, carried as JSON in the row's existing `prompt`
/// column.
///
/// `pending_commands` lives in Supabase and this repo holds no migration for
/// it (the remote schema is, as the sync golden path records, nowhere) - so a
/// new column is not a change this package can make safely. `prompt` is
/// already a free-text column the web fills, so the payload rides there and
/// the table shape is untouched. The discriminant stays `command_type`,
/// exactly as the brief requires.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuePayload {
    /// `queue_set_lane` / `queue_cancel`: the one row the verb names.
    #[serde(default)]
    session_id: Option<String>,
    /// `queue_reorder`: the queue's new order, head first.
    #[serde(default)]
    session_ids: Option<Vec<String>>,
    /// `queue_set_lane`: 1-based lane, or `null` to clear. Validated by
    /// `fleet_queue_set_lane`, which owns what a legal lane is.
    #[serde(default)]
    lane: Option<u32>,
}

fn parse_queue_payload(prompt: Option<&str>) -> Result<QueuePayload, AppError> {
    let raw = prompt.unwrap_or_default().trim();
    // The shared vocabulary, not a hand-written sentence: `require_non_empty`
    // is the repo's one emptiness refusal and keeps the field name attached to
    // the failure (`command-input-validation`).
    personas_core::validation::require_non_empty("queue request payload", raw)?;
    serde_json::from_str(raw)
        .map_err(|e| AppError::Validation(format!("Queue request payload is not valid: {e}")))
}

const SELECT: &str = "select=id,persona_id,command_type,prompt,status,requested_at,params,controller_id,envelope,signature,expires_at";

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// D4: a row past its `expires_at` (with this clock's +-30 s tolerance), or a
/// row past the legacy one-hour window on `requested_at`. An unparseable
/// timestamp is NOT expired (fail-safe: a malformed value shouldn't silently
/// drop a real request).
fn row_expired(c: &CommandRow, now: DateTime<Utc>) -> bool {
    let past_exp = c
        .expires_at
        .as_deref()
        .and_then(parse_time)
        .is_some_and(|exp| now > exp + chrono::Duration::seconds(trust::CLOCK_SKEW_SECS));
    let past_window =
        parse_time(&c.requested_at).is_some_and(|t| now.signed_duration_since(t) > expiry_window());
    past_exp || past_window
}

async fn read_token(state: &Arc<AppState>) -> Option<String> {
    let auth = state.auth.read().await;
    auth.access_token
        .as_ref()
        .map(|s| s.expose_secret().to_string())
}

fn persona_name(pool: &DbPool, id: &str) -> Option<String> {
    crate::db::repos::core::personas::get_by_id(pool, id)
        .ok()
        .map(|p| p.name)
}

fn to_remote(c: CommandRow, pool: &DbPool) -> RemoteCommand {
    let persona_id = c.persona_id.unwrap_or_default();
    let name = if persona_id.is_empty() {
        None
    } else {
        persona_name(pool, &persona_id)
    };
    RemoteCommand {
        id: c.id,
        persona_id,
        persona_name: name,
        command_type: c.command_type,
        prompt: c.prompt,
        requested_at: c.requested_at,
    }
}

// ---------------------------------------------------------------------------
// Routing: what happens to one row (pure)
// ---------------------------------------------------------------------------

/// The decision for one pending row. Pure: no I/O, so the whole policy is
/// unit-tested against the shared test vector.
#[derive(Debug, Clone, PartialEq)]
enum Route {
    /// A verb this build does not implement: refuse and record.
    RejectUnknown,
    /// Past its window: mark `expired`, never execute (D4).
    Expire,
    /// Refuse with a [`trust::reason`].
    Reject(&'static str),
    /// Paired + an auto verb: claim and execute with no prompt.
    Auto(Box<Verified>),
    /// Surface the approval card.
    Prompt,
}

fn route(c: &CommandRow, controllers: &[Controller], device: &str, now: DateTime<Utc>) -> Route {
    if !is_known_command_type(&c.command_type) {
        return Route::RejectUnknown;
    }
    if row_expired(c, now) {
        return Route::Expire;
    }
    let row = trust::SignedRow {
        id: &c.id,
        command_type: &c.command_type,
        persona_id: c.persona_id.as_deref(),
        controller_id: c.controller_id.as_deref(),
        envelope: c.envelope.as_deref(),
        signature: c.signature.as_deref(),
    };
    match trust::check(controllers, &row, device, now) {
        Trust::Expired => Route::Expire,
        Trust::Refused(reason) => Route::Reject(reason),
        Trust::Paired(v) if auto_verb(&c.command_type) => Route::Auto(v),
        // A signed queue verb: trusted sender, still the operator's click.
        Trust::Paired(_) => Route::Prompt,
        Trust::Unsigned if is_approvable(&c.command_type) => Route::Prompt,
        Trust::Unsigned => Route::Reject(trust::reason::NOT_PAIRED),
    }
}

// ---------------------------------------------------------------------------
// Claim + dispatch, shared by the approval path and the auto path
// ---------------------------------------------------------------------------

/// The command as it will be executed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Effective {
    pub id: String,
    pub command_type: String,
    pub persona_id: Option<String>,
    pub params: Value,
    pub prompt: Option<String>,
}

impl Effective {
    /// An operator-approved row: the row's columns are what the operator saw.
    fn from_row(c: &CommandRow) -> Self {
        Self {
            id: c.id.clone(),
            command_type: c.command_type.clone(),
            persona_id: c.persona_id.clone(),
            params: c.params.clone().unwrap_or_else(|| json!({})),
            prompt: c.prompt.clone(),
        }
    }

    /// A paired command: everything from the SIGNED envelope.
    fn from_verified(v: &Verified) -> Self {
        let env = &v.envelope;
        Self {
            id: env.id.clone(),
            command_type: env.command_type.clone(),
            persona_id: env.persona.clone(),
            params: env.params.clone(),
            prompt: env
                .params
                .get("prompt")
                .and_then(Value::as_str)
                .map(str::to_string),
        }
    }

    fn require_persona(&self) -> Result<&str, AppError> {
        let persona = self.persona_id.as_deref().unwrap_or_default();
        personas_core::validation::require_non_empty("persona", persona)?;
        Ok(persona)
    }
}

/// Who authorised a dispatch.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Authority {
    /// The operator clicked Approve on this desktop.
    OperatorApproved,
    /// A paired controller's verified signature (rule 1), valid until
    /// `valid_until` ([`trust::Verified::valid_until`]).
    Paired {
        controller_id: String,
        valid_until: DateTime<Utc>,
    },
}

/// Paired commands this process has claimed, each kept until its envelope
/// stops verifying.
///
/// The cloud claim (`status=eq.pending`) cannot stop a replay on its own: the
/// user's JWT may UPDATE `pending_commands.status` (RLS `owner_all`, no
/// transition guard), so anyone holding a web session can set a finished
/// signed row back to `pending`. Inside the envelope's window the signature
/// still verifies and the poll would run it again - a second Athena turn, a
/// pause undone after the phone resumed. The signature binds the command id,
/// so remembering ids until [`trust::Verified::valid_until`] is enough.
/// Process-global because the guarantee has to hold for every paired claim,
/// whoever calls [`claim_and_execute`]. A restart forgets it, which reopens
/// at most the remaining window of envelopes signed before the restart.
static PAIRED_CLAIMS: LazyLock<std::sync::Mutex<HashMap<String, DateTime<Utc>>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Record a won paired claim. `false` when this id was already claimed here
/// inside its window: the command is a replay.
fn first_paired_claim(id: &str, valid_until: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    // A poisoned map is still the right map: the worst a panic elsewhere left
    // behind is an extra entry, which refuses rather than runs.
    let mut claims = PAIRED_CLAIMS.lock().unwrap_or_else(|e| e.into_inner());
    claims.retain(|_, until| *until >= now);
    match claims.entry(id.to_ascii_lowercase()) {
        Entry::Occupied(_) => false,
        Entry::Vacant(slot) => {
            slot.insert(valid_until);
            true
        }
    }
}

/// The queue lane is the operator's alone (queue rule 1): refused under any
/// other authority, at the dispatch itself rather than only at the router.
fn require_operator_for_queue(authority: &Authority) -> Result<(), AppError> {
    match authority {
        Authority::OperatorApproved => Ok(()),
        Authority::Paired { .. } => Err(AppError::Validation(
            "queue verbs require approval on the desktop".into(),
        )),
    }
}

/// What a dispatch produced.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Outcome {
    /// The verb-specific `result` (PHASE2-SPEC 2.2).
    pub result: Value,
    /// `run_persona` only: the execution it started.
    pub execution_id: Option<String>,
    /// Other verbs: the row they acted on.
    pub result_ref: Option<String>,
}

impl Outcome {
    /// The extra columns of the `completed` write.
    fn completion_fields(&self) -> Value {
        match &self.execution_id {
            Some(exec) => json!({ "result": self.result, "execution_id": exec }),
            None => json!({ "result": self.result, "result_ref": self.result_ref }),
        }
    }

    /// The id `remote_command_approve` has always returned.
    fn display_id(&self) -> String {
        self.execution_id
            .clone()
            .or_else(|| self.result_ref.clone())
            .unwrap_or_default()
    }
}

/// The `error_message` a failure writes: a short token for the conditions
/// the web renders (`not_found`, `project_off: <name>`), the message otherwise.
fn failure_message(e: &AppError) -> String {
    match e {
        AppError::NotFound(_) => "not_found".to_string(),
        AppError::Validation(m) => m.clone(),
        other => other.to_string(),
    }
}

/// The terminal states this desktop writes to a command row (PHASE2-SPEC
/// 2.3). `executing` is not here: only the claim writes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Resolution {
    Completed,
    Failed,
    Rejected,
    Expired,
}

impl Resolution {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Resolution::Completed => "completed",
            Resolution::Failed => "failed",
            Resolution::Rejected => "rejected",
            Resolution::Expired => "expired",
        }
    }
}

/// The writes a command's lifecycle makes to its cloud row.
#[async_trait::async_trait]
pub(crate) trait CommandPlane: Send + Sync {
    /// Compare-and-set `pending -> executing`. `true` = this caller won.
    async fn claim(&self, id: &str) -> Result<bool, AppError>;
    /// Terminal write after a claim (`completed` / `failed`, or `rejected`
    /// for a replayed paired command).
    async fn finish(&self, id: &str, status: Resolution, fields: Value);
    /// Terminal write on a row never claimed (`rejected` / `expired`).
    async fn refuse(&self, id: &str, status: Resolution, fields: Value);
    /// Best-effort `last_command_at` on the controller's row.
    async fn stamp_controller(&self, controller_id: &str);
}

/// Executes one claimed command.
#[async_trait::async_trait]
pub(crate) trait VerbExecutor: Send + Sync {
    async fn execute(&self, cmd: &Effective, authority: &Authority) -> Result<Outcome, AppError>;
}

/// The single claim + dispatch (rule 5). Reached from the approval command and
/// from the auto path; there is no third caller.
pub(crate) async fn claim_and_execute(
    plane: &dyn CommandPlane,
    executor: &dyn VerbExecutor,
    cmd: &Effective,
    authority: &Authority,
) -> Result<Outcome, AppError> {
    // Claim the command, don't just announce it.
    //
    // A status read followed by an unfiltered write let two concurrent
    // approvals of one request both pass and both reach the agent - two runs,
    // two bills, one request (reproduced 2026-08-16 before fixing).
    // `status=eq.pending` in the claim's FILTER is what makes it exclusive,
    // and the returned row count tells this caller whether it won. With the
    // auto path that is also what keeps a phone's command from running twice
    // when two polls overlap. Losing is a normal outcome, not an error
    // condition, so it reports the message a late click always got.
    if !plane.claim(&cmd.id).await? {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    // A paired command runs once per envelope, whatever the cloud row says
    // (see `PAIRED_CLAIMS`). Checked after the claim, so a claim that failed
    // or lost never marks a command as run.
    if let Authority::Paired { valid_until, .. } = authority {
        if !first_paired_claim(&cmd.id, *valid_until, Utc::now()) {
            tracing::warn!(id = %cmd.id, "remote command: signed command replayed, refusing");
            plane
                .finish(
                    &cmd.id,
                    Resolution::Rejected,
                    json!({ "error_message": trust::reason::REPLAYED }),
                )
                .await;
            return Err(AppError::Validation(trust::reason::REPLAYED.into()));
        }
    }
    match executor.execute(cmd, authority).await {
        Ok(outcome) => {
            plane
                .finish(&cmd.id, Resolution::Completed, outcome.completion_fields())
                .await;
            Ok(outcome)
        }
        Err(e) => {
            plane
                .finish(
                    &cmd.id,
                    Resolution::Failed,
                    json!({ "error_message": failure_message(&e) }),
                )
                .await;
            Err(e)
        }
    }
}

/// pause / resume: the verbs that need only the database. Shared by the real
/// executor and the tests, so the tests run production code.
///
/// `resume_persona` honours the project switch first (the same rule that
/// disables the desktop's Active/Off toggle), then, on an OFF -> ON change,
/// records the wake exactly as `set_persona_enabled` does.
pub(crate) fn apply_enabled(
    pool: &DbPool,
    persona_id: &str,
    enabled: bool,
) -> Result<Outcome, AppError> {
    if enabled {
        if let Some(project) =
            crate::db::repos::dev::projects::persona_project_disabled(pool, persona_id)?
        {
            return Err(AppError::Validation(format!("project_off: {project}")));
        }
    }
    let changed = crate::db::repos::core::personas::set_enabled(pool, persona_id, enabled)?;
    if changed == Some(true) {
        crate::engine::subscription::request_wake(pool, persona_id);
    }
    Ok(Outcome {
        result: json!({ "enabled": enabled, "changed": changed.is_some() }),
        execution_id: None,
        result_ref: Some(persona_id.to_string()),
    })
}

/// Run the database-only verbs; `None` for every other verb.
pub(crate) fn execute_db_verb(pool: &DbPool, cmd: &Effective) -> Option<Result<Outcome, AppError>> {
    let enabled = match cmd.command_type.as_str() {
        "pause_persona" => false,
        "resume_persona" => true,
        _ => return None,
    };
    Some(
        cmd.require_persona()
            .and_then(|pid| apply_enabled(pool, pid, enabled)),
    )
}

/// What `cancel_execution` will do, decided from the database alone.
#[derive(Debug, Clone, PartialEq)]
enum CancelPlan {
    /// Already terminal: completed with `changed:false`, nothing to stop.
    Settled(Outcome),
    /// Still active: cancel it through the engine.
    Cancel {
        execution_id: String,
        was_queued: bool,
    },
}

/// Preconditions of `cancel_execution` (PHASE2-SPEC 2.2): the execution exists
/// and belongs to the named persona - the same owner rule as the Tauri
/// command's `verify_execution_owner`.
fn plan_cancel(pool: &DbPool, cmd: &Effective) -> Result<CancelPlan, AppError> {
    let persona_id = cmd.require_persona()?;
    let execution_id = cmd
        .params
        .get("executionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    personas_core::validation::require_non_empty("executionId", &execution_id)?;
    let exec = crate::db::repos::execution::executions::get_by_id(pool, &execution_id)?;
    // The same owner rule as the `cancel_execution` Tauri command.
    crate::commands::execution::executions::verify_execution_owner(&exec, persona_id)?;
    let was_queued = matches!(exec.status.as_str(), "queued" | "pending");
    if !was_queued && exec.status != "running" {
        return Ok(CancelPlan::Settled(Outcome {
            result: json!({ "executionId": execution_id, "changed": false, "wasQueued": false }),
            execution_id: None,
            result_ref: Some(execution_id),
        }));
    }
    Ok(CancelPlan::Cancel {
        execution_id,
        was_queued,
    })
}

/// The executor the app runs with: the desktop's own command paths.
struct AppExecutor {
    app: AppHandle,
}

/// Payload of `remote-command-applied`: tells the desktop UI that a remote
/// command changed local state (the persona list does not otherwise learn of
/// an `enabled` flip made outside its own toggle).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandApplied {
    pub command_type: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    pub changed: bool,
}

#[async_trait::async_trait]
impl VerbExecutor for AppExecutor {
    async fn execute(&self, cmd: &Effective, authority: &Authority) -> Result<Outcome, AppError> {
        let state = self.app.state::<Arc<AppState>>();
        let outcome = if let Some(done) = execute_db_verb(&state.db, cmd) {
            done?
        } else {
            match cmd.command_type.as_str() {
                "cancel_execution" => match plan_cancel(&state.db, cmd)? {
                    CancelPlan::Settled(o) => o,
                    CancelPlan::Cancel {
                        execution_id,
                        was_queued,
                    } => {
                        let persona_id = cmd.require_persona()?;
                        // The same engine call as the `cancel_execution`
                        // Tauri command: flag, DB write, kill, grace, abort.
                        state
                            .engine
                            .cancel_execution(&execution_id, &state.db, Some(persona_id))
                            .await;
                        Outcome {
                            result: json!({ "executionId": execution_id, "changed": true, "wasQueued": was_queued }),
                            execution_id: None,
                            result_ref: Some(execution_id),
                        }
                    }
                },
                "run_persona" => {
                    let persona_id = cmd.require_persona()?.to_string();
                    // The command id is the idempotency key: a re-delivered
                    // command returns the run it already started.
                    let exec = crate::commands::execution::executions::execute_persona_inner(
                        state.inner(),
                        self.app.clone(),
                        persona_id,
                        None,
                        cmd.prompt.clone(),
                        None,
                        None,
                        Some(cmd.id.clone()),
                        false,
                    )
                    .await?;
                    Outcome {
                        result: json!({ "executionId": exec.id }),
                        execution_id: Some(exec.id),
                        result_ref: None,
                    }
                }
                "chat_send" if athena_send::is_supported_target(cmd.persona_id.as_deref()) => {
                    // Athena: validate, pick or open the thread, start the
                    // turn on Athena's own path.
                    let plan = athena_send::plan(&state.db, &state.user_db, cmd)?;
                    let thread = athena_send::resolve_thread(&state.user_db, &plan)?;
                    let user_message_id =
                        athena_send::start_turn(&self.app, state.inner(), &thread, &plan.message)
                            .await?;
                    athena_send::outcome(&thread, user_message_id)
                }
                "chat_send" => {
                    // A persona: validate, then the desktop's one chat turn,
                    // with the command id as the run's idempotency key.
                    let plan = persona_chat_send::plan(&state.db, cmd)?;
                    let started = crate::commands::core::chat_turn::start(
                        state.inner(),
                        self.app.clone(),
                        &plan.persona_id,
                        plan.request(),
                        cmd.id.clone(),
                    )
                    .await?;
                    persona_chat_send::outcome(&started)
                }
                verb if QUEUE_VERBS.contains(&verb) => {
                    require_operator_for_queue(authority)?;
                    let r = run_queue_verb(&self.app, state.clone(), verb, cmd.prompt.as_deref())
                        .await?;
                    Outcome {
                        result: json!({ "ref": r }),
                        execution_id: None,
                        result_ref: Some(r),
                    }
                }
                // Not a `_ => default`: a name added to a verb list without an
                // arm here fails loudly instead of silently no-opping.
                other => {
                    return Err(AppError::Validation(format!(
                        "unsupported_command_type: `{other}`"
                    )))
                }
            }
        };
        if matches!(
            cmd.command_type.as_str(),
            "pause_persona" | "resume_persona" | "cancel_execution"
        ) {
            if let Some(persona_id) = cmd.persona_id.clone() {
                let applied = RemoteCommandApplied {
                    command_type: cmd.command_type.clone(),
                    persona_name: persona_name(&state.db, &persona_id),
                    persona_id,
                    changed: outcome.result.get("changed").and_then(Value::as_bool) == Some(true),
                };
                // The effect already happened; a lost notice only means the
                // desktop list refreshes on its next fetch. Recorded, not hidden.
                if let Err(e) = self.app.emit(
                    personas_core::events::event_name::REMOTE_COMMAND_APPLIED,
                    applied,
                ) {
                    tracing::warn!(error = %e, "remote command: applied notice not delivered");
                }
            }
        }
        Ok(outcome)
    }
}

/// The cloud row writes, scoped to THIS device on every term.
struct CloudPlane<'a> {
    client: &'a SyncClient,
    device: String,
}

#[async_trait::async_trait]
impl CommandPlane for CloudPlane<'_> {
    async fn claim(&self, id: &str) -> Result<bool, AppError> {
        // `target_device_id` keeps device A from claiming a command targeted
        // at device B; `status=eq.pending` makes the claim exclusive. They
        // guard different things and both are required (2026-08-16).
        let n = self
            .client
            .patch_returning_count(
                &format!(
                    "pending_commands?id=eq.{id}&target_device_id=eq.{}&status=eq.pending",
                    self.device
                ),
                &json!({ "status": "executing", "updated_at": now() }),
            )
            .await?;
        Ok(n > 0)
    }

    async fn finish(&self, id: &str, status: Resolution, fields: Value) {
        self.write(id, true, status, fields).await;
    }

    async fn refuse(&self, id: &str, status: Resolution, fields: Value) {
        // `status=eq.pending` also stops a refusal from overwriting a command
        // the operator resolved while the poll was in flight.
        self.write(id, false, status, fields).await;
    }

    async fn stamp_controller(&self, controller_id: &str) {
        trust::stamp_last_command(self.client, controller_id).await;
    }
}

impl CloudPlane<'_> {
    /// One terminal write, filtered on the state it must still be in:
    /// `executing` after a claim, `pending` for a refusal.
    async fn write(&self, id: &str, claimed: bool, status: Resolution, fields: Value) {
        let from = if claimed { "executing" } else { "pending" };
        let status = status.as_str();
        let mut body = json!({ "status": status, "resolved_at": now(), "updated_at": now() });
        if let (Some(obj), Some(extra)) = (body.as_object_mut(), fields.as_object()) {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
        if let Err(e) = self
            .client
            .patch(
                &format!(
                    "pending_commands?id=eq.{id}&target_device_id=eq.{}&status=eq.{from}",
                    self.device
                ),
                &body,
            )
            .await
        {
            tracing::warn!(error = %e, id, status, "remote command: resolution write failed");
        }
    }
}

/// What the poll does with one row after routing.
#[derive(Debug)]
enum RowOutcome {
    /// Surface the approval card.
    Prompt(Box<CommandRow>),
    /// Resolved (or dispatched) here.
    Handled,
}

/// Route one row and act on the route. Everything but the approval card
/// happens here.
async fn process_row(
    plane: &dyn CommandPlane,
    executor: &dyn VerbExecutor,
    controllers: &[Controller],
    device: &str,
    now: DateTime<Utc>,
    c: CommandRow,
) -> RowOutcome {
    match route(&c, controllers, device, now) {
        Route::RejectUnknown => {
            // An unknown command_type is REFUSED AND RECORDED, never ignored
            // and never defaulted: the web must be able to tell "this desktop
            // will not do that" from "nobody is home".
            tracing::warn!(command_type = %c.command_type, id = %c.id, "remote command: unsupported verb, refusing");
            plane
                .refuse(
                    &c.id,
                    Resolution::Rejected,
                    json!({ "error_message": format!(
                        "unsupported_command_type: this desktop does not implement `{}`",
                        c.command_type
                    ) }),
                )
                .await;
        }
        Route::Expire => {
            plane
                .refuse(
                    &c.id,
                    Resolution::Expired,
                    json!({ "error_message": EXPIRED_MESSAGE }),
                )
                .await;
        }
        Route::Reject(reason) => {
            tracing::info!(id = %c.id, reason, "remote command: refused");
            plane
                .refuse(
                    &c.id,
                    Resolution::Rejected,
                    json!({ "error_message": reason }),
                )
                .await;
        }
        Route::Auto(verified) => {
            let cmd = Effective::from_verified(&verified);
            let authority = Authority::Paired {
                controller_id: verified.controller_id.clone(),
                valid_until: verified.valid_until,
            };
            plane.stamp_controller(&verified.controller_id).await;
            if let Err(e) = claim_and_execute(plane, executor, &cmd, &authority).await {
                tracing::info!(id = %cmd.id, error = %e, "remote command: paired command did not complete");
            }
        }
        Route::Prompt => return RowOutcome::Prompt(Box::new(c)),
    }
    RowOutcome::Handled
}

/// One poll pass: resolve or surface every pending command for this device.
async fn poll_once(
    app: &AppHandle,
    state: &Arc<AppState>,
    memory: &mut PollMemory,
) -> Result<(), AppError> {
    let jwt = match read_token(state).await {
        Some(t) => t,
        None => return Ok(()),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);

    let path = format!(
        "pending_commands?status=eq.pending&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;

    // Web-side unpair requests are honoured BEFORE any signed command of this
    // poll is judged. If that check cannot run, signed rows wait for the next
    // poll (they stay `pending` until their window closes) - fail closed.
    let has_signed = cmds.iter().any(|c| c.controller_id.is_some());
    let mut revocations_known = true;
    if trust::any_active(&pool) && memory.revocation_check_due(has_signed) {
        if let Err(e) = trust::honour_web_revocations(&pool, &client).await {
            tracing::warn!(error = %e, "remote command: revocation check failed; signed commands wait");
            revocations_known = false;
        }
    }
    if cmds.is_empty() {
        return Ok(());
    }
    memory.last_command_seen = Some(Instant::now());

    let controllers = trust::load_controllers(&pool);
    let plane = CloudPlane {
        client: &client,
        device: device.clone(),
    };
    let executor = AppExecutor { app: app.clone() };
    let mut prompts = Vec::new();
    for c in cmds {
        if c.controller_id.is_some() && !revocations_known {
            continue;
        }
        if let RowOutcome::Prompt(row) =
            process_row(&plane, &executor, &controllers, &device, Utc::now(), c).await
        {
            prompts.push(*row);
        }
    }

    let mut surfaced = SURFACED.lock().await;
    for c in prompts {
        if surfaced.insert(c.id.clone()) {
            let _ = app.emit("remote-command-pending", to_remote(c, &pool));
        }
    }
    Ok(())
}

/// The adaptive cadence (PHASE2-SPEC 2.5): 5 s while a phone is paired or
/// within 2 min of a command, 15 s otherwise.
fn poll_interval(paired_active: bool, last_seen: Option<Instant>, now: Instant) -> Duration {
    let recent =
        last_seen.is_some_and(|t| now.saturating_duration_since(t) < RECENT_COMMAND_WINDOW);
    if paired_active || recent {
        FAST_POLL
    } else {
        SLOW_POLL
    }
}

/// Spawn the poll loop. Leader-gated + sync-enabled-gated, so it only runs
/// on one instance and only when the user has opted into cloud sync. It ticks
/// at the fast cadence and skips ticks while the slow cadence applies.
pub fn spawn_poll_loop(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        let mut ticker = tokio::time::interval(FAST_POLL);
        let mut last_poll: Option<Instant> = None;
        let mut memory = PollMemory::default();
        loop {
            ticker.tick().await;
            if !state.leadership.is_leader() || !cursor::is_enabled(&state.db) {
                continue;
            }
            let due = poll_interval(
                trust::any_active(&state.db),
                memory.last_command_seen,
                Instant::now(),
            );
            // Half a second of slack so tick jitter cannot turn 5 s into 10 s.
            if last_poll.is_some_and(|t| t.elapsed() + Duration::from_millis(500) < due) {
                continue;
            }
            last_poll = Some(Instant::now());
            if let Err(e) = poll_once(&app, &state, &mut memory).await {
                tracing::warn!(error = %e, "remote-command poll failed");
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List the unsigned requests awaiting the operator's approval on this device
/// (for the approval UI to render on mount / refresh). Returns empty when not
/// signed in.
#[tauri::command]
#[requires(privileged)]
pub async fn remote_command_list_pending(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RemoteCommand>, AppError> {
    let jwt = match read_token(&state).await {
        Some(t) => t,
        None => return Ok(vec![]),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);
    let types = approvable_filter();
    let path = format!(
        "pending_commands?status=eq.pending&{types}&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;
    let now = Utc::now();
    Ok(cmds
        .into_iter()
        .filter(|c| !row_expired(c, now))
        .map(|c| to_remote(c, &pool))
        .collect())
}

/// Validate that a remote-command `id` is a canonical UUID before it is
/// interpolated into a PostgREST query path. PostgREST treats `&`, `=`, and
/// `eq.` as structured query syntax, so an unvalidated `id` (e.g.
/// `x&status=eq.pending`) would let a caller widen the WHERE clause of a
/// tenant-scoped GET/PATCH under the user's own JWT — mass-reject, status
/// spoofing, or appending a permissive filter to defeat per-device scoping. A
/// parsed UUID contains only hex + hyphens, so it cannot carry that syntax.
fn validate_command_id(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::Validation("Invalid remote command id".into()))
}

/// Approve a remote request: claim it, execute it locally, and write the
/// result back to the command row. Requires a live Google session.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_approve(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<String, AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;

    // Scope the fetch to THIS device. The id is a listable UUID, not a per-device
    // capability token, and RLS only scopes rows to the tenant — not the device.
    // Without this filter a multi-device user could approve a run targeted at
    // device B and have it execute on device A (wrong sandbox / local creds /
    // working tree). A wrong-device row simply won't return → "not found".
    let device = cursor::resolve_device_id(&state.db);
    let cmds: Vec<CommandRow> = client
        .get(&format!(
            "pending_commands?id=eq.{id}&target_device_id=eq.{device}&{SELECT}"
        ))
        .await?;
    let cmd = cmds
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Validation("Remote command not found".into()))?;
    if cmd.status != "pending" {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    let plane = CloudPlane {
        client: &client,
        device,
    };
    // Refuse an unknown verb BEFORE the claim, so a request this build cannot
    // honour is never moved out of `pending` into `executing` and stranded
    // there. The reject is recorded, not silent.
    if !is_known_command_type(&cmd.command_type) {
        plane
            .refuse(
                &id,
                Resolution::Rejected,
                json!({ "error_message": format!(
                    "unsupported_command_type: this desktop does not implement `{}`",
                    cmd.command_type
                ) }),
            )
            .await;
        return Err(AppError::Validation(format!(
            "This desktop does not implement `{}`",
            cmd.command_type
        )));
    }
    // A v1 verb is never approvable: it runs from a paired phone or not at
    // all (rule 3). Nothing is written - the poll records the refusal.
    if !is_approvable(&cmd.command_type) {
        return Err(AppError::Validation(format!(
            "`{}` runs only from a paired phone",
            cmd.command_type
        )));
    }

    // Execute, by verb, through the one claim + dispatch. `run_persona` runs
    // locally through the same path a normal run takes; a queue verb goes
    // through the fleet's own command, which owns its validation (a legal
    // lane, a row that is still queued, the dense re-rank and the
    // `queue-changed` emit). Nothing here reimplements any of that.
    let executor = AppExecutor { app };
    claim_and_execute(
        &plane,
        &executor,
        &Effective::from_row(&cmd),
        &Authority::OperatorApproved,
    )
    .await
    .map(|o| o.display_id())
}

/// Execute one approved queue verb through the fleet's own public commands.
///
/// Every verb names a **session id**, never a rank - see the module doc. Each
/// returns the id (or a short description, for a reorder) that is recorded on
/// the resolved row.
///
/// Reached only from [`claim_and_execute`] under
/// [`Authority::OperatorApproved`], after the compare-and-set claim won.
/// There is no other caller and there must not be one: a second entry point
/// is a second gate to keep honest.
async fn run_queue_verb(
    app: &AppHandle,
    state: State<'_, Arc<AppState>>,
    command_type: &str,
    prompt: Option<&str>,
) -> Result<String, AppError> {
    use crate::commands::fleet::{queue, queue_lanes};

    let payload = parse_queue_payload(prompt)?;
    let one_session = |p: &QueuePayload| -> Result<String, AppError> {
        let id = p.session_id.clone().unwrap_or_default();
        personas_core::validation::require_non_empty("sessionId", &id)?;
        Ok(id)
    };

    match command_type {
        "queue_reorder" => {
            let ids = payload.session_ids.clone().unwrap_or_default();
            if ids.len() < 2 {
                // A reorder of fewer than two rows is not an ordering - it is
                // either an empty payload or a no-op the web should not have
                // sent. Refusing says so rather than silently renumbering.
                return Err(AppError::Validation(
                    "Reorder must name at least two sessions".into(),
                ));
            }
            for id in &ids {
                personas_core::validation::require_non_empty("sessionIds[]", id)?;
            }
            // `fleet_queue_reorder` ignores ids that are not queued rows and
            // keeps unnamed queued rows after the named ones, so a stale list
            // from the web degrades to a partial reorder rather than acting on
            // the wrong rows.
            queue::fleet_queue_reorder(app.clone(), state, ids.clone()).await?;
            Ok(format!("reordered {} entries", ids.len()))
        }
        "queue_set_lane" => {
            let session_id = one_session(&payload)?;
            // An absent `lane` and an explicit `null` both mean "clear it" -
            // the one reading that cannot be mistaken for lane 0, which
            // `fleet_queue_set_lane` refuses outright.
            queue_lanes::fleet_queue_set_lane(app.clone(), state, session_id.clone(), payload.lane)
                .await?;
            Ok(session_id)
        }
        "queue_cancel" => {
            let session_id = one_session(&payload)?;
            queue::fleet_queue_cancel(app.clone(), state, session_id.clone()).await?;
            Ok(session_id)
        }
        // Unreachable in practice (the caller checks `is_known_command_type`
        // first) and still not a `_ => default`: a verb this build does not
        // understand is refused here too, so adding a name to `QUEUE_VERBS`
        // without a match arm fails loudly instead of silently no-opping.
        other => Err(AppError::Validation(format!(
            "unsupported_command_type: `{other}`"
        ))),
    }
}

/// Reject a remote run-request.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_reject(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;

    // Scope by device and by status, exactly as `remote_command_approve` does.
    //
    // Until 2026-08-16 this patched `pending_commands?id=eq.{id}` with neither
    // term. The approve path carries a comment explaining precisely why the
    // device term is required — the id is a listable UUID, not a per-device
    // capability token, and row-level security scopes to the tenant and not
    // to the device — and reject, which resolves the same row, did not carry
    // it. A multi-device user could reject a request targeted at another of
    // their devices.
    //
    // The status term makes the write idempotent: rejecting something already
    // resolved changes nothing rather than overwriting a terminal state.
    let device = cursor::resolve_device_id(&state.db);
    let rejected = client
        .patch_returning_count(
            &format!("pending_commands?id=eq.{id}&target_device_id=eq.{device}&status=eq.pending"),
            &json!({ "status": "rejected", "resolved_at": now(), "updated_at": now() }),
        )
        .await?;
    if rejected == 0 {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreatePersonaInput;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::Mutex as StdMutex;

    fn timed_row(requested_at: &str, expires_at: Option<String>) -> CommandRow {
        CommandRow {
            id: "r".into(),
            persona_id: None,
            command_type: "run_persona".into(),
            prompt: None,
            status: "pending".into(),
            requested_at: requested_at.into(),
            params: None,
            controller_id: None,
            envelope: None,
            signature: None,
            expires_at,
        }
    }

    #[test]
    fn expiry_window_classification() {
        let now = Utc::now();
        let old = (now - chrono::Duration::hours(2)).to_rfc3339();
        let recent = (now - chrono::Duration::minutes(5)).to_rfc3339();
        assert!(
            row_expired(&timed_row(&old, None), now),
            "a 2h-old request should be expired"
        );
        assert!(
            !row_expired(&timed_row(&recent, None), now),
            "a 5m-old request should not be expired"
        );
        // Unparseable timestamps must NOT be treated as expired (fail-safe:
        // a malformed requested_at shouldn't silently drop a real request).
        assert!(!row_expired(&timed_row("not-a-timestamp", None), now));
        // D4: expires_at wins, with +-30 s for this clock.
        let exp = |secs: i64| Some((now - chrono::Duration::seconds(secs)).to_rfc3339());
        assert!(!row_expired(&timed_row(&recent, exp(29)), now));
        assert!(row_expired(&timed_row(&recent, exp(31)), now));
    }

    /// The grant is a CLOSED set. This test is the record of what the web may
    /// ask for; widening it is a deliberate act that lands in a diff. Note
    /// what is absent: there is no verb that dispatches new work.
    #[test]
    fn the_queue_grant_is_three_verbs_and_no_dispatch() {
        assert_eq!(
            QUEUE_VERBS,
            &["queue_reorder", "queue_set_lane", "queue_cancel"]
        );
        for creating in [
            "queue_dispatch",
            "fleet_spawn",
            "queue_start_now",
            "run_shell",
        ] {
            assert!(
                !is_known_command_type(creating),
                "`{creating}` is a creating verb and must not be in the grant"
            );
        }
        assert!(is_known_command_type("run_persona"));
    }

    /// The v1 grant (PHASE2-SPEC 2.2 / M17) is a CLOSED set too, and only a
    /// paired controller runs it without a click. Queue verbs are never auto.
    #[test]
    fn v1_verbs_are_known_and_auto_only_when_paired() {
        assert_eq!(
            V1_VERBS,
            &[
                "pause_persona",
                "resume_persona",
                "cancel_execution",
                "chat_send"
            ]
        );
        for v in [
            "run_persona",
            "pause_persona",
            "resume_persona",
            "cancel_execution",
            "chat_send",
        ] {
            assert!(is_known_command_type(v), "{v} must be known");
            assert!(auto_verb(v), "{v} auto-runs for a paired controller");
        }
        for q in QUEUE_VERBS {
            assert!(!auto_verb(q), "{q} must stay approval-gated");
            assert!(is_approvable(q));
        }
        for v in V1_VERBS {
            assert!(!is_approvable(v), "{v} is never surfaced for approval");
        }
        // chat_send is known, but served for Athena only.
        assert!(is_known_command_type("chat_send"));
        assert!(require_operator_for_queue(&Authority::OperatorApproved).is_ok());
        assert!(require_operator_for_queue(&Authority::Paired {
            controller_id: "c".into(),
            valid_until: Utc::now(),
        })
        .is_err());
    }

    /// An unknown type never falls through to a default - neither in the
    /// poll's surface decision nor in the list query's filter.
    #[test]
    fn unknown_command_type_is_not_known_and_not_listed() {
        assert!(!is_known_command_type("queue_teleport"));
        assert!(!is_known_command_type(""));
        let f = approvable_filter();
        assert_eq!(
            f,
            "command_type=in.(run_persona,queue_reorder,queue_set_lane,queue_cancel)&controller_id=is.null"
        );
        assert!(!f.contains("queue_teleport"));
    }

    /// The payload rides the existing `prompt` column as JSON, camelCase on
    /// the wire. Missing, blank and malformed all refuse rather than
    /// defaulting to an empty act.
    #[test]
    fn queue_payload_parses_the_web_contract() {
        let p = parse_queue_payload(Some(r#"{"sessionIds":["a","b"]}"#)).unwrap();
        assert_eq!(
            p.session_ids.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        let p = parse_queue_payload(Some(r#"{"sessionId":"a","lane":3}"#)).unwrap();
        assert_eq!(p.session_id.as_deref(), Some("a"));
        assert_eq!(p.lane, Some(3));
        // An explicit null lane and an absent lane are the same fact: clear it.
        assert_eq!(
            parse_queue_payload(Some(r#"{"sessionId":"a","lane":null}"#))
                .unwrap()
                .lane,
            None
        );
        assert_eq!(
            parse_queue_payload(Some(r#"{"sessionId":"a"}"#))
                .unwrap()
                .lane,
            None
        );
        assert!(parse_queue_payload(None).is_err());
        assert!(parse_queue_payload(Some("   ")).is_err());
        assert!(parse_queue_payload(Some("not json")).is_err());
        // The emptiness refusal goes through the shared vocabulary, so the
        // field name survives into the message.
        let err = parse_queue_payload(Some("")).unwrap_err().to_string();
        assert!(
            err.contains("queue request payload"),
            "the refusal must name the field: {err}"
        );
    }

    #[test]
    fn poll_cadence_is_fast_while_paired_or_recently_used() {
        let now = Instant::now();
        assert_eq!(poll_interval(false, None, now), SLOW_POLL);
        assert_eq!(poll_interval(true, None, now), FAST_POLL);
        assert_eq!(poll_interval(false, Some(now), now), FAST_POLL);
        let long_ago = now.checked_sub(Duration::from_secs(121));
        if let Some(t) = long_ago {
            assert_eq!(poll_interval(false, Some(t), now), SLOW_POLL);
        }
    }

    // ── the poll's per-row policy, end to end with a fake cloud ─────────

    const DEV: &str = "desk-under-test";
    const CTL: &str = "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4d";

    #[derive(Debug, Clone, PartialEq)]
    enum Write {
        Claim(String),
        Finish(String, String, Value),
        Refuse(String, String, Value),
        Stamp(String),
    }

    #[derive(Default)]
    struct FakePlane {
        writes: StdMutex<Vec<Write>>,
        lose_claims: bool,
        /// Ids already claimed: a second claim of one id loses, exactly as the
        /// cloud's `status=eq.pending` compare-and-set does.
        claimed: StdMutex<HashSet<String>>,
    }

    impl FakePlane {
        fn writes(&self) -> Vec<Write> {
            self.writes.lock().unwrap().clone()
        }

        /// What any holder of the user's JWT can do to a resolved row: set
        /// its `status` back to `pending`, so the next claim wins again.
        fn reopen(&self, id: &str) {
            self.claimed.lock().unwrap().remove(id);
        }
    }

    #[async_trait::async_trait]
    impl CommandPlane for FakePlane {
        async fn claim(&self, id: &str) -> Result<bool, AppError> {
            self.writes.lock().unwrap().push(Write::Claim(id.into()));
            Ok(!self.lose_claims && self.claimed.lock().unwrap().insert(id.to_string()))
        }
        async fn finish(&self, id: &str, status: Resolution, fields: Value) {
            self.writes.lock().unwrap().push(Write::Finish(
                id.into(),
                status.as_str().into(),
                fields,
            ));
        }
        async fn refuse(&self, id: &str, status: Resolution, fields: Value) {
            self.writes.lock().unwrap().push(Write::Refuse(
                id.into(),
                status.as_str().into(),
                fields,
            ));
        }
        async fn stamp_controller(&self, controller_id: &str) {
            self.writes
                .lock()
                .unwrap()
                .push(Write::Stamp(controller_id.into()));
        }
    }

    /// Runs the database verbs through the production [`execute_db_verb`] and
    /// records every dispatch. It also runs `chat_send` through
    /// the production [`athena_send`] plan, thread and outcome; only the turn
    /// itself is simulated (it writes the user turn the real one would). Any
    /// other verb is a test failure.
    struct DbExecutor {
        pool: DbPool,
        user_db: crate::db::UserDbPool,
        calls: StdMutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl VerbExecutor for DbExecutor {
        async fn execute(
            &self,
            cmd: &Effective,
            _authority: &Authority,
        ) -> Result<Outcome, AppError> {
            self.calls.lock().unwrap().push(cmd.command_type.clone());
            if cmd.command_type == "chat_send"
                && !athena_send::is_supported_target(cmd.persona_id.as_deref())
            {
                // A persona: the production plan and the production turn up to
                // the engine (user row, context, input); the run itself is an
                // execution row keyed by the command id, as the engine's
                // idempotent create would write it.
                let plan = persona_chat_send::plan(&self.pool, cmd)?;
                let prepared = crate::commands::core::chat_turn::prepare(
                    &self.pool,
                    &plan.persona_id,
                    &plan.request(),
                )?;
                let (run, _) =
                    crate::db::repos::execution::executions::create_with_idempotency_reporting(
                        &self.pool,
                        &plan.persona_id,
                        None,
                        Some(prepared.input.input.clone()),
                        None,
                        None,
                        Some(cmd.id.clone()),
                        false,
                    )?;
                return Ok(persona_chat_send::outcome(
                    &crate::commands::core::chat_turn::ChatTurnStarted {
                        session_id: prepared.session_id,
                        user_message: prepared.user_message,
                        execution_id: run.id,
                    },
                ));
            }
            if cmd.command_type == "chat_send" {
                let user_db = &self.user_db;
                let plan = athena_send::plan(&self.pool, user_db, cmd)?;
                let thread = athena_send::resolve_thread(user_db, &plan)?;
                let mark = athena_send::node_watermark(user_db)?;
                user_db.get()?.execute(
                    "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, body_excerpt) \
                     VALUES ('ep_phone', 'episode', ?1, 'episodes/2026/10/06/ep_phone_user.md', 'h', ?2)",
                    rusqlite::params![thread, plan.message],
                )?;
                let id = athena_send::newest_user_turn_since(user_db, &thread, mark)?;
                return Ok(athena_send::outcome(&thread, id));
            }
            execute_db_verb(&self.pool, cmd).unwrap_or_else(|| {
                Err(AppError::Validation(format!(
                    "test executor: {}",
                    cmd.command_type
                )))
            })
        }
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(f)
    }

    fn seed_persona(pool: &DbPool) -> String {
        crate::db::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: "Remote target".to_string(),
                system_prompt: "You are a remote-command test persona.".to_string(),
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
        .expect("seed persona")
        .id
    }

    fn enabled(pool: &DbPool, id: &str) -> bool {
        crate::db::repos::core::personas::get_by_id(pool, id)
            .expect("persona")
            .enabled
    }

    struct Phone {
        key: SigningKey,
    }

    impl Phone {
        fn new() -> Self {
            Self {
                key: SigningKey::from_bytes(&[42u8; 32]),
            }
        }

        fn controller(&self) -> Controller {
            Controller {
                controller_id: CTL.into(),
                name: "Test phone".into(),
                public_key: URL_SAFE_NO_PAD.encode(self.key.verifying_key().to_bytes()),
                created_at: "2026-10-06T11:00:00Z".into(),
                revoked: false,
                revoked_at: None,
            }
        }

        /// A row exactly as the web would insert it, signed now (or at `iat`).
        fn row(&self, verb: &str, persona: &str, dev: &str, iat: DateTime<Utc>) -> CommandRow {
            self.row_with(verb, persona, dev, iat, "{}")
        }

        /// [`Self::row`] with `params` (compact JSON text, signed as given).
        fn row_with(
            &self,
            verb: &str,
            persona: &str,
            dev: &str,
            iat: DateTime<Utc>,
            params: &str,
        ) -> CommandRow {
            let id = uuid::Uuid::new_v4().to_string();
            let fmt = |t: DateTime<Utc>| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let exp = iat + chrono::Duration::seconds(60);
            let envelope = format!(
                r#"{{"v":1,"id":"{id}","dev":"{dev}","type":"{verb}","persona":"{persona}","params":{params},"iat":"{}","exp":"{}","ctl":"{CTL}"}}"#,
                fmt(iat),
                fmt(exp)
            );
            let signature = URL_SAFE_NO_PAD.encode(self.key.sign(envelope.as_bytes()).to_bytes());
            CommandRow {
                id,
                persona_id: Some(persona.into()),
                command_type: verb.into(),
                prompt: None,
                status: "pending".into(),
                requested_at: iat.to_rfc3339(),
                params: Some(serde_json::from_str(params).expect("params json")),
                controller_id: Some(CTL.into()),
                envelope: Some(envelope),
                signature: Some(signature),
                expires_at: Some(exp.to_rfc3339()),
            }
        }
    }

    fn harness() -> (DbPool, String, FakePlane, DbExecutor) {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool);
        let exec = DbExecutor {
            pool: pool.clone(),
            user_db: crate::db::init_test_user_db().expect("user db"),
            calls: StdMutex::new(Vec::new()),
        };
        (pool, persona, FakePlane::default(), exec)
    }

    /// The harness with Athena's user DB and "Sync chats" set as given.
    fn chat_harness(chats_on: bool) -> (DbPool, FakePlane, DbExecutor) {
        let pool = crate::db::init_test_db().expect("db");
        crate::db::repos::core::settings::set(
            &pool,
            crate::db::settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if chats_on { "true" } else { "false" },
        )
        .expect("chats setting");
        let user_db = crate::db::init_test_user_db().expect("user db");
        crate::companion::conversation::ensure_system_conversations(&user_db)
            .expect("system threads");
        let exec = DbExecutor {
            pool: pool.clone(),
            user_db,
            calls: StdMutex::new(Vec::new()),
        };
        (pool, FakePlane::default(), exec)
    }

    const ATHENA_HELLO: &str =
        r#"{"sessionId":"default","message":"Hi Athena, what is on today?"}"#;

    #[test]
    fn a_signed_chat_send_to_athena_starts_a_turn_and_completes_with_the_ids() {
        let (_pool, plane, exec) = chat_harness(true);
        let phone = Phone::new();
        let mut row = phone.row_with("chat_send", "athena", DEV, Utc::now(), ATHENA_HELLO);
        // The row's params column is NOT signed: what runs is the envelope's.
        row.params = Some(json!({ "sessionId": "default", "message": "tampered column" }));
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        assert_eq!(
            plane.writes(),
            vec![
                Write::Stamp(CTL.into()),
                Write::Claim(id.clone()),
                Write::Finish(
                    id,
                    "completed".into(),
                    json!({
                        "result": { "sessionId": "default", "userMessageId": "ep_phone" },
                        "result_ref": "default"
                    })
                ),
            ]
        );
        // The message came from the SIGNED envelope's params.
        let body: String = exec
            .user_db
            .get()
            .map_err(AppError::from)
            .and_then(|c| {
                Ok(c.query_row(
                    "SELECT body_excerpt FROM companion_node WHERE id = 'ep_phone'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .expect("the user turn");
        assert_eq!(body, "Hi Athena, what is on today?");
    }

    #[test]
    fn a_chat_send_with_no_thread_opens_a_new_one() {
        let (_pool, plane, exec) = chat_harness(true);
        let phone = Phone::new();
        let row = phone.row_with(
            "chat_send",
            "athena",
            DEV,
            Utc::now(),
            r#"{"sessionId":null,"message":"Start fresh"}"#,
        );
        run(&plane, &exec, &[phone.controller()], row);
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "completed");
        let thread = fields["result"]["sessionId"].as_str().expect("thread id");
        assert!(thread.starts_with("conv_"), "{thread}");
        assert_eq!(fields["result_ref"], json!(thread));
    }

    #[test]
    fn an_unsigned_chat_send_is_rejected_controller_not_paired() {
        let (_pool, plane, exec) = chat_harness(true);
        let mut row = Phone::new().row_with("chat_send", "athena", DEV, Utc::now(), ATHENA_HELLO);
        row.controller_id = None;
        let id = row.id.clone();
        run(&plane, &exec, &[], row);
        assert_eq!(
            plane.writes(),
            vec![Write::Refuse(
                id,
                "rejected".into(),
                json!({ "error_message": "controller_not_paired" })
            )]
        );
        assert!(exec.calls.lock().unwrap().is_empty(), "nothing executed");
    }

    /// The persona harness with "Sync chats" set as given.
    fn persona_chat_harness(chats_on: bool) -> (DbPool, String, FakePlane, DbExecutor) {
        let (pool, persona, plane, exec) = harness();
        crate::db::repos::core::settings::set(
            &pool,
            crate::db::settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if chats_on { "true" } else { "false" },
        )
        .expect("chats setting");
        (pool, persona, plane, exec)
    }

    /// One COUNT(*); the checkout propagates.
    fn count(pool: &DbPool, sql: &str, p: impl rusqlite::Params) -> Result<i64, AppError> {
        Ok(pool.get()?.query_row(sql, p, |r| r.get(0))?)
    }

    const PERSONA_HELLO: &str = r#"{"sessionId":null,"message":"What is on my plate today?"}"#;

    fn session_messages(pool: &DbPool, persona: &str, session: &str) -> Vec<(String, String)> {
        crate::db::repos::communication::chat::get_session_messages(pool, persona, session, None)
            .expect("messages")
            .into_iter()
            .map(|m| (m.role.to_string(), m.content))
            .collect()
    }

    #[test]
    fn a_signed_chat_send_to_a_persona_starts_its_turn_and_completes_with_the_ids() {
        let (pool, persona, plane, exec) = persona_chat_harness(true);
        let phone = Phone::new();
        let mut row = phone.row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO);
        // The row's params column is NOT signed: what runs is the envelope's.
        row.params = Some(json!({ "sessionId": null, "message": "tampered column" }));
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);

        let writes = plane.writes();
        assert_eq!(
            writes[..2],
            [Write::Stamp(CTL.into()), Write::Claim(id.clone())]
        );
        let Some(Write::Finish(fid, status, fields)) = writes.last().cloned() else {
            panic!("finish: {writes:?}")
        };
        assert_eq!((fid.as_str(), status.as_str()), (id.as_str(), "completed"));
        let session = fields["result"]["sessionId"].as_str().expect("session id");
        assert!(session.starts_with("chat-"), "{session}");
        let run_id = fields["result"]["executionId"]
            .as_str()
            .expect("execution id");
        assert_eq!(
            fields["execution_id"],
            json!(run_id),
            "the row names the run"
        );
        assert!(fields["result"]["userMessageId"].is_string());
        // The command id is the run's idempotency key.
        let by_key = crate::db::repos::execution::executions::get_by_idempotency_key(&pool, &id)
            .expect("lookup")
            .expect("the run");
        assert_eq!(by_key.id, run_id);
        // The message came from the SIGNED envelope; a new session runs as the
        // agent itself, with the whole (one-message) transcript.
        assert_eq!(
            session_messages(&pool, &persona, session),
            vec![("user".to_string(), "What is on my plate today?".to_string())]
        );
        assert_eq!(
            by_key.input_data.as_deref(),
            Some(
                r#"{"_chat":true,"conversation":"Human: What is on my plate today?","latest_message":"What is on my plate today?"}"#
            )
        );
    }

    #[test]
    fn an_unsigned_chat_send_to_a_persona_is_rejected_controller_not_paired() {
        let (pool, persona, plane, exec) = persona_chat_harness(true);
        let mut row = Phone::new().row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO);
        row.controller_id = None;
        let id = row.id.clone();
        run(&plane, &exec, &[], row);
        assert_eq!(
            plane.writes(),
            vec![Write::Refuse(
                id,
                "rejected".into(),
                json!({ "error_message": "controller_not_paired" })
            )]
        );
        assert!(exec.calls.lock().unwrap().is_empty(), "nothing executed");
        let n = count(&pool, "SELECT COUNT(*) FROM chat_messages", []).expect("count");
        assert_eq!(n, 0, "no message written");
    }

    #[test]
    fn a_persona_chat_send_while_chats_do_not_sync_fails_chat_sync_off() {
        let (_pool, persona, plane, exec) = persona_chat_harness(false);
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO),
        );
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "failed");
        assert_eq!(fields, json!({ "error_message": "chat_sync_off" }));
    }

    #[test]
    fn a_persona_chat_send_to_a_paused_persona_fails_persona_paused() {
        let (pool, persona, plane, exec) = persona_chat_harness(true);
        crate::db::repos::core::personas::set_enabled(&pool, &persona, false).expect("pause");
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO),
        );
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "failed");
        assert_eq!(fields, json!({ "error_message": "persona_paused" }));
    }

    /// Two polls that both see the same pending row: one claim wins, the turn
    /// runs once, and the second sees "no longer pending".
    #[test]
    fn a_re_claimed_persona_chat_send_runs_once() {
        let (pool, persona, plane, exec) = persona_chat_harness(true);
        let phone = Phone::new();
        let row = phone.row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO);
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row.clone());
        run(&plane, &exec, &[phone.controller()], row);
        assert_eq!(exec.calls.lock().unwrap().len(), 1, "executed once");
        let finishes = plane
            .writes()
            .into_iter()
            .filter(|w| matches!(w, Write::Finish(..)))
            .count();
        assert_eq!(finishes, 1);
        let n = count(
            &pool,
            "SELECT COUNT(*) FROM chat_messages WHERE role = 'user'",
            [],
        )
        .expect("count");
        assert_eq!(n, 1, "one user message");
        let runs = count(
            &pool,
            "SELECT COUNT(*) FROM persona_executions WHERE idempotency_key = ?1",
            rusqlite::params![id],
        )
        .expect("count");
        assert_eq!(runs, 1, "one run");
    }

    /// A follow-up names the session the first send opened; it continues the
    /// stored mode and resumes the Claude session once one is stored.
    #[test]
    fn a_follow_up_chat_send_continues_the_named_session() {
        let (pool, persona, plane, exec) = persona_chat_harness(true);
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row_with("chat_send", &persona, DEV, Utc::now(), PERSONA_HELLO),
        );
        let Some(Write::Finish(_, _, first)) = plane.writes().pop() else {
            panic!("finish")
        };
        let session = first["result"]["sessionId"]
            .as_str()
            .expect("session")
            .to_string();
        crate::db::repos::communication::chat::upsert_session_context(
            &pool,
            crate::db::models::UpsertSessionContextInput {
                session_id: session.clone(),
                persona_id: persona.clone(),
                title: None,
                summary: None,
                system_prompt_hash: None,
                working_memory: None,
                chat_mode: None,
                claude_session_id: Some("claude-sess-9".into()),
            },
        )
        .expect("claude session");
        let params = format!(r#"{{"sessionId":"{session}","message":"And tomorrow?"}}"#);
        let row = phone.row_with("chat_send", &persona, DEV, Utc::now(), &params);
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "completed");
        assert_eq!(fields["result"]["sessionId"], json!(session));
        let follow_run =
            crate::db::repos::execution::executions::get_by_idempotency_key(&pool, &id)
                .expect("lookup")
                .expect("run");
        assert_eq!(
            follow_run.input_data.as_deref(),
            Some(r#"{"_chat":true,"latest_message":"And tomorrow?"}"#)
        );
        // A session of another persona is not this one's.
        let other = seed_persona(&pool);
        let row = phone.row_with("chat_send", &other, DEV, Utc::now(), &params);
        run(&plane, &exec, &[phone.controller()], row);
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "failed");
        assert_eq!(fields, json!({ "error_message": "not_found" }));
    }

    #[test]
    fn a_chat_send_while_chats_do_not_sync_fails_chat_sync_off() {
        let (_pool, plane, exec) = chat_harness(false);
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row_with("chat_send", "athena", DEV, Utc::now(), ATHENA_HELLO),
        );
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "failed");
        assert_eq!(fields, json!({ "error_message": "chat_sync_off" }));
    }

    fn run(
        plane: &FakePlane,
        exec: &DbExecutor,
        ctl: &[Controller],
        row: CommandRow,
    ) -> RowOutcome {
        block_on(process_row(plane, exec, ctl, DEV, Utc::now(), row))
    }

    #[test]
    fn paired_valid_pause_auto_claims_and_completes_changed_true() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let row = phone.row("pause_persona", &persona, DEV, Utc::now());
        let id = row.id.clone();
        assert!(matches!(
            run(&plane, &exec, &[phone.controller()], row),
            RowOutcome::Handled
        ));
        assert_eq!(
            plane.writes(),
            vec![
                Write::Stamp(CTL.into()),
                Write::Claim(id.clone()),
                Write::Finish(
                    id,
                    "completed".into(),
                    json!({ "result": { "enabled": false, "changed": true }, "result_ref": persona.clone() })
                ),
            ]
        );
        assert!(!enabled(&pool, &persona), "the persona is paused locally");
    }

    #[test]
    fn a_repeat_pause_completes_changed_false() {
        let (_pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let ctl = [phone.controller()];
        run(
            &plane,
            &exec,
            &ctl,
            phone.row("pause_persona", &persona, DEV, Utc::now()),
        );
        let again = phone.row("pause_persona", &persona, DEV, Utc::now());
        let id = again.id.clone();
        run(&plane, &exec, &ctl, again);
        let last = plane.writes().pop().expect("a write");
        assert_eq!(
            last,
            Write::Finish(
                id,
                "completed".into(),
                json!({ "result": { "enabled": false, "changed": false }, "result_ref": persona })
            )
        );
    }

    #[test]
    fn resume_after_pause_reports_enabled_true() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let ctl = [phone.controller()];
        run(
            &plane,
            &exec,
            &ctl,
            phone.row("pause_persona", &persona, DEV, Utc::now()),
        );
        run(
            &plane,
            &exec,
            &ctl,
            phone.row("resume_persona", &persona, DEV, Utc::now()),
        );
        assert!(enabled(&pool, &persona));
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "completed");
        assert_eq!(
            fields["result"],
            json!({ "enabled": true, "changed": true })
        );
    }

    #[test]
    fn pause_of_an_unknown_persona_fails_not_found() {
        let (_pool, _persona, plane, exec) = harness();
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row("pause_persona", "no-such-persona", DEV, Utc::now()),
        );
        let Some(Write::Finish(_, status, fields)) = plane.writes().pop() else {
            panic!("finish")
        };
        assert_eq!(status, "failed");
        assert_eq!(fields, json!({ "error_message": "not_found" }));
    }

    fn assert_refused_without_execution(
        plane: &FakePlane,
        exec: &DbExecutor,
        pool: &DbPool,
        persona: &str,
        id: &str,
        status: &str,
        message: &str,
    ) {
        assert_eq!(
            plane.writes(),
            vec![Write::Refuse(
                id.into(),
                status.into(),
                json!({ "error_message": message })
            )]
        );
        assert!(exec.calls.lock().unwrap().is_empty(), "nothing executed");
        assert!(enabled(pool, persona), "the persona was not touched");
    }

    #[test]
    fn unknown_controller_is_rejected_controller_not_paired() {
        let (pool, persona, plane, exec) = harness();
        let row = Phone::new().row("pause_persona", &persona, DEV, Utc::now());
        let id = row.id.clone();
        run(&plane, &exec, &[], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "rejected",
            "controller_not_paired",
        );
    }

    #[test]
    fn revoked_controller_is_rejected_controller_revoked() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let mut c = phone.controller();
        c.revoked = true;
        let row = phone.row("pause_persona", &persona, DEV, Utc::now());
        let id = row.id.clone();
        run(&plane, &exec, &[c], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "rejected",
            "controller_revoked",
        );
    }

    #[test]
    fn tampered_envelope_is_rejected_bad_signature() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let mut row = phone.row("pause_persona", &persona, DEV, Utc::now());
        // One byte of the signed text changes after signing.
        row.envelope = row.envelope.map(|e| e.replacen("\"v\":1", "\"v\":2", 1));
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "rejected",
            "bad_signature",
        );
    }

    #[test]
    fn a_command_signed_for_another_desktop_is_envelope_mismatch() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let row = phone.row("pause_persona", &persona, "some-other-desktop", Utc::now());
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "rejected",
            "envelope_mismatch",
        );
    }

    #[test]
    fn past_exp_is_expired_and_never_executed() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        // Signed 3 minutes ago: exp (iat + 60 s) is long past.
        let row = phone.row(
            "pause_persona",
            &persona,
            DEV,
            Utc::now() - chrono::Duration::minutes(3),
        );
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "expired",
            EXPIRED_MESSAGE,
        );
    }

    #[test]
    fn the_envelope_window_expires_a_row_whose_column_was_cleared() {
        // `expires_at` is a column the web writes and the signature does not
        // cover; the envelope's own `exp` still expires the command.
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let mut row = phone.row(
            "pause_persona",
            &persona,
            DEV,
            Utc::now() - chrono::Duration::minutes(3),
        );
        row.expires_at = None;
        row.requested_at = Utc::now().to_rfc3339();
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "expired",
            EXPIRED_MESSAGE,
        );
    }

    #[test]
    fn unsigned_run_persona_still_surfaces_the_approval_card() {
        let (_pool, persona, plane, exec) = harness();
        let row = CommandRow {
            id: uuid::Uuid::new_v4().to_string(),
            persona_id: Some(persona),
            command_type: "run_persona".into(),
            prompt: Some("hello".into()),
            status: "pending".into(),
            requested_at: Utc::now().to_rfc3339(),
            params: None,
            controller_id: None,
            envelope: None,
            signature: None,
            expires_at: None,
        };
        assert!(matches!(
            run(&plane, &exec, &[], row),
            RowOutcome::Prompt(_)
        ));
        assert!(
            plane.writes().is_empty(),
            "the card decides; nothing is written"
        );
        assert!(exec.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn unsigned_pause_is_rejected_controller_not_paired() {
        let (pool, persona, plane, exec) = harness();
        let mut row = Phone::new().row("pause_persona", &persona, DEV, Utc::now());
        row.controller_id = None;
        let id = row.id.clone();
        run(&plane, &exec, &[], row);
        assert_refused_without_execution(
            &plane,
            &exec,
            &pool,
            &persona,
            &id,
            "rejected",
            "controller_not_paired",
        );
    }

    #[test]
    fn a_signed_queue_verb_from_a_paired_phone_still_needs_the_click() {
        let (_pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let row = phone.row("queue_cancel", &persona, DEV, Utc::now());
        assert!(matches!(
            run(&plane, &exec, &[phone.controller()], row),
            RowOutcome::Prompt(_)
        ));
        assert!(plane.writes().is_empty());
    }

    #[test]
    fn a_lost_claim_executes_nothing() {
        let (pool, persona, _plane, exec) = harness();
        let plane = FakePlane {
            lose_claims: true,
            ..FakePlane::default()
        };
        let phone = Phone::new();
        run(
            &plane,
            &exec,
            &[phone.controller()],
            phone.row("pause_persona", &persona, DEV, Utc::now()),
        );
        assert!(exec.calls.lock().unwrap().is_empty());
        assert!(enabled(&pool, &persona));
        assert!(!plane
            .writes()
            .iter()
            .any(|w| matches!(w, Write::Finish(..))));
    }

    /// A stolen web session sets a finished signed pause back to `pending`
    /// after the phone resumed. The envelope is still inside its window, so
    /// it verifies; the desktop must refuse it from its own memory, or the
    /// persona the phone just resumed is paused again.
    #[test]
    fn a_signed_command_reopened_in_the_cloud_is_refused_replayed() {
        let (pool, persona, plane, exec) = harness();
        let phone = Phone::new();
        let ctl = [phone.controller()];
        let pause = phone.row("pause_persona", &persona, DEV, Utc::now());
        let pause_id = pause.id.clone();
        run(&plane, &exec, &ctl, pause.clone());
        run(
            &plane,
            &exec,
            &ctl,
            phone.row("resume_persona", &persona, DEV, Utc::now()),
        );
        assert!(enabled(&pool, &persona), "the phone resumed it");

        plane.reopen(&pause_id);
        run(&plane, &exec, &ctl, pause);

        assert!(enabled(&pool, &persona), "the replayed pause did not run");
        assert_eq!(
            *exec.calls.lock().unwrap(),
            vec!["pause_persona".to_string(), "resume_persona".to_string()]
        );
        assert_eq!(
            plane.writes().last(),
            Some(&Write::Finish(
                pause_id,
                "rejected".into(),
                json!({ "error_message": "replayed" })
            ))
        );
    }

    /// The spend case: a reopened `chat_send` to Athena does not start a
    /// second turn.
    #[test]
    fn a_reopened_athena_chat_send_starts_one_turn() {
        let (_pool, plane, exec) = chat_harness(true);
        let phone = Phone::new();
        let row = phone.row_with("chat_send", "athena", DEV, Utc::now(), ATHENA_HELLO);
        let id = row.id.clone();
        run(&plane, &exec, &[phone.controller()], row.clone());
        plane.reopen(&id);
        run(&plane, &exec, &[phone.controller()], row);
        assert_eq!(exec.calls.lock().unwrap().len(), 1, "one turn");
    }

    #[test]
    fn cancel_refuses_an_execution_of_another_persona() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool);
        let cmd = Effective {
            id: "c".into(),
            command_type: "cancel_execution".into(),
            persona_id: Some(persona),
            params: json!({}),
            prompt: None,
        };
        // No executionId -> refused before any lookup.
        assert!(plan_cancel(&pool, &cmd).is_err());
        let missing = Effective {
            params: json!({ "executionId": "no-such-execution" }),
            ..cmd
        };
        assert!(matches!(
            plan_cancel(&pool, &missing),
            Err(AppError::NotFound(_))
        ));
    }
}
