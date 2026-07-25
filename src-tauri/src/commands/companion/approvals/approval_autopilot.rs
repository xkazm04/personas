//! `approval_autopilot` — part of the approval module family (split from the
//! former approvals.rs god file, 2026-07-24). Shared imports, status
//! consts and the Tauri-facing types live in `mod.rs`; siblings are
//! reachable through the parent's glob re-exports.

#[allow(unused_imports)]
use super::*;

// ── Goal 3: conservative autoapprove ────────────────────────────────────

/// Action kinds that auto-resolve when autonomous mode is on. Conservative
/// by design — only low-blast-radius, reversible actions land here:
/// memory writes (scoped), background scan jobs, future self-nudges.
/// External writes (`use_connector` writes — Gmail send, Discord post),
/// DB mutations (`execute_mutation`), agent creation (`build_oneshot` /
/// `prefill_persona_create`), team work (`assign_team`) ALWAYS stay
/// gated — autonomous mode does not override the user's click on those.
pub(crate) const AUTOAPPROVE_ALLOWLIST: &[&str] = &[
    "write_fact",
    "write_backlog_item",
    "enqueue_dev_job",
    "schedule_proactive",
    // C2 — Athena posting into a team channel. Low blast radius (an internal
    // message, not an external write or a team dispatch), so it's free under
    // autonomous mode per the team-channel decision; gated otherwise.
    "post_team_message",
    // Deliberate higher-blast-radius exception (opted in via autonomous mode):
    // Athena driving a Fleet session by typing into its terminal. This is the
    // "Ask Athena → she writes directly" loop. Under autonomous mode it only
    // auto-fires for sessions Athena spawned HERSELF — enforced below in
    // `auto_resolve_if_allowed` via the `ATHENA_SESSION_NAME_SENTINEL`
    // visible-name guard, so a hallucinated or stale `session_id` (or a
    // user-owned session that drifted into AwaitingInput) can't make
    // autonomous Athena type `{text}\r` into the user's OWN live terminal.
    // A target that fails the guard is left pending for a deliberate user
    // click instead of auto-firing; writes are also gated by the autonomous-
    // mode toggle in the first place.
    "fleet_send_input",
    // Phase 3b — autonomous stuck-session recovery. `fleet_intervene` types a
    // one-line unblock into a session that's stalled after a failure. Same
    // boldness × class × confidence gate as `fleet_send_input` (below), plus a
    // hard structural backstop the send-input path lacks: the operative-memory
    // cap of ONE intervention per session (`record_intervention`) refuses a
    // second auto-fire on the same session even if the confidence gate misjudges
    // — so a stuck session can be nudged at most once without a human.
    "fleet_intervene",
    // Phase 4 — autonomous session recovery. `fleet_wake` revives a hibernated
    // session; `fleet_resume` adopts an orphaned CLI process. Same boldness ×
    // class × confidence gate as the send-input path, but no screen re-check
    // (the target is asleep/gone, so there's no live prompt to drift). Both fail
    // closed: the underlying command `Err`s on a non-resumable id / missing
    // transcript, so a hallucinated target revives nothing.
    "fleet_wake",
    "fleet_resume",
];

