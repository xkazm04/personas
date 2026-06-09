import { create } from 'zustand';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';

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

/** Optional inline action on a standard toast (e.g. "View" → navigate). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface StandardToast extends BaseToast {
  kind: 'standard';
  /** Optional inline action button rendered in the toast. */
  action?: ToastAction;
  /**
   * Visual tone of the toast. `warning` (added Stage 6 for the
   * team-preset partial-failure path) sits between success and error:
   * amber styling, polite ARIA live (not assertive), 4s default
   * duration. Use it when the operation produced both real value AND
   * meaningful failures — e.g. "adopted 4/6 members" — so the user
   * neither over-trusts (success-tone lie) nor over-reacts (error-tone
   * panic).
   */
  type: 'success' | 'error' | 'warning';
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

const STANDARD_PRIORITY: Record<'success' | 'error' | 'warning', number> = {
  success: 10,
  warning: 18,
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

const DEFAULT_DURATION: Record<'success' | 'error' | 'warning', number> = {
  success: 3000,
  warning: 4000,
  error: 5000,
};

const HEALING_DURATION_MS = 8000;

/** Maximum toasts kept in state (including hidden overflow). */
const MAX_TOASTS = 10;

/** Maximum visible toasts rendered on screen. */
export const MAX_VISIBLE_TOASTS = 3;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: 'success' | 'error' | 'warning', duration?: number, action?: ToastAction) => void;
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

  addToast: (message, type, duration, action) => {
    const id = `toast-${++nextId}`;
    const toast: StandardToast = {
      id,
      kind: 'standard',
      message,
      type,
      timestamp: Date.now(),
      duration: duration ?? DEFAULT_DURATION[type],
      priority: STANDARD_PRIORITY[type],
      action,
    };
    set((s) => ({
      toasts: [...s.toasts, toast].slice(-MAX_TOASTS),
    }));
    announceImperative(message, type === 'error' ? 'assertive' : 'polite');
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
    const urgency = normalizedSeverity === 'critical' || normalizedSeverity === 'high'
      ? 'assertive' as const
      : 'polite' as const;
    announceImperative(`${personaName}: ${title}`, urgency);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
