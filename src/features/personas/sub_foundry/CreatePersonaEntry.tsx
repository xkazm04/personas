import { lazy, Suspense } from 'react';
import { MessageSquareText, LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

const UnifiedBuildEntry = lazy(() =>
  import('@/features/agents/components/matrix/UnifiedBuildEntry').then((m) => ({ default: m.UnifiedBuildEntry })),
);

/**
 * The persona-creation surface. The retired "Compose" (Foundry) wizard folded
 * its one genuinely-useful idea — foundation selection (mentality archetype +
 * memory strategy) — into the Describe surface's persona-core configurator
 * (see `sub_glyph/personaCore`), so creation is now a single flow:
 *
 *   - Describe it: the intent surface (UnifiedBuildEntry) — the LLM builds from
 *     a description, with clarifying questions and a persona-core badge for the
 *     temperament. The one path for both Simple and Power tiers.
 *   - Browse templates: jump to the template gallery for the fully pre-composed
 *     path.
 *
 * Both resolve to the same adoption pipeline underneath.
 */
export function CreatePersonaEntry() {
  const { t } = useTranslation();
  // Simple mode gates out Templates + Recipes, so simple users get the guided
  // chat build (UnifiedBuildEntry) directly — no tab strip, no templates jump.
  const { isStarter: isSimple } = useTier();

  const goTemplates = () => {
    useSystemStore.getState().setIsCreatingPersona(false);
    useSystemStore.getState().setSidebarSection('design-reviews');
  };

  if (isSimple) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-full"><LoadingSpinner /></div>}>
        <UnifiedBuildEntry />
      </Suspense>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="create-persona-entry">
      <div className="flex items-center gap-1.5 px-5 pt-4 shrink-0" role="tablist" aria-label={t.foundry.entry_mode_aria}>
        <ModeTab
          active
          icon={<MessageSquareText className="w-3.5 h-3.5" />}
          label={t.foundry.entry_describe}
          testId="create-mode-describe"
          onClick={() => {}}
        />
        <ModeTab
          active={false}
          icon={<LayoutGrid className="w-3.5 h-3.5" />}
          label={t.foundry.entry_templates}
          testId="create-mode-templates"
          onClick={goTemplates}
        />
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="flex items-center justify-center h-full"><LoadingSpinner /></div>}>
          <UnifiedBuildEntry />
        </Suspense>
      </div>
    </div>
  );
}

function ModeTab({ active, icon, label, testId, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; testId: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption border transition-colors cursor-pointer ${
        active
          ? 'border-primary/45 bg-primary/12 text-primary'
          : 'border-card-border bg-secondary/30 text-foreground hover:border-foreground/30 hover:bg-secondary/50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default CreatePersonaEntry;
