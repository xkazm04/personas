/**
 * Unit tests for ToolInvocationCard's rendering of the shared tool-outcome
 * contract fields (error_kind, http_status, output_truncated, retryable).
 * useTranslation is real; no IPC is involved (the card is presentational).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import type { ToolInvocationResult } from '@/api/agents/tools';
import { ToolInvocationCard } from '../ToolInvocationCard';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function tool(): PersonaToolDefinition {
  return {
    id: 'tool-1',
    name: 'gmail_reader',
    category: 'api',
    description: '',
    script_path: '',
    input_schema: null,
    output_schema: null,
    requires_credential_type: 'gmail',
    implementation_guide: 'Curl: curl https://example.com',
    is_builtin: false,
    created_at: '',
    updated_at: '',
  };
}

function result(overrides: Partial<ToolInvocationResult>): ToolInvocationResult {
  return {
    success: false,
    output: '',
    output_truncated: false,
    error: 'boom',
    error_kind: null,
    http_status: null,
    retryable: false,
    duration_ms: 12n,
    tool_name: 'gmail_reader',
    tool_type: 'api',
    ...overrides,
  } as ToolInvocationResult;
}

describe('ToolInvocationCard result contract fields', () => {
  it('surfaces the typed error kind, HTTP status and retryable hint on an HTTP failure', () => {
    render(
      <ToolInvocationCard
        tool={tool()}
        isRunning={false}
        result={result({ error_kind: 'http', http_status: 503, retryable: true })}
        error={null}
        onRun={() => {}}
      />,
    );
    // Expand to reveal the result body.
    fireEvent.click(screen.getByText('gmail_reader'));

    // error_kind → status-token label; http_status → "HTTP 503".
    expect(screen.getByText('HTTP error')).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('This may succeed on retry.')).toBeInTheDocument();
  });

  it('shows the output-truncated notice when the flag is set', () => {
    render(
      <ToolInvocationCard
        tool={tool()}
        isRunning={false}
        result={result({ success: true, error: null, output: '{"ok":true}', output_truncated: true })}
        error={null}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('gmail_reader'));
    expect(screen.getByText(/Output truncated/i)).toBeInTheDocument();
  });

  it('says in the collapsed header that a run is in flight or failed at the IPC layer', () => {
    const { rerender } = render(
      <ToolInvocationCard tool={tool()} isRunning={false} result={null} error={null} onRun={() => {}} />,
    );
    const toggle = screen.getByTestId('tool-card-toggle-gmail_reader');
    const idle = toggle.textContent;
    rerender(<ToolInvocationCard tool={tool()} isRunning result={null} error={null} onRun={() => {}} />);
    expect(toggle.textContent).not.toBe(idle);
    expect(toggle).toHaveTextContent('Running...');
    rerender(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error="IPC timeout" onRun={() => {}} />);
    expect(toggle.textContent).not.toBe(idle);
    expect(toggle).toHaveTextContent('Error');
    // Still collapsed: the body (and its error block) is not rendered.
    expect(screen.queryByTestId('tool-result-gmail_reader')).toBeNull();
  });

  it('renders the auth failure kind label', () => {
    render(
      <ToolInvocationCard
        tool={tool()}
        isRunning={false}
        result={result({ error_kind: 'auth', http_status: 401 })}
        error={null}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('gmail_reader'));
    expect(screen.getByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText('HTTP 401')).toBeInTheDocument();
  });
});

describe('ToolInvocationCard disclosure semantics', () => {
  it('exposes expanded state and the controlled body id on the header button', () => {
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error={null} onRun={() => {}} />);
    const toggle = screen.getByTestId('tool-card-toggle-gmail_reader');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).not.toBeNull();
  });
});

describe('ToolInvocationCard result announcements', () => {
  it('announces a settled run through a status region', () => {
    render(
      <ToolInvocationCard tool={tool()} isRunning={false} result={result({ success: true, error: null, output: '{}' })} error={null} onRun={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    expect(screen.getByRole('status')).toHaveTextContent('Success');
  });

  it('announces a failed run through a status region', () => {
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={result({})} error={null} onRun={() => {}} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    expect(screen.getByRole('status')).toHaveTextContent('Failed');
  });

  it('announces an IPC error through an alert', () => {
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error="IPC timeout" onRun={() => {}} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    expect(screen.getByRole('alert')).toHaveTextContent('Error');
  });
});

describe('ToolInvocationCard kind chip', () => {
  it('renders catalog labels, not raw classifier tokens', () => {
    const cases: Array<[Partial<PersonaToolDefinition>, string]> = [
      [{}, 'API'],
      [{ script_path: 'tools/x.ts', implementation_guide: null }, 'Script'],
      [{ category: 'automation' }, 'Automation'],
      [{ script_path: 'builtin://x', implementation_guide: null }, 'Built-in'],
    ];
    for (const [over, label] of cases) {
      const { unmount } = render(
        <ToolInvocationCard tool={{ ...tool(), ...over }} isRunning={false} result={null} error={null} onRun={() => {}} />,
      );
      const toggle = screen.getByTestId('tool-card-toggle-gmail_reader');
      expect(toggle).toHaveTextContent(label);
      expect(toggle.textContent).not.toMatch(/\b(api|script|automation|builtin)\b/);
      unmount();
    }
  });
});

describe('ToolInvocationCard result copy', () => {
  it('copies the pretty-printed output in one click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ToolInvocationCard tool={tool()} isRunning={false} result={result({ success: true, error: null, output: '{"a":1}' })} error={null} onRun={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    fireEvent.click(within(screen.getByTestId('tool-result-gmail_reader')).getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('copies the error text of an IPC failure', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error="IPC timeout" onRun={() => {}} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    fireEvent.click(within(screen.getByTestId('tool-result-gmail_reader')).getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('IPC timeout');
  });
});

describe('ToolInvocationCard default input', () => {
  it('uses declared defaults and type-matched blanks', () => {
    const schema = {
      type: 'object',
      properties: {
        q: { type: 'string' },
        limit: { type: 'integer', default: 10 },
        dry: { type: 'boolean' },
        tags: { type: 'array' },
      },
    };
    render(
      <ToolInvocationCard tool={{ ...tool(), input_schema: JSON.stringify(schema) }} isRunning={false} result={null} error={null} onRun={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    const value = (screen.getByLabelText('Input JSON') as HTMLTextAreaElement).value;
    expect(JSON.parse(value)).toEqual({ q: '', limit: 10, dry: false, tags: [] });
  });
});

describe('ToolInvocationCard execution-strategy rule (mirrors backend tool_kind)', () => {
  const shapes: Array<[string, Partial<PersonaToolDefinition>, boolean]> = [
    ['script only', { script_path: 'tools/x.ts', implementation_guide: null }, true],
    ['guide only', { script_path: '', implementation_guide: 'curl x' }, true],
    ['automation', { category: 'automation', script_path: '', implementation_guide: null }, true],
    ['no strategy', { script_path: '', implementation_guide: null }, false],
    ['empty guide', { script_path: '', implementation_guide: '' }, false],
    ['both strategies', { script_path: 'tools/x.ts', implementation_guide: 'curl x' }, false],
  ];
  for (const [name, over, runnable] of shapes) {
    it(`${runnable ? 'offers' : 'withholds'} Run for ${name}`, () => {
      render(<ToolInvocationCard tool={{ ...tool(), ...over }} isRunning={false} result={null} error={null} onRun={() => {}} />);
      fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
      expect(screen.queryByTestId('tool-run-gmail_reader') !== null).toBe(runnable);
      expect(screen.queryByTestId('tool-strategy-note-gmail_reader') !== null).toBe(!runnable);
    });
  }
});

describe('ToolInvocationCard input schema', () => {
  it('shows type, required, enum and description for each field', () => {
    const schema = {
      type: 'object',
      required: ['to'],
      properties: {
        to: { type: 'string', description: 'Recipient address' },
        mode: { type: 'string', enum: ['draft', 'send'] },
        retries: { type: 'integer' },
      },
    };
    render(
      <ToolInvocationCard tool={{ ...tool(), input_schema: JSON.stringify(schema) }} isRunning={false} result={null} error={null} onRun={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    const box = within(screen.getByTestId('tool-schema-gmail_reader'));
    const to = box.getByText('to').closest('li') as HTMLElement;
    expect(to).toHaveTextContent('string');
    expect(to).toHaveTextContent('required');
    expect(to).toHaveTextContent('Recipient address');
    const mode = box.getByText('mode').closest('li') as HTMLElement;
    expect(mode).toHaveTextContent('one of: draft, send');
    expect(mode).not.toHaveTextContent('required');
    expect(box.getByText('retries').closest('li')).toHaveTextContent('integer');
  });

  it('renders no schema block when the tool declares no properties', () => {
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error={null} onRun={() => {}} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    expect(screen.queryByTestId('tool-schema-gmail_reader')).toBeNull();
  });
});

describe('ToolInvocationCard live-credential confirm', () => {
  it('asks before running a credential-backed tool and runs only on confirm', () => {
    const onRun = vi.fn();
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error={null} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    fireEvent.click(screen.getByTestId('tool-run-gmail_reader'));
    expect(onRun).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('gmail_reader');
    expect(dialog).toHaveTextContent('gmail');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('does not run when the confirm is cancelled', () => {
    const onRun = vi.fn();
    render(<ToolInvocationCard tool={tool()} isRunning={false} result={null} error={null} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    fireEvent.click(screen.getByTestId('tool-run-gmail_reader'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs a tool with no credential requirement immediately', () => {
    const onRun = vi.fn();
    render(<ToolInvocationCard tool={{ ...tool(), requires_credential_type: null }} isRunning={false} result={null} error={null} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-gmail_reader'));
    fireEvent.click(screen.getByTestId('tool-run-gmail_reader'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
