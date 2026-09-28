import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionListDesignDecisions,
  type CompanionDesignDecision,
} from '@/api/companion';
import { ChipRow, KitButton, Tile } from '@/features/shared/components/kit';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Compact "Athena recently decided..." chip strip. Lighter cousin of
 * `DecisionLogWidget`: shows 1-5 of the most recent saved decisions
 * for a given `persona_context` as kit chips "label > choice" (no rationale,
 * no timeline). Athena emits this on `show_recent_decisions { persona_context }`
 * when she wants to remind the user of prior choices without derailing the
 * conversation into a full audit-trail render.
 *
 * Renders nothing when the fetch comes back EMPTY; this is a softer
 * surface than the full DecisionLogWidget and shouldn't hold a slot
 * with an empty state. A fetch that THREW is a different story: it used
 * to unmount the same way, so a down `companion_list_design_decisions`
 * was indistinguishable from "Athena has decided nothing here". It keeps
 * its slot as an error Tile with a retry.
 */
export function RecentDecisionsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const personaContext =
    typeof config?.persona_context === 'string'
      ? (config.persona_context as string).trim()
      : '';
  const limit =
    typeof config?.limit === 'number' ? (config.limit as number) : 3;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompanionDesignDecision[]>([]);
  const [error, setError] = useState(false);
  /** Bumped by Retry to re-run the fetch effect. */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!personaContext) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    companionListDesignDecisions(personaContext, limit)
      .then((items) => {
        if (cancelled) return;
        setRows(items);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(true);
        setLoading(false);
        silentCatch('companion_list_design_decisions:recent')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [personaContext, limit, attempt]);

  // Empty still unmounts - that is the soft-surface contract. A FAILURE does
  // not: it keeps the slot so the user knows a read did not happen.
  if (!loading && !error && rows.length === 0) {
    return null;
  }

  const heading = title || t.athena.recent_decisions_title;
  const message = t.athena.recent_decisions_error;
  return (
    <Tile
      span={span}
      title={heading}
      count={!loading && !error ? rows.length : undefined}
      actions={actions}
      footer={footer}
      testId="companion-recent-decisions-widget"
      error={error ? {
        title: <span role="alert">{message}</span>,
        markLabel: message,
        action: <KitButton onClick={retry}>{t.common.retry}</KitButton>,
      } : undefined}
    >
      <ChipRow
        label={heading}
        emptyLabel=""
        state={loading ? 'loading' : undefined}
        chips={rows.map((d) => ({
          id: d.id,
          label: (
            <span className="inline-flex items-center gap-1">
              <span className="k-quiet">{d.label}</span>
              <ChevronRight className="w-3 h-3 shrink-0 k-quiet" aria-hidden="true" />
              <span>{d.choice}</span>
            </span>
          ),
        }))}
      />
    </Tile>
  );
}
