import { Undo2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToolSearchFilter } from './ToolSearchFilter';
import { ToolCategoryList } from './ToolCategoryList';
import { useToolSelectorState } from './useToolSelectorState';
import { useToolImpactData } from './useToolImpactData';

export function ToolSelector() {
  const {
    selectedPersona, toolDefinitions,
    credentialLabel, credentialTypeSet, usageByTool,
    assignedToolIds, assignedTools,
    categories, categoryCounts,
    selectedCategory, setSelectedCategory,
    searchQuery, setSearchQuery,
    justToggledId, undoToast,
    viewMode, setViewMode,
    isSearching, filteredTools, connectorGroups,
    handleToggleTool, handleUndo, handleClearAll,
    handleBulkToggle, handleAddCredential,
  } = useToolSelectorState();

  const impactDataMap = useToolImpactData();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ToolSearchFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        categories={categories}
        categoryCounts={categoryCounts}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        isSearching={isSearching}
        assignedTools={assignedTools}
        totalToolCount={toolDefinitions.length}
        onClearAll={handleClearAll}
      />

      <ToolCategoryList
        viewMode={viewMode}
        filteredTools={filteredTools}
        connectorGroups={connectorGroups}
        assignedToolIds={assignedToolIds}
        assignedCount={assignedTools.length}
        credentialTypeSet={credentialTypeSet}
        credentialLabel={credentialLabel}
        usageByTool={usageByTool}
        impactDataMap={impactDataMap}
        justToggledId={justToggledId}
        isSearching={isSearching}
        searchQuery={searchQuery}
        onClearSearch={() => setSearchQuery('')}
        onBrowseTools={() => setViewMode('grouped')}
        onToggleTool={handleToggleTool}
        onBulkToggle={handleBulkToggle}
        onAddCredential={handleAddCredential}
      />

      <AnimatePresence>
        {undoToast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-secondary/95 backdrop-blur-sm border border-primary/20 rounded-xl shadow-xl"
          >
            <span className="text-sm text-foreground/80">
              Removed <span className="font-medium text-foreground/90">{undoToast.toolName}</span>
            </span>
            <button
              onClick={handleUndo}
              className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
