import { useMemo } from 'react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { CATEGORY_META, FALLBACK_CATEGORY } from '../QuestionnaireFormGridConfig';

/** One authored category as the rail presents it. */
export interface QuestionnaireCategoryBucket {
  key: string;
  label: string;
  /** Index the rail jumps to: the first unanswered question, else the first. */
  jumpIdx: number;
  answered: number;
  total: number;
}

export const OTHER_CATEGORY_KEY = '__other__';

/**
 * Buckets questions by their authored category, preserving the order the
 * questions already arrive in (ChronologyAdoptionView sorts them through
 * `questionnaireCategoryOrder`, so the rail inherits the canonical order for
 * free rather than re-listing the vocabulary).
 */
export function buildCategoryBuckets(
  questions: TransformQuestionResponse[],
  userAnswers: Record<string, string>,
): QuestionnaireCategoryBucket[] {
  const byKey = new Map<string, QuestionnaireCategoryBucket>();
  // Keys whose jump target is still the bucket's first question, i.e. no
  // unanswered question has claimed it yet. Tracked separately so index 0 is
  // distinguishable from "never set".
  const awaitingJumpTarget = new Set<string>();
  questions.forEach((q, i) => {
    const key = q.category ?? OTHER_CATEGORY_KEY;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: (CATEGORY_META[key] ?? FALLBACK_CATEGORY).label,
        jumpIdx: i,
        answered: 0,
        total: 0,
      };
      byKey.set(key, bucket);
      awaitingJumpTarget.add(key);
    }
    bucket.total += 1;
    if (userAnswers[q.id]) {
      bucket.answered += 1;
    } else if (awaitingJumpTarget.has(key)) {
      // First UNANSWERED question wins the jump target; a fully answered
      // bucket keeps its first question so the chip is never a dead control.
      bucket.jumpIdx = i;
      awaitingJumpTarget.delete(key);
    }
  });
  return [...byKey.values()];
}

/**
 * Compact category rail above the story thread.
 *
 * The thread already draws a chapter divider at every category transition, but
 * a divider is not a control: on a twelve-question interview an adopter on
 * question 2 had no way to reach Notifications without stepping through
 * everything between. Each chip here jumps to the first unanswered question of
 * its category and carries that category's progress, so a long interview is
 * scannable by the dimensions it is already authored in.
 */
export function QuestionnaireCategoryRail({
  buckets,
  activeCategory,
  onJumpTo,
}: {
  buckets: QuestionnaireCategoryBucket[];
  /** Category of the question the hero is currently on. */
  activeCategory: string | null;
  onJumpTo: (idx: number) => void;
}) {
  if (buckets.length < 2) return null;
  return (
    <div className="flex-shrink-0 flex flex-wrap gap-1 px-2 py-2 border-b border-border">
      {buckets.map((bucket) => {
        const meta = CATEGORY_META[bucket.key] ?? FALLBACK_CATEGORY;
        const isActive = (activeCategory ?? OTHER_CATEGORY_KEY) === bucket.key;
        const complete = bucket.answered === bucket.total;
        return (
          <button
            key={bucket.key}
            type="button"
            onClick={() => onJumpTo(bucket.jumpIdx)}
            aria-current={isActive ? 'step' : undefined}
            data-testid={`questionnaire-category-${bucket.key}`}
            className={`focus-ring inline-flex items-center gap-1.5 px-2 py-1 rounded-card border transition-colors ${
              isActive ? `${meta.bg} border-primary/30` : 'border-transparent hover:bg-foreground/[0.04]'
            }`}
          >
            <meta.Icon className={`w-3.5 h-3.5 ${meta.color}`} />
            <span className="typo-caption text-foreground">{bucket.label}</span>
            <span
              className={`typo-data tabular-nums ${complete ? 'text-status-success' : 'text-foreground'}`}
            >
              {bucket.answered}/{bucket.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function useCategoryBuckets(
  questions: TransformQuestionResponse[],
  userAnswers: Record<string, string>,
): QuestionnaireCategoryBucket[] {
  return useMemo(() => buildCategoryBuckets(questions, userAnswers), [questions, userAnswers]);
}
