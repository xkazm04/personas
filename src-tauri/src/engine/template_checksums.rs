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
    let mut m = HashMap::with_capacity(112);
    m.insert("content/ai-document-intelligence-hub.json", "000c0f6f57ff73ef");
    m.insert("content/analytics-content-distribution-use-case.json", "0013fbe297f12a39");
    m.insert("content/audio-briefing-host.json", "001b154e6595972a");
    m.insert("content/autonomous-art-director.json", "00042b3b92d3aa2b");
    m.insert("content/content-approval-workflow.json", "0008b27219433f3b");
    m.insert("content/content-performance-reporter.json", "001cf66ac4723746");
    m.insert("content/demo-recorder.json", "001c3128b7f4aa6c");
    m.insert("content/feature-video-creator.json", "0006f600b1dd4395");
    m.insert("content/game-character-animator.json", "0009f6b421cfac45");
    m.insert("content/newsletter-curator.json", "0006cc5eb31b53fa");
    m.insert("content/scientific-writing-editor.json", "0004c8305a7c3658");
    m.insert("content/social-media-designer.json", "0008ef6b468080a9");
    m.insert("content/youtube-content-pipeline.json", "0000708b71e85c85");
    m.insert("development/autonomous-issue-resolver.json", "0002512f372ac789");
    m.insert("development/build-intelligence-use-case.json", "001dbcfc7c33db6f");
    m.insert("development/codebase-health-scanner.json", "000282719923531f");
    m.insert("development/design-handoff-coordinator.json", "000a6cb47671324c");
    m.insert("development/dev-clone.json", "001f6a88bc752283");
    m.insert("development/dev-lifecycle-manager.json", "001bc27dca7ed880");
    m.insert("development/documentation-freshness-guardian.json", "0015e547ee2fa850");
    m.insert("development/feature-flag-experiment-analyst.json", "0014eb9956287614");
    m.insert("development/feature-flag-governance-use-case.json", "000b3cf71784566a");
    m.insert("development/lean-codebase-sentinel.json", "0007fa8a0f504ba5");
    m.insert("development/qa-guardian.json", "0009642aaf806c84");
    m.insert("development/real-time-database-watcher.json", "000ab96ae8f059be");
    m.insert("development/self-evolving-codebase-memory.json", "001325aa8b22b602");
    m.insert("development/skill-librarian.json", "0016d6eb6ebcbfe0");
    m.insert("development/user-lifecycle-manager.json", "00016c12529e934b");
    m.insert("devops/devops-guardian.json", "0018a7a91625b84c");
    m.insert("devops/incident-logger.json", "0003c2c91215f74b");
    m.insert("devops/sentry-production-monitor.json", "00162e4a6750e563");
    m.insert("devops/telegram-ops-command-center.json", "00074a1275235763");
    m.insert("devops/workflow-error-intelligence.json", "000bb3f36c9a88c2");
    m.insert("email/intake-processor.json", "0005e412929492f4");
    m.insert("finance/accounting-reconciliation-use-case.json", "001fc50ce641bec3");
    m.insert("finance/budget-spending-monitor.json", "000fd982b7da63a7");
    m.insert("finance/expense-receipt-processor.json", "0009ce8265084719");
    m.insert("finance/finance-controller.json", "00035dc6f174d5c6");
    m.insert("finance/financial-stocks-signaller.json", "0010307858969d15");
    m.insert("finance/freelancer-invoice-autopilot.json", "001adca5aa23de1f");
    m.insert("finance/invoice-tracker.json", "000a2ec7fb0dfc6d");
    m.insert("finance/market-intelligence-scout.json", "000838e55932f345");
    m.insert("finance/personal-finance-use-case.json", "000248c98558ec74");
    m.insert("finance/revenue-intelligence-copilot.json", "001bad5bb949de60");
    m.insert("finance/revenue-operations-hub.json", "000f5701931f2405");
    m.insert("finance/subscription-billing-use-case.json", "001a7a186a1c986f");
    m.insert("hr/onboarding-tracker.json", "0010f9d342d2e1c9");
    m.insert("hr/recruiting-pipeline-use-case.json", "000ab7a4d7641cac");
    m.insert("legal/ai-contract-reviewer.json", "001cbc8fe8259a2f");
    m.insert("legal/contract-lifecycle-use-case.json", "0015ff7d2fe10319");
    m.insert("legal/editorial-calendar-manager.json", "00061279bc4f0c0f");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "001118af629ec2ff");
    m.insert("marketing/content-cascade.json", "0001193f98a9ff10");
    m.insert("marketing/reddit-trend-digest.json", "001cc73bc3b3a631");
    m.insert("marketing/visual-brand-asset-factory.json", "0016d3aed1b71f43");
    m.insert("marketing/web-marketing.json", "001f894aba6e0e03");
    m.insert("marketing/website-conversion-audit.json", "0009381b6ad7d0e0");
    m.insert("productivity/appointment-orchestrator.json", "000c112d130486ae");
    m.insert("productivity/daily-standup-compiler.json", "0000fce1359780e7");
    m.insert("productivity/digital-clone.json", "001192f28c81ec92");
    m.insert("productivity/email-follow-up-tracker.json", "000af66b0a225ee1");
    m.insert("productivity/email-morning-digest.json", "001ee7716e0db975");
    m.insert("productivity/email-task-extractor.json", "001407b490e37845");
    m.insert("productivity/idea-harvester.json", "001b088b8b470404");
    m.insert("productivity/meeting-lifecycle-manager.json", "0004aaa526a2376b");
    m.insert("productivity/personal-capture-bot.json", "0003c16e3411c026");
    m.insert("productivity/router.json", "00109fa530b5aa47");
    m.insert("productivity/survey-insights-analyzer.json", "000a12970350c36b");
    m.insert("productivity/survey-processor.json", "000bf6f3e3a3228b");
    m.insert("productivity/vault-grounded-journal-coach.json", "000a58ceaa8d026a");
    m.insert("project-management/agency-client-retainer-manager.json", "001aaa5149db5bdd");
    m.insert("project-management/client-portal-orchestrator.json", "0010bdd4a961cb19");
    m.insert("project-management/deadline-synchronizer.json", "0010b5035cd7e759");
    m.insert("project-management/technical-decision-tracker.json", "000735af4ccd1e6e");
    m.insert("research/ai-research-report-generator.json", "000f5bf0f58cd874");
    m.insert("research/ai-weekly-research.json", "0014bdda0fc92d41");
    m.insert("research/bi-dashboard-digest.json", "000ad6465f83f806");
    m.insert("research/conversational-database-analyst.json", "0015498ffdaaf159");
    m.insert("research/customer-event-intelligence.json", "0017717fe08ca436");
    m.insert("research/database-performance-monitor.json", "0009ed356f3dad15");
    m.insert("research/industry-intelligence-aggregator.json", "000fcd9c265d0a91");
    m.insert("research/knowledge-base-health-auditor.json", "00107e29951d3d42");
    m.insert("research/linkedin-watchlist-scout.json", "000f0dcb7de78f54");
    m.insert("research/product-analytics-briefer.json", "00046ecb42347dbc");
    m.insert("research/product-scout.json", "001945790cd62f10");
    m.insert("research/product-signal-detector.json", "0010e6e4cd83f52c");
    m.insert("research/research-knowledge-curator.json", "0010cc43f7f46f6c");
    m.insert("research/research-paper-indexer.json", "0014171826a5c189");
    m.insert("research/website-market-intelligence-profiler.json", "000e1b35c8da06ac");
    m.insert("sales/contact-enrichment-agent.json", "0016f776bec3e5b0");
    m.insert("sales/contact-sync-manager.json", "001a4d3411a73e68");
    m.insert("sales/crm-data-quality-auditor.json", "000e2b5f98a83b04");
    m.insert("sales/email-lead-extractor.json", "0011cd4a79671baa");
    m.insert("sales/lead-capture-pipeline.json", "00164f5ec7ef17a5");
    m.insert("sales/local-business-lead-prospector.json", "0002b50dd6afc6a0");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "00063479b6f568a7");
    m.insert("sales/personality-enriched-sales-prep.json", "0009183dc487653d");
    m.insert("sales/sales-deal-analyzer.json", "000a8084ecccc714");
    m.insert("sales/sales-deal-tracker.json", "000a9314de88749a");
    m.insert("sales/sales-pipeline-autopilot.json", "0018dcf284709f3a");
    m.insert("sales/sales-proposal-generator.json", "0009504920ac79db");
    m.insert("sales/sheets-e-commerce-command-center.json", "0014524b183ba87a");
    m.insert("sales/website-conversion-auditor.json", "001731b1ba284dd4");
    m.insert("security/access-request-manager.json", "0011f96a7d410e51");
    m.insert("security/brand-protection-sentinel.json", "001633d4c2603c68");
    m.insert("security/security-vulnerability-pipeline.json", "00153295eea188aa");
    m.insert("support/customer-feedback-router.json", "0004d661f3276519");
    m.insert("support/email-support-assistant.json", "0014a8482f094547");
    m.insert("support/knowledge-base-review-cycle-manager.json", "001db1e6ac7d9ae9");
    m.insert("support/support-email-router.json", "0018aec494d861fe");
    m.insert("support/support-escalation-engine.json", "000d610cd1e95144");
    m.insert("support/support-intelligence-use-case.json", "001227fa6de9db99");
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
