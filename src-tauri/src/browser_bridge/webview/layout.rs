//! The page host's rectangle — ported from athena-portable's `layout.rs`.
//!
//! Source: `C:\Users\kazda\kiro\athena-portable\apps\desktop\src-tauri\src\layout.rs`
//! at athena-portable `c5ec8ca`.
//!
//! **What changed in the port, and why.** athena-portable owns its whole
//! window: the chrome is a child webview, so `layout.rs` computes three
//! rectangles inside one window and Rust decides where the React tree ends and
//! the page begins. Personas does not own its window that way — `main` is a
//! `WebviewWindow` declared in `tauri.conf.json` (window + one webview), and
//! Tauri 2 gives a `WebviewWindow` no second child webview to put a page in.
//!
//! So the rect is not derived here, it is *reported*: React measures the
//! Browser > Webview page's content slot and calls
//! `browser_webview_set_viewport { x, y, width, height }` in LOGICAL pixels
//! relative to the main window's client area. This module turns that logical
//! rect into the PHYSICAL screen rect the `browser-host` window is moved to,
//! and remembers whether the route is showing at all.
//!
//! ```text
//!  main (WebviewWindow, the React tree)          browser-host (Window, owned by main)
//!  ┌────────────────────────────────────┐        ┌──────────────────────────┐
//!  │ sidebar │  Browser > Webview       │        │ page-<id>, the focused   │
//!  │         │  ┌────────────────────┐  │  ───▶  │ tab, full bleed          │
//!  │         │  │ the content slot   │  │        │                          │
//!  │         │  └────────────────────┘  │        └──────────────────────────┘
//!  └────────────────────────────────────┘        positioned in SCREEN coords
//! ```
//!
//! Every unfocused page is hidden rather than resized, exactly as in the
//! source: a background tab costs no layout.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize};

/// The label of the window that hosts the page webviews. Owned by `main`, so
/// it z-orders above it, moves to the back with it and dies with it.
pub const HOST_WINDOW: &str = "browser-host";

/// The main window's label — the one React runs in, and the one every rect is
/// measured against. Declared in `src-tauri/tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

/// The smallest host window we will ever ask for. A zero-sized webview is what
/// makes a page vanish and never come back (athena's own note), and Windows
/// refuses a zero-sized window outright.
const MIN_EDGE: f64 = 1.0;

/// The content slot React measured, in LOGICAL pixels, relative to the main
/// window's client area. Mirrors nothing on the TS side but the argument list
/// of `browser_webview_set_viewport`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Viewport {
    /// Clamp to something a window can actually be. React reports 0×0 for one
    /// frame while a route mounts, and a 0×0 host window is a host window the
    /// OS will not give back.
    fn sane(self) -> Self {
        Self {
            x: self.x,
            y: self.y,
            width: self.width.max(MIN_EDGE),
            height: self.height.max(MIN_EDGE),
        }
    }
}

/// Where the host window is, and whether the route that owns it is on screen.
///
/// `visible` is the route's answer, not the window's: React calls
/// `browser_webview_set_visible(false)` on nav-away, and the host window is
/// hidden until it says otherwise. A hidden host keeps its tabs — leaving the
/// route does not close anybody's page.
#[derive(Debug, Default)]
pub struct HostLayout {
    inner: Mutex<HostState>,
}

#[derive(Debug, Default)]
struct HostState {
    viewport: Option<Viewport>,
    visible: bool,
}

impl HostLayout {
    pub fn viewport(&self) -> Option<Viewport> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .viewport
    }

    pub fn set_viewport(&self, viewport: Viewport) {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .viewport = Some(viewport.sane());
    }

    pub fn visible(&self) -> bool {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).visible
    }

    pub fn set_visible(&self, visible: bool) {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).visible = visible;
    }

    /// Is there a page to show at all: the route is up AND it has told us where.
    pub fn shown(&self) -> bool {
        let state = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        state.visible && state.viewport.is_some()
    }
}

/// The arithmetic, with no window in it — which is what makes it testable.
///
/// `anchor` is the main window's CLIENT-AREA origin in physical screen
/// coordinates (`Window::inner_position`), `scale` its scale factor, and
/// `viewport` the logical rect React reported inside that client area.
///
/// Two conversions and one addition, and the easy one to miss is that the
/// anchor is already physical while the viewport is not: mixing them is a host
/// window that is right at 100% and a screen's width out at 150%.
pub fn host_rect(anchor: (i32, i32), scale: f64, viewport: Viewport) -> (i32, i32, u32, u32) {
    let viewport = viewport.sane();
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    (
        anchor.0 + (viewport.x * scale).round() as i32,
        anchor.1 + (viewport.y * scale).round() as i32,
        (viewport.width * scale).round().max(MIN_EDGE) as u32,
        (viewport.height * scale).round().max(MIN_EDGE) as u32,
    )
}

