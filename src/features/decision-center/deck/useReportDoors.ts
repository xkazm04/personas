/**
 * The report card's two doors that are not a verdict, reused from the
 * Overview's report modal rather than forked:
 *
 *  - rating 1-5 — `useReportRating` (saved as a persona memory, hydrated from
 *    the one it wrote before, a re-rate updates it in place);
 *  - the same run's pending reviews — `useLinkedReviews`, carried into the
 *    "follow up in chat" seed exactly as the modal carries them.
 *
 * Both hooks take the report row. The deck holds a `DecisionItem`, so the row
 * is rebuilt from the item (`reportOf`) — every field the doors read is one
 * the report adapter (`reportToDecision`) wrote onto it. A card that is not a
 * report hands the hooks a row with no persona and no run, and both of them
 * read nothing for it.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useLinkedReviews, useReportRating } from '@/features/overview/sub_reports/libs/useReportDetail';
import type { PersonaReport } from '@/lib/types/types';
import type { DecisionItem } from '../model/decisionModel';

const NO_REPORT: PersonaReport = {
  id: '',
  persona_id: '',
  execution_id: null,
  title: null,
  content: '',
  content_type: 'markdown',
  priority: 'normal',
  is_read: false,
  metadata: null,
  created_at: '',
  read_at: null,
  thread_id: null,
  use_case_id: null,
};

/** The report row behind a report item (see `reportToDecision` for where each field went). */
export function reportOf(item: DecisionItem): PersonaReport {
  const p = item.payload ?? {};
  return {
    ...NO_REPORT,
    id: item.sourceId,
    persona_id: p.personaId ?? item.personaId ?? '',
    persona_name: item.source.label,
    execution_id: p.executionId ?? null,
    title: item.title,
    content: item.document?.content ?? item.body,
    content_type: item.document?.format ?? 'markdown',
    created_at: item.createdAt,
    thread_id: p.threadId ?? null,
    use_case_id: p.useCaseId ?? null,
  };
}

export function useReportDoors(item: DecisionItem | undefined) {
  const { t, tx } = useTranslation();
  const report = useMemo(() => (item?.kind === 'report' ? reportOf(item) : NO_REPORT), [item]);
  const { rating, rate } = useReportRating(report, t, tx);
  const { linkedReviews } = useLinkedReviews(report);
  return { rating: rating > 0 ? rating : null, rate, linkedReviews };
}
