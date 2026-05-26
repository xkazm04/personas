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
    let mut m = HashMap::with_capacity(109);
    m.insert("content/ai-document-intelligence-hub.json", "00197facd1d01c02");
    m.insert("content/analytics-content-distribution-use-case.json", "001cf516b81f9d45");
    m.insert("content/audio-briefing-host.json", "00133541bcc75c67");
    m.insert("content/autonomous-art-director.json", "0007a4e045d75f66");
    m.insert("content/content-approval-workflow.json", "001990d134f5145e");
    m.insert("content/content-performance-reporter.json", "001db363dbd31eb3");
    m.insert("content/demo-recorder.json", "00077655e0ff78b9");
    m.insert("content/feature-video-creator.json", "0003437ceb53f8d5");
    m.insert("content/game-character-animator.json", "000a60c8fd40fc33");
    m.insert("content/newsletter-curator.json", "000fba2ef9927179");
    m.insert("content/scientific-writing-editor.json", "0014140e174419c3");
    m.insert("content/social-media-designer.json", "00116fe4c3ad499d");
    m.insert("content/youtube-content-pipeline.json", "001dcee3756edd83");
    m.insert("development/autonomous-issue-resolver.json", "0010c5f3cd07faa2");
    m.insert("development/build-intelligence-use-case.json", "0001349ce74f80d7");
    m.insert("development/codebase-health-scanner.json", "000de3375e15adb0");
    m.insert("development/design-handoff-coordinator.json", "00130ece96fe617f");
    m.insert("development/dev-clone.json", "00088d35c8df294f");
    m.insert("development/dev-lifecycle-manager.json", "0013661c26053f17");
    m.insert("development/documentation-freshness-guardian.json", "001f1b26220f53de");
    m.insert("development/feature-flag-experiment-analyst.json", "00161084f0ebe683");
    m.insert("development/feature-flag-governance-use-case.json", "0003e753113b0ecc");
    m.insert("development/lean-codebase-sentinel.json", "000af68557f2d526");
    m.insert("development/qa-guardian.json", "0018093cccefdaf8");
    m.insert("development/real-time-database-watcher.json", "000a8316306b346b");
    m.insert("development/self-evolving-codebase-memory.json", "0010964654a6eac8");
    m.insert("development/skill-librarian.json", "001715cb96cae02f");
    m.insert("development/user-lifecycle-manager.json", "001eddcc7a2638dd");
    m.insert("devops/devops-guardian.json", "0007f1fec44d92b6");
    m.insert("devops/incident-logger.json", "001dda9e9fa6e6cd");
    m.insert("devops/sentry-production-monitor.json", "000fbd253b82f8fa");
    m.insert("devops/telegram-ops-command-center.json", "001544818958bc1a");
    m.insert("devops/workflow-error-intelligence.json", "00163aea7e79db06");
    m.insert("email/intake-processor.json", "001731b68189a8b5");
    m.insert("finance/accounting-reconciliation-use-case.json", "001add7ec2230903");
    m.insert("finance/budget-spending-monitor.json", "000a989b373865b1");
    m.insert("finance/expense-receipt-processor.json", "000c404375d68eb6");
    m.insert("finance/finance-controller.json", "000a1396a7eee626");
    m.insert("finance/financial-stocks-signaller.json", "00074f0fbda264e6");
    m.insert("finance/freelancer-invoice-autopilot.json", "00122215e7c75bf9");
    m.insert("finance/invoice-tracker.json", "001deb79d5efdef1");
    m.insert("finance/market-intelligence-scout.json", "00040c99057e647e");
    m.insert("finance/personal-finance-use-case.json", "0009562a87f8648a");
    m.insert("finance/revenue-intelligence-copilot.json", "00183627fae9b101");
    m.insert("finance/revenue-operations-hub.json", "001cb0ae95bacd48");
    m.insert("finance/subscription-billing-use-case.json", "0016cb971a5b2376");
    m.insert("hr/onboarding-tracker.json", "0002c8f12fb7362c");
    m.insert("hr/recruiting-pipeline-use-case.json", "0008c5b25f8858d4");
    m.insert("legal/ai-contract-reviewer.json", "0006e2fcb9fced3b");
    m.insert("legal/contract-lifecycle-use-case.json", "0011a7f608b18cd1");
    m.insert("legal/editorial-calendar-manager.json", "000741d21ecaf56c");
    m.insert("marketing/autonomous-cro-experiment-runner.json", "00074e4fc8afc98f");
    m.insert("marketing/content-cascade.json", "000064f3cbb7cb40");
    m.insert("marketing/reddit-trend-digest.json", "0008c6a1e957c8ba");
    m.insert("marketing/visual-brand-asset-factory.json", "0013a8348938a459");
    m.insert("marketing/web-marketing.json", "000cfbf8ee9df273");
    m.insert("marketing/website-conversion-audit.json", "000fde67b6c1daf9");
    m.insert("productivity/appointment-orchestrator.json", "000684d1af42d74e");
    m.insert("productivity/daily-standup-compiler.json", "0010ac5967d6e573");
    m.insert("productivity/digital-clone.json", "00048ec76b518ee2");
    m.insert("productivity/email-intelligence-operator.json", "001705017d6cd444");
    m.insert("productivity/email-morning-digest.json", "0019c09408fb1bd0");
    m.insert("productivity/idea-harvester.json", "00024d0acab85e27");
    m.insert("productivity/meeting-lifecycle-manager.json", "000b96af2bb2aced");
    m.insert("productivity/personal-capture-bot.json", "000e26309015ab93");
    m.insert("productivity/router.json", "0001ec02412ffdd3");
    m.insert("productivity/survey-insights-analyzer.json", "001e8f4a0282b4ea");
    m.insert("productivity/survey-processor.json", "001b4c1a20ee096e");
    m.insert("productivity/vault-grounded-journal-coach.json", "001a0c52ef41af04");
    m.insert("project-management/agency-client-retainer-manager.json", "0003903839c32973");
    m.insert("project-management/client-portal-orchestrator.json", "001957fbc6a42ca0");
    m.insert("project-management/deadline-synchronizer.json", "001a734fd4e4b972");
    m.insert("project-management/technical-decision-tracker.json", "001654d65f96a31f");
    m.insert("research/ai-research-report-generator.json", "0018e81100ace703");
    m.insert("research/ai-weekly-research.json", "000d9090e9be795b");
    m.insert("research/bi-dashboard-digest.json", "0012d28751ece7cb");
    m.insert("research/conversational-database-analyst.json", "001b1b17691cd753");
    m.insert("research/customer-event-intelligence.json", "0004768659dfde6c");
    m.insert("research/database-performance-monitor.json", "001e7465bf7651cd");
    m.insert("research/industry-intelligence-aggregator.json", "00093ce74afe78ea");
    m.insert("research/knowledge-base-health-auditor.json", "001442e2501a3655");
    m.insert("research/linkedin-watchlist-scout.json", "000f0dcb7de78f54");
    m.insert("research/product-analytics-briefer.json", "001d48c9e0a0f138");
    m.insert("research/product-scout.json", "0016a6cb1b037d52");
    m.insert("research/product-signal-detector.json", "0016f53c30874a15");
    m.insert("research/research-knowledge-curator.json", "0016bfa557b61288");
    m.insert("research/research-paper-indexer.json", "001386861beab120");
    m.insert("research/website-market-intelligence-profiler.json", "000151800632dffa");
    m.insert("sales/contact-enrichment-agent.json", "00136f1cfece1c99");
    m.insert("sales/contact-sync-manager.json", "001356ee5803b61b");
    m.insert("sales/crm-data-quality-auditor.json", "001290395e4e7aa5");
    m.insert("sales/lead-capture-pipeline.json", "00007a689d82c044");
    m.insert("sales/local-business-lead-prospector.json", "0000db709d3a6a50");
    m.insert("sales/outbound-sales-intelligence-pipeline.json", "00017a72daf5a7d0");
    m.insert("sales/personality-enriched-sales-prep.json", "001d504c7c4d93b1");
    m.insert("sales/sales-deal-intelligence.json", "0003dbbee844494d");
    m.insert("sales/sales-pipeline-autopilot.json", "000160cceca45a06");
    m.insert("sales/sales-proposal-generator.json", "0001277a83cf3749");
    m.insert("sales/sheets-e-commerce-command-center.json", "00004e89b5e6d541");
    m.insert("sales/website-conversion-auditor.json", "0012286a41c3d287");
    m.insert("security/access-request-manager.json", "000af5bd7bd7dd41");
    m.insert("security/ai-environment-posture-audit.json", "001083958169046b");
    m.insert("security/brand-protection-sentinel.json", "000f32cdae70eb33");
    m.insert("security/security-vulnerability-pipeline.json", "0011dd811434cdb9");
    m.insert("support/customer-feedback-router.json", "001eb7a4156477f9");
    m.insert("support/email-support-operator.json", "00078c7a5e85747d");
    m.insert("support/knowledge-base-review-cycle-manager.json", "00177fc9bf8b0866");
    m.insert("support/support-escalation-engine.json", "0009ee193db1997c");
    m.insert("support/support-intelligence-use-case.json", "001c39e1696c0ba4");
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
