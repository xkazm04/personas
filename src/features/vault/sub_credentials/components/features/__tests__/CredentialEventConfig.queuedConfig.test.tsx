import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * A second config change on the same event while a save is in flight used to
 * return early and vanish. It must be queued and flushed after the first save.
 */
const h = vi.hoisted(() => ({
  state: { credentialEvents: [] as { id: string; credential_id: string; event_template_id: string; config: string }[] },
  update: vi.fn(),
  onUpdate: null as null | ((id: string, tpl: string, u: Record<string, unknown>) => Promise<void>),
}));

vi.mock('@/stores/vaultStore', () => {
  const useVaultStore = Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        credentialEvents: h.state.credentialEvents,
        fetchCredentialEvents: vi.fn(async () => {}),
        createCredentialEvent: vi.fn(),
        updateCredentialEvent: h.update,
      }),
    { getState: () => h.state },
  );
  return { useVaultStore };
});
vi.mock('../EventTemplateCard', () => ({
  EventTemplateCard: (p: { onUpdateConfig: typeof h.onUpdate }) => {
    h.onUpdate = p.onUpdateConfig;
    return null;
  },
}));

import { CredentialEventConfig } from '../CredentialEventConfig';

describe('CredentialEventConfig config writes', () => {
  beforeEach(() => {
    h.update.mockReset();
    h.state.credentialEvents = [{ id: 'e1', credential_id: 'c1', event_template_id: 't', config: '{}' }];
  });

  it('persists the last config change made during an in-flight save', async () => {
    let release!: () => void;
    h.update.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    h.update.mockResolvedValue(undefined);
    render(<CredentialEventConfig credentialId="c1" events={[{ id: 't', name: 'T', description: '' }]} />);
    let first!: Promise<void>;
    await act(async () => {
      first = h.onUpdate!('e1', 't', { days: 3 });
      await h.onUpdate!('e1', 't', { days: 14 });
    });
    await act(async () => { release(); await first; });
    const configs = h.update.mock.calls.map((c) => c[1].config.days);
    expect(configs).toEqual([3, 14]);
  });
});
