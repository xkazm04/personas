/**
 * Explore — 2nd-level "Templates → Explore" view.
 *
 * Level 1 (locked): the data-weighted Bento Mosaic of 7 domains, wired to the
 * real template + recipe catalog, with theme-aware Leonardo illustrations.
 * Level 2 (prototype): a domain's templates + recipes, with an in-place switcher
 * between two layout approaches (Capability Tree vs Unified Shelf).
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { BentoGrid } from './atlas/BentoGrid';
import { DomainLevel2 } from './level2/DomainLevel2';
import type { ExploreItem, ExploreRecipe } from './useExploreCatalog';

export default function ExploreView() {
  const [domain, setDomain] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string } | null>(null);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 2xl:px-8">
      <div className="max-w-6xl 3xl:max-w-[1800px] mx-auto">
        {domain ? (
          <DomainLevel2
            domainId={domain}
            onBack={() => setDomain(null)}
            onSelect={(i: ExploreItem) => setPicked(i)}
            onSelectRecipe={(r: ExploreRecipe) => setPicked(r)}
          />
        ) : (
          <BentoGrid onPick={setDomain} />
        )}
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
