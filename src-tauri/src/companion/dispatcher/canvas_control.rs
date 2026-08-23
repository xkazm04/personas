//! Validation for the `canvas_control` op: the one place a proposed canvas
//! action is checked against the kind/band/category allow-lists before it is
//! allowed to drive the canvas.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

use super::types::{CANVAS_CONTROL_BANDS, CANVAS_CONTROL_CATEGORIES, CANVAS_CONTROL_KINDS};

/// Write a System episode recording that this turn's `use_connector`
/// op was rejected at dispatch time. The episode lands in the brain
/// before Athena's next turn assembles its prompt, so she sees it in
/// recall and can self-correct ("my last use_connector got dropped
/// because X — let me acknowledge that to the user or propose an
/// alternative") instead of doubling down on the silent failure.
///
/// Best-effort: if the insert itself fails, we swallow the error so
/// the dispatcher path isn't blocked. A failed insert turns this back
/// into the pre-fix silent-drop, which is no worse than what we had.
/// Validate a `canvas_control` op's params into the exact action JSON the
/// frontend grammar (`canvasActionStore.ts`) accepts. Fail-closed and
/// specific: every error string lands in Athena's next-turn context, so it
/// names what to fix. Only validated fields survive into the output — an
/// invented param never reaches the frontend.
pub(super) fn validate_canvas_control(
    db: &crate::db::DbPool,
    params: &serde_json::Value,
) -> Result<String, String> {
    let action = params.get("action").ok_or(
        "missing `action` — pass the grammar object, e.g. \
         {\"kind\":\"camera.focus\",\"slug\":\"<canvas slug>\",\"band\":\"close\"}",
    )?;
    let kind = action.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "island.read" || kind == "dim.read" {
        return Err(format!(
            "`{kind}` has a faster path: `describe_canvas_project` answers from the \
             published scene without a frontend round-trip. Use that instead."
        ));
    }
    if !CANVAS_CONTROL_KINDS.contains(&kind) {
        return Err(format!(
            "unknown kind `{kind}` (expected one of {CANVAS_CONTROL_KINDS:?})"
        ));
    }
    let mut clean = serde_json::Map::new();
    clean.insert("kind".into(), serde_json::json!(kind));
    if let Some(band) = action.get("band") {
        let b = band.as_str().unwrap_or("");
        if !CANVAS_CONTROL_BANDS.contains(&b) {
            return Err(format!(
                "`band` must be one of {CANVAS_CONTROL_BANDS:?}, got `{b}`"
            ));
        }
        clean.insert("band".into(), band.clone());
    }
    match kind {
        "camera.pan" => {
            for axis in ["dx", "dy"] {
                let v = action
                    .get(axis)
                    .and_then(|v| v.as_f64())
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| format!("`camera.pan` needs a finite numeric `{axis}`"))?;
                clean.insert(axis.into(), serde_json::json!(v));
            }
            if let Some(u) = action.get("unit").and_then(|v| v.as_str()) {
                if u != "world" && u != "screen" {
                    return Err("`unit` must be `world` or `screen`".into());
                }
                clean.insert("unit".into(), serde_json::json!(u));
            }
        }
        "camera.zoom" => {
            let has_band = clean.contains_key("band");
            match action.get("factor").and_then(|v| v.as_f64()) {
                Some(f) if f.is_finite() && f > 0.0 => {
                    clean.insert("factor".into(), serde_json::json!(f));
                }
                Some(_) => return Err("`factor` must be a positive finite number".into()),
                None if has_band => {}
                None => return Err("`camera.zoom` needs `factor` or `band`".into()),
            }
        }
        "camera.focus" | "dim.open" | "category.open" | "island.menu" => {
            let slug = action.get("slug").and_then(|v| v.as_str()).unwrap_or("");
            let resolved = crate::companion::canvas::resolve_scene_slug(db, slug)?;
            clean.insert("slug".into(), serde_json::json!(resolved));
            if kind == "dim.open" {
                let key = action.get("key").and_then(|v| v.as_str()).unwrap_or("");
                if key.is_empty() || key.len() > 40 {
                    return Err("`dim.open` needs `key` — a dimension key you read from \
                         `describe_canvas_project` (db, monitoring, ci, …)"
                        .into());
                }
                clean.insert("key".into(), serde_json::json!(key));
                // `travel` stays at the grammar's default (true): steering the
                // view there is the point of opening the cell for the user.
            }
            if kind == "category.open" {
                let cat = action
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !CANVAS_CONTROL_CATEGORIES.contains(&cat) {
                    return Err(format!(
                        "`category.open` needs `category` ∈ {CANVAS_CONTROL_CATEGORIES:?}"
                    ));
                }
                clean.insert("category".into(), serde_json::json!(cat));
            }
        }
        "camera.fit" => {
            if let Some(slugs) = action.get("slugs") {
                let arr = slugs
                    .as_array()
                    .ok_or("`slugs` must be an array of canvas slugs")?;
                if arr.is_empty() || arr.len() > 12 {
                    return Err("`slugs` must carry 1-12 canvas slugs (omit it entirely to \
                         frame the whole portfolio)"
                        .into());
                }
                let mut resolved_list = Vec::with_capacity(arr.len());
                for s in arr {
                    let resolved =
                        crate::companion::canvas::resolve_scene_slug(db, s.as_str().unwrap_or(""))?;
                    resolved_list.push(serde_json::json!(resolved));
                }
                clean.insert("slugs".into(), serde_json::Value::Array(resolved_list));
            }
        }
        // camera.read carries nothing else.
        _ => {}
    }
    Ok(serde_json::Value::Object(clean).to_string())
}
