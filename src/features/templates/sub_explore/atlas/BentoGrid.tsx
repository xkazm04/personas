/**
 * Explore level 1 — the Bento Mosaic (locked baseline).
 *
 * Data-weighted domain tiles: size scales with how many templates+recipes live
 * in each domain, so the catalog's real shape is legible at a glance. Theme-aware
 * Leonardo illustrations. No supporting copy above the grid — the tiles carry it.
 * i18n via t.explore.*.
 */
import { useMemo } from 'react';
import { DOMAINS, domainArt, domainLabel } from '../exploreDomains';
import { useExploreCatalog } from '../useExploreCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

const SPANS = ['sm:col-span-2 sm:row-span-2', 'sm:col-span-2', 'sm:row-span-2'];

export function BentoGrid({ onPick }: { onPick: (domainId: string) => void }) {
  const { templateCounts } = useExploreCatalog();
  const isDark = useIsDarkTheme();
  const { t } = useTranslation();

  const ranked = useMemo(
    () => [...DOMAINS].sort((a, b) => (templateCounts[b.id] ?? 0) - (templateCounts[a.id] ?? 0)),
    [templateCounts],
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 auto-rows-[120px] gap-3">
      {ranked.map((d, idx) => {
        const span = SPANS[idx] ?? '';
        const big = idx === 0;
        return (
          <button
            key={d.id}
            onClick={() => onPick(d.id)}
            className={`group relative overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/30 text-left transition-all ${span}`}
          >
            <img src={domainArt(d, isDark)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to top, var(--background) 16%, transparent 62%), radial-gradient(120% 80% at 70% 20%, ${d.color}22, transparent)` }} />
            <div className="relative h-full flex flex-col justify-end p-3.5 gap-0.5">
              <span className={`text-foreground drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)] ${big ? 'typo-heading-lg' : 'typo-heading'}`}>{domainLabel(d, t.explore)}</span>
              <div className="flex items-center gap-1.5">
                <span className="typo-caption font-medium" style={{ color: d.color }}>{templateCounts[d.id] ?? 0}</span>
                <span className="typo-caption text-foreground opacity-70">{t.explore.agents}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
