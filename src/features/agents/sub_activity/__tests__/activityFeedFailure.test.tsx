/**
 * EVERY ACTIVITY FEED DISCLOSES A FAILED READ, NOT ONLY ATTENTION.
 *
 * The attention feed disclosed a failed ledger read (golden path
 * partial-failure-read-envelope); the event, memory, review, report and
 * execution feeds caught their failure and landed [], so a dead feed rendered
 * the "no activity" empty state. Pinned: a rejected feed read is named in a
 * notice on the tab that shows it, and a feed that loads clears it.
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
// One `tx` for the life of the file, as the real hook's is (see
// activityTabRunsRegion.test.tsx for why a fresh one per call never settles).
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
vi.mock('@/hooks/agents/useExecutionAnnotations', () => ({
  useExecutionAnnotations: () => ({ byExecution: new Map(), knownTags: [] }),
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
  h.listMemories.mockResolvedValue([]);
});

describe('Activity feed read failures', () => {
  it('names a failed event feed on the Events tab instead of showing an empty feed', async () => {
    h.searchEvents.mockRejectedValue({ error: 'db locked', kind: 'Database' });
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.events/));
    const notice = await screen.findByTestId('activity-feed-unavailable');
    expect(notice.textContent).toContain('activity_filters.events');
    expect(notice.textContent).toContain('common.source_unreachable');
  });

  it('shows no notice on a tab whose feed loaded', async () => {
    h.searchEvents.mockRejectedValue(new Error('boom'));
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.memories/));
    await waitFor(() => expect(h.listMemories).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('activity-feed-unavailable')).toBeNull();
  });
});
