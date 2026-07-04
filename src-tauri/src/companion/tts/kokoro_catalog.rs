//! Curated catalog of Kokoro voices exposed in the Voice tab.
//!
//! Unlike Piper (one `.onnx` per voice), Kokoro ships a single ~310MB model
//! whose 53 voices are selected at inference time by an integer speaker id
//! (`--sid`). This catalog maps friendly voice ids (`af_heart`) to the sid
//! order of the official sherpa-onnx `kokoro-multi-lang-v1_0` package, and
//! carries the UI metadata (speaker / gender / language / blurb).
//!
//! The sid values are **verified against the official sherpa-onnx docs**
//! (kokoro-multi-lang-v1_0, ids 0..=52). Do NOT reorder or invent sids: a
//! wrong number silently synthesizes a different voice. If a future package
//! reorders speakers, re-verify against
//! <https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html>.
//!
//! We intentionally surface only a small English-voice subset (the strongest
//! female voices + one British + one male reference) rather than all 53 —
//! the model download is monolithic, so every voice is available once the
//! package is installed; the catalog is just the curated picker.

use serde::Serialize;

/// The default Kokoro voice — `af_heart`, Kokoro's flagship warm US female.
pub const DEFAULT_KOKORO_VOICE_ID: &str = "af_heart";

/// One curated Kokoro voice. `sid` is the `--sid` index into the shared
/// model; everything else is UI metadata.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroVoiceEntry {
    /// Friendly voice id, e.g. `af_heart`. The wire identifier the frontend
    /// stores + sends; resolved to `sid` at synthesis time.
    pub voice_id: &'static str,
    /// Speaker id passed to `sherpa-onnx-offline-tts --sid`. Verified against
    /// the kokoro-multi-lang-v1_0 speaker table.
    pub sid: u32,
    /// Speaker display name (capitalized).
    pub speaker: &'static str,
    /// `"female"` / `"male"` — Kokoro's `af_`/`am_`/`bf_`/`bm_` prefixes.
    pub gender: &'static str,
    /// BCP-47 language tag for UI grouping (e.g. `en-US`, `en-GB`).
    pub language_code: &'static str,
    /// English label of the language.
    pub language_label: &'static str,
    /// Quality grade from Kokoro's official VOICES.md (A / A- / B- / …). Shown
    /// as a hint so users know which voices had the most training data.
    pub grade: &'static str,
    /// One-line description for the picker.
    pub description: &'static str,
}

/// Curated Kokoro voice catalog. Order is the order users see in the picker;
/// `af_heart` (the default) leads.
pub const KOKORO_VOICES: &[KokoroVoiceEntry] = &[
    KokoroVoiceEntry {
        voice_id: "af_heart",
        sid: 3,
        speaker: "Heart",
        gender: "female",
        language_code: "en-US",
        language_label: "English (US)",
        grade: "A",
        description: "Warm, expressive US female — Kokoro's flagship voice.",
    },
    KokoroVoiceEntry {
        voice_id: "af_bella",
        sid: 2,
        speaker: "Bella",
        gender: "female",
        language_code: "en-US",
        language_label: "English (US)",
        grade: "A-",
        description: "Bright, natural US female.",
    },
    KokoroVoiceEntry {
        voice_id: "af_nicole",
        sid: 6,
        speaker: "Nicole",
        gender: "female",
        language_code: "en-US",
        language_label: "English (US)",
        grade: "B-",
        description: "Softer US female with an intimate tone.",
    },
    KokoroVoiceEntry {
        voice_id: "af_sky",
        sid: 10,
        speaker: "Sky",
        gender: "female",
        language_code: "en-US",
        language_label: "English (US)",
        grade: "C-",
        description: "Light, airy US female.",
    },
    KokoroVoiceEntry {
        voice_id: "bf_emma",
        sid: 21,
        speaker: "Emma",
        gender: "female",
        language_code: "en-GB",
        language_label: "English (UK)",
        grade: "B-",
        description: "Warm British female.",
    },
    KokoroVoiceEntry {
        voice_id: "am_michael",
        sid: 16,
        speaker: "Michael",
        gender: "male",
        language_code: "en-US",
        language_label: "English (US)",
        grade: "C+",
        description: "Natural US male reference voice.",
    },
];

pub fn find_voice_by_id(voice_id: &str) -> Option<&'static KokoroVoiceEntry> {
    KOKORO_VOICES.iter().find(|v| v.voice_id == voice_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_voice_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for v in KOKORO_VOICES {
            assert!(seen.insert(v.voice_id), "duplicate voice id: {}", v.voice_id);
        }
    }

    #[test]
    fn catalog_sids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for v in KOKORO_VOICES {
            assert!(seen.insert(v.sid), "duplicate sid: {}", v.sid);
        }
    }

    #[test]
    fn default_voice_is_in_catalog() {
        assert!(find_voice_by_id(DEFAULT_KOKORO_VOICE_ID).is_some());
    }

    #[test]
    fn af_heart_is_sid_3() {
        // Load-bearing: verified against the official sherpa-onnx
        // kokoro-multi-lang-v1_0 speaker table. If this changes, re-verify
        // the whole catalog — a wrong sid synthesizes the wrong voice.
        assert_eq!(find_voice_by_id("af_heart").unwrap().sid, 3);
    }

    #[test]
    fn find_voice_by_id_returns_none_for_unknown() {
        assert!(find_voice_by_id("zz_nobody").is_none());
    }
}
