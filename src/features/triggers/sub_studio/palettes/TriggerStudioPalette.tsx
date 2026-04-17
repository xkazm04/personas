import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Zap, Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import {
  TRIGGER_BLOCK_TEMPLATES,
  DEFAULT_CONDITION_BRANCHES,
  type TriggerBlockTemplate,
  type ConditionBranch,
} from '../libs/triggerStudioConstants';
import type { Persona } from '@/lib/bindings/Persona';

interface Props {
  personas: Persona[];
  onAddTriggerSource: (template: TriggerBlockTemplate) => void;
  onAddPersonaStep: (persona: Persona) => void;
  onAddConditionGate: (label: string, branches: ConditionBranch[]) => void;
}

export function TriggerStudioPalette({ personas, onAddTriggerSource, onAddPersonaStep, onAddConditionGate }: Props) {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ triggers: true, personas: true, logic: true });

  const toggle = (id: string) => setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-primary/10">
        <h3 className="text-xs font-semibold text-foreground/80 tracking-wide">{t.triggers.studio.building_blocks}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">{t.triggers.studio.drag_or_click_to_add}</p>
      </div>

      {/* Trigger Sources */}
      <div className="border-b border-primary/5">
        <button
          onClick={() => toggle('triggers')}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
        >
          {expandedSections.triggers ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-medium text-foreground/80">{t.triggers.studio.trigger_sources}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/60">{TRIGGER_BLOCK_TEMPLATES.length}</span>
        </button>

        {expandedSections.triggers && (
          <div className="px-2 pb-2 space-y-0.5">
            {TRIGGER_BLOCK_TEMPLATES.map(template => {
              const Icon = template.icon;
              return (
                <button
                  key={template.id}
                  onClick={() => onAddTriggerSource(template)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors group"
                >
                  <div className={`w-6 h-6 rounded flex items-center justify-center bg-amber-500/10 ${template.color}`}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-[11px] text-foreground/80 group-hover:text-foreground truncate">{template.label}</span>
                    <span className="text-[9px] text-muted-foreground/60 truncate">{template.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Persona Steps */}
      <div className="border-b border-primary/5">
        <button
          onClick={() => toggle('personas')}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
        >
          {expandedSections.personas ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          <Bot className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-medium text-foreground/80">{t.triggers.studio.persona_steps}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/60">{personas.length}</span>
        </button>

        {expandedSections.personas && (
          <div className="px-2 pb-2 space-y-0.5 max-h-[240px] overflow-y-auto">
            {personas.map(persona => (
              <button
                key={persona.id}
                onClick={() => onAddPersonaStep(persona)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors group"
              >
                <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="lg" />
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-[11px] text-foreground/80 group-hover:text-foreground truncate">{persona.name}</span>
                  <span className="text-[9px] text-muted-foreground/60 truncate">{persona.description ?? 'Agent'}</span>
                </div>
              </button>
            ))}
            {personas.length === 0 && (
              <p className="text-[10px] text-muted-foreground/50 px-2 py-2">{t.triggers.builder.no_personas_created}</p>
            )}
          </div>
        )}
      </div>

      {/* Logic Gates */}
      <div className="border-b border-primary/5">
        <button
          onClick={() => toggle('logic')}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
        >
          {expandedSections.logic ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          <GitBranch className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-[11px] font-medium text-foreground/80">{t.triggers.studio.logic_gates}</span>
        </button>

        {expandedSections.logic && (
          <div className="px-2 pb-2 space-y-0.5">
            <button
              onClick={() => onAddConditionGate('If / Else', DEFAULT_CONDITION_BRANCHES)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors group"
            >
              <div className="w-6 h-6 rounded flex items-center justify-center bg-violet-500/10">
                <GitBranch className="w-3 h-3 text-violet-400" />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-[11px] text-foreground/80 group-hover:text-foreground">If / Else</span>
                <span className="text-[9px] text-muted-foreground/60">Binary conditional branch</span>
              </div>
            </button>

            <button
              onClick={() => onAddConditionGate('Classifier', [
                { id: 'support', label: 'Support', color: '#3b82f6' },
                { id: 'sales', label: 'Sales', color: '#10b981' },
                { id: 'other', label: 'Other', color: '#6b7280' },
              ])}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors group"
            >
              <div className="w-6 h-6 rounded flex items-center justify-center bg-violet-500/10">
                <GitBranch className="w-3 h-3 text-violet-400" />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-[11px] text-foreground/80 group-hover:text-foreground">Classifier</span>
                <span className="text-[9px] text-muted-foreground/60">Multi-way routing (support, sales, ...)</span>
              </div>
            </button>

            <button
              onClick={() => onAddConditionGate('Fan-Out', [
                { id: 'parallel-1', label: 'Branch A', color: '#6366f1' },
                { id: 'parallel-2', label: 'Branch B', color: '#8b5cf6' },
                { id: 'parallel-3', label: 'Branch C', color: '#a855f7' },
              ])}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors group"
            >
              <div className="w-6 h-6 rounded flex items-center justify-center bg-violet-500/10">
                <GitBranch className="w-3 h-3 text-violet-400" />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-[11px] text-foreground/80 group-hover:text-foreground">Fan-Out (Parallel)</span>
                <span className="text-[9px] text-muted-foreground/60">Run multiple branches in parallel</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="px-3 py-3 mt-auto">
        <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
          Connect trigger sources to persona steps to build reactive chains.
          Add condition gates for branching logic and parallel fan-out.
        </p>
      </div>
    </div>
  );
}
