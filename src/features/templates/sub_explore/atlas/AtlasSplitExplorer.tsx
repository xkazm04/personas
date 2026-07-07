/**
 * Atlas Variant 3 — "Split Explorer".
 *
 * Everything on one screen: an illustrated domain rail on the left, a live
 * cluster map on the right that swaps instantly as you move between domains —
 * no drill-down page change, so you can sweep the whole catalog fluidly. The
 * "seamless exploration" treatment. PROTOTYPE: hardcoded English.
 */
import { useState } from 'react';
import { DOMAINS, domainById } from '../exploreDomains';
import { useExploreCatalog, type ExploreItem } from '../useExploreCatalog';
import { AtlasClusterMap } from './AtlasClusterMap';

export function AtlasSplitExplorer({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const { byDomain, counts, loading } = useExploreCatalog();
  const [domain, setDomain] = useState<string>(DOMAINS[0]?.id ?? 'engineering');
  const d = domainById(domain) ?? DOMAINS[0]!;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Domain rail */}
      <div className="lg:w-64 flex-shrink-0 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible">
        {DOMAINS.map((dom) => {
          const on = dom.id === domain;
          return (
            <button
              key={dom.id}
              onClick={() => setDomain(dom.id)}
              className={`group relative overflow-hidden rounded-modal border text-left flex-shrink-0 w-52 lg:w-full h-20 transition-all ${
                on ? 'border-primary/40' : 'border-primary/10 hover:border-primary/25'
              }`}
              style={on ? { boxShadow: `inset 0 0 0 1px ${dom.color}55` } : undefined}
            >
              <img src={dom.illustration} alt="" loading="lazy" className={`absolute inset-0 w-full h-full object-cover transition-opacity ${on ? 'opacity-45' : 'opacity-25 group-hover:opacity-40'}`} />
              <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--background) 35%, ${dom.color}18)` }} />
              <div className="relative h-full flex flex-col justify-center px-3">
                <span className={`typo-body font-medium ${on ? 'text-foreground' : 'text-foreground opacity-85'}`}>{dom.label}</span>
                <span className="typo-caption text-foreground opacity-65">{counts[dom.id] ?? 0} templates</span>
              </div>
              {on && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: dom.color }} />}
            </button>
          );
        })}
      </div>

      {/* Live cluster map */}
      <div className="flex-1 min-w-0 space-y-3">
        <div>
          <div className="typo-heading font-semibold text-foreground" style={{ color: d.color }}>{d.label}</div>
          <p className="typo-caption text-foreground opacity-80">{loading ? 'Loading…' : d.blurb}</p>
        </div>
        <AtlasClusterMap items={byDomain[domain] ?? []} accent={d.color} onSelect={onSelect} />
      </div>
    </div>
  );
}
