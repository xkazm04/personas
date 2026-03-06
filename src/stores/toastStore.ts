import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
  timestamp: number;
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: 'success' | 'error', duration?: number) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<'success' | 'error', number> = {
  success: 3000,
  error: 5000,
};

const MAX_TOASTS = 5;

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type, duration) => {
    const id = `toast-${++nextId}`;
    const toast: Toast = {
      id,
      message,
      type,
      timestamp: Date.now(),
      duration: duration ?? DEFAULT_DURATION[type],
    };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