/// If `approval.action` is on the conservative autoapprove allowlist,
/// resolve it immediately (executes the action + transitions status the
/// same way `companion_approve_action` does on a user click). Returns
/// `Ok(true)` when the approval was auto-resolved (success OR failure),
/// `Ok(false)` when it was left pending for the user.
///
/// Caller contract: only call this when autonomous mode is on (the
/// reviewer / autonomous chain already gated on the toggle; this helper
/// does NOT re-check it, so manual flows can't accidentally invoke
/// autoapprove behavior). Best-effort: a DB / executor failure surfaces
/// as an Err and the approval is left in 'running' status; the caller
/// can log + continue. Mirrors `companion_approve_action`'s structure
/// to keep the manual + auto paths in lockstep.
pub async fn auto_resolve_if_allowed(
    app: &tauri::AppHandle,
    approval: &crate::companion::dispatcher::CreatedApproval,
) -> Result<bool, AppError> {
    if !AUTOAPPROVE_ALLOWLIST.contains(&approval.action.as_str()) {
        return Ok(false);
    }
    // Athena-owned PTY guard — RELAXED (user policy, 2026-06-25). Previously a
    // `fleet_send_input` auto-fire was scoped to sessions Athena spawned herself,
    // so on a USER's CLI even a high-confidence answer was left pending. The user
    // explicitly wants autonomous Athena to ACT on their own fleet CLIs ("if
    // confident enough she should act"). Autonomous mode (this whole path only
    // runs under it) is the standing human consent, and the confidence gate below
    // keeps auto-fire to the genuinely-unambiguous; anything less still surfaces
    // as an orb consult. Targeting a dead/hallucinated session can't write
    // anything — `execute_fleet_send_input` fails closed when the PTY writer is
    // gone — so dropping the owner check doesn't widen real blast radius.
    // Cautious confidence gate (user policy "auto vs consult" = Cautious):
    // autonomous Athena only AUTO-fires a fleet_send_input she is highly
    // confident about. Medium / low / absent confidence is left PENDING
    // (`Ok(false)`) so the queued approval surfaces on the orb as a *consult*
    // and the user makes the call. Confidence is self-reported by Athena in the
    // proposal params (`confidence: "high" | "medium" | "low"` — see the
    // orchestration directive in `fleet_bridge::orchestrate_on_awaiting`);
    // anything other than an explicit "high" fails safe toward consulting — so
    // with the owner guard relaxed, confidence is now the sole gate on what
    // auto-fires vs. what surfaces as an orb consult.
    let state = app.state::<Arc<AppState>>();
    // Both the screen-driving fleet actions share the confidence gate: they carry
    // `session_id` / `confidence` / `decision_class` and type into a live PTY, so
    // the boldness dial + execution-time screen re-check apply identically.
    // `fleet_send_input` (answer an AwaitingInput prompt) and `fleet_intervene`
    // (Phase 3b — unblock a stuck session) go through the same bar.
    if matches!(approval.action.as_str(), "fleet_send_input" | "fleet_intervene") {
        // Phase 2: the boldness dial + Athena's `decision_class` + `confidence`
        // together decide auto-fire vs orb consult (was: high-confidence only).
        let boldness = crate::commands::companion::chat::fleet_boldness(&state.db);
        if !fleet_action_auto_fires(&approval.params_json, boldness) {
            tracing::info!(
                approval_id = %approval.id,
                action = %approval.action,
                boldness = boldness.as_str(),
                "autonomous autoapprove deferred: fleet action below the boldness × class × confidence bar — left pending as an orb consult"
            );
            record_fleet_decision(
                &state.db,
                &approval.action,
                &approval.params_json,
                "deferred",
                Some("below_confidence_bar"),
            );
            escalate_fleet_consult(app, &approval.params_json);
            return Ok(false);
        }
        // Phase 2.4 execution-time re-check: `confidence` is uncalibrated and a
        // live CLI screen can move between reasoning and firing. If the session's
        // screen changed since Athena reasoned on it, defer rather than type into
        // a now-different prompt. Runs BEFORE the pending→running transition below,
        // so a deferred row stays a pending consult on the orb.
        if let Some(sid) = serde_json::from_str::<serde_json::Value>(&approval.params_json)
            .ok()
            .as_ref()
            .and_then(|v| v.get("session_id"))
            .and_then(|v| v.as_str())
        {
            if crate::commands::companion::fleet_bridge::screen_matches_last_decision(sid)
                == Some(false)
            {
                // The prompt she reasoned about is GONE — typing her answer
                // into whatever replaced it would be wrong, but parking the
                // proposal as a consult stranded sessions "awaiting input"
                // under autonomous mode. Supersede the stale proposal and
                // reassess the FRESH screen instead: reject this approval,
                // clear the throttle/dedupe, and wake her again right now.
                tracing::info!(
                    approval_id = %approval.id,
                    session_id = %sid,
                    "autonomous autoapprove: screen changed since Athena reasoned — superseding the proposal and reassessing the fresh screen"
                );
                record_fleet_decision(
                    &state.db,
                    &approval.action,
                    &approval.params_json,
                    "deferred",
                    Some("screen_changed"),
                );
                if let Ok(conn) = state.user_db.get() {
                    let _ = conn.execute(
                        "UPDATE companion_approval SET status = ?1 WHERE id = ?2",
                        rusqlite::params![APPROVAL_STATUS_REJECTED, approval.id],
                    );
                }
                crate::commands::companion::fleet_bridge::force_reassess(app, &state, sid);
                return Ok(true);
            }
        }
    } else if matches!(approval.action.as_str(), "fleet_wake" | "fleet_resume") {
        // Recovery actions (Phase 4): same boldness × class × confidence bar, but
        // NO screen re-check — the target is hibernated/orphaned, so there's no
        // live prompt that could have drifted since Athena reasoned on it.
        let boldness = crate::commands::companion::chat::fleet_boldness(&state.db);
        if !fleet_action_auto_fires(&approval.params_json, boldness) {
            tracing::info!(
                approval_id = %approval.id,
                action = %approval.action,
                boldness = boldness.as_str(),
                "autonomous autoapprove deferred: recovery action below the boldness × class × confidence bar — left pending as an orb consult"
            );
            record_fleet_decision(
                &state.db,
                &approval.action,
                &approval.params_json,
                "deferred",
                Some("below_confidence_bar"),
            );
            return Ok(false);
        }
    }
    // Same atomic pending→running transition the manual path uses.
    let (action, params) = load_pending(&state, &approval.id)?;
    // Belt-and-suspenders: re-check the loaded action matches the
    // allowlist. CreatedApproval.action and the persisted payload are
    // written together so this is unreachable in practice; if it ever
    // diverges (manual DB tampering), finalize as approved_failed
    // rather than leaving the row stuck in 'running'.
    if !AUTOAPPROVE_ALLOWLIST.contains(&action.as_str()) {
        finalize_approval(&state, &approval.id, APPROVAL_STATUS_APPROVED_FAILED)?;
        // `Ok(false)` means "left pending for the user" per the caller
        // contract; this path just finalized the row as approved_failed,
        // i.e. it DID auto-resolve (to a failure) — return `Ok(true)` so a
        // caller doesn't surface this terminal row as a still-pending orb
        // consult.
        return Ok(true);
    }
    // (Owner re-check removed with the propose-time guard above — autonomous +
    // high-confidence may now drive a user's own CLI. `execute_fleet_send_input`
    // still fails closed if the target session id doesn't resolve to a live PTY
    // writer, so a hallucinated/stale id writes nothing.)
    let exec_result = match action.as_str() {
        "write_fact" => execute_write_fact(&state, &params).await,
        "write_backlog_item" => execute_write_backlog_item(&state, &params),
        "enqueue_dev_job" => execute_enqueue_dev_job(&state, app, &params),
        "schedule_proactive" => execute_schedule_proactive(&state, &params),
        "fleet_send_input" => execute_fleet_send_input(app, &params),
        "fleet_intervene" => execute_fleet_intervene(app, &params),
        "fleet_wake" => execute_fleet_wake(app, &params).await,
        "fleet_resume" => execute_fleet_resume(app, &params).await,
        _ => unreachable!("allowlist mismatch"),
    };
    // The persisted episode is what renders in the companion chat, so it carries
    // the plain, humanized result on its own — no `[... conservative policy] <op>`
    // machine prefix, no raw op name. Developer detail (op name, error) goes to the
    // trace below, not to the user.
    let (status_text, embedder_log) = match exec_result {
        Ok(r) => (APPROVAL_STATUS_APPROVED, r.message),
        Err(e) => {
            tracing::warn!(action = %action, error = %e, "companion: auto-approved action failed");
            (
                APPROVAL_STATUS_APPROVED_FAILED,
                format!("Sorry, I couldn't finish that automatically. ({e})"),
            )
        }
    };
    finalize_approval(&state, &approval.id, status_text)?;
    log_action_episode(&state, &action, &embedder_log).await;

    // Phase 5a — stamp the durable decision ledger for fleet actions (audit + the
    // cross-restart auto-fire dedupe read by `orchestrate_session`). Guarded to
    // `fleet_` so non-fleet auto-approvals (write_fact, …) don't land in it.
    if action.starts_with("fleet_") {
        let outcome = if status_text == APPROVAL_STATUS_APPROVED {
            "auto_fired"
        } else {
            "auto_failed"
        };
        record_fleet_decision(&state.db, &action, &approval.params_json, outcome, None);
        // Her assessment RESOLVED (typed or failed to type) — drop the
        // "Athena's on it" window now instead of letting it lapse; the typed
        // input's own hooks (UserPromptSubmit → Running) drive the state next.
        if let Some(sid) = serde_json::from_str::<serde_json::Value>(&approval.params_json)
            .ok()
            .as_ref()
            .and_then(|v| v.get("session_id"))
            .and_then(|v| v.as_str())
        {
            crate::commands::companion::fleet_bridge::resolve_athena_assessment(app, sid, None);
        }
    }

    // Notify-only orb indicator (user policy "safety net" = Notify only): when a
    // fleet action auto-fired successfully, tell the orb what Athena just did so
    // the user sees the hands-off action without having to watch the grid. Purely
    // informational — no undo (the user opted out of an undo window).
    if matches!(action.as_str(), "fleet_send_input" | "fleet_intervene")
        && status_text == APPROVAL_STATUS_APPROVED
    {
        emit_fleet_auto_decided(app, &params);
    }
    Ok(true)
}

