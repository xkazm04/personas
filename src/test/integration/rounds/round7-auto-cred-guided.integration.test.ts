/**
 * Round 7: Auto-Credential Guided Mode -- Tests the 3-layer auto-credential
 * setup approach against real catalog connectors.
 *
 * Layer 1: Playwright MCP availability check
 * Layer 2: URL detection and OPEN_URL: protocol in assistant text
 * Layer 3: Guided mode prompt produces correct structured output
 *
 * These tests verify that:
 * - The guided prompt generates step-by-step instructions with URLs
 * - OPEN_URL: protocol lines are correctly emitted
 * - The final JSON contains extracted_values for all required fields
 * - Multiple connector types produce valid guidance
 */
import { getAvailableProviders } from '../helpers/providerDetection';
import { runCli } from '../helpers/cliRunner';
import { createWorkspace } from '../helpers/workspaceManager';
import { createTestDb } from '../helpers/testDatabase';
import { validateResult, formatDiagnostic } from '../helpers/resultValidator';
import type { WorkspaceContext } from '../helpers/types';
import type { TestDbContext } from '../helpers/testDatabase';

const providers = getAvailableProviders();
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

// ===========================================================================
// Test connector definitions (mirrors what's in the catalog)
// ===========================================================================

interface TestConnector {
  name: string;
  label: string;
  fields: { key: string; label: string; required: boolean }[];
  docsUrl?: string;
}

const TEST_CONNECTORS: TestConnector[] = [
  {
    name: 'github',
    label: 'GitHub',
    fields: [
      { key: 'token', label: 'Personal Access Token', required: true },
    ],
    docsUrl: 'https://github.com/settings/tokens',
  },
  {
    name: 'cloudflare',
    label: 'Cloudflare',
    fields: [
      { key: 'api_token', label: 'API Token', required: true },
      { key: 'account_id', label: 'Account ID', required: false },
    ],
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    fields: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'organization_id', label: 'Organization ID', required: false },
    ],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
];

// ===========================================================================
// Guided prompt builder (mirrors Rust build_guided_prompt)
// ===========================================================================

function buildGuidedPrompt(connector: TestConnector): string {
  const fieldsDesc = connector.fields
    .map((f) => {
      let desc = `- \`${f.key}\` (${f.label})`;
      if (f.required) desc += ' [REQUIRED]';
      return desc;
    })
    .join('\n');

  const docsSection = connector.docsUrl
    ? `The setup page is at: ${connector.docsUrl}\nFirst output: OPEN_URL:${connector.docsUrl}`
    : `Find the ${connector.label} developer/API settings page and output the URL with the OPEN_URL: prefix.`;

  return `You are a guided credential setup assistant for ${connector.label} (${connector.name}).

Browser automation is NOT available. Instead, you will guide the user step-by-step through creating API credentials manually in their own browser.

## Communication Protocol

You have special output prefixes that trigger actions in the desktop app:

1. **OPEN_URL:https://example.com** -- Opens the URL in the user's default browser.
   Use this whenever you reference a URL the user should visit.
   Output it on its own line, with no surrounding text on that line.

2. **WAITING: <message>** -- Indicates you're waiting for the user to complete a step.
   After outputting a WAITING message, the app will pause for user confirmation.

## Starting Point
${docsSection}

## Required Fields to Extract
${fieldsDesc}

## Your Task

Guide the user through these exact steps:

1. First, output the OPEN_URL for the service's API/developer dashboard.
2. Provide clear, numbered instructions for creating an API key or token.
3. For each step, tell the user exactly what to click, fill in, or select.
4. When the user needs to perform an action, output a WAITING message.
5. After the user has created the credential, ask them to copy each field value.
6. Once you have all values, output the final result as JSON:

\`\`\`json
{
  "extracted_values": {
    "field_key": "value_from_user",
    ...
  },
  "procedure_log": "Step-by-step description of what was done"
}
\`\`\`

IMPORTANT:
- Always use OPEN_URL: prefix for any URL you mention (each on its own line).
- Be specific: name exact buttons, menu items, and page sections.
- For services with multiple auth methods, prefer API tokens over OAuth.
- Output ONLY the JSON block at the very end, no other text after it.
- If a field value is not available, use an empty string.
- For this test, use placeholder values like "YOUR_TOKEN_HERE" in extracted_values since the user cannot actually interact.
`;
}

// ===========================================================================
// URL extraction helper (mirrors Rust extract_urls)
// ===========================================================================

function extractUrls(text: string): string[] {
  const urls: string[] = [];
  const regex = /https?:\/\/[^\s)>\]"'`]+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (url.length > 10) urls.push(url);
  }
  return urls;
}

function extractOpenUrlProtocol(text: string): string[] {
  const urls: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('OPEN_URL:')) {
      const url = trimmed.slice('OPEN_URL:'.length).trim();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        urls.push(url);
      }
    }
  }
  return urls;
}

