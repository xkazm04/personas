/**
 * EditableMatrixCells — interactive cell renderers for PersonaMatrix edit mode.
 *
 * Each cell provides inline editing: connectors show credential-aware dropdowns,
 * triggers show schedule inputs, review/memory show toggles. Values flow through
 * the `MatrixEditState` callback interface so the host (QuickAdoptMatrix) can
 * wire them to whatever state management it uses.
 */
import { useMemo } from 'react';
import { CheckCircle2, ChevronDown, Clock, Webhook, MousePointerClick, Radio, Activity } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import type { RequiredConnector } from '../adoption/steps/ConnectStep';

// ── Public interface ──────────────────────────────────────────────────

export interface MatrixEditState {
  /** Connector name → credential ID mapping */
  connectorCredentialMap: Record<string, string>;
  /** Original connector name → active swap name */
  connectorSwaps: Record<string, string>;
  /** Trigger index → user config overrides */
  triggerConfigs: Record<number, Record<string, string>>;
  /** Whether human review is required */
  requireApproval: boolean;
  /** Whether memory is enabled */
  memoryEnabled: boolean;
}

export interface MatrixEditCallbacks {
  onCredentialSelect: (connectorName: string, credentialId: string) => void;
  onConnectorSwap: (originalName: string, replacementName: string) => void;
  onTriggerConfigChange: (index: number, config: Record<string, string>) => void;
  onToggleApproval: (value: boolean) => void;
  onToggleMemory: (value: boolean) => void;
}

// ── Trigger icons ─────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};

// ── Connector cell (edit mode) ────────────────────────────────────────

