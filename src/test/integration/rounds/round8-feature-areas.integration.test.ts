/**
 * Round 8: Feature Area Quality Tests -- Real tasks from each feature area
 * in the Personas app, run against configurable provider/model combos.
 *
 * Scoped via environment variables:
 *   CLI_TEST_PROVIDERS  -- e.g. "claude,copilot"
 *   CLI_TEST_MODELS     -- e.g. "claude-sonnet-4-6,gpt-5.4"
 *   CLI_TEST_TIERS      -- e.g. "budget,standard"
 *   CLI_TEST_FEATURES   -- e.g. "persona-design,healing-diagnosis"
 */
import { buildTestMatrix, getScopedFeatures } from '../helpers/providerDetection';
import { runCli } from '../helpers/cliRunner';
import { createWorkspace } from '../helpers/workspaceManager';
import { createTestDb } from '../helpers/testDatabase';
import { validateResult, formatDiagnostic, scoreQuality, formatQualityReport } from '../helpers/resultValidator';
import type { WorkspaceContext, FeatureArea, TestMatrixEntry } from '../helpers/types';
import type { TestDbContext } from '../helpers/testDatabase';

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

function recordAndAssert(
  entry: TestMatrixEntry,
  featureArea: FeatureArea,
  testLabel: string,
  result: Awaited<ReturnType<typeof runCli>>,
  validation: ReturnType<typeof validateResult>,
  qualityReport?: ReturnType<typeof scoreQuality>,
) {
  const id = `round8-${featureArea}-${entry.provider.name}-${entry.model.id}`;

  db.recordExecution({
    id,
    round: 'round8',
    testName: `${featureArea}: ${testLabel}`,
    provider: entry.provider.name,
    model: entry.model.id,
    status: validation.passed ? 'pass' : 'fail',
    score: qualityReport?.overallScore ?? validation.score,
    durationMs: result.totalDurationMs,
    costUsd: result.reportedCostUsd ?? 0,
    inputTokens: result.reportedInputTokens ?? 0,
    outputTokens: result.reportedOutputTokens ?? 0,
    toolCallCount: result.toolCallCount,
    toolsUsed: JSON.stringify(result.toolsUsed),
    assistantTextLength: result.assistantText.length,
    errorMessage: result.timedOut ? 'Timed out' : undefined,
    validationDetails: JSON.stringify({
      validation: validation.details,
      quality: qualityReport ? formatQualityReport(qualityReport) : undefined,
    }),
  });

  if (qualityReport) {
    console.log(`\n  [${entry.provider.displayName}/${entry.model.label}] ${featureArea}`);
    console.log(`  ${formatQualityReport(qualityReport).replace(/\n/g, '\n  ')}`);
  }

  expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
}

// ===========================================================================
// Feature area tests
// ===========================================================================

