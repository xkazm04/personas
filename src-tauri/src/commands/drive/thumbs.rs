//! Drive thumbnail service.
//!
//! WIRE CONTRACT (drive-finder spark, 2026-09-17): `drive_thumbnail` returns
//! JPEG bytes for an image entry, downsized to `edge` px on the long side
//! (clamped to one of 96 / 256 / 1024). The cache lives OUTSIDE the sandbox
//! at `app_cache_dir()/drive-thumbs/` keyed by
//! `<hash(rel_path)>-<mtime_secs>-<size>-<edge>.jpg`; failures are cached as
//! `.fail` markers for 24 h; the cache holds a 256 MB budget, evicting the
//! oldest entries on write.
//!
//! The hash is sha256 truncated to 16 bytes (32 hex chars): `sha2` is a
//! declared dependency of this crate, `sha1` is only transitive, and the key
//! only needs to be collision-free within one cache directory. Thumbnails are
//! derived data, so nothing here emits a drive event.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::imageops::FilterType;
use image::{ImageReader, Limits};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Allowed long-edge sizes. Any other value is clamped to the nearest.
pub const THUMB_EDGES: [u32; 3] = [96, 256, 1024];

/// Sub-directory of `app_cache_dir()` that holds the thumbnails.
const CACHE_SUBDIR: &str = "drive-thumbs";

/// Soft ceiling on the cache directory. Exceeding it after a write triggers
/// eviction down to `EVICT_TARGET_BYTES` (hysteresis, so one write past the
/// line does not evict on every subsequent call).
const BUDGET_BYTES: u64 = 256 * 1024 * 1024;
const EVICT_TARGET_BYTES: u64 = 224 * 1024 * 1024;

/// A decode failure is remembered this long before the decode is retried.
const FAIL_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// JPEG quality for the encoded thumbnail.
const JPEG_QUALITY: u8 = 82;

/// Decode guardrails: a hostile or merely huge source must not take the
/// process down. Dimensions are per axis; the allocation cap is total.
const MAX_SOURCE_DIM: u32 = 16_384;
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;

/// Extensions the `image` crate is compiled to decode (`Cargo.toml` enables
/// png / jpeg / webp / gif). Kept in step with `mime_for_extension`.
fn is_thumbable_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif")
}

/// Snap `edge` to the nearest allowed size (ties round up).
pub(super) fn clamp_edge(edge: u32) -> u32 {
    let mut best = THUMB_EDGES[0];
    let mut best_dist = u32::MAX;
    for &candidate in THUMB_EDGES.iter() {
        let dist = candidate.abs_diff(edge);
        if dist < best_dist || (dist == best_dist && candidate > best) {
            best = candidate;
            best_dist = dist;
        }
    }
    best
}

/// `<hash(rel_path)>-<mtime_secs>-<size>-<edge>` — the stem of both the
/// `.jpg` entry and its `.fail` marker. `rel_path` is normalised to forward
/// slashes first so `a\b.png` and `a/b.png` share a key.
pub(super) fn cache_key(rel_path: &str, mtime_secs: u64, size: u64, edge: u32) -> String {
    use sha2::Digest as _;
    let normalised = rel_path.replace('\\', "/");
    let digest = sha2::Sha256::digest(normalised.as_bytes());
    format!(
        "{}-{}-{}-{}",
        hex::encode(&digest[..16]),
        mtime_secs,
        size,
        edge
    )
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Internal(format!("app_cache_dir unavailable: {e}")))?
        .join(CACHE_SUBDIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Decode `bytes`, downsize so the long edge is at most `edge`, and encode
/// as JPEG. Pure: no filesystem, so it is what the tests exercise.
pub(super) fn decode_to_jpeg(bytes: &[u8], edge: u32) -> Result<Vec<u8>, String> {
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("format sniff: {e}"))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_DIM);
    limits.max_image_height = Some(MAX_SOURCE_DIM);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|e| format!("decode: {e}"))?;
    // `resize` upscales as readily as it downsizes; a thumbnail must never be
    // larger than its source, so a small image is only re-encoded.
    let small = if decoded.width() > edge || decoded.height() > edge {
        decoded.resize(edge, edge, FilterType::Triangle).to_rgb8()
    } else {
        decoded.to_rgb8()
    };
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode_image(&small)
        .map_err(|e| format!("encode: {e}"))?;
    Ok(out)
}

