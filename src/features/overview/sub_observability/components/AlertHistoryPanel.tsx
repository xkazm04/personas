import { CheckCircle2, Trash2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import type { FiredAlert } from '@/lib/bindings/FiredAlert';
import { EmptyState } from '@/features/shared/components/display/EmptyState';

const SEVERITY_CONFIG: Record<string, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: '#3b82f6' },
  warning: { icon: AlertTriangle, color: '#f59e0b' },
  critical: { icon: XCircle, color: '#ef4444' },
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
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info!;
  const Icon = cfg.icon;

  return (
    <div
      className={`animate-fade-slide-in motion-reduce:opacity-100 flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
        alert.dismissed ? 'border-primary/8 bg-secondary/10 opacity-50' : 'border-primary/15 bg-secondary/20'
      }`}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: cfg.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-foreground truncate">{alert.rule_name}</span>
          <span className="text-[10px] text-muted-foreground/50">{formatTime(alert.fired_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground/70 mt-0.5">{alert.message}</p>
      </div>
      {!alert.dismissed && (
        <button
          onClick={onDismiss}
          className="p-1 text-muted-foreground/40 hover:text-emerald-400 transition-colors shrink-0"
          title="Dismiss"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function AlertHistoryPanel() {
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
          <h3 className="typo-heading text-foreground">Alert History</h3>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
              {activeCount}
            </span>
          )}
        </div>
        {alertHistory.length > 0 && (
          <button
            onClick={() => void clearAlertHistory()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-primary/15 text-muted-foreground/60 hover:text-red-400 hover:border-red-500/20 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {alertHistory.length === 0 && (
        <EmptyState variant="alerts" />
      )}

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {alertHistory.slice(0, 50).map((alert) => (
            <AlertRow key={alert.id} alert={alert} onDismiss={() => void dismissAlert(alert.id)} />
          ))}
      </div>
    </div>
  );
}
