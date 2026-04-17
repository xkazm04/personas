import { useEffect } from 'react';
import { AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import type { FiredAlert } from '@/lib/bindings/FiredAlert';

const SEVERITY_STYLES: Record<string, { border: string; bg: string; icon: typeof Info; iconColor: string }> = {
  info: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', icon: Info, iconColor: 'text-blue-400' },
  warning: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', icon: AlertTriangle, iconColor: 'text-amber-400' },
  critical: { border: 'border-red-500/30', bg: 'bg-red-500/10', icon: XCircle, iconColor: 'text-red-400' },
};

const AUTO_DISMISS_MS = 8000;

function AlertToast({ alert, onDismiss }: { alert: FiredAlert; onDismiss: () => void }) {
  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info!;
  const Icon = style.icon;

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`animate-fade-slide-in pointer-events-auto w-80 rounded-modal border ${style.border} ${style.bg} backdrop-blur-sm shadow-elevation-3 p-3`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-foreground truncate">{alert.rule_name}</p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">{alert.message}</p>
        </div>
        <button onClick={onDismiss} className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function AlertToastContainer() {
  const { activeToasts, dismissToast } = useOverviewStore(useShallow((s) => ({
    activeToasts: s.activeToasts,
    dismissToast: s.dismissToast,
  })));

  if (activeToasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9990] flex flex-col gap-2 pointer-events-none">
      {activeToasts.slice(0, 5).map((alert) => (
          <AlertToast key={alert.id} alert={alert} onDismiss={() => dismissToast(alert.id)} />
        ))}
    </div>
  );
}
