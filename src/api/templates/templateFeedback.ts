import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { FeedbackLabel } from '@/lib/bindings/FeedbackLabel';
import type { FeedbackRating } from '@/lib/bindings/FeedbackRating';
import type { TemplateFeedback } from '@/lib/bindings/TemplateFeedback';
import type { TemplatePerformance } from '@/lib/bindings/TemplatePerformance';
import { en, type Translations } from '@/i18n/en';

export type { FeedbackLabel, FeedbackRating };

/** i18n keys for each feedback label. */
const FEEDBACK_LABEL_KEYS: Record<FeedbackLabel, { key: keyof Translations['feedback_labels']; positive: boolean }> = {
  accurate_prompt:     { key: 'accurate_prompt',     positive: true },
  good_tool_selection: { key: 'good_tool_selection', positive: true },
  reliable:            { key: 'reliable',            positive: true },
  cost_efficient:      { key: 'cost_efficient',      positive: true },
  wrong_tools:         { key: 'wrong_tools',         positive: false },
  poor_instructions:   { key: 'poor_instructions',   positive: false },
  missing_context:     { key: 'missing_context',     positive: false },
  over_engineered:     { key: 'over_engineered',     positive: false },
  under_specified:     { key: 'under_specified',     positive: false },
  wrong_triggers:      { key: 'wrong_triggers',      positive: false },
  credential_issues:   { key: 'credential_issues',   positive: false },
};

/** Resolve FEEDBACK_LABELS from the given translation bundle (defaults to English). */
export function getFeedbackLabels(t: Translations = en): Record<FeedbackLabel, { label: string; positive: boolean }> {
  const result = {} as Record<FeedbackLabel, { label: string; positive: boolean }>;
  for (const [feedbackLabel, meta] of Object.entries(FEEDBACK_LABEL_KEYS) as [FeedbackLabel, typeof FEEDBACK_LABEL_KEYS[FeedbackLabel]][]) {
    result[feedbackLabel] = {
      label: t.feedback_labels[meta.key] as string,
      positive: meta.positive,
    };
  }
  return result;
}

/** Pre-resolved English FEEDBACK_LABELS for backward-compatible direct access. */
export const FEEDBACK_LABELS: Record<FeedbackLabel, { label: string; positive: boolean }> = getFeedbackLabels(en);

export const createTemplateFeedback = (
  reviewId: string,
  personaId: string,
  rating: FeedbackRating,
  labels: FeedbackLabel[],
  comment?: string,
  executionId?: string,
  source?: string,
) =>
  invoke<TemplateFeedback>('create_template_feedback', {
    reviewId,
    personaId,
    executionId: executionId,
    rating,
    labels,
    comment: comment,
    source: source,
  });

export const listTemplateFeedback = (reviewId: string, limit?: number) =>
  invoke<TemplateFeedback[]>('list_template_feedback', {
    reviewId,
    limit: limit,
  });

export const getTemplatePerformance = (reviewId: string) =>
  invoke<TemplatePerformance>('get_template_performance', { reviewId });
