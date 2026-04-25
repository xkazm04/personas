import { useEffect, useMemo, useState } from 'react';
import { User, Save, FolderTree, Sparkles, Wand2, Terminal } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { generateBio } from '@/api/twin/twin';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Console — "Identity Schema"
 *  Dense fixed-width fields on the left, live JSON / prompt preview on
 *  the right. Numeric tile strip + keyboard hints. Keyboard-first save.
 * ------------------------------------------------------------------ */

type Gender = 'male' | 'female' | 'neutral';
const GENDER_GLYPH: Record<Gender, string> = { male: '♂', female: '♀', neutral: '⚧' };

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

export default function IdentityConsole() {
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

  const fieldsFilled = [stats.nameSet, stats.roleSet, stats.bioWords > 0, stats.pathSet, true].filter(Boolean).length;

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!activeTwinId || !name.trim()) return;
    setSaving(true);
    try {
      await updateTwinProfile(activeTwinId, {
        name: name.trim(), bio: bio.trim() || null, role: role.trim() || null,
        pronouns: genderToPronouns(gender), obsidianSubpath: obsidianSubpath.trim() || undefined,
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

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving && name.trim()) void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, name]);

  if (!activeTwin) return <TwinEmptyState icon={User} title={t.identity.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">identity / {activeTwin.name || '?'}</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.identity.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2 mr-2">
          <Tile label="fields" value={`${fieldsFilled}/5`} />
          <Tile label="words" value={stats.bioWords} accent={stats.bioWords >= 30 ? 'emerald' : stats.bioWords >= 10 ? 'amber' : 'violet'} />
          <Tile label="chars" value={stats.bioChars} />
          <Tile label="state" value={dirty ? 'dirty' : 'saved'} accent={dirty ? 'amber' : 'emerald'} />
        </div>
        <Button onClick={handleSave} disabled={!dirty || saving || !name.trim()} size="sm" variant={dirty ? 'accent' : 'ghost'} accentColor="violet">
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? t.identity.saving : t.identity.saveIdentity}
        </Button>
      </div>

      {/* ── Body — split form/preview ────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_540px] min-h-full">

          {/* LEFT — dense field grid */}
          <div className="border-r border-primary/10 px-4 md:px-6 xl:px-8 py-5 space-y-5 min-w-0">
            <Block label="01 — identity">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <DenseField span={6} label={t.identity.name} required>
                  <input type="text" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} className={INPUT_FIELD} />
                </DenseField>
                <DenseField span={6} label={t.identity.roleTitle}>
                  <input type="text" placeholder={t.identity.rolePlaceholder} value={role} onChange={(e) => { setRole(e.target.value); markDirty(); }} className={INPUT_FIELD} />
                </DenseField>
                <DenseField span={12} label={t.identity.gender}>
                  <div className="flex items-stretch gap-1 rounded-interactive border border-primary/10 p-1 w-fit">
                    {(['male', 'female', 'neutral'] as Gender[]).map((g, i) => {
                      const isActive = g === gender;
                      const label = g === 'male' ? t.identity.genderMale : g === 'female' ? t.identity.genderFemale : t.identity.genderNeutral;
                      return (
                        <button
                          key={g}
                          onClick={() => { setGender(g); markDirty(); }}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-interactive transition-colors ${
                            isActive ? 'bg-violet-500/15 text-violet-200' : 'text-foreground/65 hover:bg-secondary/40 hover:text-foreground'
                          }`}
                        >
                          <span className="text-base leading-none">{GENDER_GLYPH[g]}</span>
                          <span className="text-xs">{label}</span>
                          <kbd className="hidden md:inline-block ml-1 px-1 py-0 rounded bg-primary/10 border border-primary/15 text-[9px] text-foreground/55 font-mono">{i + 1}</kbd>
                        </button>
                      );
                    })}
                  </div>
                </DenseField>
              </div>
            </Block>

            <Block label="02 — biography" action={
              <button
                onClick={() => setShowBioGen(!showBioGen)}
                className="flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200 transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {showBioGen ? t.identity.cancel : t.identity.generateWithAi}
              </button>
            }>
              {showBioGen && (
                <div className="mb-3 p-3 rounded-card border border-violet-500/25 bg-violet-500/5 space-y-2">
                  <p className="typo-caption text-foreground/65">{t.identity.bioGenHint}</p>
                  <div className="flex items-center gap-2">
                    <input type="text" placeholder={t.identity.bioKeywordsPlaceholder} value={bioKeywords} onChange={(e) => setBioKeywords(e.target.value)} className={`${INPUT_FIELD} flex-1`} autoFocus />
                    <Button onClick={handleGenerateBio} disabled={generating || !bioKeywords.trim()} size="sm" variant="accent" accentColor="violet">
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                      {generating ? t.identity.generating : t.identity.generateBio}
                    </Button>
                  </div>
                </div>
              )}
              <textarea
                rows={9}
                placeholder={t.identity.bioPlaceholder}
                value={bio}
                onChange={(e) => { setBio(e.target.value); markDirty(); }}
                className={`${INPUT_FIELD} resize-y`}
              />
              <div className="flex items-center gap-3 mt-1 text-[10px] text-foreground/55 tabular-nums">
                <span>{stats.bioWords}w · {stats.bioChars}ch</span>
                <div className="flex-1 h-1 rounded-full bg-primary/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${stats.bioWords >= 30 ? 'bg-emerald-400' : stats.bioWords >= 10 ? 'bg-amber-400' : 'bg-violet-400'}`}
                    style={{ width: `${Math.min(100, (stats.bioWords / 40) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] uppercase tracking-wider">
                  {stats.bioWords >= 30 ? <span className="text-emerald-300">strong</span> : stats.bioWords >= 10 ? <span className="text-amber-300">developing</span> : 'sparse'}
                </span>
              </div>
            </Block>

            <Block label="03 — vault binding">
              <DenseField span={12} label={t.identity.obsidianVaultSubpath} icon={FolderTree} hint={t.identity.obsidianSubpathHint}>
                <input type="text" value={obsidianSubpath} onChange={(e) => { setObsidianSubpath(e.target.value); markDirty(); }} className={`${INPUT_FIELD} font-mono`} />
              </DenseField>
            </Block>

            {/* Keyboard hints footer */}
            <div className="flex items-center gap-3 typo-caption text-foreground/55 pt-2 border-t border-primary/5">
              <Kbd>⌘ S</Kbd> save
              <Kbd>1 / 2 / 3</Kbd> gender (focus required)
              <span className="ml-auto">{dirty ? <span className="text-amber-300">unsaved changes</span> : 'all changes saved'}</span>
            </div>
          </div>

          {/* RIGHT — live preview */}
          <aside className="bg-background/40 px-4 md:px-6 py-5 min-w-0">
            <div className="sticky top-4 space-y-3">
              <div className="rounded-card border border-primary/15 bg-card/60 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-card/80">
                  <span className="w-2 h-2 rounded-full bg-foreground/25" />
                  <span className="w-2 h-2 rounded-full bg-foreground/25" />
                  <span className="w-2 h-2 rounded-full bg-foreground/25" />
                  <span className="ml-2 typo-caption font-mono text-foreground/65">prompt.txt</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-foreground/45">live</span>
                </div>
                <pre className="p-4 typo-code text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/90">
{`${t.identity.promptYouAreSpeaking} `}<span className="text-violet-300 font-semibold">{name.trim() || `<${t.identity.promptNoName}>`}</span>{role.trim() ? <>, <span className="text-cyan-300">{role.trim()}</span></> : ''}{`.

`}<span className="text-foreground/95">{bio.trim() || <span className="italic text-foreground/40">{t.identity.promptNoBio}</span>}</span>
                </pre>
                <div className="px-3 py-2 border-t border-primary/10 bg-card/80 flex items-center gap-3 typo-caption text-foreground/55">
                  <span className="font-mono text-[10px]">id: {activeTwin.id.slice(0, 8)}</span>
                  <span>·</span>
                  <span className="font-mono text-[10px]">pronouns: {gender}</span>
                  <span className="ml-auto tabular-nums text-[10px]">{stats.bioChars}c</span>
                </div>
              </div>

              <div className="rounded-card border border-primary/10 bg-card/40 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium mb-2">field map</p>
                <div className="space-y-1.5 text-xs">
                  <SchemaRow k="name" v={name} required />
                  <SchemaRow k="role" v={role} />
                  <SchemaRow k="pronouns" v={gender} />
                  <SchemaRow k="bio" v={bio} multiline />
                  <SchemaRow k="vault_path" v={obsidianSubpath} mono />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────── */

function Block({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/55">{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

const SPAN_CLASS: Record<number, string> = {
  6: 'sm:col-span-6',
  12: 'sm:col-span-12',
};

function DenseField({ span, label, icon: Icon, hint, required, children }: { span: 6 | 12; label: string; icon?: typeof FolderTree; hint?: string; required?: boolean; children: React.ReactNode }) {
  const colSpan = SPAN_CLASS[span] ?? 'sm:col-span-12';
  return (
    <label className={`block space-y-1 ${colSpan}`}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3 text-foreground/55" />}
        <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/65 font-medium">{label}</span>
        {required && <span className="text-[10px] text-amber-300">*</span>}
      </div>
      {children}
      {hint && <p className="typo-caption text-foreground/55">{hint}</p>}
    </label>
  );
}

function Tile({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300 border-emerald-500/25' : accent === 'amber' ? 'text-amber-300 border-amber-500/25' : 'text-violet-300 border-violet-500/25';
  return (
    <div className={`rounded-interactive border ${tone} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[64px]`}>
      <span className="typo-data-lg tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/15 text-[10px] font-mono text-foreground/75">{children}</kbd>;
}

function SchemaRow({ k, v, multiline, mono, required }: { k: string; v: string; multiline?: boolean; mono?: boolean; required?: boolean }) {
  const empty = !v || v.trim().length === 0;
  return (
    <div className="grid grid-cols-[110px_1fr_auto] gap-2 items-baseline">
      <span className="font-mono text-[11px] text-foreground/55">{k}</span>
      <span className={`${mono ? 'font-mono text-[11px]' : ''} ${empty ? 'italic text-foreground/40' : 'text-foreground'} ${multiline ? 'line-clamp-2' : 'truncate'}`}>
        {empty ? '—' : v}
      </span>
      <span className={`text-[9px] uppercase tracking-wider ${empty ? (required ? 'text-amber-300' : 'text-foreground/40') : 'text-emerald-300'}`}>
        {empty ? (required ? 'required' : 'empty') : 'set'}
      </span>
    </div>
  );
}
