import { useCallback } from 'react';

import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBody, ContentBox } from '@/features/shared/components/layout/ContentLayout';
import ResumeBanner from '@/features/home/sub_welcome/ResumeBanner';
import WelcomeGetStarted from '@/features/home/sub_welcome/WelcomeGetStarted';

import { CockpitHeader } from './panel/CockpitHeader';
import { CockpitGrid } from './panel/CockpitGrid';
import { CockpitEmpty, CockpitError, CockpitGhost } from './panel/CockpitStates';
import { useCockpitSource } from './panel/useCockpitSource';

/**
 * Home > Cockpit. The spec is composed by Athena via `compose_cockpit` and
 * persisted server-side as a singleton; a transient contextual overlay
 * (explain, message, Morning briefing) replaces it while it shows; a fleet that
 * was never composed gets the deterministic starter cockpit. The body is one
 * kit Tiles grid in which every widget is its own Tile.
 *
 * The header's Talk to Athena opens the companion chat; the empty state's call
 * to action seeds her with a compose request.
 */
export default function CockpitPanel() {
  const { t } = useTranslation();
  const setCompanionState = useAthenaStore((s) => s.setState);
  const { phase, body, contextual, exitContextual, reload } = useCockpitSource();

  // Empty-state CTA: seed Athena with a concrete "compose a persona overview
  // cockpit" request and auto-send it, then open the chat panel so the user
  // sees the composition stream in (ReportDetailModal's preset+autoSend pattern).
  const composePersonaCockpit = useCallback(() => {
    useAthenaStore.getState().setPendingPrompt({
      text: t.overview.cockpit.compose_personas_prompt,
      autoSend: true,
    });
    setCompanionState('open');
  }, [t, setCompanionState]);

  return (
    <ContentBox data-testid="cockpit-panel">
      <CockpitHeader
        phase={phase}
        body={body}
        contextual={contextual}
        onExit={exitContextual}
        onTalk={() => setCompanionState('open')}
      />
      {/* Not `centered`: a capped, centred body started 68px right of the
          header at 1920 (two left edges). The inner padding completes the
          body's own to the header's, so the tiles' rail sits under its icon. */}
      <ContentBody>
        <div className="px-1 md:px-2 xl:px-3 flex flex-col gap-3">
          {/* The ranked continue pointer (failed run / paused tour / last
              edit); renders nothing when there is no signal. */}
          <div className="empty:hidden">
            <ResumeBanner />
          </div>
          {/* First-run Build / Ask band; renders nothing once the profile has
              a persona or onboarding is complete. */}
          <div className="empty:hidden">
            <WelcomeGetStarted />
          </div>
          {phase === 'loading' ? (
            <CockpitGhost />
          ) : phase === 'error' ? (
            <CockpitError onRetry={reload} />
          ) : phase === 'empty' ? (
            <CockpitEmpty onTalk={composePersonaCockpit} />
          ) : (
            <CockpitGrid label={body?.title || t.overview.cockpit.title_default} widgets={body?.widgets ?? []} />
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
