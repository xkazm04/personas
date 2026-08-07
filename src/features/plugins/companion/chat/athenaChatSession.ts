/**
 * One hook that wires the whole live chat session together.
 *
 * `AthenaChatBody` used to be both the layout AND the place every subscription,
 * listener and pipeline was assembled — which is how it ended up subscribing to
 * `streamingText` and re-rendering every mounted bubble on every animation
 * frame of a reply. Splitting the wiring out keeps that pressure in one
 * reviewable place and leaves the body as markup.
 *
 * What lives here is only what the body genuinely shares: the scroll container,
 * the transcript window, and the send pipeline. Everything else (alerts, jobs,
 * the streaming bubble, the error chip) reads its own narrow slice.
 */

import { useEffect, useRef } from 'react';
import type { CompanionMessage } from '@/api/companion';
import { useCompanionStore } from '../companionStore';
import { useChatScroll } from '../useChatScroll';
import { useTranscriptPages } from '../useTranscriptPages';
import { useShowEarlierOnScroll } from './athenaChatEarlier';
import { useAthenaChatEvents } from './athenaChatEvents';
import { useAthenaChatHydration } from './athenaChatHydration';
import { useAthenaChatNavigation } from './athenaChatNavigation';
import { useAthenaChatQueue } from './athenaChatQueue';
import { useAthenaChatSend } from './athenaChatSend';
import { useAthenaChatStream } from './athenaChatStream';
import { useAthenaChatTriggers } from './athenaChatTriggers';
import { useAthenaChatVoice } from './athenaChatVoice';
import { useTranscriptWindow, type TranscriptWindow } from './athenaChatWindow';

export interface AthenaChatSession {
  initialized: boolean;
  initError: string | null;
  messages: CompanionMessage[];
  streaming: boolean;
  brainOpen: boolean;
  /** Milliseconds since epoch of the last focused-thread stream event. */
  lastStreamEventAtRef: React.MutableRefObject<number>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  atBottom: boolean;
  scrollToBottom: () => void;
  /** An older backend page is in flight. */
  loadingOlder: boolean;
  transcriptWindow: TranscriptWindow;
  showEarlier: () => void;
  send: (text: string) => void;
  sendOrQueue: (text: string, nonce: string) => void;
  interrupt: () => void;
}

export function useAthenaChatSession(): AthenaChatSession {
  const initialized = useCompanionStore((s) => s.initialized);
  const initError = useCompanionStore((s) => s.initError);
  const messages = useCompanionStore((s) => s.messages);
  const streaming = useCompanionStore((s) => s.streaming);
  const brainOpen = useCompanionStore((s) => s.brainView.open);
  const activeConversationId = useCompanionStore((s) => s.activeConversationId);

  // Silence clock for the slow-progress chip and the spoken heartbeat. A ref,
  // not state: it ticks on every CLI line and must cost nothing to update.
  const lastStreamEventAtRef = useRef<number>(0);

  const voice = useAthenaChatVoice({ streaming, lastStreamEventAtRef });
  const { send, isSending, interrupt } = useAthenaChatSend({ voice, lastStreamEventAtRef });
  const sendOrQueue = useAthenaChatQueue({
    streaming,
    activeConversationId,
    send,
    isSending,
    interrupt,
  });

  useAthenaChatStream({ lastStreamEventAtRef, onTurnStarted: voice.resetTurnProgress });
  useAthenaChatEvents();
  useAthenaChatNavigation();
  useAthenaChatHydration({ initialized, activeConversationId, messages });
  useAthenaChatTriggers({ streaming, send, playProgressClip: voice.playProgressClip });

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
    initialized,
    initError,
    messages,
    streaming,
    brainOpen,
    lastStreamEventAtRef,
    scrollRef,
    atBottom,
    scrollToBottom,
    loadingOlder,
    transcriptWindow,
    showEarlier: showEarlierAnchored,
    send,
    sendOrQueue,
    interrupt,
  };
}
