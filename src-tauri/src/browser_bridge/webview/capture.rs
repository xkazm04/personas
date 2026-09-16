//! The screenshot behind a gated proposal — ported from athena-portable's
//! `capture.rs`.
//!
//! Source: `C:\Users\kazda\kiro\athena-portable\apps\desktop\src-tauri\src\capture.rs`
//! at athena-portable `c5ec8ca`.
//!
//! A person asked to approve `browser_click` on a ref cannot judge it from the
//! ref. What they can judge is the page. So before a gated hand is proposed the
//! shell captures the host window, crops it to the page, files the PNG, and the
//! approval carries its id.
//!
//! **Why the window and not the webview.** Neither Tauri nor `wry` exposes a
//! webview capture, and WebView2's own `CapturePreview` is not reachable
//! through either. What is reachable is the OS — so the `browser-host` window
//! is captured. In Personas that window IS the page slot (the React chrome is
//! in the other window), so the crop the source needed to cut a tab strip off
//! is here only the window frame's inset, which is zero while the host stays
//! undecorated. The arithmetic is kept anyway, and tested, because "undecorated"
//! is a line in [`super::host`] that somebody will one day change.
//!
//! **What changed in the port, and why.** athena-portable calls `PrintWindow`
//! with `PW_RENDERFULLCONTENT` through `windows-sys` by hand. Personas already
//! ships `xcap` (a `desktop`/`test-automation` dependency, used by
//! `test_automation.rs:447`), and `xcap-0.7.1/src/windows/capture.rs:177` makes
//! the same `PrintWindow(hwnd, hdc, PRINT_WINDOW_FLAGS(2))` call — the flag
//! that makes a hardware-composited webview draw itself, and the whole reason
//! the source refused a plain screen grab. So the port reuses the primitive
//! this repo already has rather than adding `windows-sys` + `png` and 120 lines
//! of unsafe FFI for the same syscall (`.claude/rules/rust-backend.md`: reach
//! for the existing primitive; a new abstraction must retire three copies).
//!
//! **Windows in practice, stated rather than hidden.** `xcap` compiles on all
//! three desktops; whether `capture_image` on a composited webview returns
//! pixels rather than black is a Windows-verified claim only. A platform that
//! cannot answer gets a `UnsupportedPlatform` refusal naming itself, so a card
//! elsewhere is a card with no picture rather than a call that panics.

use super::super::backend::{Refusal, RefusalCode};

