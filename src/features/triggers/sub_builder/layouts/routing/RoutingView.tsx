/**
 * RoutingView — the consolidated Dispatch console (now the only view).
 *
 * Event-centric layout: events grouped into category panels (GroupPanel),
 * each row rendered with the SOURCE → EVENT → LISTENERS spine (EventRow).
 * Pulse dots on rows carry "live" signal; no top ticker, no live counter.
 *
 * This file is a pure orchestrator — it wires data (useRoutingState),
 * filters (useRoutingFilters), UI chrome (Toolbar + GroupPanel), and the
 * three shared modals. All row / panel / stack details live in siblings.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { findTemplateByEventType } from '../../libs/eventCanvasConstants';
import { AddPersonaModal } from '../AddPersonaModal';
import { DisconnectDialog } from '../DisconnectDialog';
import { RenameEventDialog } from '../RenameEventDialog';
import { useRoutingState } from '../useRoutingState';
import { buildActivityMap } from './activity';
import { GroupPanel } from './GroupPanel';
import { Toolbar } from './Toolbar';
import { useRoutingFilters } from './useRoutingFilters';

interface Props {
  initialTriggers: PersonaTrigger[];
  initialEvents: PersonaEvent[];
  personas: Persona[];
  groups: PersonaGroup[];
}

export function RoutingView(props: Props) {
  const state = useRoutingState(props);
  const {
    personas, groups, rows, recentEvents, personaMap,
    reload, isBackfilling, handleInitializeHandlers,
    addPersonaForEvent, setAddPersonaForEvent,
    disconnectTarget, setDisconnectTarget,
    renameTarget, setRenameTarget,
    handleAddPersona, handleRename, handleDisconnect,
    connectedPersonaIdsForRow,
  } = state;

  const filters = useRoutingFilters({ rows, recentEvents, personaMap });
  const activity = buildActivityMap(recentEvents);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  const toggleGroup = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleRow = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <Toolbar
        search={filters.search} onSearchChange={filters.setSearch}
        sourceFilter={filters.sourceFilter} onSourceFilterChange={filters.setSourceFilter}
        sourceOptions={filters.sourceOptions}
        activeOnly={filters.activeOnly} onActiveOnlyChange={filters.setActiveOnly}
        showUnconnected={filters.showUnconnected} onShowUnconnectedChange={filters.setShowUnconnected}
        visibleClasses={filters.visibleClasses} onToggleClass={filters.toggleClass}
        classCounts={filters.classCounts} unconnectedCount={filters.unconnectedCount}
        sortMode={filters.sortMode} onSortModeChange={filters.setSortMode}
        visibleCount={filters.visibleRows.length}
        totalConnections={filters.totalConnections}
        isBackfilling={isBackfilling}
        onBackfill={() => void handleInitializeHandlers()}
        onReload={() => void reload()}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={filters.filterKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="space-y-3"
          >
            {filters.groupsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Radio className="w-8 h-8 text-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-foreground/60">No events match this filter.</p>
              </div>
            ) : filters.groupsList.map(group => (
              <GroupPanel
                key={group.id}
                group={group}
                activity={activity}
                collapsed={collapsed.has(group.id)}
                onToggleCollapse={() => toggleGroup(group.id)}
                expandedRows={expandedRows}
                onToggleRow={toggleRow}
                onAdd={(row) => setAddPersonaForEvent({ eventType: row.eventType })}
                onRename={(row) => setRenameTarget({
                  eventType: row.eventType,
                  reserved: row.sourceClass === 'common',
                  sources: row.sourcePersonas.length,
                  connections: row.connections.length,
                })}
                onDisconnect={(conn, row) => setDisconnectTarget({
                  connection: conn,
                  personaName: conn.persona?.name ?? conn.personaId.slice(0, 8),
                  eventLabel: row.template?.label ?? row.eventType,
                })}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <AddPersonaModal
        open={!!addPersonaForEvent}
        personas={personas}
        groups={groups}
        alreadyActiveIds={connectedPersonaIdsForRow}
        eventLabel={addPersonaForEvent ? (findTemplateByEventType(addPersonaForEvent.eventType)?.label ?? addPersonaForEvent.eventType) : ''}
        onAdd={handleAddPersona}
        onClose={() => setAddPersonaForEvent(null)}
      />
      <DisconnectDialog
        open={!!disconnectTarget}
        personaName={disconnectTarget?.personaName ?? ''}
        eventLabel={disconnectTarget?.eventLabel ?? ''}
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />
      <RenameEventDialog
        open={!!renameTarget}
        oldEventType={renameTarget?.eventType ?? ''}
        reserved={renameTarget?.reserved ?? false}
        affectedCounts={{
          sources: renameTarget?.sources ?? 0,
          connections: renameTarget?.connections ?? 0,
        }}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />
    </div>
  );
}
