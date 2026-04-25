import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Plus, Trash2, Power, PowerOff, X, User, Mic, Antenna, Key, Wifi } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinChannelKind } from '@/api/enums';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Atelier — "Antenna Grid"
 *  Channel cards as broadcast antennas with brand-coloured signal
 *  bars, tone-binding pill, and credential link. Hero header with
 *  signal-wave decoration.
 * ------------------------------------------------------------------ */

const CHANNEL_TYPES = [
  { id: 'discord', label: 'Discord', tint: 'from-indigo-500/30 to-violet-500/15', stroke: 'indigo', dot: 'bg-indigo-400', text: 'text-indigo-300', serviceType: 'discord' },
  { id: 'slack', label: 'Slack', tint: 'from-cyan-500/30 to-sky-500/15', stroke: 'cyan', dot: 'bg-cyan-400', text: 'text-cyan-300', serviceType: 'slack' },
  { id: 'email', label: 'Email', tint: 'from-amber-500/30 to-orange-500/15', stroke: 'amber', dot: 'bg-amber-400', text: 'text-amber-300', serviceType: 'gmail' },
  { id: 'telegram', label: 'Telegram', tint: 'from-sky-500/30 to-blue-500/15', stroke: 'sky', dot: 'bg-sky-400', text: 'text-sky-300', serviceType: 'telegram' },
  { id: 'sms', label: 'SMS', tint: 'from-emerald-500/30 to-teal-500/15', stroke: 'emerald', dot: 'bg-emerald-400', text: 'text-emerald-300', serviceType: 'twilio-sms' },
  { id: 'teams', label: 'Teams', tint: 'from-violet-500/30 to-fuchsia-500/15', stroke: 'violet', dot: 'bg-violet-400', text: 'text-violet-300', serviceType: 'microsoft-teams' },
  { id: 'whatsapp', label: 'WhatsApp', tint: 'from-green-500/30 to-emerald-500/15', stroke: 'green', dot: 'bg-green-400', text: 'text-green-300', serviceType: 'whatsapp' },
] as const;

function getChannelMeta(type: string) {
  return CHANNEL_TYPES.find((c) => c.id === type) ?? { id: type, label: type, tint: 'from-violet-500/15 to-fuchsia-500/10', stroke: 'violet', dot: 'bg-foreground/20', text: 'text-foreground/65', serviceType: type };
}

const channelOptions: ThemedSelectOption[] = CHANNEL_TYPES.map((ct) => ({ value: ct.id, label: ct.label }));

