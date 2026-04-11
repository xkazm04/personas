import { useState, useCallback, useEffect } from 'react';
import { Bot, Trash2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import Button from '@/features/shared/components/buttons/Button';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { useFavoriteAgents } from '@/hooks/agents/useFavoriteAgents';
import { ViewPresetBar, DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from './ViewPresetBar';
import { PersonaOverviewBatchBar } from './PersonaOverviewBatchBar';
import { PersonaOverviewToolbar } from './PersonaOverviewToolbar';
import { PersonaOverviewCardList } from './PersonaOverviewCardList';
import { PersonaOverviewEmptyState } from './PersonaOverviewEmptyState';
import { usePersonaColumns } from './PersonaOverviewColumns';
import { usePersonaListFilters } from './PersonaOverviewFilters';
import { usePersonaActions } from './PersonaOverviewActions';
import { useIsMobile } from './PersonaOverviewResponsive';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';

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
  const isMobile = useIsMobile();

  const isDraft = useCallback(
    (p: Persona) => p.system_prompt === DRAFT_PROMPT || !p.system_prompt?.trim(),
    [],
  );
  const isBuilding = useCallback(
    (id: string) => id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted',
    [buildPersonaId, buildPhase],
  );

  const { data: filteredData, connectorNamesMap, allConnectorNames } = usePersonaListFilters({
    personas, view, search, triggerCounts, lastRunMap, healthMap, isBuilding, isDraft, isFavorite,
  });

  const { modal, handleDelete, handleBatchDelete, handleDeleteDrafts, handleEdit, draftIds } =
    usePersonaActions({ personas, selectedIds, setSelectedIds, deletePersona, selectPersona, isDraft });

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
    onRowClick: handleRowClick, onDelete: handleDelete, onEdit: handleEdit,
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
            <ViewPresetBar currentConfig={view} onApplyConfig={setView} />
          </div>
        }
      />
      <ContentBody>
        <div className="px-3 py-2 border-b border-primary/5">
          <PersonaOverviewToolbar search={search} onSearchChange={setSearch} view={view} onViewChange={setView} />
        </div>

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
            onDelete={handleDelete}
            onEdit={handleEdit}
            isBuilding={isBuilding}
            isDraft={isDraft}
            healthMap={healthMap}
            triggerCounts={triggerCounts}
            lastRunMap={lastRunMap}
            connectorNamesMap={connectorNamesMap}
          />
        ) : (
          <DataGrid
            columns={columns}
            data={filteredData}
            getRowKey={(p) => p.id}
            getRowAccent={(p) =>
              selectedIds.has(p.id) ? 'border-l-primary/60 bg-primary/[0.03]'
                : isBuilding(p.id) ? 'border-l-violet-400/60'
                : isDraft(p) ? 'border-l-zinc-400/40'
                : healthMap[p.id]?.status === 'failing' ? 'border-l-red-400/60'
                : healthMap[p.id]?.status === 'degraded' ? 'border-l-amber-400/60'
                : 'border-l-emerald-400/40'
            }
            sortKey={view.sortKey}
            sortDirection={view.sortDirection}
            onSort={handleSort}
            pageSize={25}
            selectAll={allSelected}
            onSelectAll={handleSelectAll}
          />
        )}
      </ContentBody>

      <ConfirmDestructiveModal {...modal} />
    </ContentBox>
  );
}
