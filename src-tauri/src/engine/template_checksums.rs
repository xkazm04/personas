// Auto-generated template checksum manifest for backend integrity verification.
// DO NOT EDIT MANUALLY. Regenerate with: node scripts/generate-template-checksums.mjs
//
// The frontend bundle also contains these checksums, but an attacker with local
// file access could tamper with both template JSON files and the JS bundle.
// Embedding the manifest in the native Rust binary provides defense-in-depth:
// the compiled binary is significantly harder to modify without detection.

use std::collections::HashMap;
use std::sync::LazyLock;

/// Embedded checksum manifest: maps relative template path → expected hash.
/// Populated at compile time from the same source of truth as the frontend.
static CHECKSUM_MANIFEST: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::with_capacity(91);
    m.insert("content/autonomous-art-director.json", "000438b330af0d5b");
    m.insert("content/content-performance-reporter.json", "000a2eb4107c5dc4");
    m.insert("content/newsletter-curator.json", "0007f5729c380e36");
    m.insert("development/dev-clone.json", "000dd30f5f901eb7");
    m.insert("development/qa-guardian.json", "001dc5e973996cec");
    m.insert("devops/devops-guardian.json", "00191a118384bf31");
    m.insert("devops/incident-logger.json", "001bcbf2bae91f67");
    m.insert("devops/sentry-production-monitor.json", "001ee39aba1ded16");
    m.insert("finance/budget-spending-monitor.json", "0010da3539bfc201");
    m.insert("finance/financial-stocks-signaller.json", "000e456a56951de8");
    m.insert("finance/freelancer-invoice-autopilot.json", "00001d171ba0a8dc");
    m.insert("finance/invoice-tracker.json", "0016a5769fc68bbd");
    m.insert("hr/onboarding-tracker.json", "001941670dfe1a96");
    m.insert("marketing/visual-brand-asset-factory.json", "0000d76233262c49");
    m.insert("marketing/web-marketing.json", "001b8d0d2a1d49a4");
    m.insert("productivity/daily-standup-compiler.json", "0017cf58d997af2a");
    m.insert("productivity/email-follow-up-tracker.json", "001d43707cda850c");
    m.insert("productivity/email-morning-digest.json", "001b19e155c85af8");
    m.insert("productivity/email-task-extractor.json", "000a5e141b83c46b");
    m.insert("productivity/idea-harvester.json", "001bf490524fca47");
    m.insert("productivity/survey-insights-analyzer.json", "00077750e38b4868");
    m.insert("project-management/technical-decision-tracker.json", "001b85d64f319998");
    m.insert("research/database-performance-monitor.json", "0014d87287cb2d95");
    m.insert("research/research-knowledge-curator.json", "0011d62dc9d2e6a1");
    m.insert("research/research-paper-indexer.json", "0008ee9b83f9692d");
    m.insert("sales/contact-enrichment-agent.json", "0005a6a4f411d75e");
    m.insert("sales/contact-sync-manager.json", "00144b6af3ca33ca");
    m.insert("sales/email-lead-extractor.json", "000965abdf6b8bf2");
    m.insert("sales/sales-deal-analyzer.json", "000848e041a8e637");
    m.insert("sales/sales-deal-tracker.json", "001bdcca3d169cbf");
    m.insert("sales/sales-proposal-generator.json", "00025a1fb56e4754");
    m.insert("security/access-request-manager.json", "0019e1546a41d55e");
    m.insert("support/email-support-assistant.json", "0019c1536ee3958e");
    m.insert("support/support-email-router.json", "000edcfba828686f");
    m
});

/// Compute the same deterministic content hash used by the frontend.
///
/// This is a port of the JavaScript `computeContentHashSync` function.
/// It operates on UTF-16 code units (JavaScript\'s string encoding) to
/// produce identical results for the same input string.
pub fn compute_content_hash(content: &str) -> String {
    let mut h1: u32 = 0xDEAD_BEEF;
    let mut h2: u32 = 0x41C6_CE57;

    for ch in content.encode_utf16() {
        let ch = ch as u32;
        h1 = (h1 ^ ch).wrapping_mul(2_654_435_761);
        h2 = (h2 ^ ch).wrapping_mul(1_597_334_677);
    }

    h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2_246_822_507);
    h1 ^= (h2 ^ (h2 >> 13)).wrapping_mul(3_266_489_909);
    h2 = (h2 ^ (h2 >> 16)).wrapping_mul(2_246_822_507);
    h2 ^= (h1 ^ (h1 >> 13)).wrapping_mul(3_266_489_909);

    let combined: u64 = ((h2 as u64) & 0x1F_FFFF) << 32 | (h1 as u64);
    format!("{combined:016x}")
}

/// Result of verifying a single template\'s integrity.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateIntegrityResult {
    pub path: String,
    pub expected_hash: Option<String>,
    pub actual_hash: String,
    pub valid: bool,
    pub is_known_template: bool,
}

/// Verify a single template\'s content against the embedded manifest.
pub fn verify_template(path: &str, content: &str) -> TemplateIntegrityResult {
    let actual_hash = compute_content_hash(content);
    let expected = CHECKSUM_MANIFEST.get(path).copied();
    let valid = expected.map_or(false, |e| e == actual_hash);

    TemplateIntegrityResult {
        path: path.to_string(),
        expected_hash: expected.map(String::from),
        actual_hash,
        valid,
        is_known_template: expected.is_some(),
    }
}

/// Batch verification result.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchIntegrityResult {
    pub results: Vec<TemplateIntegrityResult>,
    pub all_valid: bool,
    pub total: usize,
    pub valid_count: usize,
    pub invalid_count: usize,
    pub unknown_count: usize,
}

/// Verify a batch of templates against the embedded manifest.
pub fn verify_templates_batch(templates: &[(String, String)]) -> BatchIntegrityResult {
    let results: Vec<TemplateIntegrityResult> = templates
        .iter()
        .map(|(path, content)| verify_template(path, content))
        .collect();

    let valid_count = results.iter().filter(|r| r.valid).count();
    let invalid_count = results.iter().filter(|r| r.is_known_template && !r.valid).count();
    let unknown_count = results.iter().filter(|r| !r.is_known_template).count();

    BatchIntegrityResult {
        all_valid: invalid_count == 0,
        total: results.len(),
        valid_count,
        invalid_count,
        unknown_count,
        results,
    }
}

/// Get the number of entries in the embedded checksum manifest.
pub fn manifest_entry_count() -> usize {
    CHECKSUM_MANIFEST.len()
}
