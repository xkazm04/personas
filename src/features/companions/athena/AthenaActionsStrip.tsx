import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useCompanionStore } from './companionStore';

/**
 * Durable, in-chat ledger of everything Athena did WITHOUT asking this session
 * (today: fleet auto-decisions — `athena://fleet/auto-decided`).
 *
 * Athena communicates on exactly two dimensions: the CHAT window (full
 * information) and the ORB (quick info / decision). Auto-decisions used to
 * arrive as a toast that vanished after ten seconds and left no trace, which
 * meant an operator who looked away simply never learned what she had sent.
 * Now the ORB pulses its message reaction (the glanceable "she just acted")
 * and this strip is where the full record lives — it stays until the user
 * clears it. The authoritative audit trail is the backend `fleet_decisions`
 * table; this is its chat-side view.
 *
 * Renders nothing when Athena has not acted autonomously.
 */
export function AthenaActionsStrip() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const actions = useCompanionStore((s) => s.athenaActions);
  const clearAthenaActions = useCompanionStore((s) => s.clearAthenaActions);

  if (actions.length === 0) return null;

  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      className="rounded-card border border-primary/20 bg-primary/[0.04]"
      data-testid="athena-actions-strip"
      data-action-count={actions.length}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 typo-caption text-foreground focus-ring rounded-card text-left"
        >
          <Chevron className="w-3.5 h-3.5 shrink-0 text-foreground" />
          <Zap className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden />
          <span className="flex-1 truncate font-medium">
            {t.plugins.companion.athena_actions_title}
          </span>
          <span className="shrink-0 tabular-nums text-foreground">{actions.length}</span>
        </button>
        <button
          type="button"
          onClick={clearAthenaActions}
          data-testid="athena-actions-clear"
          className="shrink-0 typo-caption text-foreground hover:text-primary focus-ring rounded-interactive px-1.5 py-0.5"
        >
          {t.plugins.companion.athena_actions_clear}
        </button>
      </div>
      {!collapsed && (
        <ul className="px-2.5 pb-2 space-y-1.5">
          {actions.map((a) => (
            <li
              key={a.id}
              data-testid="athena-action-row"
              className="rounded-input border border-primary/15 bg-background/40 px-2.5 py-1.5"
            >
              <div className="flex items-baseline gap-2">
                <span className="typo-label font-medium text-primary truncate">
                  {a.projectLabel || t.plugins.companion.fleet_auto_decided}
                </span>
                <RelativeTime
                  timestamp={a.createdAt}
                  className="ml-auto shrink-0 typo-caption text-foreground"
                />
              </div>
              <p className="mt-0.5 typo-caption text-foreground/90 whitespace-pre-wrap break-words">
                {a.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AthenaActionsStrip;
