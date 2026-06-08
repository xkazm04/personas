import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Inbox, Sparkles, Send, Trash2, Loader2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinContact } from '@/lib/bindings/TwinContact';
import type { TwinChannelKind } from '@/api/enums';
import * as twinApi from '@/api/twin/twin';
import { silentCatch } from '@/lib/silentCatch';

/* ------------------------------------------------------------------ *
 *  ReplyOutbox — draft-reply staging with approve-before-send.
 *
 *  Pick a channel + contact, paste the inbound message, generate a
 *  channel-appropriate draft (twin_draft_reply), review/edit it in a
 *  textarea, then Approve (persists as an OUTBOUND communication via
 *  the existing twin_record_interaction) or Discard. Nothing is sent
 *  over any real channel — the human stays in control.
 * ------------------------------------------------------------------ */

export function ReplyOutbox({ channels }: { channels: TwinChannel[] }) {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const replyDraft = useSystemStore((s) => s.twinReplyDraft);
  const drafting = useSystemStore((s) => s.twinReplyDrafting);
  const draftReply = useSystemStore((s) => s.draftTwinReply);
  const setDraft = useSystemStore((s) => s.setTwinReplyDraft);
  const clearDraft = useSystemStore((s) => s.clearTwinReplyDraft);
  const recordInteraction = useSystemStore((s) => s.recordTwinInteraction);

  const activeChannels = useMemo(() => channels.filter((c) => c.is_active), [channels]);

  const [channelType, setChannelType] = useState<TwinChannelKind | ''>('');
  const [contactHandle, setContactHandle] = useState('');
  const [inbound, setInbound] = useState('');
  const [directions, setDirections] = useState('');
  const [contacts, setContacts] = useState<TwinContact[]>([]);
  const [approving, setApproving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Default the channel selector to the first active channel.
  useEffect(() => {
    if (!channelType && activeChannels.length > 0) {
      setChannelType(activeChannels[0]!.channel_type as TwinChannelKind);
    }
  }, [activeChannels, channelType]);

  // Pull contacts so the operator can pick who they're replying to. Contacts
  // aren't in the store slice (fetched on demand) — keep this panel self-
  // contained rather than widening the slice.
  useEffect(() => {
    if (!activeTwinId) return;
    twinApi
      .listTwinContacts(activeTwinId)
      .then(setContacts)
      .catch(silentCatch('features/plugins/twin/sub_channels/ReplyOutbox:contacts'));
  }, [activeTwinId]);

  const channelOptions: ThemedSelectOption[] = useMemo(
    () =>
      activeChannels.map((c) => ({
        value: c.channel_type,
        label: c.label ?? c.channel_type,
        description: c.channel_type,
      })),
    [activeChannels],
  );

  const contactOptions: ThemedSelectOption[] = useMemo(
    () => contacts.map((c) => ({ value: c.handle, label: c.alias ?? c.handle, description: c.handle })),
    [contacts],
  );

  const canGenerate = !!activeTwinId && !!channelType && !drafting;

  const handleGenerate = async () => {
    if (!activeTwinId || !channelType) return;
    setLocalError(null);
    try {
      await draftReply(
        activeTwinId,
        channelType,
        contactHandle.trim() || undefined,
        inbound.trim() || undefined,
        directions.trim() || undefined,
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to draft reply');
    }
  };

  const handleApprove = async () => {
    if (!activeTwinId || !channelType || !replyDraft?.trim()) return;
    setApproving(true);
    setLocalError(null);
    try {
      // Persist as an OUTBOUND communication — no real send, just the record.
      await recordInteraction(
        activeTwinId,
        channelType,
        'out',
        replyDraft.trim(),
        contactHandle.trim() || undefined,
      );
      clearDraft();
      setInbound('');
      setDirections('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to record reply');
    } finally {
      setApproving(false);
    }
  };

  if (!activeTwinId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-card border border-violet-500/25 bg-gradient-to-br from-violet-500/8 to-cyan-500/5 p-5 shadow-elevation-1"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
          <Inbox className="w-4 h-4 text-violet-300" />
        </div>
        <div className="min-w-0">
          <h3 className="typo-section-title">Reply outbox</h3>
          <p className="typo-caption text-foreground">
            Draft a channel-appropriate reply, review it, then approve to log it as a sent message. Nothing is sent
            automatically.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Channel">
          <ThemedSelect
            options={channelOptions}
            value={channelType}
            onValueChange={(v) => setChannelType(v as TwinChannelKind)}
            placeholder={activeChannels.length === 0 ? 'No active channels' : 'Select channel'}
          />
        </Field>
        <Field label="Contact (optional)">
          {contactOptions.length > 0 ? (
            <ThemedSelect
              filterable
              options={contactOptions}
              value={contactHandle}
              onValueChange={setContactHandle}
              placeholder="Pick a contact"
            />
          ) : (
            <input
              type="text"
              placeholder="Contact handle"
              value={contactHandle}
              onChange={(e) => setContactHandle(e.target.value)}
              className={INPUT_FIELD}
            />
          )}
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Inbound message (optional)">
          <textarea
            rows={2}
            placeholder="Paste the message you're replying to…"
            value={inbound}
            onChange={(e) => setInbound(e.target.value)}
            className={`${INPUT_FIELD} resize-y`}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Directions (optional)">
          <input
            type="text"
            placeholder="e.g. keep it short, warmer tone"
            value={directions}
            onChange={(e) => setDirections(e.target.value)}
            className={INPUT_FIELD}
          />
        </Field>
      </div>

      <div className="flex justify-end mt-3">
        <Button onClick={handleGenerate} disabled={!canGenerate} size="sm" variant="accent" accentColor="violet">
          {drafting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
          {drafting ? 'Drafting…' : replyDraft ? 'Regenerate' : 'Generate draft'}
        </Button>
      </div>

      {replyDraft !== null && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 pt-4 border-t border-primary/10"
        >
          <Field label="Draft reply — edit before approving">
            <textarea
              rows={5}
              value={replyDraft}
              onChange={(e) => setDraft(e.target.value)}
              className={`${INPUT_FIELD} resize-y font-normal`}
            />
          </Field>
          <div className="flex justify-end gap-2 mt-3">
            <Button onClick={clearDraft} variant="ghost" size="sm" disabled={approving}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Discard
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approving || !replyDraft.trim()}
              size="sm"
              variant="accent"
              accentColor="emerald"
            >
              {approving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              {approving ? 'Recording…' : 'Approve & log'}
            </Button>
          </div>
        </motion.div>
      )}

      {localError && <p className="typo-caption text-red-400 mt-3">{localError}</p>}
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-[0.16em] font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}
