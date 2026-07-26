import { useEffect, useState } from 'react';
import { FileText, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  obsidianBrainGetConfig,
  obsidianBrainGetSyncLog,
  type SyncLogEntry,
} from '@/api/obsidianBrain';
import { silentCatch } from '@/lib/silentCatch';
import { formatRelativeShort } from '@/features/overview/libs/formatRelativeShort';
import { PaneHeader } from '../PaneHeader';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

const MAX_ROWS = 8;
const ROW_HEIGHT = 32;
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_PATH_WIDTHS = ['w-36', 'w-28', 'w-32', 'w-24'];

function formatTime(iso: string): string {
  return formatRelativeShort(iso)?.label ?? '—';
}

function shortPath(p: string | null): string {
  if (!p) return '—';
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.slice(-2).join('/');
}

export default function VaultRecentChangesCard() {
  const { t } = useTranslation();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    obsidianBrainGetConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg) {
          setConfigured(false);
          setLoaded(true);
          return;
        }
        setConfigured(true);
        return obsidianBrainGetSyncLog(MAX_ROWS).then((rows) => {
          if (!cancelled) {
            setEntries(rows);
            setLoaded(true);
          }
        });
      })
      .catch((err) => {
        // A transient RPC failure (e.g. obsidianBrainGetSyncLog rejecting after
        // config resolved truthy) must not leave `loaded` false forever — that
        // renders this card as `null`, indistinguishable from "not configured".
        if (!cancelled) setLoaded(true);
        silentCatch('dashboard/VaultRecentChangesCard')(err);
      });
    return () => { cancelled = true; };
  }, []);

  // Single fetch on mount (no polling), so the tracker's default (no reset
  // key) is correct — a resolved entry set plays its cascade exactly once.
  // Called unconditionally, ABOVE the permanent-absence early return below
  // (Rules of Hooks — hooks can't follow a conditional return).
  const enter = useRevealTracker();
  const showGhost = !loaded && entries.length === 0;

  // Once loaded, "not configured" is a permanent, intentional absence (the
  // Obsidian Brain plugin isn't wired up) — not a loading state, so it's fine
  // to render nothing here. While still loading, though, the frame stays up
  // and only the row region shows a calm placeholder (never a blank body).
  if (loaded && configured === false) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader
        label={t.overview.vault_recent_changes.title}
        subtitle={t.overview.vault_recent_changes.subtitle}
      >
        <ArrowRight className="w-3 h-3 text-foreground" />
      </PaneHeader>
      {showGhost ? (
        <VaultGhostRows />
      ) : entries.length === 0 ? (
        <div className="px-4 py-6 typo-body text-foreground text-center">
          {t.overview.vault_recent_changes.empty}
        </div>
      ) : (
        <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
          {entries.map((entry, index) => (
            <RevealItem
              key={entry.id}
              revealId={entry.id}
              order={index}
              hasEntered={enter.hasEntered}
              markEntered={enter.markEntered}
              className="flex items-center gap-3 px-3 py-1.5"
            >
              <FileText className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="typo-caption font-mono uppercase tracking-wider text-foreground flex-shrink-0">
                {entry.action.slice(0, 4)}
              </span>
              <span className="typo-body text-foreground truncate flex-1 min-w-0">
                {shortPath(entry.vaultFilePath) || entry.entityType}
              </span>
              <span className="typo-caption font-mono tabular-nums text-foreground flex-shrink-0">
                {formatTime(entry.createdAt)}
              </span>
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VaultGhostRows — calm, geometry-matched ghost for the only moment the row
// region has nothing yet (first fetch in flight). Enters via `animate-fade-in`
// behind a ≥120ms staggered delay (fill-mode both) so a fast fetch skips it
// entirely — no timers, no held content.
// ---------------------------------------------------------------------------
function VaultGhostRows() {
  return (
    <div className="divide-y divide-primary/5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => {
        const pathW = GHOST_PATH_WIDTHS[i % GHOST_PATH_WIDTHS.length];
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-1.5 animate-fade-in"
            style={{ height: ROW_HEIGHT, animationDelay: `${120 + i * 35}ms` }}
          >
            <span className="w-3 h-3 rounded bg-primary/[0.06] flex-shrink-0" />
            <span className="h-2.5 w-8 flex-shrink-0 rounded bg-primary/[0.06]" />
            <span className={`h-2.5 ${pathW} max-w-full flex-1 ${GHOST_BAR}`} />
            <span className="h-2.5 w-10 flex-shrink-0 rounded bg-primary/[0.06]" />
          </div>
        );
      })}
    </div>
  );
}
