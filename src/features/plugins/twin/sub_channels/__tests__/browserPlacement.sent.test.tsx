/**
 * A draft the Twin toolbar types into a page box is a PLACEMENT, not a send.
 *
 * The page's own send button is the human gate, and the app never learns
 * whether it was pressed: the person may edit the text, send it, or close the
 * tab. So the only record the app can write truthfully is of its own act,
 * labelled as a placement (registry: hitl-approval / decision-records). This
 * file drives the real lane - one insert and two regenerates into the same box -
 * feeds the rows it records into the channel surfaces, beside one reply that
 * really was sent from the outbox, and counts what reads as "sent".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';

import type { PickedTarget } from '@/lib/bindings/PickedTarget';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

vi.mock('@/api/browser', () => ({
  pickTarget: vi.fn(),
  pickCancel: vi.fn(),
  fillTarget: vi.fn(),
  submitTarget: vi.fn(),
  isPickCancelled: () => false,
  listenTabs: vi.fn(),
  listTabs: vi.fn(),
}));

vi.mock('@/api/twin/twin', () => ({
  draftForPage: vi.fn(),
  recordInteraction: vi.fn(),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
}));

const mockState = {
  activeTwinId: 'twin-1' as string | null,
  fetchTwinCommunications: vi.fn().mockResolvedValue(undefined),
  twinCommsLoading: false,
  twinCommunications: [] as TwinCommunication[],
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import * as browserApi from '@/api/browser';
import * as twinApi from '@/api/twin/twin';

import { arm, regenerate, resetTwinDraftLane, twinDraftSnapshot } from '@/features/browser/twinDraftLane';
import { SentReplies } from '../SentReplies';
import { useChannelActivity } from '../useChannelActivity';

const pickTarget = vi.mocked(browserApi.pickTarget);
const fillTarget = vi.mocked(browserApi.fillTarget);
const draftForPage = vi.mocked(twinApi.draftForPage);
const recordInteraction = vi.mocked(twinApi.recordInteraction);

const TARGET: PickedTarget = {
  ref: 'ref_3_ab12',
  label: 'Add a comment',
  existingText: '',
  formHint: 'Post',
  precedingText: 'Great write-up.',
  mainText: 'An article.',
  selectionText: '',
  thread: [],
  title: 'A post',
  url: 'https://forum.example.com/t/42',
  truncated: [],
};

/** The rows the lane asked the backend to store, as the backend would return them. */
function rowsRecorded(): TwinCommunication[] {
  return recordInteraction.mock.calls.map(
    ([twinId, channel, direction, content, contactHandle, summary, keyFactsJson], i) => ({
      id: `placed-${i}`,
      twin_id: twinId,
      channel,
      direction,
      contact_handle: contactHandle ?? null,
      content,
      summary: summary ?? null,
      key_facts_json: keyFactsJson ?? null,
      occurred_at: `2026-09-23T10:0${i}:00Z`,
      created_at: `2026-09-23T10:0${i}:00Z`,
    }),
  );
}

/** One reply the user approved in the Reply Outbox - a real send. */
const OUTBOX_SEND: TwinCommunication = {
  id: 'sent-0',
  twin_id: 'twin-1',
  channel: 'slack',
  direction: 'out',
  contact_handle: 'alice',
  content: 'See you at ten.',
  summary: null,
  key_facts_json: null,
  occurred_at: '2026-09-23T09:00:00Z',
  created_at: '2026-09-23T09:00:00Z',
};

async function insertThenRegenerateTwice(): Promise<void> {
  pickTarget.mockResolvedValueOnce(TARGET);
  fillTarget.mockResolvedValue(undefined);
  recordInteraction.mockResolvedValue({} as never);
  for (const draft of ['First draft.', 'Second draft.', 'Third draft.']) {
    draftForPage.mockResolvedValueOnce({ draft, tone_channel: 'browser', kb_grounded: false });
  }
  await arm(7, 'twin-1');
  await regenerate('twin-1');
  await regenerate('twin-1');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTwinDraftLane();
});

describe('a page placement is not a sent message', () => {
  it('three placements and one real send: only the send reads as sent', async () => {
    await insertThenRegenerateTwice();

    // Floor: the lane still reaches `inserted` and still records every placement.
    expect(twinDraftSnapshot().phase).toBe('inserted');
    expect(recordInteraction).toHaveBeenCalledTimes(3);

    mockState.twinCommunications = [OUTBOX_SEND, ...rowsRecorded()];

    const { container } = render(<SentReplies channels={[]} onReuse={() => undefined} />);
    const sentRows = container.querySelectorAll('li').length;
    const { result } = renderHook(() => useChannelActivity('twin-1'));
    const browserSent = result.current.sentByChannel.get('browser') ?? 0;
    const slackSent = result.current.sentByChannel.get('slack') ?? 0;

    // Target: no placement reads as a send.
    expect(browserSent).toBe(0);
    expect(sentRows).toBe(1);
    // Floor: the real send is still listed and counted.
    expect(slackSent).toBe(1);
    expect(screen.getByText('See you at ten.')).toBeTruthy();
    // Floor: the browser channel still shows activity - the app did act there.
    expect(result.current.lastByChannel.get('browser')).toBe('2026-09-23T10:02:00Z');
  });
});
