//! Dev-only preview-agent injection for the precise orb pointer (A3). The preview
//! iframe is cross-origin (the dev server on its own port), so the host can't read
//! element positions inside it. We bake a tiny client agent into the generated app
//! that answers a `postMessage` "locate <selector>" with the element's bounding
//! rect (and briefly outlines it), and reports the element the user right-clicks
//! (or clicks in pick mode) so Studio can queue a change aimed at it. Injected
//! on every dev-server start; idempotent and best-effort — if a non-standard
//! layout can't be patched, the orb pointer simply falls back to coarse-region
//! anchoring.

use std::path::Path;

/// The agent component, written verbatim into the project. It lives as a real
/// `.tsx` file so it is type-shaped and unit-tested (the Studio preview-agent
/// test renders it in jsdom). It does nothing in a production build.
const AGENT_TSX: &str = include_str!("athena_preview_agent.tsx");

/// Ensure the preview agent exists + is mounted in the project's root layout.
/// Idempotent + best-effort: never errors out the dev-server start.
pub fn ensure(project_dir: &Path) {
    let app = ["app", "src/app"]
        .iter()
        .map(|b| project_dir.join(b))
        .find(|p| p.is_dir());
    let Some(app) = app else { return };

    let agent_path = app.join("_athena-preview-agent.tsx");
    // Refresh when absent OR stale, so existing projects pick up agent upgrades
    // (e.g. route reporting) on their next dev-server start. It's a tool-owned,
    // dev-gated file users don't edit, so rewriting it is safe.
    let needs_write = match std::fs::read_to_string(&agent_path) {
        Ok(existing) => existing != AGENT_TSX,
        Err(_) => true,
    };
    if needs_write {
        let _ = std::fs::write(&agent_path, AGENT_TSX);
    }

    let layout = app.join("layout.tsx");
    if let Ok(src) = std::fs::read_to_string(&layout) {
        if src.contains("AthenaPreviewAgent") {
            return; // already mounted
        }
        if let Some(patched) = patch_layout(&src) {
            let _ = std::fs::write(&layout, patched);
        }
    }
}

/// Insert the agent import + a dev-only render into a standard Next root layout.
/// Returns None when the anchors aren't found (caller leaves the file untouched).
fn patch_layout(src: &str) -> Option<String> {
    let import_line = "import { AthenaPreviewAgent } from \"./_athena-preview-agent\";\n";
    let render = "\n        {process.env.NODE_ENV === \"development\" && <AthenaPreviewAgent />}";
    let mut out = src.to_string();

    // Import: after the globals.css import line, else before the first `export`.
    if let Some(idx) = out.find("\"./globals.css\";") {
        let end = idx + "\"./globals.css\";".len();
        let nl = out[end..].find('\n').map(|n| end + n + 1).unwrap_or(end);
        out.insert_str(nl, import_line);
    } else {
        let idx = out.find("\nexport ")?;
        out.insert_str(idx + 1, import_line);
    }

    // Render: right after the opening <body ...> tag.
    let bidx = out.find("<body")?;
    let gt = out[bidx..].find('>')? + bidx + 1;
    out.insert_str(gt, render);
    Some(out)
}
