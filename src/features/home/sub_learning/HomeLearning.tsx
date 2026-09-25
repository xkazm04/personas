import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useTourStore } from '@/stores/tourStore';
import { getLocalizedTourRegistry, type TourDef } from '@/stores/slices/system/tourSlice';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { KitHost, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { TourDetailModal } from './TourDetailModal';
import { PowerMovesPanel } from './powerMoves/PowerMovesPanel';
import { useComposedTours } from './useComposedTours';
import { GuidedToursSection, ComposedToursSection } from './TourSections';
import { completedStepsOf } from './tourCards';

/**
 * Home > Learning, composed from the kit (batch home-1): the guided tours as a
 * grid of cards across the page, then two spines side by side, the tours Athena
 * composed and the power-move quest board. The pair stacks below `lg`, where two
 * columns squeezed every name into truncation.
 */
export default function HomeLearning() {
  const tourCompletionMap = useTourStore((s) => s.tourCompletionMap);
  const tourStepCompleted = useTourStore((s) => s.tourStepCompleted);
  const startTour = useTourStore((s) => s.startTour);
  const [activeTour, setActiveTour] = useState<TourDef | null>(null);
  const composed = useComposedTours();
  const { t } = useTranslation();
  const ht = t.home.learning;

  // Read in render, not at module scope: the tour copy is translated
  // (`onboarding.tours`) and the bundle can change under us, on a language
  // switch and again when the lazily-loaded `onboarding` section lands. This
  // component already re-renders on both because it reads `t`.
  const tours = getLocalizedTourRegistry(t);
  const activeDone = activeTour ? (tourCompletionMap[activeTour.id] ?? false) : false;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GraduationCap className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={ht.title}
        subtitle={ht.subtitle}
      />
      <ContentBody centered>
        <KitHost testId="home-learning-surface">
          <Surface>
            <GuidedToursSection
              tours={tours}
              completion={tourCompletionMap}
              stepCompleted={tourStepCompleted}
              onOpen={setActiveTour}
            />
          </Surface>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 w-full">
            <Surface>
              <ComposedToursSection
                composed={composed}
                completion={tourCompletionMap}
                stepCompleted={tourStepCompleted}
                onOpen={setActiveTour}
              />
            </Surface>
            <Surface>
              <PowerMovesPanel />
            </Surface>
          </div>
        </KitHost>

        {activeTour && (
          <TourDetailModal
            tour={activeTour}
            isCompleted={activeDone}
            completedSteps={activeDone ? activeTour.steps.length : completedStepsOf(activeTour, tourStepCompleted)}
            onStart={() => {
              const id = activeTour.id;
              setActiveTour(null);
              startTour(id);
            }}
            onClose={() => setActiveTour(null)}
          />
        )}
      </ContentBody>
    </ContentBox>
  );
}
