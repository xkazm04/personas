import { useAutoUpdater } from "@/hooks/utility/data/useAutoUpdater";
import { useTranslation, interpolate } from '@/i18n/useTranslation';

export default function UpdateBanner() {
  const {
    updateAvailable,
    updateInfo,
    isInstalling,
    error,
    installUpdate,
    dismissUpdate,
  } = useAutoUpdater();
  const { t } = useTranslation();

  if (!updateAvailable || !updateInfo) return null;

  // Tone the banner red when an install attempt has failed so the user can
  // see at a glance that the previous click didn't succeed.
  const tone = error
    ? "bg-red-500/10 border-b border-red-500/20"
    : "bg-accent/10 border-b border-accent/20";
  const titleTone = error ? "text-red-400" : "text-accent";

  return (
    <div className="animate-fade-slide-in overflow-hidden">
      <div className={`flex items-center gap-3 px-4 py-2 typo-body ${tone}`}>
        <span className={`font-medium shrink-0 ${titleTone}`}>
          {error
            ? t.chrome.update_install_failed
            : interpolate(t.chrome.update_available, { version: updateInfo.version })}
        </span>

        {error ? (
          <span className="text-foreground truncate">{error}</span>
        ) : (
          updateInfo.body && (
            <span className="text-foreground truncate">
              {updateInfo.body.slice(0, 120)}
              {updateInfo.body.length > 120 ? "..." : ""}
            </span>
          )
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={installUpdate}
            disabled={isInstalling}
            className="px-3 py-1 rounded-xl bg-accent text-accent-foreground typo-heading hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {isInstalling
              ? t.chrome.installing
              : error
                ? t.chrome.update_install_retry
                : t.chrome.install_and_restart}
          </button>
          <button
            onClick={dismissUpdate}
            className="p-1 rounded hover:bg-accent/10 text-foreground transition-colors"
            aria-label={t.common.dismiss}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
