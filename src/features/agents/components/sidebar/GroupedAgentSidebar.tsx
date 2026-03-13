import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { PersonaContextMenu, type ContextMenuState } from '@/features/agents/components/sub_sidebar/components/PersonaContextMenu';
import { usePersonaFilters } from '@/features/agents/components/sub_sidebar/libs/usePersonaFilters';
import { buildSidebarTree } from '@/lib/types/frontendTypes';
import { Button } from '@/features/shared/components/buttons';
import type { Persona } from '@/lib/types/types';
import { SidebarHeader } from './SidebarHeader';
import { SidebarDndSection } from './SidebarDndSection';

interface GroupedAgentSidebarProps {
  onCreatePersona: () => void;
}

export default function GroupedAgentSidebar({ onCreatePersona }: GroupedAgentSidebarProps) {
  const personas = useAgentStore((s) => s.personas);
  const groups = usePipelineStore((s) => s.groups);
  const personaHealthMap = useAgentStore((s) => s.personaHealthMap);
  const personaLastRun = useAgentStore((s) => s.personaLastRun);

  const {
    filters, setSearch, toggleTag, clearFilters, hasActiveFilters, filteredIds, allAutoTags,
  } = usePersonaFilters(personas, personaHealthMap, personaLastRun);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const handleContextMenu = useCallback((e: React.MouseEvent, persona: Persona) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ persona, x: e.clientX, y: e.clientY });
  }, []);

  const tree = useMemo(() => buildSidebarTree(groups, personas), [groups, personas]);

  const filteredTree = useMemo(() => {
    if (!hasActiveFilters) return tree;
    return tree.map((node) => ({
      ...node,
      children: node.children.filter((p) => filteredIds.has(p.id)),
    }));
  }, [tree, filteredIds, hasActiveFilters]);

  const groupNodes = filteredTree.filter((n) => n.kind === 'group');
  const ungroupedNode = filteredTree.find((n) => n.kind === 'ungrouped');
  const ungrouped = ungroupedNode?.children ?? [];

  const visibleGroupNodes = hasActiveFilters
    ? groupNodes.filter((n) => n.kind === 'group' && n.children.length > 0)
    : groupNodes;

  return (
    <>
      <SidebarHeader
        onCreatePersona={onCreatePersona}
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        filteredCount={filteredIds.size}
        totalCount={personas.length}
        allAutoTags={allAutoTags}
        onSearchChange={setSearch}
        onToggleTag={toggleTag}
        onClearFilters={clearFilters}
      />

      <SidebarDndSection
        visibleGroupNodes={visibleGroupNodes}
        ungrouped={ungrouped}
        handleContextMenu={handleContextMenu}
      />

      {hasActiveFilters && filteredIds.size === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground/70">
          <p>No agents match your filters</p>
          <Button variant="link" size="sm" onClick={clearFilters} className="mt-2 text-primary/70 hover:text-primary">
            Clear all filters
          </Button>
        </div>
      )}

      {personas.length === 0 && (
        <div className="text-center py-10 text-sm text-muted-foreground/90">No personas yet</div>
      )}

      <AnimatePresence>
        {contextMenu && (
          <PersonaContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
