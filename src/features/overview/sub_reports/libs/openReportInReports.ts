import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Open one report on Overview > Reports. The tab is a lazy page that owns its own
 * selection, so this parks the id on the overview store's `pendingReportFocus`
 * door (the sibling of `pendingExecutionFocus`) and routes there; `ReportList`
 * pops the report's detail modal and clears the id.
 *
 * Used by an Approvals row whose `context_data.reportId` links it to the report
 * that carries the evidence (screenshots) for the decision.
 */
export function openReportInReports(reportId: string): void {
  useOverviewStore.getState().setPendingReportFocus(reportId);
  useOverviewStore.getState().setOverviewTab('messages');
  useSystemStore.getState().setSidebarSection('overview');
}
