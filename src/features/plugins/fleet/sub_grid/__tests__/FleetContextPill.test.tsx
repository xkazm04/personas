/**
 * Unit tests for FleetContextPill (F2 conversation-size indicator).
 * readTranscript is mocked; useTranslation is real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({ readTranscript: vi.fn() }));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetContextPill } from '../FleetContextPill';

function summary(lastContextTokens: number): FleetTranscriptSummary {
  return { lastContextTokens, tokens: {}, models: [], tools: [], filesTouched: [] } as unknown as FleetTranscriptSummary;
}

describe('FleetContextPill', () => {
  beforeEach(() => vi.mocked(fleetApi.readTranscript).mockReset());

  it('renders the context size for the bound session', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(summary(42000));
    render(<FleetContextPill claudeSessionId="s1" />);
    await screen.findByTestId('fleet-context-pill');
    expect(fleetApi.readTranscript).toHaveBeenCalledWith('s1');
  });

  it('renders nothing when unbound (and does not fetch)', () => {
    const { container } = render(<FleetContextPill claudeSessionId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(fleetApi.readTranscript).not.toHaveBeenCalled();
  });

  it('renders nothing when context is zero', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(summary(0));
    const { container } = render(<FleetContextPill claudeSessionId="s1" />);
    await waitFor(() => expect(fleetApi.readTranscript).toHaveBeenCalled());
    expect(screen.queryByTestId('fleet-context-pill')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Compact only when bloated (>150k) and a handler is wired', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(summary(180_000));
    const onCompact = vi.fn();
    render(
      <FleetContextPill claudeSessionId="s1" sessionId="internal-1" canCompact onCompact={onCompact} />,
    );
    const btn = await screen.findByTestId('fleet-context-compact');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onCompact).toHaveBeenCalledWith('internal-1');
  });

  it('disables Compact when the session is not between turns', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(summary(180_000));
    render(
      <FleetContextPill claudeSessionId="s1" sessionId="internal-1" canCompact={false} onCompact={vi.fn()} />,
    );
    expect(await screen.findByTestId('fleet-context-compact')).toBeDisabled();
  });

  it('shows no Compact action for a non-bloated session', async () => {
    vi.mocked(fleetApi.readTranscript).mockResolvedValue(summary(42_000));
    render(
      <FleetContextPill claudeSessionId="s1" sessionId="internal-1" canCompact onCompact={vi.fn()} />,
    );
    await screen.findByTestId('fleet-context-pill');
    expect(screen.queryByTestId('fleet-context-compact')).not.toBeInTheDocument();
  });
});
