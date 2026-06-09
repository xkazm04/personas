import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Inbox, Sparkles, Send, Trash2, Loader2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { ContactThread } from './ContactThread';
import type { ReuseRequest } from './SentReplies';
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

/** Quick-steer presets — the localized label doubles as the direction text
 *  (mirrors the training presets' localized-prompt convention, so the model
 *  steers in the user's language). */
const STEER_CHIPS = ['steerShorter', 'steerWarmer', 'steerFormal', 'steerQuestion'] as const;

export function ReplyOutbox({ channels, reuseRequest }: { channels: TwinChannel[]; reuseRequest?: ReuseRequest | null }) {
  const { t: tFull } = useTranslation();
  const tc = tFull.twin.channels;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const replyDraft = useSystemStore((s) => s.twinReplyDraft);
  const drafting = useSystemStore((s) => s.twinReplyDrafting);
  const draftReply = useSystemStore((s) => s.draftTwinReply);
  const setDraft = useSystemStore((s) => s.setTwinReplyDraft);
  const clearDraft = useSystemStore((s) => s.clearTwinReplyDraft);
  const recordInteraction = useSystemStore((s) => s.recordTwinInteraction);

  const activeChannels = useMemo(() => channels.filter((c) => c.is_active), [channels]);
  const twinTones = useSystemStore((s) => s.twinTones);
  // Tone rows for the active twin — hydrated at page level by useHydrateActiveTwin.
  const tones = useMemo(() => twinTones.filter((tn) => tn.twin_id === activeTwinId), [twinTones, activeTwinId]);

  const [channelType, setChannelType] = useState<TwinChannelKind | ''>('');
  const [contactHandle, setContactHandle] = useState('');
  // Which tone register grounds the draft. 'auto' = the target channel's tone
  // (the backend's default resolution); any other value names a tone row.
  const [toneChannel, setToneChannel] = useState('auto');
  const [inbound, setInbound] = useState('');
  const [directions, setDirections] = useState('');
  const [contacts, setContacts] = useState<TwinContact[]>([]);
  const [approving, setApproving] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // The channel + contact the current draft was generated for. Approve logs
  // against THIS frozen tuple, not the live selectors, so changing the dropdowns
  // after generating can't mis-attribute the recorded send (bug-hunt 2026-06-07
  // twin #3).
  const [draftContext, setDraftContext] = useState<{ channel: TwinChannelKind; contactHandle: string } | null>(null);

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

  // Drop the frozen context whenever the draft is cleared (Discard / Approve)
  // so a stale tuple can't apply to a future draft.
  useEffect(() => {
    if (replyDraft === null) setDraftContext(null);
  }, [replyDraft]);

  // Consume an "adapt this sent reply" request from the Recently-sent rail:
  // prefill the selectors + draft box with the past reply and freeze the
  // approve context to its original channel/contact, so editing + Approve
  // re-logs against the same thread. Keyed on ts so the same row can be
  // reused again later.
  const rootRef = useRef<HTMLDivElement>(null);
  const lastReuseTs = useRef<number | null>(null);
  useEffect(() => {
    if (!reuseRequest || lastReuseTs.current === reuseRequest.ts) return;
    lastReuseTs.current = reuseRequest.ts;
    const ch = reuseRequest.channel as TwinChannelKind;
    setChannelType(ch);
    setContactHandle(reuseRequest.contactHandle);
    setDraft(reuseRequest.content);
    setDraftContext({ channel: ch, contactHandle: reuseRequest.contactHandle });
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [reuseRequest, setDraft]);

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

  // Tone-register options: 'auto' defers to the backend's per-channel
  // resolution; the rest name the twin's configured tone rows. Channel ids are
  // technical identifiers — shown as-is, like the channel select's description.
  const toneOptions: ThemedSelectOption[] = useMemo(
    () => [
      { value: 'auto', label: tc.toneAuto },
      ...tones.map((tn) => ({ value: tn.channel, label: tn.channel })),
    ],
    [tones, tc.toneAuto],
  );

  const canGenerate = !!activeTwinId && !!channelType && !drafting;

  const handleGenerate = async (dirOverride?: string) => {
    if (!activeTwinId || !channelType) return;
    setLocalError(null);
    try {
      await draftReply(
        activeTwinId,
        channelType,
        contactHandle.trim() || undefined,
        inbound.trim() || undefined,
        (dirOverride ?? directions).trim() || undefined,
        toneChannel === 'auto' ? undefined : toneChannel,
      );
      // Freeze the channel + contact this draft was generated for.
      setDraftContext({ channel: channelType, contactHandle: contactHandle.trim() });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to draft reply');
    }
  };

  // One-tap steering: fill the directions box and — when a draft is already
  // on screen — regenerate immediately with the chip's direction.
  const handleSteer = (direction: string) => {
    setDirections(direction);
    if (replyDraft !== null && canGenerate) void handleGenerate(direction);
  };

  const handleApprove = async () => {
    if (!activeTwinId || !draftContext || !replyDraft?.trim()) return;
    setApproving(true);
    setLocalError(null);
    try {
      // Persist as an OUTBOUND communication against the FROZEN channel/contact
      // the draft was generated for — not the live selectors (bug-hunt
      // 2026-06-07 twin #3).
      await recordInteraction(
        activeTwinId,
        draftContext.channel,
        'out',
        replyDraft.trim(),
        draftContext.contactHandle || undefined,
        undefined, // summary
        undefined, // keyFactsJson
        // Operator-approved outbound draft is the twin's OWN generated text — not
        // new knowledge. Do NOT queue it as a memory (create_memory defaults true
        // in Rust): doing so poisons distilled facts / wiki with the twin's output,
        // which then grounds the next reply — a self-reinforcing corruption loop.
        false,
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
      ref={rootRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-card border border-violet-500/25 bg-gradient-to-br from-violet-500/8 to-cyan-500/5 p-5 shadow-elevation-1"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
          <Inbox className="w-4 h-4 text-violet-300" />
        </div>
        <div className="min-w-0">
          {/* eslint-disable custom/no-hardcoded-jsx-text */}
          <h3 className="typo-section-title">Reply outbox</h3>
          <p className="typo-caption text-foreground">
            Draft a channel-appropriate reply, review it, then approve to log it as a sent message. Nothing is sent
            automatically.
          </p>
          {/* eslint-enable custom/no-hardcoded-jsx-text */}
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
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              placeholder="Pick a contact"
            />
          ) : (
            <input
              type="text"
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              placeholder="Contact handle"
              value={contactHandle}
              onChange={(e) => setContactHandle(e.target.value)}
              className={INPUT_FIELD}
            />
          )}
        </Field>
        {tones.length > 0 && (
          <Field label={tc.toneRegister}>
            <ThemedSelect options={toneOptions} value={toneChannel} onValueChange={setToneChannel} />
          </Field>
        )}
      </div>

      <ContactThread twinId={activeTwinId} channel={channelType} contactHandle={contactHandle} />

      <div className="mt-3">
        <Field label="Inbound message (optional)">
          <textarea
            rows={2}
            // eslint-disable-next-line custom/no-hardcoded-jsx-text
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
            // eslint-disable-next-line custom/no-hardcoded-jsx-text
            placeholder="e.g. keep it short, warmer tone"
            value={directions}
            onChange={(e) => setDirections(e.target.value)}
            className={INPUT_FIELD}
          />
        </Field>
        {/* Quick-steer chips — fill the direction in one tap; with a draft on
            screen the tap regenerates immediately. */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2" role="group" aria-label={tc.steerLabel}>
          {STEER_CHIPS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleSteer(tc[key])}
              disabled={drafting}
              className={`px-2 py-1 rounded-full border text-[11px] font-medium transition-colors focus-ring disabled:opacity-40 ${
                directions.trim() === tc[key]
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
                  : 'border-primary/15 bg-secondary/30 text-foreground hover:border-violet-500/30 hover:text-violet-300'
              }`}
            >
              {tc[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end mt-3">
        <Button onClick={() => void handleGenerate()} disabled={!canGenerate} size="sm" variant="accent" accentColor="violet">
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
          <Field
            label={
              draftContext
                ? `Draft reply for ${draftContext.channel}${draftContext.contactHandle ? ` → ${draftContext.contactHandle}` : ''} — edit before approving`
                : 'Draft reply — edit before approving'
            }
          >
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
              onClick={() => setConfirmSend(true)}
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

      {confirmSend && (
        <ConfirmDialog
          // eslint-disable-next-line custom/no-hardcoded-jsx-text
          title="Log this reply as sent by you?"
          body={
            draftContext
              ? `This records an outbound reply attributed to you on ${draftContext.channel}${draftContext.contactHandle ? ` → ${draftContext.contactHandle}` : ''}.`
              : 'This records an outbound reply attributed to you.'
          }
          confirmLabel="Approve & log"
          onConfirm={() => {
            setConfirmSend(false);
            void handleApprove();
          }}
          onCancel={() => setConfirmSend(false)}
        />
      )}
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
