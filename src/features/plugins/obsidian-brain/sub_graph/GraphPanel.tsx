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
} from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
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

export default function GraphPanel() {
  const addToast = useToastStore((s) => s.addToast);
  const connected = useSystemStore((s) => s.obsidianConnected);
  const activeVaultPath = useSystemStore((s) => s.obsidianVaultPath);

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
    };
  }, [connected, activeVaultPath, loadStats]);

  useEffect(() => {
    return () => {
      void obsidianGraphStopWatcher().catch(() => {});
    };
  }, []);

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
          title="No Vault Connected"
          subtitle="Set up an Obsidian vault in the Setup tab first to unlock graph operations."
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
        <SectionCard title="Vault Stats" subtitle="Graph metrics across all notes in the active vault">
          {statsLoading && !stats ? (
            <div className="flex items-center justify-center py-6">
              <LoadingSpinner size="md" label="Reading vault..." />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Notes', value: stats.totalNotes, icon: Network, color: 'text-violet-300' },
                { label: 'Links', value: stats.totalLinks, icon: GitBranch, color: 'text-blue-300' },
                { label: 'Orphans', value: stats.orphanCount, icon: AlertTriangle, color: 'text-amber-300' },
                { label: 'MOCs', value: stats.mocCount, icon: Compass, color: 'text-emerald-300' },
                { label: 'Daily Notes', value: stats.dailyNoteCount, icon: CalendarDays, color: 'text-fuchsia-300' },
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
            <p className="typo-caption text-foreground py-2">No stats yet.</p>
          )}
        </SectionCard>

        {/* Search */}
        <SectionCard title="Search Vault" subtitle="Substring search over note titles and bodies">
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
                  placeholder="Search your vault..."
                  className="w-full pl-9 pr-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all"
                />
              </div>
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-card bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {searching ? <LoadingSpinner size="sm" /> : <Search className="w-4 h-4" />}
                Search
              </button>
            </div>

            {searchHits.length > 0 && (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {searchHits.map((hit) => (
                  <div
                    key={hit.path}
                    className="px-3 py-2.5 rounded-modal border border-primary/10 hover:border-primary/20 hover:bg-secondary/20 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="typo-heading typo-card-label truncate">{hit.title}</p>
                      <span className="typo-caption text-foreground flex-shrink-0 tabular-nums">score {hit.score}</span>
                    </div>
                    <p className="typo-caption text-foreground line-clamp-2">{hit.snippet}</p>
                  </div>
                ))}
              </div>
            )}
            {!searching && query.trim() && searchHits.length === 0 && (
              <p className="typo-caption text-foreground">No matches.</p>
            )}
          </div>
        </SectionCard>

        {/* Orphans + MOCs */}
        <div className="grid grid-cols-2 gap-4">
          <SectionCard collapsible title={`Orphan Notes (${orphans.length})`} subtitle="No incoming links" storageKey="obsidian-graph-orphans">
            {orphans.length === 0 ? (
              <p className="typo-caption text-foreground py-2">No orphan notes — every note is linked from somewhere.</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {orphans.map((o) => (
                  <div key={o.path} className="px-2.5 py-1.5 rounded-card bg-secondary/20 typo-caption text-foreground truncate" title={o.path}>
                    {o.title}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard collapsible title={`Maps of Content (${mocs.length})`} subtitle="Notes that link out heavily" storageKey="obsidian-graph-mocs">
            {mocs.length === 0 ? (
              <p className="typo-caption text-foreground py-2">No MOCs detected — try lowering the link threshold.</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {mocs.map((m) => (
                  <div key={m.path} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-card bg-secondary/20" title={m.path}>
                    <span className="typo-caption text-foreground truncate">{m.title}</span>
                    <span className="typo-caption text-emerald-400/70 flex-shrink-0">{m.outgoingLinkCount} →</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Daily Journal */}
        <SectionCard title="Quick Journal" subtitle="Append a section to today's daily note">
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={journalSection}
                onChange={(e) => setJournalSection(e.target.value)}
                placeholder="Section heading"
                className="w-48 px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all"
              />
              <button
                onClick={appendJournal}
                disabled={journalSaving || !journalBody.trim()}
                className="ml-auto flex items-center gap-2 px-5 py-2 rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {journalSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                Append to Today
              </button>
            </div>
            <textarea
              value={journalBody}
              onChange={(e) => setJournalBody(e.target.value)}
              placeholder="What happened? What did you learn? Drop it here and it ends up in today's daily note."
              rows={4}
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all resize-none"
            />
          </div>
        </SectionCard>

        {/* Meeting Note */}
        <SectionCard title="Capture Meeting" subtitle="Write a structured meeting note under Meetings/">
          <div className="space-y-3">
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Meeting title"
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all"
            />
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                type="text"
                value={meetingAttendees}
                onChange={(e) => setMeetingAttendees(e.target.value)}
                placeholder="Attendees, comma-separated (becomes [[wikilinks]])"
                className="w-full pl-9 pr-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all"
              />
            </div>
            <textarea
              value={meetingBody}
              onChange={(e) => setMeetingBody(e.target.value)}
              placeholder="Agenda, decisions, action items..."
              rows={5}
              className="w-full px-3 py-2 rounded-modal bg-background/50 border border-primary/12 text-foreground typo-body placeholder:text-foreground focus-ring transition-all resize-none"
            />
            <button
              onClick={writeMeeting}
              disabled={meetingSaving || !meetingTitle.trim() || !meetingBody.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
            >
              {meetingSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Save Meeting Note
            </button>
          </div>
        </SectionCard>
      </div>

      <SavedConfigsSidebar
        emptyHint="No saved vaults yet. Set one up in the Setup tab."
      />
    </div>
  );
}
