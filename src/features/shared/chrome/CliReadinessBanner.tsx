import { useTranslation } from '@/i18n/useTranslation';
import { useCliReadiness } from '@/hooks/utility/data/useCliReadiness';

/**
 * Top-of-app gate that surfaces the Claude CLI / subscription-login prerequisite
 * BEFORE a first run fails opaquely.
 *
 * Personas executes every persona through the user's Claude Code CLI on their
 * subscription; if that CLI is missing or signed out, nothing tells the user
 * until a run dies and gets classified post-hoc. This closes cold-start friction
 * #1/#3 (ship-loop M7, value-case.md §4). The probe + state machine live in
 * `useCliReadiness` — this component is presentation only, mirroring how
 * `UpdateBanner` consumes `useAutoUpdater`.
 */
export default function CliReadinessBanner() {
  const { t } = useTranslation();
  const { status, dismissed, retry, dismiss } = useCliReadiness();

  if (status !== 'not_ready' || dismissed) return null;

  return (
    <div className="animate-fade-slide-in overflow-hidden" data-testid="cli-readiness-banner">
      <div className="flex items-center gap-3 px-4 py-2 typo-body bg-amber-500/10 border-b border-amber-500/20">
        <span className="font-medium shrink-0 text-amber-300">
          {t.chrome.cli_not_ready_title}
        </span>
        <span className="text-foreground truncate">{t.chrome.cli_not_ready_detail}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={() => void retry()}
            className="px-3 py-1 rounded-interactive bg-amber-500/20 text-amber-200 typo-heading hover:bg-amber-500/30 transition-colors"
          >
            {t.chrome.cli_not_ready_retry}
          </button>
          <button
            onClick={dismiss}
            className="p-1 rounded hover:bg-amber-500/10 text-foreground transition-colors"
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
