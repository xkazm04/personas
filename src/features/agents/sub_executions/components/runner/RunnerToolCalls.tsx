import { useState, useEffect } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { Clock, RotateCw, ShieldAlert, ExternalLink } from 'lucide-react';
import type { HealingEventPayload } from '../../libs/runnerHelpers';
import { useTranslation } from '@/i18n/useTranslation';

/** Inline Healing Notification Card */
export function HealingCard({
  notification,
  onDismiss,
}: {
  notification: HealingEventPayload;
  onDismiss: () => void;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const isRetry = notification.auto_fixed && notification.backoff_seconds != null;
  const isIssue = !notification.auto_fixed;

  const [countdown, setCountdown] = useState(notification.backoff_seconds ?? 0);
  useEffect(() => {
    if (!isRetry || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRetry, countdown]);

  useEffect(() => { setCountdown(notification.backoff_seconds ?? 0); }, [notification.backoff_seconds]);

  const styles = isIssue
    ? { border: 'border-red-500/25', bg: 'bg-red-500/[0.04]', icon: 'text-red-400', accent: 'text-red-400' }
    : { border: 'border-amber-500/25', bg: 'bg-amber-500/[0.04]', icon: 'text-amber-400', accent: 'text-amber-300' };

  return (
    <div
      className={`animate-fade-slide-in rounded-xl border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <div className="px-4 py-3.5 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`typo-heading ${styles.accent}`}>{notification.title}</span>
              <span className="typo-code px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/60 border border-primary/10">{notification.severity}</span>
            </div>
          </div>
          <button onClick={onDismiss} className="text-muted-foreground/50 hover:text-foreground/80 transition-colors flex-shrink-0 p-0.5">
            <span className="typo-body">{e.dismiss}</span>
          </button>
        </div>

        {notification.strategy && (
          <div className="flex items-center gap-2 typo-body">
            <RotateCw className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon} opacity-60`} />
            <span className="text-foreground/80">{notification.strategy}</span>
          </div>
        )}

        {isRetry && notification.retry_number != null && notification.max_retries != null && (
          <div className="flex items-center gap-3 pt-1">
            {countdown > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400/60 animate-pulse" />
                <span className="typo-code text-amber-300/90">{tx(e.retrying_in, { seconds: countdown })}</span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-blue-400/70 animate-spin" />
                <span className="typo-code text-blue-300/90">{e.retrying_now}</span>
              </div>
            )}
            <span className="ml-auto typo-code text-muted-foreground/60 px-2 py-0.5 rounded bg-secondary/30 border border-primary/10">
              {tx(e.attempt_of, { current: notification.retry_number, max: notification.max_retries })}
            </span>
          </div>
        )}

        {isRetry && (notification.backoff_seconds ?? 0) > 0 && (
          <div className="w-full h-1 rounded-full bg-secondary/40 overflow-hidden">
            <div className="animate-fade-in h-full rounded-full bg-amber-500/40" />
          </div>
        )}

        {isIssue && (
          <button onClick={() => setSidebarSection('overview')} className="flex items-center gap-1.5 typo-body text-red-400/80 hover:text-red-300 transition-colors">
            <ExternalLink className="w-3 h-3" />{e.view_healing_issues}
          </button>
        )}

        {notification.suggested_fix && (
          <p className="typo-body text-muted-foreground/60 leading-relaxed pl-6.5">{notification.suggested_fix}</p>
        )}
      </div>
    </div>
  );
}

/** AI Healing Counters */
export function AiHealingCounters({
  phase,
  fixCount,
  shouldRetry,
}: {
  phase: string;
  fixCount: number;
  shouldRetry: boolean;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const label = (() => {
    switch (phase) {
      case 'started': return e.healing_started;
      case 'diagnosing': return e.healing_diagnosing;
      case 'applying': return fixCount !== 1 ? tx(e.healing_applying_other, { count: fixCount }) : tx(e.healing_applying_one, { count: fixCount });
      case 'completed':
        return fixCount > 0
          ? (fixCount !== 1 ? tx(e.healing_completed_fixes_other, { count: fixCount }) : tx(e.healing_completed_fixes_one, { count: fixCount })) + (shouldRetry ? e.healing_completed_retrying : '')
          : e.healing_no_fixes;
      case 'failed': return e.healing_failed;
      default: return '';
    }
  })();

  const dotClr = phase === 'completed' ? 'bg-emerald-400' : phase === 'failed' ? 'bg-red-400' : 'bg-violet-400 animate-pulse';

  return (
    <span className="flex items-center gap-1.5 typo-heading text-muted-foreground">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClr}`} />
      {label}
    </span>
  );
}
