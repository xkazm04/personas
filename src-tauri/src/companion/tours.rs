//! Generative Tours — Athena composes spotlight walkthroughs at runtime.
//!
//! Sibling of `brain::cockpit`: where `compose_cockpit` turns a chat turn into
//! a widget surface, `compose_tour` turns a "show me how to X" into a
//! `DynamicTourDef` the frontend's `GuidedTour` plays exactly like a static
//! tour (nav targets + `data-testid` spotlights + per-step narration).
//!
//! The trust boundary is the **anchor manifest**
//! (`generated_tour_anchors.rs`, codegen'd by
//! `scripts/docs/gen-tour-anchors.mjs` from the React source): every step of
//! a composed tour is validated against it — unknown spotlight anchors,
//! sidebar sections, or sub-tab setters reject the WHOLE tour before it is
//! ever persisted or played. A tour that silently skipped hallucinated
//! chapters would teach wrong, so validation is all-or-nothing.
//!
//! Persistence: `companion_tours` (one row per composed tour, steps as JSON).
//! `manifest_hash` records which manifest a tour was proven against;
//! `list_tours` re-proves rows against the current manifest on app upgrade
//! and flips drifted ones to `status='stale'` instead of letting them break
//! (runtime `highlightMissing` degradation covers the rest).

use chrono::Utc;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::companion::brain::oneshot;
use crate::companion::brain::util;
use crate::companion::generated_tour_anchors::{
    TOUR_SIDEBAR_SECTIONS, TOUR_SUBTAB_SETTERS, TOUR_TESTIDS, TOUR_TESTID_DYNAMIC_PREFIXES,
};
use crate::db::UserDbPool;
use crate::error::AppError;

/// The single completion event every composed step advances on. Mirrors
/// `COMPOSED_STEP_EVENT` in `src/stores/slices/system/dynamicTours.ts` and
/// the `tour:composed-step-explored` entry in `tourSlice.ts` TOUR_EVENTS.
const COMPOSED_STEP_EVENT: &str = "tour:composed-step-explored";

const MIN_STEPS: usize = 1;
const MAX_STEPS: usize = 12;
const MAX_SUB_STEPS: usize = 6;
const MAX_TEXT: usize = 600;
const COMPOSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(150);

/// A persisted composed tour, serialized for the frontend
/// (`ComposedTourRecord` in `dynamicTours.ts`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposedTourRecord {
    pub id: String,
    pub topic: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    /// Serialized, VALIDATED steps array (frontend re-validates on ingest).
    pub steps_json: String,
    /// `ready` | `stale` (anchor manifest drifted since composition).
    pub status: String,
    pub created_at: String,
}

/// Hash of the current anchor manifest — stamped on every validated tour so
/// upgrades can cheaply detect which tours need re-proving.
pub fn manifest_hash() -> String {
    let mut joined = String::new();
    for list in [
        TOUR_TESTIDS,
        TOUR_TESTID_DYNAMIC_PREFIXES,
        TOUR_SIDEBAR_SECTIONS,
        TOUR_SUBTAB_SETTERS,
    ] {
        for s in list {
            joined.push_str(s);
            joined.push('\n');
        }
    }
    util::sha256_hex(&joined)
}

// -- validation -----------------------------------------------------------

