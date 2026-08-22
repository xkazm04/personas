//! DEV MODE — dev-op ledger self-review (the designed-but-unbuilt tail of
//! `docs/tests/athena/dev-mode-direction.md`).
//!
//! The operator's 👍/👎 verdicts have been accumulating in
//! `companion_dev_op` and feeding back into nothing. This closes that
//! meta-loop with the cheapest possible mechanism: a **manual trigger**
//! that assembles Athena's own dispatch track record as evidence and
//! spawns exactly ONE proactive turn over it.
//!
//! Deliberately NOT a scheduler. There is no cron, no periodic pass, no
//! new table — the ledger already holds everything, and a self-review
//! that fires on its own would be a background spend the operator never
//! asked for. One button, one turn.
//!
//! What the turn is allowed to do is bounded in the directive: write
//! procedural memories about what makes her dispatches land, and *at
//! most one* `dev_improve` proposal aimed at her weakest pattern. She
//! never marks her own goals or verdicts — the verdict column is the
//! operator's signal and would be worthless if she could write it.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::companion::dev_mode::{DevOpLedgerEntry, DevOpMetrics};
use crate::error::AppError;
use crate::AppState;

/// How many recent ops the evidence block carries. Enough to see a
/// pattern, short enough that the directive stays a prompt and not a
/// dump (see `prompt::PromptBlockSizes` for why block size is not free).
const REVIEW_WINDOW: u32 = 15;

/// Max chars of a request rendered per row. Requests are operator prose
/// and can run long; the pattern lives in the first clause.
const REQUEST_DIGEST_CHARS: usize = 90;

/// Char-safe (never byte-slicing) request digest.
fn digest(request: &str, max: usize) -> String {
    let one_line = request.replace(['\n', '\r'], " ");
    let trimmed = one_line.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max).collect();
    out.push('…');
    out
}

/// Render the ledger as the evidence block for the review turn.
///
/// Pure and deterministic — the unit test pins the exact shape, because a
/// self-review whose evidence silently changes format is a self-review
/// whose conclusions can't be compared across runs.
pub fn format_self_review_evidence(entries: &[DevOpLedgerEntry], metrics: &DevOpMetrics) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "Scoreboard (all time): {total} dispatched · {landed} landed a commit · \
         {merged} merged · {closed} closed · {interrupted} interrupted · \
         {up}👍 / {down}👎\n\n",
        total = metrics.total,
        landed = metrics.landed_commit,
        merged = metrics.merged,
        closed = metrics.closed,
        interrupted = metrics.interrupted,
        up = metrics.thumbs_up,
        down = metrics.thumbs_down,
    ));
    s.push_str("Recent dispatches (newest first):\n");
    for (i, e) in entries.iter().enumerate() {
        let verdict = match e.user_verdict.as_deref() {
            Some("up") => "👍",
            Some("down") => "👎",
            _ => "unrated",
        };
        let finished = e.finished_at.as_deref().unwrap_or("unfinished");
        let commit = e.commit_sha.as_deref().unwrap_or("no commit");
        s.push_str(&format!(
            // op_id leads the row: the instructions require citing op ids
            // in `sources`, so the evidence must carry them.
            "{n}. {op} [{status}] {verdict} · {kind} · {commit} · {finished}\n   \"{request}\"\n",
            n = i + 1,
            op = e.op_id,
            status = e.status,
            kind = if e.backend { "backend" } else { "frontend" },
            request = digest(&e.request, REQUEST_DIGEST_CHARS),
        ));
    }
    s
}

/// The instruction half of the directive. Separate from the evidence so
/// the test can assert the evidence shape without pinning prose.
fn review_instructions() -> &'static str {
    "Review your own dev-dispatch track record above — this is YOUR work, rated by Michal.\n\n\
     What to do, in this order:\n\
     1. Analyze honestly. Which requests landed a commit and earned a 👍? Which were \
     interrupted, landed nothing, or drew a 👎? Look for the shared property, not the \
     individual story — scope size, backend vs frontend, how specific the request was, \
     whether you split the work.\n\
     2. Write 1 to 3 procedural memories capturing what you learned about making your dev \
     dispatches succeed, using your normal write op:\n\
     OP: {\"op\": \"propose_action\", \"action\": \"write_procedural\", \"params\": \
     {\"scope\": \"build\", \"trigger\": \"<when this applies>\", \"behavior\": \"<what to do>\", \
     \"sources\": [\"<op_id>\", ...], \"importance\": 1-5, \"confidence\": 0.0-1.0}, \
     \"rationale\": \"<why now>\"}\n\
     Cite the op ids the pattern came from. If the ledger is too thin to support a rule, \
     say so and write nothing — a fabricated rule is worse than no rule.\n\
     3. OPTIONALLY propose at MOST ONE `dev_improve` targeting your weakest pattern. One. \
     It stays an approval card Michal clicks, exactly like every other dispatch.\n\n\
     Hard rules: never mark a goal done, never write or change a 👍/👎 verdict — those are \
     Michal's signal about you and are worthless if you can write them. Keep the reply tight: \
     what the record shows, then the OP lines."
}

