//! Curated catalog of Piper voices the Voice tab is allowed to download.
//!
//! Acting as an allowlist gates the download manager against arbitrary
//! URLs — the frontend can only ask us to fetch voices we know about and
//! that resolve to clean paths under the official `rhasspy/piper-voices`
//! Hugging Face repo.
//!
//! Catalog is intentionally small (12-20 voices) and human-curated:
//! - One sensible default per supported language (medium quality where it
//!   exists; the smaller `low`/`x_low` qualities only when no medium is
//!   published — Hindi, Vietnamese, Ukrainian).
//! - English gets multiple voices (US/GB, male/female) because that's
//!   where the bulk of users land first.
//!
//! Adding a voice = append a `PiperVoiceEntry` row. Names follow the same
//! `<lang_locale>-<speaker>-<quality>` shape Piper itself uses; the URL
//! resolver in `downloader.rs` parses that into the Hugging Face path.
//!
//! Voice sizes are approximate — the real content length is reported in
//! download progress events from the HTTP `Content-Length` header.

use serde::Serialize;

use crate::error::AppError;

/// One curated voice. Mostly UI metadata; URL/path are derived from
/// `voice_id` via `downloader::voice_*` helpers so we don't repeat the
/// HF path in two places.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperVoiceEntry {
    /// Piper voice id, e.g. `en_US-amy-medium`. The wire identifier and
    /// the on-disk directory name.
    pub voice_id: &'static str,
    /// BCP-47 language tag for UI display (e.g. `en-US`, `cs-CZ`).
    pub language_code: &'static str,
    /// English label of the language (UI fallback when translations miss).
    pub language_label: &'static str,
    /// Native-language label of the language (e.g. "Čeština" for cs-CZ).
    pub language_native_label: &'static str,
    /// Speaker display name (capitalized).
    pub speaker: &'static str,
    /// `"female"` / `"male"` / `"neutral"` — three-state, voice-acted.
    pub gender: &'static str,
    /// Quality tier: `"x_low"`, `"low"`, `"medium"`, `"high"`. Higher tiers
    /// are larger and slower but sound noticeably better.
    pub quality: &'static str,
    /// Approximate model size in MB. Real size from `Content-Length` is
    /// surfaced through download progress events.
    pub approx_size_mb: u32,
    /// One-line marketing-style description for the picker. English; the
    /// frontend can override per-locale via i18n if it wants to.
    pub description: &'static str,
}

/// Curated voice catalog. Order is the order users see in the picker —
/// English first, then alphabetical by language label. Add voices by
/// appending; reordering is fine.
pub const PIPER_VOICES: &[PiperVoiceEntry] = &[
    // ── English ──────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "en_US-amy-medium",
        language_code: "en-US",
        language_label: "English (US)",
        language_native_label: "English (US)",
        speaker: "Amy",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Warm, conversational US English. Good general-purpose default.",
    },
    PiperVoiceEntry {
        voice_id: "en_US-ryan-high",
        language_code: "en-US",
        language_label: "English (US)",
        language_native_label: "English (US)",
        speaker: "Ryan",
        gender: "male",
        quality: "high",
        approx_size_mb: 110,
        description: "Higher-quality male US voice. Slower to render, richer prosody.",
    },
    PiperVoiceEntry {
        voice_id: "en_GB-alba-medium",
        language_code: "en-GB",
        language_label: "English (UK)",
        language_native_label: "English (UK)",
        speaker: "Alba",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "British English, warm female speaker.",
    },
    // ── Czech ────────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "cs_CZ-jirka-medium",
        language_code: "cs-CZ",
        language_label: "Czech",
        language_native_label: "Čeština",
        speaker: "Jirka",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Czech male voice.",
    },
    // ── German ───────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "de_DE-thorsten-medium",
        language_code: "de-DE",
        language_label: "German",
        language_native_label: "Deutsch",
        speaker: "Thorsten",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Clear standard German, male.",
    },
    // ── Spanish ──────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "es_ES-davefx-medium",
        language_code: "es-ES",
        language_label: "Spanish (Spain)",
        language_native_label: "Español",
        speaker: "DaveFX",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Castilian Spanish, male speaker.",
    },
    // ── French ───────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "fr_FR-siwis-medium",
        language_code: "fr-FR",
        language_label: "French",
        language_native_label: "Français",
        speaker: "Siwis",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard French, female speaker.",
    },
    // ── Italian ──────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "it_IT-paola-medium",
        language_code: "it-IT",
        language_label: "Italian",
        language_native_label: "Italiano",
        speaker: "Paola",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Italian, female speaker.",
    },
    // ── Portuguese (Brazil) ──────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "pt_BR-faber-medium",
        language_code: "pt-BR",
        language_label: "Portuguese (Brazil)",
        language_native_label: "Português (Brasil)",
        speaker: "Faber",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Brazilian Portuguese, male speaker.",
    },
    // ── Polish ───────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "pl_PL-darkman-medium",
        language_code: "pl-PL",
        language_label: "Polish",
        language_native_label: "Polski",
        speaker: "Darkman",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Polish, male speaker.",
    },
    // ── Russian ──────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "ru_RU-irina-medium",
        language_code: "ru-RU",
        language_label: "Russian",
        language_native_label: "Русский",
        speaker: "Irina",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Russian, female speaker.",
    },
    // ── Dutch ────────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "nl_NL-mls-medium",
        language_code: "nl-NL",
        language_label: "Dutch",
        language_native_label: "Nederlands",
        speaker: "MLS",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Dutch, male speaker.",
    },
    // ── Turkish ──────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "tr_TR-fettah-medium",
        language_code: "tr-TR",
        language_label: "Turkish",
        language_native_label: "Türkçe",
        speaker: "Fettah",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Turkish, male speaker.",
    },
    // ── Chinese (Mandarin) ───────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "zh_CN-huayan-medium",
        language_code: "zh-CN",
        language_label: "Chinese (Mandarin)",
        language_native_label: "中文",
        speaker: "Huayan",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Mandarin, female speaker.",
    },
    // ── Vietnamese ───────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "vi_VN-vais1000-medium",
        language_code: "vi-VN",
        language_label: "Vietnamese",
        language_native_label: "Tiếng Việt",
        speaker: "vais1000",
        gender: "female",
        quality: "medium",
        approx_size_mb: 63,
        description: "Standard Vietnamese, female speaker.",
    },
    // ── Ukrainian ────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "uk_UA-lada-x_low",
        language_code: "uk-UA",
        language_label: "Ukrainian",
        language_native_label: "Українська",
        speaker: "Lada",
        gender: "female",
        quality: "x_low",
        approx_size_mb: 7,
        description: "Compact Ukrainian voice (no medium-quality available).",
    },
    // ── Arabic ───────────────────────────────────────────────────────
    PiperVoiceEntry {
        voice_id: "ar_JO-kareem-medium",
        language_code: "ar-JO",
        language_label: "Arabic (Jordan)",
        language_native_label: "العربية (الأردن)",
        speaker: "Kareem",
        gender: "male",
        quality: "medium",
        approx_size_mb: 63,
        description: "Modern Standard Arabic, male speaker.",
    },
];

