import { BookOpen, Brain, Mic, Radio, User, Volume2 } from 'lucide-react';
import type { TwinTab } from '@/lib/types/types';
import type { LucideIcon } from 'lucide-react';
import type { TwinReadiness } from '../useTwinReadiness';

/**
 * Readiness-gap ranking, shared by ReadinessGapPopover (the score-badge
 * triage list) and the Profiles hero "next step" nudge.
 *
 * A gap is derived purely from the existing TwinReadiness shape — no new
 * data fetches. Empty milestones (severity 1) rank above partial milestones
 * (severity 0); ties broken by a stable priority that favours foundations
 * (identity → tone → brain → voice → channels → memories).
 */

export type GapTitleKey =
  | 'identityEmpty' | 'identityPartial'
  | 'toneEmpty' | 'tonePartial'
  | 'brainEmpty' | 'brainPartial'
  | 'voiceEmpty'
  | 'channelsEmpty' | 'channelsPartial'
  | 'memoriesEmpty' | 'memoriesPartial';

export type GapHintKey = GapTitleKey;

export interface Gap {
  id: keyof Omit<TwinReadiness, 'score' | 'counts'>;
  /** 1 = empty (worse), 0 = partial. */
  severity: 1 | 0;
  priority: number;
  tab: TwinTab;
  icon: LucideIcon;
  titleKey: GapTitleKey;
  hintKey: GapHintKey;
  hintVars?: Record<string, string | number>;
}

export const MEMORY_STRONG_THRESHOLD = 5;

export function buildGaps(r: TwinReadiness): Gap[] {
  const out: Gap[] = [];

  if (r.identity !== 'complete') {
    out.push({
      id: 'identity',
      severity: r.identity === 'empty' ? 1 : 0,
      priority: 1,
      tab: 'identity',
      icon: User,
      titleKey: r.identity === 'empty' ? 'identityEmpty' : 'identityPartial',
      hintKey: r.identity === 'empty' ? 'identityEmpty' : 'identityPartial',
    });
  }
  if (r.tone !== 'complete') {
    out.push({
      id: 'tone',
      severity: r.tone === 'empty' ? 1 : 0,
      priority: 2,
      tab: 'tone',
      icon: Mic,
      titleKey: r.tone === 'empty' ? 'toneEmpty' : 'tonePartial',
      hintKey: r.tone === 'empty' ? 'toneEmpty' : 'tonePartial',
    });
  }
  if (r.brain !== 'complete') {
    out.push({
      id: 'brain',
      severity: r.brain === 'empty' ? 1 : 0,
      priority: 3,
      tab: 'brain',
      icon: Brain,
      titleKey: r.brain === 'empty' ? 'brainEmpty' : 'brainPartial',
      hintKey: r.brain === 'empty' ? 'brainEmpty' : 'brainPartial',
    });
  }
  if (r.voice !== 'complete') {
    out.push({
      id: 'voice',
      severity: 1,
      priority: 4,
      tab: 'voice',
      icon: Volume2,
      titleKey: 'voiceEmpty',
      hintKey: 'voiceEmpty',
    });
  }
  if (r.channels !== 'complete') {
    out.push({
      id: 'channels',
      severity: r.channels === 'empty' ? 1 : 0,
      priority: 5,
      tab: 'channels',
      icon: Radio,
      titleKey: r.channels === 'empty' ? 'channelsEmpty' : 'channelsPartial',
      hintKey: r.channels === 'empty' ? 'channelsEmpty' : 'channelsPartial',
    });
  }
  if (r.memories !== 'complete') {
    const remaining = Math.max(0, MEMORY_STRONG_THRESHOLD - r.counts.memoriesApproved);
    out.push({
      id: 'memories',
      severity: r.memories === 'empty' ? 1 : 0,
      priority: 6,
      tab: 'knowledge',
      icon: BookOpen,
      titleKey: r.memories === 'empty' ? 'memoriesEmpty' : 'memoriesPartial',
      hintKey: r.memories === 'empty' ? 'memoriesEmpty' : 'memoriesPartial',
      hintVars: { remaining, threshold: MEMORY_STRONG_THRESHOLD, approved: r.counts.memoriesApproved },
    });
  }

  // Empty (severity 1) before partial (severity 0); tie-break by foundation priority.
  return out.sort((a, b) => (b.severity - a.severity) || (a.priority - b.priority));
}

/**
 * Readiness points a single gap would add if closed. Each of the six
 * milestones is worth 100/6 of the score; an empty milestone recovers the
 * full slice, a partial one recovers half. Rounded for display (+17% / +8%).
 */
export function gapScoreDelta(gap: Gap): number {
  return Math.round(((gap.severity === 1 ? 1 : 0.5) / 6) * 100);
}
