/**
 * Resuming a saved import must land on a step the wizard can still show.
 *
 * N8nImportTab renders a surface for `upload` and `analyze` only - the
 * transform / edit / confirm step components were deleted with the n8n
 * subtree cleanup - but the session list still routed a saved session to
 * its persisted step (or to `edit` when a draft existed), so resuming one
 * opened an empty panel with a disabled "Review & confirm" and no way on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  listN8nSessionSummaries: vi.fn(),
  deleteN8nSession: vi.fn(),
  getN8nSession: vi.fn(),
}));
vi.mock('@/api/templates/n8nTransform', () => api);

import { N8nSessionList } from '../N8nSessionList';

const parser_result = { name: 'Wf', suggested_tools: [], suggested_triggers: [] };
const draft_json = { name: 'Draft persona' };

const summary = (status: string, step: string) => ({
  id: 's1', workflow_name: 'Wf', status, step, error: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});

const full = (status: string, step: string, withParse = true) => ({
  ...summary(status, step),
  raw_workflow_json: '{}',
  parser_result: withParse ? parser_result : null,
  draft_json,
  questions_json: null,
  user_answers: null,
  transform_id: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function resume(status: string, step: string, withParse = true) {
  api.listN8nSessionSummaries.mockResolvedValue([summary(status, step)]);
  api.getN8nSession.mockResolvedValue(full(status, step, withParse));
  const onLoadSession = vi.fn();
  render(<N8nSessionList onLoadSession={onLoadSession} />);
  fireEvent.click(await screen.findByTestId('n8n-session-card-s1'));
  await waitFor(() => expect(onLoadSession).toHaveBeenCalledTimes(1));
  return onLoadSession.mock.calls[0]![0] as { step: string };
}

describe('N8nSessionList resume routing', () => {
  it.each([
    ['editing', 'edit'],
    ['editing', 'confirm'],
    ['draft', 'transform'],
    ['awaiting_answers', 'transform'],
    ['failed', 'edit'],
    ['interrupted', 'transform'],
  ])('a %s session saved at %s resumes on the analyze step', async (status, step) => {
    expect((await resume(status, step)).step).toBe('analyze');
  });

  it('a session with no parse resumes on upload', async () => {
    expect((await resume('failed', 'edit', false)).step).toBe('upload');
  });
});
