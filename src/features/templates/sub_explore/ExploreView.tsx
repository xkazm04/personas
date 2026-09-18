/**
 * Explore — 2nd-level "Templates → Explore" view.
 *
 * Level 1 (locked): the data-weighted Bento Mosaic of 7 domains, wired to the
 * real template + recipe catalog, with theme-aware Leonardo illustrations.
 * Level 2: a domain's templates + recipes; picking one resolves the catalog id
 * to its seeded review and opens the same adoption wizard the gallery opens,
 * so Explore is a second door into adoption instead of a mosaic demo.
 */
import { useState } from 'react';
import AdoptionWizardModal from '@/features/templates/sub_generated/adoption/AdoptionWizardModal';
import { BentoGrid } from './atlas/BentoGrid';
import { DomainLevel2 } from './level2/DomainLevel2';
import { useExploreAdoption } from './useExploreAdoption';
import type { ExploreItem, ExploreRecipe } from './useExploreCatalog';

export default function ExploreView() {
  const [domain, setDomain] = useState<string | null>(null);
  const adoption = useExploreAdoption();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 2xl:px-8" data-testid="explore-view">
      <div className="max-w-6xl 3xl:max-w-[1800px] mx-auto">
        {domain ? (
          <DomainLevel2
            domainId={domain}
            onBack={() => setDomain(null)}
            onSelect={(i: ExploreItem) => { void adoption.openAdopt(i.id, i.name); }}
            onSelectRecipe={(r: ExploreRecipe) => { void adoption.openAdopt(r.sourceTemplateId, r.name); }}
          />
        ) : (
          <BentoGrid onPick={setDomain} />
        )}
      </div>

      <AdoptionWizardModal
        isOpen={adoption.review !== null}
        onClose={adoption.closeAdopt}
        review={adoption.review}
        onPersonaCreated={adoption.closeAdopt}
      />
    </div>
  );
}
