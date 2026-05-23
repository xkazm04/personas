import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Mic, Plus, Trash2, Save, Sparkles, MessageCircle, ListChecks, Ruler, Quote, Wand2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { TONE_CHANNELS, paletteOf, type ChannelPalette } from '../_shared/channels';
import * as twinApi from '@/api/twin/twin';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannelKind } from '@/api/enums';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText } from '@/i18n/DebtText';

const AUTO_SUGGEST_MIN_MSGS = 3;
const AUTO_SUGGEST_SAMPLE_CAP = 12;



/* ------------------------------------------------------------------ *
 *  Atelier — "Voice Studio"
 *  Left rail of channel "stations" with brand colours, centre stage card
 *  for the active channel showing directives, length, constraints, and
 *  parsed examples as speech bubbles. Decorative wave in the header.
 * ------------------------------------------------------------------ */

const CHANNELS = TONE_CHANNELS;

// Atelier-specific extras: ring + glow per palette. Glows are precomputed
// rgba literals so they survive Tailwind's JIT (which can't expand
// dynamic arbitrary-value classes).
const ATELIER_EXTRAS: Record<ChannelPalette, { ring: string; glow: string }> = {
  violet: { ring: 'ring-violet-500/40', glow: 'shadow-[0_0_24px_rgba(167,139,250,0.18)]' },
  indigo: { ring: 'ring-indigo-500/40', glow: 'shadow-[0_0_24px_rgba(129,140,248,0.18)]' },
  cyan: { ring: 'ring-cyan-500/40', glow: 'shadow-[0_0_24px_rgba(34,211,238,0.18)]' },
  amber: { ring: 'ring-amber-500/40', glow: 'shadow-[0_0_24px_rgba(251,191,36,0.18)]' },
  sky: { ring: 'ring-sky-500/40', glow: 'shadow-[0_0_24px_rgba(56,189,248,0.18)]' },
  emerald: { ring: 'ring-emerald-500/40', glow: 'shadow-[0_0_24px_rgba(52,211,153,0.18)]' },
  green: { ring: 'ring-green-500/40', glow: 'shadow-[0_0_24px_rgba(74,222,128,0.18)]' },
  rose: { ring: 'ring-rose-500/40', glow: 'shadow-[0_0_24px_rgba(244,114,182,0.18)]' },
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
  } catch (err) { silentCatch("features/plugins/twin/sub_tone/ToneAtelier:catch1")(err); }
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
}
function parseConstraints(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 8);
  } catch (err) { silentCatch("features/plugins/twin/sub_tone/ToneAtelier:catch2")(err); }
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

