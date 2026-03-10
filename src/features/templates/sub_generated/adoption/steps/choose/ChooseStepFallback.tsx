import { Wrench, Zap, Link, Info } from 'lucide-react';
import { SelectionCheckbox } from '../../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useAdoptionWizard } from '../../AdoptionWizardContext';

export function ChooseStepFallback() {
  const { state, wizard, designResult: rawDesignResult } = useAdoptionWizard();
  const designResult = rawDesignResult!;
  const {
    selectedToolIndices,
    selectedTriggerIndices,
    selectedConnectorNames,
  } = state;
  const onToggleTool = wizard.toggleTool;
  const onToggleTrigger = wizard.toggleTrigger;
  const onToggleConnector = wizard.toggleConnector;

  const tools = designResult.suggested_tools ?? [];
  const triggers = designResult.suggested_triggers ?? [];
  const connectors = designResult.suggested_connectors ?? [];

  // If no entities at all, show helpful message
  if (tools.length === 0 && triggers.length === 0 && connectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Info className="w-8 h-8 text-muted-foreground/25" />
        <p className="text-sm text-muted-foreground/60">
          This template has no configurable components -- proceed to Connect.
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
