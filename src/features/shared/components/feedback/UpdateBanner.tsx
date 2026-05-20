import { useState } from "react";
import { useAutoUpdater } from "@/hooks/utility/data/useAutoUpdater";
import { useOverviewStore } from "@/stores/overviewStore";
import { useTranslation, interpolate } from '@/i18n/useTranslation';

export default function UpdateBanner() {
  const {
    updateAvailable,
    updateInfo,
    isInstalling,
    downloadProgress,
    error,
    installUpdate,
    dismissUpdate,
  } = useAutoUpdater();
  const { t } = useTranslation();
  // Number of personas mid-execution. Installing restarts the app, which
  // silently kills running runs — so warn before that happens.
  const runningCount = useOverviewStore(
    (s) => Object.values(s.activeProcesses).filter((p) => p.status === "running").length,
  );
  const [confirmPending, setConfirmPending] = useState(false);

  if (!updateAvailable || !updateInfo) return null;

  const handleInstallClick = () => {
    if (runningCount > 0) {
      setConfirmPending(true);
    } else {
      void installUpdate();
    }
  };

  const confirmInstall = () => {
    setConfirmPending(false);
    void installUpdate();
  };

  const installLabel = isInstalling
    ? downloadProgress !== null
      ? interpolate(t.chrome.installing_progress, { percent: downloadProgress })
      : t.chrome.installing
    : error
      ? t.chrome.update_install_retry
      : t.chrome.install_and_restart;

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
            onClick={handleInstallClick}
            disabled={isInstalling}
            className="px-3 py-1 rounded-xl bg-accent text-accent-foreground typo-heading hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {installLabel}
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

      {confirmPending && !isInstalling && (
        <div className="flex items-center gap-3 px-4 py-2 typo-caption bg-amber-500/10 border-b border-amber-500/20">
          <span className="text-amber-300/90 shrink min-w-0">
            {interpolate(t.chrome.update_jobs_running_warning, { count: runningCount })}
          </span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={confirmInstall}
              className="px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-200 typo-heading hover:bg-amber-500/30 transition-colors"
            >
              {t.chrome.update_install_anyway}
            </button>
            <button
              onClick={() => setConfirmPending(false)}
              className="px-2.5 py-1 rounded-xl text-foreground typo-heading hover:bg-accent/10 transition-colors"
            >
              {t.chrome.update_keep_working}
            </button>
          </div>
        </div>
      )}

      {isInstalling && downloadProgress !== null && (
        <div
          className="h-0.5 bg-accent/15"
          role="progressbar"
          aria-valuenow={downloadProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t.chrome.installing}
        >
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
