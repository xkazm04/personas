/**
 * Watching a feed only flipped a subscription row. Chain Studio already knew
 * how to make that feed drive an agent — `draftLinkToTriggerInput`'s
 * marketplace branch — but only from the Studio canvas.
 *
 * The assertion that matters is not "a trigger was created": it is that the
 * payload is BYTE-FOR-BYTE the one the Studio commits, because two doors
 * producing two different `shared:<slug>` listeners is the failure this reuse
 * exists to prevent. So the expected value is computed from the Studio helper
 * itself rather than retyped here.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import { draftLinkToTriggerInput } from '@/features/triggers/sub_studio/libs/studioCommit';

const createTrigger = vi.fn();
const addToast = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  createTrigger: (...a: unknown[]) => createTrigger(...a),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({ personas: [{ id: 'p-2', name: 'Zoe' }, { id: 'p-1', name: 'Ana' }] }),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

import { WireFeedToPersonaModal, feedListenerInput } from '../WireFeedToPersonaModal';

const ENTRY = {
  id: 'entry-1',
  slug: 'openai-api-changes',
  name: 'OpenAI API changes',
  category: 'ai',
} as unknown as SharedEventCatalogEntry;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('feedListenerInput', () => {
  it('is the Studio marketplace payload, not a second definition of it', () => {
    expect(feedListenerInput('openai-api-changes', 'OpenAI API changes', 'p-1')).toEqual(
      draftLinkToTriggerInput({
        id: 'anything',
        source: { kind: 'marketplace', slug: 'openai-api-changes', label: 'OpenAI API changes' },
        targetPersonaId: 'p-1',
        condition: null,
      }),
    );
  });
});

describe('WireFeedToPersonaModal', () => {
  it('creates a shared:<slug> event_listener on the chosen persona', async () => {
    createTrigger.mockResolvedValue({ id: 'trg-1' });
    render(<WireFeedToPersonaModal entry={ENTRY} onClose={() => {}} />);

    // Roster is sorted by name, so Ana precedes Zoe regardless of store order.
    const options = screen.getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(['Ana', 'Zoe']);

    fireEvent.click(options[0]);
    fireEvent.click(screen.getByText('Wire it').closest('button')!);

    await waitFor(() => expect(createTrigger).toHaveBeenCalledTimes(1));
    expect(createTrigger.mock.calls[0][0]).toEqual({
      persona_id: 'p-1',
      trigger_type: 'event_listener',
      config: JSON.stringify({ listen_event_type: 'shared:openai-api-changes' }),
      enabled: true,
      use_case_id: null,
    });
  });

  it('cannot fire before a persona is picked', () => {
    render(<WireFeedToPersonaModal entry={ENTRY} onClose={() => {}} />);
    const confirm = screen.getByText('Wire it').closest('button')!;
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(createTrigger).not.toHaveBeenCalled();
  });
});
