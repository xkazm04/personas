import { useEffect, useMemo } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { inLifecyclePopulation } from './rosterCount';
import Button from '@/features/shared/components/buttons/Button';
import { OptionRow } from '@/features/shared/components/forms/OptionRow';

/** Sentinel filter id for "personas with no home team". */
const NO_TEAM = '__ungrouped__';

interface PersonaGroupDropRailProps {
  /**
   * Controlled filter id. `null` = no preference (all personas);
   * a team id filters to that team; `'__ungrouped__'` filters to personas
   * with no home team.
   */
  filterId?: string | null;
  /** Called when the user picks a dropdown option. */
  onSelectFilter?: (filterId: string | null) => void;
  /**
   * Whether the roster is showing its Archived view. The counts are taken over
   * the population the roster actually lists - archived personas only in that
   * view, never in the default one - so a team's count matches the rows its
   * filter yields.
   */
  archivedView?: boolean;
}

/**
 * Compact **Teams** filter for the persona overview. A dropdown (not a chip
 * row) listing every team A→Z with its member count, plus "No preference"
 * (the default — no filter) and "No team" (personas without a home team).
 *
 * Renders only when at least one team exists OR a persona already has a home
 * team — no point showing it in a vanilla install with no teams.
 */
export function PersonaGroupDropRail({
  filterId = null,
  onSelectFilter,
  archivedView = false,
}: PersonaGroupDropRailProps = {}) {
  const { t } = useTranslation();
  const rail = t.agents.persona_groups_rail;
  const allPersonas = useAgentStore((s) => s.personas);
  const personas = useMemo(
    () => allPersonas.filter((p) => inLifecyclePopulation(p, archivedView)),
    [allPersonas, archivedView],
  );
  const { teams, fetchTeams } = usePipelineStore(
    useShallow((s) => ({ teams: s.teams, fetchTeams: s.fetchTeams })),
  );

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  const countByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of personas) {
      if (p.home_team_id) m.set(p.home_team_id, (m.get(p.home_team_id) ?? 0) + 1);
    }
    return m;
  }, [personas]);
  const ungroupedCount = useMemo(
    () => personas.filter((p) => !p.home_team_id).length,
    [personas],
  );

  // Hide entirely if there are no teams AND no personas with a home team.
  if (sortedTeams.length === 0 && ungroupedCount === personas.length) {
    return null;
  }

  type Option = { id: string | null; label: string; count: number; color: string | null };
  const options: Option[] = [
    { id: null, label: rail.filter_all, count: personas.length, color: null },
    ...sortedTeams.map((g) => ({
      id: g.id,
      label: g.name,
      count: countByTeam.get(g.id) ?? 0,
      color: g.color || '#6366f1',
    })),
    { id: NO_TEAM, label: rail.ungrouped_label, count: ungroupedCount, color: null },
  ];

  const selectedTeam =
    filterId && filterId !== NO_TEAM ? sortedTeams.find((g) => g.id === filterId) ?? null : null;
  const triggerLabel =
    filterId === NO_TEAM ? rail.ungrouped_label : selectedTeam ? selectedTeam.name : rail.filter_all;
  const triggerColor = selectedTeam?.color ?? null;

  return (
    <div
      role="region"
      aria-label={rail.aria_label}
      className="flex items-center gap-2 px-3 py-2 border-b border-hair"
    >
      <span className="flex items-center gap-1.5 typo-label text-ink-1 flex-shrink-0">
        <Users className="w-3 h-3" />
        {rail.heading}
      </span>
      <Listbox
        className="min-w-[200px] max-w-[280px]"
        ariaLabel={rail.aria_label}
        itemCount={options.length}
        onSelectFocused={(i) => {
          const opt = options[i];
          if (opt) onSelectFilter?.(opt.id);
        }}
        renderTrigger={({ isOpen, toggle }) => (
          <Button
            type="button"
            onClick={toggle}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            variant="secondary"
            size="sm"
            className="w-full"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
            {triggerColor && (
            <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: triggerColor }}
            />
            )}
            <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown
            className={`w-3.5 h-3.5 flex-shrink-0 text-ink-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </Button>
        )}
      >
        {({ close, focusIndex }) => (
          <ul className="py-1 max-h-72 overflow-y-auto">
            {options.map((opt, i) => {
              const isSelected = (opt.id ?? null) === (filterId ?? null);
              const isFocus = i === focusIndex;
              return (
                <li key={opt.id ?? '__all__'}>
                  <OptionRow
                    role="option"
                    selected={isSelected}
                    onSelect={() => {
                      onSelectFilter?.(opt.id);
                      close();
                    }}
                    className={isFocus ? 'bg-surface-2' : ''}
                    meta={opt.count}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {opt.color && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: opt.color }}
                        />
                      )}
                      <span className="truncate">{opt.label}</span>
                    </span>
                  </OptionRow>
                </li>
              );
            })}
          </ul>
        )}
      </Listbox>
    </div>
  );
}