/// What one capture is, before it reaches disk.
pub struct Shot {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Crop a top-down RGBA image. `None` when the rectangle is not wholly inside —
/// clamping would hand back a picture of somewhere other than the page, and a
/// card whose picture is of the wrong thing is worse than a card with none.
pub fn crop(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || x.checked_add(w)? > width || y.checked_add(h)? > height {
        return None;
    }
    if rgba.len() < (width as usize) * (height as usize) * 4 {
        return None;
    }
    let mut out = Vec::with_capacity((w as usize) * (h as usize) * 4);
    for row in y..y + h {
        let start = ((row as usize) * (width as usize) + x as usize) * 4;
        out.extend_from_slice(&rgba[start..start + (w as usize) * 4]);
    }
    Some(out)
}

/// The page's rectangle inside the window bitmap, in PHYSICAL pixels.
///
/// The bitmap is the whole window, frame included; the page is the client area
/// inside it. On Windows 11 that frame is a couple of logical pixels, which is
/// exactly small enough to look like a slightly wrong picture rather than an
/// obviously wrong one — athena's first smoke run came back with a black band
/// down the left edge. `inset` is the client area's offset within the window,
/// which the caller reads off the window itself.
///
/// `None` when the client area does not fit inside the bitmap, which means the
/// two were measured at different moments (a resize mid-capture).
pub fn page_rect_physical(
    window: (u32, u32),
    client: (u32, u32),
    inset: (i32, i32),
) -> Option<(u32, u32, u32, u32)> {
    let x = inset.0.max(0) as u32;
    let y = inset.1.max(0) as u32;
    let w = client.0.max(1);
    let h = client.1.max(1);
    (x + w <= window.0 && y + h <= window.1).then_some((x, y, w, h))
}

/// Capture the focused page of the `browser-host` window.
#[cfg(feature = "desktop")]
pub fn capture(app: &tauri::AppHandle) -> Result<Shot, Refusal> {
    use tauri::Manager;

    let window = app.get_window(super::layout::HOST_WINDOW).ok_or_else(|| {
        Refusal::new(RefusalCode::ValidatorFailed)
            .with_hint("no page host window is open; call browser_tabs and open a tab")
    })?;
    // The bitmap's own dimensions come back with the bitmap (xcap measures the
    // window it captured), so `outer_size` is not asked for: two measurements of
    // the same window taken a frame apart are how a crop lands on the wrong
    // pixels.
    let client = window.inner_size().map_err(would_not_say)?;
    let inset = match (window.inner_position(), window.outer_position()) {
        (Ok(inner), Ok(whole)) => (inner.x - whole.x, inner.y - whole.y),
        // A window that will not say where it is gets no offset rather than no
        // picture: the crop is then a frame's width out, which is a slightly
        // wrong picture and is still better evidence than none.
        _ => (0, 0),
    };

    let image = host_bitmap(&window)?;
    let (shot_w, shot_h) = (image.width(), image.height());
    let rgba = image.into_raw();

    // A rounding error at a fractional scale factor can put the rectangle one
    // pixel outside — in which case the whole window is a worse picture than
    // none, so it is the whole window.
    match page_rect_physical((shot_w, shot_h), (client.width, client.height), inset)
        .and_then(|(x, y, w, h)| crop(&rgba, shot_w, shot_h, x, y, w, h).map(|px| (px, w, h)))
    {
        Some((rgba, width, height)) => Ok(Shot {
            rgba,
            width,
            height,
        }),
        None => Ok(Shot {
            rgba,
            width: shot_w,
            height: shot_h,
        }),
    }
}

#[cfg(not(feature = "desktop"))]
pub fn capture(_app: &tauri::AppHandle) -> Result<Shot, Refusal> {
    Err(Refusal::new(RefusalCode::UnsupportedPlatform)
        .with_hint("this build has no screen capture; continue with browser_snapshot"))
}

#[cfg(feature = "desktop")]
fn would_not_say(e: tauri::Error) -> Refusal {
    Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!(
        "the page host window would not say where it is: {e}"
    ))
}

/// The host window's own pixels, through the primitive this repo already ships.
///
/// Matched by pid AND title rather than by title alone: two Personas instances
/// (the operator's and an isolated QA one) have the same window titles, and a
/// card carrying the other instance's page is exactly the "picture of somewhere
/// else" this whole file exists to prevent.
#[cfg(feature = "desktop")]
fn host_bitmap(window: &tauri::Window) -> Result<image::RgbaImage, Refusal> {
    let title = window.title().unwrap_or_default();
    let me = std::process::id();

    let windows = xcap::Window::all().map_err(|e| {
        Refusal::new(RefusalCode::UnsupportedPlatform)
            .with_hint(format!("this platform would not list its windows: {e}"))
    })?;
    let hit = windows
        .iter()
        .find(|w| {
            w.pid().map(|p| p == me).unwrap_or(false)
                && w.title().map(|t| t == title).unwrap_or(false)
        })
        .ok_or_else(|| {
            Refusal::new(RefusalCode::ValidatorFailed)
                .with_hint("the page host window is not on screen to capture")
        })?;
    hit.capture_image().map_err(|e| {
        Refusal::new(RefusalCode::ValidatorFailed)
            .with_hint(format!("the page host window refused to draw itself: {e}"))
    })
}

