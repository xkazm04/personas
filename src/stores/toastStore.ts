import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseToast {
  id: string;
  message: string;
  timestamp: number;
  duration: number;
  /** Higher priority toasts render above lower ones. */
  priority: number;
}

export interface StandardToast extends BaseToast {
  kind: 'standard';
  type: 'success' | 'error';
}

export interface HealingToast extends BaseToast {
  kind: 'healing';
  severity: 'critical' | 'high' | 'medium' | 'low';
  personaName: string;
  suggestedFix: string | null;
  issueId: string;
  personaId: string;
}

export type Toast = StandardToast | HealingToast;

// ---------------------------------------------------------------------------
// Priority mapping -- healing critical/high > standard error > standard success
// ---------------------------------------------------------------------------

const STANDARD_PRIORITY: Record<'success' | 'error', number> = {
  success: 10,
  error: 20,
};

const HEALING_PRIORITY: Record<HealingToast['severity'], number> = {
  low: 15,
  medium: 25,
  high: 30,
  critical: 40,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION: Record<'success' | 'error', number> = {
  success: 3000,
  error: 5000,
};

const HEALING_DURATION_MS = 8000;

/** Maximum toasts kept in state (including hidden overflow). */
const MAX_TOASTS = 10;

/** Maximum visible toasts rendered on screen. */
export const MAX_VISIBLE_TOASTS = 4;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: 'success' | 'error', duration?: number) => void;
  addHealingToast: (opts: {
    issueId: string;
    personaId: string;
    title: string;
    severity: string;
    personaName: string;
    suggestedFix: string | null;
  }) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type, duration) => {
    const id = `toast-${++nextId}`;
    const toast: StandardToast = {
      id,
      kind: 'standard',
      message,
      type,
      timestamp: Date.now(),
      duration: duration ?? DEFAULT_DURATION[type],
      priority: STANDARD_PRIORITY[type],
    };
    set((s) => ({
      toasts: [...s.toasts, toast].slice(-MAX_TOASTS),
    }));
  },

  addHealingToast: ({ issueId, personaId, title, severity, personaName, suggestedFix }) => {
    const normalizedSeverity = (
      ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'medium'
    ) as HealingToast['severity'];

    const toast: HealingToast = {
      id: `healing-${issueId}`,
      kind: 'healing',
      message: title,
      timestamp: Date.now(),
      duration: HEALING_DURATION_MS,
      priority: HEALING_PRIORITY[normalizedSeverity],
      severity: normalizedSeverity,
      personaName,
      suggestedFix,
      issueId,
      personaId,
    };

    set((s) => {
      // Deduplicate by issueId
      const filtered = s.toasts.filter((t) => t.id !== toast.id);
      return { toasts: [...filtered, toast].slice(-MAX_TOASTS) };
    });
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