/// Re-lay the host window and its pages. Cheap and idempotent: "where is the
/// host, which page is visible, and how big" is the whole of what it decides,
/// and it is called on every viewport report, every tab change, every main
/// window move/resize and every route change.
pub fn apply(app: &AppHandle) {
    let Some(host) = app.get_window(HOST_WINDOW) else {
        return;
    };
    let layout = app.state::<HostLayout>();

    if !layout.shown() {
        let _ = host.hide();
        return;
    }
    let (Some(main), Some(viewport)) = (app.get_window(MAIN_WINDOW), layout.viewport()) else {
        let _ = host.hide();
        return;
    };
    // The client-area origin, not the frame's: `main` is undecorated today, so
    // the two agree — but a title bar tomorrow would move the whole page by its
    // height and nothing would say why.
    let anchor = match main.inner_position().or_else(|_| main.outer_position()) {
        Ok(p) => (p.x, p.y),
        Err(_) => return,
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let (x, y, w, h) = host_rect(anchor, scale, viewport);

    let _ = host.set_position(PhysicalPosition::new(x, y));
    let _ = host.set_size(PhysicalSize::new(w, h));

    // The page fills the host window. One rectangle, because the host window
    // IS the page slot — the chrome around it is React's, in the other window.
    let viewport = viewport.sane();
    for (label, focused) in app.state::<super::tabs::Tabs>().labels_with_focus() {
        let Some(webview) = app.get_webview(&label) else {
            continue;
        };
        if focused {
            let _ = webview.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = webview.set_size(LogicalSize::new(viewport.width, viewport.height));
            let _ = webview.show();
        } else {
            // Hidden, not resized: a background tab costs no layout.
            let _ = webview.hide();
        }
    }

    // Shown last, so the first frame the user sees is already in place rather
    // than a host window sliding from wherever it was left.
    if app.state::<super::tabs::Tabs>().focused().is_some() {
        let _ = host.show();
    } else {
        let _ = host.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f64, y: f64, w: f64, h: f64) -> Viewport {
        Viewport {
            x,
            y,
            width: w,
            height: h,
        }
    }

    #[test]
    fn the_host_sits_at_the_anchor_plus_the_scaled_viewport() {
        let (x, y, w, h) = host_rect((100, 50), 1.0, v(240.0, 80.0, 1000.0, 700.0));
        assert_eq!((x, y), (340, 130));
        assert_eq!((w, h), (1000, 700));
    }

    #[test]
    fn a_fractional_scale_factor_scales_the_offset_and_not_the_anchor() {
        // The anchor is already physical. Scaling it too is the bug that puts
        // the page a screen's width away on a 150% display.
        let (x, y, w, h) = host_rect((100, 50), 1.5, v(240.0, 80.0, 1000.0, 700.0));
        assert_eq!((x, y), (100 + 360, 50 + 120));
        assert_eq!((w, h), (1500, 1050));
    }

    #[test]
    fn a_zero_sized_viewport_still_produces_a_real_window() {
        // React reports 0x0 for one frame while the route mounts, and a 0x0
        // window is one the OS will not hand back.
        let (_, _, w, h) = host_rect((0, 0), 2.0, v(0.0, 0.0, 0.0, 0.0));
        assert!(w >= 1 && h >= 1);
    }

    #[test]
    fn a_nonsense_scale_factor_is_treated_as_one() {
        assert_eq!(
            host_rect((10, 10), 0.0, v(5.0, 5.0, 100.0, 100.0)),
            host_rect((10, 10), 1.0, v(5.0, 5.0, 100.0, 100.0))
        );
        assert_eq!(
            host_rect((10, 10), f64::NAN, v(5.0, 5.0, 100.0, 100.0)),
            host_rect((10, 10), 1.0, v(5.0, 5.0, 100.0, 100.0))
        );
    }

    #[test]
    fn a_negative_viewport_offset_is_carried_through_rather_than_clamped() {
        // A slot scrolled above the window's top edge is a real state, and the
        // honest host window for it is one that is partly off the top.
        let (x, y, _, _) = host_rect((0, 0), 1.0, v(-40.0, -20.0, 100.0, 100.0));
        assert_eq!((x, y), (-40, -20));
    }

    #[test]
    fn nothing_is_shown_until_the_route_reports_both_halves() {
        let layout = HostLayout::default();
        assert!(!layout.shown(), "a fresh layout has no page");

        layout.set_visible(true);
        assert!(
            !layout.shown(),
            "visible with no rect is still nothing to show"
        );

        layout.set_viewport(v(0.0, 0.0, 800.0, 600.0));
        assert!(layout.shown());

        layout.set_visible(false);
        assert!(!layout.shown(), "leaving the route hides the host");
        assert!(
            layout.viewport().is_some(),
            "and it remembers where to come back to"
        );
    }

    #[test]
    fn a_reported_viewport_is_stored_already_clamped() {
        let layout = HostLayout::default();
        layout.set_viewport(v(10.0, 10.0, 0.0, -5.0));
        let stored = layout.viewport().expect("stored");
        assert!(stored.width >= MIN_EDGE && stored.height >= MIN_EDGE);
    }
}
