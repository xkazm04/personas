/**
 * Create must be enabled exactly when pressing it acts: the button and the
 * handler share one "is there a phrase" predicate (parsePhrases), so a
 * comma-only field leaves Create disabled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  listOutputAssertions: vi.fn(),
  createOutputAssertion: vi.fn(),
  deleteOutputAssertion: vi.fn(),
}));
vi.mock('@/api/agents/outputAssertions', () => ({
  listOutputAssertions: (...a: unknown[]) => h.listOutputAssertions(...a),
  createOutputAssertion: (...a: unknown[]) => h.createOutputAssertion(...a),
  deleteOutputAssertion: (...a: unknown[]) => h.deleteOutputAssertion(...a),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => undefined, silentCatch: () => () => undefined }));

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { PersonaAssertionsSection } from '../PersonaAssertionsSection';


const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', personaId: 'p1', name: 'Gate', description: null, assertionType: 'contains', config: '{}',
  severity: 'warning', enabled: true, onFailure: 'review', passCount: 0, failCount: 0, lastEvaluatedAt: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  h.listOutputAssertions.mockReset();
  h.createOutputAssertion.mockReset();
  h.deleteOutputAssertion.mockReset();
});

const renderWith = async (rows: ReturnType<typeof row>[]) => {
  h.listOutputAssertions.mockResolvedValue(rows);
  render(<PersonaAssertionsSection personaId="p1" />);
  await waitFor(() => expect(screen.getByText(rows[0].name as string)).toBeInTheDocument());
};

describe('gate row type label', () => {
  it.each([
    ['contains', 'assertions.type_contains'],
    ['not_contains', 'assertions.type_not_contains'],
    ['regex', 'assertions.type_regex'],
    ['json_path', 'assertions.type_json_path'],
    ['json_schema', 'assertions.type_json_schema'],
    ['length', 'assertions.type_length'],
  ])('labels a %s gate truthfully', async (type, label) => {
    await renderWith([row({ assertionType: type })]);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (type !== 'contains') expect(screen.queryByText('assertions.type_contains')).toBeNull();
  });
});

describe('gate row enabled state', () => {
  it('marks a disabled gate as paused and leaves an active one unmarked', async () => {
    await renderWith([row({ id: 'a1', name: 'Off gate', enabled: false }), row({ id: 'a2', name: 'On gate' })]);
    expect(screen.getAllByText('assertions.paused')).toHaveLength(1);
    expect(screen.getByText('Off gate').parentElement).toContainElement(screen.getByText('assertions.paused'));
    expect(screen.getByText('On gate').parentElement).not.toContainElement(screen.queryByText('assertions.paused'));
  });
});

describe('gate row evaluation meta', () => {
  it('shows pass count, fail count and last-evaluated time', async () => {
    const at = new Date(Date.now() - 2 * 3600_000).toISOString();
    await renderWith([row({ passCount: 12, failCount: 3, lastEvaluatedAt: at })]);
    const stats = screen.getByTestId('assertion-stats');
    expect(stats).toHaveTextContent(/12\s*assertions\.stat_pass/);
    expect(stats).toHaveTextContent(/3\s*assertions\.stat_fail/);
    expect(stats).not.toHaveTextContent('assertions.never_evaluated');
    expect(stats.textContent).toMatch(/2/);
    expect(stats.textContent).toMatch(/ago|h/i);
  });

  it('says a gate was never evaluated when it has no timestamp', async () => {
    await renderWith([row()]);
    expect(screen.getByTestId('assertion-stats')).toHaveTextContent('assertions.never_evaluated');
  });
});