for (const entry of matrix) {
  describe(`${entry.provider.displayName} / ${entry.model.label}`, () => {
    // --- Persona Design -------------------------------------------------
    if (isFeatureEnabled('persona-design')) {
      it('persona-design: generates system prompt from brief', async () => {
        workspace = createWorkspace('persona-design');

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read persona_brief.md in the current directory.',
            'Based on the brief, generate a complete system prompt for this persona.',
            'The system prompt should include:',
            '1. A clear role definition',
            '2. Behavioral guidelines matching the tone',
            '3. Specific rules for each capability listed',
            '4. Guardrails for each constraint',
            'Write the system prompt to system_prompt.txt.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['system_prompt.txt'],
            toolsUsed: ['read', 'write'],
            custom: (res) => {
              const text = (workspace.readFile('system_prompt.txt') ?? res.assistantText).toLowerCase();
              const hasRole = /customer support|support agent/i.test(text);
              const hasTone = /empathetic|professional|solution/i.test(text);
              const hasEscalation = /escalat|billing|finance/i.test(text);
              const hasConstraint = /never share|internal pricing|verify.*identity/i.test(text);
              const score = [hasRole, hasTone, hasEscalation, hasConstraint].filter(Boolean).length;
              return {
                passed: score >= 3,
                detail: `Covered ${score}/4 brief elements (role=${hasRole}, tone=${hasTone}, escalation=${hasEscalation}, constraints=${hasConstraint})`,
              };
            },
          },
          workspace,
        );

        const quality = scoreQuality(result, 'persona-design', [
          {
            name: 'Brief Coverage',
            weight: 3,
            check: (text) => {
              const file = workspace.readFile('system_prompt.txt') ?? text;
              const lower = file.toLowerCase();
              const elements = [
                /customer support|support agent/.test(lower),
                /empathetic|professional/.test(lower),
                /knowledge base|product question/.test(lower),
                /escalat|billing/.test(lower),
                /bug report|issue tracker/.test(lower),
                /never share|pricing formula/.test(lower),
                /verify.*identity|identity.*verif/.test(lower),
              ];
              const covered = elements.filter(Boolean).length;
              return { score: covered / elements.length, detail: `${covered}/7 brief elements` };
            },
          },
          {
            name: 'Prompt Structure',
            weight: 2,
            check: (text) => {
              const file = workspace.readFile('system_prompt.txt') ?? text;
              const hasHeaders = /#{1,3}\s|role|guidelines|rules|constraints/i.test(file);
              const hasNumberedRules = /\d+[.)]\s/.test(file);
              const goodLength = file.length > 300 && file.length < 5000;
              const score = [hasHeaders, hasNumberedRules, goodLength].filter(Boolean).length / 3;
              return { score, detail: `headers=${hasHeaders}, numbered=${hasNumberedRules}, length=${goodLength}` };
            },
          },
        ]);

        recordAndAssert(entry, 'persona-design', 'system prompt from brief', result, validation, quality);
      }, 180_000);
    }

    // --- Credential Design ----------------------------------------------
    if (isFeatureEnabled('credential-design')) {
      it('credential-design: generates setup guide from connector spec', async () => {
        workspace = createWorkspace('credential-design');

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read connector_spec.json in the current directory.',
            'Generate a step-by-step credential setup guide for this connector.',
            'Include:',
            '1. Where to find the API keys (use the docs_url)',
            '2. Step-by-step instructions with specific UI elements to click',
            '3. How to verify the credential works (use the test_endpoint)',
            '4. Security best practices (key rotation, least privilege)',
            'Write the guide to setup_guide.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['setup_guide.md'],
            toolsUsed: ['read', 'write'],
          },
          workspace,
        );

        const quality = scoreQuality(result, 'credential-design', [
          {
            name: 'Connector Accuracy',
            weight: 3,
            check: () => {
              const guide = (workspace.readFile('setup_guide.md') ?? '').toLowerCase();
              const mentions = [
                /stripe/.test(guide),
                /secret.?key|sk_(test|live)/.test(guide),
                /dashboard\.stripe\.com|apikeys/.test(guide),
                /api\.stripe\.com.*balance|test.*endpoint/.test(guide),
              ];
              const score = mentions.filter(Boolean).length / mentions.length;
              return { score, detail: `${mentions.filter(Boolean).length}/4 spec elements` };
            },
          },
          {
            name: 'Actionable Steps',
            weight: 2,
            check: () => {
              const guide = (workspace.readFile('setup_guide.md') ?? '').toLowerCase();
              const hasSteps = /step\s*\d|1[.)]\s|first.*then/i.test(guide);
              const hasUiTerms = ['click', 'navigate', 'select', 'copy'].filter((t) => guide.includes(t)).length >= 2;
              const hasSecurity = /rotat|least.*privilege|restrict|scope|permission/i.test(guide);
              const score = [hasSteps, hasUiTerms, hasSecurity].filter(Boolean).length / 3;
              return { score, detail: `steps=${hasSteps}, ui=${hasUiTerms}, security=${hasSecurity}` };
            },
          },
        ]);

        recordAndAssert(entry, 'credential-design', 'setup guide from spec', result, validation, quality);
      }, 180_000);
    }

    // --- N8N Transform --------------------------------------------------
    if (isFeatureEnabled('n8n-transform')) {
      it('n8n-transform: analyzes workflow and suggests personas', async () => {
        workspace = createWorkspace('n8n-workflow');

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read workflow.json in the current directory. It is an n8n workflow definition.',
            'Analyze the workflow and:',
            '1. Describe what this workflow does in plain language',
            '2. Identify the connectors/services used (e.g. Email, Slack)',
            '3. Suggest which Persona agents could replace or enhance each node',
            '4. List the credentials that would be needed',
            'Write your analysis to workflow_analysis.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['workflow_analysis.md'],
            toolsUsed: ['read', 'write'],
          },
          workspace,
        );

        const quality = scoreQuality(result, 'n8n-transform', [
          {
            name: 'Workflow Understanding',
            weight: 3,
            check: () => {
              const analysis = (workspace.readFile('workflow_analysis.md') ?? '').toLowerCase();
              const concepts = [
                /email.*trigger|incoming.*email|receive.*email/.test(analysis),
                /slack.*notif|send.*slack|post.*slack/.test(analysis),
                /subject|extract/.test(analysis),
                /credential|api.*key|token|auth/.test(analysis),
              ];
              const score = concepts.filter(Boolean).length / concepts.length;
              return { score, detail: `${concepts.filter(Boolean).length}/4 workflow concepts` };
            },
          },
          {
            name: 'Persona Mapping',
            weight: 2,
            check: () => {
              const analysis = (workspace.readFile('workflow_analysis.md') ?? '').toLowerCase();
              const hasPersonaSuggestion = /persona|agent|automat/.test(analysis);
              const hasConnectorList = /connector|service|integration/.test(analysis);
              const score = [hasPersonaSuggestion, hasConnectorList].filter(Boolean).length / 2;
              return { score, detail: `personas=${hasPersonaSuggestion}, connectors=${hasConnectorList}` };
            },
          },
        ]);

        recordAndAssert(entry, 'n8n-transform', 'workflow analysis', result, validation, quality);
      }, 180_000);
    }

    // --- Healing Diagnosis ----------------------------------------------
    if (isFeatureEnabled('healing-diagnosis')) {
      it('healing-diagnosis: diagnoses connector failure from logs', async () => {
        workspace = createWorkspace('healing-diagnosis');

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read error_log.txt and connector_config.json in the current directory.',
            'Diagnose the problem:',
            '1. What is the root cause of the failure?',
            '2. Why did the pipeline halt?',
            '3. What specific action should fix it?',
            '4. What preventive measures would avoid recurrence?',
            'Write your diagnosis to diagnosis_report.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['diagnosis_report.md'],
            toolsUsed: ['read', 'write'],
          },
          workspace,
        );

        const quality = scoreQuality(result, 'healing-diagnosis', [
          {
            name: 'Root Cause Accuracy',
            weight: 3,
            check: () => {
              const diag = (workspace.readFile('diagnosis_report.md') ?? '').toLowerCase();
              const rootCause = [
                /expired|401|unauthorized/.test(diag),
                /credential|api.*key|secret.*key|token.*expir/.test(diag),
                /rotat|renew|refresh|regenerat|new.*key/.test(diag),
              ];
              const score = rootCause.filter(Boolean).length / rootCause.length;
              return { score, detail: `${rootCause.filter(Boolean).length}/3 root cause elements` };
            },
          },
          {
            name: 'Actionable Fix',
            weight: 2,
            check: () => {
              const diag = (workspace.readFile('diagnosis_report.md') ?? '').toLowerCase();
              const hasSpecificFix = /rotat|regenerat|new.*key|update.*credential|replace.*key/.test(diag);
              const hasPrevention = /schedul.*rotat|monitor|alert|expir.*notif|automat.*renew/.test(diag);
              const hasPipelineContext = /pipeline|step\s*3|halted|depend/.test(diag);
              const score = [hasSpecificFix, hasPrevention, hasPipelineContext].filter(Boolean).length / 3;
              return { score, detail: `fix=${hasSpecificFix}, prevention=${hasPrevention}, pipeline=${hasPipelineContext}` };
            },
          },
        ]);

        recordAndAssert(entry, 'healing-diagnosis', 'connector failure diagnosis', result, validation, quality);
      }, 180_000);
    }

    // --- Persona Testing ------------------------------------------------
    if (isFeatureEnabled('persona-testing')) {
      it('persona-testing: evaluates persona response quality', async () => {
        workspace = createWorkspace('empty');
        workspace.writeFile(
          'test_case.json',
          JSON.stringify({
            persona: 'Customer Support Agent',
            system_prompt: 'You are a helpful customer support agent. Be empathetic and professional.',
            test_input: 'I was charged twice for my subscription last month. This is really frustrating!',
            expected_traits: ['empathy', 'acknowledgment', 'action_plan', 'no_blame'],
          }),
        );

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read test_case.json in the current directory.',
            'Evaluate how well a persona with the given system_prompt would handle the test_input.',
            'Score the response on each expected_trait (0-10).',
            'Generate a sample ideal response and explain what makes it good.',
            'Write your evaluation to evaluation.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['evaluation.md'],
            toolsUsed: ['read', 'write'],
          },
          workspace,
        );

        const quality = scoreQuality(result, 'persona-testing', [
          {
            name: 'Trait Coverage',
            weight: 3,
            check: () => {
              const evalText = (workspace.readFile('evaluation.md') ?? '').toLowerCase();
              const traits = ['empathy', 'acknowledg', 'action', 'blame'];
              const found = traits.filter((t) => evalText.includes(t));
              return { score: found.length / traits.length, detail: `${found.length}/4 traits addressed` };
            },
          },
          {
            name: 'Evaluation Depth',
            weight: 2,
            check: () => {
              const evalText = (workspace.readFile('evaluation.md') ?? '').toLowerCase();
              const hasScoring = /\d+\s*\/\s*10|\bscore\b|\brating\b/.test(evalText);
              const hasSample = /sample|ideal|example.*response/.test(evalText);
              const score = [hasScoring, hasSample].filter(Boolean).length / 2;
              return { score, detail: `scoring=${hasScoring}, sample=${hasSample}` };
            },
          },
        ]);

        recordAndAssert(entry, 'persona-testing', 'response quality evaluation', result, validation, quality);
      }, 180_000);
    }

    // --- Smart Search ---------------------------------------------------
    if (isFeatureEnabled('smart-search')) {
      it('smart-search: finds relevant information across files', async () => {
        workspace = createWorkspace('multi-file-project');

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Search this project to answer: "How does data flow from input to output?"',
            'Trace the data pipeline:',
            '1. Where is data read from?',
            '2. How is it processed?',
            '3. How is it formatted for output?',
            'Write a data flow summary to data_flow.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['data_flow.md'],
            toolsUsed: ['read'],
            minToolCalls: 2,
          },
          workspace,
        );

        const quality = scoreQuality(result, 'smart-search', [
          {
            name: 'Pipeline Tracing',
            weight: 3,
            check: () => {
              const flow = (workspace.readFile('data_flow.md') ?? '').toLowerCase();
              const stages = [
                /input\.json|data.*input|read.*file/.test(flow),
                /process|filter|sort|parse/.test(flow),
                /format|output|display|console/.test(flow),
              ];
              const score = stages.filter(Boolean).length / stages.length;
              return { score, detail: `${stages.filter(Boolean).length}/3 pipeline stages` };
            },
          },
          {
            name: 'File References',
            weight: 2,
            check: () => {
              const flow = (workspace.readFile('data_flow.md') ?? '').toLowerCase();
              const files = ['config', 'processor', 'formatter', 'index'];
              const found = files.filter((f) => flow.includes(f));
              return { score: found.length / files.length, detail: `${found.length}/4 source files referenced` };
            },
          },
        ]);

        recordAndAssert(entry, 'smart-search', 'data flow tracing', result, validation, quality);
      }, 180_000);
    }

    // --- Recipe Generation ----------------------------------------------
    if (isFeatureEnabled('recipe-generation')) {
      it('recipe-generation: creates automation recipe from requirements', async () => {
        workspace = createWorkspace('empty');
        workspace.writeFile(
          'requirements.md',
          [
            '# Automation Recipe Request',
            '',
            '## Goal',
            'Monitor a GitHub repository for new issues labeled "bug"',
            'and automatically create a Jira ticket with the issue details.',
            '',
            '## Services',
            '- GitHub (source)',
            '- Jira (destination)',
            '',
            '## Requirements',
            '- Include issue title, body, and labels in the Jira ticket',
            '- Set Jira priority based on GitHub labels (critical, high, medium, low)',
            '- Add a comment back on the GitHub issue linking to the created Jira ticket',
          ].join('\n'),
        );

        const result = await runCli({
          provider: entry.provider.name,
          prompt: [
            'Read requirements.md in the current directory.',
            'Design an automation recipe that fulfills the requirements.',
            'Output should include:',
            '1. A step-by-step pipeline description',
            '2. Required credentials for each service',
            '3. Data mapping between GitHub issue fields and Jira ticket fields',
            '4. Error handling strategy',
            'Write the recipe to recipe.md.',
          ].join(' '),
          cwd: workspace.rootDir,
          model: entry.model.id,
          timeoutMs: 120_000,
        });

        const validation = validateResult(
          result,
          {
            expectSuccess: true,
            filesCreated: ['recipe.md'],
            toolsUsed: ['read', 'write'],
          },
          workspace,
        );

        const quality = scoreQuality(result, 'recipe-generation', [
          {
            name: 'Recipe Completeness',
            weight: 3,
            check: () => {
              const recipe = (workspace.readFile('recipe.md') ?? '').toLowerCase();
              const elements = [
                /github.*issue|webhook|trigger/.test(recipe),
                /jira.*ticket|create.*ticket/.test(recipe),
                /priority|label.*map|critical|high|medium|low/.test(recipe),
                /comment.*back|link.*jira|cross.*ref/.test(recipe),
                /credential|token|api.*key|auth/.test(recipe),
                /error|retry|fallback|fail/.test(recipe),
              ];
              const score = elements.filter(Boolean).length / elements.length;
              return { score, detail: `${elements.filter(Boolean).length}/6 recipe elements` };
            },
          },
          {
            name: 'Data Mapping',
            weight: 2,
            check: () => {
              const recipe = (workspace.readFile('recipe.md') ?? '').toLowerCase();
              const mappings = [
                /title/.test(recipe),
                /body|description/.test(recipe),
                /label/.test(recipe),
                /priority/.test(recipe),
              ];
              const score = mappings.filter(Boolean).length / mappings.length;
              return { score, detail: `${mappings.filter(Boolean).length}/4 field mappings` };
            },
          },
        ]);

        recordAndAssert(entry, 'recipe-generation', 'automation recipe', result, validation, quality);
      }, 180_000);
    }
  });
}
