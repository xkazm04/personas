import { useState, useCallback, useEffect, useMemo } from 'react';
import { Bot, Grid3x3, Orbit, Rows3, Trash2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import Button from '@/features/shared/components/buttons/Button';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { useFavoriteAgents } from '@/hooks/agents/useFavoriteAgents';
import { DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from './ViewPresetBar';
import { PersonaOverviewBatchBar } from './PersonaOverviewBatchBar';
import { PersonaOverviewToolbar } from './PersonaOverviewToolbar';
import { PersonaOverviewCardList } from './PersonaOverviewCardList';
import { PersonaGroupDropRail } from './PersonaGroupDropRail';
import { DirectorBrainToggle } from './DirectorBrainToggle';
import { PersonaOverviewEmptyState } from './PersonaOverviewEmptyState';
import { PersonaOverviewVariantGrid } from './PersonaOverviewVariantGrid';
import { PersonaOverviewVariantConstellation } from './PersonaOverviewVariantConstellation';
import { usePersonaColumns } from './PersonaOverviewColumns';
import { usePersonaListFilters } from './PersonaOverviewFilters';
import { usePersonaActions } from './PersonaOverviewActions';
import { useIsMobile } from './PersonaOverviewResponsive';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { debtText } from '@/i18n/DebtText';



type LayoutVariant = 'baseline' | 'grid' | 'constellation';

const LAYOUT_TABS: { id: LayoutVariant; label: string; sub: string; Icon: typeof Rows3 }[] = [
  { id: 'baseline', label: 'Table', sub: 'data-dense rows with sortable columns', Icon: Rows3 },
  { id: 'grid', label: 'Grid', sub: 'uniform icon-first cards', Icon: Grid3x3 },
  { id: 'constellation', label: 'Constellation', sub: 'spatial fleet map by last run', Icon: Orbit },
];

const LAYOUT_STORAGE_KEY = 'persona-overview:layout';

function readPersistedLayout(): LayoutVariant {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v === 'baseline' || v === 'grid' || v === 'constellation') return v;
  } catch (err) { silentCatch("features/agents/components/allPersonas/PersonaOverviewPage:catch1")(err); }
  return 'baseline';
}

const DRAFT_PROMPT = 'You are a helpful AI assistant.';

