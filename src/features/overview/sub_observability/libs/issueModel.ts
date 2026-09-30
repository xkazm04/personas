/**
 * Observability (composition kit): how a health issue and a healing event read on the spine.
 * One state per issue, one Tone x Glyph per state (doctrine 6b), the same on the list, the
 * detail pane and the timeline.
 */
import type { Glyph, KitState, Tone } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';

export type IssueState = 'breaker' | 'retrying' | 'fixed' | 'resolved' | 'critical' | 'high' | 'medium' | 'low';

export const ISSUE_GLYPH: Record<IssueState, { tone: Tone; glyph: Glyph }> = {
  breaker: { tone: 'error', glyph: 'solid' },
  critical: { tone: 'error', glyph: 'solid' },
  high: { tone: 'warning', glyph: 'solid' },
  medium: { tone: 'warning', glyph: 'soft' },
  low: { tone: 'neutral', glyph: 'soft' },
  retrying: { tone: 'primary', glyph: 'live' },
  fixed: { tone: 'success', glyph: 'hollow' },
  resolved: { tone: 'success', glyph: 'soft' },
};

export function issueState(i: Pick<PersonaHealingIssue, 'is_circuit_breaker' | 'status' | 'auto_fixed' | 'severity'>): IssueState {
  if (i.is_circuit_breaker) return 'breaker';
  if (i.status === 'auto_fix_pending') return 'retrying';
  if (i.status === 'resolved') return i.auto_fixed ? 'fixed' : 'resolved';
  if (i.severity === 'critical' || i.severity === 'high' || i.severity === 'low') return i.severity;
  return 'medium';
}

/** Row states: a working retry glows, a settled issue recedes. */
export function issueRowStates(s: IssueState, selected: boolean): KitState[] {
  const st: KitState[] = [];
  if (selected) st.push('selected');
  if (s === 'retrying') st.push('live');
  if (s === 'fixed' || s === 'resolved') st.push('muted');
  return st;
}

/** A resolve action exists only while the issue is still open to the operator. */
export function canResolve(s: IssueState): boolean {
  return s !== 'fixed' && s !== 'resolved' && s !== 'retrying';
}

/** A healing event's mark: outcome by its status, the rest by what the step is. */
export function eventMark(e: Pick<HealingTimelineEvent, 'eventType' | 'status'>): { tone: Tone; glyph: Glyph } {
  if (e.eventType === 'outcome') {
    if (e.status === 'resolved' || e.status === 'completed') return { tone: 'success', glyph: 'solid' };
    if (e.status === 'failed') return { tone: 'error', glyph: 'solid' };
    return { tone: 'warning', glyph: 'soft' };
  }
  if (e.eventType === 'retry') {
    if (e.status === 'running') return { tone: 'primary', glyph: 'live' };
    if (e.status === 'failed') return { tone: 'error', glyph: 'hollow' };
    return { tone: 'success', glyph: 'hollow' };
  }
  if (e.eventType === 'trigger') return { tone: 'warning', glyph: 'solid' };
  if (e.eventType === 'ai_heal') return { tone: 'agent', glyph: 'soft' };
  if (e.eventType === 'knowledge') return { tone: 'info', glyph: 'soft' };
  return { tone: 'neutral', glyph: 'soft' };
}

export interface ChainGroup {
  chainId: string;
  events: HealingTimelineEvent[];
  trigger: HealingTimelineEvent | undefined;
  outcome: HealingTimelineEvent | undefined;
}

const STEP_ORDER: Record<string, number> = { trigger: 0, classify: 1, retry: 2, ai_heal: 3, outcome: 4 };

/** Groups events into resilience chains (trigger, classify, retries, outcome), newest trigger first. */
export function groupChains(events: readonly HealingTimelineEvent[]): { chains: ChainGroup[]; knowledge: HealingTimelineEvent[] } {
  const knowledge = events.filter((e) => e.eventType === 'knowledge');
  const byChain = new Map<string, HealingTimelineEvent[]>();
  for (const e of events) {
    if (e.eventType === 'knowledge') continue;
    const g = byChain.get(e.chainId);
    if (g) g.push(e);
    else byChain.set(e.chainId, [e]);
  }
  const chains: ChainGroup[] = [];
  for (const [chainId, list] of byChain) {
    list.sort((a, b) => (STEP_ORDER[a.eventType] ?? 2) - (STEP_ORDER[b.eventType] ?? 2) || a.timestamp.localeCompare(b.timestamp));
    chains.push({ chainId, events: list, trigger: list.find((e) => e.eventType === 'trigger'), outcome: list.find((e) => e.eventType === 'outcome') });
  }
  chains.sort((a, b) => (b.trigger?.timestamp ?? '').localeCompare(a.trigger?.timestamp ?? ''));
  return { chains, knowledge };
}

/** A chain's own mark: its outcome, or a live retry while one is running, or its trigger. */
export function chainMark(g: ChainGroup): { tone: Tone; glyph: Glyph } {
  if (g.outcome) return eventMark(g.outcome);
  if (g.events.some((e) => e.eventType === 'retry' && e.status === 'running')) return { tone: 'primary', glyph: 'live' };
  return { tone: 'warning', glyph: 'soft' };
}
