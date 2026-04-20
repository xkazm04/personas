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
    m.insert("content/ai-document-intelligence-hub.json", "0016919a496517d5");
    m.insert("content/analytics-content-distribution-use-case.json", "00017a3738b44902");
    m.insert("content/audio-briefing-host.json", "0001e909ebf02412");
    m.insert("content/autonomous-art-director.json", "00074ed23382ef10");
    m.insert("content/content-approval-workflow.json", "000f2d1f31874a0c");
    m.insert("content/content-performance-reporter.json", "001d3ff6be0ae7f4");
    m.insert("content/demo-recorder.json", "0006808904b7339a");
    m.insert("content/feature-video-creator.json", "000ad84a326825f3");
    m.insert("content/game-character-animator.json", "000265007bf765e7");
    m.insert("content/newsletter-curator.json", "0012632345cef7e2");
    m.insert("content/scientific-writing-editor.json", "00034841507d74e3");
    m.insert("content/social-media-designer.json", "0017529c34f7f50e");
    m.insert("content/youtube-content-pipeline.json", "0013b772e39c240f");
    m.insert("development/autonomous-issue-resolver.json", "0010e08f16320e86");
    m.insert("development/build-intelligence-use-case.json", "0007fa660a31cc47");
    m.insert("development/codebase-health-scanner.json", "0012b6bfd767780c");
    m.insert("development/design-handoff-coordinator.json", "000f496c091b312a");
    m.insert("development/dev-clone.json", "0018db0f73de737c");
    m.insert("development/dev-lifecycle-manager.json", "000faa859d269602");
    m.insert("development/documentation-freshness-guardian.json", "001995cff0168add");
    m.insert("development/feature-flag-experiment-analyst.json", "000afcce6431a17b");
    m.insert("development/feature-flag-governance-use-case.json", "00158628bd6061ef");
    m.insert("development/qa-guardian.json", "0009ab73d0ec193f");
    m.insert("development/real-time-database-watcher.json", "00069c18f2899e3f");
    m.insert("development/self-evolving-codebase-memory.json", "00082e54c8e37377");
    m.insert("development/user-lifecycle-manager.json", "001010dd35902f82");
    m.insert("devops/devops-guardian.json", "000d2130d1ef996b");
    m.insert("devops/incident-logger.json", "00152135a6dc3275");
    m.insert("devops/sentry-production-monitor.json", "0011db2a4deb2300");
    m.insert("devops/telegram-ops-command-center.json", "000a3c78232c5840");
    m.insert("devops/workflow-error-intelligence.json", "00004c1bd6d1147d");
    m.insert("email/intake-processor.json", "0014d0f02952cade");
    m.insert("finance/accounting-reconciliation-use-case.json", "0017465c4c379159");
    m.insert("finance/budget-spending-monitor.json", "0009c134edc59d44");
    m.insert("finance/expense-receipt-processor.json", "000b112454656ec2");
    m.insert("finance/finance-controller.json", "0015a37856ad49a8");
    m.insert("finance/financial-stocks-signaller.json", "00107abb779a14a3");
    m.insert("finance/freelancer-invoice-autopilot.json", "000f219057b60f84");
    m.insert("finance/invoice-tracker.json", "001165ba7aa1578c");
    m.insert("finance/market-intelligence-scout.json", "001a0e4ac5d7e482");
    m.insert("finance/personal-finance-use-case.json", "0009beb75b5b9d3c");
    m.insert("finance/revenue-intelligence-copilot.json", "001cf7c6b4d11a76");
    m.insert("finance/revenue-operations-hub.json", "00125b005c659f23");
    m.insert("finance/subscription-billing-use-case.json", "001591797a5efa40");
    m.insert("hr/onboarding-tracker.json", "00193ac7c4a8a4ec");
    m.insert("hr/recruiting-pipeline-use-case.json", "001c61085da1184a");
    m.insert("legal/ai-contract-reviewer.json", "00059ae4acdade4b");
    m.insert("legal/contract-lifecycle-use-case.json", "00014efb3849c11f");
    m.insert("legal/editorial-calendar-manager.json", "0007968bad00a9b7");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "000d38c14eff766c");
    m.insert("marketing/reddit-trend-digest.json", "001ae5affa9ef493");
    m.insert("marketing/visual-brand-asset-factory.json", "0003585b987b5d28");
    m.insert("marketing/web-marketing.json", "0018adccee963d18");
    m.insert("marketing/website-conversion-audit.json", "000610e9e8281f53");
    m.insert("productivity/appointment-orchestrator.json", "000d7de7abdce2a5");
    m.insert("productivity/daily-standup-compiler.json", "000d70d1b8f7ac06");
    m.insert("productivity/digital-clone.json", "001d214efad8447e");
    m.insert("productivity/email-follow-up-tracker.json", "000d13d168ce90e4");
    m.insert("productivity/email-morning-digest.json", "0016767a6ad3ae1e");
    m.insert("productivity/email-task-extractor.json", "001d90275e347ef0");
    m.insert("productivity/idea-harvester.json", "00182bf4ca76d216");
    m.insert("productivity/meeting-lifecycle-manager.json", "00131a763967b9c9");
    m.insert("productivity/personal-capture-bot.json", "0004a27b10325fc9");
    m.insert("productivity/router.json", "00189ecb6c76749b");
    m.insert("productivity/survey-insights-analyzer.json", "000732b68f8c44c4");
    m.insert("productivity/survey-processor.json", "001010aed7452316");
    m.insert("project-management/agency-client-retainer-manager.json", "001c4a6c1c8a9670");
    m.insert("project-management/client-portal-orchestrator.json", "000e0b9da172c64b");
    m.insert("project-management/deadline-synchronizer.json", "0018c549347412c1");
    m.insert("project-management/technical-decision-tracker.json", "000d8192af0d4444");
    m.insert("research/ai-research-report-generator.json", "000d304028f0a04c");
    m.insert("research/ai-weekly-research.json", "00015d51f9adc80d");
    m.insert("research/bi-dashboard-digest.json", "001a56b14e7765b5");
    m.insert("research/conversational-database-analyst.json", "000a9b6af6f9e2a8");
    m.insert("research/customer-event-intelligence.json", "000300078f7b2cb5");
    m.insert("research/database-performance-monitor.json", "000ca20436178e34");
    m.insert("research/industry-intelligence-aggregator.json", "001f90613216ee2a");
    m.insert("research/knowledge-base-health-auditor.json", "0000319eeb135139");
    m.insert("research/product-analytics-briefer.json", "001c7981f56699b3");
    m.insert("research/product-scout.json", "00008e0021d69c4b");
    m.insert("research/product-signal-detector.json", "0006b82450e2d4fe");
    m.insert("research/research-knowledge-curator.json", "0013a44b5e0eb562");
    m.insert("research/research-paper-indexer.json", "001307dbf45dfe70");
    m.insert("research/website-market-intelligence-profiler.json", "00080b0dba00add3");
    m.insert("sales/contact-enrichment-agent.json", "0014e192d54d5233");
    m.insert("sales/contact-sync-manager.json", "0004eb5975726a51");
    m.insert("sales/crm-data-quality-auditor.json", "0015d4a1e5b8d09a");
    m.insert("sales/email-lead-extractor.json", "00078aa483f76432");
    m.insert("sales/lead-capture-pipeline.json", "001876ecda2d0718");
    m.insert("sales/local-business-lead-prospector.json", "0013f18a5c1cef83");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "001513d9833b40b8");
    m.insert("sales/personality-enriched-sales-prep.json", "001114014b6da75f");
    m.insert("sales/sales-deal-analyzer.json", "001c720dcde2cfba");
    m.insert("sales/sales-deal-tracker.json", "000a262f6e8a41f2");
    m.insert("sales/sales-pipeline-autopilot.json", "00094cf037cab4b4");
    m.insert("sales/sales-proposal-generator.json", "001186c69ea02110");
    m.insert("sales/sheets-e-commerce-command-center.json", "000bc08fa0927f2c");
    m.insert("sales/website-conversion-auditor.json", "001a90cdb6f84412");
    m.insert("security/access-request-manager.json", "000f24be9701ccdf");
    m.insert("security/brand-protection-sentinel.json", "000b02203e26a446");
    m.insert("security/security-vulnerability-pipeline.json", "000f82689ff9151a");
    m.insert("support/customer-feedback-router.json", "000477e2b8021c2d");
    m.insert("support/email-support-assistant.json", "0011fa5670631878");
    m.insert("support/knowledge-base-review-cycle-manager.json", "0016b03ace906130");
    m.insert("support/support-email-router.json", "00150e3cbd8f2e0c");
    m.insert("support/support-escalation-engine.json", "001766919b847c75");
    m.insert("support/support-intelligence-use-case.json", "000b066bb42fb623");
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
