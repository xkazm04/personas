/**
 * Turns started from somewhere other than the composer.
 *
 * Hold-to-talk in the app footer and app-initiated prompts (the Add-KPI
 * modal's "Ask Athena", for one) park a request in the store; this consumes it
 * through the normal `send()` pipeline so those turns get streaming, transcript
 * persistence and TTS exactly like a typed message.
 *
 * Each consumer claims its request ATOMICALLY against the live store rather
 * than from the render closure: StrictMode's dev double-invoke reuses the same
 * closure and `send()` flips `streaming` asynchronously, so reading the closure
 * value would fire the turn twice. Reading fresh and clearing makes the second
 * invoke see null and bail.
 */

import { useEffect, useRef } from 'react';
import { useCompanionStore } from '../companionStore';
import { stripMarkdownForSpeech } from './athenaChatSpeech';

export function useAthenaChatTriggers(args: {
  streaming: boolean;
  send: (text: string, nonce?: string, opts?: { systemSource?: string }) => void;
  playProgressClip: (text: string) => void;
}): void {
  const { streaming, send, playProgressClip } = args;

  const voiceTurnRequest = useCompanionStore((s) => s.voiceTurnRequest);
  useEffect(() => {
    if (!voiceTurnRequest || streaming) return;
    const req = useCompanionStore.getState().voiceTurnRequest;
    if (!req) return;
    useCompanionStore.getState().setVoiceTurnRequest(null);
    send(req);
  }, [voiceTurnRequest, streaming, send]);

  const pendingChatPrompt = useCompanionStore((s) => s.pendingChatPrompt);
  useEffect(() => {
    if (!pendingChatPrompt || streaming) return;
    const req = useCompanionStore.getState().pendingChatPrompt;
    if (!req) return;
    useCompanionStore.getState().setPendingChatPrompt(null);
    // App-initiated prompts OPEN the panel — they begin a guided conversation.
    useCompanionStore.getState().setState('open');
    // Object form carries provenance: the surface composed the text, the user
    // only clicked. The send path forwards it as a tagged System turn.
    if (typeof req === 'string') send(req);
    else send(req.text, undefined, { systemSource: req.systemSource });
  }, [pendingChatPrompt, streaming, send]);

  // Slice 6 — speak the hands-free decision aloud ONLY on Explain/Recommend.
  // The decision text is NOT auto-read when the bubble surfaces (it is on
  // screen to read); Athena speaks only when the user picks `0`, reading the
  // `recommendation`. Keyed on the decision id so it speaks exactly once.
  const decisionId = useCompanionStore((s) => s.pendingDecision?.id ?? null);
  const decisionExplained = useCompanionStore((s) => s.decisionExplained);
  const spokenForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!decisionId) {
      spokenForRef.current = null;
      return;
    }
    if (!decisionExplained || spokenForRef.current === decisionId) return;
    spokenForRef.current = decisionId;
    const rec = useCompanionStore.getState().pendingDecision?.recommendation;
    // Markdown is stripped first so she never reads `**` / `-` aloud.
    if (rec) playProgressClip(stripMarkdownForSpeech(rec));
  }, [decisionId, decisionExplained, playProgressClip]);
}
