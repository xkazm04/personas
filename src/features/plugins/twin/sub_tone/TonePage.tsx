import { useEffect, useState } from 'react';
import { Mic, Plus, Trash2, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { CoachMark } from '../CoachMark';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannelKind } from '@/api/enums';

/**
 * Tone tab — per-channel voice directive editor.
 *
 * Each channel card (generic, discord, slack, email, sms, voice) holds:
 * - voice_directives: free-text prompt fragment
 * - examples: JSON array of reference messages
 * - constraints: JSON array of do/don't rules
 * - length_hint: reply-length guidance
 *
 * The "generic" channel is the default fallback. When a persona calls
 * `get_tone("discord")` and there's no discord row, the backend returns
 * the generic tone instead.
 */

const WELL_KNOWN_CHANNELS = [
  { id: 'generic', label: 'Generic (default)', color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { id: 'discord', label: 'Discord', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  { id: 'slack', label: 'Slack', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  { id: 'email', label: 'Email', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  { id: 'sms', label: 'SMS', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { id: 'voice', label: 'Voice', color: 'text-rose-400', bg: 'bg-rose-500/10' },
] as const;

interface ToneForm {
  voiceDirectives: string;
  examplesJson: string;
  constraintsJson: string;
  lengthHint: string;
}

const EMPTY_FORM: ToneForm = { voiceDirectives: '', examplesJson: '', constraintsJson: '', lengthHint: '' };

function toneToForm(tone: TwinTone): ToneForm {
  return {
    voiceDirectives: tone.voice_directives,
    examplesJson: tone.examples_json ?? '',
    constraintsJson: tone.constraints_json ?? '',
    lengthHint: tone.length_hint ?? '',
  };
}

export default function TonePage() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  const isLoading = useSystemStore((s) => s.twinTonesLoading);
  const fetchTwinTones = useSystemStore((s) => s.fetchTwinTones);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const deleteTwinTone = useSystemStore((s) => s.deleteTwinTone);

  const [expandedChannel, setExpandedChannel] = useState<string | null>('generic');
  const [forms, setForms] = useState<Record<string, ToneForm>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  // Fetch tones when active twin changes
  useEffect(() => {
    if (activeTwinId) fetchTwinTones(activeTwinId);
  }, [activeTwinId, fetchTwinTones]);

  // Sync forms from loaded tones
  useEffect(() => {
    const next: Record<string, ToneForm> = {};
    for (const t of twinTones) next[t.channel] = toneToForm(t);
    setForms(next);
  }, [twinTones]);

  const getForm = (channel: string): ToneForm => forms[channel] ?? EMPTY_FORM;
  const setForm = (channel: string, partial: Partial<ToneForm>) => {
    setForms((prev) => ({
      ...prev,
      [channel]: { ...(prev[channel] ?? EMPTY_FORM), ...partial },
    }));
  };

  const handleSave = async (channel: string) => {
    if (!activeTwinId) return;
    const f = getForm(channel);
    setSavingChannel(channel);
    try {
      await upsertTwinTone(
        activeTwinId,
        // Channel strings here originate from the tone-page's fixed channel
        // list (see `t.tone.channels`), which the Rust handler keeps in sync
        // with TwinChannelKind. Cast is safe as long as that registry stays
        // aligned — the runtime also validates it.
        channel as TwinChannelKind,
        f.voiceDirectives,
        f.examplesJson.trim() || null,
        f.constraintsJson.trim() || null,
        f.lengthHint.trim() || null,
      );
    } finally {
      setSavingChannel(null);
    }
  };

  const handleDelete = async (channel: string) => {
    const tone = twinTones.find((tn) => tn.channel === channel);
    if (!tone) return;
    if (!confirm(t.tone.removeConfirm.replace('{channel}', channel))) return;
    await deleteTwinTone(tone.id);
    setForms((prev) => {
      const { [channel]: _, ...rest } = prev;
      return rest;
    });
  };

  const hasTone = (channel: string) => twinTones.some((tn) => tn.channel === channel);

  const toggle = (ch: string) => setExpandedChannel(expandedChannel === ch ? null : ch);

  if (!activeTwinId) {
    return <TwinEmptyState icon={Mic} title={t.tone.title} />;
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Mic className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.tone.title}
        subtitle={t.tone.subtitle}
      />

      <ContentBody centered>
        {isLoading ? (
          <p className="typo-body text-foreground text-center py-12">{t.tone.loading}</p>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3 pb-8">
            <CoachMark id="tone" title={t.coach.toneTitle} body={t.coach.toneBody} />
            {WELL_KNOWN_CHANNELS.map(({ id: channel, label, color, bg }) => {
              const isExpanded = expandedChannel === channel;
              const exists = hasTone(channel);
              const form = getForm(channel);
              const isSaving = savingChannel === channel;

              return (
                <div
                  key={channel}
                  className={`rounded-card border transition-colors ${
                    exists
                      ? 'border-violet-500/20 bg-card/60'
                      : 'border-primary/10 bg-card/30'
                  }`}
                >
                  {/* Header */}
                  <button
                    onClick={() => toggle(channel)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-foreground flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-foreground flex-shrink-0" />}
                    <div className={`w-7 h-7 rounded-interactive ${bg} flex items-center justify-center flex-shrink-0`}>
                      <Mic className={`w-3.5 h-3.5 ${color}`} />
                    </div>
                    <span className="typo-card-label flex-1">{label}</span>
                    {exists && (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">
                        {t.tone.configured}
                      </span>
                    )}
                    {!exists && channel !== 'generic' && (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-secondary/40 text-foreground">
                        {t.tone.fallsBackToGeneric}
                      </span>
                    )}
                  </button>

                  {/* Expanded form */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4 border-t border-primary/5 pt-4">
                      <label className="space-y-1.5 block">
                        <span className="typo-caption text-foreground font-medium">{t.tone.voiceDirectives}</span>
                        <textarea
                          rows={4}
                          placeholder={t.tone.voiceDirectivesPlaceholder.replace('{channel}', label)}
                          value={form.voiceDirectives}
                          onChange={(e) => setForm(channel, { voiceDirectives: e.target.value })}
                          className={`${INPUT_FIELD} resize-y`}
                        />
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="space-y-1.5">
                          <span className="typo-caption text-foreground font-medium">{t.tone.lengthHint}</span>
                          <input
                            type="text"
                            placeholder={t.tone.lengthHintPlaceholder}
                            value={form.lengthHint}
                            onChange={(e) => setForm(channel, { lengthHint: e.target.value })}
                            className={INPUT_FIELD}
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="typo-caption text-foreground font-medium">{t.tone.constraints}</span>
                          <input
                            type="text"
                            placeholder={t.tone.constraintsPlaceholder}
                            value={form.constraintsJson}
                            onChange={(e) => setForm(channel, { constraintsJson: e.target.value })}
                            className={`${INPUT_FIELD} font-mono`}
                          />
                        </label>
                      </div>

                      <label className="space-y-1.5 block">
                        <span className="typo-caption text-foreground font-medium">{t.tone.exampleMessages}</span>
                        <textarea
                          rows={3}
                          placeholder={t.tone.exampleMessagesPlaceholder}
                          value={form.examplesJson}
                          onChange={(e) => setForm(channel, { examplesJson: e.target.value })}
                          className={`${INPUT_FIELD} font-mono resize-y`}
                        />
                      </label>

                      <div className="flex items-center justify-between pt-1">
                        {exists && channel !== 'generic' ? (
                          <button
                            onClick={() => handleDelete(channel)}
                            aria-label={`${t.tone.removeOverride} — ${label}`}
                            className="flex items-center gap-1.5 text-md text-foreground hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t.tone.removeOverride}
                          </button>
                        ) : (
                          <span />
                        )}
                        <Button
                          onClick={() => handleSave(channel)}
                          disabled={isSaving || !form.voiceDirectives.trim()}
                          size="sm"
                        >
                          {exists ? (
                            <><Save className="w-4 h-4 mr-1.5" />{isSaving ? t.tone.saving : t.tone.save}</>
                          ) : (
                            <><Plus className="w-4 h-4 mr-1.5" />{isSaving ? t.tone.creating : t.tone.create}</>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
