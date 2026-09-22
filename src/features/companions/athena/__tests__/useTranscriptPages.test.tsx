/**
 * Unit tests for transcript pagination. Pure JS — no Rust, no real Tauri.
 *
 * What we cover:
 *  - Cursor derivation from a transcript / from a served page.
 *  - A load prepends the older page and advances the anchor.
 *  - Exhaustion latches on the newly-oldest message and blocks further loads.
 *  - An all-filtered page keeps walking within the same load.
 *  - `fetchAllOlderMessages` walks to the end and returns oldest-first.
 *  - Prepending dedupes by id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import type { CompanionMessage, CompanionMessagePage } from '@/api/companion';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => {},
  toastCatch: () => () => {},
}));

import {
  cursorFromMessages,
  cursorFromPage,
  fetchAllOlderMessages,
  useTranscriptPages,
} from '../useTranscriptPages';
import { useCompanionStore } from '../companionStore';

function msg(id: string, createdAt: string, role = 'user'): CompanionMessage {
  return { id, role, content: `body ${id}`, createdAt };
}

function page(over: Partial<CompanionMessagePage> = {}): CompanionMessagePage {
  return {
    messages: [],
    nextBeforeCreatedAt: null,
    nextBeforeId: null,
    exhausted: true,
    ...over,
  };
}

/** A page whose messages imply their own next cursor (oldest row). */
function pageOf(messages: CompanionMessage[], exhausted = false): CompanionMessagePage {
  const oldest = messages[0]!;
  return {
    messages,
    nextBeforeCreatedAt: oldest.createdAt,
    nextBeforeId: oldest.id,
    exhausted,
  };
}

const scrollRef = createRef<HTMLDivElement>();

beforeEach(() => {
  invokeMock.mockReset();
  useCompanionStore.setState({ messages: [] });
});

describe('cursor helpers', () => {
  it('derives the cursor from the oldest message', () => {
    expect(cursorFromMessages([msg('m2', 'T2'), msg('m3', 'T3')])).toEqual({
      beforeCreatedAt: 'T2',
      beforeId: 'm2',
    });
    expect(cursorFromMessages([])).toBeNull();
  });

  it('reads the next cursor off a served page, null when the page had no rows', () => {
    expect(cursorFromPage(pageOf([msg('m1', 'T1')]))).toEqual({
      beforeCreatedAt: 'T1',
      beforeId: 'm1',
    });
    expect(cursorFromPage(page())).toBeNull();
  });
});

describe('useTranscriptPages', () => {
  function mount(messages: CompanionMessage[]) {
    return renderHook(
      (props: { messages: CompanionMessage[] }) =>
        useTranscriptPages({
          scrollRef,
          conversationId: 'default',
          messages: props.messages,
          enabled: true,
        }),
      { initialProps: { messages } },
    );
  }

  it('loads an older page and prepends it, keyed off the oldest message', async () => {
    useCompanionStore.setState({ messages: [msg('m3', 'T3')] });
    invokeMock.mockResolvedValueOnce(pageOf([msg('m1', 'T1'), msg('m2', 'T2')]));

    const { result } = mount([msg('m3', 'T3')]);
    act(() => result.current.loadOlder());

    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    expect(invokeMock).toHaveBeenCalledWith(
      'companion_list_messages_before',
      expect.objectContaining({ beforeCreatedAt: 'T3', beforeId: 'm3', conversationId: 'default' }),
    );
    expect(useCompanionStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('latches exhaustion on the newly-oldest message and stops loading', async () => {
    useCompanionStore.setState({ messages: [msg('m2', 'T2')] });
    invokeMock.mockResolvedValueOnce(pageOf([msg('m1', 'T1')], true));

    const { result, rerender } = mount([msg('m2', 'T2')]);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));

    // The hook's `exhausted` compares against the CURRENT oldest, so the
    // caller must re-render with the prepended list for it to read true.
    rerender({ messages: useCompanionStore.getState().messages });
    expect(result.current.exhausted).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
  });

  it('keeps walking when a page yields no visible message', async () => {
    useCompanionStore.setState({ messages: [msg('m9', 'T9')] });
    // First page: all rows were fleet-event system rows → nothing visible.
    invokeMock.mockResolvedValueOnce(
      page({ nextBeforeCreatedAt: 'T5', nextBeforeId: 'm5', exhausted: false }),
    );
    invokeMock.mockResolvedValueOnce(pageOf([msg('m1', 'T1')], true));

    const { result } = mount([msg('m9', 'T9')]);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1]![1]).toMatchObject({
      beforeCreatedAt: 'T5',
      beforeId: 'm5',
    });
    expect(useCompanionStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm9']);
  });

  it('does nothing without an anchor message', async () => {
    const { result } = mount([]);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('fetchAllOlderMessages', () => {
  it('walks to exhaustion and returns oldest-first', async () => {
    invokeMock.mockResolvedValueOnce(pageOf([msg('m3', 'T3'), msg('m4', 'T4')]));
    invokeMock.mockResolvedValueOnce(pageOf([msg('m1', 'T1'), msg('m2', 'T2')], true));

    const out = await fetchAllOlderMessages('default', {
      beforeCreatedAt: 'T5',
      beforeId: 'm5',
    });
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('stops when a page reports no further cursor', async () => {
    invokeMock.mockResolvedValueOnce(page({ exhausted: false }));
    const out = await fetchAllOlderMessages('default', {
      beforeCreatedAt: 'T5',
      beforeId: 'm5',
    });
    expect(out).toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe('prependMessages', () => {
  it('dedupes by id so an overlapping page never doubles a bubble', () => {
    useCompanionStore.setState({ messages: [msg('m2', 'T2'), msg('m3', 'T3')] });
    useCompanionStore.getState().prependMessages([msg('m1', 'T1'), msg('m2', 'T2')]);
    expect(useCompanionStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('is a no-op when everything is already known', () => {
    const before = [msg('m1', 'T1')];
    useCompanionStore.setState({ messages: before });
    useCompanionStore.getState().prependMessages([msg('m1', 'T1')]);
    expect(useCompanionStore.getState().messages).toBe(before);
  });
});
