/**
 * The two pieces of the Queue lane's right-hand frame that are not the triage
 * logic: the framed entry's header, and the ghost that stands under it while
 * the first load settles.
 *
 * They live here so `QueueLane` stays about the verdict gesture and nothing
 * else — the repo's per-file size discipline, not a reuse claim.
 */

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_KIND_META } from '../HubEntryActions';
import type { HubEntry } from '../hubContract';

export function QueueEntryHeader({ entry }: { entry: HubEntry }) {
  const t = useTranslation().t.twin.hub;
  const meta = HUB_KIND_META[entry.kind];
  return (
    <header className="flex-shrink-0 px-4 md:px-8 pt-4 pb-3 border-b border-border flex items-center gap-2 flex-wrap">
      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.text}`}>
        <meta.Icon className="w-3.5 h-3.5" />
        <span className="typo-label">{t.kinds[entry.kind]}</span>
      </span>
      {entry.channel && (
        <span className="px-2 py-0.5 rounded-full border border-border bg-secondary/40 typo-label text-foreground">
          {entry.channel}
        </span>
      )}
      {entry.contactHandle && <span className="typo-caption text-foreground truncate">{entry.contactHandle}</span>}
      <RelativeTime timestamp={entry.at} className="ml-auto typo-caption text-foreground tabular-nums" />
      {entry.title && <h2 className="w-full typo-heading text-foreground">{entry.title}</h2>}
    </header>
  );
}

/** Calm, geometry-matched ghost under the permanent chrome — never a spinner. */
export function QueueGhost() {
  return (
    <div className="flex-1 px-4 md:px-8 py-4 space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="block h-4 rounded bg-primary/[0.06] animate-fade-in"
          style={{ width: `${90 - i * 12}%`, animationDelay: `${120 + i * 35}ms` }} />
      ))}
    </div>
  );
}
