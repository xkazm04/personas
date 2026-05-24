import { useEffect, useMemo, useState } from 'react';
import { Layers, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { silentCatch } from '@/lib/silentCatch';
import { storeBus } from '@/lib/storeBus';

export const PERSONA_DRAG_MIME = 'application/x-personas-persona-id';

interface PersonaGroupDropRailProps {
  /**
   * Controlled filter id. `null` = all workspaces visible (no filter applied
   * to the persona list); a team id selects that chip; `'__ungrouped__'`
   * selects the trailing "No workspace" chip.
   */
  filterId?: string | null;
  /** Called when the user clicks a chip to toggle the filter. */
  onSelectFilter?: (filterId: string | null) => void;
}

/**
 * Horizontal rail of workspace (home-team) chips that serve two roles
 * (cycles 12 + 19; repointed from groups to home teams in the
 * Groups→Teams consolidation):
 *
 *   1. Drop targets for persona cards dragged from any DnD-enabled
 *      persona-overview layout — drops set the persona's `home_team_id`.
 *
 *   2. Click filters that narrow the persona list to that workspace.
 *      Selecting a chip lights it with a thicker ring + a small "clear" X
 *      that removes the filter on click. Only one filter is active at a time.
 *
 * Renders only when at least one team exists OR a persona already has a
 * home team — there's no point showing the rail in a vanilla install with
 * no workspaces configured.
 */
export function PersonaGroupDropRail({
  filterId = null,
  onSelectFilter,
}: PersonaGroupDropRailProps = {}) {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const { teams, fetchTeams } = usePipelineStore(
    useShallow((s) => ({ teams: s.teams, fetchTeams: s.fetchTeams })),
  );
  const addToast = useToastStore((s) => s.addToast);
  const [hoverId, setHoverId] = useState<string | null>(null);

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

  // Hide the rail entirely if there are no teams AND no personas with a home
  // team — it would just be visual clutter in a vanilla install.
  if (sortedTeams.length === 0 && ungroupedCount === personas.length) {
    return null;
  }

  const setHomeTeam = (personaId: string, homeTeamId: string | null) => {
    storeBus.emit('persona:set-home-team', { personaId, homeTeamId });
  };

  const handleDrop = (homeTeamId: string | null, e: React.DragEvent) => {
    e.preventDefault();
    setHoverId(null);
    const personaId = e.dataTransfer.getData(PERSONA_DRAG_MIME);
    if (!personaId) return;
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return;
    if (persona.home_team_id === homeTeamId) return; // no-op same target
    void (async () => {
      try {
        setHomeTeam(personaId, homeTeamId);
        const targetName = homeTeamId
          ? sortedTeams.find((g) => g.id === homeTeamId)?.name ?? ''
          : t.agents.persona_groups_rail.ungrouped_label;
        addToast(
          tx(t.agents.persona_groups_rail.moved_toast, {
            persona: persona.name,
            group: targetName,
          }),
          'success',
        );
      } catch (err) {
        silentCatch('features/agents/components/allPersonas/PersonaGroupDropRail:drop')(err);
      }
    })();
  };

  const dragOverProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      // Only accept the persona MIME type to avoid catching unrelated drags.
      if (e.dataTransfer.types.includes(PERSONA_DRAG_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (hoverId !== id) setHoverId(id);
      }
    },
    onDragLeave: () => {
      if (hoverId === id) setHoverId(null);
    },
  });

  /**
   * Toggle the chip's filter state. Clicking the currently-selected chip
   * clears the filter (single-chip semantics — pivot on workspace, not
   * multi-select). When no callback is wired (rail used purely as drop
   * targets), clicks are inert.
   */
  const handleChipClick = (chipId: string) => {
    if (!onSelectFilter) return;
    onSelectFilter(filterId === chipId ? null : chipId);
  };

  return (
    <div
      role="region"
      aria-label={t.agents.persona_groups_rail.aria_label}
      className="flex items-center gap-2 px-3 py-2 border-b border-primary/5 overflow-x-auto"
    >
      <span className="flex items-center gap-1.5 typo-label text-foreground/60 uppercase tracking-wider flex-shrink-0">
        <Layers className="w-3 h-3" />
        {t.agents.persona_groups_rail.heading}
      </span>
      {sortedTeams.map((g) => {
        const isHover = hoverId === g.id;
        const isActive = filterId === g.id;
        const count = countByTeam.get(g.id) ?? 0;
        const tone = isHover || isActive ? 0.7 : 0.4;
        const bgAlpha = isHover ? 0.25 : isActive ? 0.2 : 0.12;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => handleChipClick(g.id)}
            aria-pressed={isActive}
            // data attr lets non-HTML5 drag sources (constellation pointer
            // events, cycle 22) find drop targets via elementFromPoint.
            // The HTML5 onDrop path uses the regular drag handlers below.
            data-persona-drop-target={g.id}
            {...dragOverProps(g.id)}
            onDrop={(e) => handleDrop(g.id, e)}
            className={`group/chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption font-medium flex-shrink-0 transition-all cursor-pointer ${
              isHover ? 'scale-105 ring-2 ring-offset-1 ring-offset-background' : ''
            } ${isActive ? 'ring-1 ring-offset-1 ring-offset-background shadow-elevation-1' : ''}`}
            style={{
              backgroundColor: colorWithAlpha(g.color || '#6366f1', bgAlpha),
              borderColor: colorWithAlpha(g.color || '#6366f1', tone),
              color: g.color || '#6366f1',
            }}
            title={
              isActive
                ? t.agents.persona_groups_rail.filter_clear_title
                : t.agents.persona_groups_rail.chip_title
            }
          >
            <Users className="w-3 h-3" />
            <span>{g.name}</span>
            <span className="text-foreground/60 typo-label font-mono">{count}</span>
            {isActive && <X className="w-3 h-3" />}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => handleChipClick('__ungrouped__')}
        aria-pressed={filterId === '__ungrouped__'}
        data-persona-drop-target="__ungrouped__"
        {...dragOverProps('__ungrouped__')}
        onDrop={(e) => handleDrop(null, e)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/15 bg-secondary/30 typo-caption font-medium text-foreground flex-shrink-0 transition-all cursor-pointer ${
          hoverId === '__ungrouped__' ? 'scale-105 ring-2 ring-offset-1 ring-offset-background ring-foreground/40' : ''
        } ${filterId === '__ungrouped__' ? 'ring-1 ring-offset-1 ring-offset-background ring-foreground/40 shadow-elevation-1' : ''}`}
        title={
          filterId === '__ungrouped__'
            ? t.agents.persona_groups_rail.filter_clear_title
            : t.agents.persona_groups_rail.ungrouped_title
        }
      >
        <span>{t.agents.persona_groups_rail.ungrouped_label}</span>
        <span className="text-foreground/60 typo-label font-mono">{ungroupedCount}</span>
        {filterId === '__ungrouped__' && <X className="w-3 h-3" />}
      </button>
    </div>
  );
}
