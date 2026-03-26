import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { useToastStore, MAX_VISIBLE_TOASTS } from '@/stores/toastStore';
import type { StandardToast, HealingToast } from '@/stores/toastStore';
import { classifyErrorFull } from '@/lib/errors/errorPipeline';
import { friendlySeverity } from '@/lib/errors/errorRegistry';
import { formatElapsed } from '@/lib/utils/formatters';

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

const _EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];

// ---------------------------------------------------------------------------
// Standard toast item
// ---------------------------------------------------------------------------

function StandardToastItem({ toast, onDismiss }: { toast: StandardToast; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const [elapsedLabel, setElapsedLabel] = useState('');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());

  const classified = toast.type === 'error' ? classifyErrorFull(toast.message) : null;
  const friendly = classified?.friendly ?? null;
  const displayMessage = friendly?.message ?? toast.message;

  useEffect(() => {
    if (paused) return;

    lastTickRef.current = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      elapsedRef.current += now - lastTickRef.current;
      lastTickRef.current = now;

      if (elapsedRef.current >= toast.duration) {
        onDismiss(toast.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [paused, toast.duration, toast.id, onDismiss]);

  // Live-update elapsed label every second
  useEffect(() => {
    const update = () => setElapsedLabel(formatElapsed(Date.now() - toast.timestamp));
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [toast.timestamp]);

  const remaining = Math.max(0, toast.duration - elapsedRef.current);
  const progressFraction = remaining / toast.duration;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        lastTickRef.current = Date.now();
        setPaused(false);
      }}
      className={`animate-fade-slide-in pointer-events-auto rounded-xl border shadow-elevation-3 backdrop-blur-md overflow-hidden ${
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
          className="ml-1 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <div className="h-0.5 bg-black/20">
        <div
          className={`animate-fade-in h-full ${
            toast.type === 'success' ? 'bg-emerald-400/50' : 'bg-red-400/50'
          }`} style={{ width: paused ? `${progressFraction * 100}%` : '0%' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Healing toast item
// ---------------------------------------------------------------------------

function HealingToastItem({ toast, onDismiss }: { toast: HealingToast; onDismiss: (id: string) => void }) {
  const styles = SEVERITY_STYLES[toast.severity] ?? SEVERITY_STYLES.medium!;
  const [elapsedLabel, setElapsedLabel] = useState('');

  useEffect(() => {
    const update = () => setElapsedLabel(formatElapsed(Date.now() - toast.timestamp));
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [toast.timestamp]);

  const handleResolve = useCallback(async () => {
    const { useOverviewStore } = await import("@/stores/overviewStore");
    await useOverviewStore.getState().resolveHealingIssue(toast.issueId);
    onDismiss(toast.id);
  }, [toast.issueId, toast.id, onDismiss]);

  return (
    <div
      className={`animate-fade-slide-in pointer-events-auto rounded-xl border ${styles.border} bg-background/95 backdrop-blur-md shadow-elevation-3 overflow-hidden`}
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
            <span className="typo-body text-muted-foreground/90 mt-0.5 block">
              {toast.personaName}
            </span>
          </div>
          <span className="typo-caption text-muted-foreground/50 tabular-nums flex-shrink-0">{elapsedLabel}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-muted-foreground/80 hover:text-foreground/95 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Suggested fix */}
        {toast.suggestedFix && (
          <p className="typo-body text-muted-foreground/80 leading-relaxed line-clamp-2 pl-6.5">
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
            Resolve
          </button>
        </div>
      </div>

      {/* Auto-dismiss progress bar */}
      <div className="h-0.5 bg-secondary/30">
        <div
          className={`animate-fade-in h-full ${styles.progress}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified toast stack
// ---------------------------------------------------------------------------

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  const handleDismiss = useCallback(
    (id: string) => dismiss(id),
    [dismiss],
  );

  // Auto-dismiss expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const t of toasts) {
        if (now - t.timestamp >= t.duration) {
          dismiss(t.id);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [toasts, dismiss]);

  // Sort by priority descending (highest priority on top), then by timestamp (newest first)
  const sorted = useMemo(
    () => [...toasts].sort((a, b) => b.priority - a.priority || b.timestamp - a.timestamp),
    [toasts],
  );

  const visible = sorted.slice(0, MAX_VISIBLE_TOASTS);
  const overflowCount = sorted.length - visible.length;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none max-w-sm"
      role="status"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      {/* Overflow counter */}
      {overflowCount > 0 && (
        <div
          className="animate-fade-slide-in pointer-events-auto self-end rounded-lg bg-secondary/80 backdrop-blur-sm border border-primary/10 px-2.5 py-1 typo-caption text-muted-foreground/70"
        >
          +{overflowCount} more
        </div>
      )}

      {visible.map((toast) =>
          toast.kind === 'healing' ? (
            <HealingToastItem key={toast.id} toast={toast} onDismiss={handleDismiss} />
          ) : (
            <StandardToastItem key={toast.id} toast={toast} onDismiss={handleDismiss} />
          ),
        )}
    </div>
  );
}
