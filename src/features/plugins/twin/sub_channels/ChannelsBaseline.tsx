import { useEffect, useState, useMemo } from 'react';
import { Radio, Plus, Trash2, Power, PowerOff, X, User, Mic } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinChannelKind } from '@/api/enums';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { CoachMark } from '../CoachMark';

const CHANNEL_TYPES: { id: string; label: string; color: string; bg: string; serviceType: string }[] = [
  { id: 'discord', label: 'Discord', color: 'text-indigo-400', bg: 'bg-indigo-500/10', serviceType: 'discord' },
  { id: 'slack', label: 'Slack', color: 'text-cyan-400', bg: 'bg-cyan-500/10', serviceType: 'slack' },
  { id: 'email', label: 'Email', color: 'text-amber-400', bg: 'bg-amber-500/10', serviceType: 'gmail' },
  { id: 'telegram', label: 'Telegram', color: 'text-sky-400', bg: 'bg-sky-500/10', serviceType: 'telegram' },
  { id: 'sms', label: 'SMS', color: 'text-emerald-400', bg: 'bg-emerald-500/10', serviceType: 'twilio-sms' },
  { id: 'teams', label: 'Teams', color: 'text-violet-400', bg: 'bg-violet-500/10', serviceType: 'microsoft-teams' },
  { id: 'whatsapp', label: 'WhatsApp', color: 'text-green-400', bg: 'bg-green-500/10', serviceType: 'whatsapp' },
];

function getChannelMeta(type: string) {
  return CHANNEL_TYPES.find((c) => c.id === type) ?? { id: type, label: type, color: 'text-foreground', bg: 'bg-secondary/40', serviceType: type };
}

const channelOptions: ThemedSelectOption[] = CHANNEL_TYPES.map((ct) => ({ value: ct.id, label: ct.label }));

