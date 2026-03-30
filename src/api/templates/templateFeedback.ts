import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { FeedbackLabel } from '@/lib/bindings/FeedbackLabel';
import type { FeedbackRating } from '@/lib/bindings/FeedbackRating';
import type { TemplateFeedback } from '@/lib/bindings/TemplateFeedback';
import type { TemplatePerformance } from '@/lib/bindings/TemplatePerformance';

export type { FeedbackLabel, FeedbackRating };

export const FEEDBACK_LABELS: Record<FeedbackLabel, { label: string; positive: boolean }> = {
  accurate_prompt: { label: 'Accurate Prompt', positive: true },
  good_tool_selection: { label: 'Good Tool Selection', positive: true },
  reliable: { label: 'Reliable', positive: true },
  cost_efficient: { label: 'Cost Efficient', positive: true },
  wrong_tools: { label: 'Wrong Tools', positive: false },
  poor_instructions: { label: 'Poor Instructions', positive: false },
  missing_context: { label: 'Missing Context', positive: false },
  over_engineered: { label: 'Over-Engineered', positive: false },
  under_specified: { label: 'Under-Specified', positive: false },
  wrong_triggers: { label: 'Wrong Triggers', positive: false },
  credential_issues: { label: 'Credential Issues', positive: false },
};

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
