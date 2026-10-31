/**
 * A TAB COUNT NEVER CLAIMS COMPLETENESS IT LACKS.
 *
 * Each feed fetches its newest 50 rows; the tab merges and counts over that
 * window, so "(50)" means "at least 50". Pinned: a feed that returns exactly
 * its limit is labelled "50+", a feed under its limit is labelled exactly, and
 * the All tab says "+" when any feed it sums is truncated.
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
  listExecutions: vi.fn(),
  listAttentionLedger: vi.fn(),
  searchEvents: vi.fn(),
  listMemories: vi.fn(),
  listManualReviewsPage: vi.fn(),
  listReports: vi.fn(),
}));
vi.mock('@/api/agents/executions', () => ({ listExecutions: (...a: unknown[]) => h.listExecutions(...a) }));
vi.mock('@/api/agents/responsibilities', () => ({ listAttentionLedger: (...a: unknown[]) => h.listAttentionLedger(...a) }));
vi.mock('@/api/overview/events', () => ({ searchEvents: (...a: unknown[]) => h.searchEvents(...a) }));
vi.mock('@/api/overview/memories', () => ({ listMemories: (...a: unknown[]) => h.listMemories(...a) }));
vi.mock('@/api/overview/reviews', () => ({ listManualReviewsPage: (...a: unknown[]) => h.listManualReviewsPage(...a) }));
vi.mock('@/api/overview/reports', () => ({ listReports: (...a: unknown[]) => h.listReports(...a), deleteReport: vi.fn() }));
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

const ts = '2026-09-01T00:00:00Z';
const many = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

const FEEDS = [
  { name: 'execution', label: /^activity_filters\.executions/, mock: h.listExecutions,
    resolve: (n: number) => many(n, (i) => ({ id: `x${i}`, status: 'completed', output_data: null, started_at: ts, created_at: ts })) },
  { name: 'event', label: /^activity_filters\.events/, mock: h.searchEvents,
    resolve: (n: number) => ({ events: many(n, (i) => ({ id: `e${i}`, event_type: 'a_b', source_type: 's', status: 'ok', created_at: ts })) }) },
  { name: 'memory', label: /^activity_filters\.memories/, mock: h.listMemories,
    resolve: (n: number) => many(n, (i) => ({ id: `m${i}`, title: 't', category: 'c', importance: 1, created_at: ts })) },
  { name: 'review', label: /^activity_filters\.reviews/, mock: h.listManualReviewsPage,
    resolve: (n: number) => ({ rows: many(n, (i) => ({ id: `r${i}`, title: 't', description: '', status: 'pending', created_at: ts })) }) },
  { name: 'message', label: /^activity_filters\.messages/, mock: h.listReports,
    resolve: (n: number) => many(n, (i) => ({ id: `g${i}`, title: 't', content: '', priority: 'normal', created_at: ts })) },
  { name: 'attention', label: /^life\.activity_filter_attention/, mock: h.listAttentionLedger,
    resolve: (n: number) => many(n, (i) => ({ id: `a${i}`, reason: 'r', verdict: 'ok', startedAt: ts })) },
];

function load(counts: Record<string, number>) {
  for (const f of FEEDS) f.mock.mockResolvedValue(f.resolve(counts[f.name] ?? 0));
}
const tabText = (label: RegExp) => screen.getByText(label).closest('button')!.textContent;

beforeEach(() => { for (const f of FEEDS) f.mock.mockReset(); });

describe('Activity tab counts disclose truncation', () => {
  it.each(FEEDS.map((f) => [f.name, f] as const))('labels a full %s window "50+"', async (_n, feed) => {
    load({ [feed.name]: 50 });
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.all/));
    await waitFor(() => expect(tabText(feed.label)).toContain('(50'));
    expect(tabText(feed.label)).toContain('(50+)');
    expect(tabText(/^activity_filters\.all/)).toContain('(50+)');
  });

  it('labels a feed under its limit exactly', async () => {
    load({ memory: 3 });
    render(<ActivityTab />);
    fireEvent.click(screen.getByText(/^activity_filters\.all/));
    await waitFor(() => expect(tabText(/^activity_filters\.memories/)).toContain('(3)'));
    expect(tabText(/^activity_filters\.memories/)).not.toContain('+');
    expect(tabText(/^activity_filters\.all/)).toContain('(3)');
    expect(tabText(/^activity_filters\.all/)).not.toContain('+');
  });
});
