import type { Translations } from '@/i18n/generated/types';
import type { StudioActivity } from '../studioActivity';
import { typicalTurnSeconds } from '../studioActivity';

export type GuideT = Translations['studio']['guide'];

/** One activity in plain words: "Building: Site nav", "Checking the code for mistakes". */
export function activityText(g: GuideT, a: StudioActivity): string {
  const verb = {
    research: g.act_research,
    search: g.act_search,
    read: g.act_read,
    build: g.act_build,
    check: g.act_check,
    browser: g.act_browser,
    command: g.act_command,
    other: g.act_other,
  }[a.kind];
  return a.subject && (a.kind === 'build' || a.kind === 'search' || a.kind === 'research') ? `${verb}: ${a.subject}` : verb;
}

/** "About 8 min a step" from this project's measured turns, else the honest range. */
export function estimateText(g: GuideT, tx: (s: string, v: Record<string, string | number>) => string, durations: number[]): string {
  const typical = typicalTurnSeconds(durations);
  if (typical === null) return g.estimate_unknown;
  return tx(g.estimate_about, { minutes: Math.max(1, Math.round(typical / 60)) });
}

// The English `studio` section can be resident WITHOUT its `guide` group: a
// window that loaded the section before the group existed keeps that object
// across a hot update, and `t.studio.guide.x` then threw and took Studio down.
// The generated section shape only covers a section that has not loaded at
// all. An empty group renders blank until the next load instead of crashing.
export function guideStrings(t: Translations): GuideT {
  return t.studio.guide ?? ({} as GuideT);
}
