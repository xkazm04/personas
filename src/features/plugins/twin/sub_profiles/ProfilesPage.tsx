import { useEffect, useState } from 'react';
import { Sparkles, Plus, Trash2, Check, Pencil, FolderTree, Mic, Brain, Volume2, Radio, BookOpen, Globe, FileText } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { useProfileDashboards } from '../useProfileDashboards';
import { CreateTwinWizard } from './CreateTwinWizard';
import { TwinHero } from './TwinHero';
import { CoachMark } from '../CoachMark';
import type { MilestoneStatus } from '../useTwinReadiness';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { LucideIcon } from 'lucide-react';

interface DraftForm {
  name: string;
  role: string;
}

const EMPTY_DRAFT: DraftForm = { name: '', role: '' };

// Gender sigils (sourced from pronouns). Kept here so the card's avatar
// stays consistent with the Identity tab's gender selector.
function genderSigilFromPronouns(pronouns: string | null): { glyph: string; color: string } {
  if (!pronouns) return { glyph: '⚧', color: 'text-violet-400/70' };
  const p = pronouns.toLowerCase();
  if (p.includes('he/') || p === 'male') return { glyph: '♂', color: 'text-sky-400/80' };
  if (p.includes('she/') || p === 'female') return { glyph: '♀', color: 'text-rose-400/80' };
  return { glyph: '⚧', color: 'text-violet-400/70' };
}

