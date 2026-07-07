/**
 * Explore — 2nd-level "Templates → Explore" view.
 *
 * PROTOTYPE HOST. Renders three competing approaches to "pick from hundreds of
 * templates/recipes/personas without drowning", switchable via the segmented
 * control so we can compare them side by side and iterate:
 *   1. Industry Atlas       — industry-first, drill into a function-clustered map
 *   2. Task Flow            — job-to-be-done first, qualifiers → ranked shortlist
 *   3. Persona Constellation— characteristics-first, one trait-space map, archetype-lit
 *
 * All three read the SAME mock catalog (exploreMockData.ts) so the comparison
 * is about hierarchy/UX, not content. Real data wiring (gallery hook +
 * archetypes + recipes) follows once a direction is chosen. i18n deferred.
 */
import { useState } from 'react';
import { Map as MapIcon, ListChecks, Sparkles, FlaskConical, X } from 'lucide-react';
import { IndustryAtlas } from './variants/IndustryAtlas';
import { TaskFlow } from './variants/TaskFlow';
import { PersonaConstellation } from './variants/PersonaConstellation';
import type { ExploreItem } from './exploreMockData';

type VariantId = 'atlas' | 'flow' | 'constellation';

const VARIANTS: { id: VariantId; label: string; icon: typeof MapIcon; hint: string }[] = [
  { id: 'atlas',         label: 'Industry Atlas',        icon: MapIcon,    hint: 'Start from your vertical → a map of that industry, clustered by function.' },
  { id: 'flow',          label: 'Task Flow',             icon: ListChecks, hint: 'Start from the job to be done → two quick qualifiers → a ranked shortlist.' },
  { id: 'constellation', label: 'Persona Constellation', icon: Sparkles,   hint: 'The whole catalog as one trait-space map — pick a character to light it up.' },
];

export default function ExploreView() {
  const [variant, setVariant] = useState<VariantId>('atlas');
  const [picked, setPicked] = useState<ExploreItem | null>(null);
  const active = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 2xl:px-8">
      <div className="max-w-6xl 3xl:max-w-[1800px] mx-auto space-y-5">
        {/* Prototype banner + variant switcher */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-2 typo-caption text-foreground opacity-70">
            <FlaskConical className="w-3.5 h-3.5" />
            Prototype · comparing 3 approaches on the same mock catalog
          </div>
          <div className="inline-flex rounded-input border border-primary/10 p-0.5 bg-background/40 self-start">
            {VARIANTS.map((v) => {
              const Icon = v.icon;
              const on = v.id === variant;
              return (
                <button
                  key={v.id}
                  onClick={() => { setVariant(v.id); setPicked(null); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-caption transition-colors ${
                    on ? 'bg-primary/15 text-primary' : 'text-foreground opacity-70 hover:opacity-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="typo-caption text-foreground opacity-60">{active.hint}</p>

        {/* Active variant */}
        {variant === 'atlas' && <IndustryAtlas onSelect={setPicked} />}
        {variant === 'flow' && <TaskFlow onSelect={setPicked} />}
        {variant === 'constellation' && <PersonaConstellation onSelect={setPicked} />}
      </div>

      {/* Mock "picked" toast so selections feel live in the prototype */}
      {picked && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-modal border border-primary/20 bg-background/95 shadow-elevation-3">
          <span className="typo-body text-foreground">
            Selected <span className="font-medium template-name-themed">{picked.name}</span> — detail/adopt would open here
          </span>
          <button onClick={() => setPicked(null)} className="text-foreground opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
