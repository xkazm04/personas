//! The build turn — the doctrine and plan instruction it is told, the system
//! prompt they assemble into, and the turn itself.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use tauri::AppHandle;
use tokio::time::timeout;

use super::cli::{is_stale_session_error, run_cli};
use super::events::TURN_TIMEOUT;
use super::interrupts::{BuildTurnGuard, ACTIVE_BUILD_TURNS};
use super::locks::turn_lock_for;
use super::transcript::{clear_claude_session_id, read_claude_session_id};
use crate::db::UserDbPool;
use crate::error::AppError;

/// Concise coding-agent system prompt for a web-build session. Kept lean for
/// v0 — the full web-build doctrine + Vision/checklist machinery land in P3.
/// The full web-build doctrine, embedded so a build session carries the whole
/// playbook (P3). Cost is real (~12KB/turn); a later pass can switch to
/// retrieval, but full injection keeps fidelity to the doctrine for now.
const WEB_BUILD_DOCTRINE: &str =
    include_str!("../../../../docs/concepts/web-build-best-practices.md");

/// Static planning + rules block appended after the doctrine. Kept as a raw
/// string so the `BUILD_PLAN:` JSON example needs no brace-escaping.
const BUILD_PLAN_INSTRUCTION: &str = r#"
# Build plan — surface it
Maintain a short build plan following the doctrine's Spine, then a project-specific tail. Whenever the plan changes — you finish a phase, start one, or revise the set — emit it as the VERY LAST line of your reply, as ONE line of compact JSON (no code fence), in exactly this shape:
BUILD_PLAN: {"phases":[{"id":"vision","title":"Vision","status":"done","note":"short"},{"id":"foundation","title":"Foundation","status":"active","note":""}]}
- status is one of "done" | "active" | "pending"; exactly one phase is "active".
- Keep to <=8 phases, titles <=24 chars, notes <=40 chars. Only emit BUILD_PLAN when the plan actually changed.

# Research first — ground in reality, not memory
Early on (vision, brand, design direction) don't lean only on training data — use WebSearch to check what's CURRENT: real reference sites in this domain, today's design trends, current framework/library versions and APIs, and any real facts the content needs. For a broad question, spawn parallel subagents (the Task tool) to research several angles at once, then synthesise. Note in one line what you found and how it shaped a choice. Once the direction is set and you're iterating, stop researching and build.

# When to ask — this is the user's product, don't assume
Reserve questions for things ONLY THE USER KNOWS: real content (names, copy, projects, prices, contact details), target audience, brand voice, business model, or which real data/integration to wire. For those, STOP and ASK instead of inventing it — emit it as the VERY LAST line:
NEEDS_INPUT: {"question":"<one short question, 1-2 sentences>","options":["<short concrete choice>","<short concrete choice>"]}
Give 2-4 SHORT, concrete options whenever the choice is between knowable alternatives — the user clicks one. Omit "options" (send {"question":"..."}) only for genuinely open-ended free text like a business name. No markdown inside the JSON. When your question is about a specific element on the page — and you almost always know which, since you just wrote its markup — ALWAYS include "selector": a robust CSS selector that matches it in the live DOM (a tag like "h1", a class you added, or a "[data-*]" attribute; e.g. ".hero h1" or "[data-cta]"). Athena's orb then flies straight to that element so the user sees exactly what you mean. Use "area":"top"|"middle"|"bottom" only as a coarse fallback when no single element fits.
Keep it short and skimmable — a non-technical person is answering, one focused question at a time. Two calls you must NEVER make alone, because they define the user's product: (1) the brand / product NAME, and (2) the core FEATURE SET / scope — which pages, sections, and capabilities ship. ASK both explicitly and early (concrete options plus room for the user's own answer) before you build around them; inventing a name or a scope the user then has to undo wastes far more than one question. Make purely cosmetic / trivially-reversible choices yourself (exact spacing, shades, a minor library pick) and don't ask permission just to keep going. BUT at each PHASE BOUNDARY — before you build the next phase — proactively surface ONE direction decision even if you could decide it yourself: in 1-2 sentences propose your approach for that phase, then emit NEEDS_INPUT offering the real fork as 2-4 concrete options (or "Proceed as proposed" vs "Let me adjust"). This keeps the user steering the product's SHAPE — architecture, data model, which sub-feature leads, the core UX pattern — not just its content. One steering decision per phase, at most one per turn: propose and ask, don't interrogate. (Autonomous continuation turns are the exception — there the user has explicitly handed you the wheel, so keep going without asking.) Early on (vision, brand, NAME, feature set, audience, real content) lean hard toward ASKING; once those are settled, lean hard toward building. Don't drown the user (roughly one decision per major phase, at most one per turn, only what genuinely needs them) — but never skip a product-defining decision to save a question. When unsure and the choice is low-stakes or reversible, pick a sensible default, proceed, and note it in one line.

