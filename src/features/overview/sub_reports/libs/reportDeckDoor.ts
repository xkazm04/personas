/**
 * Which door a report row opens (decision-center wave 3).
 *
 * The reports tab is a HISTORY view. An UNREAD report is something to read and
 * act on, so it opens the Decision Deck on the reports chip with this report on
 * top — the deck marks it read, rates it, follows up in chat. A read report
 * keeps the detail modal: deliveries, PDF, delete and the same-execution
 * reviews live there.
 */
import {
  openChipDeck,
  reportDecisionId,
} from '@/features/overview/sub_manual-review/libs/decisionDeckDoors';

export function openReportDoor<R extends { id: string; is_read: boolean }>(
  report: R,
  showDetail: (report: R) => void,
  originEl?: Element | null,
): 'deck' | 'detail' {
  if (!report.is_read) {
    openChipDeck('reports', reportDecisionId(report.id), originEl);
    return 'deck';
  }
  showDetail(report);
  return 'detail';
}
