/**
 * E2E: Line classification and summary parsing across all providers.
 *
 * Tests that the terminal color classification system correctly categorizes
 * output lines from each provider, and that [SUMMARY] lines are parsed
 * into structured execution data. This is critical because the same
 * classification logic powers CliOutputPanel, TerminalStrip, and
 * ExecutionTerminal across all CLI scenarios.
 *
 * Run: `npm test -- src/test/e2e/cli-line-classification.e2e.test.ts`
 */
import { describe, it, expect } from 'vitest';
import {
  classifyLine,
  parseSummaryLine,
  TERMINAL_STYLE_MAP,
  type TerminalLineStyle,
} from '@/lib/utils/terminalColors';
import {
  CLAUDE_EXECUTION_LINES,
  GEMINI_EXECUTION_LINES,
  COPILOT_EXECUTION_LINES,
  FAILED_EXECUTION_LINES,
  TIMEOUT_EXECUTION_LINES,
  QUERY_DEBUG_CLAUDE_LINES,
  QUERY_DEBUG_GEMINI_LINES,
  QUERY_DEBUG_COPILOT_LINES,
  QUERY_DEBUG_FAILED_LINES,
  N8N_TRANSFORM_LINES,
  N8N_TRANSFORM_GEMINI_LINES,
  N8N_TRANSFORM_FAILED_LINES,
  TEMPLATE_ADOPTION_LINES,
  AI_HEALING_SUCCESS_LINES,
  API_TEST_RUNNER_LINES,
  PROVIDER_FIXTURES,
} from '../helpers/cliFixtures';

// ===========================================================================
// 1. Provider execution lines -- classification matrix
// ===========================================================================