function ChannelCard({ channel, meta, credential, onToggle, onDelete }: {
  channel: TwinChannel;
  meta: ReturnType<typeof getChannelMeta>;
  credential: { id: string; name: string } | undefined;
  onToggle: (ch: TwinChannel) => void;
  onDelete: (ch: TwinChannel) => void;
}) {
  const { t } = useTwinTranslation();
  return (
    <div className={`p-4 rounded-card border transition-colors ${channel.is_active ? 'border-violet-500/20 bg-card/60' : 'border-primary/10 bg-card/30 opacity-60'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-interactive ${meta.bg} flex items-center justify-center flex-shrink-0`}>
          <Radio className={`w-4 h-4 ${meta.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-card-label">{channel.label ?? meta.label}</span>
            <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full ${meta.bg} ${meta.color}`}>{meta.label}</span>
            {!channel.is_active && <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-secondary/40 text-foreground">{t.channels.paused}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="typo-caption text-foreground truncate">{credential ? credential.name : channel.credential_id.slice(0, 12) + '...'}</span>
            {channel.persona_id && <span className="flex items-center gap-1 typo-caption text-foreground"><User className="w-3 h-3" />{channel.persona_id.slice(0, 8)}...</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggle(channel)} className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
            {channel.is_active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
          </button>
          <button onClick={() => onDelete(channel)} className="p-1.5 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChannelsBaseline() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const channels = useSystemStore((s) => s.twinChannels);
  const isLoading = useSystemStore((s) => s.twinChannelsLoading);
  const fetchChannels = useSystemStore((s) => s.fetchTwinChannels);
  const createChannel = useSystemStore((s) => s.createTwinChannel);
  const updateChannel = useSystemStore((s) => s.updateTwinChannel);
  const deleteChannel = useSystemStore((s) => s.deleteTwinChannel);
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

  if (!activeTwinId) return <TwinEmptyState icon={Radio} title={t.channels.title} />;

  const tones = useSystemStore.getState().twinTones;
  const setTwinTab = useSystemStore.getState().setTwinTab;
  const channelsWithoutTone = channels
    .filter((ch) => ch.is_active)
    .map((ch) => ch.channel_type)
    .filter((type, idx, arr) => arr.indexOf(type) === idx)
    .filter((type) => !tones.some((tn) => tn.twin_id === activeTwinId && tn.channel === type))
    .slice(0, 3);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Radio className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.channels.title}
        subtitle={t.channels.subtitle}
        actions={!adding ? (<Button onClick={() => setAdding(true)} size="sm" variant="accent" accentColor="violet"><Plus className="w-4 h-4 mr-1.5" />{t.channels.addChannel}</Button>) : undefined}
      />

      <ContentBody centered>
        <div className="max-w-2xl mx-auto space-y-4 pb-8">
          <CoachMark id="channels" title={t.coach.channelsTitle} body={t.coach.channelsBody} />
          {channelsWithoutTone.map((ch) => (
            <div key={ch} className="p-3 rounded-card border border-amber-500/25 bg-amber-500/5 flex items-center gap-3">
              <Mic className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="typo-caption text-foreground flex-1">{t.nudges.channelWithoutTone.replace('{channel}', ch).replace('{channel}', ch)}</p>
              <button onClick={() => setTwinTab('tone')} className="px-2.5 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-interactive hover:bg-amber-500/20 transition-colors flex-shrink-0">
                {t.nudges.channelWithoutToneCta.replace('{channel}', ch)}
              </button>
            </div>
          ))}
          {adding && (
            <div className="p-4 rounded-card border border-violet-500/20 bg-violet-500/5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="typo-section-title">{t.channels.addChannel}</h3>
                <button onClick={resetForm} className="text-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="typo-caption text-foreground font-medium">{t.channels.channelType}</span>
                  <ThemedSelect filterable options={channelOptions} value={newType} onValueChange={(v) => setNewType(v as TwinChannelKind)} placeholder={t.channels.selectChannel} />
                </div>
                <div className="space-y-1">
                  <span className="typo-caption text-foreground font-medium">{t.channels.label}</span>
                  <input type="text" placeholder={t.channels.labelPlaceholder} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className={INPUT_FIELD} />
                </div>
                <div className="space-y-1">
                  <span className="typo-caption text-foreground font-medium">
                    {t.channels.credential}
                    {filteredCredentials.length === 0 && <span className="text-amber-400 ml-1">({t.channels.credentialNoneFound})</span>}
                  </span>
                  {filteredCredentials.length > 0 ? (
                    <ThemedSelect filterable options={credentialOptions} value={newCredId} onValueChange={setNewCredId} placeholder={t.channels.credentialPlaceholder} />
                  ) : (
                    <input type="text" placeholder={t.channels.noCredentialsForChannel} disabled className={`${INPUT_FIELD} opacity-50`} />
                  )}
                </div>
                <div className="space-y-1">
                  <span className="typo-caption text-foreground font-medium">{t.channels.personaIdOptional}</span>
                  <input type="text" placeholder={t.channels.personaIdPlaceholder} value={newPersonaId} onChange={(e) => setNewPersonaId(e.target.value)} className={`${INPUT_FIELD} font-mono`} />
                </div>
              </div>
              {formError && <p className="typo-caption text-red-400">{formError}</p>}
              <div className="flex justify-end gap-2">
                <Button onClick={resetForm} variant="ghost" size="sm">{t.channels.cancelBtn}</Button>
                <Button onClick={handleCreate} disabled={!newCredId.trim() || submitting} size="sm">{submitting ? t.channels.adding : t.channels.addChannel}</Button>
              </div>
            </div>
          )}
          {isLoading && channels.length === 0 ? (
            <p className="typo-body text-foreground text-center py-12">{t.channels.loading}</p>
          ) : channels.length === 0 && !adding ? (
            <div className="py-12 text-center">
              <Radio className="w-10 h-10 text-violet-400/30 mx-auto mb-3" />
              <p className="typo-body text-foreground">{t.channels.noChannelsConfigured}</p>
              <p className="typo-caption text-foreground mt-1">{t.channels.noChannelsHint}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map((ch) => {
                const meta = getChannelMeta(ch.channel_type);
                const cred = credentials.find((c) => c.id === ch.credential_id);
                return <ChannelCard key={ch.id} channel={ch} meta={meta} credential={cred} onToggle={handleToggle} onDelete={handleDelete} />;
              })}
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
