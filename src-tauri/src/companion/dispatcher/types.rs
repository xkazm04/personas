//! Payload types the dispatcher hands back to the chat layer, plus the
//! canvas spec/limit constants that describe their shape.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

use serde::Serialize;

/// Outcome of dispatching one assistant message.
#[derive(Debug, Default)]
pub struct Dispatched {
    /// Assistant text with op JSON lines stripped, safe to display.
    pub cleaned_text: String,
    /// Newly-created approval rows. The UI listens for these and renders
    /// inline cards per turn.
    pub approvals: Vec<CreatedApproval>,
    /// UI-only navigations Athena fired this turn (`open_route`). These
    /// bypass the approval pipeline by design — the user wants direct,
    /// chat-driven navigation that doesn't interrupt the conversation.
    /// Each entry is the validated sidebar route name.
    pub navigations: Vec<String>,
    /// UI-only "open this persona's lab tab" requests Athena fired
    /// (`open_lab`). Bypasses approval like `open_route`. Each entry
    /// is `(persona_id, mode)` where mode is one of the lab modes
    /// (`arena`, `ab`, `versions`, etc.).
    pub lab_opens: Vec<(String, String)>,
    /// `compose_dashboard` payloads — already-serialized JSON spec
    /// strings, one per op. session.rs persists each via
    /// `dashboard::save_dashboard` and emits a navigate event. Auto-fire
    /// (no approval) because the user already asked for the dashboard;
    /// the click would just be friction.
    pub dashboards: Vec<String>,
    /// `compose_cockpit` payloads — same shape as `dashboards`. session.rs
    /// persists each via `cockpit::save_cockpit` and emits a navigate
    /// event to Home → Cockpit. Auto-fire for the same reason as dashboards:
    /// the user already asked for the surface.
    pub cockpits: Vec<String>,
    /// `explain_in_cockpit` payloads — the ephemeral sibling of `cockpits`.
    /// Each entry is a serialized spec (title + widgets + decision_id) that
    /// session.rs emits VERBATIM in the event payload and never persists:
    /// the frontend renders it as a contextual overlay over the user's
    /// cockpit and it dies with dismissal. Auto-fire — the user pressed the
    /// decision bubble's `0` (explain) to ask for exactly this surface.
    pub explain_cockpits: Vec<String>,
    /// `compose_canvas_panel` compositions — WP3's counterpart to `cockpits`,
    /// aimed at the Mastermind canvas instead of Home. Each entry carries the
    /// slug (already validated against the PUBLISHED scene, so a demo island or
    /// an invented name never reaches the frontend) and the serialized
    /// SurfaceSpec. session.rs emits one event per entry; persistence happens
    /// frontend-side, inside the canvas layout document, because that is where
    /// a per-project panel lives (`athenaPanels[slug]`) and where its reset
    /// control can reach it. Auto-fire: a panel proposes, it never runs
    /// anything — every action inside it is still consent-gated on render.
    pub canvas_panels: Vec<CanvasPanelCompose>,
    /// `canvas_control` steering actions (WP4 — the v2 door onto the
    /// frontend's canvas action grammar, `canvasActionStore`). Auto-fire:
    /// every accepted kind is reversible VIEW state — the camera moves or a
    /// popover opens; nothing mutates. Slugs inside were resolved against the
    /// published scene here, so the frontend can trust them exactly like a
    /// composed panel's slug. session.rs emits one event per entry carrying
    /// the session id; the frontend bridge answers through
    /// `companion_canvas_control_result`, which lands as a System episode
    /// Athena reads on her next turn.
    pub canvas_controls: Vec<CanvasControlDispatch>,
    /// Inline chat cards from `show_persona_overview` / `show_connected_services`
    /// / `show_decisions`. Auto-fire (no approval) — companion uses these to
    /// surface contextual info inside the chat transcript when she judges it
    /// useful for the current turn. Each entry is `(kind, config_json)`.
    pub chat_cards: Vec<ChatCard>,
    /// `start_guided_walkthrough` topics Athena triggered this turn. Auto-fire
    /// (no approval) — session.rs emits a `companion://guide` event per topic
    /// and the frontend runner walks the registry-defined steps (orb glide +
    /// element glow + narration). Each entry is a validated topic id.
    pub guide_walkthroughs: Vec<String>,
    /// `point_at` requests Athena triggered this turn. Auto-fire — session.rs
    /// emits a `companion://guide` event carrying `{ pointAt }` and the frontend
    /// rings one allow-listed anchor + narrates it as a single-step ad-hoc
    /// walkthrough (non-scripted pointing). Anchor validated against `ANCHOR_IDS`.
    pub point_ats: Vec<PointAt>,
    /// `compose_walkthrough` requests Athena triggered this turn. Auto-fire —
    /// session.rs emits `companion://guide` `{ composeWalkthrough }` and the
    /// frontend runs the runtime-assembled multi-step tour. Each step's anchor
    /// validated against `ANCHOR_IDS`; step count clamped to a sane range.
    pub composed_walkthroughs: Vec<ComposedWalkthrough>,
    /// `compose_tour` payloads (Generative Tours) — serialized
    /// `{topic, title, description, steps}` specs whose every step already
    /// passed `companion::tours::validate_tour_spec` against the generated
    /// anchor manifest (unknown anchors reject the whole tour). session.rs
    /// persists each via `tours::save_tour`; the tour then appears in the
    /// Home → Learning timeline with the composed-by-Athena badge.
    pub composed_tours: Vec<String>,
    /// Quick-reply option labels Athena offered for this turn. Each entry
    /// is the literal user message that gets sent on click. Not persisted
    /// — the UI shows them on the latest assistant bubble until the next
    /// turn fires, then clears.
    pub quick_replies: Vec<String>,
    /// Spoken-version of the reply Athena emitted via a `TTS:` line —
    /// short (1-3 sentences), conversational, suited for ElevenLabs
    /// playback. None when Athena didn't emit one (voice off, or she
    /// chose to skip it for this turn). Frontend sets it as the latest
    /// `pendingPlayback` if voice playback is on.
    pub tts_text: Option<String>,
    /// True iff Athena emitted at least one `continue_autonomously` op
    /// in this turn. When the session is in autonomous mode AND this is
    /// set, the caller schedules a continuation tick. The op carries no
    /// payload beyond a `rationale` string — the dispatcher logs it but
    /// otherwise ignores the body.
    pub requests_continuation: bool,
    /// Any malformed op blocks we encountered. Logged but otherwise
    /// silent — never block the turn for a syntax error.
    pub warnings: Vec<String>,
    /// `PROGRESS:` conversational asides Athena emitted mid-turn, in order.
    /// Stripped from the final reply (above) and persisted by session.rs as
    /// their own lightweight assistant episodes so the chat reads as a
    /// progressive back-and-forth, not one silent block then a wall of text.
    pub progress_beats: Vec<String>,
}

