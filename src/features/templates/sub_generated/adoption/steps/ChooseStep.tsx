import { useMemo, useState, useCallback } from 'react';
import {
  Wrench,
  Zap,
  Link,
} from 'lucide-react';
import { SelectionCheckbox } from '../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { UseCaseRow, uniqueConnectors } from './UseCaseRow';

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

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a map from connector name → set of flow IDs that use it */
function buildConnectorFlowIndex(flows: UseCaseFlow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.type === 'connector' && node.connector) {
        let set = index.get(node.connector);
        if (!set) {
          set = new Set();
          index.set(node.connector, set);
        }
        set.add(flow.id);
      }
    }
  }
  return index;
}

// ── Component ────────────────────────────────────────────────────────

export function ChooseStep() {
  const { state, wizard, useCaseFlows, designResult: rawDesignResult } = useAdoptionWizard();
  const designResult = rawDesignResult!;
  const {
    selectedUseCaseIds,
    selectedToolIndices,
    selectedTriggerIndices,
    selectedConnectorNames,
  } = state;
  const onToggleUseCaseId = wizard.toggleUseCaseId;
  const onToggleTool = wizard.toggleTool;
  const onToggleTrigger = wizard.toggleTrigger;
  const onToggleConnector = wizard.toggleConnector;
  const hasFlows = useCaseFlows.length > 0;

  // Track which row is hovered to highlight shared connectors
  const [hoveredFlowId, setHoveredFlowId] = useState<string | null>(null);

  // Build connector → flow ID index for dependency highlighting
  const connectorFlowIndex = useMemo(
    () => buildConnectorFlowIndex(useCaseFlows),
    [useCaseFlows],
  );

  // Determine which connector names are shared with the hovered flow
  const highlightedConnectors = useMemo(() => {
    if (!hoveredFlowId) return new Set<string>();
    const hoveredFlow = useCaseFlows.find((f) => f.id === hoveredFlowId);
    if (!hoveredFlow) return new Set<string>();
    const hoveredConns = uniqueConnectors(hoveredFlow.nodes);
    const shared = new Set<string>();
    for (const conn of hoveredConns) {
      const users = connectorFlowIndex.get(conn);
      // Only highlight if this connector is used by at least one OTHER flow
      if (users && users.size > 1) shared.add(conn);
    }
    return shared;
  }, [hoveredFlowId, useCaseFlows, connectorFlowIndex]);

  // Determine which OTHER flow IDs share connectors with the hovered flow
  const highlightedFlowIds = useMemo(() => {
    if (!hoveredFlowId || highlightedConnectors.size === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const conn of highlightedConnectors) {
      const users = connectorFlowIndex.get(conn);
      if (users) for (const id of users) if (id !== hoveredFlowId) ids.add(id);
    }
    return ids;
  }, [hoveredFlowId, highlightedConnectors, connectorFlowIndex]);

  const onRowHover = useCallback((flowId: string | null) => {
    setHoveredFlowId(flowId);
  }, []);

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

        {/* Compact list */}
        <div className="flex flex-col gap-1.5">
          {useCaseFlows.map((flow) => {
            const checked = selectedUseCaseIds.has(flow.id);
            return (
              <UseCaseRow
                key={flow.id}
                flow={flow}
                checked={checked}
                onToggle={() => onToggleUseCaseId(flow.id)}
                onHover={onRowHover}
                highlightedConnectors={hoveredFlowId === flow.id ? highlightedConnectors : new Set()}
                isDepHighlighted={highlightedFlowIds.has(flow.id)}
              />
            );
          })}
        </div>

        {/* Bottom summary rail */}
        <div className="flex items-center gap-3 py-3 border-t border-primary/10">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/15">
            {summary.selected} of {summary.total} use cases
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {summary.connectorCount} connectors
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/15">
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
            {tools.map((tool, idx) => {
              const checkboxId = `choose-tools-${idx}`;
              return (
                <label
                  key={idx}
                  htmlFor={checkboxId}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                >
                  <SelectionCheckbox
                    id={checkboxId}
                    checked={selectedToolIndices.has(idx)}
                    onChange={() => onToggleTool(idx)}
                  />
                  <span className="text-sm text-foreground">{tool}</span>
                </label>
              );
            })}
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
            {triggers.map((trigger, idx) => {
              const checkboxId = `choose-triggers-${idx}`;
              return (
                <label
                  key={idx}
                  htmlFor={checkboxId}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                >
                  <SelectionCheckbox
                    id={checkboxId}
                    checked={selectedTriggerIndices.has(idx)}
                    onChange={() => onToggleTrigger(idx)}
                  />
                  <span className="text-sm text-foreground">
                    {trigger.description || trigger.trigger_type}
                  </span>
                </label>
              );
            })}
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
              const checkboxId = `choose-connectors-${conn.name}`;
              return (
                <label
                  key={conn.name}
                  htmlFor={checkboxId}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors"
                >
                  <SelectionCheckbox
                    id={checkboxId}
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
