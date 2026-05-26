import { Compass, Rocket, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Two-button offer card Athena emits via `show_persona_creation_offer` when a
 * user describes a persona they want but hasn't said how to proceed:
 *
 *  - "Build it for me" → the standard prefill handoff (intent pre-filled in
 *    UnifiedBuildEntry, interactive mode), identical to the walkthrough card's
 *    commit and the approval-driven `prefill_persona_create` ClientAction.
 *  - "Show me how to build it" → starts the `persona_creation` guided
 *    walkthrough: the orb glides around the build studio, elements glow, and
 *    Athena narrates each step (`startGuidance`).
 *
 * Advisory (not pinnable to the cockpit) — it's a read-once decision surface.
 */
export function PersonaCreationOfferWidget({ config }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent = typeof config?.intent === 'string' ? config.intent.trim() : '';

  const buildItForMe = () => {
    const sys = useSystemStore.getState();
    sys.setCompanionPrefill({
      intent,
      name: null,
      autoLaunch: false,
      mode: 'interactive',
      companionSessionId: null,
    });
    sys.setSidebarSection('personas');
  };

  const showMeHow = () => {
    useCompanionStore.getState().startGuidance('persona_creation');
  };

  return (
    <div
      data-testid="companion-offer-widget"
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
    >
      <header className="flex items-baseline gap-2 typo-caption text-primary">
        <Sparkles className="w-3.5 h-3.5" />
        <span className="font-medium">{t.plugins.companion.offer_intro}</span>
        {intent && (
          <span className="text-foreground truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="companion-offer-build"
          onClick={buildItForMe}
          className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-interactive bg-primary text-primary-foreground hover:opacity-90 focus-ring"
        >
          <Rocket className="w-4 h-4 shrink-0" />
          <span className="flex flex-col">
            <span className="typo-body font-medium">{t.plugins.companion.offer_build}</span>
            <span className="typo-caption opacity-90">{t.plugins.companion.offer_build_hint}</span>
          </span>
        </button>
        <button
          type="button"
          data-testid="companion-offer-show"
          onClick={showMeHow}
          className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-interactive border border-primary/30 bg-secondary/30 text-foreground hover:bg-secondary/50 focus-ring"
        >
          <Compass className="w-4 h-4 shrink-0 text-primary" />
          <span className="flex flex-col">
            <span className="typo-body font-medium">{t.plugins.companion.offer_show}</span>
            <span className="typo-caption text-foreground">{t.plugins.companion.offer_show_hint}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
