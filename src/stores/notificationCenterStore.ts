import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineNotificationStatus = 'success' | 'failed' | 'canceled';

export interface PipelineNotification {
  id: string;
  pipelineId: number;
  projectId: number | null;
  status: PipelineNotificationStatus;
  ref: string;
  webUrl: string;
  timestamp: number;
  read: boolean;
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
    return Array.isArray(parsed) ? parsed : [];
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
