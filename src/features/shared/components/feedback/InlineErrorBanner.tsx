import { type ReactNode } from 'react';
import { AlertTriangle, Info, AlertCircle, X, RefreshCw } from 'lucide-react';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { useTranslation } from '@/i18n/useTranslation';

export type BannerSeverity = 'info' | 'warning' | 'error';

interface InlineErrorBannerProps {
  severity?: BannerSeverity;
  title?: string;
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Extra content rendered in the action slot (after retry/dismiss buttons). */
  actions?: ReactNode;
  /** Use tighter padding for inline/embedded contexts. */
  compact?: boolean;
  className?: string;
}

const TIER = {
  info: {
    tokens: STATUS_PALETTE.info,
    Icon: Info,
    titleText: 'text-blue-300',
    bodyText: 'text-blue-400/70',
    buttonBg: 'bg-blue-500/15 border-blue-500/25 text-blue-300 hover:bg-blue-500/25',
    dismissText: 'text-blue-400/60 hover:text-blue-300',
  },
  warning: {
    tokens: STATUS_PALETTE.warning,
    Icon: AlertCircle,
    titleText: 'text-amber-300',
    bodyText: 'text-amber-400/70',
    buttonBg: 'bg-amber-500/15 border-amber-500/25 text-amber-300 hover:bg-amber-500/25',
    dismissText: 'text-amber-400/60 hover:text-amber-300',
  },
  error: {
    tokens: STATUS_PALETTE.error,
    Icon: AlertTriangle,
    titleText: 'text-red-300',
    bodyText: 'text-red-400/70',
    buttonBg: 'bg-red-500/15 border-red-500/25 text-red-300 hover:bg-red-500/25',
    dismissText: 'text-red-400/60 hover:text-red-300',
  },
} as const;

export function InlineErrorBanner({
  severity = 'error',
  title,
  message,
  onDismiss,
  onRetry,
  actions,
  compact = false,
  className = '',
}: InlineErrorBannerProps) {
  const { t } = useTranslation();
  const tier = TIER[severity];
  const { Icon, tokens } = tier;

  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      aria-live={severity === 'error' ? 'assertive' : 'polite'}
      className={`rounded-xl border ${tokens.border} ${tokens.bg} ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 ${tokens.text} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          {title && <p className={`typo-heading ${tier.titleText}`}>{title}</p>}
          <p className={`text-sm ${tier.bodyText}${title ? ' mt-0.5' : ''}`}>{message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={`flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-xl border ${tier.buttonBg} transition-colors cursor-pointer shrink-0`}
          >
            <RefreshCw className="w-3 h-3" /> {t.common.retry}
          </button>
        )}
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t.common.dismiss}
            className={`${tier.dismissText} transition-colors cursor-pointer shrink-0`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
