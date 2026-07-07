/**
 * Atlas Variant 1 — "Illustrated Tiles" (the evolved baseline).
 *
 * 7 data-grounded domain tiles, each wearing its Leonardo symbolic illustration
 * as a full-bleed background. Pick one → drill into a cluster map of that
 * domain's REAL templates, grouped by sub-domain. Classic, legible drill-down.
 * PROTOTYPE: hardcoded English.
 */
import { useState } from 'react';
import { DOMAINS } from '../exploreDomains';
import { useExploreCatalog, type ExploreItem } from '../useExploreCatalog';
import { DomainDetail } from './DomainDetail';

export function AtlasIllustratedTiles({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const { byDomain, counts, loading, total } = useExploreCatalog();
  const [domain, setDomain] = useState<string | null>(null);

  if (domain) {
    return (
      <DomainDetail
        domainId={domain}
        items={byDomain[domain] ?? []}
        count={counts[domain] ?? 0}
        onBack={() => setDomain(null)}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="typo-heading-lg font-semibold text-foreground">Where do you work?</h2>
        <p className="typo-body text-foreground opacity-80">
          {loading ? 'Loading the catalog…' : `Pick a domain — ${total} templates mapped across ${DOMAINS.length} worlds.`}
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDomain(d.id)}
            className="group relative overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/30 text-left h-48 transition-all"
          >
            <img src={d.illustration} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-65 group-hover:scale-105 transition-all duration-500" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to top, var(--background) 15%, transparent 55%), radial-gradient(120% 80% at 70% 20%, ${d.color}22, transparent)` }} />
            <div className="relative h-full flex flex-col justify-end p-4 gap-1">
              <div className="flex items-center justify-between">
                <span className="typo-heading font-semibold text-foreground drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">{d.label}</span>
                <span className="typo-caption px-1.5 py-0.5 rounded-input text-foreground bg-background/60 backdrop-blur-sm">{counts[d.id] ?? 0}</span>
              </div>
              <p className="typo-caption text-foreground opacity-85 line-clamp-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">{d.blurb}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
