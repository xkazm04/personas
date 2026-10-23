import { create } from 'zustand';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';
import {
  listPendingRemoteCommands,
  approveRemoteCommand,
  rejectRemoteCommand,
} from '@/api/remoteCommands';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

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

/**
 * After a failed approve/reject, ask the backend whether `id` is still pending.
 * A request approved from another device, rejected on the dashboard, or expired
 * fails with "no longer pending" / "not found" on every retry, so keeping it at
 * the head of the queue re-opens the same modal with a button that can never
 * succeed. Drop it only on positive evidence (a successful list without it); a
 * list that fails too keeps the card, so a network blip never loses a request.
 */
async function dropIfNoLongerPending(
  id: string,
  set: (fn: (s: RemoteCommandState) => Partial<RemoteCommandState>) => void,
): Promise<void> {
  let pending: RemoteCommand[];
  try {
    pending = await listPendingRemoteCommands();
  } catch (err) {
    // The original failure was already toasted; without a fresh list there is
    // no evidence either way, so the card stays.
    silentCatch('remoteCommands:reconcileAfterFailure')(err);
    return;
  }
  if (pending.some((c) => c.id === id)) return;
  set((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
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
      // Only clear busyId if it still belongs to this call — a concurrent
      // approve/reject on a different command may have already overwritten
      // it, and clearing unconditionally would prematurely re-enable that
      // other command's buttons while its own request is still in flight.
      set((s) => ({ queue: s.queue.filter((c) => c.id !== id), busyId: s.busyId === id ? null : s.busyId }));
    } catch (e) {
      set((s) => ({ busyId: s.busyId === id ? null : s.busyId }));
      toastCatch('remoteCommands:approve')(e);
      await dropIfNoLongerPending(id, set);
    }
  },

  reject: async (id) => {
    set({ busyId: id });
    try {
      await rejectRemoteCommand(id);
      set((s) => ({ queue: s.queue.filter((c) => c.id !== id), busyId: s.busyId === id ? null : s.busyId }));
    } catch (e) {
      set((s) => ({ busyId: s.busyId === id ? null : s.busyId }));
      toastCatch('remoteCommands:reject')(e);
      await dropIfNoLongerPending(id, set);
    }
  },

  dismiss: (id) => set((s) => ({ queue: s.queue.filter((c) => c.id !== id) })),
}));