/// DEV MODE self-review: one turn where Athena reads her own dev-dispatch
/// track record and writes back what she learned.
///
/// Returns how many ops the evidence carried, so the trigger can say what
/// it just started. Fire-and-forget past that point — the turn itself
/// lands in the conversation like any other proactive turn.
#[tauri::command]
pub fn companion_dev_op_self_review(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<u32, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    // Loud, not silent: this SPAWNS A TURN (real spend) and reads workspace
    // history. The read-only ledger command returns an empty payload when
    // dev mode is off; a write-shaped action refuses instead.
    if !crate::commands::companion::chat::dev_mode_enabled(&state.db) {
        return Err(AppError::Validation(
            "dev mode is off — the dev-op self-review only applies to dev-mode runs".into(),
        ));
    }

    let entries = crate::companion::dev_mode::list_dev_ops(&state.user_db, REVIEW_WINDOW);
    if entries.is_empty() {
        return Err(AppError::Validation(
            "no dev_improve runs in the ledger yet — nothing to review".into(),
        ));
    }
    let metrics = crate::companion::dev_mode::dev_op_metrics(&state.user_db);
    let reviewed = entries.len() as u32;

    let directive = format!(
        "Dev-mode self-review. Michal asked you to look at how your own dev_improve \
         dispatches have actually gone.\n\n{evidence}\n{instructions}",
        evidence = format_self_review_evidence(&entries, &metrics),
        instructions = review_instructions(),
    );

    crate::companion::session::spawn_proactive_turn(
        app,
        Arc::new(state.user_db.clone()),
        Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "dev_op_self_review".to_string(),
        None,
        directive,
    );

    Ok(reviewed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        op_id: &str,
        request: &str,
        status: &str,
        verdict: Option<&str>,
        commit: Option<&str>,
        backend: bool,
    ) -> DevOpLedgerEntry {
        DevOpLedgerEntry {
            op_id: op_id.to_string(),
            request: request.to_string(),
            backend,
            status: status.to_string(),
            commit_sha: commit.map(str::to_string),
            branch: None,
            user_verdict: verdict.map(str::to_string),
            created_at: "2026-08-01 09:00:00".to_string(),
            finished_at: Some("2026-08-01 09:20:00".to_string()),
        }
    }

    #[test]
    fn evidence_renders_scoreboard_then_numbered_rows() {
        let entries = vec![
            entry(
                "op_a",
                "Add a copy button to the approval card",
                "merged",
                Some("up"),
                Some("abc1234"),
                true,
            ),
            entry(
                "op_b",
                "Rewrite the whole panel",
                "interrupted",
                Some("down"),
                None,
                false,
            ),
        ];
        let metrics = DevOpMetrics {
            total: 2,
            in_flight: 0,
            merged: 1,
            closed: 0,
            interrupted: 1,
            landed_commit: 1,
            thumbs_up: 1,
            thumbs_down: 1,
        };
        let out = format_self_review_evidence(&entries, &metrics);
        let expected = "Scoreboard (all time): 2 dispatched · 1 landed a commit · \
             1 merged · 0 closed · 1 interrupted · 1👍 / 1👎\n\n\
             Recent dispatches (newest first):\n\
             1. op_a [merged] 👍 · backend · abc1234 · 2026-08-01 09:20:00\n   \
             \"Add a copy button to the approval card\"\n\
             2. op_b [interrupted] 👎 · frontend · no commit · 2026-08-01 09:20:00\n   \
             \"Rewrite the whole panel\"\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn unrated_and_unfinished_rows_render_without_placeholders_that_look_like_data() {
        let mut e = entry(
            "op_c",
            "Something in flight",
            "dispatched",
            None,
            None,
            false,
        );
        e.finished_at = None;
        let out = format_self_review_evidence(&[e], &DevOpMetrics::default());
        assert!(
            out.contains("op_c [dispatched] unrated · frontend · no commit · unfinished"),
            "{out}"
        );
        // A zeroed scoreboard must still read as zeros, never as blanks.
        assert!(out.contains("0 dispatched · 0 landed a commit"), "{out}");
    }

    #[test]
    fn request_digest_is_char_safe_and_bounded() {
        // Multi-byte input: a byte slice at 90 would panic here.
        let long = "díky".repeat(60);
        let d = digest(&long, REQUEST_DIGEST_CHARS);
        assert_eq!(
            d.chars().count(),
            REQUEST_DIGEST_CHARS + 1,
            "digest + ellipsis"
        );
        assert!(d.ends_with('…'));
        // Newlines collapse so one row stays one row.
        assert_eq!(digest("a\nb\r\nc", 90), "a b  c");
    }

    #[test]
    fn instructions_forbid_self_marking_and_cap_the_proposal() {
        let i = review_instructions();
        assert!(i.contains("write_procedural"));
        assert!(i.contains("at MOST ONE `dev_improve`"));
        assert!(i.contains("never write or change a 👍/👎 verdict"));
    }
}
