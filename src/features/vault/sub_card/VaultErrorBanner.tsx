import { XCircle } from 'lucide-react';

interface VaultErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  variant?: 'inline' | 'banner';
}

export function VaultErrorBanner({ message, onDismiss, variant = 'banner' }: VaultErrorBannerProps) {
  const sizeClass = variant === 'inline' ? 'px-3 py-2.5' : 'px-4 py-3';

  return (
    <div className={`flex items-start gap-2.5 ${sizeClass} bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400`}>
      <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400/60 hover:text-red-400 text-sm font-medium shrink-0"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
