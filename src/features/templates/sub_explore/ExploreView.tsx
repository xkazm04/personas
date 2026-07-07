/**
 * Explore — 2nd-level "Templates → Explore" view (round 2).
 *
 * Baseline chosen: the Industry/Domain ATLAS. The real template corpus is
 * department-organized (not industry), so the top level is 7 data-grounded
 * DOMAINS with Leonardo symbolic illustrations, wired to the REAL template
 * catalog (getTemplateCatalog). Three treatments of that baseline, switchable:
 *   1. Illustrated Tiles — classic drill-down into a per-domain cluster map
 *   2. Bento Mosaic      — tile size ∝ template count (balance made visible)
 *   3. Split Explorer    — one screen, illustrated rail + live cluster map
 *
 * i18n deferred until a treatment is locked.
 */
import { useState } from 'react';
import { LayoutGrid, LayoutDashboard, Columns3, FlaskConical, X } from 'lucide-react';
import { AtlasIllustratedTiles } from './atlas/AtlasIllustratedTiles';
import { AtlasBentoMosaic } from './atlas/AtlasBentoMosaic';
import { AtlasSplitExplorer } from './atlas/AtlasSplitExplorer';
import type { ExploreItem } from './useExploreCatalog';

type VariantId = 'tiles' | 'bento' | 'split';

const VARIANTS: { id: VariantId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'tiles', label: 'Illustrated Tiles', icon: LayoutGrid,      hint: 'Classic drill-down — pick a domain, then explore its cluster map.' },
  { id: 'bento', label: 'Bento Mosaic',      icon: LayoutDashboard, hint: 'Tile size scales with template count — the data structure, made visible.' },
  { id: 'split', label: 'Split Explorer',    icon: Columns3,        hint: 'One screen — illustrated domain rail + a live cluster map that swaps instantly.' },
];

export default function ExploreView() {
  const [variant, setVariant] = useState<VariantId>('tiles');
  const [picked, setPicked] = useState<ExploreItem | null>(null);
  const active = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 2xl:px-8">
      <div className="max-w-6xl 3xl:max-w-[1800px] mx-auto space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-2 typo-caption text-foreground opacity-70">
            <FlaskConical className="w-3.5 h-3.5" />
            Prototype · Domain Atlas · real template catalog · 3 treatments
          </div>
          <div className="inline-flex rounded-input border border-primary/10 p-0.5 bg-background/40 self-start">
            {VARIANTS.map((v) => {
              const Icon = v.icon;
              const on = v.id === variant;
              return (
                <button
                  key={v.id}
                  onClick={() => setVariant(v.id)}
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

        {variant === 'tiles' && <AtlasIllustratedTiles onSelect={setPicked} />}
        {variant === 'bento' && <AtlasBentoMosaic onSelect={setPicked} />}
        {variant === 'split' && <AtlasSplitExplorer onSelect={setPicked} />}
      </div>

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