/// File a capture and answer with its id.
///
/// The id is the PNG's path under the app data dir. A `browser_captures` row
/// would be the better id — it is what WP3's decision card will want — but the
/// table is WP1's to add, and a path is an id the card can already render
/// through the asset protocol (`$APPDATA/**` is in `tauri.conf.json`'s
/// `assetProtocol.scope`).
#[cfg(feature = "desktop")]
pub fn file(app: &tauri::AppHandle, tab: u32, shot: &Shot) -> Result<String, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("browser-captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    let name = format!("tab{tab}-{}.png", uuid::Uuid::new_v4().simple());
    let path = dir.join(&name);
    let image: image::RgbaImage =
        image::ImageBuffer::from_raw(shot.width, shot.height, shot.rgba.clone())
            .ok_or_else(|| "the capture's pixels do not fill its rectangle".to_string())?;
    image
        .save(&path)
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(not(feature = "desktop"))]
pub fn file(_app: &tauri::AppHandle, _tab: u32, _shot: &Shot) -> Result<String, String> {
    Err("this build has no screen capture".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.iter()
            .copied()
            .cycle()
            .take((width * height * 4) as usize)
            .collect()
    }

    #[test]
    fn a_crop_takes_the_rectangle_asked_for() {
        // Two rows of two pixels; the second row's second pixel is the one
        // wanted.
        let mut image = Vec::new();
        for value in [1u8, 2, 3, 4] {
            image.extend_from_slice(&[value, value, value, 255]);
        }
        assert_eq!(
            crop(&image, 2, 2, 1, 1, 1, 1).expect("inside"),
            vec![4, 4, 4, 255]
        );
    }

    #[test]
    fn a_crop_outside_the_image_is_refused_rather_than_clamped() {
        let image = solid(4, 4, [0, 0, 0, 255]);
        assert!(crop(&image, 4, 4, 3, 3, 2, 2).is_none());
        assert!(
            crop(&image, 4, 4, 0, 0, 0, 1).is_none(),
            "a zero edge is no rect"
        );
        assert!(
            crop(&image, 4, 4, u32::MAX, 0, 2, 2).is_none(),
            "and it never overflows"
        );
    }

    #[test]
    fn a_crop_of_a_short_buffer_is_refused_rather_than_panicking() {
        // The pixels and the dimensions come from two different calls, and the
        // window can resize between them.
        assert!(crop(&solid(2, 2, [1, 1, 1, 255]), 4, 4, 0, 0, 4, 4).is_none());
    }

    #[test]
    fn an_undecorated_host_crops_to_its_whole_bitmap() {
        // Which is the shape Personas actually runs in: `browser-host` has no
        // frame, so the client area IS the window.
        assert_eq!(
            page_rect_physical((1000, 700), (1000, 700), (0, 0)),
            Some((0, 0, 1000, 700))
        );
    }

    #[test]
    fn a_frames_inset_moves_the_rectangle_and_not_its_size() {
        // Without this the crop is a frame's width out, which athena's first
        // smoke run showed as a black band down the left edge of the picture.
        let flush = page_rect_physical((1000, 700), (990, 660), (0, 0)).expect("a page");
        let inset = page_rect_physical((1000, 700), (990, 660), (8, 31)).expect("a page");
        assert_eq!(inset.0, flush.0 + 8);
        assert_eq!(inset.1, flush.1 + 31);
        assert_eq!((inset.2, inset.3), (flush.2, flush.3));
    }

    #[test]
    fn a_negative_inset_is_no_inset() {
        // A window reporting its client area outside its own frame is reporting
        // nonsense, and the honest answer to nonsense is to do nothing with it.
        assert_eq!(
            page_rect_physical((100, 100), (100, 100), (-40, -40)),
            page_rect_physical((100, 100), (100, 100), (0, 0))
        );
    }

    #[test]
    fn a_client_area_bigger_than_its_own_window_yields_no_rectangle() {
        // The two were measured at different moments. The caller falls back to
        // the whole bitmap rather than cropping to a lie.
        assert!(page_rect_physical((800, 600), (900, 600), (0, 0)).is_none());
        assert!(page_rect_physical((800, 600), (800, 600), (10, 0)).is_none());
    }

    #[test]
    fn a_zero_sized_client_area_is_still_one_pixel() {
        let (_, _, w, h) = page_rect_physical((8, 8), (0, 0), (0, 0)).expect("a page");
        assert!(w >= 1 && h >= 1);
    }
}
