import { useState, useEffect } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { Clock, RotateCw, ShieldAlert, ExternalLink } from 'lucide-react';
import type { HealingEventPayload } from '../../runnerTypes';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import Button from '@/features/shared/components/buttons/Button';

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
    ? { border: 'border-status-error/25', bg: 'bg-status-error/[0.04]', icon: 'text-status-error', accent: 'text-status-error' }
    : { border: 'border-status-warning/25', bg: 'bg-status-warning/[0.04]', icon: 'text-status-warning', accent: 'text-status-warning' };

  return (
    <div
      className={`animate-fade-slide-in rounded-modal border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <div className="px-4 py-3.5 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`typo-heading ${styles.accent}`}>{notification.title}</span>
              <span className="inline-flex items-center typo-code text-ink-1">{tokenLabel(t, 'severity', notification.severity)}</span>
            </div>
          </div>
          <Button type="button" onClick={onDismiss} variant="ghost" size="sm" className="flex-shrink-0"><span className="typo-body">{e.dismiss}</span></Button>
        </div>

        {notification.strategy && (
          <div className="flex items-center gap-2 typo-body">
            <RotateCw className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon} opacity-60`} />
            <span className="text-ink-1">{notification.strategy}</span>
          </div>
        )}

        {isRetry && notification.retry_number != null && notification.max_retries != null && (
          <div className="flex items-center gap-3 pt-1">
            {countdown > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-status-warning" />
                <span className="typo-code text-status-warning">{tx(e.retrying_in, { seconds: countdown })}</span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-status-info animate-spin" />
                <span className="typo-code text-status-info">{e.retrying_now}</span>
              </div>
            )}
            <span className="inline-flex items-center ml-auto typo-code text-ink-1">
              {tx(e.attempt_of, { current: notification.retry_number, max: notification.max_retries })}
            </span>
          </div>
        )}

        {isRetry && (notification.backoff_seconds ?? 0) > 0 && (
          <div className="w-full h-1 rounded-full bg-surface-2 overflow-hidden">
            <div className="animate-fade-in h-full rounded-full bg-status-warning/40" />
          </div>
        )}

        {isIssue && (
          <Button
            type="button"
            onClick={() => setSidebarSection('overview')}
            variant="danger"
            size="sm"
            icon={<ExternalLink className="w-3 h-3" />}
          >{e.view_healing_issues}</Button>
        )}

        {notification.suggested_fix && (
          <p className="typo-body text-ink-1 pl-6.5">{notification.suggested_fix}</p>
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

  const dotClr = phase === 'completed' ? 'bg-status-success' : phase === 'failed' ? 'bg-status-error' : 'bg-role-agent animate-pulse';

  return (
    <span className="flex items-center gap-1.5 typo-heading text-ink-1">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClr}`} />
      {label}
    </span>
  );
}