/// Phase 5a — stamp the durable fleet-decision ledger for a fleet action.
/// Best-effort: a ledger miss never affects the decision. Pulls session_id /
/// confidence / decision_class / rationale from the approval params, and the
/// screen-hash + stable conversation id from `fleet_bridge` / the registry.
/// `outcome` is `"auto_fired"` | `"auto_failed"` | `"deferred"`; `defer_reason`
/// explains a defer.
/// A fleet PTY-write proposal was left pending as a consult — make the TARGET
/// SESSION say so. The orb bubble alone was missable; the session is what the
/// operator watches, so it escalates to a visible `AwaitingInput` with the
/// proposal in the reason (which also clears the masking "Athena's on it"
/// window). Recovery actions (`fleet_wake`/`fleet_resume`) don't come through
/// here — their targets are hibernated/orphaned rows with nothing to escalate.
pub(crate) fn escalate_fleet_consult(app: &tauri::AppHandle, params_json: &str) {
    let v: serde_json::Value = serde_json::from_str(params_json).unwrap_or(serde_json::Value::Null);
    let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) else { return };
    let proposal = v
        .get("text")
        .or_else(|| v.get("message"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let capped: String = proposal.chars().take(120).collect();
    let reason = if capped.is_empty() {
        "Athena needs your review — approve or reject her proposal on the tile".to_string()
    } else {
        format!(
            "Athena needs your review — she proposes: {capped}{}",
            if proposal.chars().count() > 120 { "…" } else { "" }
        )
    };
    crate::commands::companion::fleet_bridge::resolve_athena_assessment(app, sid, Some(&reason));
}

pub(crate) fn record_fleet_decision(
    db: &crate::db::DbPool,
    action: &str,
    params_json: &str,
    outcome: &str,
    defer_reason: Option<&str>,
) {
    let v: serde_json::Value =
        serde_json::from_str(params_json).unwrap_or(serde_json::Value::Null);
    let get = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let session_id = get("session_id").unwrap_or_default();

    // Debug-log tap. This fn is the single choke point every fleet verdict
    // passes through — auto-fired, auto-failed, and both defer reasons — so one
    // tap here covers Athena's whole decision surface. Records what she decided
    // and what she typed; never the terminal screen she read (see debug_log).
    if crate::commands::fleet::debug_log::is_armed() && !session_id.is_empty() {
        let mut extra: Vec<(&str, String)> = Vec::new();
        if let Some(text) = get("text").or_else(|| get("message")) {
            extra.push(("sent", text));
        }
        if let Some(why) = get("rationale") {
            extra.push(("why", why));
        }
        crate::commands::fleet::debug_log::athena_with(
            &session_id,
            &format!("decision {}", outcome.to_uppercase()),
            &format!(
                "action={action} class={} conf={}{}",
                get("decision_class").unwrap_or_else(|| "?".into()),
                get("confidence").unwrap_or_else(|| "?".into()),
                defer_reason.map(|r| format!(" reason={r}")).unwrap_or_default(),
            ),
            &extra,
        );
    }

    let screen_hash =
        crate::commands::companion::fleet_bridge::recorded_decision_hash_hex(&session_id)
            .unwrap_or_default();
    let claude_session_id =
        crate::commands::companion::fleet_bridge::claude_session_id_for(&session_id);
    crate::db::repos::fleet_decisions::record(
        db,
        &crate::db::repos::fleet_decisions::FleetDecisionInsert {
            session_id,
            claude_session_id,
            screen_hash,
            action: action.to_string(),
            outcome: outcome.to_string(),
            confidence: get("confidence"),
            decision_class: get("decision_class"),
            defer_reason: defer_reason.map(str::to_string),
            rationale: get("rationale"),
        },
    );
}

/// Emit the `athena://fleet/auto-decided` event the orb listens for to flash a
/// brief "Athena → <project>: <text>" notice. Best-effort: a missing field or a
/// failed emit just means no notice. The session's project label is looked up
/// from the live registry so the notice names the project, not a raw UUID.
pub(crate) fn emit_fleet_auto_decided(app: &tauri::AppHandle, params: &serde_json::Value) {
    let session_id = params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
    // `fleet_send_input` carries `text`; `fleet_intervene` carries `message` —
    // surface whichever is present so both auto-fires flash on the orb.
    let text = params
        .get("text")
        .or_else(|| params.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if session_id.is_empty() {
        return;
    }
    let project_label = crate::commands::fleet::registry::registry()
        .lookup_meta(session_id)
        .map(|(label, _cwd)| label)
        .unwrap_or_default();
    let _ = app.emit(
        "athena://fleet/auto-decided",
        serde_json::json!({
            "sessionId": session_id,
            "projectLabel": project_label,
            "text": text,
        }),
    );
}

// ── auto-reaction after an approved action ───────────────────────────────

/// Actions whose entire effect is opening a screen / prefilling a form — a
/// spoken reaction would just be noise. `open_route` / `open_lab` are auto-fired
/// by the dispatcher and never reach this executor, but naming them documents
/// the contract; `prefill_persona_create` reaches here (the user approves it),
/// so it's listed explicitly to stay quiet.
pub(crate) const NAVIGATION_ONLY_ACTIONS: &[&str] = &["open_route", "open_lab", "prefill_persona_create"];

/// Actions that ALREADY spawn their OWN follow-up reasoning turn into the chat
/// (`analyze_fleet` → fleet analysis, `run_browser_test` → the browser-test
/// turn). Their `ExecuteResult` message is just a "started — I'll report back
/// here" acknowledgment; the substantive reply arrives as the turn they spawned,
/// so a canned reaction on top would double up.
pub(crate) const SELF_NARRATING_ACTIONS: &[&str] = &["analyze_fleet", "run_browser_test"];

/// Whether an approved action should get an automatic Athena reaction turn.
/// Lenient by design — the rule is "better one more message than none", so the
/// default is to react. Skips ONLY: (1) `fleet_*` — already excluded from the
/// companion chat entirely (see `log_action_episode`'s early return); (2) the
/// explicit navigation-only / prefill list (opening a screen isn't chat-worthy);
/// (3) self-narrating actions that spawn their own reply turn (reacting would
/// double up). Everything else — memory writes, `resolve_human_review`,
/// `use_connector`, `run_arena`, and actions that merely also carry a
/// `client_action` — reacts.
pub(crate) fn should_react_to_action(action: &str, client_action: Option<&ClientAction>) -> bool {
    if action.starts_with("fleet_") {
        return false;
    }
    if NAVIGATION_ONLY_ACTIONS.contains(&action) || SELF_NARRATING_ACTIONS.contains(&action) {
        return false;
    }
    // Lenient on purpose (Michal: "better one more message than none"): an action
    // that also carries a `client_action` still did real work — a run started, a
    // persona prefilled — so a brief reply beats silence. Only the explicit
    // fleet / navigation / self-narrating lists above stay quiet.
    let _ = client_action;
    true
}

/// After an approved action executes successfully, spawn ONE brief
/// system-initiated Athena turn into the MAIN chat thread so the user gets a
/// response without re-initiating (the reported gap: clicking Approve executed
/// the action + logged a flat "Saved that to memory." line, but Athena never
/// reacted). Rides the same fire-and-forget proactive-turn machinery the
/// scheduler uses — it streams into the panel via `companion://stream` and
/// persists as a hidden `[proactive: action_reaction]` System opener + one
/// assistant reply, landing right after the outcome episode in
/// `DEFAULT_SESSION_ID`.
///
/// Loop-safe: the reaction is a normal assistant turn, NOT an approval, so it
/// can't re-enter `companion_approve_action`; and if its reply proposes a new
/// action, that surfaces as a fresh approval card (a deliberate new user
/// decision), never an auto-reaction. The skip filter keeps it off fleet /
/// navigation / self-narrating actions.
pub(crate) fn spawn_action_reaction(
    app: &tauri::AppHandle,
    state: &State<'_, Arc<AppState>>,
    action: &str,
    outcome_message: &str,
    client_action: Option<&ClientAction>,
) {
    if !should_react_to_action(action, client_action) {
        return;
    }
    // Internal directive to Athena (not UI chrome) — no i18n needed.
    let directive = format!(
        "You just carried out an action the user approved: `{action}`.\n\
         Outcome: {outcome}\n\n\
         Respond with ONE short reaction (1–2 sentences), in your own voice, acknowledging what \
         just happened — and offer a next step ONLY if one is genuinely useful. Don't restate the \
         outcome verbatim, don't propose or take another action, and don't ask the user to do \
         anything unless it clearly helps. This is just so they get a reply instead of silence.",
        action = action,
        outcome = outcome_message.trim(),
    );
    crate::companion::session::spawn_proactive_turn_in(
        app.clone(),
        Arc::new(state.user_db.clone()),
        Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "action_reaction".to_string(),
        Some(action.to_string()),
        directive,
        DEFAULT_SESSION_ID.to_string(),
    );
}

// ── Phase J — Fleet dispatcher executors ────────────────────────────
//
// All four hit the fleet's in-process registry directly; no IPC
// roundtrip. Each returns a human-readable message that lands as a
// system episode so Athena can quote it on the next turn.

/// Whether a screen-driving fleet proposal (`fleet_send_input` / `fleet_intervene`)
/// self-reports HIGH confidence — the strictest rung of the autonomous autoapprove
/// gate. Only an explicit `"high"` lets Athena act unsupervised at every dial;
/// `"medium"` / `"low"` / missing / unrecognized defer to the dial×class matrix or
/// a user consult. Case-insensitive and whitespace-tolerant; fails safe to `false`.
pub(crate) fn fleet_action_is_high_confidence(params_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(params_json)
        .ok()
        .as_ref()
        .and_then(|v| v.get("confidence"))
        .and_then(|c| c.as_str())
        .map(|c| c.trim().eq_ignore_ascii_case("high"))
        .unwrap_or(false)
}

/// Phase 2 gate — whether a screen-driving fleet proposal (`fleet_send_input` or,
/// since Phase 3b, `fleet_intervene`) auto-fires under the current boldness dial,
/// from its self-reported `confidence` + `decision_class`. The logic is
/// action-agnostic: both carry the same params and the same auto-fire semantics.
/// `high` always fires; `low` / missing / unknown never fire; `medium` fires
/// only for the class/dial combinations below. A missing/unknown
/// `decision_class` is treated as the stricter `choice` (fail safe → consult).
///
/// ```text
///   dial       drive_forward    choice
///   cautious   high             high
///   balanced   high|medium      high
///   bold       high|medium      high|medium
/// ```
pub(crate) fn fleet_action_auto_fires(
    params_json: &str,
    boldness: crate::commands::companion::chat::FleetBoldness,
) -> bool {
    use crate::commands::companion::chat::FleetBoldness;
    // High confidence auto-fires at every dial, both classes.
    if fleet_action_is_high_confidence(params_json) {
        return true;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(params_json) else {
        return false;
    };
    // Bold (the default) is now FULL-AUTO: in autonomous mode every proposal
    // fires, low/missing confidence included — the user's explicit call
    // (2026-07-24): loosen the boundaries even if experimental; she should
    // react in any terminal requiring her attention. A wrong keystroke into a
    // CLI is recoverable; a fleet parked on consults is not autonomous. Her
    // stated confidence still lands in the decision ledger + debug log, so the
    // policy can be re-tightened from data. Cautious/Balanced keep their
    // pre-2026-07-24 meaning for users who want the gate back.
    if matches!(boldness, FleetBoldness::Bold) {
        return true;
    }
    // Only "medium" can still qualify; low / missing / unknown → consult.
    let is_medium = v
        .get("confidence")
        .and_then(|c| c.as_str())
        .map(|c| c.trim().eq_ignore_ascii_case("medium"))
        .unwrap_or(false);
    if !is_medium {
        return false;
    }
    // decision_class missing/unknown → treated as the stricter "choice".
    let is_drive_forward = v
        .get("decision_class")
        .and_then(|c| c.as_str())
        .map(|c| c.trim().eq_ignore_ascii_case("drive_forward"))
        .unwrap_or(false);
    match boldness {
        FleetBoldness::Cautious => false,            // high-only
        FleetBoldness::Balanced => is_drive_forward, // medium only for drive_forward
        FleetBoldness::Bold => true,                 // unreachable (early return above)
    }
}

#[cfg(test)]
mod confidence_gate_tests {
    use super::fleet_action_is_high_confidence;

    #[test]
    fn only_explicit_high_passes() {
        assert!(fleet_action_is_high_confidence(
            r#"{"session_id":"s","text":"go","confidence":"high"}"#
        ));
        assert!(fleet_action_is_high_confidence(
            r#"{"confidence":"HIGH"}"#
        ));
        assert!(fleet_action_is_high_confidence(
            r#"{"confidence":" High "}"#
        ));
    }

    #[test]
    fn medium_low_missing_and_garbage_defer() {
        assert!(!fleet_action_is_high_confidence(r#"{"confidence":"medium"}"#));
        assert!(!fleet_action_is_high_confidence(r#"{"confidence":"low"}"#));
        assert!(!fleet_action_is_high_confidence(r#"{"confidence":"very"}"#));
        // Missing field, wrong type, and unparseable all fail safe.
        assert!(!fleet_action_is_high_confidence(r#"{"session_id":"s","text":"go"}"#));
        assert!(!fleet_action_is_high_confidence(r#"{"confidence":0.9}"#));
        assert!(!fleet_action_is_high_confidence("not json"));
    }

    #[test]
    fn matrix_high_always_fires() {
        use super::fleet_action_auto_fires;
        use crate::commands::companion::chat::FleetBoldness;
        for b in [FleetBoldness::Cautious, FleetBoldness::Balanced, FleetBoldness::Bold] {
            assert!(fleet_action_auto_fires(
                r#"{"confidence":"high","decision_class":"choice"}"#,
                b
            ));
            assert!(fleet_action_auto_fires(
                r#"{"confidence":"high","decision_class":"drive_forward"}"#,
                b
            ));
        }
    }

    #[test]
    fn matrix_low_and_missing_never_fire() {
        use super::fleet_action_auto_fires;
        use crate::commands::companion::chat::FleetBoldness;
        for b in [FleetBoldness::Cautious, FleetBoldness::Balanced, FleetBoldness::Bold] {
            assert!(!fleet_action_auto_fires(
                r#"{"confidence":"low","decision_class":"drive_forward"}"#,
                b
            ));
            // missing confidence + unparseable → never fire.
            assert!(!fleet_action_auto_fires(r#"{"decision_class":"drive_forward"}"#, b));
            assert!(!fleet_action_auto_fires("not json", b));
        }
    }

    #[test]
    fn matrix_medium_depends_on_dial_and_class() {
        use super::fleet_action_auto_fires;
        use crate::commands::companion::chat::FleetBoldness;
        let df = r#"{"confidence":"medium","decision_class":"drive_forward"}"#;
        let choice = r#"{"confidence":"medium","decision_class":"choice"}"#;
        // Cautious: medium never fires.
        assert!(!fleet_action_auto_fires(df, FleetBoldness::Cautious));
        assert!(!fleet_action_auto_fires(choice, FleetBoldness::Cautious));
        // Balanced: medium fires for drive_forward only.
        assert!(fleet_action_auto_fires(df, FleetBoldness::Balanced));
        assert!(!fleet_action_auto_fires(choice, FleetBoldness::Balanced));
        // Bold: medium fires for both classes.
        assert!(fleet_action_auto_fires(df, FleetBoldness::Bold));
        assert!(fleet_action_auto_fires(choice, FleetBoldness::Bold));
    }

    #[test]
    fn matrix_missing_or_unknown_class_treated_as_choice() {
        use super::fleet_action_auto_fires;
        use crate::commands::companion::chat::FleetBoldness;
        // medium + unknown/missing class → stricter "choice": only Bold fires.
        let no_class = r#"{"confidence":"medium"}"#;
        let bad_class = r#"{"confidence":"medium","decision_class":"whatever"}"#;
        assert!(!fleet_action_auto_fires(no_class, FleetBoldness::Balanced));
        assert!(!fleet_action_auto_fires(bad_class, FleetBoldness::Balanced));
        assert!(fleet_action_auto_fires(no_class, FleetBoldness::Bold));
        assert!(fleet_action_auto_fires(bad_class, FleetBoldness::Bold));
    }
}

