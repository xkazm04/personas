/**
 * A reply draft belongs to the twin it was generated for.
 *
 * The footer's twin picker can change the active twin while a draft sits in
 * the outbox. Approve used to read the LIVE active twin, so a reply written in
 * twin A's voice was logged as an outbound message of twin B (and fed B's
 * channel activity). The channel and contact were already frozen at generation
 * time; the twin was not.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';

vi.mock('@/api/twin/twin', () => ({
  listTwinContacts: vi.fn().mockResolvedValue([]),
}));

const mockState = {
  activeTwinId: 'twin-a' as string | null,
  twinReplyDraft: null as string | null,
  twinReplyDrafting: false,
  twinTones: [] as unknown[],
  twinCommunications: [] as unknown[],
  draftTwinReply: vi.fn(),
  setTwinReplyDraft: vi.fn(),
  clearTwinReplyDraft: vi.fn(),
  recordTwinInteraction: vi.fn().mockResolvedValue({}),
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import { ReplyOutbox } from '../ReplyOutbox';

const CHANNELS: TwinChannel[] = [
  {
    id: 'ch-1',
    twin_id: 'twin-a',
    channel_type: 'discord',
    credential_id: null,
    persona_id: null,
    label: 'Discord',
    is_active: true,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  } as TwinChannel,
];

describe('ReplyOutbox twin attribution', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['plugins']);
  });

  beforeEach(() => {
    mockState.activeTwinId = 'twin-a';
    mockState.twinReplyDraft = null;
    mockState.draftTwinReply.mockReset();
    mockState.clearTwinReplyDraft.mockReset();
    mockState.recordTwinInteraction.mockClear();
    mockState.draftTwinReply.mockImplementation(async () => {
      mockState.twinReplyDraft = 'Hi from twin A';
      return 'Hi from twin A';
    });
  });

  async function generateThenApprove(switchTo: string | null) {
    const view = render(<ReplyOutbox channels={CHANNELS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    });
    expect(mockState.draftTwinReply).toHaveBeenCalledWith('twin-a', 'discord', undefined, undefined, undefined, undefined);
    view.rerender(<ReplyOutbox channels={CHANNELS} />);

    if (switchTo) {
      // The operator switches the active twin in the footer while the draft is open.
      mockState.activeTwinId = switchTo;
      view.rerender(<ReplyOutbox channels={CHANNELS} />);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approve & log/i }));
    });
    const confirm = screen.getAllByRole('button', { name: /approve & log/i });
    await act(async () => {
      fireEvent.click(confirm[confirm.length - 1]!);
    });
  }

  it('logs an approved draft against the twin it was generated for', async () => {
    await generateThenApprove(null);
    expect(mockState.recordTwinInteraction).toHaveBeenCalledTimes(1);
    expect(mockState.recordTwinInteraction.mock.calls[0]![0]).toBe('twin-a');
  });

  it("never logs twin A's draft as twin B's after the active twin changes", async () => {
    await generateThenApprove('twin-b');
    const asB = mockState.recordTwinInteraction.mock.calls.filter((c) => c[0] === 'twin-b');
    expect(asB).toHaveLength(0);
  });

  it('drops the draft when the active twin changes, so twin B never shows twin A\'s reply', async () => {
    const view = render(<ReplyOutbox channels={CHANNELS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    });
    view.rerender(<ReplyOutbox channels={CHANNELS} />);
    expect(mockState.clearTwinReplyDraft).not.toHaveBeenCalled();

    mockState.activeTwinId = 'twin-b';
    view.rerender(<ReplyOutbox channels={CHANNELS} />);
    expect(mockState.clearTwinReplyDraft).toHaveBeenCalledTimes(1);
  });
});
