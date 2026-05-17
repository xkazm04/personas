import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionListDesignDecisions,
  type CompanionDesignDecision,
} from '@/api/companion';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Compact "Athena recently decided…" chip strip. Lighter cousin of
 * `DecisionLogWidget`: shows 1-5 of the most recent saved decisions
 * for a given `persona_context` as small chips (no rationale, no
 * timeline). Intended for inline "by the way, you decided X" surface
 * — Athena emits this on `show_recent_decisions { persona_context }`
 * when she wants to remind the user of prior choices without
 * derailing the conversation into a full audit-trail render.
 *
 * Renders nothing when the fetch comes back empty; this is a softer
 * surface than the full DecisionLogWidget and shouldn't hold a slot
 * with an empty state.
 */
export function RecentDecisionsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const personaContext =
    typeof config?.persona_context === 'string'
      ? (config.persona_context as string).trim()
      : '';
  const limit =
    typeof config?.limit === 'number' ? (config.limit as number) : 3;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompanionDesignDecision[]>([]);

  useEffect(() => {
    if (!personaContext) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    companionListDesignDecisions(personaContext, limit)
      .then((items) => {
        if (cancelled) return;
        setRows(items);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setLoading(false);
        silentCatch('companion_list_design_decisions:recent')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [personaContext, limit]);

  if (!loading && rows.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-card border border-fuchsia-500/25 bg-fuchsia-500/[0.03] px-3 py-2 space-y-1.5"
      data-testid="companion-recent-decisions-widget"
    >
      <header className="flex items-baseline gap-1.5 typo-caption text-fuchsia-300/75">
        <ScrollText className="w-3 h-3" />
        <span className="font-medium">
          {title || t.plugins.companion.recent_decisions_title}
        </span>
        {personaContext && (
          <span className="text-foreground/45 truncate" title={personaContext}>
            · {personaContext}
          </span>
        )}
      </header>
      {loading ? (
        <div className="flex items-center gap-1.5 typo-caption text-foreground/55 pl-4">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t.plugins.companion.recent_decisions_loading}</span>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5 pl-4">
          {rows.map((d) => (
            <li
              key={d.id}
              className="inline-flex items-baseline gap-1 rounded-interactive border border-foreground/10 bg-foreground/[0.04] px-2 py-0.5 typo-caption"
            >
              <span className="text-foreground/55">{d.label}</span>
              <ChevronRight className="w-2.5 h-2.5 text-foreground/35 shrink-0" />
              <span className="text-foreground/85">{d.choice}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
