import { useMemo } from 'react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { QuestionnaireCategoryProgress } from './types';

export interface QuestionnaireCategoryData {
  grouped: Record<string, TransformQuestionResponse[]>;
  categoryKeys: string[];
  categoryProgress: Record<string, QuestionnaireCategoryProgress>;
  categoryHasBlocked: Record<string, boolean>;
}

/**
 * Derive the category structures consumed by the three rails and the
 * background constellation from the flat question list. Memoized on
 * `questions`, `userAnswers`, and `blockedQuestionIds` so the hero-only
 * re-renders (on question navigation) don't thrash these reductions.
 */
export function useQuestionnaireCategoryData(
  questions: TransformQuestionResponse[],
  userAnswers: Record<string, string>,
  blockedQuestionIds?: Set<string>,
): QuestionnaireCategoryData {
  const grouped = useMemo(() => {
    const buckets: Record<string, TransformQuestionResponse[]> = {};
    for (const q of questions) {
      const key = q.category ?? '__other__';
      (buckets[key] ??= []).push(q);
    }
    return buckets;
  }, [questions]);

  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);

  const categoryProgress = useMemo(() => {
    const map: Record<string, QuestionnaireCategoryProgress> = {};
    for (const cat of categoryKeys) {
      const qs = grouped[cat]!;
      const answered = qs.filter((q) => !!userAnswers[q.id]).length;
      map[cat] = {
        answered,
        total: qs.length,
        pct: qs.length > 0 ? answered / qs.length : 0,
      };
    }
    return map;
  }, [categoryKeys, grouped, userAnswers]);

  const categoryHasBlocked = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const cat of categoryKeys) {
      map[cat] = grouped[cat]!.some((q) => blockedQuestionIds?.has(q.id));
    }
    return map;
  }, [categoryKeys, grouped, blockedQuestionIds]);

  return { grouped, categoryKeys, categoryProgress, categoryHasBlocked };
}
