/**
 * Unit tests for ToolInvocationCard's rendering of the shared tool-outcome
 * contract fields (error_kind, http_status, output_truncated, retryable).
 * useTranslation is real; no IPC is involved (the card is presentational).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
