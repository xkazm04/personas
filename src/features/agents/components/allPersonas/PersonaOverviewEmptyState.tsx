import { Bot, Plus } from 'lucide-react';
import ScenarioEmptyState, { NoResults } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaOverviewEmptyStateProps {
  /**
   * Why the roster is empty. `filters` = personas exist but search / chips /
   * the team dropdown exclude every one of them; `none` = the install has no
   * personas at all. The two are different facts with different remedies
   * (reset vs create), so they must never render the same words.
   */
  reason: 'filters' | 'none';
  onResetFilters: () => void;
  onCreate: () => void;
}

/**
 * The roster's empty body, under the permanent chrome (tab strip, toolbar,
 * team rail). Built on the shared empty-state primitives rather than a
 * hand-rolled block so it matches every other empty surface in the app.
 */
export function PersonaOverviewEmptyState({ reason, onResetFilters, onCreate }: PersonaOverviewEmptyStateProps) {
  const { t } = useTranslation();
  if (reason === 'filters') {
    return (
      <NoResults
        title={t.agents.persona_list.no_match_filters}
        subtitle={t.agents.persona_list.adjust_filters_hint}
        resetLabel={t.agents.persona_list.clear_all_filters}
        onReset={onResetFilters}
      />
    );
  }
  return (
    <ScenarioEmptyState
      icon={Bot}
      title={t.agents.sidebar.empty}
      action={{ label: t.agents.editor_empty.create, onClick: onCreate, icon: Plus }}
    />
  );
}
