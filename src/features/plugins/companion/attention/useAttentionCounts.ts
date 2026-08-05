import { useMemo } from 'react';
import { useCompanionStore } from '../companionStore';
import { useMcpRequestStore } from '../mcp/mcpRequestStore';
import {
  EMPTY_ATTENTION_COUNTS,
  isCountableNudge,
  nudgeSeverity,
  type AttentionCounts,
} from './attentionKinds';

/**
 * How many items each attention kind currently holds.
 *
 * Reads the same stores the level-2 surfaces read, so a chip's count and
 * the cards it reveals can never disagree. The surfaces themselves stay
 * self-gating (each returns null when empty) — this hook only decides
 * what the bar advertises.
 */
export function useAttentionCounts(): AttentionCounts {
  const mcpRequests = useMcpRequestStore((s) => s.pendingRequests);
  const pendingDecision = useCompanionStore((s) => s.pendingDecision);
  const proactive = useCompanionStore((s) => s.proactive);
  const assignments = useCompanionStore((s) => s.athenaAssignments);
  const actions = useCompanionStore((s) => s.athenaActions);

  return useMemo(() => {
    const counts: AttentionCounts = { ...EMPTY_ATTENTION_COUNTS };
    counts.blocked = mcpRequests.length + (pendingDecision ? 1 : 0);
    for (const m of proactive) {
      if (!isCountableNudge(m.triggerKind)) continue;
      counts[nudgeSeverity(m.triggerKind)] += 1;
    }
    counts.assignments = assignments.length;
    counts.activity = actions.length;
    return counts;
  }, [mcpRequests, pendingDecision, proactive, assignments, actions]);
}
