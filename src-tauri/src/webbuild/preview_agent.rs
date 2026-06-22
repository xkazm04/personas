//! Dev-only preview-agent injection for the precise orb pointer (A3). The preview
//! iframe is cross-origin (the dev server on its own port), so the host can't read
//! element positions inside it. We bake a tiny client agent into the generated app
//! that answers a `postMessage` "locate <selector>" with the element's bounding
//! rect (and briefly outlines it). Injected on every dev-server start; idempotent
//! and best-effort — if a non-standard layout can't be patched, the orb pointer
//! simply falls back to coarse-region anchoring.

use std::path::Path;

/// The agent component, written verbatim into the project. Dev-gated at runtime
/// (`process.env.NODE_ENV`) so it's tree-shaken out of production builds.
const AGENT_TSX: &str = r##""use client";
import { useEffect } from "react";

// Dev-only bridge for Athena Studio. The host postMessages
// {source:"athena", type:"locate", selector, reqId}; we reply to the parent with
// the element's bounding rect (this frame's viewport) and briefly outline it.
type Rect = { x: number; y: number; width: number; height: number };

export function AthenaPreviewAgent() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let ring: HTMLDivElement | null = null;
    const clear = () => {
      if (ring) {
        ring.remove();
        ring = null;
      }
    };
    const highlight = (r: DOMRect) => {
      clear();
      ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        border: "2px solid #2dd4bf",
        borderRadius: "8px",
        boxShadow: "0 0 0 4px rgba(45,212,191,0.25)",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.appendChild(ring);
      window.setTimeout(clear, 2600);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { source?: string; type?: string; selector?: string; reqId?: string }
        | null;
      if (!d || d.source !== "athena" || d.type !== "locate") return;
      let el: Element | null = null;
      try {
        el = d.selector ? document.querySelector(d.selector) : null;
      } catch {
        el = null;
      }
      const send = (rect: Rect | null, found: boolean) =>
        window.parent?.postMessage(
          { source: "athena-agent", type: "located", reqId: d.reqId, selector: d.selector, found, rect },
          "*",
        );
      if (!el) {
        send(null, false);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        const r = (el as Element).getBoundingClientRect();
        highlight(r);
        send({ x: r.x, y: r.y, width: r.width, height: r.height }, true);
      }, 350);
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
      clear();
    };
  }, []);
  return null;
}
"##;

/// Ensure the preview agent exists + is mounted in the project's root layout.
/// Idempotent + best-effort: never errors out the dev-server start.
pub fn ensure(project_dir: &Path) {
    let app = ["app", "src/app"]
        .iter()
        .map(|b| project_dir.join(b))
        .find(|p| p.is_dir());
    let Some(app) = app else { return };

    let agent_path = app.join("_athena-preview-agent.tsx");
    if !agent_path.exists() {
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
    let render =
        "\n        {process.env.NODE_ENV === \"development\" && <AthenaPreviewAgent />}";
    let mut out = src.to_string();

    // Import: after the globals.css import line, else before the first `export`.
    if let Some(idx) = out.find("\"./globals.css\";") {
        let end = idx + "\"./globals.css\";".len();
        let nl = out[end..].find('\n').map(|n| end + n + 1).unwrap_or(end);
        out.insert_str(nl, import_line);
    } else if let Some(idx) = out.find("\nexport ") {
        out.insert_str(idx + 1, import_line);
    } else {
        return None;
    }

    // Render: right after the opening <body ...> tag.
    let bidx = out.find("<body")?;
    let gt = out[bidx..].find('>')? + bidx + 1;
    out.insert_str(gt, render);
    Some(out)
}
