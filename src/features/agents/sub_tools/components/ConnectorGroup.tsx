import { Check, CheckCircle, AlertCircle } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import { GroupedToolRow } from './GroupedToolRow';
import type { ToolDef } from './ToolCardItems';
import type { ToolImpactData } from '../libs/toolImpactTypes';
import { isGeneralGroup } from '../libs/connectorGroupKey';

export function ConnectorGroup({
  connectorKey, tools, assignedToolIds, credentialTypeSet,
  credentialLabel, usageByTool, impactDataMap,
  onToggleTool, onBulkToggle, onAddCredential,
}: {
  connectorKey: string;
  tools: ToolDef[];
  assignedToolIds: Set<string>;
  credentialTypeSet: Set<string>;
  credentialLabel: (credType: string) => string;
  usageByTool: Map<string, number>;
  impactDataMap: Map<string, ToolImpactData>;
  onToggleTool: (id: string, name: string, assigned: boolean) => void;
  onBulkToggle: (tools: ToolDef[], allAssigned: boolean) => void;
  onAddCredential: () => void;
}) {
  const { t } = useTranslation();
  const isGeneral = isGeneralGroup(connectorKey);
  const meta = isGeneral ? null : getConnectorMeta(connectorKey);
  const label = isGeneral ? t.agents.tools.general : credentialLabel(connectorKey);
  const hasCredential = isGeneral || credentialTypeSet.has(connectorKey);
  const missingCredential = !isGeneral && !hasCredential;
  const assignableTools = missingCredential ? [] : tools;
  const assignedInGroup = tools.filter(t => assignedToolIds.has(t.id));
  const allAssigned = assignableTools.length > 0 && assignedInGroup.length === assignableTools.length;
  const someAssigned = assignedInGroup.length > 0 && !allAssigned;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-secondary/30 border-b border-primary/10">
        <button
          onClick={() => !missingCredential && onBulkToggle(tools, allAssigned)}
          disabled={missingCredential}
          className={`flex-shrink-0 w-5 h-5 rounded-card border flex items-center justify-center transition-colors ${
            missingCredential
              ? 'bg-background/30 border-primary/10 cursor-not-allowed'
              : allAssigned
                ? 'bg-primary border-primary cursor-pointer'
                : someAssigned
                  ? 'bg-primary/40 border-primary/60 cursor-pointer'
                  : 'bg-background/50 border-primary/20 cursor-pointer hover:border-primary/30'
          }`}
        >
          {(allAssigned || someAssigned) && (
            <Check className={`w-3 h-3 ${allAssigned ? 'text-foreground' : 'text-foreground'}`} />
          )}
        </button>
        {meta && (
          <div
            className="w-6 h-6 rounded-card flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${meta.color}15` }}
          >
            <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
          </div>
        )}
        <span className="typo-body font-medium text-foreground flex-1">{label}</span>
        {!isGeneral && (
          hasCredential ? (
            <span title={`${label} credential connected`}>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            </span>
          ) : (
            <button
              onClick={onAddCredential}
              className="inline-flex items-center gap-1 typo-body text-amber-400/80 hover:text-amber-300 transition-colors"
              title={`Needs ${label} credential`}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">{t.agents.tools.add_credential}</span>
            </button>
          )
        )}
        <span className="typo-code font-mono px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-foreground">
          {assignedInGroup.length}/{tools.length}
        </span>
      </div>
      <div className="divide-y divide-primary/5">
        {tools.map((tool) => {
          const isAssigned = assignedToolIds.has(tool.id);
          return (
            <GroupedToolRow
              key={tool.id}
              tool={tool}
              isAssigned={isAssigned}
              missingCredential={missingCredential}
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
