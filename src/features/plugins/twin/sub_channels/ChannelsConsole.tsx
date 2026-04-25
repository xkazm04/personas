import { useEffect, useState, useMemo } from 'react';
import { Radio, Plus, Trash2, Power, PowerOff, X, Mic, Terminal } from 'lucide-react';
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
 *  Console — "Deployment Matrix"
 *  Dense table — channel, label, credential, tone-bound, persona,
 *  status, actions. Quick filters and inline add row.
 * ------------------------------------------------------------------ */

const CHANNEL_TYPES = [
  { id: 'discord', label: 'Discord', dot: 'bg-indigo-400', text: 'text-indigo-300', serviceType: 'discord' },
  { id: 'slack', label: 'Slack', dot: 'bg-cyan-400', text: 'text-cyan-300', serviceType: 'slack' },
  { id: 'email', label: 'Email', dot: 'bg-amber-400', text: 'text-amber-300', serviceType: 'gmail' },
  { id: 'telegram', label: 'Telegram', dot: 'bg-sky-400', text: 'text-sky-300', serviceType: 'telegram' },
  { id: 'sms', label: 'SMS', dot: 'bg-emerald-400', text: 'text-emerald-300', serviceType: 'twilio-sms' },
  { id: 'teams', label: 'Teams', dot: 'bg-violet-400', text: 'text-violet-300', serviceType: 'microsoft-teams' },
  { id: 'whatsapp', label: 'WhatsApp', dot: 'bg-green-400', text: 'text-green-300', serviceType: 'whatsapp' },
] as const;

function getChannelMeta(type: string) {
  return CHANNEL_TYPES.find((c) => c.id === type) ?? { id: type, label: type, dot: 'bg-foreground/20', text: 'text-foreground/65', serviceType: type };
}

const channelOptions: ThemedSelectOption[] = CHANNEL_TYPES.map((ct) => ({ value: ct.id, label: ct.label }));

type StatusFilter = 'all' | 'active' | 'paused' | 'no-tone';

