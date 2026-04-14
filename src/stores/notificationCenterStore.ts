import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessType =
  | 'n8n-transform'
  | 'template-adopt'
  | 'rebuild'
  | 'template-test'
  | 'context-scan'
  | 'idea-scan'
  | 'execution'
  | 'matrix-build'
  | 'lab-run'
  | 'connector-test'
  | 'creative-session'
  | 'feedback-chat';

export type PipelineNotificationStatus = 'success' | 'failed' | 'canceled' | 'warning';

export interface PipelineNotification {
  id: string;
  pipelineId: number;
  projectId: number | null;
  status: PipelineNotificationStatus;
  ref: string;
  webUrl: string;
  timestamp: number;
  read: boolean;
  /** Optional persistent title — used by process notifications. */
  title?: string;
  /** Optional persistent message body — used by process notifications. */
  message?: string;
  /** Optional chat session id — used by feedback-chat notifications to restore
   *  the specific background session when the user clicks the redirect. */
  chatSessionId?: string;
  /** Optional persona id — used by feedback-chat notifications to select the
   *  correct persona before restoring the chat session. */
  personaId?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pipeline_notification_history';
const MAX_NOTIFICATIONS = 50;

function loadNotifications(): PipelineNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.length > MAX_NOTIFICATIONS ? parsed.slice(0, MAX_NOTIFICATIONS) : parsed;
  } catch {
    return [];
  }
}

function saveNotifications(items: PipelineNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    // intentional: localStorage quota exceeded or unavailable
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface NotificationCenterStore {
  notifications: PipelineNotification[];
  isOpen: boolean;
  unreadCount: number;

  addNotification: (n: Omit<PipelineNotification, 'id' | 'timestamp' | 'read'>) => void;
  addProcessNotification: (n: {
    processType: ProcessType;
    personaId?: string | null;
    personaName?: string | null;
    status: string;
    title?: string;
    summary: string;
    redirectSection: string;
    redirectTab: string | null;
    /** When present, clicking the redirect will restore this specific chat session */
    chatSessionId?: string;
  }) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

let nextId = 0;

export const useNotificationCenterStore = create<NotificationCenterStore>((set, get) => {
  const initial = loadNotifications();

  return {
    notifications: initial,
    isOpen: false,
    unreadCount: initial.filter((n) => !n.read).length,

    addNotification: (n) => {
      const notification: PipelineNotification = {
        ...n,
        id: `pn-${++nextId}-${Date.now()}`,
        timestamp: Date.now(),
        read: false,
      };
      const updated = [notification, ...get().notifications].slice(0, MAX_NOTIFICATIONS);
      saveNotifications(updated);
      set({ notifications: updated, unreadCount: updated.filter((x) => !x.read).length });
    },

    addProcessNotification: (n) => {
      let normalizedStatus: PipelineNotificationStatus = 'success';
      if (n.status === 'failed' || n.status === 'error') normalizedStatus = 'failed';
      else if (n.status === 'canceled' || n.status === 'cancelled') normalizedStatus = 'canceled';
      else if (n.status === 'warning' || n.status === 'completed_with_warning') normalizedStatus = 'warning';

      const notification: PipelineNotification = {
        id: `proc-${++nextId}-${Date.now()}`,
        pipelineId: 0,
        projectId: null,
        status: normalizedStatus,
        ref: n.processType,
        webUrl: n.redirectSection + (n.redirectTab ? `#${n.redirectTab}` : ''),
        timestamp: Date.now(),
        read: false,
        title: n.title,
        message: n.summary,
        ...(n.chatSessionId ? { chatSessionId: n.chatSessionId } : {}),
        ...(n.personaId ? { personaId: n.personaId } : {}),
      };
      const updated = [notification, ...get().notifications].slice(0, MAX_NOTIFICATIONS);
      saveNotifications(updated);
      set({ notifications: updated, unreadCount: updated.filter((x) => !x.read).length });
    },

    markRead: (id) => {
      const updated = get().notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      saveNotifications(updated);
      set({ notifications: updated, unreadCount: updated.filter((x) => !x.read).length });
    },

    markAllRead: () => {
      const updated = get().notifications.map((n) => ({ ...n, read: true }));
      saveNotifications(updated);
      set({ notifications: updated, unreadCount: 0 });
    },

    dismiss: (id) => {
      const updated = get().notifications.filter((n) => n.id !== id);
      saveNotifications(updated);
      set({ notifications: updated, unreadCount: updated.filter((x) => !x.read).length });
    },

    clearAll: () => {
      saveNotifications([]);
      set({ notifications: [], unreadCount: 0 });
    },

    setOpen: (open) => set({ isOpen: open }),
    toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  };
});
