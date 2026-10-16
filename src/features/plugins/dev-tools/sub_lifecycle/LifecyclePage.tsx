/**
 * Lifecycle: the development practice of every project, as the Lens
 * (`lifecycleView/lens/LensBody`; contest lifecycle-portfolio-r2, winner A/3;
 * docs/design/lifecycle-lens/migration-plan.md).
 *
 * The page lands on the portfolio. Opening a project focuses Lifecycle on it
 * without touching the app-wide active project (owner, 2026-10-16): the Lens
 * route owns the focused project, and the one view model
 * (`lifecycleView/useLifecycleView`) reads that project's snapshot, so every
 * block below the portfolio - the step screens, Measure, the Overseer
 * hand-off - works on it unchanged.
 *
 * A running Measure is one session for the page (`measure/measureSession`):
 * the top bar's Measure control turns into its live progress, the project
 * plane shows its panel, and Gate and Tests hold their verdict until the last
 * run lands. One time cursor (`history/timeTravel`) spans the project's
 * planes.
 */
import { KitHost } from '@/features/shared/components/kit';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';

import { LifecycleViewProvider } from './lifecycleView/context';
import { TimeTravelProvider } from './lifecycleView/history/timeTravel';
import { LensBody, useLensRoute } from './lifecycleView/lens/LensBody';
import { MeasureAnnouncer } from './lifecycleView/measure/MeasureAnnouncer';
import { MeasureSessionProvider } from './lifecycleView/measure/measureSession';
import { useLifecycleView } from './lifecycleView/useLifecycleView';

export default function LifecyclePage() {
  const [route, dispatch] = useLensRoute();
  const model = useLifecycleView(route.plane === 'project' ? route.projectId : null);

  return (
    <LifecycleViewProvider model={model}>
      <MeasureSessionProvider>
        <ContentBox>
          <div className="flex-1 min-h-0">
            <KitHost>
              <TimeTravelProvider projectId={model.projectId} ready={model.order.length > 0}>
                <MeasureAnnouncer />
                <LensBody route={route} dispatch={dispatch} />
              </TimeTravelProvider>
            </KitHost>
          </div>
        </ContentBox>
      </MeasureSessionProvider>
    </LifecycleViewProvider>
  );
}
