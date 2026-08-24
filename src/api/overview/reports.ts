import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaReport } from "@/lib/bindings/PersonaReport";
import type { PersonaReportDelivery } from "@/lib/bindings/PersonaReportDelivery";
import type { ReportDeliverySummary } from "@/lib/bindings/ReportDeliverySummary";
import type { ReportThreadSummary } from "@/lib/bindings/ReportThreadSummary";

// ============================================================================
// Messages
// ============================================================================

export const listReports = (limit?: number, offset?: number) =>
  invoke<PersonaReport[]>("list_reports", {
    limit: limit,
    offset: offset,
  });

export const getReport = (id: string) =>
  invoke<PersonaReport>("get_report", { id });

export const markReportRead = (id: string) =>
  invoke<void>("mark_report_read", { id });

export const markAllReportsRead = (personaId?: string) =>
  invoke<void>("mark_all_reports_read", {
    personaId: personaId,
  });

export const deleteReport = (id: string) =>
  invoke<boolean>("delete_report", { id });

export const deleteAllReports = () =>
  invoke<number>("delete_all_reports", {});

export const getUnreadReportCount = () =>
  invoke<number>("get_unread_report_count", {});

export const getReportCount = () =>
  invoke<number>("get_report_count", {});

export const getReportDeliveries = (messageId: string) =>
  invoke<PersonaReportDelivery[]>("get_report_deliveries", { messageId });

export const getBulkDeliverySummaries = (messageIds: string[]) =>
  invoke<ReportDeliverySummary[]>("get_bulk_delivery_summaries", { messageIds });

// ============================================================================
// Threads
// ============================================================================

export const getReportsByThread = (threadId: string) =>
  invoke<PersonaReport[]>("get_reports_by_thread", { threadId });

export const getThreadSummaries = (limit?: number, offset?: number, personaId?: string) =>
  invoke<ReportThreadSummary[]>("get_thread_summaries", { limit, offset, personaId });

export const getThreadCount = (personaId?: string) =>
  invoke<number>("get_thread_count", { personaId });

// ============================================================================
// Dev
// ============================================================================

export const seedMockMessage = () =>
  invoke<PersonaReport>("seed_mock_message", {});