describe('E2E: line classification -- Claude execution', () => {
  it('classifies Session started as status', () => {
    expect(classifyLine('Session started (claude-sonnet-4-6)')).toBe('status');
  });

  it('classifies tool use lines as tool', () => {
    expect(classifyLine('> Using tool: Read')).toBe('tool');
    expect(classifyLine('> Using tool: Write')).toBe('tool');
    expect(classifyLine('  Tool result: File contents (245 chars)')).toBe('tool');
    expect(classifyLine('  Tool result: File written successfully')).toBe('tool');
  });

  it('classifies Completed in as status', () => {
    expect(classifyLine('Completed in 12.4s')).toBe('status');
  });

  it('classifies Cost as status', () => {
    expect(classifyLine('Cost: $0.032')).toBe('status');
  });

  it('classifies [SUMMARY] as summary', () => {
    expect(classifyLine('[SUMMARY]{"status":"completed"}')).toBe('summary');
  });

  it('classifies assistant text as text', () => {
    expect(classifyLine('I have analyzed the data and created the report.')).toBe('text');
    expect(classifyLine('1. Revenue increased by 15% QoQ')).toBe('text');
  });

  it('maps every line to a valid style', () => {
    for (const line of CLAUDE_EXECUTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

describe('E2E: line classification -- Gemini execution', () => {
  it('classifies Gemini session start as status', () => {
    expect(classifyLine('Session started (gemini-3.1-flash-lite-preview)')).toBe('status');
  });

  it('classifies WebSearch tool use', () => {
    expect(classifyLine('> Using tool: WebSearch')).toBe('tool');
    expect(classifyLine('  Tool result: Found 5 results')).toBe('tool');
  });

  it('maps every Gemini line to a valid style', () => {
    for (const line of GEMINI_EXECUTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

describe('E2E: line classification -- Copilot execution', () => {
  it('classifies Copilot session start as status', () => {
    expect(classifyLine('Session started (gpt-5.1-codex-mini)')).toBe('status');
  });

  it('classifies Bash tool use', () => {
    expect(classifyLine('> Using tool: Bash')).toBe('tool');
    expect(classifyLine('  Tool result: npm test passed (12 tests)')).toBe('tool');
  });

  it('maps every Copilot line to a valid style', () => {
    for (const line of COPILOT_EXECUTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

// ===========================================================================
// 2. Error and warning classification
// ===========================================================================

describe('E2E: error line classification across providers', () => {
  it('classifies [ERROR] lines', () => {
    expect(classifyLine('[ERROR] Process exited with non-zero status')).toBe('error');
    expect(classifyLine('[ERROR] Authentication failed: invalid API key')).toBe('error');
    expect(classifyLine('[ERROR] Model "gpt-5.1-codex-mini" is not available in your current plan')).toBe('error');
    expect(classifyLine('[ERROR] Failed to parse workflow: unsupported node type')).toBe('error');
    expect(classifyLine('[ERROR] Could not resolve query issue after 3 attempts')).toBe('error');
  });

  it('classifies [TIMEOUT] lines as error', () => {
    expect(classifyLine('[TIMEOUT] Execution exceeded 60s limit')).toBe('error');
  });

  it('classifies [WARN] lines as error', () => {
    expect(classifyLine('[WARN] Low memory condition detected')).toBe('error');
  });

  it('maps all error/failure fixture lines correctly', () => {
    for (const line of FAILED_EXECUTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
    for (const line of TIMEOUT_EXECUTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

// ===========================================================================
// 3. Query debug line classification
// ===========================================================================

describe('E2E: query debug line classification', () => {
  it('classifies analysis lines as info', () => {
    expect(classifyLine('> Analyzing query error context...')).toBe('info');
    expect(classifyLine('> Attempt 1: Examining table schema')).toBe('info');
    expect(classifyLine('> Query succeeded after correction')).toBe('info');
    expect(classifyLine('> Max retries exceeded')).toBe('info');
  });

  it('classifies all Claude debug lines', () => {
    for (const line of QUERY_DEBUG_CLAUDE_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });

  it('classifies all Gemini debug lines', () => {
    for (const line of QUERY_DEBUG_GEMINI_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });

  it('classifies all Copilot debug lines', () => {
    for (const line of QUERY_DEBUG_COPILOT_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });

  it('classifies failed debug lines with error marker', () => {
    const errorLines = QUERY_DEBUG_FAILED_LINES.filter((l) => classifyLine(l) === 'error');
    expect(errorLines.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. N8N transform line classification
// ===========================================================================

describe('E2E: N8N transform line classification', () => {
  it('classifies [System] lines as meta', () => {
    expect(classifyLine('[System] Starting workflow transformation...')).toBe('meta');
  });

  it('classifies [Milestone] lines (code-style prefix)', () => {
    // [Milestone] starts with bracket but doesn't match error/summary/system
    // So it falls through to 'text'
    const style = classifyLine('[Milestone] Parsing workflow structure');
    expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
  });

  it('classifies all N8N transform lines', () => {
    for (const line of N8N_TRANSFORM_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });

  it('classifies all Gemini N8N transform lines', () => {
    for (const line of N8N_TRANSFORM_GEMINI_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });

  it('classifies N8N transform failure lines', () => {
    for (const line of N8N_TRANSFORM_FAILED_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
    const errorCount = N8N_TRANSFORM_FAILED_LINES.filter(
      (l) => classifyLine(l) === 'error',
    ).length;
    expect(errorCount).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. Template adoption line classification
// ===========================================================================

describe('E2E: template adoption line classification', () => {
  it('classifies all adoption lines to valid styles', () => {
    for (const line of TEMPLATE_ADOPTION_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

// ===========================================================================
// 6. AI healing line classification
// ===========================================================================

describe('E2E: AI healing line classification', () => {
  it('classifies all healing lines to valid styles', () => {
    for (const line of AI_HEALING_SUCCESS_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

// ===========================================================================
// 7. API test runner line classification
// ===========================================================================

describe('E2E: API test runner line classification', () => {
  it('classifies all API test lines to valid styles', () => {
    for (const line of API_TEST_RUNNER_LINES) {
      const style = classifyLine(line);
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
    }
  });
});

// ===========================================================================
// 8. [SUMMARY] parsing -- all providers
// ===========================================================================

describe('E2E: [SUMMARY] parsing across providers', () => {
  it('parses Claude execution summary', () => {
    const summaryLine = CLAUDE_EXECUTION_LINES.find((l) => l.startsWith('[SUMMARY]'));
    expect(summaryLine).toBeDefined();

    const parsed = parseSummaryLine(summaryLine!);
    expect(parsed).toEqual({
      status: 'completed',
      duration_ms: 12400,
      cost_usd: 0.032,
      last_tool: 'Write',
    });
  });

  it('parses Gemini execution summary', () => {
    const summaryLine = GEMINI_EXECUTION_LINES.find((l) => l.startsWith('[SUMMARY]'));
    expect(summaryLine).toBeDefined();

    const parsed = parseSummaryLine(summaryLine!);
    expect(parsed).toEqual({
      status: 'completed',
      duration_ms: 8700,
      cost_usd: 0.018,
      last_tool: 'WebSearch',
    });
  });

  it('parses Copilot execution summary', () => {
    const summaryLine = COPILOT_EXECUTION_LINES.find((l) => l.startsWith('[SUMMARY]'));
    expect(summaryLine).toBeDefined();

    const parsed = parseSummaryLine(summaryLine!);
    expect(parsed).toEqual({
      status: 'completed',
      duration_ms: 15100,
      cost_usd: 0.041,
      last_tool: 'Bash',
    });
  });

  it('parses failed execution summary', () => {
    const summaryLine = FAILED_EXECUTION_LINES.find((l) => l.startsWith('[SUMMARY]'));
    expect(summaryLine).toBeDefined();

    const parsed = parseSummaryLine(summaryLine!);
    expect(parsed).toEqual({
      status: 'failed',
      duration_ms: 3200,
      cost_usd: 0.008,
      last_tool: 'Bash',
    });
  });

  it('parses timeout execution summary', () => {
    const summaryLine = TIMEOUT_EXECUTION_LINES.find((l) => l.startsWith('[SUMMARY]'));
    expect(summaryLine).toBeDefined();

    const parsed = parseSummaryLine(summaryLine!);
    expect(parsed).toEqual({
      status: 'failed',
      duration_ms: 60000,
      cost_usd: 0.095,
      last_tool: 'Read',
    });
  });

  it('returns null for non-summary lines from all providers', () => {
    for (const provider of PROVIDER_FIXTURES) {
      for (const line of provider.successLines) {
        if (!line.startsWith('[SUMMARY]')) {
          expect(parseSummaryLine(line)).toBeNull();
        }
      }
    }
  });
});

// ===========================================================================
// 9. Style map completeness -- every style has a CSS class
// ===========================================================================

describe('E2E: TERMINAL_STYLE_MAP completeness', () => {
  const allStyles: TerminalLineStyle[] = [
    'meta', 'tool', 'error', 'status', 'summary', 'text', 'code', 'info',
  ];

  for (const style of allStyles) {
    it(`has mapping for "${style}" style`, () => {
      expect(TERMINAL_STYLE_MAP).toHaveProperty(style);
      expect(typeof TERMINAL_STYLE_MAP[style]).toBe('string');
    });
  }
});

// ===========================================================================
// 10. Full provider stream -- classification distribution
// ===========================================================================

describe('E2E: classification distribution per provider', () => {
  function getStyleDistribution(lines: string[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const line of lines) {
      const style = classifyLine(line);
      dist[style] = (dist[style] ?? 0) + 1;
    }
    return dist;
  }

  for (const provider of PROVIDER_FIXTURES) {
    it(`${provider.name} success stream has expected style variety`, () => {
      const dist = getStyleDistribution(provider.successLines);

      // Every provider execution should have: status, tool, text, and summary
      expect(dist['status']).toBeGreaterThanOrEqual(1);
      expect(dist['tool']).toBeGreaterThanOrEqual(1);
      expect(dist['text']).toBeGreaterThanOrEqual(1);
      expect(dist['summary']).toBeGreaterThanOrEqual(1);
    });

    it(`${provider.name} failure stream contains error lines`, () => {
      const dist = getStyleDistribution(provider.failureLines);
      expect(dist['error']).toBeGreaterThanOrEqual(1);
    });
  }
});
