import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Plus, Trash2, Save, Sparkles, MessageCircle, ListChecks, Ruler, Quote } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannelKind } from '@/api/enums';

/* ------------------------------------------------------------------ *
 *  Atelier — "Voice Studio"
 *  Left rail of channel "stations" with brand colours, centre stage card
 *  for the active channel showing directives, length, constraints, and
 *  parsed examples as speech bubbles. Decorative wave in the header.
 * ------------------------------------------------------------------ */

const CHANNELS = [
  { id: 'generic', label: 'Generic', stroke: 'violet', from: 'from-violet-500/30', to: 'to-fuchsia-500/15', dot: 'bg-violet-400' },
  { id: 'discord', label: 'Discord', stroke: 'indigo', from: 'from-indigo-500/30', to: 'to-violet-500/15', dot: 'bg-indigo-400' },
  { id: 'slack', label: 'Slack', stroke: 'cyan', from: 'from-cyan-500/30', to: 'to-sky-500/15', dot: 'bg-cyan-400' },
  { id: 'email', label: 'Email', stroke: 'amber', from: 'from-amber-500/30', to: 'to-orange-500/15', dot: 'bg-amber-400' },
  { id: 'sms', label: 'SMS', stroke: 'emerald', from: 'from-emerald-500/30', to: 'to-teal-500/15', dot: 'bg-emerald-400' },
  { id: 'voice', label: 'Voice', stroke: 'rose', from: 'from-rose-500/30', to: 'to-pink-500/15', dot: 'bg-rose-400' },
] as const;

const CHANNEL_TINT: Record<string, { ring: string; text: string; glow: string }> = {
  violet: { ring: 'ring-violet-500/40', text: 'text-violet-300', glow: 'shadow-[0_0_24px_rgba(167,139,250,0.18)]' },
  indigo: { ring: 'ring-indigo-500/40', text: 'text-indigo-300', glow: 'shadow-[0_0_24px_rgba(129,140,248,0.18)]' },
  cyan: { ring: 'ring-cyan-500/40', text: 'text-cyan-300', glow: 'shadow-[0_0_24px_rgba(34,211,238,0.18)]' },
  amber: { ring: 'ring-amber-500/40', text: 'text-amber-300', glow: 'shadow-[0_0_24px_rgba(251,191,36,0.18)]' },
  emerald: { ring: 'ring-emerald-500/40', text: 'text-emerald-300', glow: 'shadow-[0_0_24px_rgba(52,211,153,0.18)]' },
  rose: { ring: 'ring-rose-500/40', text: 'text-rose-300', glow: 'shadow-[0_0_24px_rgba(244,114,182,0.18)]' },
};

interface ToneForm { voiceDirectives: string; examplesJson: string; constraintsJson: string; lengthHint: string; }
const EMPTY: ToneForm = { voiceDirectives: '', examplesJson: '', constraintsJson: '', lengthHint: '' };
function toneToForm(tn: TwinTone): ToneForm {
  return { voiceDirectives: tn.voice_directives, examplesJson: tn.examples_json ?? '', constraintsJson: tn.constraints_json ?? '', lengthHint: tn.length_hint ?? '' };
}

function parseExamples(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 6);
  } catch { /* fall through */ }
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
}
function parseConstraints(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 8);
  } catch { /* fall through */ }
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

