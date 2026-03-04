interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="px-6 py-3 border-t border-red-500/20 bg-red-500/10 text-red-400 text-sm flex items-start justify-between gap-3"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-red-300/90 hover:text-red-200 transition-colors cursor-pointer"
      >
        x
      </button>
    </div>
  );
}
