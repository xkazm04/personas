/**
 * A STALE CHANGE-LOG RESPONSE NEVER PAINTS UNDER THE WRONG PERSONA.
 *
 * The list fetch had no generation guard: persona A's slow response landed
 * after the user had switched to B and replaced B's rows with A's (and
 * cleared B's loading ghost early). Pinned: after a switch, only the newest
 * request's rows reach the screen, whatever order the responses arrive in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ listPersonaChangeLog: vi.fn() }));
vi.mock('@/api/agents/personas', () => ({
  listPersonaChangeLog: (...a: unknown[]) => h.listPersonaChangeLog(...a),
}));
vi.mock('@/features/shared/components/display/RelativeTime', () => ({ RelativeTime: () => null }));

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

type Entry = { id: string; personaId: string; field: string; beforeValue: string | null; afterValue: string | null; source: string | null; createdAt: string };
const entry = (id: string, personaId: string, field: string): Entry =>
  ({ id, personaId, field, beforeValue: 'a', afterValue: 'b', source: 'editor', createdAt: '2026-09-01T00:00:00Z' });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { h.listPersonaChangeLog.mockReset(); });

describe('PersonaChangeHistory', () => {
  it('drops a stale response that lands after a persona switch', async () => {
    const first = deferred<Entry[]>();
    const second = deferred<Entry[]>();
    h.listPersonaChangeLog.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(<PersonaChangeHistory personaId="p1" />);
    rerender(<PersonaChangeHistory personaId="p2" />);
    await waitFor(() => expect(h.listPersonaChangeLog).toHaveBeenCalledTimes(2));

    second.resolve([entry('e2', 'p2', 'max_turns')]);
    await waitFor(() => expect(screen.getByText('max_turns')).toBeInTheDocument());

    // Persona A's response arrives last; it must not overwrite B's rows.
    first.resolve([entry('e1', 'p1', 'name')]);
    await tick(); await tick();
    expect(screen.queryByText('name')).toBeNull();
    expect(screen.getByText('max_turns')).toBeInTheDocument();
  });
});
