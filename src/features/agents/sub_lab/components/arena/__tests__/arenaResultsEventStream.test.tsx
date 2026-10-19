import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';

const labGetToolCalls = vi.fn();
const labGetResultEvents = vi.fn();
vi.mock('@/api/agents/lab', () => ({
  labGetToolCalls: (...a: unknown[]) => labGetToolCalls(...a),
  labGetResultEvents: (...a: unknown[]) => labGetResultEvents(...a),
  labGetScoreWeights: () => Promise.resolve({ toolAccuracy: 0.4, outputQuality: 0.4, protocolCompliance: 0.2 }),
}));

import { ArenaResultsView } from '../ArenaResultsView';

const result: LabArenaResult = {
  id: 'res-1',
  runId: 'run-1',
  versionId: null,
  versionNumber: null,
  scenarioName: 'Triage inbox',
  modelId: 'haiku',
  provider: 'anthropic',
  status: 'completed',
  outputPreview: 'ok',
  toolAccuracyScore: 80,
  outputQualityScore: 70,
  protocolCompliance: 90,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.001,
  durationMs: 1200,
  rationale: null,
  suggestions: null,
  errorMessage: null,
  evalMethod: null,
  createdAt: '2026-10-18T00:00:00Z',
} as LabArenaResult; // fixture: every binding field set; the cast only spares tracking optional extras

describe('ArenaResultsView - the selected cell reads its captured tool calls and events', () => {
  beforeEach(() => {
    labGetToolCalls.mockReset().mockResolvedValue([
      { id: 't1', resultKind: 'arena', resultId: 'res-1', sequence: 0, toolName: 'gmail_search', variant: 'actual' },
    ]);
    labGetResultEvents.mockReset().mockResolvedValue([]);
  });

  it('regression: opening a cell queries lab_tool_calls for that arena result', async () => {
    render(<ArenaResultsView results={[result]} />);
    fireEvent.click(screen.getByRole('button', { name: /80/ }));
    await waitFor(() => expect(labGetToolCalls).toHaveBeenCalledWith('res-1', 'arena'));
    expect(await screen.findByText('gmail_search')).toBeTruthy();
  });
});
