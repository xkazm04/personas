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

import { useEffect } from 'react';
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

export function useAthenaChatView(engine: AthenaChatEngine): AthenaChatView {
  const { messages, streaming, initialized, activeConversationId } = engine;

  // Bottom-aware autoscroll: pin to the bottom on new content only while the
  // user is already there. Once they scroll up to read history, leave them be
  // and surface the jump-to-latest pill instead. Deliberately NOT keyed on
  // `streamingText` — the bubble no longer renders live tokens, so a per-frame
  // scroll effect would cost a render and buy nothing.
  const { scrollRef, atBottom, scrollToBottom, maybeAutoScroll } = useChatScroll();
  useEffect(maybeAutoScroll, [messages, streaming, maybeAutoScroll]);

  const transcriptWindow = useTranscriptWindow(messages, activeConversationId);
  const { showEarlierAnchored } = useShowEarlierOnScroll({
    scrollRef,
    enabled: !transcriptWindow.fullyExpanded,
    showEarlier: transcriptWindow.showEarlier,
  });
  // Backend paging only takes over once every loaded message is on screen —
  // otherwise scrolling up would fetch history the panel is already hiding.
  const { loadingOlder } = useTranscriptPages({
    scrollRef,
    conversationId: activeConversationId,
    messages,
    enabled: initialized && transcriptWindow.fullyExpanded,
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
