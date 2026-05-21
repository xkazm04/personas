import { CheckCircle2, Trash2 } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import type { FiredAlert } from '@/lib/bindings/FiredAlert';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { StatusDot, type SeverityState } from '@/features/shared/components/display/StatusDot';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';


const SEVERITY_BY_KEY: Record<string, SeverityState> = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function AlertRow({ alert, onDismiss }: { alert: FiredAlert; onDismiss: () => void }) {
  const { t } = useTranslation();
  const severity = SEVERITY_BY_KEY[alert.severity] ?? 'info';

  return (
    <div
      className={`animate-fade-slide-in motion-reduce:opacity-100 flex items-start gap-2.5 px-3 py-2.5 rounded-modal border transition-colors ${
        alert.dismissed ? 'border-primary/8 bg-secondary/10 opacity-50' : 'border-primary/15 bg-secondary/20'
      }`}
    >
      <span className="mt-0.5 shrink-0">
        <StatusDot kind="severity" state={severity} label={alert.severity} size="sm" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-foreground truncate">{alert.rule_name}</span>
          <span className="text-[10px] text-foreground">{formatTime(alert.fired_at)}</span>
        </div>
        <p className="typo-caption text-foreground mt-0.5">{alert.message}</p>
      </div>
      {!alert.dismissed && (
        <button
          onClick={onDismiss}
          className="p-1 text-foreground hover:text-emerald-400 transition-colors shrink-0"
          title={t.common.dismiss}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function AlertHistoryPanel() {
  const { t } = useTranslation();
  const {
    alertHistory, dismissAlert, clearAlertHistory,
  } = useOverviewStore(useShallow((s) => ({
    alertHistory: s.alertHistory,
    dismissAlert: s.dismissAlert,
    clearAlertHistory: s.clearAlertHistory,
  })));

  const activeCount = alertHistory.filter(a => !a.dismissed).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="typo-heading text-foreground"><DebtText k="auto_alert_history_50da1d4f" /></h3>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
              {activeCount}
            </span>
          )}
        </div>
        {alertHistory.length > 0 && (
          <button
            onClick={() => { clearAlertHistory().catch(() => {}); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:text-red-400 hover:border-red-500/20 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {alertHistory.length === 0 && (
        <EmptyState variant="alerts" heading={t.overview.emptyState.alerts_title} description={t.overview.emptyState.alerts_subtitle} />
      )}

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {alertHistory.slice(0, 50).map((alert) => (
            <AlertRow key={alert.id} alert={alert} onDismiss={() => { dismissAlert(alert.id).catch(() => {}); }} />
          ))}
      </div>
    </div>
  );
}
