import { useState, useEffect } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { Clock, RotateCw, ShieldAlert, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { HealingEventPayload } from '../runnerTypes';

export function HealingCard({
  notification,
  onDismiss,
}: {
  notification: HealingEventPayload;
  onDismiss: () => void;
}) {
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const isRetry = notification.auto_fixed && notification.backoff_seconds != null;
  const isIssue = !notification.auto_fixed;

  // Countdown timer for retry backoff
  const [countdown, setCountdown] = useState(notification.backoff_seconds ?? 0);
  useEffect(() => {
    if (!isRetry || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRetry, countdown]);

  // Reset countdown when notification changes
  useEffect(() => {
    setCountdown(notification.backoff_seconds ?? 0);
  }, [notification.backoff_seconds]);

  // Style based on action type
  const styles = isIssue
    ? { border: 'border-red-500/25', bg: 'bg-red-500/[0.04]', icon: 'text-red-400', accent: 'text-red-400' }
    : { border: 'border-amber-500/25', bg: 'bg-amber-500/[0.04]', icon: 'text-amber-400', accent: 'text-amber-300' };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <div className="px-4 py-3.5 space-y-2.5">
        {/* Header row */}
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${styles.accent}`}>
                {notification.title}
              </span>
              <span className="text-sm font-mono px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/60 border border-primary/10">
                {notification.severity}
              </span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground/50 hover:text-foreground/80 transition-colors flex-shrink-0 p-0.5"
          >
            <span className="text-sm">dismiss</span>
          </button>
        </div>

        {/* Strategy & description */}
        {notification.strategy && (
          <div className="flex items-center gap-2 text-sm">
            <RotateCw className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon} opacity-60`} />
            <span className="text-foreground/80">{notification.strategy}</span>
          </div>
        )}

        {/* Retry countdown + progress */}
        {isRetry && notification.retry_number != null && notification.max_retries != null && (
          <div className="flex items-center gap-3 pt-1">
            {/* Countdown */}
            {countdown > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400/60 animate-pulse" />
                <span className="text-sm font-mono text-amber-300/90">
                  Retrying in {countdown}s...
                </span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-blue-400/70 animate-spin" />
                <span className="text-sm font-mono text-blue-300/90">
                  Retrying now...
                </span>
              </div>
            )}
            {/* Attempt badge */}
            <span className="ml-auto text-sm font-mono text-muted-foreground/60 px-2 py-0.5 rounded bg-secondary/30 border border-primary/10">
              Attempt {notification.retry_number} of {notification.max_retries}
            </span>
          </div>
        )}

        {/* Backoff progress bar */}
        {isRetry && (notification.backoff_seconds ?? 0) > 0 && (
          <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-amber-500/40"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: notification.backoff_seconds ?? 0, ease: 'linear' }}
            />
          </div>
        )}

        {/* Issue-created: link to healing panel */}
        {isIssue && (
          <button
            onClick={() => setSidebarSection('overview')}
            className="flex items-center gap-1.5 text-sm text-red-400/80 hover:text-red-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View in healing issues
          </button>
        )}

        {/* Suggested fix */}
        {notification.suggested_fix && (
          <p className="text-sm text-muted-foreground/60 leading-relaxed pl-6.5">
            {notification.suggested_fix}
          </p>
        )}
      </div>
    </motion.div>
  );
}
