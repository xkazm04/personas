/**
 * A FILTER IS ONLY OFFERED WHERE IT CAN MATCH ROWS.
 *
 * Starred-only and the tag select narrow to execution rows, which the
 * Events/Memories/Reviews/Messages/Attention tabs never contain: a toggle set
 * on All emptied Events, and the control stayed visible there to do it again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) =>
  new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
const tx = (s: unknown) => String(s);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx, language: 'en' }),
  getActiveTranslations: () => t,
}));

const h = vi.hoisted(() => ({
  searchEvents: vi.fn(),
  listMemories: vi.fn(),
}));
vi.mock('@/api/agents/executions', () => ({ listExecutions: vi.fn(async () => []) }));
vi.mock('@/api/agents/responsibilities', () => ({ listAttentionLedger: vi.fn(async () => []) }));
vi.mock('@/api/overview/events', () => ({ searchEvents: (...a: unknown[]) => h.searchEvents(...a) }));
vi.mock('@/api/overview/memories', () => ({ listMemories: (...a: unknown[]) => h.listMemories(...a) }));
vi.mock('@/api/overview/reviews', () => ({ listManualReviewsPage: vi.fn(async () => ({ rows: [] })) }));
vi.mock('@/api/overview/reports', () => ({ listReports: vi.fn(async () => []), deleteReport: vi.fn() }));
vi.mock('@/stores/selectors/personaSelectors', () => ({ useSelectedUseCases: () => [] }));
const annotations = vi.hoisted(() => ({ byExecution: new Map(), knownTags: ['urgent'] }));
vi.mock('@/hooks/agents/useExecutionAnnotations', () => ({
  useExecutionAnnotations: () => annotations,
}));
vi.mock('../../sub_executions/libs/useExecutionList', () => ({ useExecutionList: () => ({ executions: [] }) }));
vi.mock('../../sub_executions/components/list/ExecutionList', () => ({ ExecutionList: () => null }));
vi.mock('../../sub_executions/components/ActiveChainsBadge', () => ({ ActiveChainsBadge: () => null }));
vi.mock('../ActivityModals', () => ({ useActivityModals: () => ({ handleRowClick: () => {}, modals: null }) }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => undefined }));

const agentState = { selectedPersona: { id: 'p1', name: 'Ada', color: '#6366f1' } };
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: (s: typeof agentState) => unknown) => (selector ? selector(agentState) : agentState),
    { getState: () => agentState },
  ),
}));

import { ActivityTab } from '../ActivityTab';

beforeEach(() => {
  h.searchEvents.mockReset();
  h.listMemories.mockReset();
  h.searchEvents.mockResolvedValue({
    events: [{ id: 'ev1', event_type: 'foo_bar', source_type: 'sys', status: 'delivered', created_at: '2026-09-01T00:00:00Z' }],
  });
  h.listMemories.mockResolvedValue([]);
});

describe('Activity run-only filters', () => {
  it('does not let a starred toggle set on All empty the Events tab', async () => {
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.all/));
    fireEvent.click(await screen.findByText('activity.filter_starred_only'));
    fireEvent.click(screen.getByText(/^activity_filters\.events/));
    await waitFor(() => expect(screen.getByText('Foo Bar')).toBeTruthy());
  });

  it('offers the starred and tag controls only where runs are listed', async () => {
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.all/));
    expect(await screen.findByText('activity.filter_starred_only')).toBeTruthy();
    expect(screen.getByTitle('activity.filter_tag')).toBeTruthy();
    fireEvent.click(screen.getByText(/^activity_filters\.events/));
    await waitFor(() => expect(screen.getByText('Foo Bar')).toBeTruthy());
    expect(screen.queryByText('activity.filter_starred_only')).toBeNull();
    expect(screen.queryByTitle('activity.filter_tag')).toBeNull();
  });
});

describe('Activity tab toggles', () => {
  it('does not refetch the other feeds when entering and leaving the Runs tab', async () => {
    render(<ActivityTab />);
    await waitFor(() => expect(h.listMemories).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(/^activity_filters.events/));
    await waitFor(() => expect(screen.getByText('Foo Bar')).toBeTruthy());
    fireEvent.click(screen.getByText(/^activity_filters.executions/));
    fireEvent.click(screen.getByText(/^activity_filters.events/));
    await waitFor(() => expect(screen.getByText('Foo Bar')).toBeTruthy());
    // Events -> Runs -> Events: the memory feed did not change.
    expect(h.listMemories).toHaveBeenCalledTimes(1);
    expect(h.searchEvents).toHaveBeenCalledTimes(1);
  });
});
