/**
 * Explore Variant 1 — "Industry Atlas" (industry-first).
 *
 * Hypothesis: users self-identify by WHO THEY ARE (their vertical) faster than
 * by task. Pick an industry tile → the catalog zooms into a map of that
 * industry's items, clustered by business function. Only one industry's items
 * (8-12) are ever on screen, grouped into named clusters — so hundreds collapse
 * to a legible neighbourhood.
 *
 * Trade-off (surfaced honestly): industry is NOT real metadata today; it would
 * have to be authored/derived. This variant tests whether that authoring is
 * worth it.
 *
 * PROTOTYPE: hardcoded English, mock data.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  INDUSTRIES, FUNCTIONS, itemsForIndustry, industryById, fnById, countBy,
  type ExploreItem,
} from '../exploreMockData';
import { ExploreItemCard } from '../shared/ExploreItemCard';
import { popularityWeight } from '../shared/exploreBits';

export function IndustryAtlas({ onSelect }: { onSelect?: (i: ExploreItem) => void }) {
  const [industry, setIndustry] = useState<string | null>(null);
  const counts = useMemo(() => countBy((i) => i.industries), []);

  if (!industry) {
    return (
      <div className="space-y-4">
        <Header title="Where do you work?" subtitle="Pick your world — we'll map the agents that fit it." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {INDUSTRIES.map((ind) => (
            <button
              key={ind.id}
              onClick={() => setIndustry(ind.id)}
              className="group relative overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/25 text-left h-40 p-4 flex flex-col justify-between transition-all"
              style={{ background: `linear-gradient(150deg, ${ind.color}22, transparent 70%)` }}
            >
              <div
                className="absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-40 group-hover:opacity-70 transition-opacity"
                style={{ backgroundColor: ind.color }}
              />
              <div className="relative flex items-center justify-between">
                <span className="typo-heading font-semibold text-foreground">{ind.label}</span>
                <span className="typo-caption text-foreground opacity-70">{counts[ind.id] ?? 0}</span>
              </div>
              <p className="relative typo-caption text-foreground opacity-80 line-clamp-2">{ind.blurb}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const ind = industryById(industry)!;
  const items = itemsForIndustry(industry);
  const clusters = FUNCTIONS
    .map((fn) => ({ fn, items: items.filter((i) => i.fn === fn.id).sort((a, b) => b.popularity - a.popularity) }))
    .filter((c) => c.items.length > 0);

  return (
    <div className="space-y-5">
      <button
        onClick={() => setIndustry(null)}
        className="inline-flex items-center gap-1.5 typo-body text-foreground opacity-70 hover:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-4 h-4" /> All industries
      </button>

      <div className="rounded-modal border border-primary/10 p-4 flex items-center gap-3"
        style={{ background: `linear-gradient(120deg, ${ind.color}1f, transparent 60%)` }}>
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ind.color }} />
        <div>
          <div className="typo-heading font-semibold text-foreground">{ind.label}</div>
          <div className="typo-caption text-foreground opacity-80">{items.length} agents across {clusters.length} functions</div>
        </div>
      </div>

      {/* Function cluster map — horizontally-scrolling columns, node size = popularity */}
      <div className="flex gap-4 overflow-x-auto pb-3">
        {clusters.map(({ fn, items: fnItems }) => (
          <div key={fn.id} className="flex-shrink-0 w-72 space-y-2">
            <div className="flex items-center gap-2 sticky top-0">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: fnById(fn.id)?.color }} />
              <span className="typo-body font-medium text-foreground">{fn.label}</span>
              <span className="typo-caption text-foreground opacity-60">{fnItems.length}</span>
            </div>
            <div className="space-y-2">
              {fnItems.map((item) => (
                <div key={item.id} style={{ opacity: 0.55 + 0.45 * popularityWeight(item.popularity) }}>
                  <ExploreItemCard item={item} accent={fn.color} onSelect={onSelect} compact={popularityWeight(item.popularity) < 0.4} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="typo-heading-lg font-semibold text-foreground">{title}</h2>
      <p className="typo-body text-foreground opacity-80">{subtitle}</p>
    </div>
  );
}