export default function ChannelsConsole() {
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
  const [filter, setFilter] = useState<StatusFilter>('all');

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
    const noTone = channels.filter((ch) => ch.is_active && !tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === ch.channel_type)).length;
    return { active, paused, types: types.size, noTone, total: channels.length };
  }, [channels, tones, activeTwinId]);

  const visible = useMemo(() => {
    return channels.filter((ch) => {
      if (filter === 'active') return ch.is_active;
      if (filter === 'paused') return !ch.is_active;
      if (filter === 'no-tone') return ch.is_active && !tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === ch.channel_type);
      return true;
    });
  }, [channels, tones, activeTwinId, filter]);

  if (!activeTwinId) return <TwinEmptyState icon={Radio} title={t.channels.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">channels / matrix</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.channels.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2 mr-2">
          <Tile label="total" value={stats.total} />
          <Tile label="active" value={stats.active} accent="emerald" />
          <Tile label="paused" value={stats.paused} />
          {stats.noTone > 0 && <Tile label="no tone" value={stats.noTone} accent="amber" />}
        </div>
        <Button onClick={() => setAdding(!adding)} size="sm" variant={adding ? 'ghost' : 'accent'} accentColor="violet">
          {adding ? <><X className="w-4 h-4 mr-1.5" />cancel</> : <><Plus className="w-4 h-4 mr-1.5" />{t.channels.addChannel}</>}
        </Button>
      </div>

      {/* ── Add row (collapsible) ─────────────────────────────────── */}
      {adding && (
        <div className="flex-shrink-0 border-b border-primary/10 bg-violet-500/5 px-4 md:px-6 xl:px-8 py-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-2 space-y-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/65 font-medium">{t.channels.channelType}</span>
              <ThemedSelect filterable options={channelOptions} value={newType} onValueChange={(v) => setNewType(v as TwinChannelKind)} placeholder={t.channels.selectChannel} />
            </div>
            <div className="md:col-span-3 space-y-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/65 font-medium">{t.channels.label}</span>
              <input type="text" placeholder={t.channels.labelPlaceholder} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className={INPUT_FIELD} />
            </div>
            <div className="md:col-span-4 space-y-1">
              <span className={`text-[10px] uppercase tracking-[0.16em] font-medium ${filteredCredentials.length === 0 ? 'text-amber-300' : 'text-foreground/65'}`}>
                {t.channels.credential}{filteredCredentials.length === 0 ? ` · ${t.channels.credentialNoneFound}` : ''}
              </span>
              {filteredCredentials.length > 0 ? (
                <ThemedSelect filterable options={credentialOptions} value={newCredId} onValueChange={setNewCredId} placeholder={t.channels.credentialPlaceholder} />
              ) : (
                <input type="text" placeholder={t.channels.noCredentialsForChannel} disabled className={`${INPUT_FIELD} opacity-50`} />
              )}
            </div>
            <div className="md:col-span-3 space-y-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/65 font-medium">{t.channels.personaIdOptional}</span>
              <input type="text" placeholder={t.channels.personaIdPlaceholder} value={newPersonaId} onChange={(e) => setNewPersonaId(e.target.value)} className={`${INPUT_FIELD} font-mono`} />
            </div>
          </div>
          {formError && <p className="typo-caption text-red-400 mt-2">{formError}</p>}
          <div className="flex justify-end gap-2 mt-3">
            <Button onClick={resetForm} variant="ghost" size="sm">{t.channels.cancelBtn}</Button>
            <Button onClick={handleCreate} disabled={!newCredId.trim() || submitting} size="sm" variant="accent" accentColor="violet">{submitting ? t.channels.adding : t.channels.addChannel}</Button>
          </div>
        </div>
      )}

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/5 flex items-center gap-2 bg-card/30">
        <span className="text-[10px] uppercase tracking-[0.16em] text-foreground/55 font-medium mr-1">filter</span>
        {([
          ['all', `all · ${stats.total}`],
          ['active', `active · ${stats.active}`],
          ['paused', `paused · ${stats.paused}`],
          ['no-tone', `no tone · ${stats.noTone}`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
              filter === id
                ? id === 'no-tone' && stats.noTone > 0
                  ? 'bg-amber-500/15 text-amber-200 border-amber-500/25'
                  : 'bg-violet-500/15 text-violet-200 border-violet-500/25'
                : 'text-foreground/65 border-primary/10 hover:text-foreground hover:border-primary/20'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[2] bg-background/95 backdrop-blur">
            <tr className="border-b border-primary/15 text-foreground/55">
              <th className="text-left px-3 py-2 pl-4 md:pl-6 xl:pl-8 w-32"><span className="text-[10px] uppercase tracking-[0.16em]">channel</span></th>
              <th className="text-left px-3 py-2"><span className="text-[10px] uppercase tracking-[0.16em]">label</span></th>
              <th className="text-left px-3 py-2 w-56"><span className="text-[10px] uppercase tracking-[0.16em]">credential</span></th>
              <th className="text-center px-3 py-2 w-20"><span className="text-[10px] uppercase tracking-[0.16em]">tone</span></th>
              <th className="text-left px-3 py-2 w-32 hidden xl:table-cell"><span className="text-[10px] uppercase tracking-[0.16em]">persona</span></th>
              <th className="text-center px-3 py-2 w-24"><span className="text-[10px] uppercase tracking-[0.16em]">status</span></th>
              <th className="text-right px-3 py-2 pr-4 md:pr-6 xl:pr-8 w-24"><span className="text-[10px] uppercase tracking-[0.16em]">actions</span></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && channels.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center typo-body text-foreground/65">{t.channels.loading}</td></tr>
            )}
            {!isLoading && visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center">
                <Radio className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
                <p className="typo-body text-foreground/65">{filter === 'all' ? t.channels.noChannelsConfigured : 'no channels match this filter'}</p>
                <p className="typo-caption text-foreground/55 mt-1">{filter === 'all' ? t.channels.noChannelsHint : ''}</p>
              </td></tr>
            )}
            {visible.map((ch) => {
              const meta = getChannelMeta(ch.channel_type);
              const cred = credentials.find((c) => c.id === ch.credential_id);
              const hasTone = tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === ch.channel_type);
              return (
                <tr key={ch.id} className={`group border-b border-primary/5 transition-colors ${ch.is_active ? 'hover:bg-secondary/20' : 'opacity-60 hover:opacity-90 hover:bg-secondary/20'}`}>
                  <td className="pl-4 md:pl-6 xl:pl-8 pr-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${ch.is_active ? meta.dot : 'bg-foreground/20'}`} />
                      <span className={`typo-card-label ${meta.text}`}>{meta.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 typo-body text-foreground truncate">{ch.label ?? <span className="text-foreground/40 italic">unnamed</span>}</td>
                  <td className="px-3 py-2.5">
                    {cred ? (
                      <span className="typo-caption text-foreground/85 truncate">{cred.name}</span>
                    ) : (
                      <span className="font-mono text-[10px] text-foreground/55">{ch.credential_id.slice(0, 12)}…</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {hasTone ? (
                      <span className="text-emerald-300 text-xs">●</span>
                    ) : ch.is_active ? (
                      <button onClick={() => setTwinTab('tone')} className="text-amber-300 text-[11px] hover:text-amber-200 transition-colors flex items-center gap-1 mx-auto">
                        <Mic className="w-3 h-3" /> add
                      </button>
                    ) : (
                      <span className="text-foreground/30 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden xl:table-cell">
                    {ch.persona_id ? (
                      <span className="font-mono text-[10px] text-foreground/65">{ch.persona_id.slice(0, 12)}…</span>
                    ) : (
                      <span className="text-foreground/30 typo-caption">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium rounded-full ${
                      ch.is_active
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                        : 'bg-secondary/40 text-foreground/55 border border-primary/10'
                    }`}>{ch.is_active ? 'active' : 'paused'}</span>
                  </td>
                  <td className="pr-4 md:pr-6 xl:pr-8 pl-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleToggle(ch)} title={ch.is_active ? t.channels.pause : t.channels.activate} className="p-1 rounded-interactive text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors">
                        {ch.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => handleDelete(ch)} title={t.channels.remove} className="p-1 rounded-interactive text-foreground/65 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
