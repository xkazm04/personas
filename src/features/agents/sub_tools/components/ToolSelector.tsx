import { Undo2 } from 'lucide-react';
import { ToolSearchFilter } from './ToolSearchFilter';
import { ToolCategoryList } from './ToolCategoryList';
import { useToolSelectorPersona } from '../libs/useToolSelectorPersona';
import { useToolSelectorSearch } from '../libs/useToolSelectorSearch';
import { useToolSelectorActions } from '../libs/useToolSelectorActions';
import { useToolImpactData } from '../libs/useToolImpactData';

export function ToolSelector() {
  const persona = useToolSelectorPersona();
  const search = useToolSelectorSearch();
  const actions = useToolSelectorActions(persona.personaId, persona.assignedToolIds, persona.assignedTools);
  const impactDataMap = useToolImpactData();

  if (!persona.selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ToolSearchFilter
        searchQuery={search.searchQuery}
        onSearchChange={search.setSearchQuery}
        viewMode={search.viewMode}
        onViewModeChange={search.setViewMode}
        categories={search.categories}
        categoryCounts={search.categoryCounts}
        selectedCategory={search.selectedCategory}
        onCategoryChange={search.setSelectedCategory}
        isSearching={search.isSearching}
        assignedTools={persona.assignedTools}
        totalToolCount={persona.toolDefinitions.length}
        onClearAll={actions.handleClearAll}
      />

      <ToolCategoryList
        viewMode={search.viewMode}
        filteredTools={search.filteredTools}
        connectorGroups={search.connectorGroups}
        assignedToolIds={persona.assignedToolIds}
        assignedCount={persona.assignedTools.length}
        credentialTypeSet={persona.credentialTypeSet}
        credentialLabel={persona.credentialLabel}
        usageByTool={persona.usageByTool}
        impactDataMap={impactDataMap}
        isSearching={search.isSearching}
        searchQuery={search.searchQuery}
        onClearSearch={() => search.setSearchQuery('')}
        onBrowseTools={() => search.setViewMode('grouped')}
        onToggleTool={actions.handleToggleTool}
        onBulkToggle={actions.handleBulkToggle}
        onAddCredential={actions.handleAddCredential}
      />

      {actions.undoToast && (
          <div
            className="animate-fade-slide-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-secondary/95 backdrop-blur-sm border border-primary/20 rounded-xl shadow-elevation-3"
          >
            <span className="text-sm text-foreground/80">
              Removed <span className="font-medium text-foreground/90">{actions.undoToast.toolName}</span>
            </span>
            <button
              onClick={actions.handleUndo}
              className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          </div>
        )}
    </div>
  );
}
