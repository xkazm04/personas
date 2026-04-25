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
    let mut m = HashMap::with_capacity(108);
    m.insert("content/ai-document-intelligence-hub.json", "00144a8de851d499");
    m.insert("content/analytics-content-distribution-use-case.json", "001b6de883d1fd73");
    m.insert("content/audio-briefing-host.json", "001b4b607ea6030f");
    m.insert("content/autonomous-art-director.json", "000e8eb93bfd6d60");
    m.insert("content/content-approval-workflow.json", "00096af9af7494c8");
    m.insert("content/content-performance-reporter.json", "000ee6a9af036fbf");
    m.insert("content/demo-recorder.json", "001f707093bc56da");
    m.insert("content/feature-video-creator.json", "001e0af3f00d6dab");
    m.insert("content/game-character-animator.json", "0014bf4392541220");
    m.insert("content/newsletter-curator.json", "0006ab4b628fb09b");
    m.insert("content/scientific-writing-editor.json", "001f58e31652ca34");
    m.insert("content/social-media-designer.json", "0014784b9c2b3d95");
    m.insert("content/youtube-content-pipeline.json", "0018b018139ccde1");
    m.insert("development/autonomous-issue-resolver.json", "001d8c47361ac73a");
    m.insert("development/build-intelligence-use-case.json", "001833b3a4fdf2e8");
    m.insert("development/codebase-health-scanner.json", "000fb3d23ccd6b9d");
    m.insert("development/design-handoff-coordinator.json", "0007c93e4a36900d");
    m.insert("development/dev-clone.json", "0002faafcac2a4ef");
    m.insert("development/dev-lifecycle-manager.json", "0018510af7df4cb8");
    m.insert("development/documentation-freshness-guardian.json", "000d6f8b16a8db17");
    m.insert("development/feature-flag-experiment-analyst.json", "00116bcbfa3da659");
    m.insert("development/feature-flag-governance-use-case.json", "0000986d711116e5");
    m.insert("development/qa-guardian.json", "00045a4d8af01aa2");
    m.insert("development/real-time-database-watcher.json", "00101c6682c7f329");
    m.insert("development/self-evolving-codebase-memory.json", "000847cdc27d1efb");
    m.insert("development/skill-librarian.json", "001fbf3a5f292e84");
    m.insert("development/user-lifecycle-manager.json", "001671352a0b2a7a");
    m.insert("devops/devops-guardian.json", "001e3b3570d471dd");
    m.insert("devops/incident-logger.json", "000518079c5a0214");
    m.insert("devops/sentry-production-monitor.json", "001e94bc7479f3f3");
    m.insert("devops/telegram-ops-command-center.json", "00168f20f05fc947");
    m.insert("devops/workflow-error-intelligence.json", "0017564afa1b4606");
    m.insert("email/intake-processor.json", "001b97085edd5e6f");
    m.insert("finance/accounting-reconciliation-use-case.json", "001bbb59f18e94fa");
    m.insert("finance/budget-spending-monitor.json", "0017101dd04ae1a7");
    m.insert("finance/expense-receipt-processor.json", "000f61fa40e665b2");
    m.insert("finance/finance-controller.json", "00090d18f6aa59a4");
    m.insert("finance/financial-stocks-signaller.json", "001cf512f1311624");
    m.insert("finance/freelancer-invoice-autopilot.json", "00103e94c3df1cd0");
    m.insert("finance/invoice-tracker.json", "0009637314726c15");
    m.insert("finance/market-intelligence-scout.json", "0015c90ae0c33ba6");
    m.insert("finance/personal-finance-use-case.json", "00087896b1174ad7");
    m.insert("finance/revenue-intelligence-copilot.json", "00073cd752b35f45");
    m.insert("finance/revenue-operations-hub.json", "000062ee95435e19");
    m.insert("finance/subscription-billing-use-case.json", "001de974c4d45dff");
    m.insert("hr/onboarding-tracker.json", "0010ff28247bab6c");
    m.insert("hr/recruiting-pipeline-use-case.json", "0018423085e9c472");
    m.insert("legal/ai-contract-reviewer.json", "000e8cb30573c6fb");
    m.insert("legal/contract-lifecycle-use-case.json", "00191ef2511f73a5");
    m.insert("legal/editorial-calendar-manager.json", "0012bf7418d4c4fd");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "000d1b683dc109ea");
    m.insert("marketing/reddit-trend-digest.json", "0019ddd2c5ea7f12");
    m.insert("marketing/visual-brand-asset-factory.json", "001be03964d2083e");
    m.insert("marketing/web-marketing.json", "001d2369d0685a6a");
    m.insert("marketing/website-conversion-audit.json", "000610e9e8281f53");
    m.insert("productivity/appointment-orchestrator.json", "001a8056632b1759");
    m.insert("productivity/daily-standup-compiler.json", "000d70d1b8f7ac06");
    m.insert("productivity/digital-clone.json", "00127695c762fad4");
    m.insert("productivity/email-follow-up-tracker.json", "0015695e946b5d76");
    m.insert("productivity/email-morning-digest.json", "001fec9cdf7e97a0");
    m.insert("productivity/email-task-extractor.json", "00184c0abaebaaaf");
    m.insert("productivity/idea-harvester.json", "001e9be215d8db30");
    m.insert("productivity/meeting-lifecycle-manager.json", "001ea4b0642e8c8b");
    m.insert("productivity/personal-capture-bot.json", "0019ebb2baa6d788");
    m.insert("productivity/router.json", "0019c0f8d207c343");
    m.insert("productivity/survey-insights-analyzer.json", "000ab234ea960386");
    m.insert("productivity/survey-processor.json", "000ae55cfa2a0e9e");
    m.insert("project-management/agency-client-retainer-manager.json", "00047d954b9ea3d7");
    m.insert("project-management/client-portal-orchestrator.json", "000df4db709c4315");
    m.insert("project-management/deadline-synchronizer.json", "0017b8f142ccd5e3");
    m.insert("project-management/technical-decision-tracker.json", "00130edf904d704e");
    m.insert("research/ai-research-report-generator.json", "0015ed5ab05be607");
    m.insert("research/ai-weekly-research.json", "00147d8b2d8a85d7");
    m.insert("research/bi-dashboard-digest.json", "000691179cb4d5f0");
    m.insert("research/conversational-database-analyst.json", "0008a620879cc3ad");
    m.insert("research/customer-event-intelligence.json", "000daf1a4975bfa3");
    m.insert("research/database-performance-monitor.json", "000476cbbe9ba656");
    m.insert("research/industry-intelligence-aggregator.json", "001825c2f54254b8");
    m.insert("research/knowledge-base-health-auditor.json", "001bf4d7f7ea865a");
    m.insert("research/product-analytics-briefer.json", "000d0a629de1eb79");
    m.insert("research/product-scout.json", "000e7e5f002b78d2");
    m.insert("research/product-signal-detector.json", "0018c01a50eeb8a4");
    m.insert("research/research-knowledge-curator.json", "0001c2c5b28962ca");
    m.insert("research/research-paper-indexer.json", "00155a864d86f3b2");
    m.insert("research/website-market-intelligence-profiler.json", "00152e61b3a558d8");
    m.insert("sales/contact-enrichment-agent.json", "0019fd72fa76928b");
    m.insert("sales/contact-sync-manager.json", "00101daea96ab15b");
    m.insert("sales/crm-data-quality-auditor.json", "001c9c132e5c40bf");
    m.insert("sales/email-lead-extractor.json", "0008bb8223dbaf2e");
    m.insert("sales/lead-capture-pipeline.json", "001f9d3263f0858b");
    m.insert("sales/local-business-lead-prospector.json", "0013f18a5c1cef83");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "0000f555e6ed586e");
    m.insert("sales/personality-enriched-sales-prep.json", "001d27592f03d7e1");
    m.insert("sales/sales-deal-analyzer.json", "0011cdaf64c3716f");
    m.insert("sales/sales-deal-tracker.json", "00104419aa339cfe");
    m.insert("sales/sales-pipeline-autopilot.json", "0002f86edfa85791");
    m.insert("sales/sales-proposal-generator.json", "0018a0054d808bc8");
    m.insert("sales/sheets-e-commerce-command-center.json", "0018a1f2f3ba2a57");
    m.insert("sales/website-conversion-auditor.json", "000c9f23f923ec7f");
    m.insert("security/access-request-manager.json", "00117b0aef4aa353");
    m.insert("security/brand-protection-sentinel.json", "00084938872002bc");
    m.insert("security/security-vulnerability-pipeline.json", "0003c75755f92af0");
    m.insert("support/customer-feedback-router.json", "0009bc096a426f80");
    m.insert("support/email-support-assistant.json", "000e1da6d9cd68e1");
    m.insert("support/knowledge-base-review-cycle-manager.json", "00021b5c1a85a1c4");
    m.insert("support/support-email-router.json", "0001aaca1d4721b7");
    m.insert("support/support-escalation-engine.json", "001d438318d1ccc5");
    m.insert("support/support-intelligence-use-case.json", "001f482b822bdb1b");
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
