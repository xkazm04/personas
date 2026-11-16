/**
 * Create must be enabled exactly when pressing it acts: the button and the
 * handler share one "is there a phrase" predicate (parsePhrases), so a
 * comma-only field leaves Create disabled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

beforeEach(() => {
  h.listOutputAssertions.mockReset().mockResolvedValue([]);
  h.createOutputAssertion.mockReset();
  h.deleteOutputAssertion.mockReset();
});

describe('add-gate Create enablement', () => {
  it.each([',,', ' , ', ' ,, , '])('keeps Create disabled for the comma-only phrase %j', async (phrase) => {
    render(<PersonaAssertionsSection personaId="p1" />);
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());
    fireEvent.click(screen.getByText('assertions.add'));
    fireEvent.change(screen.getByPlaceholderText('assertions.name_placeholder'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('assertions.phrase_placeholder'), { target: { value: phrase } });
    expect(screen.getByText('assertions.create').closest('button')).toBeDisabled();
  });

  it('enables Create once a real phrase is present', async () => {
    render(<PersonaAssertionsSection personaId="p1" />);
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());
    fireEvent.click(screen.getByText('assertions.add'));
    fireEvent.change(screen.getByPlaceholderText('assertions.name_placeholder'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('assertions.phrase_placeholder'), { target: { value: 'a,,' } });
    expect(screen.getByText('assertions.create').closest('button')).toBeEnabled();
  });
});
