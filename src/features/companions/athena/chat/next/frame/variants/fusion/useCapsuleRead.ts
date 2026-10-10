/**
 * Fusion · what the resting capsule says, in priority order: what she is
 * doing this second (the phase of a running turn, as a label), else how much
 * of the fleet is moving, else the conversation's own name. Plus the gate
 * count and her latest words as plain text for the tooltip.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useMemo } from 'react';
import type { CompanionMessage } from '@/api/companion';
import { stripModelDirectives } from '../../../../../athenaLabels';
import { useAthenaStore } from '../../../../../athenaStore';
import { NEXT_COPY as C } from '../../../nextCopy';
import type { CapsuleRead } from './IslandCapsule';
import { FUSION_COPY as F } from './copy';
import { plainWords } from './text';

export function latestReply(messages: CompanionMessage[]): CompanionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) return m;
  }
  return null;
}

export function useCapsuleRead(messages: CompanionMessage[], live: number, waiting: number): CapsuleRead {
  const streaming = useAthenaStore((s) => s.streaming);
  const phase = useAthenaStore((s) => s.streamingPhase);
  const conversations = useAthenaStore((s) => s.conversations);
  const activeId = useAthenaStore((s) => s.activeConversationId);
  const last = useMemo(() => latestReply(messages), [messages]);

  return useMemo(() => {
    // Bound, so a thread whose row is gone reads as no title (the capsule falls
    // back to its own state) rather than as some other thread's name.
    const conversation = activeId ? (conversations.find((c) => c.id === activeId) ?? null) : null;
    const title = conversation ? conversation.title : null;
    let label: string;
    if (streaming) {
      label =
        phase?.kind === 'tool_use' && phase.toolName
          ? F.using(phase.toolName)
          : phase?.kind === 'reviewing'
            ? F.reviewing
            : phase?.kind === 'thinking'
              ? F.thinking
              : C.working;
    } else if (live > 0) label = F.workingOn(live);
    // The gate shows beside the label, so the label never claims quiet over it.
    else label = title ?? (waiting > 0 ? F.waitingOnYou : F.quiet);
    const words = last ? plainWords(stripModelDirectives(last.content)).replace(/\s+/g, ' ').trim() : '';
    return { label, working: streaming, gated: waiting, lastWords: words || null };
  }, [streaming, phase, live, conversations, activeId, last, waiting]);
}
