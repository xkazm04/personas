import { Check, CheckCircle, AlertCircle } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { ToolCard, GroupedToolRow } from './ToolCardItems';
import type { ToolDef } from './ToolCardItems';
import type { ToolImpactData } from './useToolImpactData';

interface ToolCategoryListProps {
  viewMode: 'grid' | 'grouped';
  filteredTools: ToolDef[];
  connectorGroups: Array<[string, ToolDef[]]>;
  assignedToolIds: string[];
  credentialTypeSet: Set<string>;
  credentialLabel: (credType: string) => string;
  usageByTool: Map<string, number>;
  impactDataMap: Map<string, ToolImpactData>;
  justToggledId: string | null;
  isSearching: boolean;
  searchQuery: string;
  onToggleTool: (toolId: string, toolName: string, isAssigned: boolean) => void;
  onBulkToggle: (tools: ToolDef[], allAssigned: boolean) => void;
  onAddCredential: () => void;
}

export function ToolCategoryList({
  viewMode, filteredTools, connectorGroups, assignedToolIds,
  credentialTypeSet, credentialLabel, usageByTool, impactDataMap, justToggledId,
  isSearching, searchQuery, onToggleTool, onBulkToggle, onAddCredential,
}: ToolCategoryListProps) {
  if (viewMode === 'grid') {
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filteredTools.map((tool) => {
            const isAssigned = assignedToolIds.includes(tool.id);
            const missingCredential = tool.requires_credential_type && !credentialTypeSet.has(tool.requires_credential_type);
            return (
              <ToolCard
                key={tool.id}
                tool={tool}
                isAssigned={isAssigned}
                missingCredential={!!missingCredential}
                justToggledId={justToggledId}
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
        {filteredTools.length === 0 && (
          <div className="text-center py-8 text-muted-foreground/80 text-sm">
            {isSearching ? `No tools matching "${searchQuery.trim()}"` : 'No tools found in this category'}
          </div>
        )}
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
            justToggledId={justToggledId}
            usageByTool={usageByTool}
            impactDataMap={impactDataMap}
            onToggleTool={onToggleTool}
            onBulkToggle={onBulkToggle}
            onAddCredential={onAddCredential}
          />
        ))}
      </div>
      {filteredTools.length === 0 && (
        <div className="text-center py-8 text-muted-foreground/80 text-sm">
          {isSearching ? `No tools matching "${searchQuery.trim()}"` : 'No tools available'}
        </div>
      )}
    </>
  );
}

function ConnectorGroup({
  connectorKey, tools, assignedToolIds, credentialTypeSet,
  credentialLabel, justToggledId, usageByTool, impactDataMap,
  onToggleTool, onBulkToggle, onAddCredential,
}: {
  connectorKey: string;
  tools: ToolDef[];
  assignedToolIds: string[];
  credentialTypeSet: Set<string>;
  credentialLabel: (credType: string) => string;
  justToggledId: string | null;
  usageByTool: Map<string, number>;
  impactDataMap: Map<string, ToolImpactData>;
  onToggleTool: (id: string, name: string, assigned: boolean) => void;
  onBulkToggle: (tools: ToolDef[], allAssigned: boolean) => void;
  onAddCredential: () => void;
}) {
  const isGeneral = connectorKey === '__general__';
  const meta = isGeneral ? null : getConnectorMeta(connectorKey);
  const label = isGeneral ? 'General' : credentialLabel(connectorKey);
  const hasCredential = isGeneral || credentialTypeSet.has(connectorKey);
  const missingCredential = !isGeneral && !hasCredential;
  const assignableTools = missingCredential ? [] : tools;
  const assignedInGroup = tools.filter(t => assignedToolIds.includes(t.id));
  const allAssigned = assignableTools.length > 0 && assignedInGroup.length === assignableTools.length;
  const someAssigned = assignedInGroup.length > 0 && !allAssigned;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-secondary/30 border-b border-primary/8">
        <button
          onClick={() => !missingCredential && onBulkToggle(tools, allAssigned)}
          disabled={missingCredential}
          className={`flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            missingCredential
              ? 'bg-background/30 border-primary/10 cursor-not-allowed'
              : allAssigned
                ? 'bg-primary border-primary cursor-pointer'
                : someAssigned
                  ? 'bg-primary/40 border-primary/60 cursor-pointer'
                  : 'bg-background/50 border-primary/15 cursor-pointer hover:border-primary/30'
          }`}
        >
          {(allAssigned || someAssigned) && (
            <Check className={`w-3 h-3 ${allAssigned ? 'text-foreground' : 'text-foreground/80'}`} />
          )}
        </button>
        {meta && (
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${meta.color}15` }}
          >
            <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
          </div>
        )}
        <span className="text-sm font-medium text-foreground/80 flex-1">{label}</span>
        {!isGeneral && (
          hasCredential ? (
            <span title={`${label} credential connected`}>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            </span>
          ) : (
            <button
              onClick={onAddCredential}
              className="inline-flex items-center gap-1 text-sm text-amber-400/80 hover:text-amber-300 transition-colors"
              title={`Needs ${label} credential`}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">Add credential</span>
            </button>
          )
        )}
        <span className="text-sm font-mono px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-muted-foreground/90">
          {assignedInGroup.length}/{tools.length}
        </span>
      </div>
      <div className="divide-y divide-primary/5">
        {tools.map((tool) => {
          const isAssigned = assignedToolIds.includes(tool.id);
          return (
            <GroupedToolRow
              key={tool.id}
              tool={tool}
              isAssigned={isAssigned}
              missingCredential={missingCredential}
              justToggledId={justToggledId}
              usageByTool={usageByTool}
              impactData={impactDataMap.get(tool.name)}
              onToggle={onToggleTool}
            />
          );
        })}
      </div>
    </div>
  );
}
