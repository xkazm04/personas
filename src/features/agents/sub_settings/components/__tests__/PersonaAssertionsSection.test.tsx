/**
 * QUALITY GATES SECTION - happy path: create a gate, see it listed, delete it.
 * Both doors must be followed by a refresh, or the list lies about the backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  listOutputAssertions: vi.fn(),
  createOutputAssertion: vi.fn(),
  deleteOutputAssertion: vi.fn(),
  updateOutputAssertion: vi.fn(),
}));
vi.mock('@/api/agents/outputAssertions', () => ({
  listOutputAssertions: (...a: unknown[]) => h.listOutputAssertions(...a),
  createOutputAssertion: (...a: unknown[]) => h.createOutputAssertion(...a),
  deleteOutputAssertion: (...a: unknown[]) => h.deleteOutputAssertion(...a),
  updateOutputAssertion: (...a: unknown[]) => h.updateOutputAssertion(...a),
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

const row = (id: string, name: string) => ({
  id, personaId: 'p1', name, description: null, assertionType: 'contains', config: '{}', severity: 'warning',
  enabled: true, onFailure: 'review', passCount: 0, failCount: 0, lastEvaluatedAt: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
});

beforeEach(() => {
  h.listOutputAssertions.mockReset();
  h.createOutputAssertion.mockReset();
  h.deleteOutputAssertion.mockReset();
});

describe('PersonaAssertionsSection happy path', () => {
  it('creates a gate, lists it, then deletes it', async () => {
    let store: ReturnType<typeof row>[] = [];
    h.listOutputAssertions.mockImplementation(async () => [...store]);
    h.createOutputAssertion.mockImplementation(async () => { store = [row('a1', 'Cites total')]; });
    h.deleteOutputAssertion.mockImplementation(async () => { store = []; });

    render(<PersonaAssertionsSection personaId="p1" />);
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByText('assertions.add'));
    fireEvent.change(screen.getByPlaceholderText('assertions.name_placeholder'), { target: { value: '  Cites total ' } });
    fireEvent.change(screen.getByPlaceholderText('assertions.phrase_placeholder'), { target: { value: 'total' } });
    fireEvent.click(screen.getByText('assertions.create'));

    await waitFor(() => expect(screen.getByText('Cites total')).toBeInTheDocument());
    expect(h.createOutputAssertion).toHaveBeenCalledTimes(1);
    expect(h.createOutputAssertion.mock.calls[0][0]).toMatchObject({
      personaId: 'p1', name: 'Cites total', assertionType: 'contains', onFailure: 'review',
    });
    expect(screen.queryByPlaceholderText('assertions.name_placeholder')).toBeNull();

    fireEvent.click(screen.getByLabelText('assertions.delete'));
    fireEvent.click(screen.getByText('assertions.delete')); // confirm the dialog
    await waitFor(() => expect(screen.queryByText('Cites total')).toBeNull());
    expect(h.deleteOutputAssertion).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());
  });
});
