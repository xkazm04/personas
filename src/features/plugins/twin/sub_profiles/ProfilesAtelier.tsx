import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, Plus, Trash2, Check, Pencil, FolderTree, Mic, Brain, Volume2, Radio,
  BookOpen, Globe, FileText, ArrowUpRight,
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
 *  Atelier — "Constellation of Twins"
 *  Hero gradient band, active twin as a luminous featured card with a
 *  readiness halo + milestone arc, satellite cards beneath, aggregate
 *  stats rail on the right. Reads like a portfolio plate, not a CRUD list.
 * ------------------------------------------------------------------ */

interface DraftForm { name: string; role: string }
const EMPTY_DRAFT: DraftForm = { name: '', role: '' };

function genderSigil(pronouns: string | null): { glyph: string; tint: string } {
  if (!pronouns) return { glyph: '⚧', tint: 'from-violet-400/30 to-fuchsia-400/30' };
  const p = pronouns.toLowerCase();
  if (p.includes('he/') || p === 'male') return { glyph: '♂', tint: 'from-sky-400/30 to-blue-400/30' };
  if (p.includes('she/') || p === 'female') return { glyph: '♀', tint: 'from-rose-400/30 to-pink-400/30' };
  return { glyph: '⚧', tint: 'from-violet-400/30 to-fuchsia-400/30' };
}

function languagesFrom(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

const MILESTONE_TINT: Record<MilestoneStatus, string> = {
  complete: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  partial: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  empty: 'text-foreground/55 bg-secondary/40 border-primary/10',
};

interface MilestoneArcProps {
  score: number;
  label: string;
  size?: number;
}
function MilestoneArc({ score, label, size = 72 }: MilestoneArcProps) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);
  const stroke = score >= 80 ? '#34d399' : score >= 40 ? '#fbbf24' : '#a78bfa';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={4} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={stroke} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="typo-data-lg leading-none text-foreground">{score}</span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55 mt-0.5">{label}</span>
      </div>
    </div>
  );
}

