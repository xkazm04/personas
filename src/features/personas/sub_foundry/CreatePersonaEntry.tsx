import { lazy, Suspense, useState } from 'react';
import { Hammer, MessageSquareText, LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { FoundryPage } from './FoundryPage';

const UnifiedBuildEntry = lazy(() =>
  import('@/features/agents/components/matrix/UnifiedBuildEntry').then((m) => ({ default: m.UnifiedBuildEntry })),
);

type EntryMode = 'foundry' | 'describe';

/**
 * The persona-creation surface — one place, three entry speeds:
 *
 *   - Compose (Foundry): pick a mentality archetype + memory strategy,
 *     attach capabilities from the recipe catalog — the two-layer
 *     architecture made visible and hand-composable. Default.
 *   - Describe it: the intent chat box (UnifiedBuildEntry) — the LLM
 *     builds from a description, with clarifying questions.
 *   - Browse templates: jump to the template gallery for the fully
 *     pre-composed path.
 *
 * All three resolve to the same adoption pipeline underneath, so the
 * choice is about how much the user wants to steer, not which engine runs.
 */
export function CreatePersonaEntry() {
  const { t } = useTranslation();
  // Simple mode gates out Templates + Recipes; the Foundry is built ON the
  // recipe catalog, so it's Power-only too. Simple users get the guided
  // chat build (UnifiedBuildEntry) directly — the same path Simple mode has
  // always used — with no mode chooser to reason about.
  const { isStarter: isSimple } = useTier();
  const [mode, setMode] = useState<EntryMode>('foundry');

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
          active={mode === 'foundry'}
          icon={<Hammer className="w-3.5 h-3.5" />}
          label={t.foundry.entry_compose}
          testId="create-mode-foundry"
          onClick={() => setMode('foundry')}
        />
        <ModeTab
          active={mode === 'describe'}
          icon={<MessageSquareText className="w-3.5 h-3.5" />}
          label={t.foundry.entry_describe}
          testId="create-mode-describe"
          onClick={() => setMode('describe')}
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
        {mode === 'foundry' ? (
          <FoundryPage />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><LoadingSpinner /></div>}>
            <UnifiedBuildEntry />
          </Suspense>
        )}
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
