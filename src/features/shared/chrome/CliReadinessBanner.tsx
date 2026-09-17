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
 *
 * The two failures carry DIFFERENT guidance: a missing binary has to be
 * installed, a signed-out CLI has to be signed in. They used to share one
 * install-and-sign-in wall, which sent a signed-out user to install software
 * they already had.
 */
export default function CliReadinessBanner() {
  const { t } = useTranslation();
  const { status, dismissed, retry, dismiss } = useCliReadiness();

  if ((status !== 'missing_binary' && status !== 'no_session') || dismissed) return null;

  const copy = status === 'missing_binary'
    ? { title: t.chrome.cli_missing_title, detail: t.chrome.cli_missing_detail }
    : { title: t.chrome.cli_signed_out_title, detail: t.chrome.cli_signed_out_detail };

  return (
    <div className="animate-fade-slide-in overflow-hidden" data-testid="cli-readiness-banner" data-cli-status={status}>
      <div className="flex items-center gap-3 px-4 py-2 typo-body bg-amber-500/10 border-b border-amber-500/20">
        <span className="font-medium shrink-0 text-amber-300">
          {copy.title}
        </span>
        <span className="text-foreground truncate">{copy.detail}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void retry()}
            className="px-3 py-1 rounded-interactive bg-amber-500/20 text-amber-200 typo-heading hover:bg-amber-500/30 transition-colors"
          >
            {t.chrome.cli_not_ready_retry}
          </button>
          <button
            type="button"
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