fn is_testid_charset(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Anchor is known when declared verbatim in the manifest or under a dynamic
/// `data-testid={`prefix-${…}`}` template prefix.
fn is_known_anchor(anchor: &str) -> bool {
    if !is_testid_charset(anchor) {
        return false;
    }
    if TOUR_TESTIDS.contains(&anchor) {
        return true;
    }
    TOUR_TESTID_DYNAMIC_PREFIXES
        .iter()
        .any(|p| anchor.len() > p.len() && anchor.starts_with(p))
}

fn clean_text(v: Option<&Value>, max: usize) -> Option<String> {
    let s = v?.as_str()?.trim();
    if s.is_empty() || s.len() > max {
        return None;
    }
    Some(s.to_string())
}

/// Validate one raw step into the normalized `TourStepDef` JSON shape the
/// frontend plays. Errors name the offending path so a rejected compose is
/// debuggable from the warning alone.
fn validate_step(raw: &Value, index: usize) -> Result<Value, String> {
    let path = format!("steps[{index}]");
    let obj = raw
        .as_object()
        .ok_or_else(|| format!("{path}: not an object"))?;

    let title =
        clean_text(obj.get("title"), 160).ok_or_else(|| format!("{path}: missing title"))?;
    let description = clean_text(obj.get("description"), MAX_TEXT)
        .ok_or_else(|| format!("{path}: missing description"))?;
    let hint = clean_text(obj.get("hint"), MAX_TEXT).unwrap_or_default();
    let id =
        clean_text(obj.get("id"), 80).unwrap_or_else(|| format!("composed-step-{}", index + 1));

    let nav = obj
        .get("nav")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("{path}: missing nav"))?;
    let section = clean_text(nav.get("sidebarSection"), 40)
        .ok_or_else(|| format!("{path}: missing nav.sidebarSection"))?;
    if !TOUR_SIDEBAR_SECTIONS.contains(&section.as_str()) {
        return Err(format!("{path}: unknown sidebarSection `{section}`"));
    }
    let mut nav_out = serde_json::json!({ "sidebarSection": section });
    if let Some(setter) = clean_text(nav.get("subTabSetter"), 40) {
        if !TOUR_SUBTAB_SETTERS.contains(&setter.as_str()) {
            return Err(format!("{path}: unknown subTabSetter `{setter}`"));
        }
        let sub_tab = clean_text(nav.get("subTab"), 60)
            .ok_or_else(|| format!("{path}: subTabSetter without subTab"))?;
        nav_out["subTabSetter"] = Value::String(setter);
        nav_out["subTab"] = Value::String(sub_tab);
    }

    let mut out = serde_json::json!({
        "id": id.clone(),
        "title": title,
        "description": description,
        "hint": hint,
        "nav": nav_out,
        "completeOn": COMPOSED_STEP_EVENT,
        "subSteps": [],
    });

    if let Some(anchor) = clean_text(obj.get("highlightTestId"), 120) {
        if !is_known_anchor(&anchor) {
            return Err(format!("{path}: unknown anchor `{anchor}`"));
        }
        out["highlightTestId"] = Value::String(anchor);
    }
    if let Some(narration) = clean_text(obj.get("narration"), MAX_TEXT) {
        out["narration"] = Value::String(narration);
    }

    if let Some(subs) = obj.get("subSteps").and_then(|v| v.as_array()) {
        let mut sub_out = Vec::new();
        for (i, sub) in subs.iter().take(MAX_SUB_STEPS).enumerate() {
            let spath = format!("{path}.subSteps[{i}]");
            let sobj = sub
                .as_object()
                .ok_or_else(|| format!("{spath}: not an object"))?;
            let sid =
                clean_text(sobj.get("id"), 80).unwrap_or_else(|| format!("{id}-sub-{}", i + 1));
            let label = clean_text(sobj.get("label"), 160)
                .ok_or_else(|| format!("{spath}: missing label"))?;
            let shint = clean_text(sobj.get("hint"), MAX_TEXT).unwrap_or_default();
            let mut s = serde_json::json!({ "id": sid, "label": label, "hint": shint });
            if let Some(anchor) = clean_text(sobj.get("highlightTestId"), 120) {
                if !is_known_anchor(&anchor) {
                    return Err(format!("{spath}: unknown anchor `{anchor}`"));
                }
                s["highlightTestId"] = Value::String(anchor);
            }
            sub_out.push(s);
        }
        out["subSteps"] = Value::Array(sub_out);
    }
    Ok(out)
}

