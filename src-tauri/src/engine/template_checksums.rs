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
    let mut m = HashMap::with_capacity(127);
    m.insert("content/ai-document-intelligence-hub.json", "001ece5d479a0048");
    m.insert("content/analytics-content-distribution-use-case.json", "001d6119defeddba");
    m.insert("content/cms-index-sync-use-case.json", "00019262b280b84b");
    m.insert("content/cms-sync-use-case.json", "0014114104ebfdb9");
    m.insert("content/content-approval-workflow.json", "00017e4fe2dbfcd4");
    m.insert("content/content-performance-reporter.json", "00081c47e44b7aad");
    m.insert("content/content-schedule-manager.json", "000b00f358a1e2c8");
    m.insert("content/newsletter-curator.json", "000cde1589076e54");
    m.insert("content/product-catalog-ai-enricher.json", "0012aa92c8cf6314");
    m.insert("content/video-knowledge-base-builder.json", "001c58345fa312a4");
    m.insert("development/autonomous-issue-resolver.json", "0015d4853c94bd3c");
    m.insert("development/build-intelligence-use-case.json", "00100c138986453f");
    m.insert("development/ci-cd-pipeline-manager.json", "0009a461f39776eb");
    m.insert("development/codebase-health-scanner.json", "000219464eee854d");
    m.insert("development/design-handoff-coordinator.json", "000285f1166e7035");
    m.insert("development/dev-lifecycle-manager.json", "0005a663e4c3661e");
    m.insert("development/documentation-freshness-guardian.json", "001cb390338b69f1");
    m.insert("development/documentation-publisher.json", "0003a6b77b4c122f");
    m.insert("development/engineering-workflow-orchestrator.json", "000652493765aebc");
    m.insert("development/feature-flag-experiment-analyst.json", "0018da2a33fdb957");
    m.insert("development/feature-flag-governance-use-case.json", "00174ebe1c40721c");
    m.insert("development/real-time-database-watcher.json", "001fa01cd470d6f1");
    m.insert("development/search-quality-monitor.json", "0008d26800bd8ec4");
    m.insert("development/sprint-automation-use-case.json", "001ad3b5188a3c8f");
    m.insert("development/sprint-documentation-use-case.json", "001814bf6717c141");
    m.insert("development/user-lifecycle-manager.json", "0005120562039c0e");
    m.insert("devops/app-performance-guardian.json", "000ee0911eabf243");
    m.insert("devops/database-health-sentinel.json", "0008c40d0d7ac976");
    m.insert("devops/deployment-guardian.json", "0019a5f5f27d552f");
    m.insert("devops/error-response-coordinator.json", "0000ca752010f421");
    m.insert("devops/incident-commander.json", "00056c04ee3b0131");
    m.insert("devops/incident-logger.json", "000e3b61f7f86242");
    m.insert("devops/infrastructure-health-use-case.json", "0019b8dc08ee9aeb");
    m.insert("devops/service-health-reporter.json", "001270d987448188");
    m.insert("devops/sre-runbook-executor.json", "00093e8b9e971a64");
    m.insert("devops/status-page-manager.json", "0010749239b304c8");
    m.insert("devops/telegram-ops-command-center.json", "001fa480bd8681d6");
    m.insert("devops/workflow-error-intelligence.json", "001b7e5cbef25366");
    m.insert("email/email-deliverability-monitor.json", "000818e5a0ea407b");
    m.insert("email/intake-processor.json", "000cc467cd3d0a40");
    m.insert("finance/accounting-reconciliation-use-case.json", "001f61e88f1fc3f5");
    m.insert("finance/budget-spending-monitor.json", "0001d590ba54a924");
    m.insert("finance/expense-receipt-processor.json", "00001d7c3622a672");
    m.insert("finance/expense-receipt-tracker.json", "0002a0f86d0423c7");
    m.insert("finance/finance-controller.json", "0017e3152fb3cbd2");
    m.insert("finance/financial-stocks-signaller.json", "0005eeb9976fbd12");
    m.insert("finance/freelancer-invoice-autopilot.json", "001a7382a9439ce8");
    m.insert("finance/invoice-tracker.json", "001379a9538122b1");
    m.insert("finance/personal-finance-use-case.json", "000bfd8c4241f6ce");
    m.insert("finance/revenue-intelligence-copilot.json", "0010c3a3e6118a3f");
    m.insert("finance/revenue-operations-hub.json", "0008f078e8842ffe");
    m.insert("finance/subscription-billing-use-case.json", "000e69d673e60e72");
    m.insert("hr/ai-resume-screener.json", "001e5f50aa387f91");
    m.insert("hr/onboarding-tracker.json", "00086e67e46c1547");
    m.insert("hr/recruiting-pipeline-use-case.json", "00048332c794c1f5");
    m.insert("legal/ai-contract-reviewer.json", "001fc70eb1fab6d7");
    m.insert("legal/contract-lifecycle-use-case.json", "001ecb90c83b9f73");
    m.insert("legal/editorial-calendar-manager.json", "0009e0b463fc615e");
    m.insert("marketing/ad-campaign-optimizer.json", "0000602fe7f2535e");
    m.insert("marketing/campaign-performance-analyst.json", "0017cf56904c672d");
    m.insert("marketing/community-engagement-scorer.json", "0007493c26f17bc9");
    m.insert("marketing/marketing-audience-sync-use-case.json", "00108bd307acd92b");
    m.insert("marketing/seo-performance-analyst.json", "000726802167b330");
    m.insert("marketing/sms-ops-manager.json", "001c17d2376b8cfc");
    m.insert("marketing/visual-brand-asset-factory.json", "00032bdbb1684efc");
    m.insert("pipeline/competitive-intelligence-pipeline-3-use-case-team.json", "000baede179922bb");
    m.insert("pipeline/customer-onboarding-pipeline-5-use-case-team.json", "000f9cd226668e93");
    m.insert("pipeline/financial-close-pipeline-4-use-case-team.json", "0014a193bf5b8dca");
    m.insert("pipeline/multi-agent-content-studio.json", "00074c9a79a12dc5");
    m.insert("pipeline/multi-channel-support-triage-pipeline-5-use-case-team.json", "0008214cfac37a0d");
    m.insert("pipeline/multi-region-e-commerce-fulfillment-pipeline-4-use-case-team.json", "001950adfe14c56f");
    m.insert("productivity/ai-cost-usage-monitor.json", "001230ff3a6dadc2");
    m.insert("productivity/appointment-orchestrator.json", "0000874c0e7b57a5");
    m.insert("productivity/cross-platform-task-synchronizer.json", "00142d38f14483d1");
    m.insert("productivity/daily-standup-compiler.json", "000f81bfedea0de7");
    m.insert("productivity/digital-clone.json", "000129952cc155df");
    m.insert("productivity/email-follow-up-tracker.json", "000900360d565634");
    m.insert("productivity/email-morning-digest.json", "000d5b9cc784787b");
    m.insert("productivity/email-task-extractor.json", "001273def5bc99af");
    m.insert("productivity/idea-harvester.json", "000df7bccba0ccae");
    m.insert("productivity/meeting-lifecycle-manager.json", "0016c03c8ce7872d");
    m.insert("productivity/notion-docs-auditor.json", "001ae97ee072030a");
    m.insert("productivity/operational-playbook-executor.json", "001016d88d79abc3");
    m.insert("productivity/personal-capture-bot.json", "0011f38674e3b506");
    m.insert("productivity/router.json", "001ca4094929533b");
    m.insert("productivity/survey-insights-analyzer.json", "0017c37d31f1c266");
    m.insert("productivity/survey-processor.json", "000da0ebca5e9268");
    m.insert("productivity/team-decision-logger.json", "00108d266f4ffe42");
    m.insert("productivity/weekly-review-reporter.json", "001e15707b484fe9");
    m.insert("project-management/client-portal-orchestrator.json", "000746e83bbc35a9");
    m.insert("project-management/deadline-synchronizer.json", "0009d9202c2e7605");
    m.insert("project-management/sheets-project-portfolio-manager.json", "00095254b1b3062c");
    m.insert("project-management/technical-decision-tracker.json", "001bca4f0102ebda");
    m.insert("project-management/weekly-planning-automator.json", "001da008ee84f946");
    m.insert("research/ai-research-report-generator.json", "001abcfe06339f5d");
    m.insert("research/ai-weekly-research.json", "0010fd1c53bd6f2f");
    m.insert("research/conversational-database-analyst.json", "0010465811003b4f");
    m.insert("research/customer-event-intelligence.json", "000c39c16f609531");
    m.insert("research/database-performance-monitor.json", "000c4eb0d4dc4a2f");
    m.insert("research/industry-intelligence-aggregator.json", "001f0e22f695fa73");
    m.insert("research/product-analytics-briefer.json", "0014cf6aceab5d97");
    m.insert("research/product-scout.json", "000b9bcd8efee616");
    m.insert("research/product-signal-detector.json", "000aabb6f00b5c41");
    m.insert("research/research-knowledge-curator.json", "0010356abb02c23b");
    m.insert("research/research-paper-indexer.json", "000a7a56913713da");
    m.insert("research/website-market-intelligence-profiler.json", "000b837a8c524e8f");
    m.insert("sales/contact-enrichment-agent.json", "00161dcc275066e1");
    m.insert("sales/contact-sync-manager.json", "001889793d8ecc9f");
    m.insert("sales/crm-data-quality-auditor.json", "00036b11e91161d8");
    m.insert("sales/email-lead-extractor.json", "00021041022afede");
    m.insert("sales/lead-capture-pipeline.json", "001ac6dbeb320ed6");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "0005c2cb39263fdd");
    m.insert("sales/personality-enriched-sales-prep.json", "0000161fad422c74");
    m.insert("sales/sales-deal-analyzer.json", "00002ad394c3bff9");
    m.insert("sales/sales-deal-tracker.json", "0010b881a9411ce4");
    m.insert("sales/sales-pipeline-autopilot.json", "000238a83698288c");
    m.insert("sales/sales-proposal-generator.json", "00197b76e79162f6");
    m.insert("sales/sheets-e-commerce-command-center.json", "000c04bba1406711");
    m.insert("security/access-request-manager.json", "0015c3519079b90a");
    m.insert("security/brand-protection-sentinel.json", "001705d0acfc7815");
    m.insert("security/security-vulnerability-pipeline.json", "001cbe8958a4f67b");
    m.insert("support/customer-feedback-router.json", "000dd1a874b20f2f");
    m.insert("support/email-support-assistant.json", "00029ab0f125ca1f");
    m.insert("support/knowledge-base-review-cycle-manager.json", "0012364c9927ce87");
    m.insert("support/support-email-router.json", "0005fdf901b8e281");
    m.insert("support/support-escalation-engine.json", "0012a1d3e500347d");
    m.insert("support/support-intelligence-use-case.json", "0016497df9b9e94a");
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
