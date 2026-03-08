/**
 * Round 9: Business-Level CLI Quality Tests
 *
 * Unlike Round 8 (generic file tasks), Round 9 sends the EXACT prompt
 * schemas the Rust engine uses and validates responses against the
 * EXACT parsers the backend runs. This tests real business output quality.
 *
 * Business tasks tested:
 *   1. Persona Design         — DESIGN_OUTPUT_SCHEMA JSON
 *   2. Credential Design      — CREDENTIAL_DESIGN_OUTPUT_SCHEMA JSON
 *   3. Credential Healthcheck — Healthcheck endpoint JSON
 *   4. N8N Transform (Turn 1) — TRANSFORM_QUESTIONS or persona JSON
 *   5. N8N Transform (Turn 2) — Section-delimited streaming output
 *   6. Test Scenario Gen      — TestScenario[] JSON array
 *   7. Persona Execution      — Protocol compliance (outcome_assessment, user_message, agent_memory)
 *   8. Template Adoption      — TRANSFORM_QUESTIONS or persona JSON from template
 *   9. Query Debug            — SQL fix with code block extraction
 *
 * Scoped via environment variables:
 *   CLI_TEST_PROVIDERS  — e.g. "claude,copilot"
 *   CLI_TEST_MODELS     — e.g. "claude-sonnet-4-6,gpt-5.4"
 *   CLI_TEST_TIERS      — e.g. "budget,standard"
 *   CLI_TEST_FEATURES   — e.g. "persona-design,credential-design"
 */
import { buildTestMatrix, getScopedFeatures } from '../helpers/providerDetection';
import { runCli } from '../helpers/cliRunner';
import { createWorkspace } from '../helpers/workspaceManager';
import { createTestDb } from '../helpers/testDatabase';
import { formatQualityReport, scoreQuality } from '../helpers/resultValidator';
import type { WorkspaceContext, FeatureArea, TestMatrixEntry } from '../helpers/types';
import type { TestDbContext } from '../helpers/testDatabase';

import {
  buildPersonaDesignPrompt,
  buildCredentialDesignPrompt,
  buildCredentialHealthcheckPrompt,
  buildN8nTransformPrompt,
  buildN8nSectionedPrompt,
  buildTestScenarioPrompt,
  buildPersonaExecutionPrompt,
  buildTemplateAdoptPrompt,
  buildQueryDebugPrompt,
} from '../helpers/businessPrompts';

import {
  extractDesignResult,
  extractCredentialDesignResult,
  extractHealthcheckResult,
  extractTransformOutput,
  parseSections,
  parseTestScenarios,
  extractPersonaExecutionResult,
  extractTemplateAdoptResult,
  extractQueryDebugResult,
} from '../helpers/businessParsers';

import {
  validateDesignResult,
  validateCredentialDesignResult,
  validateHealthcheckResult,
  validateTransformOutput,
  validateSections,
  validateTestScenarios,
  validatePersonaExecutionResult,
  validateTemplateAdoptResult,
  validateQueryDebugResult,
  scoreDimensions,
} from '../helpers/businessValidators';

const matrix = buildTestMatrix();
const scopedFeatures = getScopedFeatures();
let db: TestDbContext;
let workspace: WorkspaceContext;

beforeAll(() => {
  db = createTestDb();
});
afterAll(() => {
  db.destroy();
});
afterEach(() => {
  workspace?.destroy();
});

function isFeatureEnabled(area: FeatureArea): boolean {
  return scopedFeatures === null || scopedFeatures.includes(area);
}

