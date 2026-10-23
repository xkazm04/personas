import { type ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info, RefreshCw, X } from 'lucide-react';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Shared primitive underneath InlineErrorBanner (a thin wrapper kept for its
 * 24 importers): role alert/status + severity-coloured bordered card +
 * leading icon + title/message/cause + optional retry + `actions` slot +
 * optional dismiss. This is the single source of truth for that shape and
 * its per-severity config map.
 */

export type BannerSeverity = 'error' | 'warning' | 'info';

export interface BannerProps {
  severity?: BannerSeverity;
  title?: string;
  /** Plain-English sentence explaining what happened. */
  message: string;
  /** Likely cause of the problem (rendered under the message, in the accent color). */
  cause?: string;
  /** Simple retry button (fixed icon + translated "Retry" label). */
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Extra content rendered after the retry button. */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
  /** Force role="alert"/aria-live="assertive" regardless of severity. Default: only for severity === 'error'. */
  alwaysAlert?: boolean;
  /** Render the message body in neutral foreground instead of the severity accent color. */
  neutralBody?: boolean;
}

const SEVERITY_CONFIG = {
  error: {
    tokens: STATUS_PALETTE.error,
    Icon: AlertTriangle,
    titleText: 'text-red-300',
    accentText: 'text-red-400/70',
    buttonBg: 'bg-red-500/15 border-red-500/25 text-red-300 hover:bg-red-500/25',
    dismissText: 'text-red-400/60 hover:text-red-300',
  },
  warning: {
    tokens: STATUS_PALETTE.warning,
    Icon: AlertCircle,
    titleText: 'text-amber-300',
    accentText: 'text-amber-400/70',
    buttonBg: 'bg-amber-500/15 border-amber-500/25 text-amber-300 hover:bg-amber-500/25',
    dismissText: 'text-amber-400/60 hover:text-amber-300',
  },
  info: {
    tokens: STATUS_PALETTE.info,
    Icon: Info,
    titleText: 'text-blue-300',
    accentText: 'text-blue-400/70',
    buttonBg: 'bg-blue-500/15 border-blue-500/25 text-blue-300 hover:bg-blue-500/25',
    dismissText: 'text-blue-400/60 hover:text-blue-300',
  },
} as const;

export function Banner({
  severity = 'error',
  title,
  message,
  cause,
  onRetry,
  onDismiss,
  actions,
  compact = false,
  className = '',
  alwaysAlert = false,
  neutralBody = false,
}: BannerProps) {
  const { t } = useTranslation();
  const config = SEVERITY_CONFIG[severity];
  const { Icon, tokens } = config;
  const isAlert = alwaysAlert || severity === 'error';
  const bodyText = neutralBody ? 'text-foreground' : config.accentText;

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      className={`rounded-xl border ${tokens.border} ${tokens.bg} ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 ${tokens.text} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          {title && <p className={`typo-heading ${config.titleText}`}>{title}</p>}
          <p className={`typo-body ${bodyText}${title ? ' mt-0.5' : ''}`}>{message}</p>
          {cause && <p className={`typo-caption ${config.accentText} mt-1`}>{cause}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={`flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-xl border ${config.buttonBg} transition-colors cursor-pointer shrink-0`}
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
            className={`${config.dismissText} transition-colors cursor-pointer shrink-0`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