/// One inline chat-card request. `config` is widget-specific JSON the
/// frontend forwards to the matching cockpit widget component.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCard {
    /// Widget kind: `persona_overview` | `connected_services` | `decisions_panel`.
    pub kind: String,
    /// Optional title override.
    pub title: Option<String>,
    /// Free-form config block — serialized verbatim for the frontend.
    pub config: serde_json::Value,
}

/// One `compose_canvas_panel` composition (WP3). The slug is already resolved
/// against the published canvas snapshot; `spec` is the serialized SurfaceSpec
/// the frontend parses (salvage-repaired there — a hallucinated block is
/// dropped rather than taking the panel down).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPanelCompose {
    /// Canvas slug, exactly as the published scene spells it.
    pub slug: String,
    /// Envelope version. Must stay in step with the frontend's
    /// `SUPPORTED_PANEL_SPEC_VERSIONS` in `sub_mastermind/lib/layoutStore.ts`;
    /// an entry carrying anything else is dropped on the way into the doc.
    pub spec_version: u32,
    /// Serialized SurfaceSpec JSON (`{"surface":"v1","blocks":[…]}`).
    pub spec: String,
}

/// Panel-envelope version this build emits.
pub const CANVAS_PANEL_SPEC_VERSION: u32 = 1;

/// Blocks one composed panel may carry — mirrors `surfaceSpecSchema`'s `.max(12)`
/// so an over-long composition is refused here rather than silently truncated
/// by the renderer.
pub(super) const CANVAS_PANEL_MAX_BLOCKS: usize = 12;

/// One validated `canvas_control` steering action (WP4). `action` is the
/// re-serialized, validated grammar object — only the fields the validator
/// accepted survive, so a stray `travel:false` or an invented field never
/// reaches the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasControlDispatch {
    /// Serialized `CanvasActionRequest` JSON (`{"kind":"camera.focus",…}`),
    /// matching `sub_mastermind/lib/canvasActionStore.ts` exactly.
    pub action: String,
}

/// Steering actions one turn may emit. More is camera thrash, not guidance —
/// the user is watching the view she's driving.
pub(super) const CANVAS_CONTROL_MAX_PER_TURN: usize = 4;

/// Action kinds `canvas_control` accepts — the STEERING half of the frontend
/// grammar. The read kinds (`island.read` / `dim.read`) are deliberately
/// absent: `describe_canvas_project` already answers those synchronously from
/// the published scene, without a frontend round-trip.
pub(super) const CANVAS_CONTROL_KINDS: &[&str] = &[
    "camera.read",
    "camera.pan",
    "camera.zoom",
    "camera.focus",
    "camera.fit",
    "dim.open",
    "category.open",
    "island.menu",
];

/// Zoom bands the grammar speaks (`types.ts::ZoomBand`).
pub(super) const CANVAS_CONTROL_BANDS: &[&str] = &["far", "mid", "near", "close"];

/// Category keys the far/mid rollup cells use (`dimCategories.ts`).
pub(super) const CANVAS_CONTROL_CATEGORIES: &[&str] =
    &["runtime", "delivery", "agentic", "product"];

/// An ad-hoc `point_at` request: Athena rings one allow-listed UI anchor and
/// narrates it, with no pre-authored walkthrough topic. `anchor` is validated
/// against `ANCHOR_IDS`; `narration` is the line she authored for this turn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointAt {
    pub anchor: String,
    pub narration: String,
}

/// A `compose_walkthrough` request: Athena assembles a short multi-step tour at
/// runtime from anchor-catalog entries (vs the static registry). Each step is a
/// `PointAt` (anchor + narration); the orb glides through them in order.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedWalkthrough {
    pub title: Option<String>,
    pub steps: Vec<PointAt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApproval {
    pub id: String,
    pub action: String,
    pub params_json: String,
    pub rationale: String,
}
