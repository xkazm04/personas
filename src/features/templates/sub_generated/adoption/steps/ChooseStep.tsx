import { useMemo, useCallback } from 'react';
import {
  Wrench,
  Zap,
  Link,
  Info,
  Boxes,
} from 'lucide-react';
import { SelectionCheckbox } from '../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { getRoleForConnector } from '@/lib/credentials/connectorRoles';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { UseCaseRow } from './UseCaseRow';

// â”€â”€ Dependency derivation helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Build a map from connector name â†’ set of flow IDs that use it */
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

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Build connector â†’ flow ID index for dependency highlighting
  const connectorFlowIndex = useMemo(
    () => buildConnectorFlowIndex(useCaseFlows),
    [useCaseFlows],
  );

  // Summary counts derived from selected flows
  const summary = useMemo(() => {
    const { connectorNames, toolNames } = deriveRequirementsFromFlows(useCaseFlows, selectedUseCaseIds);
    return {
      selected: selectedUseCaseIds.size,
      total: useCaseFlows.length,
      connectorNames: Array.from(connectorNames),
      toolNames: Array.from(toolNames),
    };
  }, [useCaseFlows, selectedUseCaseIds]);

  const allSelected = hasFlows && selectedUseCaseIds.size === useCaseFlows.length;

  // Batch toggle â€” atomic set/clear instead of per-item loop
  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      wizard.clearAllUseCases();
    } else {
      wizard.selectAllUseCases(useCaseFlows.map((f) => f.id));
    }
  }, [allSelected, wizard, useCaseFlows]);

  // â”€â”€ Flows-based layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Derive architectural components from connectors
  const components = useMemo(() => {
    const roles = new Map<string, { label: string; connectors: string[] }>();
    for (const name of summary.connectorNames) {
      const role = getRoleForConnector(name);
      if (role) {
        const existing = roles.get(role.role);
        if (existing) {
          existing.connectors.push(name);
        } else {
          roles.set(role.role, { label: role.label, connectors: [name] });
        }
      }
    }
    return Array.from(roles.values());
  }, [summary.connectorNames]);

  if (hasFlows) {
    return (
      <div className="flex flex-col gap-3">
        {/* Template intro */}
        <div className="rounded-xl border border-primary/10 bg-secondary/10 px-4 py-3">
          <h3 className="text-base font-semibold text-foreground">{state.templateName}</h3>
          {designResult.summary && (
            <p className="text-sm text-muted-foreground/70 mt-1 leading-relaxed">
              {designResult.summary}
            </p>
          )}
        </div>

        {/* Step header with context */}
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Select Use Cases</h3>
            <button
              type="button"
              onClick={handleToggleAll}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
            >
              {allSelected ? 'Clear All' : 'Select All'}
            </button>
          </div>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            Choose which capabilities to include. Deselected use cases and their connectors will be excluded.
          </p>
        </div>

        {/* Use case list */}
        <div className="flex flex-col gap-1">
          {useCaseFlows.map((flow) => {
            const checked = selectedUseCaseIds.has(flow.id);
            return (
              <UseCaseRow
                key={flow.id}
                flow={flow}
                checked={checked}
                onToggle={() => onToggleUseCaseId(flow.id)}
                connectorFlowIndex={connectorFlowIndex}
                selectedIds={selectedUseCaseIds}
              />
            );
          })}
        </div>

        {/* Impact preview */}
        <div className="flex flex-col gap-2 py-2.5 border-t border-primary/10">
          {/* Components row â€” architectural role groups */}
          {components.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground/50 w-20 flex-shrink-0 flex items-center gap-1">
                <Boxes className="w-3 h-3" /> Components
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {components.map((comp) => (
                  <span
                    key={comp.label}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-violet-500/8 text-violet-400/80 border border-violet-500/12"
                    title={comp.connectors.map((n) => getConnectorMeta(n).label).join(', ')}
                  >
                    {comp.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Examples row (connectors used by selected flows) */}
          {summary.connectorNames.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground/50 w-20 flex-shrink-0">Examples</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {summary.connectorNames.map((name) => {
                  const meta = getConnectorMeta(name);
                  return (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/12"
                      title={meta.label}
                    >
                      <ConnectorIcon meta={meta} size="w-3 h-3" />
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {/* Tools row */}
          {summary.toolNames.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground/50 w-20 flex-shrink-0">Tools</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {summary.toolNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-blue-500/8 text-blue-400/80 border border-blue-500/12"
                  >
                    <Wrench className="w-2.5 h-2.5" />
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Empty state */}
          {summary.selected === 0 && (
            <p className="text-sm text-muted-foreground/60 italic">No use cases selected â€” select at least one to continue</p>
          )}
        </div>
      </div>
    );
  }

  // â”€â”€ Fallback: flat entity checklists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const tools = designResult.suggested_tools ?? [];
  const triggers = designResult.suggested_triggers ?? [];
  const connectors = designResult.suggested_connectors ?? [];

  // If no entities at all, show helpful message
  if (tools.length === 0 && triggers.length === 0 && connectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Info className="w-8 h-8 text-muted-foreground/25" />
        <p className="text-sm text-muted-foreground/60">
          This template has no configurable components â€” proceed to Connect.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Select Components</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Choose which tools, triggers, and connectors to include in your persona.
        </p>
      </div>

      {/* Tools */}
      {tools.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Tools ({tools.length})
          </h4>
          <div className="flex flex-col gap-1">
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
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Triggers ({triggers.length})
          </h4>
          <div className="flex flex-col gap-1">
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
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Link className="w-3.5 h-3.5" /> Connectors ({connectors.length})
          </h4>
          <div className="flex flex-col gap-1">
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
