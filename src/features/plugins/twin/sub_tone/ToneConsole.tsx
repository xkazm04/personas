import { Fragment, useEffect, useMemo, useState } from 'react';
import { Mic, Plus, Trash2, Save, Sparkles, Ruler, ListChecks, Quote, Terminal, ChevronDown } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannelKind } from '@/api/enums';

/* ------------------------------------------------------------------ *
 *  Console — "Tone Matrix"
 *  Dense table — row per channel, columns: directives, length,
 *  constraints, examples, status. Inline edit via click-to-expand.
 * ------------------------------------------------------------------ */

const CHANNELS = [
  { id: 'generic', label: 'Generic', dot: 'bg-violet-400', tag: 'text-violet-300' },
  { id: 'discord', label: 'Discord', dot: 'bg-indigo-400', tag: 'text-indigo-300' },
  { id: 'slack', label: 'Slack', dot: 'bg-cyan-400', tag: 'text-cyan-300' },
  { id: 'email', label: 'Email', dot: 'bg-amber-400', tag: 'text-amber-300' },
  { id: 'sms', label: 'SMS', dot: 'bg-emerald-400', tag: 'text-emerald-300' },
  { id: 'voice', label: 'Voice', dot: 'bg-rose-400', tag: 'text-rose-300' },
] as const;

interface ToneForm { voiceDirectives: string; examplesJson: string; constraintsJson: string; lengthHint: string; }
const EMPTY: ToneForm = { voiceDirectives: '', examplesJson: '', constraintsJson: '', lengthHint: '' };
function toneToForm(tn: TwinTone): ToneForm {
  return { voiceDirectives: tn.voice_directives, examplesJson: tn.examples_json ?? '', constraintsJson: tn.constraints_json ?? '', lengthHint: tn.length_hint ?? '' };
}
function exampleCount(raw: string): number {
  if (!raw.trim()) return 0;
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.length;
  } catch { /* fall through */ }
  return raw.split('\n').filter((s) => s.trim()).length;
}

