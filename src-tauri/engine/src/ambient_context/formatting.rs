use super::{AmbientContextHandle, AmbientSignalEntry};

/// Pure renderer for the ambient prompt block.
///
/// Takes a pre-filtered slice of signals (the caller is responsible
/// for applying the persona's `SensoryPolicy` — source filter, age
/// cutoff, window size — before calling) and an optional already-
/// formatted "App — Window Title" label, and produces a markdown
/// document suitable for prepending to a system prompt.
///
/// Returns `None` when the signal list is empty — this is the signal
/// to the caller (`prepend_ambient_to_system_prompt`) that there's
/// nothing to inject and the no-op path should run.
///
/// The two callers are:
/// - [`AmbientContextFusion::format_for_prompt`] — windowed-app path,
///   reads from in-memory rolling window.
/// - The Phase 3 c v3 daemon path — reads from
///   [`ambient_signal_repo::recent_signals`] and applies the persona
///   policy explicitly before calling.
///
/// Sharing the renderer means the daemon-rendered prompt is byte-
/// identical to the windowed-app one for the same input data — a
/// regression in the rendered shape would appear in both code paths
/// simultaneously and be caught by the existing
/// `test_format_for_prompt` and the daemon-path tests in step 7.
pub fn format_signals_for_prompt(
    signals: &[AmbientSignalEntry],
    active_app_label: Option<&str>,
) -> Option<String> {
    if signals.is_empty() {
        return None;
    }

    let mut doc = String::with_capacity(512);
    doc.push_str("## Ambient Desktop Context\n");
    doc.push_str("The following is a summary of recent desktop activity observed by the system.\n");
    doc.push_str("Use this context to understand what the user is currently working on.\n\n");

    if let Some(label) = active_app_label {
        doc.push_str(&format!("**Active Application**: {label}\n\n"));
    }

    doc.push_str("**Recent Activity** (newest first):\n");
    for entry in signals {
        let age = if entry.age_secs < 60 {
            format!("{}s ago", entry.age_secs)
        } else if entry.age_secs < 3600 {
            format!("{}m ago", entry.age_secs / 60)
        } else {
            format!("{}h ago", entry.age_secs / 3600)
        };
        doc.push_str(&format!(
            "- [{}] {} ({})\n",
            entry.source, entry.summary, age
        ));
    }

    Some(doc)
}

// ---------------------------------------------------------------------------
// Persona-execution prefix helpers (Phase 3 c — daemon/runner bridge)
// ---------------------------------------------------------------------------
//
// Building blocks for injecting "what Athena saw" into persona-execution
// prompts (gap #6 from the Phase 1 audit). The helpers live here because
// the rolling window is owned by `AmbientContextFusion`; runtime call-site
// wiring (engine/mod.rs::run_execution_with_ceiling and the daemon's
// consume_headless_events) is a follow-up commit.
//
// Architectural note — daemon process limitation:
//   The `personas-daemon` binary runs as a separate process from the
//   windowed Tauri app. The clipboard / file_watcher / app_focus
//   watchers live in the windowed process; their captured signals
//   never reach the daemon's address space. So `format_ambient_for_persona`
//   in the daemon path will always return None today — the daemon's
//   AppState doesn't construct an ambient handle either.
//
//   Closing the cross-process gap requires a separate piece of work
//   (likely a SQL-persisted projection of the rolling window OR a
//   tail-able UDS / named-pipe stream the daemon subscribes to). That
//   work is explicitly deferred — the v1 windowed-app wiring is the
//   higher-yield target.

/// Render the ambient context snapshot for a specific persona as a
/// markdown block suitable for prepending to that persona's system
/// prompt. Returns `None` when:
///   - the global `enabled` flag is off
///   - the rolling window is empty after policy filtering
///   - no per-source signals match the persona's `SensoryPolicy`
///
/// Locks the handle for the duration; safe to call from async contexts
/// where the caller already holds nothing on the fusion. Pairs with
/// [`prepend_ambient_to_system_prompt`] for the mutate-the-persona
/// shape that runtime call sites use.
pub async fn format_ambient_for_persona(
    ambient_ctx: &AmbientContextHandle,
    persona_id: &str,
) -> Option<String> {
    let guard = ambient_ctx.lock().await;
    guard.format_for_prompt(persona_id)
}

/// Prepend a rendered ambient context block to a persona's system
/// prompt. Caller-owned mutation — works on a `&mut Persona` so the
/// runtime path can inject without cloning the persona record. The
/// ambient block lands BEFORE the existing system prompt with a blank
/// line separator, so persona-authored instructions remain the
/// recency-weighted last block in the prompt.
///
/// No-op when `ambient_md` is empty or whitespace-only — the goal is
/// to add context, not produce an empty section header.
pub fn prepend_ambient_to_system_prompt(
    persona: &mut personas_db::models::Persona,
    ambient_md: &str,
) {
    if ambient_md.trim().is_empty() {
        return;
    }
    let existing = std::mem::take(&mut persona.system_prompt);
    persona.system_prompt = if existing.trim().is_empty() {
        ambient_md.to_string()
    } else {
        format!("{ambient_md}\n\n{existing}")
    };
}
