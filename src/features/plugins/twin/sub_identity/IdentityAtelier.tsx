import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { User, Save, FolderTree, Sparkles, Wand2, Quote, Feather } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { generateBio } from '@/api/twin/twin';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Atelier — "Manuscript"
 *  Two-column writing pane: identity field stack on the left, a live
 *  manuscript preview of the prompt on the right that re-renders as the
 *  user writes. Inspired by writing-app split layouts.
 * ------------------------------------------------------------------ */

type Gender = 'male' | 'female' | 'neutral';

const GENDER_DEFS: { id: Gender; glyph: string; tint: string }[] = [
  { id: 'male', glyph: '♂', tint: 'from-sky-400/30 to-blue-400/30' },
  { id: 'female', glyph: '♀', tint: 'from-rose-400/30 to-pink-400/30' },
  { id: 'neutral', glyph: '⚧', tint: 'from-violet-400/30 to-fuchsia-400/30' },
];

function genderFromPronouns(pronouns: string | null): Gender {
  if (!pronouns) return 'neutral';
  const p = pronouns.toLowerCase();
  if (p.includes('he/') || p === 'male') return 'male';
  if (p.includes('she/') || p === 'female') return 'female';
  return 'neutral';
}
function genderToPronouns(g: Gender): string {
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  return 'neutral';
}

