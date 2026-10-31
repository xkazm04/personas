/**
 * A FAILED CHANGE-LOG READ IS NEVER SHOWN AS DATA OR AS EMPTY.
 *
 * The read's catch only left a breadcrumb: the rows already on screen stayed,
 * so after an agent switch whose read failed, the PREVIOUS agent's field
 * changes were shown under the new agent's name; and on a first load the panel
 * said "no changes yet". Pinned: a failure clears the rows and says the source
 * could not be reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ listPersonaChangeLog: vi.fn() }));
vi.mock('@/api/agents/personas', () => ({
  listPersonaChangeLog: (...a: unknown[]) => h.listPersonaChangeLog(...a),
}));
vi.mock('@/features/shared/components/display/RelativeTime', () => ({ RelativeTime: () => null }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => undefined }));

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

import { PersonaChangeHistory } from '../PersonaChangeHistory';

const entry = (id: string, field: string) =>
  ({ id, personaId: 'p1', field, beforeValue: 'a', afterValue: 'b', source: 'editor', createdAt: '2026-09-01T00:00:00Z' });

beforeEach(() => { h.listPersonaChangeLog.mockReset(); });

describe('PersonaChangeHistory read failure', () => {
  it('drops the previous agent\'s rows when the new agent\'s read fails', async () => {
    h.listPersonaChangeLog
      .mockResolvedValueOnce([entry('e1', 'model_profile')])
      .mockRejectedValueOnce({ error: 'db locked', kind: 'Database' });

    const { rerender } = render(<PersonaChangeHistory personaId="p1" />);
    await waitFor(() => expect(screen.getByText('model_profile')).toBeInTheDocument());

    rerender(<PersonaChangeHistory personaId="p2" />);
    await waitFor(() => expect(screen.getByText('common.source_unreachable')).toBeInTheDocument());
    expect(screen.queryByText('model_profile')).toBeNull();
  });

  it('does not render a failed first load as "no changes yet"', async () => {
    h.listPersonaChangeLog.mockRejectedValueOnce(new Error('boom'));
    render(<PersonaChangeHistory personaId="p1" />);
    await waitFor(() => expect(screen.getByText('common.source_unreachable')).toBeInTheDocument());
    expect(screen.queryByText('change_history.empty')).toBeNull();
  });
});