function languagesFromString(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function readinessColor(score: number): { ring: string; text: string } {
  if (score >= 80) return { ring: 'ring-emerald-500/60', text: 'text-emerald-400' };
  if (score >= 40) return { ring: 'ring-amber-500/60', text: 'text-amber-400' };
  return { ring: 'ring-primary/20', text: 'text-foreground' };
}

interface ChipProps {
  icon: LucideIcon;
  label: string;
  status: MilestoneStatus;
}

function Chip({ icon: Icon, label, status }: ChipProps) {
  const classes =
    status === 'complete'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
      : status === 'partial'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
      : 'bg-secondary/30 text-foreground border-primary/10';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full border ${classes}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function ProfilesPage() {
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

  const sorted = [...twinProfiles].sort((a, b) => a.name.localeCompare(b.name));
  const dashboards = useProfileDashboards(sorted);

  const startEdit = (profile: TwinProfile) => {
    setEditingId(profile.id);
    setEditDraft({ name: profile.name, role: profile.role ?? '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft.name.trim()) return;
    setSubmitting(true);
    try {
      await updateTwinProfile(editingId, {
        name: editDraft.name.trim(),
        role: editDraft.role.trim() ? editDraft.role.trim() : null,
      });
      setEditingId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t.profiles.deleteConfirm.replace('{name}', name))) return;
    await deleteTwinProfile(id);
  };

  // First-run hero — no twins at all
  if (!isLoading && sorted.length === 0) {
    return (
      <>
        <TwinHero onCreate={() => setWizardOpen(true)} />
        {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
      </>
    );
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Sparkles className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.profiles.title}
        subtitle={t.profiles.subtitle}
        actions={
          <Button onClick={() => setWizardOpen(true)} size="sm" variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            {t.profiles.newTwin}
          </Button>
        }
      />

      <ContentBody centered>
        <CoachMark id="profiles" title={t.coach.profilesTitle} body={t.coach.profilesBody} />

        {isLoading && sorted.length === 0 ? (
          <p className="typo-body text-foreground text-center py-12">{t.profiles.loading}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map((profile) => {
              const isActive = profile.id === activeTwinId;
              const isEditing = editingId === profile.id;

              if (isEditing) {
                return (
                  <div key={profile.id} className="p-4 rounded-card border border-violet-500/30 bg-violet-500/5 space-y-3">
                    <input type="text" placeholder={t.profiles.name} value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} className={INPUT_FIELD} />
                    <input type="text" placeholder={t.profiles.role} value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className={INPUT_FIELD} />
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setEditingId(null)} variant="ghost" size="sm">{t.profiles.cancel}</Button>
                      <Button onClick={handleSaveEdit} disabled={!editDraft.name.trim() || submitting} size="sm">{t.profiles.save}</Button>
                    </div>
                  </div>
                );
              }

              const dash = dashboards[profile.id];
              const readiness = dash?.readiness;
              const sigil = genderSigilFromPronouns(profile.pronouns ?? null);
              const languages = languagesFromString(profile.languages ?? null);
              const ring = readiness ? readinessColor(readiness.score) : readinessColor(0);

              return (
                <div
                  key={profile.id}
                  className={`p-4 rounded-card border transition-colors ${
                    isActive ? 'border-violet-500/30 bg-violet-500/5' : 'border-primary/10 bg-card/40 hover:border-primary/20'
                  }`}
                >
                  {/* Header row: avatar + name + readiness ring */}
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-card flex items-center justify-center flex-shrink-0 border ${
                      isActive ? 'bg-violet-500/15 border-violet-500/30' : 'bg-secondary/40 border-primary/10'
                    }`}>
                      <span className={`typo-heading-lg leading-none ${sigil.color}`} aria-hidden>{sigil.glyph}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="typo-card-label truncate">{profile.name}</h3>
                        {isActive && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 flex-shrink-0">{t.profiles.active}</span>
                        )}
                      </div>
                      {profile.role && <p className="typo-caption text-foreground mt-0.5 truncate">{profile.role}</p>}
                      <div className="flex items-center gap-1.5 mt-1 typo-caption text-foreground">
                        <FolderTree className="w-3 h-3" />
                        <span className="font-mono truncate text-[10px]">{profile.obsidian_subpath}</span>
                      </div>
                    </div>
                    {/* Readiness ring */}
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-full ring-2 ring-offset-0 ${ring.ring} flex items-center justify-center`}
                      title={`${t.progress.readiness}: ${readiness?.score ?? 0}%`}
                    >
                      <span className={`typo-caption font-semibold ${ring.text} text-md`}>
                        {readiness?.score ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Chip row — 6 milestones */}
                  {readiness && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      <Chip icon={FileText} label={readiness.identity === 'partial' ? t.profiles.chipBioPartial : t.profiles.chipBio} status={readiness.identity} />
                      <Chip icon={Mic} label={readiness.tone === 'partial' && !readiness.counts.toneHasSpecific ? t.profiles.chipToneGeneric : `${t.profiles.chipTone} ${readiness.counts.toneRows > 0 ? `×${readiness.counts.toneRows}` : ''}`.trim()} status={readiness.tone} />
                      <Chip icon={Brain} label={readiness.brain === 'partial' ? t.profiles.chipBrainObsidian : t.profiles.chipBrain} status={readiness.brain} />
                      <Chip icon={Volume2} label={t.profiles.chipVoice} status={readiness.voice} />
                      <Chip icon={Radio} label={readiness.channels === 'partial' ? t.profiles.chipChannelsPaused : `${t.profiles.chipChannels} ${readiness.counts.channelsActive > 0 ? `×${readiness.counts.channelsActive}` : ''}`.trim()} status={readiness.channels} />
                      <Chip icon={BookOpen} label={`${t.profiles.chipMemories} ${readiness.counts.memoriesApproved > 0 ? `×${readiness.counts.memoriesApproved}` : ''}`.trim()} status={readiness.memories} />
                    </div>
                  )}

                  {/* Channel icons row */}
                  {dash && dash.channelTypes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      {dash.channelTypes.map((ct) => (
                        <span key={ct} className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-medium rounded-full bg-violet-500/8 text-violet-400/80 border border-violet-500/15">
                          {ct}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Languages row */}
                  {languages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 typo-caption text-foreground">
                      <Globe className="w-3 h-3" />
                      <span className="sr-only">{t.profiles.languages}:</span>
                      {languages.map((lang) => (
                        <span key={lang} className="px-1.5 py-0.5 text-[10px] rounded-full bg-secondary/30 text-foreground">
                          {lang}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 mt-3 pt-3 border-t border-primary/5">
                    {!isActive && (
                      <button onClick={() => setActiveTwin(profile.id)} title={t.profiles.setActive} aria-label={`${t.profiles.setActive} — ${profile.name}`} className="p-1.5 rounded-interactive text-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => startEdit(profile)} title={t.profiles.edit} aria-label={`${t.profiles.edit} — ${profile.name}`} className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(profile.id, profile.name)} title={t.profiles.delete} aria-label={`${t.profiles.delete} — ${profile.name}`} className="p-1.5 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ContentBody>

      {wizardOpen && <CreateTwinWizard onClose={() => setWizardOpen(false)} />}
    </ContentBox>
  );
}
