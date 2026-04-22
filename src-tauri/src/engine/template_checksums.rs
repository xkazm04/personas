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
    m.insert("content/ai-document-intelligence-hub.json", "00148567472eb436");
    m.insert("content/analytics-content-distribution-use-case.json", "00017a3738b44902");
    m.insert("content/audio-briefing-host.json", "0001e909ebf02412");
    m.insert("content/autonomous-art-director.json", "00074ed23382ef10");
    m.insert("content/content-approval-workflow.json", "00035febcb9342e9");
    m.insert("content/content-performance-reporter.json", "001d3ff6be0ae7f4");
    m.insert("content/demo-recorder.json", "0006808904b7339a");
    m.insert("content/feature-video-creator.json", "000ad84a326825f3");
    m.insert("content/game-character-animator.json", "000265007bf765e7");
    m.insert("content/newsletter-curator.json", "0012632345cef7e2");
    m.insert("content/scientific-writing-editor.json", "00034841507d74e3");
    m.insert("content/social-media-designer.json", "0017529c34f7f50e");
    m.insert("content/youtube-content-pipeline.json", "000a6ddaf29f69cc");
    m.insert("development/autonomous-issue-resolver.json", "000821d0fb0b9a34");
    m.insert("development/build-intelligence-use-case.json", "001de6aa0634f449");
    m.insert("development/codebase-health-scanner.json", "0012b6bfd767780c");
    m.insert("development/design-handoff-coordinator.json", "00120e49d669ed07");
    m.insert("development/dev-clone.json", "0018db0f73de737c");
    m.insert("development/dev-lifecycle-manager.json", "00112686d402a83f");
    m.insert("development/documentation-freshness-guardian.json", "0018b2b214e38f71");
    m.insert("development/feature-flag-experiment-analyst.json", "0006165252307ed1");
    m.insert("development/feature-flag-governance-use-case.json", "0018fc77e657b296");
    m.insert("development/qa-guardian.json", "0009ab73d0ec193f");
    m.insert("development/real-time-database-watcher.json", "000b74e2d01cde83");
    m.insert("development/self-evolving-codebase-memory.json", "00082e54c8e37377");
    m.insert("development/user-lifecycle-manager.json", "0017cd6f0ec19709");
    m.insert("devops/devops-guardian.json", "000d2130d1ef996b");
    m.insert("devops/incident-logger.json", "00152135a6dc3275");
    m.insert("devops/sentry-production-monitor.json", "0011db2a4deb2300");
    m.insert("devops/telegram-ops-command-center.json", "000a3c78232c5840");
    m.insert("devops/workflow-error-intelligence.json", "00004c1bd6d1147d");
    m.insert("email/intake-processor.json", "0017df0bf1774263");
    m.insert("finance/accounting-reconciliation-use-case.json", "000f13b011a7bf93");
    m.insert("finance/budget-spending-monitor.json", "0009c134edc59d44");
    m.insert("finance/expense-receipt-processor.json", "0003d6d09aab6406");
    m.insert("finance/finance-controller.json", "0019a395cbdc732e");
    m.insert("finance/financial-stocks-signaller.json", "001cf512f1311624");
    m.insert("finance/freelancer-invoice-autopilot.json", "000f219057b60f84");
    m.insert("finance/invoice-tracker.json", "001aea7e0cacc375");
    m.insert("finance/market-intelligence-scout.json", "0009337e51e62d7c");
    m.insert("finance/personal-finance-use-case.json", "00162badc4155d6b");
    m.insert("finance/revenue-intelligence-copilot.json", "00043b11a59b4dc2");
    m.insert("finance/revenue-operations-hub.json", "001f8f327876b44b");
    m.insert("finance/subscription-billing-use-case.json", "00039352b2001720");
    m.insert("hr/onboarding-tracker.json", "0000ad16e00d7107");
    m.insert("hr/recruiting-pipeline-use-case.json", "001d6d3213cdf529");
    m.insert("legal/ai-contract-reviewer.json", "0010c0f87b77abda");
    m.insert("legal/contract-lifecycle-use-case.json", "001915ee14a98f82");
    m.insert("legal/editorial-calendar-manager.json", "0012111329694db1");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "000d38c14eff766c");
    m.insert("marketing/reddit-trend-digest.json", "0013412683ddc805");
    m.insert("marketing/visual-brand-asset-factory.json", "000c0eb3ecb8e9bc");
    m.insert("marketing/web-marketing.json", "0018adccee963d18");
    m.insert("marketing/website-conversion-audit.json", "000610e9e8281f53");
    m.insert("productivity/appointment-orchestrator.json", "001788014a9da3c5");
    m.insert("productivity/daily-standup-compiler.json", "000d70d1b8f7ac06");
    m.insert("productivity/digital-clone.json", "001cbdebf5a32701");
    m.insert("productivity/email-follow-up-tracker.json", "00001359a452bf21");
    m.insert("productivity/email-morning-digest.json", "00184e497573c93f");
    m.insert("productivity/email-task-extractor.json", "0012b7931445c346");
    m.insert("productivity/idea-harvester.json", "00097724d6148ac5");
    m.insert("productivity/meeting-lifecycle-manager.json", "0009629ff923c93f");
    m.insert("productivity/personal-capture-bot.json", "000ec436099a7cb4");
    m.insert("productivity/router.json", "001026d87bf3fc76");
    m.insert("productivity/survey-insights-analyzer.json", "001b288e89f2f2a2");
    m.insert("productivity/survey-processor.json", "001c9371eb22585c");
    m.insert("project-management/agency-client-retainer-manager.json", "0005d43d8c101a53");
    m.insert("project-management/client-portal-orchestrator.json", "00094fc9887b4133");
    m.insert("project-management/deadline-synchronizer.json", "0015134e4dbdc9cd");
    m.insert("project-management/technical-decision-tracker.json", "001f89373ac6cc42");
    m.insert("research/ai-research-report-generator.json", "0008d5fbc76e2b88");
    m.insert("research/ai-weekly-research.json", "00015d51f9adc80d");
    m.insert("research/bi-dashboard-digest.json", "001a56b14e7765b5");
    m.insert("research/conversational-database-analyst.json", "000a9b6af6f9e2a8");
    m.insert("research/customer-event-intelligence.json", "00025fde594c5a44");
    m.insert("research/database-performance-monitor.json", "000ca20436178e34");
    m.insert("research/industry-intelligence-aggregator.json", "001f90613216ee2a");
    m.insert("research/knowledge-base-health-auditor.json", "0000319eeb135139");
    m.insert("research/product-analytics-briefer.json", "001c7981f56699b3");
    m.insert("research/product-scout.json", "00008e0021d69c4b");
    m.insert("research/product-signal-detector.json", "0006b82450e2d4fe");
    m.insert("research/research-knowledge-curator.json", "0013a44b5e0eb562");
    m.insert("research/research-paper-indexer.json", "001307dbf45dfe70");
    m.insert("research/website-market-intelligence-profiler.json", "00080b0dba00add3");
    m.insert("sales/contact-enrichment-agent.json", "000c735b2e29d8a4");
    m.insert("sales/contact-sync-manager.json", "0002c035ad09913c");
    m.insert("sales/crm-data-quality-auditor.json", "000b96142bfb52b2");
    m.insert("sales/email-lead-extractor.json", "000f59a3f63047ce");
    m.insert("sales/lead-capture-pipeline.json", "0018d9572a26ebb1");
    m.insert("sales/local-business-lead-prospector.json", "0013f18a5c1cef83");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "000e4b4aecbdb68b");
    m.insert("sales/personality-enriched-sales-prep.json", "00011d0cd8c61153");
    m.insert("sales/sales-deal-analyzer.json", "000fc5b521d90306");
    m.insert("sales/sales-deal-tracker.json", "000a262f6e8a41f2");
    m.insert("sales/sales-pipeline-autopilot.json", "00094cf037cab4b4");
    m.insert("sales/sales-proposal-generator.json", "00199fdd55df5eb7");
    m.insert("sales/sheets-e-commerce-command-center.json", "000bc08fa0927f2c");
    m.insert("sales/website-conversion-auditor.json", "001a90cdb6f84412");
    m.insert("security/access-request-manager.json", "001ff378fa89f3bf");
    m.insert("security/brand-protection-sentinel.json", "0000c5b890a64f8e");
    m.insert("security/security-vulnerability-pipeline.json", "0002b49b716a7b14");
    m.insert("support/customer-feedback-router.json", "001fae97a73acecf");
    m.insert("support/email-support-assistant.json", "0017b1f4e6269e2c");
    m.insert("support/knowledge-base-review-cycle-manager.json", "00070527afe5f9d3");
    m.insert("support/support-email-router.json", "000369d42362d84d");
    m.insert("support/support-escalation-engine.json", "0004363dc79228ef");
    m.insert("support/support-intelligence-use-case.json", "001b0133fe0e4e58");
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
