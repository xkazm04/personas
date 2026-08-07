/**
 * One-shot reactions — the brief things the orb does when something lands.
 *
 * Three independent triggers converge on two visuals:
 *  - a finished turn, or an external `messageReactionPulse` (the Studio build
 *    chat, whose turns never touch `streaming`), bumps `messageNonce` so
 *    `AthenaAvatar` plays its one-shot `message` clip and the border glows for
 *    that single loop;
 *  - a `forwardAckPulse` (a message forwarded to Athena from outside, e.g. a
 *    dashboard "Ask Athena") flashes an amber "received" bloom, so the user
 *    gets confirmation while the often-slow turn spins up.
 */

import { useEffect, useRef, useState } from 'react';
import { useCompanionStore } from '../companionStore';

/** How long the forward-ack bloom stays up. */
const FORWARD_ACK_MS = 2600;

export interface OrbReactions {
  /** Bumped per reaction — handed to `AthenaAvatar` to replay its clip. */
  messageNonce: number;
  /** True only while that clip is playing (the avatar reports it back). */
  messageActive: boolean;
  setMessageActive: (active: boolean) => void;
  forwardAck: boolean;
}

export function useAthenaOrbReactions(streaming: boolean): OrbReactions {
  const [messageNonce, setMessageNonce] = useState(0);
  const [messageActive, setMessageActive] = useState(false);

  // A reply finished (streaming true → false).
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming) setMessageNonce((n) => n + 1);
  }, [streaming]);

  // An outside surface asked for the reaction directly.
  const messageReactionPulse = useCompanionStore((s) => s.messageReactionPulse);
  const prevReactionPulseRef = useRef(messageReactionPulse);
  useEffect(() => {
    if (messageReactionPulse === prevReactionPulseRef.current) return;
    prevReactionPulseRef.current = messageReactionPulse;
    setMessageNonce((n) => n + 1);
  }, [messageReactionPulse]);

  const forwardAckPulse = useCompanionStore((s) => s.forwardAckPulse);
  const [forwardAck, setForwardAck] = useState(false);
  const prevForwardAckRef = useRef(forwardAckPulse);
  useEffect(() => {
    if (forwardAckPulse === prevForwardAckRef.current) return;
    prevForwardAckRef.current = forwardAckPulse;
    setForwardAck(true);
    const id = setTimeout(() => setForwardAck(false), FORWARD_ACK_MS);
    return () => clearTimeout(id);
  }, [forwardAckPulse]);

  return { messageNonce, messageActive, setMessageActive, forwardAck };
}
