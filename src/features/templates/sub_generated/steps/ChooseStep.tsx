import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Wrench,
  GitFork,
  Plug,
  Radio,
  AlertTriangle,
  Zap,
  Link,
} from 'lucide-react';
import { SelectionCheckbox } from '../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

// ── Node-type pill config ────────────────────────────────────────────

const NODE_TYPE_PILLS: Record<string, { Icon: typeof Wrench; color: string; label: string }> = {
  action:    { Icon: Wrench,        color: 'text-blue-400 bg-blue-500/10 border-blue-500/15',        label: 'action' },
  decision:  { Icon: GitFork,       color: 'text-amber-400 bg-amber-500/10 border-amber-500/15',     label: 'decision' },
  connector: { Icon: Plug,          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/15', label: 'connector' },
  event:     { Icon: Radio,         color: 'text-violet-400 bg-violet-500/10 border-violet-500/15',   label: 'event' },
  error:     { Icon: AlertTriangle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/15',        label: 'error' },
};

// ── Dependency derivation helper ─────────────────────────────────────

export function deriveRequirementsFromFlows(
  flows: UseCaseFlow[],
  selectedIds: Set<string>,
): { connectorNames: Set<string>; toolNames: Set<string> } {
  const connectorNames = new Set<string>();
  const toolNames = new Set<string>();

  for (const flow of flows) {
    if (!selectedIds.has(flow.id)) continue;
    for (const node of flow.nodes) {
      if (node.type === 'connector' && node.connector) {
        connectorNames.add(node.connector);
      }
      if (node.type === 'action') {
        toolNames.add(node.label);
      }
    }
  }

  return { connectorNames, toolNames };
}

// ── Props ────────────────────────────────────────────────────────────

interface ChooseStepProps {
  useCaseFlows: UseCaseFlow[];
  designResult: DesignAnalysisResult;
  selectedUseCaseIds: Set<string>;
  onToggleUseCaseId: (id: string) => void;
  // Fallback entity toggles (when no flows exist)
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  onToggleTool: (index: number) => void;
  onToggleTrigger: (index: number) => void;
  onToggleConnector: (name: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

function countNodeTypes(nodes: FlowNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    if (n.type === 'start' || n.type === 'end') continue;
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
}

function uniqueConnectors(nodes: FlowNode[]): string[] {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.type === 'connector' && n.connector) seen.add(n.connector);
  }
  return Array.from(seen);
}

// ── Component ────────────────────────────────────────────────────────

export function ChooseStep({
  useCaseFlows,
  designResult,
  selectedUseCaseIds,
  onToggleUseCaseId,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  onToggleTool,
  onToggleTrigger,
  onToggleConnector,
}: ChooseStepProps) {
  const hasFlows = useCaseFlows.length > 0;

  // Summary counts derived from selected flows
  const summary = useMemo(() => {
    const { connectorNames, toolNames } = deriveRequirementsFromFlows(useCaseFlows, selectedUseCaseIds);
    return {
      selected: selectedUseCaseIds.size,
      total: useCaseFlows.length,
      connectorCount: connectorNames.size,
      toolCount: toolNames.size,
    };
  }, [useCaseFlows, selectedUseCaseIds]);

  const allSelected = hasFlows && selectedUseCaseIds.size === useCaseFlows.length;

  function handleToggleAll() {
    if (allSelected) {
      // Clear all
      for (const flow of useCaseFlows) {
        if (selectedUseCaseIds.has(flow.id)) onToggleUseCaseId(flow.id);
      }
    } else {
      // Select all
      for (const flow of useCaseFlows) {
        if (!selectedUseCaseIds.has(flow.id)) onToggleUseCaseId(flow.id);
      }
    }
  }

  // ── Flows-based layout ───────────────────────────────────────────

  if (hasFlows) {
    return (
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Select Use Cases</h3>
          <button
            type="button"
            onClick={handleToggleAll}
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
          >
            {allSelected ? 'Clear All' : 'Select All'}
          </button>
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {useCaseFlows.map((flow, idx) => {
            const checked = selectedUseCaseIds.has(flow.id);
            return (
              <UseCaseCard
                key={flow.id}
                flow={flow}
                checked={checked}
                index={idx}
                onToggle={() => onToggleUseCaseId(flow.id)}
              />
            );
          })}
        </div>

        {/* Bottom summary rail */}
        <div className="flex items-center gap-3 py-3 border-t border-primary/10">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/15">
            {summary.selected} of {summary.total} use cases
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {summary.connectorCount} connectors
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/15">
            {summary.toolCount} tools
          </span>
        </div>
      </div>
    );
  }

  // ── Fallback: flat entity checklists ─────────────────────────────

  const tools = designResult.suggested_tools ?? [];
  const triggers = designResult.suggested_triggers ?? [];
  const connectors = designResult.suggested_connectors ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-lg font-semibold text-foreground">Select Components</h3>

      {/* Tools */}
      {tools.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Tools
          </h4>
          <div className="flex flex-col gap-1.5">
            {tools.map((tool, idx) => (
              <label
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                onClick={() => onToggleTool(idx)}
              >
                <SelectionCheckbox
                  checked={selectedToolIndices.has(idx)}
                  onChange={() => onToggleTool(idx)}
                />
                <span className="text-sm text-foreground">{tool}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Triggers */}
      {triggers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Triggers
          </h4>
          <div className="flex flex-col gap-1.5">
            {triggers.map((trigger, idx) => (
              <label
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                onClick={() => onToggleTrigger(idx)}
              >
                <SelectionCheckbox
                  checked={selectedTriggerIndices.has(idx)}
                  onChange={() => onToggleTrigger(idx)}
                />
                <span className="text-sm text-foreground">
                  {trigger.description || trigger.trigger_type}
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Connectors */}
      {connectors.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Link className="w-3.5 h-3.5" /> Connectors
          </h4>
          <div className="flex flex-col gap-1.5">
            {connectors.map((conn) => {
              const meta = getConnectorMeta(conn.name);
              return (
                <label
                  key={conn.name}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                  onClick={() => onToggleConnector(conn.name)}
                >
                  <SelectionCheckbox
                    checked={selectedConnectorNames.has(conn.name)}
                    onChange={() => onToggleConnector(conn.name)}
                  />
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                  <span className="text-sm text-foreground">{meta.label}</span>
                </label>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Use Case Card sub-component ──────────────────────────────────────

function UseCaseCard({
  flow,
  checked,
  index,
  onToggle,
}: {
  flow: UseCaseFlow;
  checked: boolean;
  index: number;
  onToggle: () => void;
}) {
  const nodeCounts = useMemo(() => countNodeTypes(flow.nodes), [flow.nodes]);
  const connectors = useMemo(() => uniqueConnectors(flow.nodes), [flow.nodes]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={onToggle}
      className={`rounded-2xl border p-5 cursor-pointer transition-all ${
        checked
          ? 'border-violet-500/25 bg-violet-500/5'
          : 'border-primary/10 bg-secondary/15 opacity-60'
      }`}
    >
      {/* Top row: checkbox + name */}
      <div className="flex items-start gap-2.5">
        <SelectionCheckbox checked={checked} onChange={onToggle} />
        <span className="text-base font-semibold text-foreground leading-snug">
          {flow.name}
        </span>
      </div>

      {/* Description */}
      {flow.description && (
        <p className="mt-2 text-sm text-muted-foreground/70">{flow.description}</p>
      )}

      {/* Separator */}
      <div className="border-t border-primary/6 my-3" />

      {/* Bottom row: node type pills + connector icons */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Object.entries(nodeCounts).map(([type, count]) => {
          const pill = NODE_TYPE_PILLS[type];
          if (!pill) return null;
          const { Icon, color, label } = pill;
          return (
            <span
              key={type}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded border ${color}`}
            >
              <Icon className="w-2.5 h-2.5" />
              {count} {label}
            </span>
          );
        })}

        {connectors.length > 0 && (
          <>
            <span className="w-px h-3.5 bg-primary/10 mx-0.5" />
            {connectors.map((name) => {
              const meta = getConnectorMeta(name);
              return (
                <ConnectorIcon key={name} meta={meta} size="w-3 h-3" />
              );
            })}
          </>
        )}
      </div>
    </motion.div>
  );
}
