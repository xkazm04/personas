//! Grok's card: presence and version only.
//!
//! The grok CLI keeps no quota on disk and exposes none through a passive
//! command, so there is never a window to show - the card says the CLI is
//! here (or is not) and why it has no meter. Presence comes from the same
//! engine probe Settings > Engine uses, so the two surfaces cannot disagree.

use crate::companion::engine_settings::{AthenaEngine, EngineAvailability};

use super::{CliProvider, CliProviderUsage, CliUsageReader, CliUsageReason};

/// Maps an engine-probe result to the card. The probe spawns processes, so it
/// is run (and cached) by the caller; this half is pure.
pub struct GrokReader {
    probe: Option<EngineAvailability>,
}

impl GrokReader {
    /// Pick Grok's entry out of a `probe_engines()` answer.
    pub fn from_probe(probe: &[EngineAvailability]) -> Self {
        Self {
            probe: probe
                .iter()
                .find(|a| a.engine == AthenaEngine::Grok)
                .cloned(),
        }
    }
}

impl CliUsageReader for GrokReader {
    fn read(&self) -> CliProviderUsage {
        match self.probe.as_ref().filter(|a| a.installed) {
            // `detail` is not carried: it can name local paths.
            Some(a) => CliProviderUsage {
                version: a
                    .version
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string),
                ..CliProviderUsage::absent(CliProvider::Grok, true, CliUsageReason::NoQuotaSource)
            },
            None => CliProviderUsage::not_installed(CliProvider::Grok),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(engine: AthenaEngine, installed: bool, version: Option<&str>) -> EngineAvailability {
        EngineAvailability {
            engine,
            installed,
            version: version.map(str::to_string),
            models: Vec::new(),
            detail: Some("synthetic detail".into()),
        }
    }

    #[test]
    fn an_installed_grok_has_a_version_and_no_quota_source() {
        let probe = [
            avail(AthenaEngine::Claude, true, Some("9.9.9")),
            avail(AthenaEngine::Grok, true, Some(" 0.0.1\n")),
        ];
        let card = GrokReader::from_probe(&probe).read();
        assert_eq!(card.provider, CliProvider::Grok);
        assert!(card.installed);
        assert_eq!(card.version.as_deref(), Some("0.0.1"));
        assert_eq!(card.reason, Some(CliUsageReason::NoQuotaSource));
        assert!(card.windows.is_empty());
        assert!(!card.projected);
        assert_eq!(card.as_of_ms, None);
    }

    #[test]
    fn a_missing_or_unprobed_grok_is_not_installed() {
        let expected = CliProviderUsage::not_installed(CliProvider::Grok);
        let probe = [avail(AthenaEngine::Grok, false, None)];
        assert_eq!(GrokReader::from_probe(&probe).read(), expected);
        // Claude's entry is never mistaken for Grok's.
        let probe = [avail(AthenaEngine::Claude, true, Some("9.9.9"))];
        assert_eq!(GrokReader::from_probe(&probe).read(), expected);
    }
}