function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Try ```json blocks
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]!.trim());
    } catch { /* not valid JSON */ }
  }

  // Try raw JSON with extracted_values
  for (const line of text.split('\n').reverse()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.includes('extracted_values')) {
      try {
        return JSON.parse(trimmed);
      } catch { /* not valid JSON */ }
    }
  }
  return null;
}

// ===========================================================================
// Tests
// ===========================================================================

for (const provider of providers) {
  describe(`${provider.displayName} -- Auto-Cred Guided Mode`, () => {
    for (const connector of TEST_CONNECTORS) {
      describe(`${connector.label}`, () => {
        // -----------------------------------------------------------------
        // Test 1: Guided prompt produces OPEN_URL protocol lines
        // -----------------------------------------------------------------
        it(`emits OPEN_URL: protocol for ${connector.label}`, async () => {
          workspace = createWorkspace('empty');

          const prompt = buildGuidedPrompt(connector);
          const result = await runCli({
            provider: provider.name,
            prompt,
            cwd: workspace.rootDir,
            model: provider.model,
            timeoutMs: 120_000,
          });

          const text = result.assistantText;
          const openUrls = extractOpenUrlProtocol(text);

          const validation = validateResult(result, {
            expectSuccess: true,
            maxDurationMs: 120_000,
            custom: () => {
              const details: string[] = [];
              let passed = true;

              if (openUrls.length === 0) {
                details.push('FAIL: No OPEN_URL: protocol lines found');
                passed = false;
              } else {
                details.push(`PASS: Found ${openUrls.length} OPEN_URL: protocol line(s)`);
                for (const url of openUrls) {
                  details.push(`  -> ${url}`);
                }
              }

              // Check that URLs are valid
              const allUrls = extractUrls(text);
              if (allUrls.length > 0) {
                details.push(`Found ${allUrls.length} total URL(s) in output`);
              }

              // If connector has docsUrl, it should appear in OPEN_URL
              if (connector.docsUrl) {
                const hasDocsUrl = openUrls.some((u) => u.includes(new URL(connector.docsUrl!).hostname));
                if (!hasDocsUrl) {
                  details.push(`WARN: Expected docs URL hostname (${new URL(connector.docsUrl).hostname}) not found in OPEN_URL lines`);
                } else {
                  details.push(`PASS: Docs URL hostname found in OPEN_URL lines`);
                }
              }

              return { passed, detail: details.join('\n') };
            },
          });

          db.recordExecution({
            id: `round7-open-url-${connector.name}-${provider.name}`,
            round: 'round7',
            testName: `OPEN_URL protocol -- ${connector.label}`,
            provider: provider.name,
            model: provider.model,
            status: validation.passed ? 'pass' : 'fail',
            score: validation.score,
            durationMs: result.totalDurationMs,
            costUsd: result.reportedCostUsd ?? 0,
            inputTokens: result.reportedInputTokens ?? 0,
            outputTokens: result.reportedOutputTokens ?? 0,
            toolCallCount: result.toolCallCount,
            toolsUsed: JSON.stringify(result.toolsUsed),
            assistantTextLength: result.assistantText.length,
            validationDetails: JSON.stringify(validation.details),
          });

          expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
        }, 180_000);

        // -----------------------------------------------------------------
        // Test 2: Guided prompt produces valid JSON with extracted_values
        // -----------------------------------------------------------------
        it(`produces extracted_values JSON for ${connector.label}`, async () => {
          workspace = createWorkspace('empty');

          const prompt = buildGuidedPrompt(connector);
          const result = await runCli({
            provider: provider.name,
            prompt,
            cwd: workspace.rootDir,
            model: provider.model,
            timeoutMs: 120_000,
          });

          const text = result.assistantText;
          const jsonResult = extractJsonBlock(text);

          const validation = validateResult(result, {
            expectSuccess: true,
            maxDurationMs: 120_000,
            custom: () => {
              const details: string[] = [];
              let passed = true;

              if (!jsonResult) {
                details.push('FAIL: No JSON block with extracted_values found in output');
                passed = false;
                return { passed, detail: details.join('\n') };
              }

              details.push('PASS: Found JSON block in output');

              // Check for extracted_values key
              const extractedValues = jsonResult.extracted_values as Record<string, string> | undefined;
              if (!extractedValues || typeof extractedValues !== 'object') {
                details.push('FAIL: JSON block missing "extracted_values" key');
                passed = false;
                return { passed, detail: details.join('\n') };
              }

              details.push('PASS: "extracted_values" key present');

              // Check that all required fields are present
              for (const field of connector.fields) {
                if (field.key in extractedValues) {
                  details.push(`PASS: Field "${field.key}" present (value: "${String(extractedValues[field.key]).slice(0, 30)}...")`);
                } else if (field.required) {
                  details.push(`FAIL: Required field "${field.key}" missing from extracted_values`);
                  passed = false;
                } else {
                  details.push(`WARN: Optional field "${field.key}" missing`);
                }
              }

              // Check for procedure_log
              if (jsonResult.procedure_log) {
                details.push('PASS: procedure_log present');
              } else {
                details.push('WARN: procedure_log missing (non-critical)');
              }

              return { passed, detail: details.join('\n') };
            },
          });

          db.recordExecution({
            id: `round7-json-extract-${connector.name}-${provider.name}`,
            round: 'round7',
            testName: `JSON extraction -- ${connector.label}`,
            provider: provider.name,
            model: provider.model,
            status: validation.passed ? 'pass' : 'fail',
            score: validation.score,
            durationMs: result.totalDurationMs,
            costUsd: result.reportedCostUsd ?? 0,
            inputTokens: result.reportedInputTokens ?? 0,
            outputTokens: result.reportedOutputTokens ?? 0,
            toolCallCount: result.toolCallCount,
            toolsUsed: JSON.stringify(result.toolsUsed),
            assistantTextLength: result.assistantText.length,
            validationDetails: JSON.stringify(validation.details),
          });

          expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
        }, 180_000);

        // -----------------------------------------------------------------
        // Test 3: Guided instructions are specific and actionable
        // -----------------------------------------------------------------
        it(`generates specific instructions for ${connector.label}`, async () => {
          workspace = createWorkspace('empty');

          const prompt = buildGuidedPrompt(connector);
          const result = await runCli({
            provider: provider.name,
            prompt,
            cwd: workspace.rootDir,
            model: provider.model,
            timeoutMs: 120_000,
          });

          const text = result.assistantText.toLowerCase();

          const validation = validateResult(result, {
            expectSuccess: true,
            maxDurationMs: 120_000,
            custom: () => {
              const details: string[] = [];
              let passed = true;

              // Check for numbered steps
              const hasNumberedSteps = /\d+[.)]\s/.test(result.assistantText);
              if (hasNumberedSteps) {
                details.push('PASS: Contains numbered steps');
              } else {
                details.push('FAIL: No numbered steps found');
                passed = false;
              }

              // Check for UI-specific language (click, navigate, select, etc.)
              const uiTerms = ['click', 'navigate', 'select', 'choose', 'enter', 'copy', 'paste', 'button', 'tab', 'menu', 'page', 'settings', 'dashboard'];
              const foundTerms = uiTerms.filter((t) => text.includes(t));
              if (foundTerms.length >= 3) {
                details.push(`PASS: Contains ${foundTerms.length} UI-specific terms: ${foundTerms.join(', ')}`);
              } else {
                details.push(`FAIL: Only ${foundTerms.length} UI terms found (need >= 3): ${foundTerms.join(', ')}`);
                passed = false;
              }

              // Check for WAITING: prompts
              const waitingCount = (result.assistantText.match(/WAITING:/g) || []).length;
              if (waitingCount > 0) {
                details.push(`PASS: Contains ${waitingCount} WAITING: prompt(s)`);
              } else {
                details.push('WARN: No WAITING: prompts found (non-critical for test mode)');
              }

              // Check connector-specific terms
              const connectorTerms: Record<string, string[]> = {
                github: ['personal access token', 'token', 'fine-grained', 'classic', 'permissions', 'scope'],
                cloudflare: ['api token', 'token', 'permissions', 'zone', 'account'],
                openai: ['api key', 'key', 'project', 'organization'],
              };
              const expectedTerms = connectorTerms[connector.name] ?? [];
              const connectorFound = expectedTerms.filter((t) => text.includes(t));
              if (connectorFound.length >= 2) {
                details.push(`PASS: Contains ${connectorFound.length} ${connector.label}-specific terms: ${connectorFound.join(', ')}`);
              } else {
                details.push(`WARN: Only ${connectorFound.length} ${connector.label}-specific terms found: ${connectorFound.join(', ')}`);
              }

              return { passed, detail: details.join('\n') };
            },
          });

          db.recordExecution({
            id: `round7-instructions-${connector.name}-${provider.name}`,
            round: 'round7',
            testName: `Instruction quality -- ${connector.label}`,
            provider: provider.name,
            model: provider.model,
            status: validation.passed ? 'pass' : 'fail',
            score: validation.score,
            durationMs: result.totalDurationMs,
            costUsd: result.reportedCostUsd ?? 0,
            inputTokens: result.reportedInputTokens ?? 0,
            outputTokens: result.reportedOutputTokens ?? 0,
            toolCallCount: result.toolCallCount,
            toolsUsed: JSON.stringify(result.toolsUsed),
            assistantTextLength: result.assistantText.length,
            validationDetails: JSON.stringify(validation.details),
          });

          expect(validation.passed, formatDiagnostic(result, validation)).toBe(true);
        }, 180_000);
      });
    }
  });
}
