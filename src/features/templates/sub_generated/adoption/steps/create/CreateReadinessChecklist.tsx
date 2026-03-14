import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

interface CreateReadinessChecklistProps {
  draft: N8nPersonaDraft;
  readinessStatuses: ConnectorReadinessStatus[];
  allConnectorsReady: boolean;
  safetyScan: ScanResult | null;
  safetyCriticalOverride: boolean;
  confirming: boolean;
  onSafetyCriticalOverrideChange: (checked: boolean) => void;
  toolCount: number;
  triggerCount: number;
  connectorCount: number;
}

export function CreateReadinessChecklist({
  draft,
  readinessStatuses,
  allConnectorsReady,
  safetyScan,
  safetyCriticalOverride,
  confirming,
  onSafetyCriticalOverrideChange,
  toolCount,
  triggerCount,
  connectorCount,
}: CreateReadinessChecklistProps) {
  return (
    <>
      {/* Creation summary */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
        <span className="text-sm text-muted-foreground/60">
          Will create: 1 persona
          {toolCount > 0 && `, ${toolCount} tool${toolCount !== 1 ? 's' : ''}`}
          {triggerCount > 0 && `, ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}`}
          {connectorCount > 0 && `, ${connectorCount} connector subscription${connectorCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Readiness checklist */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className={`inline-flex items-center gap-1 ${draft.name ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {draft.name ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          Name
        </span>
        <span className={`inline-flex items-center gap-1 ${draft.system_prompt?.trim() ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {draft.system_prompt?.trim() ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          Prompt
        </span>
        {readinessStatuses.length > 0 && (
          <span className={`inline-flex items-center gap-1 ${allConnectorsReady ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
            {allConnectorsReady ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            Connectors
          </span>
        )}
        {(safetyScan?.critical.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 text-red-400/60">
            <AlertTriangle className="w-3 h-3" />
            Safety issues
          </span>
        )}
      </div>

      {/* Safety critical override toggle */}
      {(safetyScan?.critical.length ?? 0) > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/8 border border-red-500/15">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={safetyCriticalOverride}
              onChange={(e) => onSafetyCriticalOverrideChange(e.target.checked)}
              disabled={confirming}
              className="mt-0.5 rounded border-red-500/30 text-red-500 focus-visible:ring-red-500/30"
            />
            <div>
              <span className="text-sm font-medium text-red-300/90">
                I acknowledge {safetyScan!.critical.length} critical safety finding{safetyScan!.critical.length !== 1 ? 's' : ''} and accept the risk
              </span>
              <p className="text-sm text-red-400/50 mt-0.5">
                {safetyScan!.critical.map((f) => f.title).join(', ')}
              </p>
            </div>
          </label>
        </div>
      )}
    </>
  );
}
