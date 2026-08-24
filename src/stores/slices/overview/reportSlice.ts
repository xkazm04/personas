import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("reports");
import type { PersonaReport } from "@/lib/types/types";
import { deleteReport, getReportCount, getUnreadReportCount, listReports, markAllReportsRead, markReportRead, getBulkDeliverySummaries } from "@/api/overview/reports";
import type { ReportDeliverySummary } from "@/lib/bindings/ReportDeliverySummary";
import { deduplicateFetch } from "@/lib/utils/deduplicateFetch";
import { silentCatch } from '@/lib/silentCatch';



export interface ReportSlice {
  // State
  reports: PersonaReport[];
  reportsTotal: number;
  unreadReportCount: number;
  /** IDs of reports with in-flight markAsRead calls (not yet confirmed by backend). */
  _pendingReadIds: Set<string>;
  /** Delivery status summaries keyed by message ID. */
  deliverySummaries: Map<string, ReportDeliverySummary>;

  // Actions
  fetchReports: (reset?: boolean) => Promise<void>;
  markReportAsRead: (id: string) => Promise<void>;
  markAllReportsAsRead: (personaId?: string) => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
  fetchUnreadReportCount: () => Promise<void>;
  fetchDeliverySummaries: (messageIds: string[]) => Promise<void>;
}

export const createReportSlice: StateCreator<OverviewStore, [], [], ReportSlice> = (set, get) => ({
  reports: [],
  reportsTotal: 0,
  unreadReportCount: 0,
  _pendingReadIds: new Set(),
  deliverySummaries: new Map(),

  fetchReports: async (reset = true) => {
    try {
      const PAGE_SIZE = 50;
      const offset = reset ? 0 : get().reports.length;
      const [rawReports, totalCount, unreadCount] = await Promise.all([
        listReports(PAGE_SIZE, offset),
        reset ? getReportCount() : Promise.resolve(get().reportsTotal),
        getUnreadReportCount(),
      ]);
      if (reset) {
        // Reset replaces the whole list, so the in-flight-read guard must be
        // cleared too — a leftover id (in-flight mark that never settled, or a
        // recycled id) would otherwise permanently no-op markReportAsRead for it.
        set({ reports: rawReports, reportsTotal: totalCount, unreadReportCount: unreadCount, _pendingReadIds: new Set() });
      } else {
        set((state) => ({
          reports: [...state.reports, ...rawReports],
          reportsTotal: totalCount,
          unreadReportCount: unreadCount,
        }));
      }
      // Fetch delivery summaries for the loaded reports (non-blocking)
      const ids = rawReports.map((m) => m.id);
      if (ids.length > 0) void get().fetchDeliverySummaries(ids);
    } catch (err) {
      reportError(err, "Failed to fetch reports", set);
    }
  },

  markReportAsRead: async (id) => {
    // Guard: no-op if already read or already pending to prevent count drift
    const { reports, _pendingReadIds } = get();
    const msg = reports.find((m) => m.id === id);
    if (!msg || msg.is_read || _pendingReadIds.has(id)) return;

    const prevReadAt = msg.read_at;

    // Optimistically mark as read and add to pending set
    const readAt = new Date().toISOString();
    const markRead = (m: PersonaReport) =>
      m.id === id ? { ...m, is_read: true, read_at: readAt } : m;

    set((state) => {
      const nextPending = new Set(state._pendingReadIds);
      nextPending.add(id);
      return {
        reports: state.reports.map(markRead),
        _pendingReadIds: nextPending,
        unreadReportCount: Math.max(0, state.unreadReportCount - 1),
      };
    });
    try {
      await markReportRead(id);
      // Success: remove from pending set (count is already correct)
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return { _pendingReadIds: nextPending };
      });
    } catch (err) {
      logger.warn("markReportAsRead failed, recovering state", { messageId: id, error: String(err) });
      // Rollback: remove from pending set and restore the message
      const rollback = (m: PersonaReport) =>
        m.id === id ? { ...m, is_read: false, read_at: prevReadAt ?? null } : m;
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return {
          reports: state.reports.map(rollback),
          _pendingReadIds: nextPending,
          unreadReportCount: state.unreadReportCount + 1,
        };
      });
      reportError(err, "Failed to mark message as read", set);
    }
  },

  markAllReportsAsRead: async (personaId?) => {
    try {
      await markAllReportsRead(personaId);
      const readAt = new Date().toISOString();
      const shouldMark = (m: PersonaReport) => !personaId || m.persona_id === personaId;
      set((state) => {
        const updatedReports = state.reports.map((m) =>
          shouldMark(m) ? { ...m, is_read: true, read_at: readAt } : m,
        );
        const unreadReportCount = updatedReports.filter((m) => !m.is_read).length;
        return { reports: updatedReports, unreadReportCount };
      });
      // Fetch authoritative count in case the loaded list is a partial page
      await get().fetchUnreadReportCount();
    } catch (err) {
      reportError(err, "Failed to mark all as read", set);
    }
  },

  deleteReport: async (id) => {
    try {
      await deleteReport(id);
      set((state) => {
        // Evict orphaned delivery summary for the deleted message
        const nextDeliverySummaries = new Map(state.deliverySummaries);
        nextDeliverySummaries.delete(id);

        return {
          reports: state.reports.filter((m) => m.id !== id),
          reportsTotal: Math.max(0, state.reportsTotal - 1),
          deliverySummaries: nextDeliverySummaries,
        };
      });
    } catch (err) {
      reportError(err, "Failed to delete message", set);
    }
  },

  fetchUnreadReportCount: deduplicateFetch('unreadReportCount', async () => {
    try {
      const unread = await getUnreadReportCount();
      set({ unreadReportCount: unread });
    } catch (err) {
      logger.warn("fetchUnreadReportCount failed", { error: String(err) });
    }
  }),

  fetchDeliverySummaries: async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    try {
      const summaries = await getBulkDeliverySummaries(messageIds);
      set((state) => {
        const next = new Map(state.deliverySummaries);
        for (const s of summaries) next.set(s.messageId, s);
        // Bound the cache — scrolling through a large message history would
        // otherwise accumulate one summary per message viewed, indefinitely.
        // Map preserves insertion order, so drop the oldest past the cap.
        const CAP = 500;
        if (next.size > CAP) {
          for (const key of [...next.keys()].slice(0, next.size - CAP)) next.delete(key);
        }
        return { deliverySummaries: next };
      });
    } catch (err) { silentCatch("stores/slices/overview/reportSlice:catch1")(err); }
  },
});
