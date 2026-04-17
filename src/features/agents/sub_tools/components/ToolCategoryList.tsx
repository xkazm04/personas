import { Search, Wrench } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTranslation } from '@/i18n/useTranslation';
import { ToolCard } from './ToolCard';
import { ConnectorGroup } from './ConnectorGroup';
import type { ToolDef } from './ToolCardItems';
import type { ToolImpactData } from '../libs/toolImpactTypes';

interface ToolCategoryListProps {
  viewMode: 'grid' | 'grouped';
  filteredTools: ToolDef[];
  connectorGroups: Array<[string, ToolDef[]]>;
  assignedToolIds: Set<string>;
  credentialTypeSet: Set<string>;
  credentialLabel: (credType: string) => string;
  usageByTool: Map<string, number>;
  impactDataMap: Map<string, ToolImpactData>;
  isSearching: boolean;
  searchQuery: string;
  assignedCount: number;
  onClearSearch: () => void;
  onBrowseTools: () => void;
  onToggleTool: (toolId: string, toolName: string, isAssigned: boolean) => void;
  onBulkToggle: (tools: ToolDef[], allAssigned: boolean) => void;
  onAddCredential: () => void;
}

export function ToolCategoryList({
  viewMode, filteredTools, connectorGroups, assignedToolIds,
  credentialTypeSet, credentialLabel, usageByTool, impactDataMap,
  isSearching, assignedCount, onClearSearch, onBrowseTools, onToggleTool, onBulkToggle, onAddCredential,
}: ToolCategoryListProps) {
  const { t } = useTranslation();
  const showSearchEmpty = filteredTools.length === 0 && isSearching;
  const showUnassignedEmpty = filteredTools.length === 0 && !isSearching && assignedCount === 0;

  const emptyState = showSearchEmpty ? (
    <div className="py-16 flex flex-col items-center justify-center text-center">
      <Search className="w-10 h-10 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{t.agents.tools.no_matching}</p>
      <button onClick={onClearSearch} className="mt-3 text-sm px-2.5 py-1 rounded-modal border border-primary/20 text-primary/80 hover:bg-primary/10 transition-colors">
        {t.agents.tools.clear_filter}
      </button>
    </div>
  ) : showUnassignedEmpty ? (
    <div className="py-16 flex flex-col items-center justify-center text-center">
      <Wrench className="w-10 h-10 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{t.agents.tools.no_assigned}</p>
      <button onClick={onBrowseTools} className="mt-3 text-sm px-2.5 py-1 rounded-modal border border-primary/20 text-muted-foreground/80 hover:text-foreground/80 hover:bg-secondary/40 transition-colors">
        {t.agents.tools.browse_tools}
      </button>
    </div>
  ) : filteredTools.length === 0 ? (
    <div className="text-center py-8 text-muted-foreground/80 text-sm">{t.agents.tools.no_available}</div>
  ) : null;

  if (viewMode === 'grid') {
    return (
      <>
        <div className="grid gap-2" style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {filteredTools.map((tool) => {
            const isAssigned = assignedToolIds.has(tool.id);
            const missingCredential = tool.requires_credential_type && !credentialTypeSet.has(tool.requires_credential_type);
            return (
              <ToolCard
                key={tool.id}
                tool={tool}
                isAssigned={isAssigned}
                missingCredential={!!missingCredential}
                credentialLabel={credentialLabel}
                credentialTypeSet={credentialTypeSet}
                usageByTool={usageByTool}
                impactData={impactDataMap.get(tool.name)}
                onToggle={onToggleTool}
                onAddCredential={onAddCredential}
              />
            );
          })}
        </div>
        {emptyState}
      </>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {connectorGroups.map(([connectorKey, tools]) => (
          <ConnectorGroup
            key={connectorKey}
            connectorKey={connectorKey}
            tools={tools}
            assignedToolIds={assignedToolIds}
            credentialTypeSet={credentialTypeSet}
            credentialLabel={credentialLabel}
            usageByTool={usageByTool}
            impactDataMap={impactDataMap}
            onToggleTool={onToggleTool}
            onBulkToggle={onBulkToggle}
            onAddCredential={onAddCredential}
          />
        ))}
      </div>
      {emptyState}
    </>
  );
}
