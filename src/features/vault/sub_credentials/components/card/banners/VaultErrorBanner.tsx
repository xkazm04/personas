import { XCircle } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';

interface VaultErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  variant?: 'inline' | 'banner';
}

export function VaultErrorBanner({ message, onDismiss, variant = 'banner' }: VaultErrorBannerProps) {
  const sizeClass = variant === 'inline' ? 'px-3 py-2.5' : 'px-4 py-3';

  return (
    <div role="alert" aria-live="assertive" className={`flex items-start gap-2.5 ${sizeClass} ${SEVERITY_STYLES.error.border} ${SEVERITY_STYLES.error.bg} rounded-modal typo-body ${SEVERITY_STYLES.error.text}`}>
      <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400/60 hover:text-red-400 typo-body font-medium shrink-0"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
