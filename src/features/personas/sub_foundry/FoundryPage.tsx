import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { listArchetypes, type Archetype, type ArchetypeCatalog, type MemoryStrategy } from '@/api/archetypes';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { Recipe } from '@/features/templates/sub_recipes/types';
import { ArchetypeGrid } from './ArchetypeGrid';
import { MemoryStrategyPicker } from './MemoryStrategyPicker';
import { CapabilityRack } from './CapabilityRack';
import { FoundryReview } from './FoundryReview';
import { useFoundryCreate } from './useFoundryCreate';

type FoundryStep = 'foundation' | 'capabilities' | 'review';
const STEPS: FoundryStep[] = ['foundation', 'capabilities', 'review'];

/**
 * Persona Foundry — compose a persona from visible parts instead of an
 * opaque bundle or a blank chat box:
 *
 *   Persona = Foundation (mentality archetype + memory strategy)
 *           + Capabilities (recipes from the catalog)
 *           + Wiring (connectors — resolved by the pipeline at create)
 *
 * Three steps, one visible composition. Creation drives the standard
 * adoption pipeline with a synthesized v3 template payload
 * (see useFoundryCreate) — no parallel compile path.
 */
export function FoundryPage() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<ArchetypeCatalog | null>(null);
  const [step, setStep] = useState<FoundryStep>('foundation');
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [memory, setMemory] = useState<MemoryStrategy | null>(null);
  const [selected, setSelected] = useState<Map<string, Recipe>>(new Map());
  const [name, setName] = useState('');
  const { create, creating } = useFoundryCreate();

  useEffect(() => {
    listArchetypes()
      .then((c) => {
        setCatalog(c);
        // Learner is the sensible default strategy — preselect it so the
        // memory row never blocks step 1 (users can still change it).
        const learner = c.memoryStrategies.find((m) => m.id === 'learner') ?? c.memoryStrategies[0];
        if (learner) setMemory((prev) => prev ?? learner);
      })
      .catch(silentCatch('foundry:list_archetypes'));
  }, []);

  const stepIndex = STEPS.indexOf(step);
  const canNext = useMemo(() => {
    if (step === 'foundation') return !!archetype && !!memory;
    if (step === 'capabilities') return true; // zero capabilities is a valid start
    return false;
  }, [step, archetype, memory]);

  const toggleRecipe = (r: Recipe) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r);
      return next;
    });
  };

  const handleCreate = () => {
    if (!archetype || !memory) return;
    void create({
      archetype,
      memoryStrategy: memory,
      recipes: [...selected.values()],
      name: name.trim(),
    });
  };

  if (!catalog) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  const stepLabel: Record<FoundryStep, string> = {
    foundation: t.foundry.step_foundation,
    capabilities: t.foundry.step_capabilities,
    review: t.foundry.step_review,
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="foundry-page">
      {/* Stepper header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-card-border/60 shrink-0">
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => i < stepIndex && setStep(s)}
              disabled={i > stepIndex}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-caption border transition-colors ${
                s === step
                  ? 'border-primary/45 bg-primary/12 text-primary'
                  : i < stepIndex
                    ? 'border-card-border bg-secondary/40 text-foreground/85 cursor-pointer hover:border-primary/35'
                    : 'border-card-border/50 bg-secondary/20 text-foreground/60'
              }`}
            >
              <span className="font-mono">{i + 1}</span>
              {stepLabel[s]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {stepIndex > 0 && (
          <button
            type="button"
            data-testid="foundry-back"
            onClick={() => setStep(STEPS[stepIndex - 1]!)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-interactive typo-caption text-foreground border border-card-border bg-secondary/40 hover:border-foreground/30 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t.common.back}
          </button>
        )}
        {step !== 'review' && (
          <button
            type="button"
            data-testid="foundry-next"
            disabled={!canNext}
            onClick={() => setStep(STEPS[stepIndex + 1]!)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-interactive typo-caption font-medium border border-primary/45 bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {t.foundry.next_step}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Step body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-5">
        {step === 'foundation' && (
          <div className="flex flex-col gap-5 max-w-5xl mx-auto">
            <div>
              <h2 className="typo-section-title text-foreground">{t.foundry.foundation_heading}</h2>
              <p className="typo-caption text-foreground">{t.foundry.foundation_subheading}</p>
            </div>
            <ArchetypeGrid
              archetypes={catalog.archetypes}
              selectedId={archetype?.id ?? null}
              onSelect={setArchetype}
            />
            <div>
              <h3 className="typo-body font-semibold text-foreground">{t.foundry.memory_heading}</h3>
              <p className="typo-caption text-foreground mb-2">{t.foundry.memory_subheading}</p>
              <MemoryStrategyPicker
                strategies={catalog.memoryStrategies}
                selectedId={memory?.id ?? null}
                onSelect={setMemory}
              />
            </div>
          </div>
        )}
        {step === 'capabilities' && archetype && (
          <div className="flex flex-col gap-3 max-w-5xl mx-auto h-full min-h-0">
            <div className="shrink-0">
              <h2 className="typo-section-title text-foreground">{t.foundry.capabilities_heading}</h2>
              <p className="typo-caption text-foreground">{t.foundry.capabilities_subheading}</p>
            </div>
            <CapabilityRack
              affinity={archetype.recipeAffinity}
              accentColor={archetype.color}
              selected={selected}
              onToggle={toggleRecipe}
            />
          </div>
        )}
        {step === 'review' && archetype && memory && (
          <FoundryReview
            archetype={archetype}
            memoryStrategy={memory}
            recipes={[...selected.values()]}
            name={name}
            onNameChange={setName}
            creating={creating}
            onCreate={handleCreate}
          />
        )}
      </div>
    </div>
  );
}
