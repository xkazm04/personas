import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import { CheckCircle2, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useToastStore, MAX_VISIBLE_TOASTS } from '@/stores/toastStore';
import type { StandardToast, HealingToast } from '@/stores/toastStore';
import { classifyErrorFull } from '@/lib/errors/errorPipeline';
import { friendlySeverity } from '@/lib/errors/errorRegistry';
import { formatElapsed } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Severity styles (healing toasts)
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { border: string; icon: string; badge: string; progress: string }> = {
  critical: {
    border: 'border-red-500/30',
    icon: 'text-red-400',
    badge: 'bg-red-500/15 text-red-400 border-red-500/20',
    progress: 'bg-red-500/40',
  },
  high: {
    border: 'border-orange-500/30',
    icon: 'text-orange-400',
    badge: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    progress: 'bg-orange-500/40',
  },
  medium: {
    border: 'border-amber-500/30',
    icon: 'text-amber-400',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    progress: 'bg-amber-500/40',
  },
  low: {
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    progress: 'bg-blue-500/40',
  },
};

// ---------------------------------------------------------------------------
// Standard toast item
// ---------------------------------------------------------------------------

function StandardToastItem({ toast, onDismiss }: { toast: StandardToast; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const [elapsedLabel, setElapsedLabel] = useState('');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const classified = toast.type === 'error' ? classifyErrorFull(toast.message) : null;
  const friendly = classified?.friendly ?? null;
  const displayMessage = friendly?.message ?? toast.message;

  // Single RAF loop handles both dismiss countdown and elapsed label.
  // The progress bar is driven by CSS animation (smooth pause/resume); this
  // loop only fires the dismiss callback once duration is exhausted.
  useEffect(() => {
    let rafId: number;
    let lastLabelSec = -1;
    lastTickRef.current = Date.now();

    const tick = () => {
      const now = Date.now();
      if (!pausedRef.current) {
        elapsedRef.current += now - lastTickRef.current;
        if (elapsedRef.current >= toast.duration) {
          onDismiss(toast.id);
          return;
        }
      }
      lastTickRef.current = now;

      const sec = Math.floor((now - toast.timestamp) / 1000);
      if (sec !== lastLabelSec) {
        lastLabelSec = sec;
        setElapsedLabel(formatElapsed(now - toast.timestamp));
      }

      rafId = requestAnimationFrame(tick);
    };

    setElapsedLabel(formatElapsed(Date.now() - toast.timestamp));
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [toast.duration, toast.id, toast.timestamp, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        lastTickRef.current = Date.now();
        setPaused(false);
      }}
      className={`rounded-xl border shadow-elevation-3 backdrop-blur-md overflow-hidden ${
        toast.type === 'success'
          ? 'bg-emerald-950/90 border-emerald-500/25 text-emerald-300'
          : 'bg-red-950/90 border-red-500/25 text-red-300'
      }`}
    >
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        {toast.type === 'success' ? (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <span className="typo-heading block">{displayMessage}</span>
          {friendly?.suggestion && (
            <span className="typo-caption opacity-70 block mt-0.5">{friendly.suggestion}</span>
          )}
        </div>
        <span className="typo-caption opacity-50 tabular-nums flex-shrink-0">{elapsedLabel}</span>
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label={t.common.dismiss_notification}
          className="ml-1 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Auto-dismiss progress bar — CSS animation so pause/resume is smooth */}
      <div className="h-0.5 bg-black/20">
        <div
          data-paused={paused ? 'true' : 'false'}
          className={`animate-toast-progress h-full ${
            toast.type === 'success' ? 'bg-emerald-400/50' : 'bg-red-400/50'
          }`}
          style={{ '--toast-duration': `${toast.duration}ms` } as CSSProperties}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Healing toast item
// ---------------------------------------------------------------------------

function HealingToastItem({ toast, onDismiss }: { toast: HealingToast; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const styles = SEVERITY_STYLES[toast.severity] ?? SEVERITY_STYLES.medium!;
  const [paused, setPaused] = useState(false);
  const [elapsedLabel, setElapsedLabel] = useState('');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let rafId: number;
    let lastLabelSec = -1;
    lastTickRef.current = Date.now();

    const tick = () => {
      const now = Date.now();
      if (!pausedRef.current) {
        elapsedRef.current += now - lastTickRef.current;
        if (elapsedRef.current >= toast.duration) {
          onDismiss(toast.id);
          return;
        }
      }
      lastTickRef.current = now;

      const sec = Math.floor((now - toast.timestamp) / 1000);
      if (sec !== lastLabelSec) {
        lastLabelSec = sec;
        setElapsedLabel(formatElapsed(now - toast.timestamp));
      }

      rafId = requestAnimationFrame(tick);
    };

    setElapsedLabel(formatElapsed(Date.now() - toast.timestamp));
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [toast.duration, toast.id, toast.timestamp, onDismiss]);

  const handleResolve = useCallback(async () => {
    const { useOverviewStore } = await import("@/stores/overviewStore");
    await useOverviewStore.getState().resolveHealingIssue(toast.issueId);
    onDismiss(toast.id);
  }, [toast.issueId, toast.id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        lastTickRef.current = Date.now();
        setPaused(false);
      }}
      className={`rounded-xl border ${styles.border} bg-background/95 backdrop-blur-md shadow-elevation-3 overflow-hidden`}
    >
      <div className="px-3.5 py-3 space-y-2">
        {/* Header */}
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="typo-heading text-foreground/90 truncate">
                {toast.message}
              </span>
              <span className={`typo-caption px-1.5 py-0.5 rounded border flex-shrink-0 ${styles.badge}`}>
                {friendlySeverity(toast.severity)}
              </span>
            </div>
            <span className="typo-body text-foreground mt-0.5 block">
              {toast.personaName}
            </span>
          </div>
          <span className="typo-caption text-foreground tabular-nums flex-shrink-0">{elapsedLabel}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            aria-label={t.common.dismiss_notification}
            className="text-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Suggested fix */}
        {toast.suggestedFix && (
          <p className="typo-body text-foreground leading-relaxed line-clamp-2 pl-6.5">
            {toast.suggestedFix}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pl-6.5">
          <button
            onClick={handleResolve}
            className="flex items-center gap-1 px-2 py-1 typo-heading rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" />
            {t.common.resolve}
          </button>
        </div>
      </div>

      {/* Auto-dismiss progress bar — CSS animation so pause/resume is smooth */}
      <div className="h-0.5 bg-secondary/30">
        <div
          data-paused={paused ? 'true' : 'false'}
          className={`animate-toast-progress h-full ${styles.progress}`}
          style={{ '--toast-duration': `${toast.duration}ms` } as CSSProperties}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified toast stack
// ---------------------------------------------------------------------------

export function ToastContainer() {
  const { t, tx } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const reduceMotion = useReducedMotion();

  const handleDismiss = useCallback(
    (id: string) => dismiss(id),
    [dismiss],
  );

  // Sort by priority descending (highest priority on top), then by timestamp (newest first)
  const sorted = useMemo(
    () => [...toasts].sort((a, b) => b.priority - a.priority || b.timestamp - a.timestamp),
    [toasts],
  );

  const visible = sorted.slice(0, MAX_VISIBLE_TOASTS);
  const overflowCount = sorted.length - visible.length;

  const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96 };
  const animate = { opacity: 1, x: 0, scale: 1 };
  const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, x: '100%' };
  const transition = { duration: 0.2, ease: 'easeIn' as const };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none max-w-sm"
      role="status"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      <AnimatePresence initial={false}>
        {/* Overflow counter — sits below the stack via flex-col-reverse ordering */}
        {overflowCount > 0 && (
          <motion.div
            key="toast-overflow-chip"
            initial={initial}
            animate={animate}
            exit={exit}
            transition={transition}
            className="pointer-events-auto self-end rounded-lg bg-secondary/80 backdrop-blur-sm border border-primary/10 px-2.5 py-1 typo-caption text-foreground"
          >
            {tx(t.common.toast_overflow, { count: overflowCount })}
          </motion.div>
        )}

        {visible.map((toast) => (
          <motion.div
            key={toast.id}
            layout={!reduceMotion}
            initial={initial}
            animate={animate}
            exit={exit}
            transition={transition}
            className="pointer-events-auto"
          >
            {toast.kind === 'healing' ? (
              <HealingToastItem toast={toast} onDismiss={handleDismiss} />
            ) : (
              <StandardToastItem toast={toast} onDismiss={handleDismiss} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
