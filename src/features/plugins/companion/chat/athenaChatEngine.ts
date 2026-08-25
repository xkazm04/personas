/**
 * The conversation engine — everything that has to be listening whether or not
 * the chat window is on screen.
 *
 * This lives in the ALWAYS-MOUNTED panel shell, not in the open-only body, and
 * that placement is the whole point. Athena can be talked to from three
 * surfaces that exist precisely because the window is shut — hold-to-talk on
 * the footer avatar, the orb's quick-input bar, and "Ask Athena" forwarded from
 * a dashboard — and every one of them parks its message in `voiceTurnRequest`
 * for this hook to pick up. With the consumer inside the body, a closed panel
 * meant the request sat there forever and no turn ever ran. The same was true
 * of the whole side channel: `companion://stream`, navigation, guide steps,
 * chat cards, approvals and proactive deliveries were all body-scoped, so
 * anything Athena did while minimized landed nowhere. (`athenaChatShell.ts`
 * already existed for two effects that had been hoisted one at a time after QA
 * hit exactly this — 2026-06-10, the orb's `explain_in_cockpit` flow. This is
 * that fix applied to the rest of it.)
 *
 * Hoisting also makes the open cheap: the body is left holding nothing but
 * render, so it can be staged behind the open animation without dropping
 * events on the floor.
 */

import { useRef } from 'react';
import type { CompanionMessage } from '@/api/companion';
import { useCompanionStore } from '../companionStore';
import { useAthenaChatEvents } from './athenaChatEvents';
import { useAthenaChatHydration } from './athenaChatHydration';
import { useAthenaChatNavigation } from './athenaChatNavigation';
import { useAthenaChatQueue } from './athenaChatQueue';
import { useAthenaChatSend } from './athenaChatSend';
import { useAthenaChatStream } from './athenaChatStream';
import { useAthenaChatTriggers } from './athenaChatTriggers';
import { useAthenaChatVoice } from './athenaChatVoice';

export interface AthenaChatEngine {
  messages: CompanionMessage[];
  initialized: boolean;
  initError: string | null;
  streaming: boolean;
  activeConversationId: string;
  /** Milliseconds since epoch of the last focused-thread stream event. */
  lastStreamEventAtRef: React.MutableRefObject<number>;
  send: (text: string, nonce?: string, source?: string) => void;
  sendOrQueue: (text: string, nonce: string) => void;
  interrupt: () => void;
}

export function useAthenaChatEngine(): AthenaChatEngine {
  const initialized = useCompanionStore((s) => s.initialized);
  const initError = useCompanionStore((s) => s.initError);
  const messages = useCompanionStore((s) => s.messages);
  const streaming = useCompanionStore((s) => s.streaming);
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

  return {
    messages,
    initialized,
    initError,
    streaming,
    activeConversationId,
    lastStreamEventAtRef,
    send,
    sendOrQueue,
    interrupt,
  };
}
