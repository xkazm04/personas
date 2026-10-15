// The sheet's words. Every user-facing string comes from `t.decisionCenter.blueprint`; the canvas engine takes its
// own subset as `EngineWords` (it never reads a translation itself), and the panels take the rest through `B`.
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Health, Stage } from '../standard/types';
import type { EngineWords } from '../engine/types';

type Tx = ReturnType<typeof useTranslation>['tx'];
export type BpText = ReturnType<typeof useTranslation>['t']['decisionCenter']['blueprint'];

export interface BlueprintText { B: BpText; tx: Tx; language: string }

export function useBlueprintText(): BlueprintText {
  const { t, tx, language } = useTranslation();
  return { B: t.decisionCenter.blueprint, tx, language };
}

const STAGE_KEY = {
  live: 'stage_live', flagged: 'stage_flagged', 'in-review': 'stage_in_review', 'in-dev': 'stage_in_dev',
  specified: 'stage_specified', idea: 'stage_idea', deprecated: 'stage_deprecated',
} as const satisfies Record<Stage, keyof BpText>;

const VERDICT_KEY = {
  good: 'verdict_good', watch: 'verdict_watch', bad: 'verdict_bad', na: 'verdict_na', unmeasured: 'verdict_unmeasured',
} as const satisfies Record<Health, keyof BpText>;

export const stageWord = (B: BpText, s: Stage): string => B[STAGE_KEY[s]];
export const verdictWord = (B: BpText, h: Health): string => B[VERDICT_KEY[h]];

export function useEngineWords({ B, tx }: BlueprintText): EngineWords {
  return useMemo<EngineWords>(() => ({
    stage: (s) => stageWord(B, s),
    notDrawn: B.not_drawn,
    verdict: (h) => verdictWord(B, h),
    features: (n) => tx(B.count_features, { count: n }),
    live: (n) => tx(B.count_live, { count: n }),
    building: (n) => tx(B.count_building, { count: n }),
    partlyOpen: (n) => tx(B.count_partly_open, { count: n }),
    onPaper: (n) => tx(B.count_on_paper, { count: n }),
    demolish: (n) => tx(B.count_demolish, { count: n }),
    good: (n) => tx(B.count_good, { count: n }),
    watch: (n) => tx(B.count_watch, { count: n }),
    bad: (n) => tx(B.count_bad, { count: n }),
    unmeasured: (n) => tx(B.count_unmeasured, { count: n }),
    inTrouble: (n) => tx(B.count_in_trouble, { count: n }),
    waiting: (n) => tx(B.count_waiting, { count: n }),
    oldestWork: B.chrono_oldest,
    newestWork: B.chrono_newest,
    chronology: B.chrono_rule,
    canvasLabel: B.canvas_label,
  }), [B, tx]);
}
