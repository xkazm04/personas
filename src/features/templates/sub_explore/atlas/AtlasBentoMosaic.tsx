/**
 * Atlas Variant 2 — "Data-Weighted Bento Mosaic".
 *
 * Same domains + illustrations, but the tiles are a bento grid where TILE SIZE
 * scales with how many real templates live in each domain — so "balanced per the
 * data" is something you can see: Engineering (biggest) dominates, the long tail
 * shrinks. Pick a tile → the same drill-down. High-density overview in one screen.
 * PROTOTYPE: hardcoded English.
 */
import { useMemo, useState } from 'react';
import { DOMAINS } from '../exploreDomains';
import { useExploreCatalog, type ExploreItem } from '../useExploreCatalog';
import { DomainDetail } from './DomainDetail';

/** Rank → tailwind grid span. Rank 0 (largest) is the hero tile. */
const SPANS = [
  'sm:col-span-2 sm:row-span-2',
  'sm:col-span-2',
  'sm:row-span-2',
];

export function AtlasBentoMosaic({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const { byDomain, counts, loading, total } = useExploreCatalog();
  const [domain, setDomain] = useState<string | null>(null);

  const ranked = useMemo(
    () => [...DOMAINS].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)),
    [counts],
  );

  if (domain) {
    return (
      <DomainDetail domainId={domain} items={byDomain[domain] ?? []} count={counts[domain] ?? 0}
        onBack={() => setDomain(null)} onSelect={onSelect} />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="typo-heading-lg font-semibold text-foreground">The whole catalog, weighted by depth</h2>
        <p className="typo-body text-foreground opacity-80">
          {loading ? 'Loading the catalog…' : `Bigger tile = more templates. ${total} across ${DOMAINS.length} domains.`}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 auto-rows-[110px] gap-3">
        {ranked.map((d, idx) => {
          const span = SPANS[idx] ?? '';
          const big = idx === 0;
          return (
            <button
              key={d.id}
              onClick={() => setDomain(d.id)}
              className={`group relative overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/30 text-left transition-all ${span}`}
            >
              <img src={d.illustration} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500" />
              <div className="absolute inset-0" style={{ background: `linear-gradient(to top, var(--background) 18%, transparent 60%), radial-gradient(120% 80% at 70% 20%, ${d.color}22, transparent)` }} />
              <div className="relative h-full flex flex-col justify-end p-3.5 gap-0.5">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold text-foreground drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] ${big ? 'typo-heading-lg' : 'typo-body'}`}>{d.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="typo-caption font-medium" style={{ color: d.color }}>{counts[d.id] ?? 0}</span>
                  <span className="typo-caption text-foreground opacity-70">templates</span>
                </div>
                {big && <p className="typo-caption text-foreground opacity-85 line-clamp-2 mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">{d.blurb}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
