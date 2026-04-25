import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Plus, Trash2, Check, Pencil, FolderTree, Mic, Brain, Volume2, Radio,
  BookOpen, Globe, FileText, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { useProfileDashboards } from '../useProfileDashboards';
import { CreateTwinWizard } from './CreateTwinWizard';
import { TwinHero } from './TwinHero';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { LucideIcon } from 'lucide-react';
import type { MilestoneStatus } from '../useTwinReadiness';

/* ------------------------------------------------------------------ *
 *  Console — "Twin Roster Ledger"
 *  KPI strip + dense sortable spreadsheet with one row per twin and a
 *  column for each readiness milestone. Built for users who want to
 *  scan many twins at once.
 * ------------------------------------------------------------------ */

interface DraftForm { name: string; role: string }
const EMPTY: DraftForm = { name: '', role: '' };

function languagesFrom(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

const MILESTONE_DOT: Record<MilestoneStatus, string> = {
  complete: 'bg-emerald-400',
  partial: 'bg-amber-400',
  empty: 'bg-foreground/15',
};

type SortKey = 'name' | 'role' | 'readiness' | 'channels' | 'memories';
type SortDir = 'asc' | 'desc';

const COLUMNS: { id: keyof Pick<RowData, 'identity' | 'tone' | 'brain' | 'voice' | 'channels' | 'memories'>; icon: LucideIcon; label: string }[] = [
  { id: 'identity', icon: FileText, label: 'bio' },
  { id: 'tone', icon: Mic, label: 'tone' },
  { id: 'brain', icon: Brain, label: 'brain' },
  { id: 'voice', icon: Volume2, label: 'voice' },
  { id: 'channels', icon: Radio, label: 'channels' },
  { id: 'memories', icon: BookOpen, label: 'memories' },
];

interface RowData {
  profile: TwinProfile;
  identity: MilestoneStatus;
  tone: MilestoneStatus;
  brain: MilestoneStatus;
  voice: MilestoneStatus;
  channels: MilestoneStatus;
  memories: MilestoneStatus;
  readiness: number;
  channelCount: number;
  memoryCount: number;
  channelTypes: string[];
  languages: string[];
}

export default function ProfilesConsole() {
  const { t } = useTwinTranslation();
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const isLoading = useSystemStore((s) => s.twinProfilesLoading);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const deleteTwinProfile = useSystemStore((s) => s.deleteTwinProfile);
  const setActiveTwin = useSystemStore((s) => s.setActiveTwin);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftForm>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('readiness');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => { fetchTwinProfiles(); }, [fetchTwinProfiles]);

  const sortedProfiles = useMemo(
    () => [...twinProfiles].sort((a, b) => a.name.localeCompare(b.name)),
    [twinProfiles],
  );
  const dashboards = useProfileDashboards(sortedProfiles);

  const rows: RowData[] = useMemo(() => {
    const result = sortedProfiles.map((profile) => {
      const d = dashboards[profile.id];
      const r = d?.readiness;
      return {
        profile,
        identity: r?.identity ?? 'empty' as MilestoneStatus,
        tone: r?.tone ?? 'empty' as MilestoneStatus,
        brain: r?.brain ?? 'empty' as MilestoneStatus,
        voice: r?.voice ?? 'empty' as MilestoneStatus,
        channels: r?.channels ?? 'empty' as MilestoneStatus,
        memories: r?.memories ?? 'empty' as MilestoneStatus,
        readiness: r?.score ?? 0,
        channelCount: r?.counts.channelsActive ?? 0,
        memoryCount: r?.counts.memoriesApproved ?? 0,
        channelTypes: d?.channelTypes ?? [],
        languages: languagesFrom(profile.languages ?? null),
      };
    });
    result.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name': return a.profile.name.localeCompare(b.profile.name) * dir;
        case 'role': return (a.profile.role ?? '').localeCompare(b.profile.role ?? '') * dir;
        case 'readiness': return (a.readiness - b.readiness) * dir;
        case 'channels': return (a.channelCount - b.channelCount) * dir;
        case 'memories': return (a.memoryCount - b.memoryCount) * dir;
      }
    });
    return result;
  }, [sortedProfiles, dashboards, sortKey, sortDir]);

  const aggregate = useMemo(() => {
    const tot = rows.length;
    const avg = tot ? Math.round(rows.reduce((s, r) => s + r.readiness, 0) / tot) : 0;
    const channels = rows.reduce((s, r) => s + r.channelCount, 0);
    const memories = rows.reduce((s, r) => s + r.memoryCount, 0);
    const blocked = rows.filter((r) => r.readiness < 40).length;
    return { tot, avg, channels, memories, blocked };
  }, [rows]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' || k === 'role' ? 'asc' : 'desc'); }
  };

  const startEdit = (p: TwinProfile) => { setEditingId(p.id); setEditDraft({ name: p.name, role: p.role ?? '' }); };
  const handleSaveEdit = async () => {
    if (!editingId || !editDraft.name.trim()) return;
    setSubmitting(true);
    try {
      await updateTwinProfile(editingId, { name: editDraft.name.trim(), role: editDraft.role.trim() ? editDraft.role.trim() : null });
      setEditingId(null);
    } finally { setSubmitting(false); }
  };
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t.profiles.deleteConfirm.replace('{name}', name))) return;
    await deleteTwinProfile(id);
  };

  if (!isLoading && rows.length === 0) {
    return (
      <>
        <TwinHero onCreate={() => setWizardOpen(true)} />
        {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Compact header strip ────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">{t.profiles.title}</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.profiles.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2 mr-2">
          <Tile label="twins" value={aggregate.tot} />
          <Tile label="readiness" value={`${aggregate.avg}%`} accent={aggregate.avg >= 80 ? 'emerald' : aggregate.avg >= 40 ? 'amber' : 'violet'} />
          <Tile label="channels" value={aggregate.channels} />
          <Tile label="memories" value={aggregate.memories} />
          {aggregate.blocked > 0 && <Tile label="blocked" value={aggregate.blocked} accent="amber" />}
        </div>
        <Button onClick={() => setWizardOpen(true)} size="sm" variant="accent" accentColor="violet">
          <Plus className="w-4 h-4 mr-1.5" />
          {t.profiles.newTwin}
        </Button>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[2] bg-background/95 backdrop-blur">
            <tr className="border-b border-primary/15 text-foreground/55">
              <Th sortKey="name" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-left pl-4 md:pl-6 xl:pl-8">name</Th>
              <Th sortKey="role" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-left">role</Th>
              <Th sortKey="readiness" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right w-24">ready</Th>
              {COLUMNS.map(({ id, icon: Icon, label }) => (
                <th key={id} className="text-center font-medium px-2 py-2 w-12" title={label}>
                  <div className="flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                </th>
              ))}
              <Th sortKey="channels" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right w-16">ch</Th>
              <Th sortKey="memories" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right w-16">mem</Th>
              <th className="text-left font-medium px-2 py-2">brand</th>
              <th className="text-left font-medium px-2 py-2 hidden xl:table-cell">languages</th>
              <th className="text-left font-medium px-2 py-2 hidden 2xl:table-cell">path</th>
              <th className="text-right font-medium px-3 py-2 pr-4 md:pr-6 xl:pr-8 w-32">actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isActive = row.profile.id === activeTwinId;
              const isEditing = editingId === row.profile.id;

              if (isEditing) {
                return (
                  <tr key={row.profile.id} className="border-b border-primary/10 bg-violet-500/5">
                    <td colSpan={5 + COLUMNS.length + 4} className="px-4 md:px-6 xl:px-8 py-3">
                      <div className="flex items-center gap-2">
                        <input type="text" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className={`${INPUT_FIELD} flex-1 max-w-xs`} />
                        <input type="text" placeholder={t.profiles.role} value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className={`${INPUT_FIELD} flex-1 max-w-xs`} />
                        <Button onClick={() => setEditingId(null)} variant="ghost" size="sm">{t.profiles.cancel}</Button>
                        <Button onClick={handleSaveEdit} disabled={!editDraft.name.trim() || submitting} size="sm">{t.profiles.save}</Button>
                      </div>
                    </td>
                  </tr>
                );
              }

              const readinessTextColor = row.readiness >= 80 ? 'text-emerald-300' : row.readiness >= 40 ? 'text-amber-300' : 'text-foreground/65';

              return (
                <tr
                  key={row.profile.id}
                  className={`group border-b border-primary/5 transition-colors ${
                    isActive ? 'bg-violet-500/5 border-l-2 border-l-violet-400' : 'hover:bg-secondary/20'
                  }`}
                >
                  <td className="pl-4 md:pl-6 xl:pl-8 pr-2 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" title={t.profiles.active} />}
                      <span className="typo-card-label truncate">{row.profile.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="typo-caption text-foreground/65 truncate">{row.profile.role ?? '—'}</span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className={`typo-data-lg tabular-nums ${readinessTextColor}`}>{row.readiness}</span>
                    <span className="typo-caption text-foreground/40">%</span>
                  </td>
                  {COLUMNS.map(({ id }) => (
                    <td key={id} className="px-2 py-2 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${MILESTONE_DOT[row[id]]}`} title={`${id}: ${row[id]}`} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums typo-caption text-foreground/65">{row.channelCount || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums typo-caption text-foreground/65">{row.memoryCount || '—'}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[140px]">
                      {row.channelTypes.slice(0, 3).map((ct) => (
                        <span key={ct} className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-violet-500/8 text-violet-300/85 border border-violet-500/15">{ct}</span>
                      ))}
                      {row.channelTypes.length > 3 && (
                        <span className="text-[9px] text-foreground/55">+{row.channelTypes.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 hidden xl:table-cell">
                    {row.languages.length > 0 ? (
                      <div className="flex items-center gap-1 typo-caption text-foreground/65">
                        <Globe className="w-3 h-3" />
                        <span className="text-[10px] truncate max-w-[120px]">{row.languages.join(' · ')}</span>
                      </div>
                    ) : <span className="typo-caption text-foreground/40">—</span>}
                  </td>
                  <td className="px-2 py-2 hidden 2xl:table-cell">
                    <div className="flex items-center gap-1 typo-caption text-foreground/55">
                      <FolderTree className="w-3 h-3" />
                      <span className="font-mono text-[10px] truncate max-w-[180px]">{row.profile.obsidian_subpath}</span>
                    </div>
                  </td>
                  <td className="pr-4 md:pr-6 xl:pr-8 pl-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                      {!isActive && (
                        <button onClick={() => setActiveTwin(row.profile.id)} title={t.profiles.setActive} className="p-1 rounded-interactive text-foreground/65 hover:text-violet-300 hover:bg-violet-500/10 transition-colors">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => startEdit(row.profile)} title={t.profiles.edit} className="p-1 rounded-interactive text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(row.profile.id, row.profile.name)} title={t.profiles.delete} className="p-1 rounded-interactive text-foreground/65 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Footer note for milestone legend */}
        <div className="px-4 md:px-6 xl:px-8 py-3 border-t border-primary/10 flex items-center gap-4 text-[11px] text-foreground/55">
          <span className="font-medium uppercase tracking-[0.16em] text-[10px]">legend</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> complete</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> partial</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-foreground/15" /> empty</span>
          <span className="ml-auto hidden md:inline">click column header to sort</span>
        </div>
      </div>

      {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

/* ── Tile (KPI) ─────────────────────────────────────────────────────── */

function Tile({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300 border-emerald-500/25' : accent === 'amber' ? 'text-amber-300 border-amber-500/25' : 'text-violet-300 border-violet-500/25';
  return (
    <div className={`rounded-interactive border ${tone} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[64px]`}>
      <span className="typo-data-lg tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}

/* ── Sortable header cell ──────────────────────────────────────────── */

interface ThProps {
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}
function Th({ sortKey, current, dir, onSort, className = '', children }: ThProps) {
  const isCurrent = sortKey === current;
  return (
    <th className={`font-medium px-2 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] hover:text-foreground transition-colors ${isCurrent ? 'text-violet-300' : ''}`}
      >
        {children}
        {isCurrent ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}
