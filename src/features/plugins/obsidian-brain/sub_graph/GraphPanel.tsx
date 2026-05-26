import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Network,
  AlertTriangle,
  GitBranch,
  Compass,
  CalendarDays,
  Users,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  obsidianGraphSearch,
  obsidianGraphStats,
  obsidianGraphListOrphans,
  obsidianGraphListMocs,
  obsidianGraphAppendDailyNote,
  obsidianGraphWriteMeetingNote,
  obsidianGraphStartWatcher,
  obsidianGraphStopWatcher,
  VAULT_CHANGED_EVENT,
  type VaultSearchHit,
  type VaultStats,
  type VaultLinkRef,
  type VaultMocEntry,
  type VaultChangedEvent,
} from '@/api/obsidianBrain';
import { listen } from '@tauri-apps/api/event';
import SavedConfigsSidebar from '../SavedConfigsSidebar';
import { openNoteInObsidian } from '../openInObsidian';

export default function GraphPanel() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const activeVaultPath = useSystemStore((s) => s.obsidianVaultPath);
  const vaultName = useSystemStore((s) => s.obsidianVaultName);

  const [stats, setStats] = useState<VaultStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [orphans, setOrphans] = useState<VaultLinkRef[]>([]);
  const [mocs, setMocs] = useState<VaultMocEntry[]>([]);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<VaultSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [journalSection, setJournalSection] = useState('Captured');
  const [journalBody, setJournalBody] = useState('');
  const [journalSaving, setJournalSaving] = useState(false);

  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingAttendees, setMeetingAttendees] = useState('');
  const [meetingBody, setMeetingBody] = useState('');
  const [meetingSaving, setMeetingSaving] = useState(false);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [s, o, m] = await Promise.all([
        obsidianGraphStats(),
        obsidianGraphListOrphans(15),
        obsidianGraphListMocs(8, 10),
      ]);
      setStats(s);
      setOrphans(o);
      setMocs(m);
    } catch (e) {
      addToast(`Failed to load vault stats: ${e}`, 'error');
    } finally {
      setStatsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!connected) return;
    loadStats();
    void obsidianGraphStartWatcher().catch(() => {});
    let unlisten: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    void listen<VaultChangedEvent>(VAULT_CHANGED_EVENT, () => {
      // Debounce burst events so we re-walk the vault at most once per ~800ms
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadStats();
      }, 800);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (unlisten) unlisten();
      // Stop the watcher on every unmount AND on vault switch — otherwise
      // each (connected, activeVaultPath) change starts a fresh backend
      // watcher without stopping the previous one.
      void obsidianGraphStopWatcher().catch(() => {});
    };
  }, [connected, activeVaultPath, loadStats]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    try {
      const hits = await obsidianGraphSearch(query.trim(), 25);
      setSearchHits(hits);
    } catch (e) {
      addToast(`Search failed: ${e}`, 'error');
    } finally {
      setSearching(false);
    }
  }, [query, addToast]);

  const appendJournal = useCallback(async () => {
    if (!journalBody.trim()) {
      addToast('Write something to capture first', 'error');
      return;
    }
    setJournalSaving(true);
    try {
      const result = await obsidianGraphAppendDailyNote(journalBody, {
        section: journalSection.trim() || undefined,
      });
      addToast(
        result.created
          ? `Created daily note for ${result.date}`
          : `Appended to ${result.date}`,
        'success',
      );
      setJournalBody('');
      void loadStats();
    } catch (e) {
      addToast(`Daily note write failed: ${e}`, 'error');
    } finally {
      setJournalSaving(false);
    }
  }, [journalBody, journalSection, addToast, loadStats]);

  const writeMeeting = useCallback(async () => {
    if (!meetingTitle.trim() || !meetingBody.trim()) {
      addToast('Meeting title and body are required', 'error');
      return;
    }
    setMeetingSaving(true);
    try {
      const attendees = meetingAttendees
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const result = await obsidianGraphWriteMeetingNote(
        meetingTitle.trim(),
        meetingBody,
        attendees.length > 0 ? attendees : undefined,
      );
      addToast(`Meeting note saved: ${result.title}`, 'success');
      setMeetingTitle('');
      setMeetingAttendees('');
      setMeetingBody('');
      void loadStats();
    } catch (e) {
      addToast(`Meeting note write failed: ${e}`, 'error');
    } finally {
      setMeetingSaving(false);
    }
  }, [meetingTitle, meetingAttendees, meetingBody, addToast, loadStats]);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <EmptyState
          icon={AlertTriangle}
          title={t.plugins.obsidian_brain.no_vault_connected}
          subtitle={t.plugins.obsidian_brain.no_vault_hint}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
        />
      </div>
    );
  }

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 min-w-0 max-w-3xl space-y-5">
        {/* Stats */}
        <SectionCard title={t.plugins.obsidian_brain.vault_stats} subtitle={t.plugins.obsidian_brain.vault_stats_subtitle}>
          {statsLoading && !stats ? (
            <div className="flex items-center justify-center py-6">
              <LoadingSpinner size="md" label={t.plugins.obsidian_brain.reading_vault} />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: t.plugins.obsidian_brain.stat_notes, value: stats.totalNotes, icon: Network, color: 'text-violet-300' },
                { label: t.plugins.obsidian_brain.stat_links, value: stats.totalLinks, icon: GitBranch, color: 'text-blue-300' },
                { label: t.plugins.obsidian_brain.stat_orphans, value: stats.orphanCount, icon: AlertTriangle, color: 'text-amber-300' },
                { label: t.plugins.obsidian_brain.stat_mocs, value: stats.mocCount, icon: Compass, color: 'text-emerald-300' },
                { label: t.plugins.obsidian_brain.stat_daily_notes, value: stats.dailyNoteCount, icon: CalendarDays, color: 'text-fuchsia-300' },
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.label}
                    className="px-3 py-3 rounded-modal bg-secondary/20 border border-primary/10 flex flex-col items-start gap-1"
                  >
                    <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                    <p className={`typo-heading-lg ${s.color}`}>{s.value}</p>
                    <p className="typo-caption text-foreground">{s.label}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="typo-caption text-foreground py-2">{t.plugins.obsidian_brain.no_stats_yet}</p>
          )}
        </SectionCard>

        {/* Search */}
        <SectionCard title={t.plugins.obsidian_brain.search_vault} subtitle={t.plugins.obsidian_brain.search_vault_subtitle}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                  placeholder={t.plugins.obsidian_brain.search_vault_placeholder}
                  className="w-full pl-9 pr-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all"
                />
              </div>
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-card bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {searching ? <LoadingSpinner size="sm" /> : <Search className="w-4 h-4" />}
                {t.plugins.obsidian_brain.search}
              </button>
            </div>

            {searchHits.length > 0 && (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {searchHits.map((hit) => (
                  <button
                    key={hit.path}
                    type="button"
                    onClick={() => openNoteInObsidian(vaultName, hit.path)}
                    title={t.plugins.obsidian_brain.open_in_obsidian}
                    className="group w-full text-left px-3 py-2.5 rounded-modal border border-primary/10 hover:border-violet-500/30 hover:bg-secondary/20 transition-colors focus-ring"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="typo-heading typo-card-label truncate group-hover:text-violet-300 transition-colors">{hit.title}</p>
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="typo-caption text-foreground tabular-nums">{t.plugins.obsidian_brain.score_label} {hit.score}</span>
                        <ExternalLink className="w-3 h-3 text-violet-400/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </div>
                    <p className="typo-caption text-foreground line-clamp-2">{hit.snippet}</p>
                  </button>
                ))}
              </div>
            )}
            {!searching && query.trim() && searchHits.length === 0 && (
              <p className="typo-caption text-foreground">{t.plugins.obsidian_brain.no_matches}</p>
            )}
          </div>
        </SectionCard>

        {/* Orphans + MOCs */}
        <div className="grid grid-cols-2 gap-4">
          <SectionCard collapsible title={`${t.plugins.obsidian_brain.orphan_notes_title} (${orphans.length})`} subtitle={t.plugins.obsidian_brain.orphan_notes_subtitle} storageKey="obsidian-graph-orphans">
            {orphans.length === 0 ? (
              <p className="typo-caption text-foreground py-2">{t.plugins.obsidian_brain.orphan_notes_empty}</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {orphans.map((o) => (
                  <button
                    key={o.path}
                    type="button"
                    onClick={() => openNoteInObsidian(vaultName, o.path)}
                    title={o.path}
                    className="group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-card bg-secondary/20 hover:bg-secondary/40 transition-colors focus-ring text-left"
                  >
                    <span className="typo-caption text-foreground truncate flex-1 group-hover:text-violet-300 transition-colors">{o.title}</span>
                    <ExternalLink className="w-3 h-3 text-violet-400/70 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard collapsible title={`${t.plugins.obsidian_brain.mocs_title} (${mocs.length})`} subtitle={t.plugins.obsidian_brain.mocs_subtitle} storageKey="obsidian-graph-mocs">
            {mocs.length === 0 ? (
              <p className="typo-caption text-foreground py-2">{t.plugins.obsidian_brain.mocs_empty}</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {mocs.map((m) => (
                  <button
                    key={m.path}
                    type="button"
                    onClick={() => openNoteInObsidian(vaultName, m.path)}
                    title={m.path}
                    className="group w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-card bg-secondary/20 hover:bg-secondary/40 transition-colors focus-ring text-left"
                  >
                    <span className="typo-caption text-foreground truncate group-hover:text-violet-300 transition-colors">{m.title}</span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="typo-caption text-emerald-400/70">{m.outgoingLinkCount} →</span>
                      <ExternalLink className="w-3 h-3 text-violet-400/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Daily Journal */}
        <SectionCard title={t.plugins.obsidian_brain.quick_journal} subtitle={t.plugins.obsidian_brain.quick_journal_subtitle}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={journalSection}
                onChange={(e) => setJournalSection(e.target.value)}
                placeholder={t.plugins.obsidian_brain.journal_section_placeholder}
                className="w-48 px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all"
              />
              <button
                onClick={appendJournal}
                disabled={journalSaving || !journalBody.trim()}
                className="ml-auto flex items-center gap-2 px-5 py-2 rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {journalSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                {t.plugins.obsidian_brain.append_to_today}
              </button>
            </div>
            <textarea
              value={journalBody}
              onChange={(e) => setJournalBody(e.target.value)}
              placeholder={t.plugins.obsidian_brain.journal_body_placeholder}
              rows={4}
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all resize-none"
            />
          </div>
        </SectionCard>

        {/* Meeting Note */}
        <SectionCard title={t.plugins.obsidian_brain.capture_meeting} subtitle={t.plugins.obsidian_brain.capture_meeting_subtitle}>
          <div className="space-y-3">
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder={t.plugins.obsidian_brain.meeting_title_placeholder}
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all"
            />
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                type="text"
                value={meetingAttendees}
                onChange={(e) => setMeetingAttendees(e.target.value)}
                placeholder={t.plugins.obsidian_brain.meeting_attendees_placeholder}
                className="w-full pl-9 pr-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all"
              />
            </div>
            <textarea
              value={meetingBody}
              onChange={(e) => setMeetingBody(e.target.value)}
              placeholder={t.plugins.obsidian_brain.meeting_body_placeholder}
              rows={5}
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground/40 focus-ring transition-all resize-none"
            />
            <button
              onClick={writeMeeting}
              disabled={meetingSaving || !meetingTitle.trim() || !meetingBody.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
            >
              {meetingSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {t.plugins.obsidian_brain.save_meeting_note}
            </button>
          </div>
        </SectionCard>
      </div>

      <SavedConfigsSidebar
        emptyHint={t.plugins.obsidian_brain.saved_vaults_empty_hint_other}
      />
    </div>
  );
}
