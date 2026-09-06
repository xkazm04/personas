import { useState } from 'react';
import { Check, Pin, Loader2 } from 'lucide-react';
import { cockpitWidgetRegistry } from '@/features/home/sub_cockpit/widgetRegistry';
import { companionPinWidgetToCockpit, type ChatCard } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { AthenaFleetPlanCard } from './fleet/AthenaFleetPlanCard';
import { AthenaShipMilestoneCard } from './ship/AthenaShipMilestoneCard';
import { AthenaShipGoalsCard } from './ship/AthenaShipGoalsCard';
import { AthenaNoteSuggestionsCard } from './notepad/AthenaNoteSuggestionsCard';

/**
 * Kinds that render long-form content and should NOT be height-clamped
 * to the 260px dashboard tile size. The chat scroll handles overflow
 * naturally; trapping a multi-paragraph walkthrough inside a 260px box
 * makes it unreadable.
 */
const UNCLAMPED_KINDS = new Set([
  'persona_walkthrough',
  'template_suggestions',
  'use_case_set',
  'browser_test_report',
  'trigger_set',
  'model_tier_choice',
  'observability_plan',
  'decision_log',
  'persona_ready',
  'design_capabilities',
  'recent_decisions',
]);

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
 * One inline chat-card rendered inside the chat transcript. Wraps the
 * corresponding cockpit widget at a compact size so it fits the panel's
 * 380-760px width.
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

  const Component = cockpitWidgetRegistry[card.kind];
  if (!Component) {
    return (
      <div
        className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-3 typo-caption text-rose-300"
        title={card.kind}
      >
        {t.plugins.companion.chat_card_unknown_kind}
      </div>
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
      addToast(t.plugins.companion.pin_to_cockpit_success, 'success');
    } catch (err: unknown) {
      setPinState('idle');
      toastCatch('companion_pin_widget_to_cockpit')(err);
    }
  };

  const PinIcon =
    pinState === 'pinning' ? Loader2 : pinState === 'pinned' ? Check : Pin;
  const pinDisabled = pinState !== 'idle';
  const pinLabel =
    pinState === 'pinned'
      ? t.plugins.companion.pin_to_cockpit_pinned
      : t.plugins.companion.pin_to_cockpit;
  const showPin = PINNABLE_KINDS.has(card.kind);

  const inner = UNCLAMPED_KINDS.has(card.kind) ? (
    <Component title={card.title} config={card.config} />
  ) : (
    <div className="h-[260px]">
      <Component title={card.title} config={card.config} />
    </div>
  );

  if (!showPin) {
    return inner;
  }

  return (
    <div className="relative group">
      {inner}
      <button
        type="button"
        onClick={handlePin}
        disabled={pinDisabled}
        aria-label={pinLabel}
        title={pinLabel}
        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-interactive bg-secondary/90 border border-foreground/15 typo-caption text-foreground hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-100 disabled:cursor-default transition-opacity"
        data-testid="companion-pin-to-cockpit"
      >
        <PinIcon
          className={`w-3 h-3 ${pinState === 'pinning' ? 'animate-spin' : ''}`}
        />
        <span className="text-foreground">{pinLabel}</span>
      </button>
    </div>
  );
}
