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

const MAX_ROWS = 8;

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

  if (!loaded || configured === false) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader
        label={t.overview.vault_recent_changes.title}
        subtitle={t.overview.vault_recent_changes.subtitle}
      >
        <ArrowRight className="w-3 h-3 text-foreground" />
      </PaneHeader>
      {entries.length === 0 ? (
        <div className="px-4 py-6 typo-body text-foreground text-center">
          {t.overview.vault_recent_changes.empty}
        </div>
      ) : (
        <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-1.5">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