pub fn find_voice_by_id(voice_id: &str) -> Option<&'static PiperVoiceEntry> {
    PIPER_VOICES.iter().find(|v| v.voice_id == voice_id)
}

/// Parse a Piper voice id `<lang_locale>-<speaker>-<quality>` into its
/// three components. Returns `None` for malformed ids.
///
/// Speakers can contain `_` (`northern_english_male`, `25hours_single`)
/// but never `-`, so splitting on `-` always yields exactly three parts
/// for a well-formed id.
pub fn parse_voice_id(voice_id: &str) -> Result<ParsedVoiceId<'_>, AppError> {
    let parts: Vec<&str> = voice_id.split('-').collect();
    if parts.len() != 3 {
        return Err(AppError::Validation(format!(
            "piper voice id `{voice_id}` must be `<locale>-<speaker>-<quality>`"
        )));
    }
    let lang_locale = parts[0];
    let speaker = parts[1];
    let quality = parts[2];
    let lang_family = lang_locale
        .split_once('_')
        .map(|(family, _)| family)
        .unwrap_or(lang_locale);
    Ok(ParsedVoiceId {
        lang_family,
        lang_locale,
        speaker,
        quality,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParsedVoiceId<'a> {
    pub lang_family: &'a str,
    pub lang_locale: &'a str,
    pub speaker: &'a str,
    pub quality: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_voice_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for v in PIPER_VOICES {
            assert!(
                seen.insert(v.voice_id),
                "duplicate voice id in catalog: {}",
                v.voice_id
            );
        }
    }

    #[test]
    fn catalog_voice_ids_parse_cleanly() {
        // If a catalog row's voice_id can't be parsed back into the
        // <locale>-<speaker>-<quality> shape, the URL resolver in
        // downloader.rs would build a broken HF path and the user would
        // see an opaque 404. Catch that at compile-test time.
        for v in PIPER_VOICES {
            parse_voice_id(v.voice_id).unwrap_or_else(|e| {
                panic!("voice {} fails parse: {e}", v.voice_id);
            });
        }
    }

    #[test]
    fn parse_voice_id_handles_simple_speaker() {
        let p = parse_voice_id("en_US-amy-medium").unwrap();
        assert_eq!(p.lang_family, "en");
        assert_eq!(p.lang_locale, "en_US");
        assert_eq!(p.speaker, "amy");
        assert_eq!(p.quality, "medium");
    }

    #[test]
    fn parse_voice_id_handles_underscore_speaker() {
        // northern_english_male is a real speaker; underscore in the
        // speaker name must not get split. (The on-the-wire voice id
        // `en_GB-northern_english_male-medium` stays one piece because
        // we split on `-`, not `_`.)
        let p = parse_voice_id("en_GB-northern_english_male-medium").unwrap();
        assert_eq!(p.lang_family, "en");
        assert_eq!(p.lang_locale, "en_GB");
        assert_eq!(p.speaker, "northern_english_male");
        assert_eq!(p.quality, "medium");
    }

    #[test]
    fn parse_voice_id_rejects_too_few_parts() {
        assert!(parse_voice_id("en_US-amy").is_err());
        assert!(parse_voice_id("amy").is_err());
    }

    #[test]
    fn parse_voice_id_rejects_too_many_parts() {
        // Quality slugs can have underscores (`x_low`) but never hyphens,
        // so any 4-piece id is malformed.
        assert!(parse_voice_id("en_US-amy-medium-extra").is_err());
    }

    #[test]
    fn find_voice_by_id_returns_known_entry() {
        assert!(find_voice_by_id("en_US-amy-medium").is_some());
        assert!(find_voice_by_id("cs_CZ-jirka-medium").is_some());
    }

    #[test]
    fn find_voice_by_id_returns_none_for_unknown() {
        assert!(find_voice_by_id("fr_XX-fake-medium").is_none());
        assert!(find_voice_by_id("not-a-voice-id").is_none());
    }
}
