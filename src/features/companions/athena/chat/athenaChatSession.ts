/**
 * The VIEW half of the chat session — everything that only makes sense while
 * the window is on screen: the scroll container, the transcript window, and
 * the hand-off between local windowing and backend paging.
 *
 * The listening half (send pipeline, stream, events, triggers) lives in
 * `athenaChatEngine` and is mounted by the always-on panel shell, so a turn
 * started from the orb still runs with the window shut. Keeping the two apart
 * is also what lets the body be staged behind the open animation: it holds
 * nothing that could miss an event while it waits.
 */

import { useEffect, useRef } from 'react';
import { useChatScroll } from '../useChatScroll';
import { useTranscriptPages } from '../useTranscriptPages';
import { useShowEarlierOnScroll } from './athenaChatEarlier';
import { useTranscriptWindow, type TranscriptWindow } from './athenaChatWindow';
import type { AthenaChatEngine } from './athenaChatEngine';

export interface AthenaChatView {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  atBottom: boolean;
  scrollToBottom: () => void;
  /** An older backend page is in flight. */
  loadingOlder: boolean;
  transcriptWindow: TranscriptWindow;
  showEarlier: () => void;
}

export function useAthenaChatView(
  engine: AthenaChatEngine,
  /**
   * The staged mount gate from `useChatMount` — the scroll container exists
   * only once this is true (a skeleton renders before it). Every effect below
   * that touches `scrollRef` must key on it: the body mounts with the gate
   * still shut, so a mount-time effect sees a null ref, silently no-ops, and —
   * with no dep changing when the container finally appears — never retries.
   * That was the "opens scrolled to the top" bug: the open-at-latest jump
   * fired ~2 frames into the ~300ms skeleton window and hit nothing.
   */
  ready: boolean,
): AthenaChatView {
  const { messages, streaming, initialized, activeConversationId } = engine;

  // Bottom-aware autoscroll: pin to the bottom on new content only while the
  // user is already there. Once they scroll up to read history, leave them be
  // and surface the jump-to-latest pill instead. Deliberately NOT keyed on
  // `streamingText` — the bubble no longer renders live tokens, so a per-frame
  // scroll effect would cost a render and buy nothing.
  const { scrollRef, atBottom, scrollToBottom, maybeAutoScroll } = useChatScroll(ready);
  useEffect(maybeAutoScroll, [messages, streaming, maybeAutoScroll]);

  // Open-at-latest: on the first render of a conversation (window opened, or
  // switched conversations), jump straight to the newest message AFTER layout
  // settles. `maybeAutoScroll` alone can fire while the restored transcript is
  // still laying out (scrollHeight not yet final), which parks the panel at the
  // FIRST message instead of the last — the "opens scrolled to the top" bug.
  // Gated on `ready` so it runs only after the container exists (see above),
  // and the "done" stamp is only written once it can actually scroll. Keyed
  // per conversation so a switch re-lands at the bottom; the double rAF waits
  // for the transcript to paint before measuring scrollHeight. 'auto' keeps
  // the jump instant — the user must never watch it animate down from the top.
  const initialScrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !initialized) return;
    if (initialScrolledFor.current === activeConversationId) return;
    initialScrolledFor.current = activeConversationId;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => scrollToBottom('auto'));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [ready, initialized, activeConversationId, scrollToBottom]);

  const transcriptWindow = useTranscriptWindow(messages, activeConversationId);
  // Both upward-history mechanisms bind scroll listeners on `scrollRef`, so
  // their `enabled` flags carry the same `ready` gate — flipping it re-runs
  // the attach effect against the now-real container.
  const { showEarlierAnchored } = useShowEarlierOnScroll({
    scrollRef,
    enabled: ready && !transcriptWindow.fullyExpanded,
    showEarlier: transcriptWindow.showEarlier,
  });
  // Backend paging only takes over once every loaded message is on screen —
  // otherwise scrolling up would fetch history the panel is already hiding.
  const { loadingOlder } = useTranscriptPages({
    scrollRef,
    conversationId: activeConversationId,
    messages,
    enabled: ready && initialized && transcriptWindow.fullyExpanded,
  });

  return {
    scrollRef,
    atBottom,
    scrollToBottom,
    loadingOlder,
    transcriptWindow,
    showEarlier: showEarlierAnchored,
  };
}