export default function ChannelsAtelier() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const channels = useSystemStore((s) => s.twinChannels);
  const tones = useSystemStore((s) => s.twinTones);
  const isLoading = useSystemStore((s) => s.twinChannelsLoading);
  const fetchChannels = useSystemStore((s) => s.fetchTwinChannels);
  const createChannel = useSystemStore((s) => s.createTwinChannel);
  const updateChannel = useSystemStore((s) => s.updateTwinChannel);
  const deleteChannel = useSystemStore((s) => s.deleteTwinChannel);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<TwinChannelKind>('discord');
  const [newCredId, setNewCredId] = useState('');
  const [newPersonaId, setNewPersonaId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { if (activeTwinId) fetchChannels(activeTwinId); }, [activeTwinId, fetchChannels]);
  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const channelDef = CHANNEL_TYPES.find((c) => c.id === newType);
  const filteredCredentials = useMemo(() => {
    if (!channelDef) return [];
    return credentials.filter((c) => c.service_type.toLowerCase().includes(channelDef.serviceType.toLowerCase()));
  }, [credentials, channelDef]);
  useEffect(() => {
    if (filteredCredentials.length === 1) setNewCredId(filteredCredentials[0]?.id ?? '');
    else if (!filteredCredentials.find((c) => c.id === newCredId)) setNewCredId('');
  }, [filteredCredentials, newCredId]);

  const credentialOptions: ThemedSelectOption[] = filteredCredentials.map((c) => ({ value: c.id, label: c.name, description: c.service_type }));

  const resetForm = () => { setAdding(false); setNewCredId(''); setNewPersonaId(''); setNewLabel(''); setFormError(null); };
  const handleCreate = async () => {
    if (!activeTwinId || !newCredId.trim()) return;
    setSubmitting(true); setFormError(null);
    try { await createChannel(activeTwinId, newType, newCredId.trim(), newPersonaId.trim() || undefined, newLabel.trim() || undefined); resetForm(); }
    catch (err: unknown) { setFormError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to create channel'); }
    finally { setSubmitting(false); }
  };
  const handleToggle = async (ch: TwinChannel) => { try { await updateChannel(ch.id, { isActive: !ch.is_active }); } catch { /* noop */ } };
  const handleDelete = async (ch: TwinChannel) => {
    const label = ch.label ?? `${ch.channel_type} channel`;
    if (!confirm(t.channels.removeConfirm.replace('{label}', label))) return;
    try { await deleteChannel(ch.id); } catch { /* noop */ }
  };

  const stats = useMemo(() => {
    const active = channels.filter((c) => c.is_active).length;
    const paused = channels.length - active;
    const types = new Set(channels.map((c) => c.channel_type));
    const missingTone = channels
      .filter((ch) => ch.is_active)
      .map((ch) => ch.channel_type)
      .filter((type, idx, arr) => arr.indexOf(type) === idx)
      .filter((type) => !tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === type)).length;
    return { active, paused, types: types.size, missingTone };
  }, [channels, tones, activeTwinId]);

  if (!activeTwinId) return <TwinEmptyState icon={Radio} title={t.channels.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band — broadcast waves ────────────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/15 via-cyan-500/8 to-emerald-500/8" />
        <svg className="absolute inset-0 w-full h-full opacity-25 pointer-events-none" viewBox="0 0 800 200" preserveAspectRatio="xMaxYMid slice">
          {[80, 60, 40, 20].map((r, i) => (
            <path
              key={i}
              d={`M 740,100 m -${r},0 a ${r},${r} 0 1,0 ${r * 2},0`}
              stroke="#a78bfa"
              strokeWidth="0.7"
              fill="none"
              opacity={0.4 - i * 0.07}
            />
          ))}
          <circle cx="740" cy="100" r="3" fill="#a78bfa" />
        </svg>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="relative w-12 h-12 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
            <Antenna className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">Antenna Grid</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.channels.title}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.channels.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="active" value={stats.active} accent="emerald" />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="paused" value={stats.paused} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="surfaces" value={stats.types} />
            {stats.missingTone > 0 && (<><span className="w-px h-6 bg-primary/15" /><Stat label="no tone" value={stats.missingTone} accent="amber" /></>)}
          </div>
          {!adding && (
            <Button onClick={() => setAdding(true)} size="sm" variant="accent" accentColor="violet">
              <Plus className="w-4 h-4 mr-1.5" />{t.channels.addChannel}
            </Button>
          )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 xl:px-8 py-6 space-y-4">
          <AnimatePresence>
            {adding && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-card border border-violet-500/30 bg-gradient-to-br from-violet-500/8 to-fuchsia-500/5 p-5 shadow-elevation-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-violet-300" />
                      <h3 className="typo-section-title">{t.channels.addChannel}</h3>
                    </div>
                    <button onClick={resetForm} className="text-foreground/65 hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FieldGroup label={t.channels.channelType}>
                      <ThemedSelect filterable options={channelOptions} value={newType} onValueChange={(v) => setNewType(v as TwinChannelKind)} placeholder={t.channels.selectChannel} />
                    </FieldGroup>
                    <FieldGroup label={t.channels.label}>
                      <input type="text" placeholder={t.channels.labelPlaceholder} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className={INPUT_FIELD} />
                    </FieldGroup>
                    <FieldGroup label={`${t.channels.credential}${filteredCredentials.length === 0 ? ` (${t.channels.credentialNoneFound})` : ''}`} warn={filteredCredentials.length === 0}>
                      {filteredCredentials.length > 0 ? (
                        <ThemedSelect filterable options={credentialOptions} value={newCredId} onValueChange={setNewCredId} placeholder={t.channels.credentialPlaceholder} />
                      ) : (
                        <input type="text" placeholder={t.channels.noCredentialsForChannel} disabled className={`${INPUT_FIELD} opacity-50`} />
                      )}
                    </FieldGroup>
                    <FieldGroup label={t.channels.personaIdOptional}>
                      <input type="text" placeholder={t.channels.personaIdPlaceholder} value={newPersonaId} onChange={(e) => setNewPersonaId(e.target.value)} className={`${INPUT_FIELD} font-mono`} />
                    </FieldGroup>
                  </div>
                  {formError && <p className="typo-caption text-red-400 mt-3">{formError}</p>}
                  <div className="flex justify-end gap-2 mt-4">
                    <Button onClick={resetForm} variant="ghost" size="sm">{t.channels.cancelBtn}</Button>
                    <Button onClick={handleCreate} disabled={!newCredId.trim() || submitting} size="sm" variant="accent" accentColor="violet">{submitting ? t.channels.adding : t.channels.addChannel}</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Channel list */}
          {isLoading && channels.length === 0 ? (
            <p className="typo-body text-foreground/65 text-center py-12">{t.channels.loading}</p>
          ) : channels.length === 0 && !adding ? (
            <div className="py-16 text-center max-w-md mx-auto">
              <div className="relative w-20 h-20 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                <div className="absolute inset-3 rounded-full border-2 border-violet-500/30" />
                <div className="absolute inset-6 rounded-full bg-violet-500/15 border border-violet-500/40 flex items-center justify-center">
                  <Antenna className="w-6 h-6 text-violet-300" />
                </div>
              </div>
              <p className="typo-body text-foreground font-medium">{t.channels.noChannelsConfigured}</p>
              <p className="typo-caption text-foreground/65 mt-1">{t.channels.noChannelsHint}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {channels.map((ch) => {
                const meta = getChannelMeta(ch.channel_type);
                const cred = credentials.find((c) => c.id === ch.credential_id);
                const hasTone = tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === ch.channel_type);
                const signalLevels = ch.is_active ? (hasTone ? 4 : 3) : 1;
                return (
                  <motion.div
                    key={ch.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`relative rounded-card border overflow-hidden transition-all ${
                      ch.is_active
                        ? `border-primary/15 bg-gradient-to-br ${meta.tint} shadow-elevation-1`
                        : 'border-primary/10 bg-card/30 opacity-70'
                    }`}
                  >
                    {/* Top antenna strip */}
                    <div className="absolute top-0 left-0 right-0 h-0.5 flex">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={`flex-1 transition-colors ${i < signalLevels ? meta.dot : 'bg-foreground/10'}`} />
                      ))}
                    </div>

                    <div className="p-4 pt-5">
                      <div className="flex items-start gap-3">
                        <div className="relative w-10 h-10 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center flex-shrink-0">
                          <Radio className={`w-5 h-5 ${meta.text}`} />
                          {ch.is_active && (
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${meta.dot} border-2 border-card`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="typo-card-label truncate">{ch.label ?? meta.label}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-card/60 ${meta.text} uppercase tracking-wider`}>{meta.label}</span>
                            {!ch.is_active && <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-secondary/40 text-foreground/55 uppercase tracking-wider">{t.channels.paused}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button onClick={() => handleToggle(ch)} title={ch.is_active ? t.channels.pause : t.channels.activate} className="p-1.5 rounded-interactive text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors">
                            {ch.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleDelete(ch)} title={t.channels.remove} className="p-1.5 rounded-interactive text-foreground/65 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <dl className="mt-3 pt-3 border-t border-primary/10 space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <Key className="w-3 h-3 text-foreground/55 flex-shrink-0" />
                          <dt className="text-[10px] uppercase tracking-wider text-foreground/55">cred</dt>
                          <dd className="ml-auto truncate text-foreground/85 max-w-[160px]">{cred ? cred.name : <span className="font-mono text-foreground/55">{ch.credential_id.slice(0, 8)}…</span>}</dd>
                        </div>
                        <div className="flex items-center gap-2">
                          <Mic className="w-3 h-3 text-foreground/55 flex-shrink-0" />
                          <dt className="text-[10px] uppercase tracking-wider text-foreground/55">tone</dt>
                          <dd className="ml-auto">
                            {hasTone ? (
                              <span className="text-emerald-300 text-xs">configured</span>
                            ) : (
                              <button onClick={() => setTwinTab('tone')} className="text-amber-300 text-xs hover:text-amber-200 transition-colors">add override →</button>
                            )}
                          </dd>
                        </div>
                        {ch.persona_id && (
                          <div className="flex items-center gap-2">
                            <User className="w-3 h-3 text-foreground/55 flex-shrink-0" />
                            <dt className="text-[10px] uppercase tracking-wider text-foreground/55">persona</dt>
                            <dd className="ml-auto font-mono text-[10px] text-foreground/65">{ch.persona_id.slice(0, 12)}…</dd>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Wifi className="w-3 h-3 text-foreground/55 flex-shrink-0" />
                          <dt className="text-[10px] uppercase tracking-wider text-foreground/55">signal</dt>
                          <dd className="ml-auto flex items-center gap-0.5">
                            {[0, 1, 2, 3].map((i) => (
                              <span key={i} className={`w-0.5 rounded-full ${i < signalLevels ? meta.dot : 'bg-foreground/15'}`} style={{ height: 4 + i * 2 }} />
                            ))}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className={`text-[10px] uppercase tracking-[0.16em] font-medium ${warn ? 'text-amber-300' : 'text-foreground/65'}`}>{label}</span>
      {children}
    </div>
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
