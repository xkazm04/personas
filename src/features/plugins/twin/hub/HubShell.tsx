/**
 * The Hub's permanent chrome: title, the six counts (each read ONCE — one
 * number per fact), the sources strip, then the desk.
 *
 * There is no prototype switcher any more — the Desk won, the other three
 * renderers and the `twin-variant:hub` preference were deleted, and everything
 * they could reach became a lane on the desk itself. A pill strip over one
 * renderer is scaffolding pretending to be a choice.
 *
 * The chrome renders regardless of `loading`; a fetch never replaces it with a
 * spinner, and a failure is announced as a failure rather than dressed up as
 * "no data" (docs/design/overview-loading.md).
 */

import { useMemo } from 'react';
import { Brain, type LucideIcon } from 'lucide-react';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_KIND_META, HUB_STATUS_META } from './HubEntryActions';
import { HubDesk } from './HubDesk';
import { HubSourcesStrip } from './HubSourcesStrip';
import type { HubCounts } from './hubContract';
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

export function HubShell({ feed }: { feed: HubFeed }) {
  const t = useTranslation().t.twin.hub;
  const peak = useMemo(
    () => Math.max(1, ...COUNT_ORDER.map((k) => feed.counts[k])),
    [feed.counts],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="twin-hub-page">
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
                  <span className="typo-data-lg">{value}</span>
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

      {feed.error && (
        <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 pt-2">
          <ErrorBanner message={feed.error} variant="inline" onRetry={() => void feed.refresh()} />
        </div>
      )}

      {/* ── The desk ───────────────────────────────────────────────── */}
      <HubDesk feed={feed} />
    </div>
  );
}