function recordResult(
  entry: TestMatrixEntry,
  featureArea: string,
  testLabel: string,
  result: Awaited<ReturnType<typeof runCli>>,
  businessDims: import('../helpers/types').QualityDimension[],
) {
  const { overallScore, grade } = scoreDimensions(businessDims);
  const id = `round9-${featureArea}-${entry.provider.name}-${entry.model.id}`;

  // Also compute technical quality for the record
  const techQuality = scoreQuality(result, featureArea, []);

  db.recordExecution({
    id,
    round: 'round9',
    testName: `${featureArea}: ${testLabel}`,
    provider: entry.provider.name,
    model: entry.model.id,
    status: overallScore >= 0.4 ? 'pass' : 'fail',
    score: overallScore,
    durationMs: result.totalDurationMs,
    costUsd: result.reportedCostUsd ?? 0,
    inputTokens: result.reportedInputTokens ?? 0,
    outputTokens: result.reportedOutputTokens ?? 0,
    toolCallCount: result.toolCallCount,
    toolsUsed: JSON.stringify(result.toolsUsed),
    assistantTextLength: result.assistantText.length,
    errorMessage: result.timedOut ? 'Timed out' : undefined,
    validationDetails: JSON.stringify({
      grade,
      overallScore,
      dimensions: businessDims.map(d => ({ name: d.name, score: d.score, detail: d.detail })),
      technical: formatQualityReport(techQuality),
    }),
  });

  console.log(`\n  [${entry.provider.displayName}/${entry.model.label}] ${featureArea}`);
  console.log(`  Business Grade: ${grade} (${(overallScore * 100).toFixed(0)}%)`);
  for (const d of businessDims) {
    const icon = d.score >= 0.8 ? 'PASS' : d.score >= 0.4 ? 'PARTIAL' : 'FAIL';
    console.log(`    [${icon}] ${d.name}: ${(d.score * 100).toFixed(0)}% — ${d.detail}`);
  }

  return { overallScore, grade };
}

// ═══════════════════════════════════════════════════════════════════════════
// Business-level tests
// ═══════════════════════════════════════════════════════════════════════════