/// Validate a composed-tour spec (`{ title, description?, steps: [...] }`)
/// against the anchor manifest. All-or-nothing: ANY unknown anchor / nav
/// target rejects the whole tour. Returns `(title, description, steps)` with
/// steps normalized to the frontend `TourStepDef` shape.
pub fn validate_tour_spec(spec: &Value) -> Result<(String, String, Vec<Value>), String> {
    let obj = spec.as_object().ok_or("spec is not an object")?;
    let title = clean_text(obj.get("title"), 160).ok_or("missing title")?;
    let description = clean_text(obj.get("description"), MAX_TEXT).unwrap_or_default();
    let raw_steps = obj
        .get("steps")
        .and_then(|v| v.as_array())
        .ok_or("missing `steps` array")?;
    if raw_steps.len() < MIN_STEPS || raw_steps.len() > MAX_STEPS {
        return Err(format!(
            "{} steps (expected {MIN_STEPS}-{MAX_STEPS})",
            raw_steps.len()
        ));
    }
    let mut steps = Vec::with_capacity(raw_steps.len());
    for (i, raw) in raw_steps.iter().enumerate() {
        steps.push(validate_step(raw, i)?);
    }
    Ok((title, description, steps))
}

// -- persistence ----------------------------------------------------------

/// Insert a validated tour. `steps` MUST come from `validate_tour_spec`.
pub fn save_tour(
    pool: &UserDbPool,
    topic: &str,
    title: &str,
    description: &str,
    steps: &[Value],
) -> Result<ComposedTourRecord, AppError> {
    let id = format!("athena-{}", Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let steps_json = serde_json::to_string(steps)
        .map_err(|e| AppError::Internal(format!("serialize tour steps: {e}")))?;
    let hash = manifest_hash();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_tours (id, topic, title, description, icon, color, steps_json, status, manifest_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'Sparkles', 'violet', ?5, 'ready', ?6, ?7, ?7)",
        params![id, topic, title, description, steps_json, hash, now],
    )?;
    Ok(ComposedTourRecord {
        id,
        topic: topic.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        icon: "Sparkles".to_string(),
        color: "violet".to_string(),
        steps_json,
        status: "ready".to_string(),
        created_at: now,
    })
}

/// List composed tours (newest first), re-proving any row whose
/// `manifest_hash` no longer matches the current manifest: still-valid rows
/// are re-stamped `ready`, drifted ones flipped to `stale` (shown in the
/// Learning timeline with an "outdated" note instead of breaking mid-play).
pub fn list_tours(pool: &UserDbPool) -> Result<Vec<ComposedTourRecord>, AppError> {
    let current_hash = manifest_hash();
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, topic, title, description, icon, color, steps_json, status, manifest_hash, created_at
         FROM companion_tours ORDER BY created_at DESC LIMIT 100",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                ComposedTourRecord {
                    id: r.get(0)?,
                    topic: r.get(1)?,
                    title: r.get(2)?,
                    description: r.get(3)?,
                    icon: r.get(4)?,
                    color: r.get(5)?,
                    steps_json: r.get(6)?,
                    status: r.get(7)?,
                    created_at: r.get(9)?,
                },
                r.get::<_, Option<String>>(8)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut out = Vec::with_capacity(rows.len());
    for (mut rec, row_hash) in rows {
        if row_hash.as_deref() != Some(current_hash.as_str()) {
            // Manifest drifted since this tour was proven — re-prove now.
            let revalidated = serde_json::from_str::<Value>(&rec.steps_json)
                .ok()
                .map(|steps| {
                    validate_tour_spec(&serde_json::json!({
                        "title": rec.title,
                        "description": rec.description,
                        "steps": steps,
                    }))
                    .is_ok()
                })
                .unwrap_or(false);
            rec.status = if revalidated { "ready" } else { "stale" }.to_string();
            let _ = conn.execute(
                "UPDATE companion_tours SET status = ?1, manifest_hash = ?2, updated_at = ?3 WHERE id = ?4",
                params![rec.status, current_hash, Utc::now().to_rfc3339(), rec.id],
            );
        }
        out.push(rec);
    }
    Ok(out)
}

// -- composition (one-shot Claude call) -----------------------------------

