import { useMemo } from 'react';
import { Plug, Bell } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConnectorsSection } from '@/features/templates/sub_generated/design-preview/ConnectorsSection';
import { EventsSection } from '@/features/templates/sub_generated/design-preview/EventsSection';
import { MessagesSection } from '@/features/templates/sub_generated/design-preview/MessagesSection';
import { useTranslation } from '@/i18n/useTranslation';
import { useSavedDesignResult } from '../libs/designStateHelpers';
import { allIndices } from '../DesignTabHelpers';
import { PersonaParametersCard } from './PersonaParametersCard';
import { TriggerConfig } from '@/features/triggers/sub_triggers/TriggerConfig';

/**
 * The Design hub's section sub-tabs. Each renders the same read-only
 * design-result section the Properties (Prompt) sub-tab used to stack inline,
 * driven by the persona's saved design (`useSavedDesignResult`). When the
 * relevant dimension is empty (most commonly: the agent hasn't been designed
 * yet) a quiet empty state stands in instead of a blank panel.
 */

const NOOP = () => {};

function SectionEmpty({ icon, title }: { icon: typeof Plug; title: string }) {
  return (
    <div className="py-12">
      <EmptyState icon={icon} title={title} />
    </div>
  );
}

/** Parameters — the live, tunable persona parameters (no design needed).
 *  The A/B layout switcher + the no-parameters empty state both live inside
 *  PersonaParametersCard, so the switcher is always visible on this subtab
 *  (it used to be hidden whole when the persona declared no parameters). */
export function DesignParametersPanel() {
  return <PersonaParametersCard />;
}

/** Connectors & Tools — read-only view of the saved design's connectors. */
export function DesignConnectorsPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const toolDefinitions = useAgentStore((s) => s.toolDefinitions);
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const saved = useSavedDesignResult(selectedPersona);
  const selectedTools = useMemo(() => new Set(saved?.suggested_tools ?? []), [saved]);

  const isEmpty =
    !saved ||
    ((saved.suggested_connectors?.length ?? 0) === 0 && (saved.suggested_tools?.length ?? 0) === 0);
  if (isEmpty) return <SectionEmpty icon={Plug} title={t.agents.design_subtabs.connectors} />;

  return (
    <ConnectorsSection
      result={saved}
      allToolDefs={toolDefinitions}
      currentToolNames={[]}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      selectedTools={selectedTools}
      onToolToggle={NOOP}
      readOnly
    />
  );
}

/**
 * Events & Triggers. Live trigger management (create / arm / disarm / delete)
 * via `TriggerConfig`, plus a read-only view of any event subscriptions the
 * original build proposed.
 *
 * Was previously read-only only (`onTriggerToggle={NOOP}`), so this — the sub-tab
 * a user opens to manage triggers — offered no way to create one; the only
 * self-service create path in the whole app was the type-locked Studio commit
 * modal (UAT 2026-07-20, CM-STA-02). The Design tab is ungated, so mounting the
 * manager here also gives Starter users (who can't reach the TEAM-gated Events
 * section) a trigger surface at last.
 */
export function DesignEventsPanel() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const saved = useSavedDesignResult(selectedPersona);

  // Show the design's proposed subscriptions read-only (TriggerConfig doesn't
  // manage bus subscriptions). Suggested *triggers* are intentionally not shown
  // here — once promoted they are live triggers, already listed+editable by
  // TriggerConfig above, so surfacing them again would duplicate the list.
  const hasSubscriptions = (saved?.suggested_event_subscriptions?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <TriggerConfig />
      {saved && hasSubscriptions && (
        <EventsSection
          result={{ ...saved, suggested_triggers: [] }}
          selectedTriggerIndices={allIndices([])}
          onTriggerToggle={NOOP}
          suggestedSubscriptions={saved.suggested_event_subscriptions}
          selectedSubscriptionIndices={allIndices(saved.suggested_event_subscriptions)}
          readOnly
          actualTriggers={[]}
        />
      )}
    </div>
  );
}

/** Notifications — read-only view of the saved design's message channels. */
export function DesignNotificationsPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const saved = useSavedDesignResult(selectedPersona);
  const channels = useMemo(
    () => (Array.isArray(saved?.suggested_notification_channels) ? saved.suggested_notification_channels : []),
    [saved],
  );

  if (channels.length === 0) return <SectionEmpty icon={Bell} title={t.agents.design_subtabs.messaging} />;

  return (
    <MessagesSection
      channels={channels}
      selectedChannelIndices={allIndices(channels)}
      readOnly
    />
  );
}
