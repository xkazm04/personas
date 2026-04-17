import { useState, useEffect } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useTranslation } from '@/i18n/useTranslation';
import { Clock, RotateCw, ShieldAlert, ExternalLink } from 'lucide-react';
import type { HealingEventPayload } from '../runnerTypes';

export function HealingCard({
  notification,
  onDismiss,
}: {
  notification: HealingEventPayload;
  onDismiss: () => void;
}) {
  const { t, tx } = useTranslation();
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
    <div
      className={`animate-fade-slide-in rounded-modal border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <div className="px-4 py-3.5 space-y-2.5">
        {/* Header row */}
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`typo-heading ${styles.accent}`}>
                {notification.title}
              </span>
              <span className="typo-code px-1.5 py-0.5 rounded bg-secondary/40 text-foreground border border-primary/10">
                {notification.severity}
              </span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-foreground hover:text-foreground/80 transition-colors flex-shrink-0 p-0.5"
          >
            <span className="typo-body">{t.agents.executions.dismiss}</span>
          </button>
        </div>

        {/* Strategy & description */}
        {notification.strategy && (
          <div className="flex items-center gap-2 typo-body">
            <RotateCw className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon} opacity-60`} />
            <span className="text-foreground">{notification.strategy}</span>
          </div>
        )}

        {/* Retry countdown + progress */}
        {isRetry && notification.retry_number != null && notification.max_retries != null && (
          <div className="flex items-center gap-3 pt-1">
            {/* Countdown */}
            {countdown > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400/60 animate-pulse" />
                <span className="typo-code text-amber-300/90">
                  {tx(t.agents.executions.retrying_in, { seconds: countdown })}
                </span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-blue-400/70 animate-spin" />
                <span className="typo-code text-blue-300/90">
                  {t.agents.executions.retrying_now}
                </span>
              </div>
            )}
            {/* Attempt badge */}
            <span className="ml-auto typo-code text-foreground px-2 py-0.5 rounded bg-secondary/30 border border-primary/10">
              {tx(t.agents.executions.attempt_of, { current: notification.retry_number!, max: notification.max_retries! })}
            </span>
          </div>
        )}

        {/* Backoff progress bar */}
        {isRetry && (notification.backoff_seconds ?? 0) > 0 && (
          <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
            <div
              className="animate-fade-in h-full rounded-full bg-amber-500/40"
            />
          </div>
        )}

        {/* Issue-created: link to healing panel */}
        {isIssue && (
          <button
            onClick={() => setSidebarSection('overview')}
            className="flex items-center gap-1.5 typo-body text-red-400/80 hover:text-red-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {t.agents.executions.view_healing_issues}
          </button>
        )}

        {/* Suggested fix */}
        {notification.suggested_fix && (
          <p className="typo-body text-foreground leading-relaxed pl-6.5">
            {notification.suggested_fix}
          </p>
        )}
      </div>
    </div>
  );
}