fn compose_prompt(topic: &str, summary: &str) -> String {
    let mut p = String::with_capacity(32_000);
    p.push_str(
        "You are Athena, the in-app companion of the Personas desktop app, authoring a guided \
         spotlight walkthrough of the REAL running app. The tour engine navigates the app per \
         step, rings one on-screen element per step/sub-step by its `data-testid`, and speaks \
         your narration aloud.\n\n",
    );
    p.push_str(&format!("# The user asked to be shown: {topic}\n"));
    if !summary.is_empty() {
        p.push_str(&format!("# Context: {summary}\n"));
    }
    p.push_str("\n# Navigation vocabulary (nav.sidebarSection MUST be one of):\n");
    p.push_str(&TOUR_SIDEBAR_SECTIONS.join(", "));
    p.push_str("\n\n# Optional nav.subTabSetter (MUST be one of, and requires nav.subTab):\n");
    p.push_str(&TOUR_SUBTAB_SETTERS.join(", "));
    p.push_str("\n\n# Spotlight anchors — every highlightTestId MUST be from this list");
    p.push_str(" (or start with one of the dynamic prefixes below):\n");
    p.push_str(&TOUR_TESTIDS.join("\n"));
    p.push_str("\n\n# Dynamic anchor prefixes (anchor may be `<prefix><suffix>`):\n");
    p.push_str(&TOUR_TESTID_DYNAMIC_PREFIXES.join("\n"));
    p.push_str(
        "\n\n# Rules\n\
         - 3 to 7 steps. Each step: `id` (kebab-case), `title` (<=60 chars), `description` \
           (2-3 sentences, on-screen text), `hint` (what to do), `nav` \
           ({\"sidebarSection\": ..., optional \"subTabSetter\" + \"subTab\"}), optional \
           `highlightTestId` (from the allow-list — NEVER invent one; omit if unsure), optional \
           `narration` (1-3 conversational sentences written for the ear, first person, \
           operational — you are teaching, never acting), optional `subSteps` \
           (0-4 of {\"id\", \"label\", \"hint\", optional \"highlightTestId\"}).\n\
         - TEACH, never act: describe what the user does; the tour must not imply you will do it.\n\
         - Prefer route-level anchors that are certainly on screen after the step's nav.\n\
         - Emit ONLY a JSON object: {\"title\": ..., \"description\": ..., \"steps\": [...]}. \
           No prose, no markdown, no code fences. Start with `{` and end with `}`.\n",
    );
    p
}

