import { useState } from 'react';
import { Check, Pin, Loader2 } from 'lucide-react';
import { cockpitWidgetRegistry } from '@/features/home/components/cockpit/widgetRegistry';
import { companionPinWidgetToCockpit, type ChatCard } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';

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
        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-interactive bg-secondary/90 border border-foreground/15 typo-caption text-foreground/75 hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-100 disabled:cursor-default transition-opacity"
        data-testid="companion-pin-to-cockpit"
      >
        <PinIcon
          className={`w-3 h-3 ${pinState === 'pinning' ? 'animate-spin' : ''}`}
        />
        <span className="text-foreground/60">{pinLabel}</span>
      </button>
    </div>
  );
}
