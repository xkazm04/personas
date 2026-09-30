import { Compass, Rocket } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint, KitButton, Tile } from '@/features/shared/components/kit';
import { useSystemStore } from '@/stores/systemStore';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
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
export function PersonaCreationOfferWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent = typeof config?.intent === 'string' ? config.intent.trim() : '';

  const buildItForMe = () => {
    const sys = useSystemStore.getState();
    sys.setAthenaPrefill({
      intent,
      name: null,
      autoLaunch: false,
      mode: 'interactive',
      companionSessionId: null,
    });
    sys.setSidebarSection('personas');
  };

  const showMeHow = () => {
    useAthenaStore.getState().startGuidance('persona_creation');
  };

  // One call to action: Build is the primary; Show me is the plain second
  // choice. What each one does is its Hint, not a line on the surface.
  return (
    <Tile
      span={span}
      title={title || t.athena.offer_intro}
      actions={actions}
      meta={intent || undefined}
      testId="companion-offer-widget"
      footer={
        <>
          <Hint content={t.athena.offer_build_hint}>
            <span>
              <KitButton tone="primary" icon={<Rocket />} onClick={buildItForMe} testId="companion-offer-build">
                {t.athena.offer_build}
              </KitButton>
            </span>
          </Hint>
          <Hint content={t.athena.offer_show_hint}>
            <span>
              <KitButton icon={<Compass />} onClick={showMeHow} testId="companion-offer-show">
                {t.athena.offer_show}
              </KitButton>
            </span>
          </Hint>
          {footer}
        </>
      }
    />
  );
}
