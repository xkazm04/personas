/**
 * E2E: Terminal component rendering -- TerminalStrip + CliOutputPanel.
 *
 * Tests that the terminal display components correctly render CLI output
 * from each scenario and provider. Validates line classification, color
 * mapping, expand/collapse, copy, running indicators, and idle states.
 *
 * Run: `npm test -- src/test/e2e/cli-terminal-rendering.e2e.test.tsx`
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import CliOutputPanel from '@/features/shared/components/terminal/CliOutputPanel';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import {
  CLAUDE_EXECUTION_LINES,
  GEMINI_EXECUTION_LINES,
  COPILOT_EXECUTION_LINES,
  FAILED_EXECUTION_LINES,
  QUERY_DEBUG_CLAUDE_LINES,
  N8N_TRANSFORM_LINES,
  AI_HEALING_SUCCESS_LINES,
  API_TEST_RUNNER_LINES,
  PROVIDER_FIXTURES,
} from '../helpers/cliFixtures';

// Mock clipboard API for copy tests
beforeEach(() => {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

// ===========================================================================
// PART 1: TerminalStrip -- collapsible strip used for healing, debug, tests
// ===========================================================================

describe('E2E: TerminalStrip -- rendering', () => {
  describe('collapsed state', () => {
    it('shows the last line text', () => {
      render(
        <TerminalStrip
          lastLine="Cost: $0.032"
          lines={CLAUDE_EXECUTION_LINES}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      expect(screen.getByText('Cost: $0.032')).toBeInTheDocument();
    });

    it('shows running indicator when isRunning', () => {
      const { container } = render(
        <TerminalStrip
          lastLine="Running..."
          lines={['Running...']}
          isRunning={true}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      // Animated pulse dot
      const pulseDot = container.querySelector('.animate-pulse');
      expect(pulseDot).toBeTruthy();
    });

    it('hides running indicator when not running', () => {
      const { container } = render(
        <TerminalStrip
          lastLine="Done"
          lines={['Done']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      const pulseDot = container.querySelector('span.w-1\\.5.h-1\\.5.animate-pulse');
      expect(pulseDot).toBeNull();
    });

    it('shows expand button (ChevronDown) when collapsed', () => {
      render(
        <TerminalStrip
          lastLine="Test"
          lines={['Test']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      expect(screen.getByTitle('Expand log')).toBeInTheDocument();
    });

    it('shows copy button when not running and has lines', () => {
      render(
        <TerminalStrip
          lastLine="Done"
          lines={['Line 1', 'Line 2']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      expect(screen.getByTitle('Copy log')).toBeInTheDocument();
    });

    it('hides copy button while running', () => {
      render(
        <TerminalStrip
          lastLine="Running..."
          lines={['Line 1']}
          isRunning={true}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      expect(screen.queryByTitle('Copy log')).toBeNull();
    });

    it('shows dismiss button when not running and onClear provided', () => {
      render(
        <TerminalStrip
          lastLine="Done"
          lines={['Line 1']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
          onClear={() => {}}
        />,
      );

      expect(screen.getByTitle('Dismiss')).toBeInTheDocument();
    });

    it('hides dismiss button while running', () => {
      render(
        <TerminalStrip
          lastLine="Running..."
          lines={['Line 1']}
          isRunning={true}
          isExpanded={false}
          onToggle={() => {}}
          onClear={() => {}}
        />,
      );

      expect(screen.queryByTitle('Dismiss')).toBeNull();
    });

    it('renders counters slot', () => {
      render(
        <TerminalStrip
          lastLine="Test"
          lines={['Test']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
          counters={<span data-testid="counter-badge">3 fixes</span>}
        />,
      );

      expect(screen.getByTestId('counter-badge')).toHaveTextContent('3 fixes');
    });
  });

  describe('expanded state', () => {
    it('renders all lines in expanded panel', () => {
      const { container } = render(
        <TerminalStrip
          lastLine={CLAUDE_EXECUTION_LINES[CLAUDE_EXECUTION_LINES.length - 1]}
          lines={CLAUDE_EXECUTION_LINES}
          isRunning={false}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      // Each line rendered in expanded panel
      const expandedPanel = container.querySelector('.overflow-y-auto');
      expect(expandedPanel).toBeTruthy();

      const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
      expect(lineDivs.length).toBe(CLAUDE_EXECUTION_LINES.length);
    });

    it('shows collapse button (ChevronUp) when expanded', () => {
      render(
        <TerminalStrip
          lastLine="Test"
          lines={['Test']}
          isRunning={false}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      expect(screen.getByTitle('Collapse log')).toBeInTheDocument();
    });

    it('shows pulsing cursor when running and expanded', () => {
      const { container } = render(
        <TerminalStrip
          lastLine="Running..."
          lines={['Line 1']}
          isRunning={true}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      const expandedPanel = container.querySelector('.overflow-y-auto');
      const cursor = expandedPanel!.querySelector('.animate-pulse');
      expect(cursor).toBeTruthy();
      expect(cursor!.textContent).toContain('> _');
    });

    it('does not show pulsing cursor when completed', () => {
      const { container } = render(
        <TerminalStrip
          lastLine="Done"
          lines={['Line 1']}
          isRunning={false}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      const expandedPanel = container.querySelector('.overflow-y-auto');
      const cursor = expandedPanel?.querySelector('.animate-pulse');
      expect(cursor).toBeNull();
    });
  });

  describe('callbacks', () => {
    it('calls onToggle when expand/collapse button clicked', () => {
      const onToggle = vi.fn();
      render(
        <TerminalStrip
          lastLine="Test"
          lines={['Test']}
          isRunning={false}
          isExpanded={false}
          onToggle={onToggle}
        />,
      );

      fireEvent.click(screen.getByTitle('Expand log'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('calls onClear when dismiss button clicked', () => {
      const onClear = vi.fn();
      render(
        <TerminalStrip
          lastLine="Done"
          lines={['Line 1']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
          onClear={onClear}
        />,
      );

      fireEvent.click(screen.getByTitle('Dismiss'));
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('copies all lines on copy button click', async () => {
      render(
        <TerminalStrip
          lastLine="Line 2"
          lines={['Line 1', 'Line 2']}
          isRunning={false}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );

      fireEvent.click(screen.getByTitle('Copy log'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Line 1\nLine 2');
    });
  });
});

// ===========================================================================
// PART 2: TerminalStrip with provider-specific content
// ===========================================================================

describe('E2E: TerminalStrip -- provider-specific rendering', () => {
  for (const provider of PROVIDER_FIXTURES) {
    it(`renders ${provider.name} execution output with correct line count`, () => {
      const { container } = render(
        <TerminalStrip
          lastLine={provider.successLines[provider.successLines.length - 1]}
          lines={provider.successLines}
          isRunning={false}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      const expandedPanel = container.querySelector('.overflow-y-auto');
      const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
      expect(lineDivs.length).toBe(provider.successLines.length);
    });

    it(`renders ${provider.name} failure output`, () => {
      const { container } = render(
        <TerminalStrip
          lastLine={provider.failureLines[provider.failureLines.length - 1]}
          lines={provider.failureLines}
          isRunning={false}
          isExpanded={true}
          onToggle={() => {}}
        />,
      );

      const expandedPanel = container.querySelector('.overflow-y-auto');
      const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
      expect(lineDivs.length).toBe(provider.failureLines.length);
    });
  }

  it('renders AI healing lines in strip format', () => {
    const { container } = render(
      <TerminalStrip
        lastLine={AI_HEALING_SUCCESS_LINES[AI_HEALING_SUCCESS_LINES.length - 1]}
        lines={AI_HEALING_SUCCESS_LINES}
        isRunning={false}
        isExpanded={true}
        onToggle={() => {}}
        counters={<span data-testid="heal-badge">2 fixes</span>}
      />,
    );

    expect(screen.getByTestId('heal-badge')).toBeInTheDocument();
    const expandedPanel = container.querySelector('.overflow-y-auto');
    const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
    expect(lineDivs.length).toBe(AI_HEALING_SUCCESS_LINES.length);
  });

  it('renders query debug lines in strip format', () => {
    const { container } = render(
      <TerminalStrip
        lastLine={QUERY_DEBUG_CLAUDE_LINES[QUERY_DEBUG_CLAUDE_LINES.length - 1]}
        lines={QUERY_DEBUG_CLAUDE_LINES}
        isRunning={false}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );

    const expandedPanel = container.querySelector('.overflow-y-auto');
    const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
    expect(lineDivs.length).toBe(QUERY_DEBUG_CLAUDE_LINES.length);
  });

  it('renders API test runner lines with custom classifier', () => {
    const apiTestLineClassName = (line: string): string => {
      if (line.includes('[v]')) return 'text-emerald-400';
      if (line.includes('[x]')) return 'text-red-400';
      if (line.includes('Skipped')) return 'text-amber-400';
      return 'text-muted-foreground';
    };

    const { container } = render(
      <TerminalStrip
        lastLine={API_TEST_RUNNER_LINES[API_TEST_RUNNER_LINES.length - 1]}
        lines={API_TEST_RUNNER_LINES}
        isRunning={false}
        isExpanded={true}
        onToggle={() => {}}
        lineClassName={apiTestLineClassName}
      />,
    );

    const expandedPanel = container.querySelector('.overflow-y-auto');
    const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
    expect(lineDivs.length).toBe(API_TEST_RUNNER_LINES.length);

    // Verify custom classes were applied
    const passedLines = Array.from(lineDivs).filter((d) =>
      d.className.includes('text-emerald-400'),
    );
    const failedLines = Array.from(lineDivs).filter((d) =>
      d.className.includes('text-red-400'),
    );
    const skippedLines = Array.from(lineDivs).filter((d) =>
      d.className.includes('text-amber-400'),
    );

    expect(passedLines.length).toBeGreaterThan(0);
    expect(failedLines.length).toBeGreaterThan(0);
    expect(skippedLines.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// PART 3: CliOutputPanel -- full terminal panel with header
// ===========================================================================

describe('E2E: CliOutputPanel -- rendering', () => {
  describe('idle state', () => {
    it('shows idle text when no lines and phase is idle', () => {
      render(<CliOutputPanel phase="idle" lines={[]} />);
      expect(screen.getByText('No CLI output yet.')).toBeInTheDocument();
    });

    it('shows custom idle text', () => {
      render(<CliOutputPanel phase="idle" lines={[]} idleText="Waiting for persona execution..." />);
      expect(screen.getByText('Waiting for persona execution...')).toBeInTheDocument();
    });
  });

  describe('waiting state', () => {
    it('shows waiting text when running with no lines yet', () => {
      render(<CliOutputPanel phase="running" lines={[]} />);
      expect(screen.getByText('Waiting for Claude CLI output...')).toBeInTheDocument();
    });

    it('shows custom waiting text', () => {
      render(
        <CliOutputPanel
          phase="running"
          lines={[]}
          waitingText="Connecting to Gemini CLI..."
        />,
      );
      expect(screen.getByText('Connecting to Gemini CLI...')).toBeInTheDocument();
    });
  });

  describe('running state with output', () => {
    it('renders all output lines', () => {
      const lines = ['I have analyzed the data.', 'The report includes 3 key findings:', '1. Revenue increased by 15% QoQ'];
      render(
        <CliOutputPanel phase="running" lines={lines} />,
      );

      for (const line of lines) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }
    });

    it('shows pulsing cursor while running', () => {
      const { container } = render(
        <CliOutputPanel phase="running" lines={['Line 1']} />,
      );

      // The cursor is inside the output area (the second animate-pulse, after the header's running dot)
      const cursors = container.querySelectorAll('.animate-pulse');
      const cursorDiv = Array.from(cursors).find((el) => el.textContent?.includes('> _'));
      expect(cursorDiv).toBeTruthy();
    });

    it('shows running indicator in header', () => {
      render(<CliOutputPanel phase="running" lines={['Line 1', 'Line 2']} />);
      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('(2 lines)')).toBeInTheDocument();
    });
  });

  describe('completed state', () => {
    it('shows completed status with line count', () => {
      render(
        <CliOutputPanel
          phase="completed"
          lines={CLAUDE_EXECUTION_LINES}
          runId="exec-abc12345"
        />,
      );

      expect(screen.getByText(`Completed (${CLAUDE_EXECUTION_LINES.length} lines)`)).toBeInTheDocument();
    });

    it('shows truncated runId in header', () => {
      render(
        <CliOutputPanel
          phase="completed"
          lines={['Done']}
          runId="abcdef1234567890"
        />,
      );

      expect(screen.getByText('abcdef12')).toBeInTheDocument();
    });

    it('does not show pulsing cursor when completed', () => {
      const { container } = render(
        <CliOutputPanel phase="completed" lines={['Done']} />,
      );

      const outputArea = container.querySelector('.font-mono.text-sm');
      const cursor = outputArea?.querySelector('.animate-pulse');
      expect(cursor).toBeNull();
    });

    it('shows Copy Log button when completed with lines', () => {
      render(
        <CliOutputPanel phase="completed" lines={['Line 1', 'Line 2']} />,
      );

      expect(screen.getByText('Copy Log')).toBeInTheDocument();
    });
  });

  describe('empty line rendering', () => {
    it('renders empty lines as spacers', () => {
      const { container } = render(
        <CliOutputPanel phase="completed" lines={['Line 1', '', 'Line 3']} />,
      );

      // Empty line should be rendered as a spacer div with h-2
      const spacer = container.querySelector('.h-2');
      expect(spacer).toBeTruthy();
    });
  });

  describe('healingStrip slot', () => {
    it('renders healing strip between header and output', () => {
      render(
        <CliOutputPanel
          phase="running"
          lines={['Line 1']}
          healingStrip={<div data-testid="healing-strip">Healing in progress</div>}
        />,
      );

      expect(screen.getByTestId('healing-strip')).toBeInTheDocument();
      expect(screen.getByText('Healing in progress')).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// PART 4: CliOutputPanel with provider-specific content
// ===========================================================================

describe('E2E: CliOutputPanel -- provider execution rendering', () => {
  for (const provider of PROVIDER_FIXTURES) {
    describe(`${provider.name} output`, () => {
      it('renders completed execution with all lines', () => {
        render(
          <CliOutputPanel
            phase="completed"
            lines={provider.successLines}
            runId={`run-${provider.name.toLowerCase().replace(/\s+/g, '-')}`}
          />,
        );

        // First and last lines should be visible
        expect(screen.getByText(provider.successLines[0])).toBeInTheDocument();
        expect(
          screen.getByText(provider.successLines[provider.successLines.length - 1]),
        ).toBeInTheDocument();
      });

      it('renders failed execution with error lines', () => {
        render(
          <CliOutputPanel
            phase="failed"
            lines={provider.failureLines}
          />,
        );

        // Each failure line should be visible in the panel
        for (const line of provider.failureLines) {
          const trimmed = line.trim();
          if (trimmed) {
            expect(
              screen.getByText((_content, el) => el?.textContent?.trim() === trimmed),
            ).toBeInTheDocument();
          }
        }
      });
    });
  }
});

// ===========================================================================
// PART 5: CliOutputPanel -- scenario-specific rendering
// ===========================================================================

describe('E2E: CliOutputPanel -- scenario rendering', () => {
  it('renders persona execution output (Claude)', () => {
    render(
      <CliOutputPanel
        phase="completed"
        lines={CLAUDE_EXECUTION_LINES}
        runId="exec-claude-001"
      />,
    );

    expect(screen.getByText(/Session started.*claude-sonnet-4-6/)).toBeInTheDocument();
    expect(screen.getByText(/Revenue increased/)).toBeInTheDocument();
  });

  it('renders persona execution output (Gemini)', () => {
    render(
      <CliOutputPanel
        phase="completed"
        lines={GEMINI_EXECUTION_LINES}
        runId="exec-gemini-001"
      />,
    );

    expect(screen.getByText(/Session started.*gemini-3.1-flash-lite-preview/)).toBeInTheDocument();
    expect(screen.getByText(/JSON:API specification/)).toBeInTheDocument();
  });

  it('renders persona execution output (Copilot)', () => {
    render(
      <CliOutputPanel
        phase="completed"
        lines={COPILOT_EXECUTION_LINES}
        runId="exec-copilot-001"
      />,
    );

    expect(screen.getByText(/Session started.*gpt-5.1-codex-mini/)).toBeInTheDocument();
    expect(screen.getByText(/JWT v2/)).toBeInTheDocument();
  });

  it('renders N8N transform output with milestones', () => {
    render(
      <CliOutputPanel
        phase="completed"
        lines={N8N_TRANSFORM_LINES}
        runId="tf-001"
      />,
    );

    expect(screen.getByText(/Starting workflow transformation/)).toBeInTheDocument();
    // Multiple lines contain "Parsing workflow structure" and "Draft ready for review"
    // so use getAllByText and check at least one exists
    expect(screen.getAllByText(/Parsing workflow structure/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Draft ready for review/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders failed execution with error styling', () => {
    render(
      <CliOutputPanel
        phase="failed"
        lines={FAILED_EXECUTION_LINES}
      />,
    );

    // Error lines should have error styling class
    const errorLine = screen.getByText(/\[ERROR\] Process exited/);
    expect(errorLine.className).toContain('text-red');
  });
});

// ===========================================================================
// PART 6: Line classification integration
// ===========================================================================

describe('E2E: line classification in CliOutputPanel', () => {
  it('applies correct CSS classes based on line content', () => {
    const testLines = [
      '[System] Initializing',           // meta -> italic
      '> Using tool: Read',              // tool -> cyan
      '[ERROR] Something broke',          // error -> red
      'Session started (claude-3)',       // status -> emerald
      '> Analyzing data',                // info -> blue
      'Regular output text',              // text -> foreground
    ];

    const { container } = render(
      <CliOutputPanel phase="completed" lines={testLines} />,
    );

    // Find the scrollable output area (has overflow-y-auto and font-mono)
    const outputArea = container.querySelector('[class*="overflow-y-auto"][class*="font-mono"]');
    expect(outputArea).toBeTruthy();
    const lineDivs = outputArea!.querySelectorAll(':scope > div.whitespace-pre-wrap');

    // Meta line should be italic
    expect(lineDivs[0].className).toContain('italic');
    // Tool line should be cyan
    expect(lineDivs[1].className).toContain('text-cyan');
    // Error line should be red
    expect(lineDivs[2].className).toContain('text-red');
    // Status line should be emerald
    expect(lineDivs[3].className).toContain('text-emerald');
    // Info line should be blue
    expect(lineDivs[4].className).toContain('text-blue');
    // Text line should be foreground
    expect(lineDivs[5].className).toContain('text-foreground');
  });
});

// ===========================================================================
// PART 7: Full integration -- CliOutputPanel with healingStrip as TerminalStrip
// ===========================================================================

describe('E2E: CliOutputPanel + TerminalStrip healing integration', () => {
  it('renders execution panel with embedded healing strip', () => {
    const healingStrip = (
      <TerminalStrip
        lastLine="Fix applied: credential_rotation"
        lines={AI_HEALING_SUCCESS_LINES}
        isRunning={false}
        isExpanded={false}
        onToggle={() => {}}
        counters={<span data-testid="fix-count">2 fixes</span>}
      />
    );

    render(
      <CliOutputPanel
        phase="completed"
        lines={CLAUDE_EXECUTION_LINES}
        runId="exec-heal-001"
        healingStrip={healingStrip}
      />,
    );

    // Main output lines
    expect(screen.getByText(/Session started.*claude/)).toBeInTheDocument();
    // Healing strip content
    expect(screen.getByText('Fix applied: credential_rotation')).toBeInTheDocument();
    expect(screen.getByTestId('fix-count')).toHaveTextContent('2 fixes');
  });

  it('renders execution panel with running healing strip', () => {
    const healingStrip = (
      <TerminalStrip
        lastLine="Diagnosing..."
        lines={['> Starting AI healing diagnosis...', 'Diagnosing...']}
        isRunning={true}
        isExpanded={false}
        onToggle={() => {}}
      />
    );

    render(
      <CliOutputPanel
        phase="running"
        lines={CLAUDE_EXECUTION_LINES.slice(0, 3)}
        healingStrip={healingStrip}
      />,
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Diagnosing...')).toBeInTheDocument();
  });
});

// ===========================================================================
// PART 8: Phase-specific rendering across all CLI phases
// ===========================================================================

describe('E2E: CliOutputPanel -- all CliRunPhase values', () => {
  const phases: CliRunPhase[] = ['idle', 'running', 'completed', 'failed'];

  for (const phase of phases) {
    it(`renders correctly in "${phase}" phase`, () => {
      const lines = phase === 'idle' ? [] : ['Line 1', 'Line 2'];
      render(
        <CliOutputPanel phase={phase} lines={lines} runId="test-run" />,
      );

      if (phase === 'idle') {
        expect(screen.getByText('No CLI output yet.')).toBeInTheDocument();
      } else {
        expect(screen.getByText('Line 1')).toBeInTheDocument();
      }
    });
  }
});

// ===========================================================================
// PART 9: Large output rendering
// ===========================================================================

describe('E2E: large output rendering', () => {
  it('renders 500 lines without crashing', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Output line ${i + 1}`);

    render(
      <CliOutputPanel phase="completed" lines={lines} />,
    );

    expect(screen.getByText('Output line 1')).toBeInTheDocument();
    expect(screen.getByText('Output line 500')).toBeInTheDocument();
    expect(screen.getByText('Completed (500 lines)')).toBeInTheDocument();
  });

  it('TerminalStrip renders 500 lines in expanded mode', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Strip line ${i + 1}`);

    const { container } = render(
      <TerminalStrip
        lastLine="Strip line 500"
        lines={lines}
        isRunning={false}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );

    const expandedPanel = container.querySelector('.overflow-y-auto');
    const lineDivs = expandedPanel!.querySelectorAll(':scope > div');
    expect(lineDivs.length).toBe(500);
  });
});
