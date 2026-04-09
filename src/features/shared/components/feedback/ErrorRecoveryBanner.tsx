import { type ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info, WifiOff, Settings, RefreshCw } from 'lucide-react';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';

export type RecoverySeverity = 'error' | 'warning' | 'info';
export type RecoveryAction = 'retry' | 'check_connection' | 'open_settings';

interface ErrorRecoveryBannerProps {
  severity?: RecoverySeverity;
  /** Plain-English sentence explaining what happened. */
  message: string;
  /** Likely cause of the problem. */
  cause?: string;
  /** Primary recovery action type. */
  actionType?: RecoveryAction;
  /** Label override for the action button. */
  actionLabel?: string;
  /** Handler for the primary action button. */
  onAction?: () => void;
  onDismiss?: () => void;
  /** Extra content rendered after the action button. */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}

const SEVERITY_CONFIG = {
  error: {
    tokens: STATUS_PALETTE.error,
    Icon: AlertTriangle,
    titleText: 'text-red-300',
    bodyText: 'text-foreground',
    causeText: 'text-red-400/70',
    buttonBg: 'bg-red-500/15 border-red-500/25 text-red-300 hover:bg-red-500/25',
  },
  warning: {
    tokens: STATUS_PALETTE.warning,
    Icon: AlertCircle,
    titleText: 'text-amber-300',
    bodyText: 'text-foreground',
    causeText: 'text-amber-400/70',
    buttonBg: 'bg-amber-500/15 border-amber-500/25 text-amber-300 hover:bg-amber-500/25',
  },
  info: {
    tokens: STATUS_PALETTE.info,
    Icon: Info,
    titleText: 'text-blue-300',
    bodyText: 'text-foreground',
    causeText: 'text-blue-400/70',
    buttonBg: 'bg-blue-500/15 border-blue-500/25 text-blue-300 hover:bg-blue-500/25',
  },
} as const;

const ACTION_DEFAULTS: Record<RecoveryAction, { icon: typeof RefreshCw; label: string }> = {
  retry: { icon: RefreshCw, label: 'Retry' },
  check_connection: { icon: WifiOff, label: 'Check Connection' },
  open_settings: { icon: Settings, label: 'Open Settings' },
};

export function ErrorRecoveryBanner({
  severity = 'error',
  message,
  cause,
  actionType,
  actionLabel,
  onAction,
  onDismiss,
  actions,
  compact = false,
  className = '',
}: ErrorRecoveryBannerProps) {
  const config = SEVERITY_CONFIG[severity];
  const { Icon, tokens } = config;
  const actionConfig = actionType ? ACTION_DEFAULTS[actionType] : null;
  const ActionIcon = actionConfig?.icon ?? RefreshCw;
  const finalLabel = actionLabel ?? actionConfig?.label ?? 'Retry';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-xl border ${tokens.border} ${tokens.bg} ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 ${tokens.text} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <p className={`typo-body ${config.bodyText}`}>{message}</p>
          {cause && <p className={`typo-caption ${config.causeText} mt-1`}>{cause}</p>}
        </div>
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            className={`flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-xl border ${config.buttonBg} transition-colors cursor-pointer shrink-0`}
          >
            <ActionIcon className="w-3 h-3" /> {finalLabel}
          </button>
        )}
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className={`${tokens.text} opacity-60 hover:opacity-100 transition-colors cursor-pointer shrink-0`}
          >
            <span className="sr-only">Dismiss</span>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