/// Compose a tour for `topic` via a one-shot Claude call, validate every step
/// against the anchor manifest, and persist it. Returns the stored record.
/// Rejection (hallucinated anchor, bad shape) surfaces as an error — the
/// frontend shows the honest failure state and offers the chat explanation
/// path instead; a half-proven tour is never stored.
pub async fn compose_tour(
    pool: &UserDbPool,
    topic: &str,
    summary: &str,
) -> Result<ComposedTourRecord, AppError> {
    let prompt = compose_prompt(topic, summary);
    let text = oneshot::call_claude_text(
        pool,
        &prompt,
        crate::companion::model_routing::MAIN.model,
        oneshot::leg::TOURS,
        COMPOSE_TIMEOUT,
    )
    .await?;
    let json = oneshot::extract_json_span(&text, "compose_tour reply")?;
    let spec: Value = serde_json::from_str(json).map_err(|e| {
        AppError::Internal(format!(
            "compose_tour reply not valid JSON: {e}; got: {}",
            oneshot::preview(json, 400)
        ))
    })?;
    let (title, description, steps) = validate_tour_spec(&spec)
        .map_err(|e| AppError::Internal(format!("compose_tour rejected: {e}")))?;
    save_tour(pool, topic, &title, &description, &steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known_testid() -> &'static str {
        TOUR_TESTIDS
            .first()
            .copied()
            .expect("generated manifest must not be empty")
    }

    fn valid_spec() -> Value {
        serde_json::json!({
            "title": "Meet the schedules dashboard",
            "description": "Where every cron-driven agent lives.",
            "steps": [
                {
                    "id": "open-schedules",
                    "title": "Open Schedules",
                    "description": "The schedules dashboard lists every timed trigger.",
                    "hint": "Look at the list.",
                    "nav": { "sidebarSection": "schedules" },
                    "highlightTestId": known_testid(),
                    "narration": "Here is where your schedules live.",
                    "subSteps": []
                }
            ]
        })
    }

    #[test]
    fn accepts_valid_spec_and_forces_composed_complete_on() {
        let (title, _desc, steps) = validate_tour_spec(&valid_spec()).unwrap();
        assert_eq!(title, "Meet the schedules dashboard");
        assert_eq!(steps.len(), 1);
        assert_eq!(
            steps[0].get("completeOn").and_then(|v| v.as_str()),
            Some(COMPOSED_STEP_EVENT),
            "every composed step must advance on the acknowledge event"
        );
    }

    #[test]
    fn rejects_unknown_anchor() {
        let mut spec = valid_spec();
        spec["steps"][0]["highlightTestId"] =
            Value::String("totally-hallucinated-anchor-xyz".into());
        let err = validate_tour_spec(&spec).unwrap_err();
        assert!(err.contains("unknown anchor"), "got: {err}");
    }

    #[test]
    fn rejects_unknown_sidebar_section() {
        let mut spec = valid_spec();
        spec["steps"][0]["nav"]["sidebarSection"] = Value::String("not-a-section".into());
        let err = validate_tour_spec(&spec).unwrap_err();
        assert!(err.contains("unknown sidebarSection"), "got: {err}");
    }

    #[test]
    fn rejects_unknown_subtab_setter() {
        let mut spec = valid_spec();
        spec["steps"][0]["nav"]["subTabSetter"] = Value::String("setEvilTab".into());
        spec["steps"][0]["nav"]["subTab"] = Value::String("x".into());
        let err = validate_tour_spec(&spec).unwrap_err();
        assert!(err.contains("unknown subTabSetter"), "got: {err}");
    }

    #[test]
    fn rejects_selector_breakout_charset() {
        let mut spec = valid_spec();
        spec["steps"][0]["highlightTestId"] = Value::String("a\"]{}".into());
        assert!(validate_tour_spec(&spec).is_err());
    }

    #[test]
    fn rejects_empty_and_oversized_step_lists() {
        let mut spec = valid_spec();
        spec["steps"] = Value::Array(vec![]);
        assert!(validate_tour_spec(&spec).is_err());

        let step = valid_spec()["steps"][0].clone();
        let mut spec = valid_spec();
        spec["steps"] = Value::Array(vec![step; MAX_STEPS + 1]);
        assert!(validate_tour_spec(&spec).is_err());
    }

    #[test]
    fn rejects_bad_anchor_in_sub_step() {
        let mut spec = valid_spec();
        spec["steps"][0]["subSteps"] = serde_json::json!([
            { "id": "s1", "label": "Look here", "hint": "", "highlightTestId": "nope-not-real-anchor-zz" }
        ]);
        // Only fails if that string is genuinely absent from the manifest —
        // it is not a declared testid and matches no prefix with remainder.
        if !is_known_anchor("nope-not-real-anchor-zz") {
            assert!(validate_tour_spec(&spec).is_err());
        }
    }

    #[test]
    fn accepts_dynamic_prefix_anchor() {
        if let Some(prefix) = TOUR_TESTID_DYNAMIC_PREFIXES.first() {
            let anchor = format!("{prefix}some-suffix");
            assert!(is_known_anchor(&anchor));
        }
    }

    #[test]
    fn manifest_hash_is_stable() {
        assert_eq!(manifest_hash(), manifest_hash());
        // `util::sha256_hex` returns the ALGORITHM-PREFIXED form — `sha256:`
        // plus 64 hex chars = 71. This assertion said 64 and had been failing
        // since `f7993851d`, the refactor that deduped the brain string
        // helpers and gave the shared helper its prefix (which `util.rs`'s own
        // `sha256_hex_is_stable_and_prefixed` pins as intentional). Assert the
        // prefix as well as the length, so the next change to either half has
        // to come past this test rather than around it.
        let hash = manifest_hash();
        assert!(
            hash.starts_with("sha256:"),
            "expected a prefixed digest, got {hash}"
        );
        assert_eq!(hash.len(), "sha256:".len() + 64);
    }
}