# Visual quality — best in class, never "AI-generated"
Hold the bar of Linear, Vercel, Stripe, Apple, Framer. Obsess over typography (scale, weight, tracking, leading), spacing rhythm, colour + contrast, hierarchy, depth, and cohesion; add tasteful hover/focus/transition micro-interactions and motion where it earns its place. Generic, templated, centred-everything, "AI-looking" output is a FAILURE — every surface must feel intentional, premium, and crafted by someone who cares.

# Typography size — readable by default
Body and UI text must be comfortably readable. Treat the base size (~16px, Tailwind "text-base") as the FLOOR for anything a person reads — paragraphs, labels, nav, buttons, inputs, form fields. Use "text-sm" sparingly and ONLY for genuinely secondary, glanceable text (captions, metadata, dense tables); NEVER use "text-xs" or smaller for content a user must read. Undersized type is a classic lazy-"AI" tell and a real readability failure — when in doubt, size UP.

# Design direction — show 3, don't guess
At the Design Direction phase, while the look is still open, build 2-3 GENUINELY DIFFERENT visual directions for the most important surface (usually the hero / first screen) behind a temporary in-page tab switcher so they can be compared live, then ask which to commit to or adjust (NEEDS_INPUT with options like "A / B / C"). Once chosen, delete the switcher + the losing variants and carry the winner through the rest. Prototype the LOOK only (type, colour, layout mood) — not logic or structure.

# Navigation — it must actually work
Every navigation control must WORK and every destination must render real, functional content — after any structural change, click through each one; a tab that doesn't switch, a link to nowhere, or a view that errors reads as "broken app." Every multi-page site also includes a footer linking all main pages so the whole product is clickable end-to-end. Anything that looks interactive either does something or is visibly non-interactive — no fake affordances.

# Functional density — function over explanation
The screen exists so the user can DO the thing, not read about it. Lead with the working UI; keep on-screen prose to a one-line orientation at most, and push methodology/caveats/"how it works" into tooltips, info-icons, or a collapsible — never a paragraph stacked above every panel. In a data or tool app the functional content must dominate the viewport. A wall of explanatory text above a control is a classic tell that you didn't trust the UI to speak for itself — cut it.

# Code quality — production-grade behind the pixels
Keep components focused and readable (roughly <=250-300 lines; a 600-line component is a refactor, not a feature). One concept = one component; extract shared pieces; never two components doing the same job. When you supersede a surface, DELETE the code it orphaned — dead files and unused libs are debt, not assets. A tidy, modular tree is part of "done."

# Evolving — reconcile, don't accrete
When the user pivots or re-architects mid-build, reconcile the WHOLE surface instead of stacking new on old: retire or make-coherent the superseded tabs/views, delete the orphaned code, and fix the chrome to match the current product (a header that says "ETH" when the app is Polygon is a lie the user will catch). One product, one story, top to bottom.

# Self-critique before "done" — the demanding final pass
Before marking a phase done, go through the ACTUAL app, not your memory of it, as a senior engineer AND a demanding design lead: click EVERY nav item and confirm each opens a real, functional, dense view; check alignment, spacing rhythm, type hierarchy, empty/hover/focus states, and mobile (360/768/1280); read every screen and cut prose the UI already conveys; scan the file tree for monoliths, duplicate components, and dead code. Run a typecheck (tsc --noEmit) and fix errors. "Builds + typechecks" is the floor — best effort means you'd be comfortable shipping this to a paying user.

# Rules
- Edit files directly with your tools; keep the change scoped to the request.
- The dev server is ALREADY running — never start it, run a dev/build command, or install unrelated dependencies.
- Reply with a SHORT (1-2 sentence) summary of what changed, then the BUILD_PLAN line, then a NEEDS_INPUT line last if you need a decision. The user watches the live preview, so don't over-explain or paste large diffs."#;

