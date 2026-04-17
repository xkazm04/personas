import { useState } from 'react';
import { X, ArrowLeft, ArrowRight, Sparkles, User, Radio, GraduationCap, Wand2, Link as LinkIcon, FileText, ChevronRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import * as twinApi from '@/api/twin/twin';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/**
 * Four-step wizard for creating a twin with a chronological onboarding
 * experience (Direction 2).
 *
 * Step 1  Basics        name + role + gender
 * Step 2  Bio           keywords / URL ingest / skip
 * Step 3  Channels      show matching vault credentials; user picks which
 *                       channels they plan to deploy on. These are stored
 *                       as a localStorage hint so the Tone tab can pre-
 *                       expand those cards on first visit.
 * Step 4  Training      optional handoff to the Training tab with the
 *                       newly-created twin already active.
 */

type Gender = 'male' | 'female' | 'neutral';

const CHANNEL_TYPES = [
  { id: 'discord', label: 'Discord', serviceMatch: 'discord' },
  { id: 'slack', label: 'Slack', serviceMatch: 'slack' },
  { id: 'email', label: 'Email', serviceMatch: 'gmail' },
  { id: 'telegram', label: 'Telegram', serviceMatch: 'telegram' },
  { id: 'sms', label: 'SMS', serviceMatch: 'twilio' },
  { id: 'teams', label: 'Teams', serviceMatch: 'microsoft-teams' },
  { id: 'whatsapp', label: 'WhatsApp', serviceMatch: 'whatsapp' },
] as const;

function pronounsFromGender(g: Gender): string {
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  return 'neutral';
}

export function CreateTwinWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTwinTranslation();
  const createTwinProfile = useSystemStore((s) => s.createTwinProfile);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const credentials = useVaultStore((s) => s.credentials);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [gender, setGender] = useState<Gender>('neutral');

  // Step 2
  const [bioMethod, setBioMethod] = useState<'keywords' | 'url' | 'skip'>('keywords');
  const [bioKeywords, setBioKeywords] = useState('');
  const [bioUrl, setBioUrl] = useState('');
  const [bio, setBio] = useState('');
  const [ingesting, setIngesting] = useState(false);

  // Step 3
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());

  // Step 4
  // The `trainNow` choice isn't stored; the two buttons directly call finish().

  const canContinueFrom1 = name.trim().length > 0;

  const handleGenerateBio = async () => {
    if (!bioKeywords.trim()) return;
    setIngesting(true);
    try {
      const result = await twinApi.generateBio(name.trim() || 'Twin', role.trim() || null, bioKeywords.trim());
      setBio(result);
    } catch {
      // Fallback: compose a minimal bio from keywords
      const keywords = bioKeywords.split(',').map((k) => k.trim()).filter(Boolean);
      setBio(`${name.trim() || 'Twin'}${role.trim() ? `, ${role.trim()}` : ''}. ${keywords.join('. ')}.`);
    } finally {
      setIngesting(false);
    }
  };

  const handleIngestUrl = async () => {
    if (!bioUrl.trim()) return;
    setIngesting(true);
    try {
      // `twin_ingest_url` scrapes a URL and returns a summary the user can
      // trim. Full memory ingestion kicks in once the twin row exists
      // (the backend will queue pending memories there on a later pass).
      const result = await invoke<string>('twin_ingest_url', { url: bioUrl.trim() });
      setBio(result);
    } catch {
      setBio(`Bio to be filled — failed to ingest ${bioUrl.trim()}.`);
    } finally {
      setIngesting(false);
    }
  };

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const credentialsByChannel = CHANNEL_TYPES.map((ct) => ({
    ...ct,
    matched: credentials.filter((c) => c.service_type.toLowerCase().includes(ct.serviceMatch.toLowerCase())),
  })).filter((row) => row.matched.length > 0);

  const finish = async (trainAfter: boolean) => {
    setSubmitting(true);
    try {
      const profile = await createTwinProfile(
        name.trim(),
        bio.trim() || undefined,
        role.trim() || undefined,
        undefined,
        pronounsFromGender(gender),
      );

      // Capture the channel intent so the Tone tab can pre-expand these
      // channels on first visit. We don't pre-create tone rows because
      // the backend requires a non-empty voice_directives value.
      if (selectedChannels.size > 0) {
        try {
          window.localStorage.setItem(
            `twin.wizard.pending_tones.${profile.id}`,
            JSON.stringify([...selectedChannels]),
          );
        } catch {
          // localStorage unavailable — not critical
        }
      }

      onClose();

      if (trainAfter) setTwinTab('training');
      else if (selectedChannels.size > 0) setTwinTab('tone');
      else setTwinTab('identity');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="twin-wizard-title">
      <div className="w-full max-w-xl rounded-card border border-violet-500/20 bg-card shadow-elevation-3 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h2 id="twin-wizard-title" className="typo-section-title">{t.wizard.title}</h2>
          </div>
          <button onClick={onClose} aria-label={t.wizard.close} className="p-1 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-primary/5 bg-secondary/[0.02]">
          <span className="typo-caption text-foreground">{t.wizard.step.replace('{current}', String(step)).replace('{total}', '4')}</span>
          <div className="flex items-center gap-1.5" aria-hidden>
            {[1, 2, 3, 4].map((s) => (
              <span
                key={s}
                className={`w-1.5 h-1.5 rounded-full ${step === s ? 'bg-violet-400' : step > s ? 'bg-violet-400/40' : 'bg-secondary/60'}`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {step === 1 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-violet-400" />
                <h3 className="typo-section-title">{t.wizard.step1Title}</h3>
              </div>
              <p className="typo-caption text-foreground mb-4">{t.wizard.step1Hint}</p>

              <label className="block space-y-1.5">
                <span className="typo-caption text-foreground font-medium">{t.profiles.name}</span>
                <input type="text" placeholder={t.profiles.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} className={INPUT_FIELD} autoFocus />
              </label>

              <label className="block space-y-1.5">
                <span className="typo-caption text-foreground font-medium">{t.identity.roleTitle}</span>
                <input type="text" placeholder={t.identity.rolePlaceholder} value={role} onChange={(e) => setRole(e.target.value)} className={INPUT_FIELD} />
              </label>

              <div className="space-y-1.5">
                <span className="typo-caption text-foreground font-medium">{t.identity.gender}</span>
                <div className="flex items-center gap-2">
                  {(['male', 'female', 'neutral'] as const).map((g) => {
                    const labelMap = { male: t.identity.genderMale, female: t.identity.genderFemale, neutral: t.identity.genderNeutral };
                    const glyph = g === 'male' ? '♂' : g === 'female' ? '♀' : '⚧';
                    return (
                      <button
                        key={g}
                        onClick={() => setGender(g)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-interactive border transition-colors ${
                          gender === g ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'text-foreground border-primary/10 hover:bg-secondary/40 hover:text-foreground'
                        }`}
                      >
                        <span className="text-base">{glyph}</span>
                        <span className="typo-caption">{labelMap[g]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-violet-400" />
                <h3 className="typo-section-title">{t.wizard.step2Title}</h3>
              </div>
              <p className="typo-caption text-foreground mb-3">{t.wizard.step2Hint}</p>

              {/* Method chooser */}
              <div className="grid grid-cols-1 gap-2">
                <MethodCard
                  active={bioMethod === 'keywords'}
                  onClick={() => setBioMethod('keywords')}
                  icon={Wand2}
                  title={t.wizard.methodKeywords}
                  body={t.wizard.methodKeywordsBody}
                />
                <MethodCard
                  active={bioMethod === 'url'}
                  onClick={() => setBioMethod('url')}
                  icon={LinkIcon}
                  title={t.wizard.methodUrl}
                  body={t.wizard.methodUrlBody}
                />
                <MethodCard
                  active={bioMethod === 'skip'}
                  onClick={() => setBioMethod('skip')}
                  icon={ChevronRight}
                  title={t.wizard.methodSkip}
                  body={t.wizard.methodSkipBody}
                />
              </div>

              {bioMethod === 'keywords' && (
                <div className="space-y-2 pt-2">
                  <input
                    type="text"
                    placeholder={t.identity.bioKeywordsPlaceholder}
                    value={bioKeywords}
                    onChange={(e) => setBioKeywords(e.target.value)}
                    className={INPUT_FIELD}
                  />
                  <div className="flex justify-end">
                    <Button onClick={handleGenerateBio} disabled={ingesting || !bioKeywords.trim()} size="sm" variant="accent" accentColor="violet">
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                      {ingesting ? t.identity.generating : t.identity.generateBio}
                    </Button>
                  </div>
                </div>
              )}

              {bioMethod === 'url' && (
                <div className="space-y-2 pt-2">
                  <input
                    type="url"
                    placeholder={t.wizard.urlPlaceholder}
                    value={bioUrl}
                    onChange={(e) => setBioUrl(e.target.value)}
                    className={`${INPUT_FIELD} font-mono text-xs`}
                  />
                  <div className="flex justify-end">
                    <Button onClick={handleIngestUrl} disabled={ingesting || !bioUrl.trim()} size="sm" variant="accent" accentColor="violet">
                      <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
                      {ingesting ? t.wizard.ingesting : t.wizard.ingestUrl}
                    </Button>
                  </div>
                </div>
              )}

              {bio && (
                <textarea
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className={`${INPUT_FIELD} resize-y mt-2`}
                />
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Radio className="w-4 h-4 text-violet-400" />
                <h3 className="typo-section-title">{t.wizard.step3Title}</h3>
              </div>
              <p className="typo-caption text-foreground mb-3">{t.wizard.step3Hint}</p>

              {credentialsByChannel.length === 0 ? (
                <p className="typo-caption text-foreground italic">{t.wizard.step3NoCreds}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {credentialsByChannel.map((row) => {
                    const selected = selectedChannels.has(row.id);
                    return (
                      <button
                        key={row.id}
                        onClick={() => toggleChannel(row.id)}
                        className={`flex items-start gap-3 p-3 rounded-card border transition-colors text-left ${
                          selected ? 'border-violet-500/30 bg-violet-500/10' : 'border-primary/10 bg-card/40 hover:border-violet-500/20 hover:bg-violet-500/5'
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-interactive flex items-center justify-center flex-shrink-0 ${selected ? 'bg-violet-500/20' : 'bg-secondary/40'}`}>
                          <Radio className={`w-3.5 h-3.5 ${selected ? 'text-violet-400' : 'text-foreground'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="typo-body text-foreground font-medium">{row.label}</p>
                          <p className="typo-caption text-foreground truncate">
                            {row.matched.length} credential{row.matched.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap className="w-4 h-4 text-violet-400" />
                <h3 className="typo-section-title">{t.wizard.step4Title}</h3>
              </div>
              <p className="typo-caption text-foreground mb-4">{t.wizard.step4Hint}</p>

              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => void finish(true)}
                  disabled={submitting}
                  className="flex items-start gap-3 p-4 rounded-card border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/15 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-interactive bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-4 h-4 text-violet-400" />
                  </div>
                  <div className="flex-1">
                    <p className="typo-body text-foreground font-medium">{submitting ? t.wizard.trainLoading : t.wizard.trainNow}</p>
                    <p className="typo-caption text-foreground mt-0.5">{t.training.topicHint}</p>
                  </div>
                </button>

                <button
                  onClick={() => void finish(false)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-interactive border border-primary/10 bg-card/40 hover:bg-secondary/40 transition-colors text-left disabled:opacity-50"
                >
                  <p className="typo-caption text-foreground">{t.wizard.trainLater}</p>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer nav (hidden on final step because Step 4 has its own CTA buttons) */}
        {step < 4 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-primary/10">
            <Button onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))} variant="ghost" size="sm" disabled={step === 1}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              {t.wizard.back}
            </Button>
            <div className="flex items-center gap-2">
              {step === 2 && bioMethod === 'skip' && (
                <span className="typo-caption text-foreground italic">{t.wizard.methodSkipBody}</span>
              )}
              <Button
                onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s))}
                size="sm"
                disabled={step === 1 && !canContinueFrom1}
              >
                {t.wizard.next}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MethodCardProps {
  active: boolean;
  onClick: () => void;
  icon: typeof Wand2;
  title: string;
  body: string;
}

function MethodCard({ active, onClick, icon: Icon, title, body }: MethodCardProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-card border transition-colors text-left ${
        active ? 'border-violet-500/30 bg-violet-500/10' : 'border-primary/10 bg-card/40 hover:border-violet-500/20 hover:bg-violet-500/5'
      }`}
    >
      <div className={`w-7 h-7 rounded-interactive flex items-center justify-center flex-shrink-0 ${active ? 'bg-violet-500/20' : 'bg-secondary/40'}`}>
        <Icon className={`w-3.5 h-3.5 ${active ? 'text-violet-400' : 'text-foreground'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground font-medium">{title}</p>
        <p className="typo-caption text-foreground mt-0.5">{body}</p>
      </div>
    </button>
  );
}