/// Write `bytes` to `dest` via a sibling temp file + rename so a reader never
/// sees a half-written thumbnail.
fn write_atomic(dest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = dest.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, dest) {
        Ok(()) => Ok(()),
        Err(e) => {
            // A concurrent caller may already have landed the same key.
            let _ = std::fs::remove_file(&tmp);
            if dest.is_file() {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

/// Bump `path`'s mtime to now so mtime-ordered eviction treats it as fresh.
fn touch(path: &Path) {
    if let Ok(f) = std::fs::File::options().write(true).open(path) {
        let _ = f.set_modified(SystemTime::now());
    }
}

/// Returns `Some(reason)` when a failure marker exists and is younger than
/// `ttl`. An older marker is removed so the decode can be retried.
pub(super) fn read_fail_marker(marker: &Path, ttl: Duration) -> Option<String> {
    let meta = std::fs::metadata(marker).ok()?;
    let age = meta
        .modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .unwrap_or(Duration::ZERO);
    if age > ttl {
        let _ = std::fs::remove_file(marker);
        return None;
    }
    Some(std::fs::read_to_string(marker).unwrap_or_default())
}

pub(super) fn write_fail_marker(marker: &Path, reason: &str) {
    let _ = std::fs::write(marker, reason);
}

/// If the directory's total size exceeds `budget`, delete oldest-mtime files
/// until it is at or under `target`. One `read_dir`, metadata only. Returns
/// the number of files removed.
pub(super) fn evict_to_budget(dir: &Path, budget: u64, target: u64) -> usize {
    let Ok(read) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
    let mut total = 0u64;
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
        total += meta.len();
        files.push((mtime, meta.len(), entry.path()));
    }
    if total <= budget {
        return 0;
    }
    files.sort_by_key(|f| f.0);
    let mut removed = 0usize;
    for (_, len, path) in files {
        if total <= target {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
            removed += 1;
        }
    }
    removed
}

/// Everything after path resolution, on a blocking thread: cache lookup,
/// decode on miss, marker bookkeeping, eviction.
fn produce(abs: PathBuf, cache: PathBuf, key: String) -> Result<Vec<u8>, AppError> {
    let hit = cache.join(format!("{key}.jpg"));
    if let Ok(bytes) = std::fs::read(&hit) {
        touch(&hit);
        return Ok(bytes);
    }
    let marker = cache.join(format!("{key}.fail"));
    if let Some(reason) = read_fail_marker(&marker, FAIL_TTL) {
        return Err(AppError::Execution(format!("thumbnail failed: {reason}")));
    }
    let edge: u32 = key
        .rsplit('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(THUMB_EDGES[1]);
    let source = std::fs::read(&abs)?;
    match decode_to_jpeg(&source, edge) {
        Ok(jpeg) => {
            write_atomic(&hit, &jpeg)?;
            evict_to_budget(&cache, BUDGET_BYTES, EVICT_TARGET_BYTES);
            Ok(jpeg)
        }
        Err(reason) => {
            write_fail_marker(&marker, &reason);
            Err(AppError::Execution(format!("thumbnail failed: {reason}")))
        }
    }
}

#[tauri::command]
pub async fn drive_thumbnail(
    app: AppHandle,
    rel_path: String,
    edge: u32,
) -> Result<tauri::ipc::Response, AppError> {
    let root = super::managed_root(&app)?;
    let abs = super::resolve_safe(&root, &rel_path)?;
    let meta = std::fs::metadata(&abs)
        .map_err(|_| AppError::NotFound(format!("Not found: {}", rel_path)))?;
    if !meta.is_file() {
        return Err(AppError::Validation(format!("Not a file: {}", rel_path)));
    }
    let ext = abs
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if !is_thumbable_ext(&ext) {
        return Err(AppError::Validation(format!(
            "Not a thumbnailable image: {}",
            rel_path
        )));
    }
    let mtime_secs = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let key = cache_key(&rel_path, mtime_secs, meta.len(), clamp_edge(edge));
    let cache = cache_dir(&app)?;

    let bytes = tauri::async_runtime::spawn_blocking(move || produce(abs, cache, key))
        .await
        .map_err(|e| AppError::Internal(format!("thumbnail task failed: {e}")))??;
    // Raw-byte IPC response, same reason as `drive_read`: an ArrayBuffer,
    // not a JSON array of numbers.
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir() -> PathBuf {
        let base =
            std::env::temp_dir().join(format!("personas-thumbs-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        base
    }

    /// A `w`x`h` opaque PNG generated in-process so the test has no fixture.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, _| image::Rgb([(x % 200) as u8, 40, 200]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn clamp_edge_snaps_to_nearest_allowed() {
        assert_eq!(clamp_edge(0), 96);
        assert_eq!(clamp_edge(96), 96);
        assert_eq!(clamp_edge(150), 96);
        assert_eq!(clamp_edge(176), 256); // tie rounds up
        assert_eq!(clamp_edge(300), 256);
        assert_eq!(clamp_edge(700), 1024);
        assert_eq!(clamp_edge(u32::MAX), 1024);
    }

    #[test]
    fn cache_key_shape_and_slash_normalisation() {
        let a = cache_key("dir/pic.png", 1_700_000_000, 4096, 256);
        let b = cache_key("dir\\pic.png", 1_700_000_000, 4096, 256);
        assert_eq!(a, b);
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].len(), 32);
        assert!(parts[0].chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(parts[1], "1700000000");
        assert_eq!(parts[2], "4096");
        assert_eq!(parts[3], "256");
        // Any component change changes the key.
        assert_ne!(a, cache_key("dir/pic2.png", 1_700_000_000, 4096, 256));
        assert_ne!(a, cache_key("dir/pic.png", 1_700_000_001, 4096, 256));
        assert_ne!(a, cache_key("dir/pic.png", 1_700_000_000, 4097, 256));
        assert_ne!(a, cache_key("dir/pic.png", 1_700_000_000, 4096, 96));
    }

    #[test]
    fn decode_to_jpeg_downsizes_and_keeps_aspect() {
        let jpeg = decode_to_jpeg(&png(400, 200), 96).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "JPEG SOI marker");
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (96, 48));
        // A source already smaller than the edge is never upscaled.
        let small = image::load_from_memory(&decode_to_jpeg(&png(40, 20), 96).unwrap()).unwrap();
        assert_eq!((small.width(), small.height()), (40, 20));
    }

    #[test]
    fn decode_to_jpeg_rejects_garbage() {
        let err = decode_to_jpeg(b"definitely not an image", 96).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn fail_marker_roundtrip_and_expiry() {
        let dir = temp_dir();
        let marker = dir.join("k.fail");
        assert!(read_fail_marker(&marker, FAIL_TTL).is_none());
        write_fail_marker(&marker, "decode: bad header");
        assert_eq!(
            read_fail_marker(&marker, FAIL_TTL).as_deref(),
            Some("decode: bad header")
        );
        // A zero TTL makes any marker stale: it is deleted and reported absent.
        assert!(read_fail_marker(&marker, Duration::ZERO).is_none());
        assert!(!marker.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn evict_to_budget_removes_oldest_first() {
        let dir = temp_dir();
        let now = SystemTime::now();
        for (i, name) in ["old", "mid", "new"].iter().enumerate() {
            let p = dir.join(format!("{name}.jpg"));
            fs::write(&p, vec![0u8; 100]).unwrap();
            let f = fs::File::options().write(true).open(&p).unwrap();
            f.set_modified(now - Duration::from_secs(100 - i as u64 * 10))
                .unwrap();
        }
        // 300 bytes total, under budget: nothing happens.
        assert_eq!(evict_to_budget(&dir, 300, 200), 0);
        // Over budget: drop oldest until <= target.
        assert_eq!(evict_to_budget(&dir, 250, 200), 1);
        assert!(!dir.join("old.jpg").exists());
        assert!(dir.join("mid.jpg").exists());
        assert!(dir.join("new.jpg").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn produce_caches_hit_and_marks_failure() {
        let dir = temp_dir();
        let src = dir.join("pic.png");
        fs::write(&src, png(40, 20)).unwrap();
        let cache = dir.join("cache");
        fs::create_dir_all(&cache).unwrap();

        let key = cache_key("pic.png", 1, 2, 96);
        let first = produce(src.clone(), cache.clone(), key.clone()).unwrap();
        assert!(cache.join(format!("{key}.jpg")).is_file());
        let second = produce(src.clone(), cache.clone(), key.clone()).unwrap();
        assert_eq!(first, second);

        let bad = dir.join("bad.png");
        fs::write(&bad, b"nope").unwrap();
        let bad_key = cache_key("bad.png", 1, 4, 96);
        let err = produce(bad.clone(), cache.clone(), bad_key.clone()).unwrap_err();
        assert!(matches!(err, AppError::Execution(ref m) if m.starts_with("thumbnail failed:")));
        assert!(cache.join(format!("{bad_key}.fail")).is_file());
        // Second call is answered from the marker even if the file became valid.
        fs::write(&bad, png(40, 20)).unwrap();
        assert!(produce(bad, cache.clone(), bad_key).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
