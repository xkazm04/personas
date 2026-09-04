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
    let mut m = HashMap::with_capacity(61);
    m.insert(
        "content/analytics-content-distribution-use-case.json",
        "001cf516b81f9d45",
    );
    m.insert("content/audio-briefing-host.json", "0016d24f6727f677");
    m.insert("content/autonomous-art-director.json", "0010fe2cfbe92ab4");
    m.insert(
        "content/content-performance-reporter.json",
        "001db363dbd31eb3",
    );
    m.insert("content/demo-recorder.json", "00077655e0ff78b9");
    m.insert("content/feature-video-creator.json", "0003437ceb53f8d5");
    m.insert("content/newsletter-curator.json", "000fba2ef9927179");
    m.insert("content/scientific-writing-editor.json", "0011b5192eed0257");
    m.insert("content/social-media-designer.json", "00116fe4c3ad499d");
    m.insert(
        "development/autonomous-issue-resolver.json",
        "0010c5f3cd07faa2",
    );
    m.insert("development/dev-clone.json", "0010432aad04ae5e");
    m.insert(
        "development/lean-codebase-sentinel.json",
        "000af68557f2d526",
    );
    m.insert("development/qa-guardian.json", "00090ca62e830c46");
    m.insert(
        "development/real-time-database-watcher.json",
        "000a8316306b346b",
    );
    m.insert("development/skill-librarian.json", "001715cb96cae02f");
    m.insert("development/solution-architect.json", "00165f3fe9ea5333");
    m.insert("devops/devops-guardian.json", "000903ec7b137cb6");
    m.insert("devops/incident-logger.json", "0018ff4da0040281");
    m.insert("devops/release-manager.json", "000e7e89e194bf67");
    m.insert("email/intake-processor.json", "001e5d89c92d9983");
    m.insert("finance/budget-spending-monitor.json", "000e154f9accb32a");
    m.insert("finance/expense-receipt-processor.json", "0014b23cb41a45b6");
    m.insert(
        "finance/financial-stocks-signaller.json",
        "00074f0fbda264e6",
    );
    m.insert("finance/invoice-tracker.json", "000f184ae42450b7");
    m.insert(
        "finance/revenue-intelligence-copilot.json",
        "00183627fae9b101",
    );
    m.insert("finance/revenue-operations-hub.json", "000b630c375a9e2b");
    m.insert(
        "finance/subscription-billing-use-case.json",
        "001ec4e13d5b749a",
    );
    m.insert("legal/ai-contract-reviewer.json", "00182fc8863bdfc6");
    m.insert("legal/contract-lifecycle-use-case.json", "0016a022e45d1544");
    m.insert(
        "marketing/autonomous-cro-experiment-runner.json",
        "0002c936960b8b79",
    );
    m.insert("marketing/content-cascade.json", "00195007050c9198");
    m.insert("marketing/reddit-trend-digest.json", "0010924564b1d74e");
    m.insert(
        "marketing/visual-brand-asset-factory.json",
        "0016c39067c63b23",
    );
    m.insert("marketing/web-marketing.json", "0002a86ddd9d4d86");
    m.insert(
        "marketing/website-conversion-audit.json",
        "0009e5a9a0267d03",
    );
    m.insert(
        "productivity/daily-standup-compiler.json",
        "000a211bd3d97a56",
    );
    m.insert("productivity/digital-clone.json", "00048ec76b518ee2");
    m.insert(
        "productivity/email-intelligence-operator.json",
        "000c282542434490",
    );
    m.insert("productivity/email-morning-digest.json", "0019c09408fb1bd0");
    m.insert("productivity/idea-harvester.json", "00024d0acab85e27");
    m.insert(
        "productivity/meeting-lifecycle-manager.json",
        "0018b276807eb6f4",
    );
    m.insert("productivity/router.json", "0001ec02412ffdd3");
    m.insert(
        "productivity/survey-insights-analyzer.json",
        "001e8f4a0282b4ea",
    );
    m.insert(
        "project-management/product-strategist.json",
        "0000d3872e3b697d",
    );
    m.insert(
        "project-management/technical-decision-tracker.json",
        "0008e9728d4820f5",
    );
    m.insert("research/bi-dashboard-digest.json", "001b936730c1acd1");
    m.insert(
        "research/conversational-database-analyst.json",
        "001b1b17691cd753",
    );
    m.insert(
        "research/database-performance-monitor.json",
        "0006a177a6b5fc56",
    );
    m.insert(
        "research/industry-intelligence-aggregator.json",
        "000e2df7cb0091c6",
    );
    m.insert(
        "research/knowledge-base-health-auditor.json",
        "0017ee9832c48cb2",
    );
    m.insert("research/product-scout.json", "0016a6cb1b037d52");
    m.insert("research/product-signal-detector.json", "0016f53c30874a15");
    m.insert(
        "research/research-knowledge-curator.json",
        "0013042494fa5230",
    );
    m.insert("research/research-paper-indexer.json", "001afacef2c12ddf");
    m.insert(
        "research/website-market-intelligence-profiler.json",
        "001c4fc40b483e69",
    );
    m.insert("sales/contact-enrichment-agent.json", "0019ecca750e0f9e");
    m.insert("sales/lead-capture-pipeline.json", "00007a689d82c044");
    m.insert("sales/sales-proposal-generator.json", "001a2dc727bf4e51");
    m.insert("security/security-sentinel.json", "0018d42e921f2a73");
    m.insert("support/email-support-operator.json", "00157cf6033105b8");
    m.insert("support/support-escalation-engine.json", "0009ee193db1997c");
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
    let invalid_count = results
        .iter()
        .filter(|r| r.is_known_template && !r.valid)
        .count();
    let unknown_count = results.iter().filter(|r| !r.is_known_template).count();

    BatchIntegrityResult {
        all_valid: invalid_count == 0 && unknown_count == 0,
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
