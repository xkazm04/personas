import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FilterOption } from './PersonaOverviewFilterHeader';

/** The sortable roster keys, in the order the compact sort menu lists them. */
export const ROSTER_SORT_KEYS = ['lastRun', 'name', 'spend', 'trust', 'triggers', 'created'] as const;

/**
 * The roster's filter and sort vocabularies with their labels, shared by the
 * grid's column headers and the compact layout's toolbar controls so the two
 * cannot offer different options.
 */
export function usePersonaFilterOptions(allConnectorNames: string[]) {
  const { t, tx } = useTranslation();
  const oc = t.agents.overview_columns;
  const st = t.agents.status;
  const pl = t.agents.persona_list;

  const status = useMemo<FilterOption[]>(() => [
    { value: 'all', label: oc.all_statuses },
    { value: 'enabled', label: oc.active_only },
    { value: 'disabled', label: oc.disabled_only },
    { value: 'building', label: oc.building_drafts },
  ], [oc]);

  const health = useMemo<FilterOption[]>(() => [
    { value: 'all', label: oc.all_health },
    { value: 'healthy', label: st.healthy },
    { value: 'degraded', label: st.degraded },
    { value: 'failing', label: st.failing },
    { value: 'dormant', label: st.dormant },
  ], [oc, st]);

  const connector = useMemo<FilterOption[]>(
    () => [{ value: 'all', label: oc.all_connectors }, ...allConnectorNames.map((n) => ({ value: n, label: n }))],
    [allConnectorNames, oc],
  );

  /** `key:direction` values, e.g. `spend:desc`. */
  const sort = useMemo<FilterOption[]>(() => {
    const column: Record<(typeof ROSTER_SORT_KEYS)[number], string> = {
      lastRun: oc.last_run, name: pl.col_persona, spend: oc.spend, trust: oc.trust,
      triggers: t.common.triggers, created: t.common.created,
    };
    return ROSTER_SORT_KEYS.flatMap((key) => (['desc', 'asc'] as const).map((dir) => ({
      value: `${key}:${dir}`,
      label: tx(pl.sort_option, { column: column[key], direction: dir === 'asc' ? pl.sort_ascending : pl.sort_descending }),
    })));
  }, [oc, pl, t.common.triggers, t.common.created, tx]);

  return { status, health, connector, sort };
}
