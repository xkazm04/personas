import { useEffect, useState } from 'react';
import { User, Save, FolderTree, Sparkles, Wand2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { generateBio } from '@/api/twin/twin';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { CoachMark } from '../CoachMark';

/**
 * Identity tab — editable bio, role, gender for the active twin.
 * Shows the selected twin name in the header.
 * AI bio generator: user enters keywords, CLI generates a polished bio.
 */

type Gender = 'male' | 'female' | 'neutral';
// Labels resolved via useTwinTranslation in the component.
const GENDER_ICONS: Record<Gender, string> = { male: '♂', female: '♀', neutral: '⚧' };

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

/* ------------------------------------------------------------------ */
/*  BioGeneratorPanel — AI-powered bio drafting                       */
/* ------------------------------------------------------------------ */

interface BioGeneratorPanelProps {
  name: string;
  role: string;
  onBioGenerated: (bio: string) => void;
  onClose: () => void;
}

function BioGeneratorPanel({ name, role, onBioGenerated, onClose }: BioGeneratorPanelProps) {
  const { t } = useTwinTranslation();
  const [bioKeywords, setBioKeywords] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!bioKeywords.trim() || !name.trim()) return;
    setGenerating(true);
    try {
      const result = await generateBio(name.trim(), role.trim() || null, bioKeywords.trim());
      onBioGenerated(result);
      onClose();
    } catch {
      // Fallback: construct a basic bio from keywords
      const keywords = bioKeywords.split(',').map((k) => k.trim()).filter(Boolean);
      onBioGenerated(`${name.trim()}${role.trim() ? `, ${role.trim()}` : ''}. ${keywords.join('. ')}.`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-3 rounded-card border border-violet-500/15 bg-violet-500/5 space-y-3">
      <p className="typo-caption text-foreground">{t.identity.bioGenHint}</p>
      <input
        type="text"
        placeholder={t.identity.bioKeywordsPlaceholder}
        value={bioKeywords}
        onChange={(e) => setBioKeywords(e.target.value)}
        className={INPUT_FIELD}
        autoFocus
      />
      <div className="flex justify-end">
        <Button onClick={handleGenerate} disabled={generating || !bioKeywords.trim()} size="sm" variant="accent" accentColor="violet">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          {generating ? t.identity.generating : t.identity.generateBio}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  IdentityPage                                                      */
/* ------------------------------------------------------------------ */

export default function IdentityPage() {
  const { t } = useTwinTranslation();
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);

  const genderOptions: { id: Gender; label: string }[] = [
    { id: 'male', label: t.identity.genderMale },
    { id: 'female', label: t.identity.genderFemale },
    { id: 'neutral', label: t.identity.genderNeutral },
  ];

  const activeTwin = twinProfiles.find((t) => t.id === activeTwinId);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [role, setRole] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');
  const [obsidianSubpath, setObsidianSubpath] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [showBioGen, setShowBioGen] = useState(false);

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
  }, [activeTwin?.id]); // reset form when active twin changes

  useEffect(() => {
    if (twinProfiles.length === 0) fetchTwinProfiles();
  }, [twinProfiles.length, fetchTwinProfiles]);

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
    } finally {
      setSaving(false);
    }
  };

  const handleBioGenerated = (generatedBio: string) => {
    setBio(generatedBio);
    setDirty(true);
  };

  const markDirty = () => setDirty(true);

  if (!activeTwin) return <TwinEmptyState icon={User} title={t.identity.title} />;

  return (
    <ContentBox>
      <ContentHeader
        icon={<User className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={`${t.identity.title} — ${activeTwin.name}`}
        subtitle={t.identity.subtitle}
      />

      <ContentBody centered>
        <div className="max-w-2xl mx-auto space-y-6 pb-8">
          <CoachMark id="identity" title={t.coach.identityTitle} body={t.coach.identityBody} />
          {/* Name + Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="typo-body text-foreground font-medium">{t.identity.name}</span>
              <input type="text" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} className={INPUT_FIELD} />
            </label>
            <label className="space-y-2">
              <span className="typo-body text-foreground font-medium">{t.identity.roleTitle}</span>
              <input type="text" placeholder={t.identity.rolePlaceholder} value={role} onChange={(e) => { setRole(e.target.value); markDirty(); }} className={INPUT_FIELD} />
            </label>
          </div>

          {/* Gender icons */}
          <div className="space-y-2">
            <span className="typo-body text-foreground font-medium">{t.identity.gender}</span>
            <div className="flex items-center gap-2">
              {genderOptions.map((g) => (
                <button
                  key={g.id}
                  onClick={() => { setGender(g.id); markDirty(); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-interactive border transition-colors ${
                    gender === g.id
                      ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                      : 'text-foreground border-primary/10 hover:bg-secondary/40 hover:text-foreground'
                  }`}
                >
                  <span className="text-lg">{GENDER_ICONS[g.id]}</span>
                  <span className="typo-caption">{g.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Bio + AI generator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="typo-body text-foreground font-medium">{t.identity.bio}</span>
              <button
                onClick={() => setShowBioGen(!showBioGen)}
                className="flex items-center gap-1.5 typo-caption text-violet-400 hover:text-violet-300 transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {showBioGen ? t.identity.cancel : t.identity.generateWithAi}
              </button>
            </div>

            {showBioGen && (
              <BioGeneratorPanel
                name={name}
                role={role}
                onBioGenerated={handleBioGenerated}
                onClose={() => setShowBioGen(false)}
              />
            )}

            <textarea
              rows={5}
              placeholder={t.identity.bioPlaceholder}
              value={bio}
              onChange={(e) => { setBio(e.target.value); markDirty(); }}
              className={`${INPUT_FIELD} resize-y`}
            />
          </div>

          {/* Obsidian subpath */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FolderTree className="w-3.5 h-3.5 text-violet-400/60" />
              <span className="typo-body text-foreground font-medium">{t.identity.obsidianVaultSubpath}</span>
            </div>
            <input type="text" value={obsidianSubpath} onChange={(e) => { setObsidianSubpath(e.target.value); markDirty(); }} className={`${INPUT_FIELD} font-mono`} />
            <p className="typo-caption text-foreground">{t.identity.obsidianSubpathHint}</p>
          </div>

          {/* Prompt preview */}
          {(name.trim() || bio.trim() || role.trim()) && (
            <div className="p-4 rounded-card bg-violet-500/5 border border-violet-500/15">
              <p className="typo-caption text-violet-400 font-medium mb-2">{t.identity.promptPreview}</p>
              <pre className="typo-code text-foreground whitespace-pre-wrap text-xs leading-relaxed">
{`${t.identity.promptYouAreSpeaking} ${name.trim() || t.identity.promptNoName}${role.trim() ? `, ${role.trim()}` : ''}.

${bio.trim() || t.identity.promptNoBio}`}
              </pre>
            </div>
          )}

          {/* Save bar */}
          {dirty && (
            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving || !name.trim()} size="sm">
                <Save className="w-4 h-4 mr-1.5" />
                {saving ? t.identity.saving : t.identity.saveIdentity}
              </Button>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