export default function ToneAtelier() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  const isLoading = useSystemStore((s) => s.twinTonesLoading);
  const fetchTwinTones = useSystemStore((s) => s.fetchTwinTones);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const deleteTwinTone = useSystemStore((s) => s.deleteTwinTone);

  const [activeChannel, setActiveChannel] = useState<string>('generic');
  const [forms, setForms] = useState<Record<string, ToneForm>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  useEffect(() => { if (activeTwinId) fetchTwinTones(activeTwinId); }, [activeTwinId, fetchTwinTones]);
  useEffect(() => {
    const next: Record<string, ToneForm> = {};
    for (const tn of twinTones) next[tn.channel] = toneToForm(tn);
    setForms(next);
  }, [twinTones]);

  const getForm = (ch: string): ToneForm => forms[ch] ?? EMPTY;
  const setForm = (ch: string, partial: Partial<ToneForm>) => {
    setForms((prev) => ({ ...prev, [ch]: { ...(prev[ch] ?? EMPTY), ...partial } }));
  };
  const hasTone = (ch: string) => twinTones.some((tn) => tn.channel === ch);

  const handleSave = async (ch: string) => {
    if (!activeTwinId) return;
    const f = getForm(ch);
    setSavingChannel(ch);
    try {
      await upsertTwinTone(activeTwinId, ch as TwinChannelKind, f.voiceDirectives, f.examplesJson.trim() || null, f.constraintsJson.trim() || null, f.lengthHint.trim() || null);
    } finally { setSavingChannel(null); }
  };
  const handleDelete = async (ch: string) => {
    const tone = twinTones.find((tn) => tn.channel === ch);
    if (!tone) return;
    if (!confirm(t.tone.removeConfirm.replace('{channel}', ch))) return;
    await deleteTwinTone(tone.id);
    setForms((prev) => { const { [ch]: _, ...rest } = prev; return rest; });
  };

  const stats = useMemo(() => ({
    configured: twinTones.length,
    withExamples: twinTones.filter((tn) => (tn.examples_json ?? '').trim().length > 0).length,
    withLength: twinTones.filter((tn) => (tn.length_hint ?? '').trim().length > 0).length,
  }), [twinTones]);

  if (!activeTwinId) return <TwinEmptyState icon={Mic} title={t.tone.title} />;

  const active = CHANNELS.find((c) => c.id === activeChannel) ?? CHANNELS[0];
  const tint = CHANNEL_TINT[active.stroke] ?? CHANNEL_TINT.violet!;
  const form = getForm(active.id);
  const exists = hasTone(active.id);
  const examples = parseExamples(form.examplesJson);
  const constraints = parseConstraints(form.constraintsJson);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band with sound-wave decoration ──────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className={`absolute inset-0 bg-gradient-to-r ${active.from} ${active.to} opacity-90 transition-colors duration-500`} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/85" />
        {/* Decorative waveform */}
        <svg className="absolute inset-0 w-full h-full opacity-30 pointer-events-none" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0,60 Q 50,30 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60" stroke="currentColor" strokeWidth="1" fill="none" className={tint.text} />
          <path d="M0,60 Q 50,80 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" className={tint.text} />
        </svg>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className={`relative w-11 h-11 rounded-full bg-card/60 border ${tint.ring.replace('ring-', 'border-')} flex items-center justify-center ${tint.glow}`}>
            <Mic className={`w-5 h-5 ${tint.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-[0.22em] ${tint.text} font-medium`}>Voice Studio</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.tone.title}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.tone.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="configured" value={`${stats.configured}/${CHANNELS.length}`} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="examples" value={stats.withExamples} accent={stats.withExamples > 0 ? 'emerald' : 'violet'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="length set" value={stats.withLength} />
          </div>
        </div>
      </div>

      {/* ── Body — left rail + stage ────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[260px_1fr]">

        {/* LEFT — channel stations */}
        <aside className="border-r border-primary/10 overflow-y-auto bg-card/20">
          <div className="px-4 py-4 space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium mb-2">channels</p>
            {CHANNELS.map((c) => {
              const t2 = CHANNEL_TINT[c.stroke];
              const has = hasTone(c.id);
              const isActive = c.id === active.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChannel(c.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-card border transition-all ${
                    isActive
                      ? `border-violet-500/30 bg-gradient-to-r ${c.from} ${c.to}`
                      : 'border-transparent hover:border-primary/15 hover:bg-secondary/30'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center flex-shrink-0`}>
                    <Mic className={`w-3.5 h-3.5 ${t2?.text ?? 'text-foreground/65'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="typo-caption font-medium text-foreground">{c.label}</p>
                    <p className="text-[10px] text-foreground/55">{c.id === 'generic' ? 'default fallback' : has ? 'overrides generic' : 'falls back to generic'}</p>
                  </div>
                  <span className={`w-1.5 h-1.5 rounded-full ${has ? c.dot : 'bg-foreground/15'}`} />
                </button>
              );
            })}
          </div>
        </aside>

        {/* RIGHT — stage */}
        <div className="overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="typo-body text-foreground">{t.tone.loading}</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="px-4 md:px-6 xl:px-8 py-6 max-w-[1100px] mx-auto space-y-5"
              >
                {/* Stage header */}
                <div className={`relative rounded-card border ${tint.ring.replace('ring-', 'border-')} bg-gradient-to-br ${active.from} ${active.to} p-5 ${tint.glow}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center">
                      <Mic className={`w-5 h-5 ${tint.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] uppercase tracking-[0.22em] ${tint.text} font-medium`}>active stage</p>
                      <h2 className="typo-section-title">{active.label}</h2>
                    </div>
                    {exists ? (
                      <span className={`px-2.5 py-0.5 text-[10px] font-medium rounded-full ${tint.text} bg-card/60 border ${tint.ring.replace('ring-', 'border-')}`}>configured</span>
                    ) : (
                      <span className="px-2.5 py-0.5 text-[10px] font-medium rounded-full text-foreground/55 bg-secondary/40 border border-primary/10">{t.tone.fallsBackToGeneric}</span>
                    )}
                  </div>
                </div>

                {/* Voice directives — hero card */}
                <Section icon={Sparkles} label={t.tone.voiceDirectives} accent={tint.text}>
                  <textarea
                    rows={5}
                    placeholder={t.tone.voiceDirectivesPlaceholder.replace('{channel}', active.label)}
                    value={form.voiceDirectives}
                    onChange={(e) => setForm(active.id, { voiceDirectives: e.target.value })}
                    className={`${INPUT_FIELD} resize-y leading-relaxed`}
                  />
                </Section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Section icon={Ruler} label={t.tone.lengthHint} accent={tint.text}>
                    <input type="text" placeholder={t.tone.lengthHintPlaceholder} value={form.lengthHint} onChange={(e) => setForm(active.id, { lengthHint: e.target.value })} className={INPUT_FIELD} />
                  </Section>
                  <Section icon={ListChecks} label={t.tone.constraints} accent={tint.text}>
                    <input type="text" placeholder={t.tone.constraintsPlaceholder} value={form.constraintsJson} onChange={(e) => setForm(active.id, { constraintsJson: e.target.value })} className={`${INPUT_FIELD} font-mono`} />
                    {constraints.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {constraints.map((c, i) => (
                          <span key={i} className="px-2 py-0.5 text-[10px] rounded-full bg-secondary/50 text-foreground/85 border border-primary/10">{c}</span>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>

                {/* Examples — speech bubbles */}
                <Section icon={Quote} label={t.tone.exampleMessages} accent={tint.text}>
                  <textarea
                    rows={3}
                    placeholder={t.tone.exampleMessagesPlaceholder}
                    value={form.examplesJson}
                    onChange={(e) => setForm(active.id, { examplesJson: e.target.value })}
                    className={`${INPUT_FIELD} font-mono resize-y`}
                  />
                  {examples.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">preview</p>
                      <div className="space-y-2">
                        {examples.map((ex, i) => (
                          <div key={i} className="flex items-end gap-2">
                            <div className="w-6 h-6 rounded-full bg-card/60 border border-primary/10 flex items-center justify-center flex-shrink-0">
                              <MessageCircle className={`w-3 h-3 ${tint.text}`} />
                            </div>
                            <div className={`max-w-[80%] px-3 py-2 rounded-card rounded-bl-sm bg-gradient-to-br ${active.from} ${active.to} border border-primary/10`}>
                              <p className="typo-body text-foreground/90 leading-relaxed">{ex}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>

                {/* Footer actions */}
                <div className="flex items-center justify-between pt-2 border-t border-primary/10">
                  {exists && active.id !== 'generic' ? (
                    <button onClick={() => handleDelete(active.id)} className="flex items-center gap-1.5 text-xs text-foreground/65 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />{t.tone.removeOverride}
                    </button>
                  ) : <span />}
                  <Button onClick={() => handleSave(active.id)} disabled={savingChannel === active.id || !form.voiceDirectives.trim()} size="sm" variant="accent" accentColor="violet">
                    {exists ? <><Save className="w-4 h-4 mr-1.5" />{savingChannel === active.id ? t.tone.saving : t.tone.save}</> : <><Plus className="w-4 h-4 mr-1.5" />{savingChannel === active.id ? t.tone.creating : t.tone.create}</>}
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, label, accent, children }: { icon: typeof Sparkles; label: string; accent: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-primary/10 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className={`w-3.5 h-3.5 ${accent}`} />
        <span className="typo-caption font-medium text-foreground/75">{label}</span>
      </div>
      {children}
    </section>
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
