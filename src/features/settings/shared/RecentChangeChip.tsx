import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { listSettingsAuditEntries, type SettingsAuditEntry } from '@/api/system/settings';
import { useSystemStore } from '@/stores/systemStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

const NO_REFRESH_INTERVAL = 30_000;

interface RecentChangeChipProps {
  /** Settings sub-module category as written to `settings_audit_log.category`. */
  category: string;
}

/**
 * Tiny header chip showing the most recent audit-log entry for a given
 * settings sub-module. Clicking it navigates the user to the History tab.
 * Renders nothing when the category has no audit entries yet (e.g. before
 * Stage 2 wires its write site for that sub-module).
 */
export function RecentChangeChip({ category }: RecentChangeChipProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.recent_change;
  const setSettingsTab = useSystemStore((st) => st.setSettingsTab);
  const [entry, setEntry] = useState<SettingsAuditEntry | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listSettingsAuditEntries(1, category);
      setEntry(rows[0] ?? null);
    } catch (e) {
      silentCatch(`recent-change-chip:${category}`)(e);
    }
  }, [category]);

  useEffect(() => {
    void refresh();
    // Lightweight self-refresh so a mutation made in this tab is reflected
    // within 30s without manual reload. Settings tabs are typically open for
    // short stretches so a quiet poll here is cheap.
    const handle = window.setInterval(() => {
      void refresh();
    }, NO_REFRESH_INTERVAL);
    return () => {
      window.clearInterval(handle);
    };
  }, [refresh]);

  if (!entry) return null;

  const relative = formatRelativeTime(entry.createdAt, '', { dateFallbackDays: 30 });
  const absolute = new Date(entry.createdAt).toLocaleString();
  const label = tx(s.label, { action: entry.action, when: relative });

  return (
    <button
      type="button"
      onClick={() => setSettingsTab('history')}
      title={`${absolute}\n${s.click_to_open}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption text-foreground bg-secondary/30 border border-primary/10 hover:text-primary hover:bg-secondary/50 transition-colors"
    >
      <History className="w-3 h-3 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
