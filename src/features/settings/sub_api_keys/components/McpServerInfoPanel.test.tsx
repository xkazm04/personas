/**
 * The server binds PERSONAS_WEBHOOK_PORT (default 9420) and the liveness probe
 * reports the port it actually reached. The URL the panel shows and copies must
 * be that port, not a constant that only matches the default.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/agents/mcpTools', () => ({
  probeMcpServer: vi.fn(async () => ({ live: true, port: 9555 })),
}));

import { McpServerInfoPanel } from './McpServerInfoPanel';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('McpServerInfoPanel', () => {
  it('shows the URL of the port the server is actually on', async () => {
    render(<McpServerInfoPanel />);
    expect(await screen.findByText('Running')).toBeTruthy();
    expect(screen.queryByText('http://127.0.0.1:9555')).not.toBeNull();
    expect(screen.queryByText('http://127.0.0.1:9420')).toBeNull();
  });
});