interface MilestoneRowProps { icon: LucideIcon; label: string; status: MilestoneStatus; meta?: string }
function MilestoneRow({ icon: Icon, label, status, meta }: MilestoneRowProps) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-interactive border ${MILESTONE_TINT[status]} text-xs`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-medium truncate">{label}</span>
      {meta && <span className="ml-auto text-[10px] tabular-nums opacity-70">{meta}</span>}
    </div>
  );
}

export default function ProfilesAtelier() {
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
  const [editDraft, setEditDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchTwinProfiles(); }, [fetchTwinProfiles]);

  const sorted = useMemo(() => [...twinProfiles].sort((a, b) => a.name.localeCompare(b.name)), [twinProfiles]);
  const dashboards = useProfileDashboards(sorted);

  // Active twin lifted to the hero pane; the rest become satellites.
  const heroTwin = sorted.find((p) => p.id === activeTwinId) ?? sorted[0];
  const satellites = sorted.filter((p) => p.id !== heroTwin?.id);

  // Aggregate KPIs across the whole roster.
  const agg = useMemo(() => {
    let totalReadiness = 0; let memoriesApproved = 0; let channelsActive = 0;
    const channelTypes = new Set<string>(); const langs = new Set<string>();
    sorted.forEach((p) => {
      const d = dashboards[p.id];
      if (!d) return;
      totalReadiness += d.readiness.score;
      memoriesApproved += d.readiness.counts.memoriesApproved;
      channelsActive += d.readiness.counts.channelsActive;
      d.channelTypes.forEach((ct) => channelTypes.add(ct));
      languagesFrom(p.languages ?? null).forEach((l) => langs.add(l));
    });
    return {
      twins: sorted.length,
      avgReadiness: sorted.length ? Math.round(totalReadiness / sorted.length) : 0,
      memoriesApproved,
      channelsActive,
      channelTypes: Array.from(channelTypes),
      languages: Array.from(langs),
    };
  }, [sorted, dashboards]);

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

  if (!isLoading && sorted.length === 0) {
    return (
      <>
        <TwinHero onCreate={() => setWizardOpen(true)} />
        {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band — gradient + halo + roster KPIs ─────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/8 to-transparent" />
        <div className="absolute inset-0 opacity-40 pointer-events-none">
          <svg viewBox="0 0 800 200" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <radialGradient id="atelier-glow" cx="20%" cy="50%" r="40%">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="800" height="200" fill="url(#atelier-glow)" />
            {[...Array(12)].map((_, i) => (
              <circle key={i} cx={120 + i * 55} cy={30 + (i % 3) * 50} r={1.4 + (i % 4) * 0.6} fill="#a78bfa" opacity={0.35 - (i % 5) * 0.05} />
            ))}
          </svg>
        </div>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="relative w-11 h-11 rounded-full bg-violet-500/20 border border-violet-400/40 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-violet-300" />
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border border-violet-400/40"
              animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">Twin Atelier</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.profiles.title}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.profiles.subtitle}</p>
          </div>
          {/* KPI strip */}
          <div className="hidden md:flex items-center gap-5 px-4 py-2 rounded-full border border-primary/15 bg-card/40 backdrop-blur">
            <KpiCell label={t.profiles.title} value={agg.twins} accent="violet" />
            <KpiCell label="readiness" value={`${agg.avgReadiness}%`} accent={agg.avgReadiness >= 80 ? 'emerald' : agg.avgReadiness >= 40 ? 'amber' : 'violet'} />
            <KpiCell label="channels" value={agg.channelsActive} accent="violet" />
            <KpiCell label="memories" value={agg.memoriesApproved} accent="violet" />
          </div>
          <Button onClick={() => setWizardOpen(true)} size="sm" variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            {t.profiles.newTwin}
          </Button>
        </div>
      </div>

      {/* ── Body — hero card + satellite grid ──────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto px-4 md:px-6 xl:px-8 py-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-6 min-w-0">
            {heroTwin && (
              <HeroCard
                profile={heroTwin}
                isActive={heroTwin.id === activeTwinId}
                isEditing={editingId === heroTwin.id}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onStartEdit={() => startEdit(heroTwin)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={handleSaveEdit}
                submitting={submitting}
                onSetActive={() => setActiveTwin(heroTwin.id)}
                onDelete={() => handleDelete(heroTwin.id, heroTwin.name)}
                dash={dashboards[heroTwin.id]}
              />
            )}

            {satellites.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">satellites</span>
                  <div className="h-px flex-1 bg-primary/10" />
                  <span className="typo-caption text-foreground/55">{satellites.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {satellites.map((p) => (
                    <SatelliteCard
                      key={p.id}
                      profile={p}
                      dash={dashboards[p.id]}
                      isEditing={editingId === p.id}
                      editDraft={editDraft}
                      setEditDraft={setEditDraft}
                      onStartEdit={() => startEdit(p)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={handleSaveEdit}
                      submitting={submitting}
                      onSetActive={() => setActiveTwin(p.id)}
                      onDelete={() => handleDelete(p.id, p.name)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Aggregate rail */}
          <aside className="hidden xl:block">
            <div className="sticky top-4 space-y-4">
              <div className="rounded-card border border-primary/10 bg-card/40 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium mb-3">roster spread</p>
                <dl className="space-y-3">
                  <KpiRow label="twins configured" value={agg.twins} />
                  <KpiRow label="avg readiness" value={`${agg.avgReadiness}%`} hi={agg.avgReadiness >= 80} />
                  <KpiRow label="active channels" value={agg.channelsActive} />
                  <KpiRow label="memories approved" value={agg.memoriesApproved} />
                </dl>
              </div>
              {agg.channelTypes.length > 0 && (
                <div className="rounded-card border border-primary/10 bg-card/40 p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium mb-2">channels in use</p>
                  <div className="flex flex-wrap gap-1.5">
                    {agg.channelTypes.map((ct) => (
                      <span key={ct} className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/25">{ct}</span>
                    ))}
                  </div>
                </div>
              )}
              {agg.languages.length > 0 && (
                <div className="rounded-card border border-primary/10 bg-card/40 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Globe className="w-3 h-3 text-foreground/65" />
                    <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">languages</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {agg.languages.map((l) => (
                      <span key={l} className="px-2 py-0.5 text-[10px] rounded-full bg-secondary/40 text-foreground">{l}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

/* ── KPI sub-components ──────────────────────────────────────────────── */

const ACCENT_TEXT: Record<string, string> = {
  violet: 'text-violet-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
};

function KpiCell({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: keyof typeof ACCENT_TEXT }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-lg tabular-nums ${ACCENT_TEXT[accent] ?? ACCENT_TEXT.violet}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}

function KpiRow({ label, value, hi }: { label: string; value: number | string; hi?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="typo-caption text-foreground/65">{label}</dt>
      <dd className={`typo-data-lg tabular-nums ${hi ? 'text-emerald-300' : 'text-foreground'}`}>{value}</dd>
    </div>
  );
}

/* ── Hero card (active twin) ────────────────────────────────────────── */

interface HeroCardProps {
  profile: TwinProfile;
  isActive: boolean;
  isEditing: boolean;
  editDraft: DraftForm;
  setEditDraft: (d: DraftForm) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  submitting: boolean;
  onSetActive: () => void;
  onDelete: () => void;
  dash?: ReturnType<typeof useProfileDashboards>[string];
}

function HeroCard(props: HeroCardProps) {
  const { profile, isActive, isEditing, editDraft, setEditDraft, onStartEdit, onCancelEdit, onSaveEdit, submitting, onSetActive, onDelete, dash } = props;
  const { t } = useTwinTranslation();
  const sigil = genderSigil(profile.pronouns ?? null);
  const langs = languagesFrom(profile.languages ?? null);
  const r = dash?.readiness;

  if (isEditing) {
    return (
      <div className="rounded-card border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
        <input type="text" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className={INPUT_FIELD} />
        <input type="text" placeholder={t.profiles.role} value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className={INPUT_FIELD} />
        <div className="flex justify-end gap-2">
          <Button onClick={onCancelEdit} variant="ghost" size="sm">{t.profiles.cancel}</Button>
          <Button onClick={onSaveEdit} disabled={!editDraft.name.trim() || submitting} size="sm">{t.profiles.save}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-card overflow-hidden border border-violet-500/25 bg-gradient-to-br from-violet-500/8 via-card/40 to-fuchsia-500/5 shadow-elevation-2">
      {/* Decorative corner glow */}
      <div className={`absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br ${sigil.tint} blur-2xl pointer-events-none`} />

      <div className="relative p-5 md:p-6 grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-5 items-start">
        {/* Avatar pillar */}
        <div className="flex flex-col items-center gap-3">
          <div className={`w-16 h-16 rounded-card bg-gradient-to-br ${sigil.tint} border border-violet-500/30 flex items-center justify-center`}>
            <span className="text-3xl text-foreground/90 leading-none" aria-hidden>{sigil.glyph}</span>
          </div>
          {r && <MilestoneArc score={r.score} label="ready" size={84} />}
        </div>

        {/* Header + milestones */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isActive && <span className="px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] font-medium rounded-full bg-violet-500/20 text-violet-200 border border-violet-400/40">{t.profiles.active}</span>}
            <h2 className="typo-section-title text-foreground/95">{profile.name}</h2>
            {profile.role && <span className="typo-caption text-foreground/65">— {profile.role}</span>}
          </div>
          {profile.bio && (
            <p className="typo-body text-foreground/80 mt-2 leading-relaxed line-clamp-3">{profile.bio}</p>
          )}
          <div className="flex items-center gap-1.5 mt-3 typo-caption text-foreground/55">
            <FolderTree className="w-3 h-3" />
            <span className="font-mono text-[10px] truncate">{profile.obsidian_subpath}</span>
          </div>

          {r && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-4">
              <MilestoneRow icon={FileText} label={t.profiles.chipBio} status={r.identity} />
              <MilestoneRow icon={Mic} label={t.profiles.chipTone} status={r.tone} meta={r.counts.toneRows ? `×${r.counts.toneRows}` : undefined} />
              <MilestoneRow icon={Brain} label={t.profiles.chipBrain} status={r.brain} />
              <MilestoneRow icon={Volume2} label={t.profiles.chipVoice} status={r.voice} />
              <MilestoneRow icon={Radio} label={t.profiles.chipChannels} status={r.channels} meta={r.counts.channelsActive ? `×${r.counts.channelsActive}` : undefined} />
              <MilestoneRow icon={BookOpen} label={t.profiles.chipMemories} status={r.memories} meta={r.counts.memoriesApproved ? `×${r.counts.memoriesApproved}` : undefined} />
            </div>
          )}

          {(dash?.channelTypes.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {dash!.channelTypes.map((ct) => (
                <span key={ct} className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/25">{ct}</span>
              ))}
            </div>
          )}

          {langs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2 typo-caption text-foreground/65">
              <Globe className="w-3 h-3" />
              {langs.map((l) => (
                <span key={l} className="px-2 py-0.5 text-[10px] rounded-full bg-secondary/40 text-foreground">{l}</span>
              ))}
            </div>
          )}
        </div>

        {/* Action stack */}
        <div className="flex md:flex-col items-end gap-1.5">
          {!isActive && (
            <button onClick={onSetActive} title={t.profiles.setActive} className="px-2.5 py-1.5 rounded-interactive text-xs font-medium text-violet-300 border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 transition-colors flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> {t.profiles.setActive}
            </button>
          )}
          <button onClick={onStartEdit} title={t.profiles.edit} className="p-1.5 rounded-interactive text-foreground/70 hover:text-foreground hover:bg-secondary/40 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} title={t.profiles.delete} className="p-1.5 rounded-interactive text-foreground/70 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Satellite card ────────────────────────────────────────────────── */

interface SatelliteCardProps extends Omit<HeroCardProps, 'isActive'> {}

function SatelliteCard(props: SatelliteCardProps) {
  const { profile, isEditing, editDraft, setEditDraft, onStartEdit, onCancelEdit, onSaveEdit, submitting, onSetActive, onDelete, dash } = props;
  const { t } = useTwinTranslation();
  const sigil = genderSigil(profile.pronouns ?? null);
  const langs = languagesFrom(profile.languages ?? null);
  const r = dash?.readiness;

  if (isEditing) {
    return (
      <div className="rounded-card border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
        <input type="text" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className={INPUT_FIELD} />
        <input type="text" placeholder={t.profiles.role} value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className={INPUT_FIELD} />
        <div className="flex justify-end gap-2">
          <Button onClick={onCancelEdit} variant="ghost" size="sm">{t.profiles.cancel}</Button>
          <Button onClick={onSaveEdit} disabled={!editDraft.name.trim() || submitting} size="sm">{t.profiles.save}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative rounded-card border border-primary/10 bg-card/40 p-3.5 hover:border-violet-500/30 hover:bg-violet-500/5 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-card bg-gradient-to-br ${sigil.tint} border border-primary/15 flex items-center justify-center flex-shrink-0`}>
          <span className="text-xl text-foreground/85 leading-none" aria-hidden>{sigil.glyph}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-card-label truncate">{profile.name}</h3>
          {profile.role && <p className="typo-caption text-foreground/65 truncate">{profile.role}</p>}
        </div>
        {r && <MilestoneArc score={r.score} label="ready" size={48} />}
      </div>

      {r && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {([
            ['identity', FileText],
            ['tone', Mic],
            ['brain', Brain],
            ['voice', Volume2],
            ['channels', Radio],
            ['memories', BookOpen],
          ] as const).map(([k, Icon]) => (
            <span key={k} className={`inline-flex items-center w-5 h-5 rounded-full justify-center ${
              r[k] === 'complete' ? 'bg-emerald-500/15 text-emerald-300' :
              r[k] === 'partial' ? 'bg-amber-500/15 text-amber-300' :
              'bg-secondary/40 text-foreground/40'
            }`} title={k}>
              <Icon className="w-3 h-3" />
            </span>
          ))}
        </div>
      )}

      {dash && dash.channelTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {dash.channelTypes.slice(0, 4).map((ct) => (
            <span key={ct} className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-violet-500/8 text-violet-300/80 border border-violet-500/15">{ct}</span>
          ))}
        </div>
      )}

      {langs.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 typo-caption text-foreground/55">
          <Globe className="w-3 h-3" />
          <span className="text-[10px] truncate">{langs.join(' · ')}</span>
        </div>
      )}

      <div className="flex items-center gap-0.5 mt-2.5 pt-2.5 border-t border-primary/5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onSetActive} title={t.profiles.setActive} className="p-1 rounded-interactive text-foreground/65 hover:text-violet-300 hover:bg-violet-500/10 transition-colors">
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={onStartEdit} title={t.profiles.edit} className="p-1 rounded-interactive text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} title={t.profiles.delete} className="p-1 rounded-interactive text-foreground/65 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