export default function PersonaOverviewPage() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);
  const triggerCounts = useAgentStore((s) => s.personaTriggerCounts);
  const lastRunMap = useAgentStore((s) => s.personaLastRun);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);
  const { toggleFavorite, isFavorite } = useFavoriteAgents();

  const [view, setView] = useState<AgentListViewConfig>(DEFAULT_VIEW_CONFIG);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<LayoutVariant>(readPersistedLayout);
  // Home-team filter from PersonaGroupDropRail (cycle 19; repointed to home
  // teams in the Groups→Teams consolidation). null = unfiltered; a team id
  // narrows to members; `'__ungrouped__'` narrows to personas with no home
  // team. Lives here rather than in `AgentListViewConfig` because the rail
  // owns the toggle UX and it doesn't belong in the saved view preset.
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, layout); } catch (err) { silentCatch("features/agents/components/allPersonas/PersonaOverviewPage:catch2")(err); }
  }, [layout]);

  // A persona is "draft" only if it never finished a build (no design result
  // was ever saved) AND still carries the placeholder / empty system prompt.
  // A completed build always populates last_design_result, so fully-built
  // personas route to the editor even if their prompt coincidentally looks
  // like the placeholder.
  const isDraft = useCallback(
    (p: Persona) =>
      !p.last_design_result && (p.system_prompt === DRAFT_PROMPT || !p.system_prompt?.trim()),
    [],
  );
  const isBuilding = useCallback(
    (id: string) => id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted',
    [buildPersonaId, buildPhase],
  );

  const { data: filteredData, connectorNamesMap, allConnectorNames } = usePersonaListFilters({
    personas, view, search, triggerCounts, lastRunMap, healthMap, isBuilding, isDraft, isFavorite,
    groupFilter,
  });

  const { modal, handleBatchDelete, handleDeleteDrafts, draftIds } =
    usePersonaActions({ personas, selectedIds, setSelectedIds, deletePersona, selectPersona, isDraft });

  // Cycle 21 — bulk-set the home team of the selected personas (or null to
  // clear). Repointed from groups to home teams in the Groups→Teams
  // consolidation; emits the `persona:set-home-team` storeBus event the
  // agentStore listens for. We do the writes sequentially rather than in
  // parallel to keep the storeBus event order deterministic; for typical N
  // (≤ a few dozen) this is well under 1s.
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const teams = usePipelineStore((s) => s.teams);
  const teamNameById = useMemo(
    () => new Map(teams.map((g) => [g.id, g.name])),
    [teams],
  );
  const addToast = useToastStore((s) => s.addToast);
  const handleBatchMoveToGroup = useCallback(
    async (homeTeamId: string | null) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await applyPersonaOp(id, { kind: 'SetHomeTeam', home_team_id: homeTeamId });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      // Selection stays so the user can do a follow-up bulk action; the rail
      // and DataGrid auto-rerender from the agentStore update.
      const groupName = homeTeamId
        ? teamNameById.get(homeTeamId) ?? ''
        : t.agents.persona_list.batch_move_to_ungrouped;
      if (failed === 0) {
        addToast(
          tx(t.agents.persona_list.batch_moved_success, { count: ok, group: groupName }),
          'success',
        );
      } else {
        addToast(
          tx(t.agents.persona_list.batch_moved_partial, { ok, failed, group: groupName }),
          'error',
        );
      }
    },
    [selectedIds, applyPersonaOp, addToast, t, tx, teamNameById],
  );

  // Drop selections that no longer match the filtered data
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(filteredData.map((p) => p.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredData]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = filteredData.length > 0 && filteredData.every((p) => selectedIds.has(p.id));
  const handleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredData.map((p) => p.id)));
  }, [allSelected, filteredData]);

  const handleRowClick = useCallback(
    (p: Persona) => {
      if (isBuilding(p.id) || isDraft(p)) {
        useAgentStore.setState({ buildPersonaId: p.id });
        setIsCreatingPersona(true);
      } else {
        selectPersona(p.id);
      }
    },
    [isBuilding, isDraft, selectPersona, setIsCreatingPersona],
  );

  const handleSort = useCallback((key: string) => {
    setView((prev) => prev.sortKey === key
      ? { ...prev, sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc' }
      : { ...prev, sortKey: key, sortDirection: 'asc' });
  }, []);

  const hasActiveFilter =
    view.statusFilter !== 'all' ||
    view.healthFilter !== 'all' ||
    view.connectorFilter !== 'all' ||
    view.favoriteOnly ||
    search.trim().length > 0;

  const handleResetFilters = useCallback(() => {
    setView(DEFAULT_VIEW_CONFIG);
    setSearch('');
  }, []);

  const columns = usePersonaColumns({
    view, setView, selectedIds, onToggleSelect: handleToggleSelect, isFavorite, toggleFavorite,
    onRowClick: handleRowClick,
    isBuilding, isDraft, healthMap, triggerCounts, lastRunMap, connectorNamesMap, allConnectorNames,
  });

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.agents.persona_list.all_personas}
        subtitle={`${filteredData.length}${filteredData.length !== personas.length ? ` of ${personas.length}` : ''} persona${personas.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <PersonaOverviewBatchBar
              count={selectedIds.size}
              onDelete={handleBatchDelete}
              onClear={() => setSelectedIds(new Set())}
              onMoveToGroup={handleBatchMoveToGroup}
            />
            {draftIds.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={handleDeleteDrafts}
              >
                {tx(t.agents.persona_list.delete_drafts_btn, { count: draftIds.length })}
              </Button>
            )}
          </div>
        }
      />
      <ContentBody>
        <div className="px-3 py-2 border-b border-primary/5 flex items-center justify-between gap-3 flex-wrap">
          <PersonaOverviewToolbar search={search} onSearchChange={setSearch} view={view} onViewChange={setView} />
          {!isMobile && <LayoutModeTabs value={layout} onChange={setLayout} />}
        </div>
        {/* Drop rail now renders in every layout (cycle 22 added
            pointer-event DnD to constellation). Chips serve three roles:
            click → filter, HTML5 drop (grid/baseline/card-list), and
            pointer-event drop via elementFromPoint (constellation). The
            data-persona-drop-target attr on each chip is how the
            constellation drag locates them on pointerup. */}
        <PersonaGroupDropRail filterId={groupFilter} onSelectFilter={setGroupFilter} />

        <DirectorBrainToggle />

        {filteredData.length === 0 && hasActiveFilter ? (
          <PersonaOverviewEmptyState onResetFilters={handleResetFilters} />
        ) : isMobile ? (
          <PersonaOverviewCardList
            data={filteredData}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            onRowClick={handleRowClick}
            isDraft={isDraft}
            connectorNamesMap={connectorNamesMap}
          />
        ) : layout === 'grid' ? (
          <PersonaOverviewVariantGrid
            data={filteredData}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            onRowClick={handleRowClick}
            isDraft={isDraft}
            connectorNamesMap={connectorNamesMap}
          />
        ) : layout === 'constellation' ? (
          <PersonaOverviewVariantConstellation
            data={filteredData}
            triggerCounts={triggerCounts}
            lastRunMap={lastRunMap}
            healthMap={healthMap}
            connectorNamesMap={connectorNamesMap}
            isBuilding={isBuilding}
            isDraft={isDraft}
            onRowClick={handleRowClick}
          />
        ) : (
          <DataGrid
            columns={columns}
            data={filteredData}
            getRowKey={(p) => p.id}
            onRowClick={handleRowClick}
            isRowSelected={(p) => selectedIds.has(p.id)}
            getRowAccent={(p) =>
              isBuilding(p.id) ? 'border-l-violet-400/60'
                : isDraft(p) ? 'border-l-zinc-400/40'
                : healthMap[p.id]?.status === 'failing' ? 'border-l-red-400/60'
                : healthMap[p.id]?.status === 'degraded' ? 'border-l-amber-400/60'
                : 'border-l-emerald-400/40'
            }
            getRowProps={(p) => ({
              // Drag source for persona → group rail (cycle 16; baseline
              // DataGrid layout). Identical contract to grid + card-list
              // layouts: same MIME, same 'move' effect, same drop targets.
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.setData('application/x-personas-persona-id', p.id);
                e.dataTransfer.effectAllowed = 'move';
              },
            })}
            sortKey={view.sortKey}
            sortDirection={view.sortDirection}
            onSort={handleSort}
            pageSize={25}
            selectAll={allSelected}
            onSelectAll={handleSelectAll}
            density="compact"
          />
        )}
      </ContentBody>

      <ConfirmDestructiveModal {...modal} />
    </ContentBox>
  );
}

/* Segmented control that switches the persona list between its three
 * production layouts: Table (data-dense default), Grid (icon-first
 * cards), Constellation (spatial fleet map). User choice persists to
 * localStorage so the selection survives reloads. */
function LayoutModeTabs({
  value,
  onChange,
}: {
  value: LayoutVariant;
  onChange: (v: LayoutVariant) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={debtText("auto_persona_list_layout_f3abe698")}
      className="inline-flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/40 border border-primary/10"
    >
      {LAYOUT_TABS.map(({ id, label, sub, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            onClick={() => onChange(id)}
            title={sub}
            aria-selected={active}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input text-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
              active
                ? 'bg-primary/15 text-primary shadow-sm'
                : 'text-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
