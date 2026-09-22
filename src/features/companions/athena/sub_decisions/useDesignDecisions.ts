import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import {
  companionListDesignDecisions,
  type CompanionDesignDecision,
} from '@/api/companion';
import { useCompanionStore } from '../companionStore';

export interface DecisionGroup {
  key: string;
  label: string;
  items: CompanionDesignDecision[];
}

/**
 * Data + interaction contract for the Decisions panel, extracted from the
 * baseline component so prototype variants share one fetch/filter/group
 * pipeline and stay purely presentational. Mirrors the baseline exactly:
 * server-side personaContext filter, auto-scope to the active build
 * intent (with "Show all" override), grouping with an "Unscoped" bucket,
 * and the empty-state launchpad that opens Athena's chat.
 */
export function useDesignDecisions() {
  const { t } = useTranslation();
  const activeBuildIntent = useSystemStore((s) => s.activeBuildIntent);
  const setActiveBuildIntent = useSystemStore((s) => s.setActiveBuildIntent);
  // Snapshot the build intent active on first mount so the scope banner
  // persists even if a new build slate later wipes activeBuildIntent.
  const initialScopedIntentRef = useRef<string | null>(activeBuildIntent);
  const [filter, setFilter] = useState(activeBuildIntent ?? '');
  const [showAllOverride, setShowAllOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompanionDesignDecision[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scopedIntent = showAllOverride ? null : initialScopedIntentRef.current;
  const showScopeBanner =
    !!scopedIntent && filter.trim() === scopedIntent.trim();

  // Server-side filter on the personaContext column. Empty filter → all
  // rows. Refetch on every filter commit so reloads stay authoritative.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const trimmed = filter.trim();
    const probe = trimmed.length > 0 ? trimmed : null;
    companionListDesignDecisions(probe, 200)
      .then((items) => {
        if (cancelled) return;
        setRows(items);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        silentCatch('companion_list_design_decisions')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Group by persona_context; decisions without one land in "Unscoped".
  const grouped = useMemo<DecisionGroup[]>(() => {
    const buckets = new Map<string, CompanionDesignDecision[]>();
    for (const row of rows) {
      const key = row.personaContext?.trim() || '_unscoped';
      const arr = buckets.get(key) ?? [];
      arr.push(row);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries()).map(([key, items]) => ({
      key,
      label:
        key === '_unscoped'
          ? t.plugins.companion.decisions_panel_unscoped
          : key,
      items,
    }));
  }, [rows, t]);

  const handleShowAll = () => {
    setShowAllOverride(true);
    setFilter('');
    setActiveBuildIntent(null);
  };

  const handleClearFilter = () => {
    setShowAllOverride(true);
    setFilter('');
  };

  const askAthenaToLogDecision = () => {
    useCompanionStore.getState().setPendingPrompt({
      text: t.plugins.companion.decisions_panel_empty_prompt,
      autoSend: true,
    });
    useCompanionStore.getState().setState('open');
  };

  return {
    filter,
    setFilter,
    rows,
    grouped,
    loading,
    error,
    scopedIntent,
    showScopeBanner,
    handleShowAll,
    handleClearFilter,
    askAthenaToLogDecision,
  };
}
