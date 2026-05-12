/**
 * Variant 2 — Phased tabbed shelf.
 *
 * Metaphor: a multi-page persona spec, not a long scroll. The four
 * conceptual phases of a persona — Brief (who am I + what do I say),
 * Capabilities (what can I touch), Wiring (when do I fire + where do
 * results go), and Tests (will it actually run) — each become a
 * stage in a header pill strip. Only one stage mounts at a time, so
 * the page never grows past one screen. Cmd/Ctrl+1..4 jumps between
 * stages. Each pill carries a small counter chip showing what it
 * holds, plus a coloured status dot when the stage has incomplete
 * setup (matches the SetupStatusBadge convention).
 */
import { useState, useEffect, useCallback } from 'react';
import { Pencil, FileText, Plug, Zap, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { ConnectorsSection } from '@/features/templates/sub_generated/design-preview/ConnectorsSection';
import { EventsSection } from '@/features/templates/sub_generated/design-preview/EventsSection';
import { MessagesSection } from '@/features/templates/sub_generated/design-preview/MessagesSection';
import { DesignTestResults } from '@/features/templates/sub_generated/design-preview/DesignTestResults';
import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { allIndices } from '../DesignTabHelpers';
import type { DesignPhasePanelSavedVariantProps } from './DesignPhasePanelSavedVariant1';

type StageKey = 'brief' | 'capabilities' | 'wiring' | 'tests';

interface Stage {
  key: StageKey;
  label: string;
  Icon: typeof FileText;
  counter: string | null;
  /** When set, the pill carries a coloured dot signalling status of the stage. */
  status?: 'ok' | 'warn' | 'error';
}

export function DesignPhasePanelSavedVariant2(props: DesignPhasePanelSavedVariantProps) {
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

  const connectorCount = result.suggested_connectors?.length ?? 0;
  const toolCount = result.suggested_tools?.length ?? 0;
  const triggerCount = result.suggested_triggers?.length ?? 0;
  const subCount = result.suggested_event_subscriptions?.length ?? 0;

  // Setup signal — instant-adopted personas often start with
  // setup_status='needs_credentials', surfaced as a yellow dot on the
  // Capabilities stage. Tests stage shows red on blocked feasibility,
  // yellow on partial.
  const capabilitiesStatus: Stage['status'] | undefined =
    selectedPersona.setup_status === 'needs_credentials' ? 'warn' : undefined;
  const testsStatus: Stage['status'] | undefined = result.feasibility
    ? result.feasibility.overall_feasibility === 'blocked'
      ? 'error'
      : result.feasibility.overall_feasibility === 'partial'
        ? 'warn'
        : 'ok'
    : undefined;

  const stages: Stage[] = [
    {
      key: 'brief',
      label: 'Brief',
      Icon: FileText,
      counter: null,
    },
    {
      key: 'capabilities',
      label: 'Capabilities',
      Icon: Plug,
      counter: `${connectorCount + toolCount}`,
      status: capabilitiesStatus,
    },
    {
      key: 'wiring',
      label: 'Wiring',
      Icon: Zap,
      counter: `${triggerCount + subCount + channels.length}`,
    },
    ...(result.feasibility
      ? [
          {
            key: 'tests' as StageKey,
            label: 'Tests',
            Icon: FlaskConical,
            counter: null,
            status: testsStatus,
          },
        ]
      : []),
  ];

  const [active, setActive] = useState<StageKey>('brief');

  // Keyboard nav: Cmd/Ctrl+1..4 jumps between stages. Skip when typing
  // in the refinement textarea (focused state).
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const idx = parseInt(e.key, 10);
      if (Number.isNaN(idx) || idx < 1 || idx > stages.length) return;
      e.preventDefault();
      const stage = stages[idx - 1];
      if (stage) setActive(stage.key);
    },
    [stages],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    <div className="space-y-4">
      {/* Stage pill strip */}
      <div className="flex items-center gap-2 flex-wrap">
        {stages.map((stage, idx) => {
          const isCurrent = stage.key === active;
          const { Icon } = stage;
          const dotColor =
            stage.status === 'ok'
              ? 'bg-status-success'
              : stage.status === 'warn'
                ? 'bg-status-warning'
                : stage.status === 'error'
                  ? 'bg-status-error'
                  : '';
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => setActive(stage.key)}
              className={`group inline-flex items-center gap-2 px-3.5 py-2 rounded-card border transition-all ${
                isCurrent
                  ? 'bg-foreground/[0.06] border-border text-foreground shadow-elevation-1'
                  : 'bg-transparent border-transparent text-foreground/70 hover:bg-foreground/[0.03] hover:text-foreground'
              }`}
              aria-pressed={isCurrent}
            >
              <span className="text-xs font-mono text-foreground/40 tabular-nums">
                {idx + 1}
              </span>
              <Icon className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-foreground/60'}`} />
              <span className="text-sm font-semibold">{stage.label}</span>
              {stage.counter && (
                <span
                  className={`px-1.5 py-0.5 rounded-input text-xs font-mono tabular-nums ${
                    isCurrent ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.05] text-foreground/60'
                  }`}
                >
                  {stage.counter}
                </span>
              )}
              {stage.status && (
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              )}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-foreground/40 hidden md:inline font-mono tabular-nums">
          ⌘ 1–{stages.length}
        </span>
      </div>

      {/* Body — only the active stage mounts */}
      <div className="space-y-6">
        {active === 'brief' && <BriefStage result={result} />}
        {active === 'capabilities' && (
          <CapabilitiesStage
            result={result}
            toolDefinitions={toolDefinitions}
            currentToolNames={currentToolNames}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
          />
        )}
        {active === 'wiring' && (
          <WiringStage result={result} selectedPersona={selectedPersona} channels={channels} />
        )}
        {active === 'tests' && result.feasibility && (
          <DesignTestResults result={result.feasibility} />
        )}
      </div>

      {/* Refinement input — always at the bottom regardless of stage */}
      <div className="pt-3 border-t border-border space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-foreground/60">
          <Pencil className="w-3 h-3" />
          <span>{t.agents.design.current_config_preserved}</span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder={t.agents.design.describe_changes_placeholder}
            className="flex-1 min-h-[56px] max-h-[120px] bg-background/50 border border-border rounded-input px-3 py-2 text-sm text-foreground font-sans resize-y focus-ring focus-visible:border-primary/40 transition-all placeholder-foreground/30"
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
            className={`flex items-center gap-1.5 px-3 py-2 rounded-input text-sm font-medium transition-all ${
              !instruction.trim()
                ? 'bg-secondary/40 text-foreground/40 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.agents.design.update_design}
          </button>
        </div>
        <p className="text-xs text-foreground/55 px-1">{t.agents.design.enter_submit_hint}</p>
      </div>
    </div>
  );
}

function BriefStage({ result }: { result: AgentIR }) {
  return (
    <div className="space-y-6">
      {result.summary && (
        <div className="rounded-card border border-border bg-foreground/[0.02] px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-foreground/55 font-semibold mb-1.5">
            Summary
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
        </div>
      )}
      <PromptTabsPreview designResult={result} />
    </div>
  );
}

function CapabilitiesStage({
  result,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
}: {
  result: AgentIR;
  toolDefinitions: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}) {
  return (
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
  );
}

function WiringStage({
  result,
  selectedPersona,
  channels,
}: {
  result: AgentIR;
  selectedPersona: PersonaWithDetails;
  channels: NonNullable<AgentIR['suggested_notification_channels']>;
}) {
  return (
    <div className="space-y-6">
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
      {channels.length > 0 && (
        <MessagesSection
          channels={channels}
          selectedChannelIndices={allIndices(channels)}
          readOnly
        />
      )}
    </div>
  );
}
