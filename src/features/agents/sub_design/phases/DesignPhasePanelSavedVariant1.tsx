/**
 * Variant 1 — Left rail outline with sticky anchors.
 *
 * Metaphor: a long technical document with a navigable outline. The
 * single-column layout of the baseline becomes a two-column layout
 * (220px nav + main content). Each section renders inline as before
 * (same components, unchanged content), but each is wrapped in a
 * `<section id>` anchor so the rail can scroll to it. The rail entries
 * carry counts (`3 tools`, `2 triggers`) so the user knows what they're
 * jumping to before clicking. Borrowed visual language from
 * `QuestionnaireCategoryRail` so it reads as part of the same family.
 */
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Pencil, Brain, Plug, Zap, MessageSquare, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { ConnectorsSection } from '@/features/templates/sub_generated/design-preview/ConnectorsSection';
import { EventsSection } from '@/features/templates/sub_generated/design-preview/EventsSection';
import { MessagesSection } from '@/features/templates/sub_generated/design-preview/MessagesSection';
import { DesignTestResults } from '@/features/templates/sub_generated/design-preview/DesignTestResults';
import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { allIndices } from '../DesignTabHelpers';

export interface DesignPhasePanelSavedVariantProps {
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

interface NavEntry {
  key: string;
  label: string;
  Icon: typeof Brain;
  count: number | null;
  countSuffix: string;
}

export function DesignPhasePanelSavedVariant1(props: DesignPhasePanelSavedVariantProps) {
  const { t } = useTranslation();
  const {
    savedDesignResult: result,
    selectedPersona,
    toolDefinitions,
    currentToolNames,
    credentials,
    connectorDefinitions,
    instruction,
    onInstructionChange,
    onStartAnalysis,
  } = props;

  const channels = Array.isArray(result.suggested_notification_channels)
    ? result.suggested_notification_channels
    : [];

  const navEntries = useMemo<NavEntry[]>(() => {
    const entries: NavEntry[] = [];
    const sp = result.structured_prompt;
    const promptSectionCount =
      [sp.identity, sp.instructions, sp.toolGuidance, sp.examples, sp.errorHandling].filter(Boolean).length +
      (sp.customSections?.length ?? 0);
    if (promptSectionCount > 0) {
      entries.push({
        key: 'prompt',
        label: 'Identity & Instructions',
        Icon: Brain,
        count: promptSectionCount,
        countSuffix: promptSectionCount === 1 ? 'section' : 'sections',
      });
    }
    const connectorCount = result.suggested_connectors?.length ?? 0;
    const toolCount = result.suggested_tools?.length ?? 0;
    if (connectorCount > 0 || toolCount > 0) {
      const label = connectorCount > 0 ? `${connectorCount} connectors · ${toolCount} tools` : `${toolCount} tools`;
      entries.push({
        key: 'connectors',
        label: 'Connectors & Tools',
        Icon: Plug,
        count: connectorCount + toolCount,
        countSuffix: label,
      });
    }
    const triggerCount = result.suggested_triggers?.length ?? 0;
    const subCount = result.suggested_event_subscriptions?.length ?? 0;
    if (triggerCount > 0 || subCount > 0) {
      const label = subCount > 0 ? `${triggerCount} triggers · ${subCount} events` : `${triggerCount} triggers`;
      entries.push({
        key: 'events',
        label: 'Triggers & Events',
        Icon: Zap,
        count: triggerCount + subCount,
        countSuffix: label,
      });
    }
    if (channels.length > 0) {
      entries.push({
        key: 'messages',
        label: 'Outputs',
        Icon: MessageSquare,
        count: channels.length,
        countSuffix: channels.length === 1 ? 'channel' : 'channels',
      });
    }
    if (result.feasibility) {
      entries.push({
        key: 'tests',
        label: 'Feasibility',
        Icon: FlaskConical,
        count: null,
        countSuffix: result.feasibility.overall_feasibility,
      });
    }
    return entries;
  }, [result, channels.length]);

  const [activeKey, setActiveKey] = useState(navEntries[0]?.key ?? '');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Scroll-spy: highlight the rail entry whose section is currently topmost.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = () => {
      let best: { key: string; distance: number } | null = null;
      for (const entry of navEntries) {
        const el = sectionRefs.current[entry.key];
        if (!el) continue;
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
        const distance = Math.abs(top - 60); // bias slightly above container top
        if (top <= 100 && (!best || distance < best.distance)) {
          best = { key: entry.key, distance };
        }
      }
      if (best && best.key !== activeKey) setActiveKey(best.key);
    };
    container.addEventListener('scroll', handler, { passive: true });
    return () => container.removeEventListener('scroll', handler);
  }, [navEntries, activeKey]);

  const jump = useCallback((key: string) => {
    setActiveKey(key);
    const el = sectionRefs.current[key];
    const container = containerRef.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.offsetTop - 16;
    container.scrollTo({ top, behavior: 'smooth' });
  }, []);

  const setSectionRef = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      sectionRefs.current[key] = el;
    },
    [],
  );

  return (
    <div className="flex gap-4 h-[calc(100vh-22rem)] min-h-[480px]">
      {/* Left rail */}
      <aside className="w-[220px] flex-shrink-0 border-r border-border bg-foreground/[0.01] flex flex-col min-h-0 rounded-card overflow-hidden">
        <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.2em] text-foreground/60 font-semibold">
            Outline
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {navEntries.map((entry) => {
            const isCurrent = entry.key === activeKey;
            const { Icon } = entry;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => jump(entry.key)}
                className={`w-full text-left rounded-card px-3 py-2.5 transition-all border ${
                  isCurrent
                    ? 'bg-foreground/[0.05] border-border'
                    : 'bg-transparent border-transparent hover:bg-foreground/[0.03]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-foreground/70'}`} />
                  <span className={`flex-1 text-sm font-semibold truncate ${isCurrent ? 'text-foreground' : 'text-foreground/80'}`}>
                    {entry.label}
                  </span>
                </div>
                <span className="block pl-6 text-xs text-foreground/55 truncate">
                  {entry.countSuffix}
                </span>
              </button>
            );
          })}
        </nav>
        {/* Refinement input lives in the rail footer so it stays visible */}
        <div className="flex-shrink-0 border-t border-border p-3 space-y-2 bg-foreground/[0.02]">
          <div className="flex items-center gap-1.5 text-xs text-foreground/60">
            <Pencil className="w-3 h-3" />
            <span>{t.agents.design.current_config_preserved}</span>
          </div>
          <textarea
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder={t.agents.design.describe_changes_placeholder}
            className="w-full min-h-[56px] max-h-[140px] bg-background/50 border border-border rounded-input px-2.5 py-1.5 text-sm text-foreground font-sans resize-y focus-ring focus-visible:border-primary/40 transition-all placeholder-foreground/30"
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
            className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-input text-sm font-medium transition-all ${
              !instruction.trim()
                ? 'bg-secondary/40 text-foreground/40 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            <Pencil className="w-3 h-3" />
            {t.agents.design.update_design}
          </button>
        </div>
      </aside>

      {/* Main column — sections rendered as anchored regions */}
      <div ref={containerRef} className="flex-1 overflow-y-auto pr-2 space-y-8">
        {navEntries.find((e) => e.key === 'prompt') && (
          <section ref={setSectionRef('prompt')} id="design-section-prompt" className="scroll-mt-4">
            <SectionHeading icon={Brain} label="Identity & Instructions" />
            <PromptTabsPreview designResult={result} />
          </section>
        )}

        {navEntries.find((e) => e.key === 'connectors') && (
          <section ref={setSectionRef('connectors')} id="design-section-connectors" className="scroll-mt-4">
            <SectionHeading icon={Plug} label="Connectors & Tools" />
            <ConnectorsSection
              result={result}
              allToolDefs={toolDefinitions}
              currentToolNames={currentToolNames}
              credentials={credentials}
              connectorDefinitions={connectorDefinitions}
              selectedTools={new Set(result.suggested_tools)}
              onToolToggle={() => {}}
              onConnectorClick={() => {}}
              readOnly
            />
          </section>
        )}

        {navEntries.find((e) => e.key === 'events') && (
          <section ref={setSectionRef('events')} id="design-section-events" className="scroll-mt-4">
            <SectionHeading icon={Zap} label="Triggers & Events" />
            <EventsSection
              result={result}
              selectedTriggerIndices={allIndices(result.suggested_triggers)}
              onTriggerToggle={() => {}}
              suggestedSubscriptions={result.suggested_event_subscriptions}
              selectedSubscriptionIndices={allIndices(result.suggested_event_subscriptions)}
              onSubscriptionToggle={() => {}}
              readOnly
              actualTriggers={selectedPersona.triggers || []}
            />
          </section>
        )}

        {navEntries.find((e) => e.key === 'messages') && (
          <section ref={setSectionRef('messages')} id="design-section-messages" className="scroll-mt-4">
            <SectionHeading icon={MessageSquare} label="Outputs" />
            <MessagesSection
              channels={channels}
              selectedChannelIndices={allIndices(channels)}
              readOnly
            />
          </section>
        )}

        {navEntries.find((e) => e.key === 'tests') && result.feasibility && (
          <section ref={setSectionRef('tests')} id="design-section-tests" className="scroll-mt-4">
            <SectionHeading icon={FlaskConical} label="Feasibility" />
            <DesignTestResults result={result.feasibility} />
          </section>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, label }: { icon: typeof Brain; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary/70" />
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{label}</h3>
      <div className="flex-1 h-px bg-border/60 ml-2" />
    </div>
  );
}
