/**
 * The Hub's permanent chrome: title, the six counts (each read ONCE — one
 * number per fact), the sources strip, the prototype variant switcher, then
 * the variant body.
 *
 * The chrome renders regardless of `loading`; a fetch never replaces it with a
 * spinner, and a failure is announced as a failure rather than dressed up as
 * "no data" (docs/design/overview-loading.md).
 */

import { Suspense, useMemo, useState } from 'react';
import { Brain, type LucideIcon } from 'lucide-react';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { HUB_KIND_META, HUB_STATUS_META } from './HubEntryActions';
import { HubSourcesStrip } from './HubSourcesStrip';
import { DEFAULT_HUB_VARIANT, HUB_VARIANTS, HUB_VARIANT_STORAGE_KEY, isHubVariantId } from './variants/registry';
import type { HubCounts, HubVariantId } from './hubContract';
import type { HubFeed } from './useHubFeed';

type CountKey = keyof HubCounts;

/** Each count's glyph + semantic role, reusing the ONE kind/status table. */
const COUNT_ROLE: Record<CountKey, { text: string; bg: string; Icon: LucideIcon }> = {
  pending: HUB_STATUS_META.pending,
  approved: HUB_STATUS_META.approved,
  rejected: HUB_STATUS_META.rejected,
  messages: HUB_KIND_META.message,
  facts: HUB_KIND_META.fact,
  reflections: HUB_KIND_META.reflection,
};
const COUNT_ORDER: readonly CountKey[] = ['pending', 'approved', 'rejected', 'messages', 'facts', 'reflections'];

/** Each variant's one-line hint key, spelled out so the lookup type-checks. */
const HINT_KEY = {
  desk: 'deskHint', river: 'riverHint', map: 'mapHint', contacts: 'contactsHint',
} as const satisfies Record<HubVariantId, string>;

export function HubShell({ feed }: { feed: HubFeed }) {
  const t = useTranslation().t.twin.hub;
  const [variant, setVariant] = useState<HubVariantId>(() => {
    try {
      const raw = localStorage.getItem(HUB_VARIANT_STORAGE_KEY);
      if (raw && isHubVariantId(raw)) return raw;
    } catch (err) { silentCatch('twin:hub:variant-read')(err); }
    return DEFAULT_HUB_VARIANT;
  });

  const select = (id: HubVariantId) => {
    setVariant(id);
    try { localStorage.setItem(HUB_VARIANT_STORAGE_KEY, id); }
    catch (err) { silentCatch('twin:hub:variant-write')(err); }
  };

  const active = HUB_VARIANTS.find((v) => v.id === variant) ?? HUB_VARIANTS[0]!;
  const peak = useMemo(
    () => Math.max(1, ...COUNT_ORDER.map((k) => feed.counts[k])),
    [feed.counts],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Title + counts ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-border bg-gradient-to-r from-primary/8 to-transparent px-4 md:px-6 xl:px-8 py-4 flex items-center gap-4">
        <span className="w-11 h-11 rounded-card bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <Brain className="w-5 h-5 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="typo-label text-primary">{t.eyebrow}</p>
          <h1 className="typo-heading-lg text-foreground truncate">
            {feed.twinName ? `${t.title} — ${feed.twinName}` : t.title}
          </h1>
          <p className="typo-caption text-foreground">{t.subtitle}</p>
        </div>
        <div className="hidden md:flex items-end gap-3">
          {COUNT_ORDER.map((key) => {
            const role = COUNT_ROLE[key];
            const value = feed.counts[key];
            return (
              <div key={key} className="flex flex-col items-start gap-1 min-w-[3.25rem]">
                <span className={`flex items-center gap-1 ${role.text}`}>
                  <role.Icon className="w-3 h-3" />
                  <span className="typo-data-lg tabular-nums">{value}</span>
                </span>
                <span className="typo-label text-foreground">{t.counts[key]}</span>
                <span className="h-0.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                  <span
                    className={`block h-full rounded-full transition-all duration-500 ${role.bg}`}
                    style={{ width: `${Math.round((value / peak) * 100)}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </header>

      <HubSourcesStrip feed={feed} />

      {/* ── Prototype switcher ─────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-border bg-card/40">
        <span className="typo-label text-foreground hidden sm:inline">{t.variants.prototype}</span>
        <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/30 p-0.5">
          {HUB_VARIANTS.map((v) => {
            const isActive = v.id === variant;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => select(v.id)}
                aria-pressed={isActive}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full typo-caption font-medium transition-all focus-ring ${
                  isActive ? 'bg-primary/20 text-primary shadow-elevation-1' : 'text-foreground hover:bg-secondary/50'
                }`}
              >
                <v.Icon className="w-3 h-3" />
                <span>{t.variants[v.labelKey]}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden md:inline typo-caption text-foreground ml-1 truncate">
          {t.variants[HINT_KEY[active.id]]}
        </span>
      </div>

      {feed.error && (
        <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 pt-2">
          <ErrorBanner message={feed.error} variant="inline" onRetry={() => void feed.refresh()} />
        </div>
      )}

      {/* ── Variant body ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <Suspense fallback={<RouteChunkSkeleton />}>
          <active.Component feed={feed} />
        </Suspense>
      </div>
    </div>
  );
}
