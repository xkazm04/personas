import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { usePersonaStore } from '@/stores/personaStore';
import { ShieldAlert, X, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface HealingEventPayload {
  issue_id: string;
  persona_id: string;
  execution_id: string;
  title: string;
  action: string;
  auto_fixed: boolean;
  severity: string;
  suggested_fix: string | null;
  persona_name: string;
  description?: string;
  strategy?: string;
  backoff_seconds?: number;
  retry_number?: number;
  max_retries?: number;
}

interface ToastItem {
  id: string;
  payload: HealingEventPayload;
  timestamp: number;
}

const SEVERITY_STYLES: Record<string, { border: string; icon: string; badge: string }> = {
  critical: {
    border: 'border-red-500/30',
    icon: 'text-red-400',
    badge: 'bg-red-500/15 text-red-400 border-red-500/20',
  },
  high: {
    border: 'border-orange-500/30',
    icon: 'text-orange-400',
    badge: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  },
  medium: {
    border: 'border-amber-500/30',
    icon: 'text-amber-400',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  },
  low: {
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  },
};

const TOAST_DURATION_MS = 8000;

export function HealingToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const resolveHealingIssue = usePersonaStore((s) => s.resolveHealingIssue);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);

  useEffect(() => {
    const unlisten = listen<HealingEventPayload>('healing-event', (event) => {
      const payload = event.payload;
      // Only show toasts for non-auto-fixed issues
      if (payload.auto_fixed) return;
      // Only show for critical and high severity
      if (payload.severity !== 'critical' && payload.severity !== 'high') return;

      const toast: ToastItem = {
        id: payload.issue_id,
        payload,
        timestamp: Date.now(),
      };
      setToasts((prev) => [toast, ...prev].slice(0, 3));

      // Also refresh the healing issues store
      fetchHealingIssues();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchHealingIssues]);

  // Auto-dismiss toasts after duration
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.timestamp < TOAST_DURATION_MS));
    }, 1000);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleResolve = useCallback(async (id: string) => {
    await resolveHealingIssue(id);
    dismiss(id);
  }, [resolveHealingIssue, dismiss]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const styles = SEVERITY_STYLES[toast.payload.severity] ?? SEVERITY_STYLES.medium!;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-auto rounded-xl border ${styles.border} bg-background/95 backdrop-blur-md shadow-lg shadow-black/20 overflow-hidden`}
            >
              <div className="px-3.5 py-3 space-y-2">
                {/* Header */}
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground/90 truncate">
                        {toast.payload.title}
                      </span>
                      <span className={`text-sm px-1.5 py-0.5 rounded border font-mono flex-shrink-0 ${styles.badge}`}>
                        {toast.payload.severity}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground/90 mt-0.5 block">
                      {toast.payload.persona_name}
                    </span>
                  </div>
                  <button
                    onClick={() => dismiss(toast.id)}
                    className="text-muted-foreground/80 hover:text-foreground/95 transition-colors flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Suggested fix */}
                {toast.payload.suggested_fix && (
                  <p className="text-sm text-muted-foreground/80 leading-relaxed line-clamp-2 pl-6.5">
                    {toast.payload.suggested_fix}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pl-6.5">
                  <button
                    onClick={() => handleResolve(toast.id)}
                    className="flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Resolve
                  </button>
                </div>
              </div>

              {/* Auto-dismiss progress bar */}
              <div className="h-0.5 bg-secondary/30">
                <motion.div
                  className={`h-full ${toast.payload.severity === 'critical' ? 'bg-red-500/40' : 'bg-orange-500/40'}`}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: TOAST_DURATION_MS / 1000, ease: 'linear' }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
