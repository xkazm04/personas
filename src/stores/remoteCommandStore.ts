import { create } from 'zustand';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';
import {
  listPendingRemoteCommands,
  approveRemoteCommand,
  rejectRemoteCommand,
} from '@/api/remoteCommands';
import { toastCatch } from '@/lib/silentCatch';

interface RemoteCommandState {
  /** FIFO queue of run-requests awaiting the user's decision. */
  queue: RemoteCommand[];
  /** Id of the request currently being approved/rejected (gates the buttons). */
  busyId: string | null;
  loadPending: () => Promise<void>;
  enqueue: (cmd: RemoteCommand) => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  /** Defer locally without rejecting — it stays pending and re-surfaces later. */
  dismiss: (id: string) => void;
}

export const useRemoteCommandStore = create<RemoteCommandState>((set) => ({
  queue: [],
  busyId: null,

  loadPending: async () => {
    try {
      const pending = await listPendingRemoteCommands();
      set((s) => {
        const seen = new Set(s.queue.map((c) => c.id));
        return { queue: [...s.queue, ...pending.filter((c) => !seen.has(c.id))] };
      });
    } catch (e) {
      toastCatch('remoteCommands:loadPending')(e);
    }
  },

  enqueue: (cmd) =>
    set((s) => (s.queue.some((c) => c.id === cmd.id) ? s : { queue: [...s.queue, cmd] })),

  approve: async (id) => {
    set({ busyId: id });
    try {
      await approveRemoteCommand(id);
      set((s) => ({ queue: s.queue.filter((c) => c.id !== id), busyId: null }));
    } catch (e) {
      set({ busyId: null });
      toastCatch('remoteCommands:approve')(e);
    }
  },

  reject: async (id) => {
    set({ busyId: id });
    try {
      await rejectRemoteCommand(id);
      set((s) => ({ queue: s.queue.filter((c) => c.id !== id), busyId: null }));
    } catch (e) {
      set({ busyId: null });
      toastCatch('remoteCommands:reject')(e);
    }
  },

  dismiss: (id) => set((s) => ({ queue: s.queue.filter((c) => c.id !== id) })),
}));
