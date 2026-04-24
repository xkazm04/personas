import { useEffect, useState } from 'react';
import { FileText, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  obsidianBrainGetConfig,
  obsidianBrainGetSyncLog,
  type SyncLogEntry,
} from '@/api/obsidianBrain';
import { silentCatch } from '@/lib/silentCatch';

const MAX_ROWS = 8;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
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
      .catch(silentCatch('dashboard/VaultRecentChangesCard'));
    return () => { cancelled = true; };
  }, []);

  if (!loaded || configured === false) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <div className="flex items-baseline gap-2">
          <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground/70">
            {t.overview.vault_recent_changes.title}
          </span>
          <span className="typo-caption text-foreground/40">
            {t.overview.vault_recent_changes.subtitle}
          </span>
        </div>
        <ArrowRight className="w-3 h-3 text-foreground/30" />
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-6 typo-body text-foreground/60 text-center">
          {t.overview.vault_recent_changes.empty}
        </div>
      ) : (
        <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-1.5">
              <FileText className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="typo-caption font-mono uppercase tracking-wider text-foreground/60 flex-shrink-0">
                {entry.action.slice(0, 4)}
              </span>
              <span className="typo-body text-foreground truncate flex-1 min-w-0">
                {shortPath(entry.vaultFilePath) || entry.entityType}
              </span>
              <span className="typo-caption font-mono tabular-nums text-foreground/60 flex-shrink-0">
                {formatTime(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
