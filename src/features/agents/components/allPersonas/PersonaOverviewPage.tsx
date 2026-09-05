import { useState, useCallback, useEffect, useMemo } from 'react';
import { Bot, Trash2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import Button from '@/features/shared/components/buttons/Button';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { useFavoriteAgents } from '@/hooks/agents/useFavoriteAgents';
import { DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from './viewConfig';
import { isPersonaBuilding } from './personaBuildStatus';
import { rowAccentTone, type RowAccentTone } from './PersonaOverviewBadges';
import { PersonaOverviewBatchBar } from './PersonaOverviewBatchBar';
import { PersonaOverviewToolbar } from './PersonaOverviewToolbar';
import { PersonaOverviewCardList } from './PersonaOverviewCardList';
import { PersonaGroupDropRail } from './PersonaGroupDropRail';
import { DirectorPanel } from './DirectorPanel';
import { PersonaOverviewEmptyState } from './PersonaOverviewEmptyState';
import { PersonaConfigPanel } from './PersonaConfigPanel';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { usePersonaColumns } from './PersonaOverviewColumns';
import { usePersonaListFilters } from './PersonaOverviewFilters';
import { usePersonaActions } from './PersonaOverviewActions';
import { useIsCompact } from '@/hooks/utility/interaction/useIsCompact';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { listDirectorScoreTrends } from '@/api/director';

/** Top-level view of the All-Personas page: the persona list, or the
 *  effective-config resolution table (migrated from Settings → Config). */
type PageTab = 'personas' | 'config';

/** The grid's rendering of the shared accent rule (`rowAccentTone`). */
const GRID_ACCENT_CLASS: Record<RowAccentTone, string> = {
  building: 'border-l-violet-400/60',
  draft: 'border-l-zinc-400/40',
  failing: 'border-l-red-400/60',
  degraded: 'border-l-amber-400/60',
  healthy: 'border-l-emerald-400/40',
};

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
  const [pageTab, setPageTab] = useState<PageTab>('personas');
  // Home-team filter from PersonaGroupDropRail (cycle 19; repointed to home
  // teams in the Groups→Teams consolidation). null = unfiltered; a team id
  // narrows to members; `'__ungrouped__'` narrows to personas with no home
  // team. Lives here rather than in `AgentListViewConfig` because the rail
  // owns the toggle UX and it doesn't belong in the saved view preset.
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [scoreTrendsMap, setScoreTrendsMap] = useState<Record<string, number[]>>({});
  const isMobile = useIsCompact();

  // Batched fetch of Director score trends keyed by persona id. Sample is
  // every visible persona — one round-trip, refreshes when the id set
  // changes (persona created/deleted). Empty arrays for unscored personas
  // mean the cell collapses cleanly to a "—". The quality-trend sparkline
  // this powers only ever renders as a DataGrid column in the desktop table
  // — the card-list (mobile) and config-table views never read
  // `scoreTrendsMap` — so gate the fetch on that same condition instead of
  // firing it on every personas-page mount regardless of what's showing.
  const scoreTrendsVisible = pageTab === 'personas' && !isMobile;
  const personaIdsKey = useMemo(
    () => personas.map((p) => p.id).sort().join(','),
    [personas],
  );
  useEffect(() => {
    if (!scoreTrendsVisible) return;
    const ids = personaIdsKey ? personaIdsKey.split(',') : [];
    if (ids.length === 0) {
      setScoreTrendsMap({});
      return;
    }
    let active = true;
    listDirectorScoreTrends(ids)
      .then((map) => {
        if (active) setScoreTrendsMap(map);
      })
      .catch(silentCatch('PersonaOverviewPage:scoreTrends'));
    return () => {
      active = false;
    };
  }, [personaIdsKey, scoreTrendsVisible]);

  // Draft / archived are now first-class lifecycle columns (the old
  // prompt-string heuristic is gone). A `draft` persona re-opens the build
  // flow on click; an `archived` persona is hidden from the default roster.
  const isDraft = useCallback((p: Persona) => p.lifecycle === 'draft', []);
  const isArchived = useCallback((p: Persona) => p.lifecycle === 'archived', []);
  const isBuilding = useCallback(
    (id: string) => isPersonaBuilding(id, buildPersonaId, buildPhase),
    [buildPersonaId, buildPhase],
  );

  const { data: filteredData, connectorNamesMap, allConnectorNames } = usePersonaListFilters({
    personas, view, search, triggerCounts, lastRunMap, healthMap, isBuilding, isDraft, isArchived, isFavorite,
    groupFilter,
  });

  const { modal, handleBatchDelete, handleDeleteDrafts, handleBatchArchive, handleBatchRestore, draftIds } =
    usePersonaActions({ personas, selectedIds, setSelectedIds, deletePersona, selectPersona, isDraft });

  // Whether the roster is currently showing the Archived view. Drives which
  // bulk lifecycle action (archive vs restore) the batch bar offers.
  const archivedView = view.statusFilter === 'archived';

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
        } catch (err) {
          // The partial toast reports the count; the breadcrumb keeps the cause.
          silentCatch('PersonaOverviewPage:batchMoveToGroup')(err);
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

  const handleResetFilters = useCallback(() => {
    setView(DEFAULT_VIEW_CONFIG);
    setSearch('');
    setGroupFilter(null);
  }, []);

  const columns = usePersonaColumns({
    view, setView, selectedIds, onToggleSelect: handleToggleSelect, isFavorite, toggleFavorite,
    onRowClick: handleRowClick,
    isBuilding, isDraft, healthMap, triggerCounts, lastRunMap, scoreTrendsMap, connectorNamesMap, allConnectorNames,
  });

  return (
    <ContentBox>
      <ContentHeader
        icon={<Bot className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.agents.persona_list.all_personas}
        subtitle={`${filteredData.length}${filteredData.length !== personas.length ? ` of ${personas.length}` : ''} persona${personas.length !== 1 ? 's' : ''}`}
        actions={pageTab === 'personas' ? (
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <PersonaOverviewBatchBar
              count={selectedIds.size}
              onDelete={handleBatchDelete}
              onClear={() => setSelectedIds(new Set())}
              onMoveToGroup={archivedView ? undefined : handleBatchMoveToGroup}
              onArchive={archivedView ? undefined : handleBatchArchive}
              onRestore={archivedView ? handleBatchRestore : undefined}
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
        ) : undefined}
      />
      <ContentBody>
        <div className="px-3 py-2 border-b border-primary/5 flex items-center gap-3 flex-wrap">
          <SegmentedTabs<PageTab>
            variant="segment"
            ariaLabel={t.agents.persona_list.all_personas}
            activeTab={pageTab}
            onTabChange={setPageTab}
            tabs={[
              { id: 'personas', ariaLabel: t.agents.persona_list.all_personas, label: t.agents.persona_list.all_personas },
              { id: 'config', ariaLabel: t.settings.config.title, label: t.settings.config.title },
            ]}
          />
          {pageTab === 'personas' && (
            <PersonaOverviewToolbar search={search} onSearchChange={setSearch} view={view} onViewChange={setView} />
          )}
        </div>

        {pageTab === 'config' ? (
          <PersonaConfigPanel />
        ) : (
          <>
        {/* Team filter dropdown, shared by the table and the mobile card
            list. Home-team assignment lives on the batch bar. */}
        <PersonaGroupDropRail filterId={groupFilter} onSelectFilter={setGroupFilter} />

        <DirectorPanel />

        {filteredData.length === 0 ? (
          // Zero rows has two causes with two remedies: no personas at all
          // (create one) vs. personas that the filters exclude (reset). An
          // all-archived roster with no filter counts as the second - the
          // archived toggle is the control that reveals them.
          <PersonaOverviewEmptyState
            reason={personas.length === 0 ? 'none' : 'filters'}
            onResetFilters={handleResetFilters}
            onCreate={() => setIsCreatingPersona(true)}
          />
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
        ) : (
          <DataGrid
            columns={columns}
            data={filteredData}
            getRowKey={(p) => p.id}
            onRowClick={handleRowClick}
            isRowSelected={(p) => selectedIds.has(p.id)}
            getRowAccent={(p) => GRID_ACCENT_CLASS[rowAccentTone(isBuilding(p.id), isDraft(p), healthMap[p.id])]}
            sortKey={view.sortKey}
            sortDirection={view.sortDirection}
            onSort={handleSort}
            pageSize={25}
            selectAll={allSelected}
            onSelectAll={handleSelectAll}
            density="compact"
          />
        )}
          </>
        )}
      </ContentBody>

      <ConfirmDestructiveModal {...modal} />
    </ContentBox>
  );
}
