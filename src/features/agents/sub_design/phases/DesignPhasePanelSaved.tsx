import { useState } from 'react';
import { Pencil, LayoutList, Columns3, Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DesignResultPreview } from '@/features/templates/sub_generated';
import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { allIndices } from '../DesignTabHelpers';
import { DesignPhasePanelSavedVariant1 } from './DesignPhasePanelSavedVariant1';
import { DesignPhasePanelSavedVariant2 } from './DesignPhasePanelSavedVariant2';

interface DesignPhasePanelSavedProps {
  savedDesignResult: AgentIR;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  instruction: string;
  onInstructionChange: (value: string) => void;
  onStartAnalysis: () => void;
}

type Variant = 'baseline' | 'outline' | 'stages';

const VARIANTS: Array<{
  key: Variant;
  label: string;
  subtitle: string;
  Icon: typeof LayoutList;
}> = [
  {
    key: 'baseline',
    label: 'Stack',
    subtitle: 'Original — every section, top to bottom',
    Icon: LayoutList,
  },
  {
    key: 'outline',
    label: 'Outline',
    subtitle: 'Left rail with section anchors',
    Icon: Columns3,
  },
  {
    key: 'stages',
    label: 'Stages',
    subtitle: 'Brief / Capabilities / Wiring / Tests',
    Icon: Layers,
  },
];

export function DesignPhasePanelSaved(props: DesignPhasePanelSavedProps) {
  const [variant, setVariant] = useState<Variant>('baseline');
  return (
    <>
      <VariantSwitcher variant={variant} onChange={setVariant} />
      {variant === 'baseline' && <DesignPhasePanelSavedBaseline {...props} />}
      {variant === 'outline' && <DesignPhasePanelSavedVariant1 {...props} />}
      {variant === 'stages' && <DesignPhasePanelSavedVariant2 {...props} />}
    </>
  );
}

function VariantSwitcher({
  variant,
  onChange,
}: {
  variant: Variant;
  onChange: (v: Variant) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-1.5 flex-wrap">
      <span className="text-xs uppercase tracking-[0.18em] text-foreground/45 font-semibold mr-1.5">
        Layout
      </span>
      {VARIANTS.map(({ key, label, subtitle, Icon }) => {
        const isCurrent = key === variant;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border text-xs transition-all ${
              isCurrent
                ? 'bg-foreground/[0.06] border-border text-foreground'
                : 'bg-transparent border-transparent text-foreground/60 hover:bg-foreground/[0.03] hover:text-foreground/90'
            }`}
            title={subtitle}
          >
            <Icon className={`w-3.5 h-3.5 ${isCurrent ? 'text-primary' : 'text-foreground/50'}`} />
            <span className="font-semibold">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DesignPhasePanelSavedBaseline({
  savedDesignResult,
  selectedPersona,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
  instruction,
  onInstructionChange,
  onStartAnalysis,
}: DesignPhasePanelSavedProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Read-only overview of saved design */}
      <DesignResultPreview
        result={savedDesignResult}
        allToolDefs={toolDefinitions}
        currentToolNames={currentToolNames}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        selectedTools={new Set(savedDesignResult.suggested_tools)}
        selectedTriggerIndices={allIndices(savedDesignResult.suggested_triggers)}
        selectedChannelIndices={allIndices(savedDesignResult.suggested_notification_channels)}
        suggestedSubscriptions={savedDesignResult.suggested_event_subscriptions}
        selectedSubscriptionIndices={allIndices(savedDesignResult.suggested_event_subscriptions)}
        onToolToggle={() => {}}
        onTriggerToggle={() => {}}
        onChannelToggle={() => {}}
        onConnectorClick={() => {}}
        readOnly
        actualTriggers={selectedPersona.triggers || []}
        feasibility={savedDesignResult.feasibility}
      />

      {/* Chat input for modifications */}
      <div className="pt-2 border-t border-primary/10 space-y-2">
        <div className="flex items-center gap-2 px-1 typo-body text-foreground">
          <Pencil className="w-3 h-3 shrink-0" />
          <span>{t.agents.design.current_config_preserved}</span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder={t.agents.design.describe_changes_placeholder}
            className="flex-1 min-h-[60px] max-h-[120px] bg-background/50 border border-primary/20 rounded-modal px-3 py-2 typo-body text-foreground font-sans resize-y focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (instruction.trim()) onStartAnalysis();
              }
            }}
          />
          <button
            onClick={onStartAnalysis}
            disabled={!instruction.trim()}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium transition-all ${
              !instruction.trim()
                ? 'bg-secondary/40 text-foreground cursor-not-allowed'
                : 'bg-gradient-to-r from-primary to-accent text-foreground shadow-elevation-3 shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.agents.design.update_design}
          </button>
        </div>
        <p className="typo-body text-foreground px-1">{t.agents.design.enter_submit_hint}</p>
      </div>
    </>
  );
}