export default function ToneConsole() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  const isLoading = useSystemStore((s) => s.twinTonesLoading);
  const fetchTwinTones = useSystemStore((s) => s.fetchTwinTones);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const deleteTwinTone = useSystemStore((s) => s.deleteTwinTone);

  const [forms, setForms] = useState<Record<string, ToneForm>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>('generic');
  const [filterConfigured, setFilterConfigured] = useState(false);

  useEffect(() => { if (activeTwinId) fetchTwinTones(activeTwinId); }, [activeTwinId, fetchTwinTones]);
  useEffect(() => {
    const next: Record<string, ToneForm> = {};
    for (const tn of twinTones) next[tn.channel] = toneToForm(tn);
    setForms(next);
  }, [twinTones]);

  const getForm = (ch: string): ToneForm => forms[ch] ?? EMPTY;
  const setForm = (ch: string, partial: Partial<ToneForm>) => setForms((prev) => ({ ...prev, [ch]: { ...(prev[ch] ?? EMPTY), ...partial } }));
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

  const visible = filterConfigured ? CHANNELS.filter((c) => hasTone(c.id)) : CHANNELS;

  const stats = useMemo(() => ({
    configured: twinTones.length,
    withExamples: twinTones.filter((tn) => (tn.examples_json ?? '').trim().length > 0).length,
    withConstraints: twinTones.filter((tn) => (tn.constraints_json ?? '').trim().length > 0).length,
    withLength: twinTones.filter((tn) => (tn.length_hint ?? '').trim().length > 0).length,
  }), [twinTones]);

  if (!activeTwinId) return <TwinEmptyState icon={Mic} title={t.tone.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">tone / matrix</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.tone.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2 mr-2">
          <Tile label="configured" value={`${stats.configured}/${CHANNELS.length}`} />
          <Tile label="examples" value={stats.withExamples} accent={stats.withExamples > 0 ? 'emerald' : 'violet'} />
          <Tile label="length" value={stats.withLength} />
          <Tile label="rules" value={stats.withConstraints} />
        </div>
        <button
          onClick={() => setFilterConfigured(!filterConfigured)}
          className={`px-2.5 py-1 text-xs font-medium rounded-interactive border transition-colors ${
            filterConfigured ? 'bg-violet-500/15 text-violet-200 border-violet-500/30' : 'text-foreground/65 border-primary/15 hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          {filterConfigured ? 'show all' : 'configured only'}
        </button>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[2] bg-background/95 backdrop-blur">
            <tr className="border-b border-primary/15 text-foreground/55">
              <th className="text-left font-medium px-3 py-2 pl-4 md:pl-6 xl:pl-8 w-44">
                <span className="text-[10px] uppercase tracking-[0.16em]">channel</span>
              </th>
              <th className="text-left font-medium px-3 py-2">
                <div className="flex items-center gap-1.5"><Sparkles className="w-3 h-3" /><span className="text-[10px] uppercase tracking-[0.16em]">{t.tone.voiceDirectives}</span></div>
              </th>
              <th className="text-left font-medium px-3 py-2 w-36 hidden md:table-cell">
                <div className="flex items-center gap-1.5"><Ruler className="w-3 h-3" /><span className="text-[10px] uppercase tracking-[0.16em]">{t.tone.lengthHint}</span></div>
              </th>
              <th className="text-left font-medium px-3 py-2 w-36 hidden lg:table-cell">
                <div className="flex items-center gap-1.5"><ListChecks className="w-3 h-3" /><span className="text-[10px] uppercase tracking-[0.16em]">{t.tone.constraints}</span></div>
              </th>
              <th className="text-center font-medium px-3 py-2 w-20 hidden md:table-cell">
                <div className="flex items-center justify-center gap-1.5"><Quote className="w-3 h-3" /><span className="text-[10px] uppercase tracking-[0.16em]">ex.</span></div>
              </th>
              <th className="text-right font-medium px-3 py-2 pr-4 md:pr-6 xl:pr-8 w-32">
                <span className="text-[10px] uppercase tracking-[0.16em]">status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center typo-body text-foreground/65">{t.tone.loading}</td></tr>
            )}
            {!isLoading && visible.map((c) => {
              const form = getForm(c.id);
              const exists = hasTone(c.id);
              const isExpanded = expanded === c.id;
              const isSaving = savingChannel === c.id;
              const exCount = exampleCount(form.examplesJson);

              return (
                <Fragment key={c.id}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : c.id)}
                    className={`group cursor-pointer border-b border-primary/5 transition-colors ${
                      isExpanded ? 'bg-violet-500/5' : 'hover:bg-secondary/20'
                    }`}
                  >
                    <td className="pl-4 md:pl-6 xl:pl-8 pr-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ChevronDown className={`w-3.5 h-3.5 text-foreground/55 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        <span className={`w-2 h-2 rounded-full ${exists ? c.dot : 'bg-foreground/20'}`} />
                        <span className="typo-card-label">{c.label}</span>
                        {c.id === 'generic' && <span className="text-[9px] uppercase tracking-wider text-foreground/45">default</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs ${form.voiceDirectives.trim() ? 'text-foreground/85' : 'text-foreground/35 italic'} line-clamp-1`}>
                        {form.voiceDirectives.trim() || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className={`text-xs ${form.lengthHint.trim() ? 'text-foreground/85' : 'text-foreground/35 italic'} truncate`}>
                        {form.lengthHint.trim() || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className={`text-xs ${form.constraintsJson.trim() ? 'text-foreground/85 font-mono' : 'text-foreground/35 italic'} truncate`}>
                        {form.constraintsJson.trim() || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center hidden md:table-cell">
                      <span className={`tabular-nums text-xs ${exCount > 0 ? 'text-foreground' : 'text-foreground/35'}`}>{exCount || '—'}</span>
                    </td>
                    <td className="pr-4 md:pr-6 xl:pr-8 pl-3 py-2.5 text-right">
                      {exists ? (
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 ${c.tag} border border-violet-500/25`}>configured</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-secondary/40 text-foreground/55">{c.id === 'generic' ? '—' : 'fallback'}</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-secondary/[0.05] border-b border-primary/5">
                      <td colSpan={6} className="px-4 md:px-6 xl:px-8 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                          <FieldCell span={12} label={t.tone.voiceDirectives} required>
                            <textarea
                              rows={3}
                              placeholder={t.tone.voiceDirectivesPlaceholder.replace('{channel}', c.label)}
                              value={form.voiceDirectives}
                              onChange={(e) => setForm(c.id, { voiceDirectives: e.target.value })}
                              className={`${INPUT_FIELD} resize-y`}
                            />
                          </FieldCell>
                          <FieldCell span={6} label={t.tone.lengthHint}>
                            <input type="text" placeholder={t.tone.lengthHintPlaceholder} value={form.lengthHint} onChange={(e) => setForm(c.id, { lengthHint: e.target.value })} className={INPUT_FIELD} />
                          </FieldCell>
                          <FieldCell span={6} label={t.tone.constraints}>
                            <input type="text" placeholder={t.tone.constraintsPlaceholder} value={form.constraintsJson} onChange={(e) => setForm(c.id, { constraintsJson: e.target.value })} className={`${INPUT_FIELD} font-mono`} />
                          </FieldCell>
                          <FieldCell span={12} label={`${t.tone.exampleMessages} ${exCount > 0 ? `(${exCount})` : ''}`}>
                            <textarea
                              rows={3}
                              placeholder={t.tone.exampleMessagesPlaceholder}
                              value={form.examplesJson}
                              onChange={(e) => setForm(c.id, { examplesJson: e.target.value })}
                              className={`${INPUT_FIELD} font-mono resize-y`}
                            />
                          </FieldCell>
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-primary/5 mt-3">
                          {exists && c.id !== 'generic' ? (
                            <button onClick={() => handleDelete(c.id)} className="flex items-center gap-1.5 text-xs text-foreground/65 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />{t.tone.removeOverride}
                            </button>
                          ) : <span />}
                          <Button onClick={() => handleSave(c.id)} disabled={isSaving || !form.voiceDirectives.trim()} size="sm" variant="accent" accentColor="violet">
                            {exists ? <><Save className="w-4 h-4 mr-1.5" />{isSaving ? t.tone.saving : t.tone.save}</> : <><Plus className="w-4 h-4 mr-1.5" />{isSaving ? t.tone.creating : t.tone.create}</>}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!isLoading && visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center typo-caption text-foreground/55">no configured channels — click <span className="text-violet-300">show all</span> to add overrides</td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 md:px-6 xl:px-8 py-3 border-t border-primary/10 flex items-center gap-3 text-[11px] text-foreground/55">
          <span className="font-medium uppercase tracking-[0.16em] text-[10px]">tip</span>
          <span>click any row to inline edit · generic is the fallback for unset channels</span>
        </div>
      </div>
    </div>
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

const SPAN: Record<number, string> = { 6: 'md:col-span-6', 12: 'md:col-span-12' };
function FieldCell({ span, label, required, children }: { span: 6 | 12; label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1 ${SPAN[span] ?? SPAN[12]}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/65 font-medium">{label}</span>
        {required && <span className="text-[10px] text-amber-300">*</span>}
      </div>
      {children}
    </label>
  );
}
