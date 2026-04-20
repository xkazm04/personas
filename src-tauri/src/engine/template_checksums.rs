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
    let mut m = HashMap::with_capacity(107);
    m.insert("content/ai-document-intelligence-hub.json", "00177d803be8539a");
    m.insert("content/analytics-content-distribution-use-case.json", "00126379a9f20920");
    m.insert("content/audio-briefing-host.json", "001fc5fbd10f050a");
    m.insert("content/autonomous-art-director.json", "0015358c67c74ec8");
    m.insert("content/content-approval-workflow.json", "0003933d3ae32346");
    m.insert("content/content-performance-reporter.json", "000c69199b4a9fd2");
    m.insert("content/demo-recorder.json", "00178b31c6034d8c");
    m.insert("content/feature-video-creator.json", "0012fdc449dcca74");
    m.insert("content/game-character-animator.json", "000265007bf765e7");
    m.insert("content/newsletter-curator.json", "0010f81605b96895");
    m.insert("content/scientific-writing-editor.json", "00192b22e8f48322");
    m.insert("content/social-media-designer.json", "001f20781e342d8b");
    m.insert("content/youtube-content-pipeline.json", "000d6a42e8ad1136");
    m.insert("development/autonomous-issue-resolver.json", "001121758efee07f");
    m.insert("development/build-intelligence-use-case.json", "001beacb7c020fea");
    m.insert("development/codebase-health-scanner.json", "000459f016ec1e79");
    m.insert("development/design-handoff-coordinator.json", "001da8bdcb45616f");
    m.insert("development/dev-clone.json", "000830f23717a068");
    m.insert("development/dev-lifecycle-manager.json", "001cfa782f21300a");
    m.insert("development/documentation-freshness-guardian.json", "00006cfc38ddee2f");
    m.insert("development/feature-flag-experiment-analyst.json", "001f5fb8f156537d");
    m.insert("development/feature-flag-governance-use-case.json", "000e1412c68057bb");
    m.insert("development/qa-guardian.json", "00193839f37849c5");
    m.insert("development/real-time-database-watcher.json", "000cc6deda92e43a");
    m.insert("development/self-evolving-codebase-memory.json", "001d52932776f2a8");
    m.insert("development/user-lifecycle-manager.json", "0004a4c0cf1f21bd");
    m.insert("devops/devops-guardian.json", "00191a118384bf31");
    m.insert("devops/incident-logger.json", "001e95d651c6ad55");
    m.insert("devops/sentry-production-monitor.json", "0011dc9fba84689b");
    m.insert("devops/telegram-ops-command-center.json", "001ff189a3002b38");
    m.insert("devops/workflow-error-intelligence.json", "000a52a46bd914c8");
    m.insert("email/intake-processor.json", "0013c99cd29d8dee");
    m.insert("finance/accounting-reconciliation-use-case.json", "001784be84b542e9");
    m.insert("finance/budget-spending-monitor.json", "001af626946fcdff");
    m.insert("finance/expense-receipt-processor.json", "0001485171741009");
    m.insert("finance/finance-controller.json", "001ce4af31af91c5");
    m.insert("finance/financial-stocks-signaller.json", "00107abb779a14a3");
    m.insert("finance/freelancer-invoice-autopilot.json", "0015f56f8d8666da");
    m.insert("finance/invoice-tracker.json", "00085ec0fc79c818");
    m.insert("finance/market-intelligence-scout.json", "0001868b7da8f641");
    m.insert("finance/personal-finance-use-case.json", "000913641254d030");
    m.insert("finance/revenue-intelligence-copilot.json", "001074989607fbac");
    m.insert("finance/revenue-operations-hub.json", "000b916cbf2f6c43");
    m.insert("finance/subscription-billing-use-case.json", "001ab0ef56b39257");
    m.insert("hr/onboarding-tracker.json", "0004bfa7ef7697d5");
    m.insert("hr/recruiting-pipeline-use-case.json", "0005e7191756988c");
    m.insert("legal/ai-contract-reviewer.json", "0014ed611afae8d4");
    m.insert("legal/contract-lifecycle-use-case.json", "0009432559dee858");
    m.insert("legal/editorial-calendar-manager.json", "0018c51f3b158599");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "00165417e7af810c");
    m.insert("marketing/reddit-trend-digest.json", "0000699e2f9cc6c5");
    m.insert("marketing/visual-brand-asset-factory.json", "001f29a5dc2301bb");
    m.insert("marketing/web-marketing.json", "0018adccee963d18");
    m.insert("marketing/website-conversion-audit.json", "00140c42c71ea922");
    m.insert("productivity/appointment-orchestrator.json", "000c5d30218916e8");
    m.insert("productivity/daily-standup-compiler.json", "000d70d1b8f7ac06");
    m.insert("productivity/digital-clone.json", "001d6700e3406c64");
    m.insert("productivity/email-follow-up-tracker.json", "00058f5fbd924281");
    m.insert("productivity/email-morning-digest.json", "000899d6adef2b97");
    m.insert("productivity/email-task-extractor.json", "000bd0620c3bf8a1");
    m.insert("productivity/idea-harvester.json", "0003b1e3a88438e0");
    m.insert("productivity/meeting-lifecycle-manager.json", "001c8fc0bba5c746");
    m.insert("productivity/personal-capture-bot.json", "001b834916f17920");
    m.insert("productivity/router.json", "001b1b0d3e7ff89b");
    m.insert("productivity/survey-insights-analyzer.json", "000a43c9a3a504b1");
    m.insert("productivity/survey-processor.json", "0018f6ca2065f938");
    m.insert("project-management/agency-client-retainer-manager.json", "0009578b70fa97f9");
    m.insert("project-management/client-portal-orchestrator.json", "0004e25fdbd1d951");
    m.insert("project-management/deadline-synchronizer.json", "000b3edfd8661384");
    m.insert("project-management/technical-decision-tracker.json", "00054acc2354f001");
    m.insert("research/ai-research-report-generator.json", "00041b61c98058ba");
    m.insert("research/ai-weekly-research.json", "000fae3a3c50dbc3");
    m.insert("research/bi-dashboard-digest.json", "000b58db51ab4786");
    m.insert("research/conversational-database-analyst.json", "00194b2d446286b0");
    m.insert("research/customer-event-intelligence.json", "00042c661bb5c03f");
    m.insert("research/database-performance-monitor.json", "000a0be3798f4d4d");
    m.insert("research/industry-intelligence-aggregator.json", "001a06cad988ed40");
    m.insert("research/knowledge-base-health-auditor.json", "00189c0b9218d56a");
    m.insert("research/product-analytics-briefer.json", "0006ade89aad0bd9");
    m.insert("research/product-scout.json", "001bcb2c02a84ec8");
    m.insert("research/product-signal-detector.json", "000c0eb44c50f000");
    m.insert("research/research-knowledge-curator.json", "000e94f34e9ff7bf");
    m.insert("research/research-paper-indexer.json", "0007bc576aafd620");
    m.insert("research/website-market-intelligence-profiler.json", "001f4cbedde81f07");
    m.insert("sales/contact-enrichment-agent.json", "000b6fa1e48080dd");
    m.insert("sales/contact-sync-manager.json", "001580868b64bf26");
    m.insert("sales/crm-data-quality-auditor.json", "0011eae0d2f3d4ce");
    m.insert("sales/email-lead-extractor.json", "000f0f740b5ac916");
    m.insert("sales/lead-capture-pipeline.json", "0014212a9b0e7985");
    m.insert("sales/local-business-lead-prospector.json", "001c55a7e51d4e01");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "0010bf181a2702cd");
    m.insert("sales/personality-enriched-sales-prep.json", "000330f813a45f7f");
    m.insert("sales/sales-deal-analyzer.json", "000c4ea8ca2ddc21");
    m.insert("sales/sales-deal-tracker.json", "00116c4800762f4d");
    m.insert("sales/sales-pipeline-autopilot.json", "0003caec138f74e5");
    m.insert("sales/sales-proposal-generator.json", "0014a902156cd44d");
    m.insert("sales/sheets-e-commerce-command-center.json", "0012d1b625633231");
    m.insert("sales/website-conversion-auditor.json", "000bf19699bbb367");
    m.insert("security/access-request-manager.json", "0001e1bb731cb84b");
    m.insert("security/brand-protection-sentinel.json", "000ece4eb0650bdd");
    m.insert("security/security-vulnerability-pipeline.json", "001ed1ef1e0764d0");
    m.insert("support/customer-feedback-router.json", "001f2beabd8ebc22");
    m.insert("support/email-support-assistant.json", "000048cda40a26a8");
    m.insert("support/knowledge-base-review-cycle-manager.json", "001a5a5a066dde4b");
    m.insert("support/support-email-router.json", "00066291fe28fb23");
    m.insert("support/support-escalation-engine.json", "001c984e757705a1");
    m.insert("support/support-intelligence-use-case.json", "0000b59268302168");
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