export default function IdentityAtelier() {
  const { t } = useTwinTranslation();
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);

  const activeTwin = twinProfiles.find((tw) => tw.id === activeTwinId);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [role, setRole] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  const [obsidianSubpath, setObsidianSubpath] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showBioGen, setShowBioGen] = useState(false);
  const [bioKeywords, setBioKeywords] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (activeTwin) {
      setName(activeTwin.name);
      setBio(activeTwin.bio ?? '');
      setRole(activeTwin.role ?? '');
      setGender(genderFromPronouns(activeTwin.pronouns ?? null));
      setObsidianSubpath(activeTwin.obsidian_subpath);
      setDirty(false);
      setShowBioGen(false);
    }
  }, [activeTwin?.id]);

  useEffect(() => { if (twinProfiles.length === 0) fetchTwinProfiles(); }, [twinProfiles.length, fetchTwinProfiles]);

  const stats = useMemo(() => ({
    nameSet: name.trim().length > 0,
    roleSet: role.trim().length > 0,
    bioWords: bio.trim().split(/\s+/).filter(Boolean).length,
    bioChars: bio.trim().length,
    pathSet: obsidianSubpath.trim().length > 0,
  }), [name, role, bio, obsidianSubpath]);

  const fieldsFilled = [stats.nameSet, stats.roleSet, stats.bioWords > 0, stats.pathSet, gender !== 'neutral' || stats.bioWords > 0].filter(Boolean).length;

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!activeTwinId || !name.trim()) return;
    setSaving(true);
    try {
      await updateTwinProfile(activeTwinId, {
        name: name.trim(),
        bio: bio.trim() || null,
        role: role.trim() || null,
        pronouns: genderToPronouns(gender),
        obsidianSubpath: obsidianSubpath.trim() || undefined,
      });
      setDirty(false);
    } finally { setSaving(false); }
  };

  const handleGenerateBio = async () => {
    if (!bioKeywords.trim() || !name.trim()) return;
    setGenerating(true);
    try {
      const result = await generateBio(name.trim(), role.trim() || null, bioKeywords.trim());
      setBio(result); setShowBioGen(false); setBioKeywords(''); setDirty(true);
    } catch {
      const ks = bioKeywords.split(',').map((k) => k.trim()).filter(Boolean);
      setBio(`${name.trim()}${role.trim() ? `, ${role.trim()}` : ''}. ${ks.join('. ')}.`);
      setDirty(true);
    } finally { setGenerating(false); }
  };

  if (!activeTwin) return <TwinEmptyState icon={User} title={t.identity.title} />;

  const genderTint = GENDER_DEFS.find((g) => g.id === gender)?.tint ?? GENDER_DEFS[2]!.tint;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Manuscript header band ────────────────────────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className={`absolute inset-0 bg-gradient-to-r ${genderTint} opacity-60`} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/85 pointer-events-none" />
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="relative w-12 h-12 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center">
            <Feather className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-foreground/55 font-medium">Identity Manuscript</p>
            <h1 className="typo-heading-lg text-foreground/95 truncate">{activeTwin.name || t.identity.promptNoName}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{role || t.identity.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="fields" value={`${fieldsFilled}/5`} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="bio words" value={stats.bioWords} accent={stats.bioWords >= 30 ? 'emerald' : stats.bioWords >= 10 ? 'amber' : 'violet'} />
          </div>
          {dirty && (
            <Button onClick={handleSave} disabled={saving || !name.trim()} size="sm" variant="accent" accentColor="violet">
              <Save className="w-4 h-4 mr-1.5" />
              {saving ? t.identity.saving : t.identity.saveIdentity}
            </Button>
          )}
        </div>
      </div>

      {/* ── Body — two-pane manuscript ───────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto px-4 md:px-6 xl:px-8 py-6 grid grid-cols-1 xl:grid-cols-[1.05fr_1fr] gap-6">

          {/* LEFT — Field stack */}
          <div className="space-y-5 min-w-0">
            <Section index="01" label="who they are">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t.identity.name}>
                  <input type="text" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} className={INPUT_FIELD} />
                </Field>
                <Field label={t.identity.roleTitle}>
                  <input type="text" placeholder={t.identity.rolePlaceholder} value={role} onChange={(e) => { setRole(e.target.value); markDirty(); }} className={INPUT_FIELD} />
                </Field>
              </div>

              <Field label={t.identity.gender} className="mt-4">
                <div className="flex items-center gap-2">
                  {GENDER_DEFS.map((g) => {
                    const isActive = g.id === gender;
                    const label = g.id === 'male' ? t.identity.genderMale : g.id === 'female' ? t.identity.genderFemale : t.identity.genderNeutral;
                    return (
                      <button
                        key={g.id}
                        onClick={() => { setGender(g.id); markDirty(); }}
                        className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-interactive border transition-all ${
                          isActive
                            ? `bg-gradient-to-br ${g.tint} text-foreground border-violet-500/40 shadow-elevation-1`
                            : 'text-foreground/65 border-primary/10 hover:border-primary/20 hover:text-foreground'
                        }`}
                      >
                        <span className="text-2xl leading-none">{g.glyph}</span>
                        <span className="typo-caption">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
            </Section>

            <Section index="02" label="biography">
              <Field label={t.identity.bio} action={
                <button
                  onClick={() => setShowBioGen(!showBioGen)}
                  className="flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200 transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  {showBioGen ? t.identity.cancel : t.identity.generateWithAi}
                </button>
              }>
                {showBioGen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-2 p-3 rounded-card border border-violet-500/25 bg-violet-500/5 space-y-3"
                  >
                    <p className="typo-caption text-foreground/65">{t.identity.bioGenHint}</p>
                    <input type="text" placeholder={t.identity.bioKeywordsPlaceholder} value={bioKeywords} onChange={(e) => setBioKeywords(e.target.value)} className={INPUT_FIELD} autoFocus />
                    <div className="flex justify-end">
                      <Button onClick={handleGenerateBio} disabled={generating || !bioKeywords.trim()} size="sm" variant="accent" accentColor="violet">
                        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                        {generating ? t.identity.generating : t.identity.generateBio}
                      </Button>
                    </div>
                  </motion.div>
                )}
                <textarea
                  rows={7}
                  placeholder={t.identity.bioPlaceholder}
                  value={bio}
                  onChange={(e) => { setBio(e.target.value); markDirty(); }}
                  className={`${INPUT_FIELD} resize-y leading-relaxed`}
                />
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-foreground/55 tabular-nums">
                  <span>{stats.bioWords} words</span>
                  <span>·</span>
                  <span>{stats.bioChars} chars</span>
                  <span className="ml-auto">
                    {stats.bioWords >= 30 ? <span className="text-emerald-300">strong</span> : stats.bioWords >= 10 ? <span className="text-amber-300">developing</span> : stats.bioWords > 0 ? <span className="text-violet-300">draft</span> : 'empty'}
                  </span>
                </div>
              </Field>
            </Section>

            <Section index="03" label="vault binding">
              <Field label={t.identity.obsidianVaultSubpath} hint={t.identity.obsidianSubpathHint} icon={FolderTree}>
                <input type="text" value={obsidianSubpath} onChange={(e) => { setObsidianSubpath(e.target.value); markDirty(); }} className={`${INPUT_FIELD} font-mono`} />
              </Field>
            </Section>
          </div>

          {/* RIGHT — Manuscript preview */}
          <aside className="min-w-0">
            <div className="sticky top-4 space-y-4">
              <div className="rounded-card border border-violet-500/20 bg-gradient-to-br from-violet-500/8 via-card/40 to-fuchsia-500/5 shadow-elevation-2 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-500/15 bg-violet-500/8">
                  <Quote className="w-3.5 h-3.5 text-violet-300" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-medium">{t.identity.promptPreview}</span>
                  <span className="ml-auto typo-caption text-foreground/55 tabular-nums">{stats.bioChars} chars</span>
                </div>
                {/* Body */}
                <div className="p-5 md:p-6 space-y-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-foreground/45 font-medium">opening line</p>
                  <p className="typo-body text-foreground leading-relaxed">
                    <span className="italic text-foreground/65">{t.identity.promptYouAreSpeaking}</span>{' '}
                    <span className="font-semibold text-violet-200">{name.trim() || t.identity.promptNoName}</span>
                    {role.trim() && <span className="text-foreground/85">, {role.trim()}</span>}
                    <span className="text-foreground/65">.</span>
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <div className="h-px flex-1 bg-violet-500/15" />
                    <p className="text-[11px] uppercase tracking-[0.22em] text-foreground/45 font-medium">biography</p>
                    <div className="h-px flex-1 bg-violet-500/15" />
                  </div>

                  <p className="typo-body text-foreground/85 leading-relaxed whitespace-pre-wrap">
                    {bio.trim() || <span className="italic text-foreground/40">{t.identity.promptNoBio}</span>}
                  </p>

                  {obsidianSubpath.trim() && (
                    <>
                      <div className="flex items-center gap-2 pt-1">
                        <div className="h-px flex-1 bg-violet-500/15" />
                        <p className="text-[11px] uppercase tracking-[0.22em] text-foreground/45 font-medium">memory anchor</p>
                        <div className="h-px flex-1 bg-violet-500/15" />
                      </div>
                      <div className="flex items-center gap-2 typo-caption text-foreground/65">
                        <FolderTree className="w-3.5 h-3.5" />
                        <span className="font-mono text-[11px]">{obsidianSubpath}</span>
                      </div>
                    </>
                  )}
                </div>
                {/* Footer signature */}
                <div className="px-4 py-2.5 border-t border-violet-500/15 bg-card/40 flex items-center gap-2">
                  <span className="text-[9px] uppercase tracking-[0.22em] text-foreground/45">signed</span>
                  <span className="font-mono text-[10px] text-foreground/65">{activeTwin.id.slice(0, 8)}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-foreground/45">live preview</span>
                </div>
              </div>

              {/* Field readiness */}
              <div className="rounded-card border border-primary/10 bg-card/40 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium mb-3">readiness</p>
                <div className="space-y-2">
                  <Pulse label={t.identity.name} on={stats.nameSet} />
                  <Pulse label={t.identity.roleTitle} on={stats.roleSet} />
                  <Pulse label={t.identity.bio} on={stats.bioWords > 5} pending={stats.bioWords > 0 && stats.bioWords <= 5} />
                  <Pulse label={t.identity.obsidianVaultSubpath} on={stats.pathSet} />
                  <Pulse label={t.identity.gender} on={true} />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function Section({ index, label, children }: { index: string; label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-primary/10 bg-card/40 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-[10px] text-violet-300 tracking-wider">{index}</span>
        <span className="text-[10px] uppercase tracking-[0.22em] text-foreground/55 font-medium">{label}</span>
        <div className="h-px flex-1 bg-primary/10" />
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, icon: Icon, action, className = '', children }: { label: string; hint?: string; icon?: typeof FolderTree; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-foreground/55" />}
          <span className="typo-caption text-foreground/75 font-medium">{label}</span>
        </div>
        {action}
      </div>
      {children}
      {hint && <p className="typo-caption text-foreground/55 mt-1">{hint}</p>}
    </label>
  );
}

function Stat({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-lg tabular-nums ${tone}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}

function Pulse({ label, on, pending }: { label: string; on: boolean; pending?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 typo-caption">
      <span className={`relative w-2 h-2 rounded-full ${on ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : pending ? 'bg-amber-400' : 'bg-foreground/15'}`} />
      <span className="text-foreground/75">{label}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wider text-foreground/45">{on ? 'set' : pending ? 'draft' : 'empty'}</span>
    </div>
  );
}