for (const entry of matrix) {
  describe(`${entry.provider.displayName} / ${entry.model.label} [Business]`, () => {
    // ─── 1. Persona Design (real DESIGN_OUTPUT_SCHEMA) ─────────────────
    if (isFeatureEnabled('persona-design')) {
      it('persona-design: produces parseable DESIGN_OUTPUT_SCHEMA JSON', async () => {
        workspace = createWorkspace('empty');

        const prompt = buildPersonaDesignPrompt({
          personaName: 'Customer Support Agent',
          personaDescription: 'Handles customer inquiries, billing issues, and bug reports for a SaaS product',
          instruction: 'Design a customer support persona that can handle billing disputes, technical questions, and bug reports. Should escalate complex issues to human agents.',
          tools: ['knowledge_base_search', 'ticket_create', 'escalation_trigger', 'user_lookup'],
          connectors: ['zendesk', 'stripe', 'jira'],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output ONLY the JSON as specified — no extra text.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        // Parse with real parser
        const parsed = extractDesignResult(result.assistantText);
        const dims = validateDesignResult(parsed);
        const { overallScore } = recordResult(entry, 'persona-design', 'DESIGN_OUTPUT_SCHEMA compliance', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 2. Credential Design (real CREDENTIAL_DESIGN_OUTPUT_SCHEMA) ──
    if (isFeatureEnabled('credential-design')) {
      it('credential-design: produces parseable CREDENTIAL_DESIGN_OUTPUT_SCHEMA JSON', async () => {
        workspace = createWorkspace('empty');

        const prompt = buildCredentialDesignPrompt({
          serviceDescription: 'I need to connect to the Twilio API for sending SMS messages and making phone calls. I have an Account SID and Auth Token from my Twilio console.',
          existingConnectors: ['stripe', 'slack', 'github'],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output ONLY the JSON as specified — no extra text.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const parsed = extractCredentialDesignResult(result.assistantText);
        const dims = validateCredentialDesignResult(parsed);
        const { overallScore } = recordResult(entry, 'credential-design', 'CREDENTIAL_DESIGN schema compliance', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 3. Credential Healthcheck ────────────────────────────────────
    if (isFeatureEnabled('credential-healthcheck')) {
      it('credential-healthcheck: produces parseable healthcheck JSON', async () => {
        workspace = createWorkspace('empty');

        const connectorJson = JSON.stringify({
          name: 'openai',
          label: 'OpenAI',
          category: 'ai',
          fields: [
            { key: 'api_key', label: 'API Key', type: 'password', required: true },
            { key: 'org_id', label: 'Organization ID', type: 'text', required: false },
          ],
        }, null, 2);

        const prompt = buildCredentialHealthcheckPrompt({
          serviceDescription: 'OpenAI API for GPT model access',
          connectorJson,
          fieldKeys: ['api_key', 'org_id'],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output ONLY the JSON as specified — no extra text.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const parsed = extractHealthcheckResult(result.assistantText);
        const dims = validateHealthcheckResult(parsed);
        const { overallScore } = recordResult(entry, 'credential-healthcheck', 'healthcheck endpoint design', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 180_000);
    }

    // ─── 4. N8N Transform Turn 1 (questions or persona) ──────────────
    if (isFeatureEnabled('n8n-transform')) {
      it('n8n-transform: produces TRANSFORM_QUESTIONS or persona from workflow', async () => {
        workspace = createWorkspace('n8n-workflow');

        const workflowJson = workspace.readFile('workflow.json') ?? '{}';
        const prompt = buildN8nTransformPrompt({
          workflowName: 'Email to Slack Notification',
          workflowJson,
          availableConnectors: ['slack', 'gmail', 'imap'],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output either TRANSFORM_QUESTIONS or a persona JSON — not both.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const parsed = extractTransformOutput(result.assistantText);
        const dims = validateTransformOutput(parsed);
        const { overallScore } = recordResult(entry, 'n8n-transform', 'Turn 1 questions/persona', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 5. N8N Transform Turn 2 (section-delimited) ─────────────────
    if (isFeatureEnabled('automation-design')) {
      it('automation-design: produces section-delimited persona output', async () => {
        workspace = createWorkspace('n8n-workflow');

        const workflowJson = workspace.readFile('workflow.json') ?? '{}';
        const prompt = buildN8nSectionedPrompt({
          workflowName: 'Email to Slack Notification',
          workflowJson,
          userAnswers: {
            q_hitl: 'Require approval for messages containing "urgent" or "critical"',
            q_memory: 'Remember frequently contacted channels and auto-suggest',
            q_notify: 'Send summary to #ops-log channel daily',
          },
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the section-delimited output format EXACTLY. Each ---SECTION:type--- must be on its own line followed by valid JSON.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const sections = parseSections(result.assistantText);
        const dims = validateSections(sections);
        const { overallScore } = recordResult(entry, 'automation-design', 'section-delimited persona', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.3);
      }, 240_000);
    }

    // ─── 6. Test Scenario Generation ─────────────────────────────────
    if (isFeatureEnabled('persona-testing')) {
      it('persona-testing: generates parseable TestScenario[] JSON', async () => {
        workspace = createWorkspace('empty');

        const prompt = buildTestScenarioPrompt({
          agentName: 'Invoice Processor',
          agentDescription: 'Processes incoming invoices, extracts line items, and creates accounting entries',
          agentPrompt: 'You are an invoice processing agent. Extract vendor, amount, line items, and due date from invoices. Create journal entries in the accounting system. Flag duplicate invoices.',
          tools: [
            { name: 'ocr_extract', description: 'Extract text from PDF/image invoices' },
            { name: 'accounting_create_entry', description: 'Create a journal entry in the accounting system', inputSchema: '{"vendor": "string", "amount": "number", "line_items": "array"}' },
            { name: 'duplicate_check', description: 'Check if invoice has been processed before by vendor+amount+date' },
            { name: 'notify_approver', description: 'Send invoice for manual approval if amount exceeds threshold' },
          ],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output ONLY the JSON array — no extra text.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const parsed = parseTestScenarios(result.assistantText);
        const dims = validateTestScenarios(parsed, ['ocr_extract', 'accounting_create_entry', 'duplicate_check', 'notify_approver']);
        const { overallScore } = recordResult(entry, 'persona-testing', 'TestScenario[] generation', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 7. Persona Execution (protocol compliance) ───────────────────
    if (isFeatureEnabled('persona-execution')) {
      it('persona-execution: produces protocol-compliant output with outcome_assessment', async () => {
        workspace = createWorkspace('empty');

        const prompt = buildPersonaExecutionPrompt({
          personaName: 'Daily Report Agent',
          personaDescription: 'Aggregates metrics from multiple sources and produces a daily summary report for the operations team',
          systemPrompt: 'You are a daily reporting agent. Collect data from monitoring dashboards, ticket systems, and deployment logs. Produce a concise summary with key metrics, incidents, and action items. Always end with an outcome assessment.',
          tools: ['dashboard_query', 'ticket_search', 'deploy_log_fetch', 'report_publish'],
          inputData: JSON.stringify({
            date: '2026-03-06',
            sources: ['grafana', 'jira', 'github-actions'],
            report_channel: '#ops-daily',
            thresholds: { error_rate: 0.05, p99_latency_ms: 500 },
          }, null, 2),
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow ALL instructions exactly. You MUST use the JSON communication protocols specified, especially outcome_assessment at the end.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const parsed = extractPersonaExecutionResult(result.assistantText);
        const dims = validatePersonaExecutionResult(parsed);
        const { overallScore } = recordResult(entry, 'persona-execution', 'protocol compliance', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 8. Template Adoption (TRANSFORM_QUESTIONS or persona) ────────
    if (isFeatureEnabled('template-adopt')) {
      it('template-adopt: produces TRANSFORM_QUESTIONS or persona JSON from template', async () => {
        workspace = createWorkspace('empty');

        const prompt = buildTemplateAdoptPrompt({
          templateName: 'GitHub PR Review Bot',
          templateDescription: 'Automatically reviews pull requests, checks for code quality issues, runs linting, and posts review comments. Can approve or request changes based on configurable rules.',
          templateTools: ['github_pr_list', 'github_pr_diff', 'github_pr_comment', 'github_pr_review', 'eslint_run'],
          templateTriggers: [
            { type: 'webhook', description: 'Triggered on PR opened or updated events via GitHub webhook' },
            { type: 'schedule', description: 'Daily sweep for stale PRs older than 48h' },
          ],
          availableConnectors: ['github', 'slack', 'linear'],
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output ONLY the chosen format (TRANSFORM_QUESTIONS or persona JSON) — no additional text.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 180_000,
        });

        const parsed = extractTemplateAdoptResult(result.assistantText);
        const dims = validateTemplateAdoptResult(parsed);
        const { overallScore } = recordResult(entry, 'template-adopt', 'template adoption output', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 240_000);
    }

    // ─── 9. Query Debug (SQL fix + code block extraction) ─────────────
    if (isFeatureEnabled('query-debug')) {
      it('query-debug: fixes broken SQL and returns corrected query in code block', async () => {
        workspace = createWorkspace('empty');

        const brokenQuery = `SELCET u.name, u.emal, COUNT(o.id) as order_count
FROM usres u
LEFT JION orders o ON u.id = o.user_id
WERE u.status = 'active'
  AND o.created_at > '2026-01-01'
GRUOP BY u.name
HAVING order_count > 5
ORDER BY order_count DES
LIMT 20;`;

        const prompt = buildQueryDebugPrompt({
          serviceType: 'PostgreSQL 15',
          connectorFamily: 'postgresql',
          schemaInfo: `Tables:
- users (id SERIAL PK, name VARCHAR(100), email VARCHAR(255), status VARCHAR(20), created_at TIMESTAMP)
- orders (id SERIAL PK, user_id INT FK->users.id, total DECIMAL(10,2), created_at TIMESTAMP, status VARCHAR(20))`,
          queryText: brokenQuery,
          errorContext: 'ERROR: syntax error at or near "SELCET" at character 1',
        });

        workspace.writeFile('prompt.txt', prompt);

        const result = await runCli({
          provider: entry.provider.name,
          prompt: `Read prompt.txt and follow the instructions exactly. Output the corrected SQL in a \`\`\`sql code block, then briefly explain fixes.`,
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const parsed = extractQueryDebugResult(result.assistantText);
        const dims = validateQueryDebugResult(parsed, brokenQuery);
        const { overallScore } = recordResult(entry, 'query-debug', 'SQL fix + code block', result, dims);

        expect(overallScore).toBeGreaterThanOrEqual(0.4);
      }, 180_000);
    }
  });
}
