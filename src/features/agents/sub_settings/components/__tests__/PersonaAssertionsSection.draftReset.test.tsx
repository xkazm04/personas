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

describe('add-gate draft across a persona switch', () => {
  it('does not carry an open, half-typed draft to the next persona', async () => {
    const { rerender } = render(<PersonaAssertionsSection personaId="p1" />);
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());
    fireEvent.click(screen.getByText('assertions.add'));
    fireEvent.change(screen.getByPlaceholderText('assertions.name_placeholder'), { target: { value: 'draft typed for p1' } });
    fireEvent.change(screen.getByPlaceholderText('assertions.phrase_placeholder'), { target: { value: 'total' } });

    rerender(<PersonaAssertionsSection personaId="p2" />);
    expect(screen.queryByPlaceholderText('assertions.name_placeholder')).toBeNull();
    await waitFor(() => expect(screen.getByText('assertions.empty')).toBeInTheDocument());
    expect(h.createOutputAssertion).not.toHaveBeenCalled();

    // Opening the form again on p2 starts blank.
    fireEvent.click(screen.getByText('assertions.add'));
    expect(screen.getByPlaceholderText('assertions.name_placeholder')).toHaveValue('');
  });
});