export default function ToneAtelier() {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  const twinCommunications = useSystemStore((s) => s.twinCommunications);
  const fetchTwinCommunications = useSystemStore((s) => s.fetchTwinCommunications);
  const isLoading = useSystemStore((s) => s.twinTonesLoading);
  const fetchTwinTones = useSystemStore((s) => s.fetchTwinTones);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const deleteTwinTone = useSystemStore((s) => s.deleteTwinTone);
  const addToast = useToastStore((s) => s.addToast);

  const [activeChannel, setActiveChannel] = useState<string>('generic');
  const [forms, setForms] = useState<Record<string, ToneForm>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [autoSuggestingChannel, setAutoSuggestingChannel] = useState<string | null>(null);

  useEffect(() => { if (activeTwinId) fetchTwinTones(activeTwinId); }, [activeTwinId, fetchTwinTones]);
  // Pull a recent slice of communications too — the auto-suggest button needs
  // a per-channel count to know when to offer itself, and the actual generation
  // call reads message bodies. Idempotent against the slice.
  useEffect(() => { if (activeTwinId) void fetchTwinCommunications(activeTwinId, undefined, 100); }, [activeTwinId, fetchTwinCommunications]);
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

  // Per-channel comm count for the active twin — drives the auto-suggest
  // banner's visibility and the {count} interpolation in its label.
  const commsByChannel = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!activeTwinId) return map;
    for (const c of twinCommunications) {
      if (c.twin_id !== activeTwinId) continue;
      const list = map.get(c.channel) ?? [];
      // Outbound bodies are the right training signal for tone; the twin's
      // own voice is what we're modeling, not the inbound side.
      if (c.direction === 'out' && c.content.trim().length > 0) {
        list.push(c.content.trim());
        map.set(c.channel, list);
      }
    }
    return map;
  }, [activeTwinId, twinCommunications]);

  // Read recent outbound messages on a channel and ask Claude to draft a
  // starting voice_directives + examples_json. The user reviews + saves —
  // never auto-applied to the database, the form just gets prefilled.
  const handleAutoSuggest = async (ch: string, channelLabel: string) => {
    if (!activeTwin || autoSuggestingChannel) return;
    const samples = (commsByChannel.get(ch) ?? []).slice(-AUTO_SUGGEST_SAMPLE_CAP);
    if (samples.length < AUTO_SUGGEST_MIN_MSGS) {
      addToast(tx(t.tone.autoSuggestNoComms, { channel: channelLabel }), 'error');
      return;
    }
    setAutoSuggestingChannel(ch);
    try {
      const transcript = samples
        .map((s, i) => `${i + 1}. ${s.length > 280 ? s.slice(0, 280) + '…' : s}`)
        .join('\n');
      const prompt = `You are calibrating a "tone profile" for an AI twin named ${activeTwin.name}${activeTwin.role ? ` (${activeTwin.role})` : ''} on the ${channelLabel} channel. Below are ${samples.length} recent outbound messages this twin actually sent on ${channelLabel}. Read them and produce a tone profile that captures HOW this twin speaks here (not the topics).

Output EXACTLY this JSON shape, nothing else, no preamble:
{"voiceDirectives":"<3-5 sentences describing the voice: register, pacing, formality, signature moves, what to avoid>","examples":["<short paraphrased example reply 1>","<short paraphrased example reply 2>","<short paraphrased example reply 3>"]}

Recent ${channelLabel} messages from ${activeTwin.name}:
${transcript}`;
      const raw = await twinApi.generateBio(activeTwin.name, activeTwin.role ?? null, prompt);
      // Be tolerant of the model wrapping in code fences or trailing prose.
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd <= jsonStart) {
        throw new Error('no JSON in response');
      }
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as { voiceDirectives?: unknown; examples?: unknown };
      const voiceDirectives = typeof parsed.voiceDirectives === 'string' ? parsed.voiceDirectives.trim() : '';
      const examples = Array.isArray(parsed.examples)
        ? parsed.examples.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
        : [];
      if (!voiceDirectives) throw new Error('empty voiceDirectives');
      // Merge with existing draft instead of clobbering, so a user who has
      // started typing doesn't lose their work to the suggestion.
      setForm(ch, {
        voiceDirectives: voiceDirectives,
        examplesJson: JSON.stringify(examples, null, 2),
      });
      addToast(t.tone.autoSuggestSuccess, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : t.tone.autoSuggestError, 'error');
    } finally {
      setAutoSuggestingChannel(null);
    }
  };

  const stats = useMemo(() => ({
    configured: twinTones.length,
    withExamples: twinTones.filter((tn) => (tn.examples_json ?? '').trim().length > 0).length,
    withLength: twinTones.filter((tn) => (tn.length_hint ?? '').trim().length > 0).length,
  }), [twinTones]);

  if (!activeTwinId) return <TwinEmptyState icon={Mic} title={t.tone.title} />;

  const active = CHANNELS.find((c) => c.id === activeChannel) ?? CHANNELS[0]!;
  const palette = paletteOf(active);
  const extras = ATELIER_EXTRAS[active.palette];
  const form = getForm(active.id);
  const exists = hasTone(active.id);
  const examples = parseExamples(form.examplesJson);
  const constraints = parseConstraints(form.constraintsJson);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band with sound-wave decoration ──────────────────── */}
      {/* min-w-[80vw] mirrors the ContentHeader / TwinHeaderBand contract. */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10 min-w-[80vw]">
        <div className={`absolute inset-0 bg-gradient-to-r ${palette.tint} opacity-90 transition-colors duration-500`} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/85" />
        {/* Decorative waveform */}
        <svg className="absolute inset-0 w-full h-full opacity-30 pointer-events-none" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0,60 Q 50,30 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60" stroke="currentColor" strokeWidth="1" fill="none" className={palette.text} />
          <path d="M0,60 Q 50,80 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" className={palette.text} />
        </svg>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className={`relative w-11 h-11 rounded-full bg-card/60 border ${extras.ring.replace('ring-', 'border-')} flex items-center justify-center ${extras.glow}`}>
            <Mic className={`w-5 h-5 ${palette.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-[0.22em] ${palette.text} font-medium`}><DebtText k="auto_voice_studio_fee2fee9" /></p>
            <h1 className="typo-heading-lg text-foreground/95">{t.tone.title}</h1>
            <p className="typo-caption text-foreground mt-0.5">{t.tone.subtitle}</p>
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
            <p className="text-[10px] uppercase tracking-[0.2em] text-foreground font-medium mb-2">channels</p>
            {CHANNELS.map((c) => {
              const cPalette = paletteOf(c);
              const has = hasTone(c.id);
              const isActive = c.id === active.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChannel(c.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-card border transition-all ${
                    isActive
                      ? `border-violet-500/30 bg-gradient-to-r ${cPalette.tint}`
                      : 'border-transparent hover:border-primary/15 hover:bg-secondary/30'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center flex-shrink-0`}>
                    <Mic className={`w-3.5 h-3.5 ${cPalette.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="typo-caption font-medium text-foreground">{c.label}</p>
                    <p className="text-[10px] text-foreground">{c.id === 'generic' ? 'default fallback' : has ? 'overrides generic' : 'falls back to generic'}</p>
                  </div>
                  <span className={`w-1.5 h-1.5 rounded-full ${has ? cPalette.dot : 'bg-foreground/15'}`} />
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
                <div className={`relative rounded-card border ${extras.ring.replace('ring-', 'border-')} bg-gradient-to-br ${palette.tint} p-5 ${extras.glow}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center">
                      <Mic className={`w-5 h-5 ${palette.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] uppercase tracking-[0.22em] ${palette.text} font-medium`}><DebtText k="auto_active_stage_d9a23de2" /></p>
                      <h2 className="typo-section-title">{active.label}</h2>
                    </div>
                    {exists ? (
                      <span className={`px-2.5 py-0.5 text-[10px] font-medium rounded-full ${palette.text} bg-card/60 border ${extras.ring.replace('ring-', 'border-')}`}>configured</span>
                    ) : (
                      <span className="px-2.5 py-0.5 text-[10px] font-medium rounded-full text-foreground bg-secondary/40 border border-primary/10">{t.tone.fallsBackToGeneric}</span>
                    )}
                  </div>
                </div>

                {/* Auto-suggest banner — appears only when the active channel
                    is non-generic, has no tone row yet, and has enough sent
                    messages to learn from. Pure UI sugar; the suggestion
                    just prefills the form, the user still saves. */}
                {active.id !== 'generic' && !exists && (() => {
                  const msgCount = commsByChannel.get(active.id)?.length ?? 0;
                  const eligible = msgCount >= AUTO_SUGGEST_MIN_MSGS;
                  const isThis = autoSuggestingChannel === active.id;
                  return (
                    <div className={`rounded-card border border-violet-500/20 bg-gradient-to-r from-violet-500/8 via-card/40 to-violet-500/4 p-3.5 flex items-center gap-3`}>
                      <div className="w-9 h-9 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center flex-shrink-0">
                        <Wand2 className="w-4 h-4 text-violet-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="typo-caption font-medium text-foreground/90">
                          {eligible
                            ? tx(t.tone.autoSuggestCta, { count: msgCount, channel: active.label })
                            : tx(t.tone.autoSuggestNoComms, { channel: active.label })}
                        </p>
                        <p className="text-[10px] text-foreground mt-0.5">{t.tone.autoSuggestTooltip}</p>
                      </div>
                      <Button
                        onClick={() => void handleAutoSuggest(active.id, active.label)}
                        disabled={!eligible || isThis || autoSuggestingChannel !== null}
                        size="sm"
                        variant="accent"
                        accentColor="violet"
                      >
                        {isThis
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{t.tone.autoSuggestGenerating}</>
                          : <><Wand2 className="w-3.5 h-3.5 mr-1.5" />{t.tone.autoSuggestButton}</>}
                      </Button>
                    </div>
                  );
                })()}

                {/* Voice directives — hero card */}
                <Section icon={Sparkles} label={t.tone.voiceDirectives} accent={palette.text}>
                  <textarea
                    rows={5}
                    placeholder={t.tone.voiceDirectivesPlaceholder.replace('{channel}', active.label)}
                    value={form.voiceDirectives}
                    onChange={(e) => setForm(active.id, { voiceDirectives: e.target.value })}
                    className={`${INPUT_FIELD} resize-y leading-relaxed`}
                  />
                </Section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Section icon={Ruler} label={t.tone.lengthHint} accent={palette.text}>
                    <input type="text" placeholder={t.tone.lengthHintPlaceholder} value={form.lengthHint} onChange={(e) => setForm(active.id, { lengthHint: e.target.value })} className={INPUT_FIELD} />
                  </Section>
                  <Section icon={ListChecks} label={t.tone.constraints} accent={palette.text}>
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
                <Section icon={Quote} label={t.tone.exampleMessages} accent={palette.text}>
                  <textarea
                    rows={3}
                    placeholder={t.tone.exampleMessagesPlaceholder}
                    value={form.examplesJson}
                    onChange={(e) => setForm(active.id, { examplesJson: e.target.value })}
                    className={`${INPUT_FIELD} font-mono resize-y`}
                  />
                  {examples.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-foreground font-medium">preview</p>
                      <div className="space-y-2">
                        {examples.map((ex, i) => (
                          <div key={i} className="flex items-end gap-2">
                            <div className="w-6 h-6 rounded-full bg-card/60 border border-primary/10 flex items-center justify-center flex-shrink-0">
                              <MessageCircle className={`w-3 h-3 ${palette.text}`} />
                            </div>
                            <div className={`max-w-[80%] px-3 py-2 rounded-card rounded-bl-interactive bg-gradient-to-br ${palette.tint} border border-primary/10`}>
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
                    <button onClick={() => handleDelete(active.id)} className="flex items-center gap-1.5 typo-caption text-foreground hover:text-red-400 transition-colors">
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
        <span className="typo-caption font-medium text-foreground">{label}</span>
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
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{label}</span>
    </div>
  );
}
