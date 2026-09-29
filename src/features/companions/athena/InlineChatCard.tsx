import { useState } from 'react';
import { Check, Pin } from 'lucide-react';
import { cockpitWidgetRegistry } from '@/features/home/sub_cockpit/widgetRegistry';
import { KitButton, KitHost, Tile } from '@/features/shared/components/kit';
import { companionPinWidgetToCockpit, type ChatCard } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { AthenaFleetPlanCard } from './fleet/AthenaFleetPlanCard';
import { AthenaShipMilestoneCard } from './ship/AthenaShipMilestoneCard';
import { AthenaShipGoalsCard } from './ship/AthenaShipGoalsCard';
import { AthenaNoteSuggestionsCard } from './notepad/AthenaNoteSuggestionsCard';
import { LifecycleProposalCard } from './lifecycle/LifecycleProposalCard';
import { ReportCard } from './chat/refs/ReportCard';

/**
 * Kinds for which "Pin to cockpit" makes sense. Dashboard-shaped widgets
 * are pinnable; advisory/one-shot suggestions (walkthrough, template
 * matches, use-case decomposition) are not — they're read-once shapes,
 * not persistent surfaces.
 */
const PINNABLE_KINDS = new Set([
  'persona_overview',
  'connected_services',
  'decisions_panel',
  'metric_spark',
  'issue_list',
  'text_callout',
]);

/**
 * One inline chat-card rendered inside the chat transcript: the cockpit
 * widget's own kit Tile in a compact KitHost, stacked by `AthenaChatCards`
 * (`Tiles cols={1}`). No height clamp: the chat scrolls, never a card (the old
 * 260px box cut lists mid-row and left a metric mostly empty). "Pin to
 * cockpit" is the host's head action, handed to the widget's Tile.
 *
 * Cards are emitted by `show_persona_overview` / `show_connected_services` /
 * `show_decisions` / `show_persona_walkthrough` ops. Companion picks the
 * moment — these aren't tied to an approval card and don't ask the user
 * to do anything; they're contextual UI snippets that ride along with
 * the chat reply.
 */
export function InlineChatCard({ card }: { card: ChatCard }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [pinState, setPinState] = useState<'idle' | 'pinning' | 'pinned'>('idle');

  // A `report` (layered voice, layer two) is a one-line link into the report
  // reader, never a widget: the report's body is the thing to read, and it is
  // read in the reader, not squeezed into a tile.
  if (card.kind === 'report') {
    return <ReportCard card={card} />;
  }

  // `fleet_plan` is deliberately NOT a cockpit widget: it is an actionable
  // proposal that starts real CLI sessions on confirm, so it must never be
  // pinnable to a dashboard or re-rendered outside the chat that consented to
  // it. Chat is its only dimension. `cardId` is its durable row: it lets the
  // card write its post-confirm outcome back, survive a refresh, and be
  // claimed exactly once at dispatch.
  if (card.kind === 'fleet_plan') {
    return <AthenaFleetPlanCard config={card.config} title={card.title} cardId={card.id} />;
  }

  // `ship_milestone` makes the same call as `fleet_plan` and for the same
  // reason: it is an actionable proposal that WRITES on confirm (a milestone
  // plus its scope members), so it is deliberately absent from the cockpit
  // widget registry. A pinned copy would be a create button with no
  // conversation behind it.
  if (card.kind === 'ship_milestone') {
    return (
      <AthenaShipMilestoneCard config={card.config} title={card.title} cardId={card.id} />
    );
  }

  // `ship_goals` joins the same family for the same reason: confirming it
  // CREATES `dev_goals` rows and binds them to a milestone. A pinned copy
  // would be a create button with no conversation behind it.
  if (card.kind === 'ship_goals') {
    return <AthenaShipGoalsCard config={card.config} title={card.title} cardId={card.id} />;
  }

  // `note_suggestions` is actionable for a different reason than the three
  // above: it is not confirmed in one click, its rows are ANSWERED one at a
  // time, and each answer writes into a document. Pinning a half-answered set
  // of edit proposals to a dashboard would be a set of Accept buttons with no
  // note in front of them, so it is deliberately not pinnable either.
  if (card.kind === 'note_suggestions') {
    return (
      <AthenaNoteSuggestionsCard config={card.config} title={card.title} cardId={card.id} />
    );
  }

  // `lifecycle_proposal` (Lifecycle v2) writes a new lifecycle version and can
  // start a repo install on confirm, so it is chat-only like the cards above.
  // Its confirm needs `cardId`: the backend reads the proposal back by id.
  if (card.kind === 'lifecycle_proposal') {
    return <LifecycleProposalCard config={card.config} title={card.title} cardId={card.id} />;
  }

  const Component = cockpitWidgetRegistry[card.kind];
  if (!Component) {
    return (
      <KitHost compact>
        <Tile error={{ title: t.athena.chat_card_unknown_kind, hint: card.kind }} />
      </KitHost>
    );
  }

  const handlePin = async () => {
    if (pinState !== 'idle') return;
    setPinState('pinning');
    try {
      await companionPinWidgetToCockpit({
        kind: card.kind,
        title: card.title ?? null,
        config: (card.config ?? {}) as Record<string, unknown>,
      });
      setPinState('pinned');
      addToast(t.athena.pin_to_cockpit_success, 'success');
    } catch (err: unknown) {
      setPinState('idle');
      toastCatch('companion_pin_widget_to_cockpit')(err);
    }
  };

  const pinLabel =
    pinState === 'pinned'
      ? t.athena.pin_to_cockpit_pinned
      : t.athena.pin_to_cockpit;
  const pin = PINNABLE_KINDS.has(card.kind) ? (
    <KitButton
      tone="quiet"
      icon={pinState === 'pinned' ? <Check /> : <Pin />}
      loading={pinState === 'pinning'}
      disabled={pinState === 'pinned'}
      onClick={handlePin}
      testId="companion-pin-to-cockpit"
    >
      {pinLabel}
    </KitButton>
  ) : undefined;

  return (
    <KitHost compact>
      <Component title={card.title} config={card.config} actions={pin} />
    </KitHost>
  );
}