interface ConnectorEditCellProps {
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function ConnectorEditCell({
  requiredConnectors,
  credentials,
  editState,
  callbacks,
}: ConnectorEditCellProps) {
  if (requiredConnectors.length === 0) {
    return <span className="text-[11px] text-muted-foreground/50">No external services</span>;
  }

  return (
    <div className="space-y-1.5 w-full">
      {requiredConnectors.slice(0, 3).map((rc) => {
        const activeName = editState.connectorSwaps[rc.name] || rc.activeName;
        const meta = getConnectorMeta(activeName);
        const credId = editState.connectorCredentialMap[activeName];
        const matchedCred = credentials.find((c) => c.id === credId);
        const availableCreds = credentials.filter((c) => c.service_type === activeName);
        const isMatched = !!credId;

        return (
          <div key={rc.name} className="flex items-center gap-1.5 group">
            <div
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${meta.color}20` }}
            >
              <ConnectorIcon meta={meta} size="w-3 h-3" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</span>
                {isMatched && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
              </div>
              {availableCreds.length > 1 ? (
                <div className="relative mt-0.5">
                  <select
                    value={credId || ''}
                    onChange={(e) => callbacks.onCredentialSelect(activeName, e.target.value)}
                    className="w-full text-[10px] bg-transparent text-muted-foreground/60 border-none p-0 focus:outline-none cursor-pointer appearance-none pr-3"
                  >
                    {availableCreds.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-muted-foreground/40 pointer-events-none" />
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 block truncate">
                  {matchedCred?.name ?? (isMatched ? 'Linked' : 'No credential')}
                </span>
              )}
            </div>
            {/* Swap indicator for connectors with alternatives */}
            {rc.roleMembers && rc.roleMembers.length > 1 && (
              <div className="relative flex-shrink-0">
                <select
                  value={activeName}
                  onChange={(e) => callbacks.onConnectorSwap(rc.name, e.target.value)}
                  title="Switch connector"
                  className="w-4 h-4 opacity-0 absolute inset-0 cursor-pointer"
                >
                  {rc.roleMembers.map((m) => (
                    <option key={m} value={m}>{getConnectorMeta(m).label}</option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors pointer-events-none" />
              </div>
            )}
          </div>
        );
      })}
      {requiredConnectors.length > 3 && (
        <span className="text-[10px] text-muted-foreground/40">+{requiredConnectors.length - 3} more</span>
      )}
    </div>
  );
}

// ── Trigger cell (edit mode) ──────────────────────────────────────────

interface TriggerEditCellProps {
  designResult: AgentIR;
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function TriggerEditCell({ designResult, editState, callbacks }: TriggerEditCellProps) {
  const triggers = designResult.suggested_triggers ?? [];

  // Deduplicate by type — show one per type
  const uniqueTriggers = useMemo(() => {
    const seen = new Set<string>();
    return triggers
      .map((t, i) => ({ trigger: t, index: i }))
      .filter(({ trigger }) => {
        if (seen.has(trigger.trigger_type)) return false;
        seen.add(trigger.trigger_type);
        return true;
      });
  }, [triggers]);

  if (uniqueTriggers.length === 0) {
    return <span className="text-[11px] text-muted-foreground/50">Manual execution only</span>;
  }

  return (
    <div className="space-y-1.5 w-full">
      {uniqueTriggers.slice(0, 3).map(({ trigger, index }) => {
        const Icon = TRIGGER_ICONS[trigger.trigger_type];
        const config = editState.triggerConfigs[index] ?? {};
        const isSchedule = trigger.trigger_type === 'schedule';
        const defaultValue = trigger.description ||
          (trigger.config.cron as string | undefined) || '';

        return (
          <div key={index} className="flex items-center gap-1.5">
            <Icon className="w-3 h-3 text-amber-500/70 flex-shrink-0" />
            {isSchedule ? (
              <input
                type="text"
                value={config.schedule ?? config.cron ?? defaultValue}
                onChange={(e) => callbacks.onTriggerConfigChange(index, { ...config, schedule: e.target.value })}
                placeholder="Every weekday at 9am"
                className="flex-1 min-w-0 text-[11px] bg-transparent text-foreground/70 border-b border-primary/10 focus:border-violet-500/30 focus:outline-none py-0.5 placeholder:text-muted-foreground/30 transition-colors"
              />
            ) : (
              <span className="text-[11px] text-foreground/70 truncate">
                {trigger.description.length > 3 && trigger.description.length <= 35
                  ? trigger.description
                  : trigger.trigger_type.charAt(0).toUpperCase() + trigger.trigger_type.slice(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Review toggle cell (edit mode) ────────────────────────────────────

interface ReviewEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function ReviewEditCell({ editState, callbacks }: ReviewEditCellProps) {
  const active = editState.requireApproval;
  return (
    <div className="space-y-1 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground/80">
          {active ? 'Required' : 'Autonomous'}
        </span>
        <button
          type="button"
          onClick={() => callbacks.onToggleApproval(!active)}
          className={`relative w-8 h-[18px] rounded-full border transition-colors flex items-center ${
            active
              ? 'bg-violet-500/30 border-violet-500/40 justify-end'
              : 'bg-secondary/40 border-primary/15 justify-start'
          }`}
        >
          <div className={`w-3.5 h-3.5 rounded-full mx-0.5 transition-colors ${
            active ? 'bg-violet-400' : 'bg-muted-foreground/30'
          }`} />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/50 leading-snug">
        {active ? 'Pause before executing actions' : 'No human approval gates'}
      </p>
    </div>
  );
}

// ── Memory toggle cell (edit mode) ────────────────────────────────────

interface MemoryEditCellProps {
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function MemoryEditCell({ editState, callbacks }: MemoryEditCellProps) {
  const active = editState.memoryEnabled;
  return (
    <div className="space-y-1 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground/80">
          {active ? 'Persistent' : 'Stateless'}
        </span>
        <button
          type="button"
          onClick={() => callbacks.onToggleMemory(!active)}
          className={`relative w-8 h-[18px] rounded-full border transition-colors flex items-center ${
            active
              ? 'bg-emerald-500/30 border-emerald-500/40 justify-end'
              : 'bg-secondary/40 border-primary/15 justify-start'
          }`}
        >
          <div className={`w-3.5 h-3.5 rounded-full mx-0.5 transition-colors ${
            active ? 'bg-emerald-400' : 'bg-muted-foreground/30'
          }`} />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/50 leading-snug">
        {active ? 'Retains context across runs' : 'No cross-run memory'}
      </p>
    </div>
  );
}