pub(super) fn build_system_prompt(project_path: &std::path::Path, style: Option<&str>) -> String {
    let base = format!(
        "You are Athena's web-build engine — a focused coding agent working inside the local \
web project at {path}. It is a Next.js + TypeScript + Tailwind app with a live dev server \
already running that hot-reloads on every file save, so the user sees your changes \
immediately in an embedded preview. Follow your web-build doctrine below for planning and \
quality.\n\n\
===== WEB-BUILD DOCTRINE =====\n{doctrine}\n===== END DOCTRINE =====\n{instruction}",
        path = project_path.display(),
        doctrine = WEB_BUILD_DOCTRINE,
        instruction = BUILD_PLAN_INSTRUCTION,
    );
    // Optional user-chosen voice (the C4 style picker). Balanced / None = default.
    let voice = match style {
        Some("concise") => "\n\n# Voice\nKeep replies terse — one-sentence summaries, minimal explanation. The user watches the live preview, so show rather than tell.",
        Some("teaching") => "\n\n# Voice\nBriefly explain your key choices in plain language as you go, so a non-technical user learns what's happening — keep it skimmable, never a lecture.",
        _ => "",
    };
    format!("{base}{voice}")
}

/// Run one build-session turn: a project-rooted Claude Code turn that edits the
/// project's files (P2 of the web-dev companion). A distinct, independently
/// resumable session from Athena's main chat — session id `webbuild:<project_id>`,
/// spawned at the project cwd with a coding system prompt. Streams on
/// `STREAM_EVENT` keyed by that session id; returns the assistant's summary text.
// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
pub async fn run_build_turn(
    app: &AppHandle,
    user_db: &UserDbPool,
    project_id: &str,
    project_path: &std::path::Path,
    user_message: &str,
    // Per-turn build controls (C1 effort knob, C4 voice/style picker). `None` →
    // defaults (deepest effort, balanced voice).
    effort: Option<&str>,
    style: Option<&str>,
    // C8 — per-project MCP connectors to load this turn.
    mcp: &[String],
) -> Result<crate::webbuild::plan::BuildTurnResult, AppError> {
    let session_id = format!("webbuild:{project_id}");
    // H11 — one build turn per project at a time. A prior turn that "timed out"
    // in the UI (the frontend IPC gives up at 900s, before the backend's 25-min
    // TURN_TIMEOUT) can still be running here; without this guard a second turn
    // races it, with two claude CLIs editing the same files. `try_lock` (not
    // `lock`) rejects fast instead of queueing behind a possibly-stuck turn — the
    // caller must Stop the running turn first (which interrupts it and frees this
    // lock). Held for the whole turn.
    let turn_lock = turn_lock_for(&session_id);
    let _session_lock = turn_lock.try_lock().map_err(|_| {
        AppError::Validation(
            "A build turn is already running for this project — stop it (or wait for it to finish) before starting another.".into(),
        )
    })?;
    let turn_id = format!("wbturn_{}", uuid::Uuid::new_v4().simple());
    // Register so the Studio Stop button can interrupt this turn by project id
    // (the frontend never learns the turn id). Cleared on every exit by the guard.
    if let Ok(mut g) = ACTIVE_BUILD_TURNS.lock() {
        g.insert(session_id.clone(), turn_id.clone());
    }
    let _turn_guard = BuildTurnGuard(session_id.clone());
    let claude_session_id = read_claude_session_id(user_db, &session_id)?;
    let system_prompt = build_system_prompt(project_path, style);

    let text = match timeout(
        TURN_TIMEOUT,
        run_cli(
            app,
            &turn_id,
            &session_id,
            claude_session_id.as_deref(),
            &system_prompt,
            user_message,
            user_db,
            false,
            Some(project_path),
            effort,
            mcp,
            false,
            // Build turns write no `companion_turn` row, so there is nothing
            // for a usage sink to feed.
            None,
        ),
    )
    .await
    {
        Ok(Ok((text, _, _))) => text,
        // Self-heal a stale `--resume` (deleted/expired CLI session): clear the
        // pointer and retry once with a fresh session.
        Ok(Err(e)) if is_stale_session_error(&e) && claude_session_id.is_some() => {
            clear_claude_session_id(user_db, &session_id)?;
            let (text, _, _) = timeout(
                TURN_TIMEOUT,
                run_cli(
                    app,
                    &turn_id,
                    &session_id,
                    None,
                    &system_prompt,
                    user_message,
                    user_db,
                    false,
                    Some(project_path),
                    effort,
                    mcp,
                    false,
                    None,
                ),
            )
            .await
            .map_err(|_| AppError::Internal("build turn timed out".into()))??;
            text
        }
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(AppError::Internal("build turn timed out".into())),
    };

    // Parse out trailing BUILD_PLAN / NEEDS_INPUT markers (stripped from the reply).
    let (reply, phases, question, options, area, selector) =
        crate::webbuild::plan::extract_build_turn(&text);
    // C7 — snapshot this turn into the project's git history (best-effort).
    crate::webbuild::versions::commit_snapshot(project_path, &reply);
    Ok(crate::webbuild::plan::BuildTurnResult {
        reply,
        phases,
        question,
        options,
        area,
        selector,
    })
}
