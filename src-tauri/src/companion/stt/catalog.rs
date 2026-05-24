//! Curated catalog of whisper.cpp ggml models the Voice tab can download.
//!
//! Acts as an allowlist so the download manager only ever fetches models we
//! know about, resolving to clean filenames under the official
//! `ggerganov/whisper.cpp` Hugging Face repo. Each model is a single
//! `ggml-<id>.bin` file (no separate config, unlike Piper voices).
//!
//! Kept small and human-curated: the `.en` models for English-only users
//! (smaller + slightly more accurate on English), and the multilingual
//! `base`/`small` for everyone else. `tiny` is the "it just needs to run on
//! a potato" floor; `small` is the accuracy ceiling we're willing to ship by
//! default (medium/large are 1.5 GB+ and too slow on CPU for a snappy turn).
//!
//! Adding a model = append a `WhisperModelEntry`. The id maps to the file
//! `ggml-<id>.bin` and the HF path `resolve/main/ggml-<id>.bin`.

use serde::Serialize;

/// One curated whisper model. Mostly UI metadata; the on-disk filename and
/// HF URL are derived from `model_id` so the path lives in one place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelEntry {
    /// Model id, e.g. `base.en`. Maps to file `ggml-base.en.bin`.
    pub model_id: &'static str,
    /// Short display label for the picker (e.g. "Base (English)").
    pub label: &'static str,
    /// `true` for English-only (`.en`) models; `false` for multilingual.
    pub multilingual: bool,
    /// Approximate file size in MB. Real size comes from `Content-Length`
    /// in download progress events.
    pub approx_size_mb: u32,
    /// One-line accuracy/speed tradeoff note for the picker.
    pub description: &'static str,
}

/// Curated model catalog. Order = picker order: fastest → most accurate,
/// English variants alongside their multilingual sibling.
pub const WHISPER_MODELS: &[WhisperModelEntry] = &[
    WhisperModelEntry {
        model_id: "tiny.en",
        label: "Tiny (English)",
        multilingual: false,
        approx_size_mb: 75,
        description: "Fastest, lowest accuracy. Good for low-end machines and short commands.",
    },
    WhisperModelEntry {
        model_id: "base.en",
        label: "Base (English)",
        multilingual: false,
        approx_size_mb: 142,
        description: "Recommended default for English — near real-time on most CPUs.",
    },
    WhisperModelEntry {
        model_id: "small.en",
        label: "Small (English)",
        multilingual: false,
        approx_size_mb: 466,
        description: "More accurate English; noticeably slower per turn on CPU.",
    },
    WhisperModelEntry {
        model_id: "tiny",
        label: "Tiny (multilingual)",
        multilingual: true,
        approx_size_mb: 75,
        description: "Fastest multilingual. Covers 90+ languages at lower accuracy.",
    },
    WhisperModelEntry {
        model_id: "base",
        label: "Base (multilingual)",
        multilingual: true,
        approx_size_mb: 142,
        description: "Recommended multilingual default — balances speed and accuracy.",
    },
    WhisperModelEntry {
        model_id: "small",
        label: "Small (multilingual)",
        multilingual: true,
        approx_size_mb: 466,
        description: "Most accurate multilingual we ship; slower per turn on CPU.",
    },
];

/// Look up a catalog entry by model id. `None` for ids not in the curated
/// list — the download/transcribe/delete paths reject those.
pub fn find_model_by_id(model_id: &str) -> Option<&'static WhisperModelEntry> {
    WHISPER_MODELS.iter().find(|m| m.model_id == model_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for m in WHISPER_MODELS {
            assert!(seen.insert(m.model_id), "duplicate model id {}", m.model_id);
        }
    }

    #[test]
    fn find_model_resolves_known_and_rejects_unknown() {
        assert!(find_model_by_id("base.en").is_some());
        assert!(find_model_by_id("large-v3").is_none());
        assert!(find_model_by_id("../etc/passwd").is_none());
    }
}
