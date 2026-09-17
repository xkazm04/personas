import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch, toastCatch, extractMessage } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import * as twinApi from '@/api/twin/twin';
import type { TwinChannelKind } from '@/api/enums';
import { deriveReadiness, type MilestoneStatus } from '../useTwinReadiness';
import { slotStatusOf } from '../shared/twinStatus';
import {
  SETUP_FOCUS_ORDER,
  type SetupChecklistItem,
  type SetupFieldEdit,
  type SetupFocus,
  type SetupHistoryEntry,
  type SetupProposal,
  type SetupSessionApi,
  type SetupStage,
  type SetupSuggestion,
  type SetupTonePart,
  type SetupTurnMessage,
} from './setupContract';

/**
 * The Setup module's engine — one guided conversation over the four setup
 * slots, plus the typed path that does the same work without the guide.
 *
 * Three invariants this hook exists to hold, all of them the reason the
 * pre-v2 interview was untrustworthy:
 *
 * 1. **Readiness is the only completion authority.** The checklist, the score
 *    and the focus are derived from `deriveReadiness` over real store rows.
 *    `doneHint` from the generator is carried but never consulted — a model
 *    that cannot see the database cannot know whether a bio was saved.
 * 2. **A generator failure leaves the slot OPEN.** It sets `generatorError`
 *    and changes nothing else; the typed `edit()` path keeps working while the
 *    guide is down, which is why `edit` shares no code with `answer`.
 * 3. **Nothing is written until a human says so.** A proposal is an offer;
 *    only `accept()` and `edit()` call a write command.
 */

/** Bio length that reads as a finished identity — mirrors `useTwinReadiness`. */
const BIO_TARGET_CHARS = 50;
/** Approved memories that read as a finished memories slot. */
const MEMORY_TARGET = 5;

/**
 * Checklist `detail` is a measured fact, and it is rendered verbatim by the
 * readiness strip and the desk buffer. It is written as `have/target` digits rather than prose so it needs
 * no translation and reads identically in all 14 locales — the alternative
 * ("62 words") would be untranslated English on a localized surface.
 */
function detailOf(have: number, target: number): string {
  return `${have}/${target}`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Prompt-facing note for a declined question. Skipping IS an answer — "not
 * this one" — so the guide is told about it and moves on. It is never stored
 * as a field value, and it never becomes a transcript line, because the
 * transcript already shows the question that was asked and the different
 * question that followed it.
 */
const DECLINED_NOTE =
  '(They chose not to answer that question. Ask about something else in this slot, and do not ask it again.)';

export function useSetupSession(): SetupSessionApi {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const twinTones = useSystemStore((s) => s.twinTones);
  const twinChannels = useSystemStore((s) => s.twinChannels);
  const twinReadinessApproved = useSystemStore((s) => s.twinReadinessApproved);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const recordTwinInteraction = useSystemStore((s) => s.recordTwinInteraction);
  const pendingTrainingQuestions = useSystemStore((s) => s.pendingTrainingQuestions);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);

  const [stage, setStage] = useState<SetupStage>('setup');
  const [topic, setTopic] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SetupSuggestion[]>([]);
  const [proposals, setProposals] = useState<SetupProposal[]>([]);
  const [history, setHistory] = useState<SetupHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [focusOverride, setFocusOverride] = useState<SetupFocus | null>(null);

  // Questions handed over by the Hub's "dig deeper". They are asked before the
  // generator is consulted, so the handoff cannot dead-end.
  //
  // Held in a ref AS WELL as in state, and the ref is what `requestTurn` reads.
  // Effects in one commit see each other's `setState` only on the next render,
  // so with state alone the mount-time open effect raced the handoff effect and
  // spent a generator call whose answer then overwrote the handed-over
  // question. The ref makes the handoff visible within the same commit.
  const queuedRef = useRef<string[]>([]);
  const [queuedQuestions, setQueuedQuestions] = useState<string[]>([]);

  const profile = useMemo(
    () => (activeTwinId ? (twinProfiles.find((p) => p.id === activeTwinId) ?? null) : null),
    [activeTwinId, twinProfiles],
  );

  // Rows are scoped to the active twin: the slices can still hold a previous
  // twin's rows while a fetch is in flight, and a stale row would move the
  // checklist for a twin it does not describe.
  const tones = useMemo(
    () => (profile ? twinTones.filter((t) => t.twin_id === profile.id) : []),
    [profile, twinTones],
  );
  const channels = useMemo(
    () => (profile ? twinChannels.filter((c) => c.twin_id === profile.id) : []),
    [profile, twinChannels],
  );
  const memories = useMemo(
    () => (profile ? twinReadinessApproved.filter((m) => m.twin_id === profile.id) : []),
    [profile, twinReadinessApproved],
  );

  const readiness = useMemo(
    () => deriveReadiness(profile, tones, channels, memories),
    [profile, tones, channels, memories],
  );

  /**
   * Tone slots the guide will cover: 'generic' plus the distinct `channel_type`
   * of every BOUND channel. Deliberately not the static `TONE_CHANNELS` list —
   * that offered registers for channels this twin does not have and hid the
   * ones it does. `twin_upsert_tone` does not constrain the channel, so any
   * bound type is a legal tone row.
   */
  const toneChannels = useMemo(() => {
    const seen = new Set<string>(['generic']);
    for (const c of channels) {
      const type = c.channel_type?.trim();
      if (type) seen.add(type);
    }
    return [...seen];
  }, [channels]);

  /** Current stored value of every editable slot, keyed like `SetupFieldEdit`. */
  const values = useMemo(() => {
    const out: Record<string, string> = {
      name: profile?.name ?? '',
      role: profile?.role ?? '',
      bio: profile?.bio ?? '',
      obsidianSubpath: profile?.obsidian_subpath ?? '',
    };
    for (const channel of toneChannels) {
      const row = tones.find((t) => t.channel === channel);
      out[`tone:${channel}`] = row?.voice_directives ?? '';
      // The stored columns, verbatim. `examples_json` / `constraints_json` hold
      // a JSON array; they are handed over unparsed so the one surface that
      // renders them owns the presentation and a round-trip through here can
      // never rewrite what is on disk.
      out[`tone:${channel}:examples`] = row?.examples_json ?? '';
      out[`tone:${channel}:constraints`] = row?.constraints_json ?? '';
      out[`tone:${channel}:lengthHint`] = row?.length_hint ?? '';
    }
    return out;
  }, [profile, tones, toneChannels]);

  const checklist = useMemo<SetupChecklistItem[]>(() => {
    const bioChars = profile?.bio?.trim().length ?? 0;
    const rows: Record<SetupFocus, { status: MilestoneStatus; detail: string }> = {
      identity: {
        status: readiness.identity,
        detail: detailOf(Math.min(bioChars, BIO_TARGET_CHARS), BIO_TARGET_CHARS),
      },
      tone: {
        status: readiness.tone,
        detail: detailOf(readiness.counts.toneRows, toneChannels.length),
      },
      channels: {
        status: readiness.channels,
        detail: detailOf(readiness.counts.channelsActive, readiness.counts.channelsTotal),
      },
      memories: {
        status: readiness.memories,
        detail: detailOf(
          Math.min(readiness.counts.memoriesApproved, MEMORY_TARGET),
          MEMORY_TARGET,
        ),
      },
    };
    return SETUP_FOCUS_ORDER.map((id) => ({
      id,
      status: slotStatusOf(rows[id].status),
      detail: rows[id].detail,
      labelKey: id,
    }));
  }, [profile, readiness, toneChannels.length]);

  /**
   * The first slot readiness still calls incomplete, unless the user pointed
   * somewhere else. The generator does not get a vote: it returns a `focus`,
   * and the backend clamps that to a real slot, but which slot the flow is
   * WORKING is decided here, from stored data.
   */
  const derivedFocus = useMemo<SetupFocus>(() => {
    const incomplete = checklist.find((item) => item.status !== 'set');
    return incomplete?.id ?? 'memories';
  }, [checklist]);
  const focus = focusOverride ?? derivedFocus;

  // `answer` is rebuilt on every render it depends on; the hands-free path and
  // the queued-question effect call it through a ref so neither re-subscribes.
  const stateRef = useRef({ stage, topic, focus, history, question });
  stateRef.current = { stage, topic, focus, history, question };

  /**
   * The focus `requestTurn` reads, held in a ref AS WELL as in state.
   *
   * `focusOn` changes the focus and asks for a turn on the NEW slot in the same
   * tick, and a `setState` is not visible to that same tick — so reading the
   * focus out of state sent the request on the slot the user just left. Until
   * 2026-09-16 `focusOn` did not request a turn at all: it moved the strip's
   * highlight and nothing below it changed, which is the defect this ref exists
   * to close.
   */
  const focusRef = useRef<SetupFocus>(focus);
  focusRef.current = focus;

  /**
   * True from the moment a generator call is issued until it settles. `busy`
   * says the same thing to the renderer, but a state flag set in this tick is
   * not readable in this tick, and the guard below is a click handler.
   */
  const inFlightRef = useRef(false);

  const wireHistory = useCallback(
    (entries: SetupHistoryEntry[]): SetupTurnMessage[] =>
      entries.map((e) => ({ role: e.role, text: e.text })),
    [],
  );

  /**
   * Ask for the next question. A failure here is REPORTED, never absorbed: the
   * slot it was working on stays exactly as incomplete as it was, and the typed
   * form remains the way forward.
   */
  const requestTurn = useCallback(
    async (entries: SetupHistoryEntry[], lastAnswer: string | undefined) => {
      if (!activeTwinId) return;
      const { stage: st, topic: tp } = stateRef.current;
      // From the ref, never from `stateRef`: see `focusRef`'s comment.
      const fc = focusRef.current;

      // A queued handoff question is asked verbatim — the operator already
      // chose it, so spending a generator call to rephrase it would be both
      // slower and less faithful.
      const queued = queuedRef.current[0];
      if (queued) {
        queuedRef.current = queuedRef.current.slice(1);
        setQueuedQuestions(queuedRef.current);
        setQuestion(queued);
        setSuggestions([]);
        setProposals([]);
        setGeneratorError(null);
        setHistory([...entries, { id: newId('g'), role: 'guide', text: queued }]);
        return;
      }

      setBusy(true);
      inFlightRef.current = true;
      try {
        const turn = await twinApi.setupTurn(
          activeTwinId,
          st,
          wireHistory(entries),
          fc,
          tp ?? undefined,
          lastAnswer,
        );
        setQuestion(turn.question);
        setSuggestions(turn.suggestions);
        setProposals(turn.proposals);
        setHistory([
          ...entries,
          {
            id: newId('g'),
            role: 'guide',
            text: turn.question,
            ...(turn.proposals.length > 0 ? { proposals: turn.proposals } : {}),
          },
        ]);
        // `turn.doneHint` is deliberately dropped here. It is the model's
        // impression, and readiness is the authority; promoting it would let a
        // confident sentence mark an empty slot complete.
        setGeneratorError(null);
      } catch (e) {
        // The failure is surfaced, not swallowed: the user must be able to see
        // that the guide is down rather than infer it from a question that
        // never arrives.
        toastCatch('features/plugins/twin/setup/useSetupSession:requestTurn')(e);
        setGeneratorError(resolveError(extractMessage(e)).message);
        setSuggestions([]);
        setProposals([]);
        setHistory(entries);
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [activeTwinId, wireHistory],
  );

  const requestTurnRef = useRef(requestTurn);
  requestTurnRef.current = requestTurn;

  // Consume the Hub's dig-deeper handoff. Cleared immediately so returning to
  // the tab does not replay the same prefill.
  useEffect(() => {
    if (!pendingTrainingQuestions || pendingTrainingQuestions.length === 0) return;
    queuedRef.current = pendingTrainingQuestions.slice(0, 5);
    setQueuedQuestions(queuedRef.current);
    setStage('training');
    // Clear the live question so the handed-over one is asked NEXT rather than
    // queued behind whatever the guide happened to be asking.
    setQuestion(null);
    setSuggestions([]);
    setProposals([]);
    setPendingTrainingQuestions(null);
  }, [pendingTrainingQuestions, setPendingTrainingQuestions]);

  // Ask the first queued question as soon as one lands and nothing is pending.
  useEffect(() => {
    if (queuedQuestions.length === 0) return;
    if (question !== null || busy) return;
    void requestTurnRef.current(stateRef.current.history, undefined);
  }, [queuedQuestions, question, busy]);

  const answer = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !activeTwinId) return;
      const { stage: st, question: asked, history: current } = stateRef.current;
      const next: SetupHistoryEntry[] = [
        ...current,
        { id: newId('u'), role: 'user', text: trimmed },
      ];
      setHistory(next);
      setSuggestions([]);
      setProposals([]);

      // A training answer is the material itself: it becomes a communication
      // plus a pending memory, exactly as the Training Studio records one. The
      // question rides along as the summary, and the repo now keeps the answer
      // in the memory body rather than only the summary.
      if (st === 'training' && asked) {
        try {
          await recordTwinInteraction(
            activeTwinId,
            'training',
            'out',
            trimmed,
            undefined,
            `Training Q&A: ${asked}`,
            JSON.stringify([{ q: asked, a: trimmed }]),
            true,
          );
        } catch (e) {
          // Recording is what the training stage is FOR, so this one is loud.
          toastCatch('features/plugins/twin/setup/useSetupSession:recordTraining')(e);
        }
      }

      await requestTurnRef.current(next, trimmed);
    },
    [activeTwinId, recordTwinInteraction],
  );

  /** Stamp a verdict onto the proposal's own guide turn, keyed by its id. */
  const resolveProposal = useCallback(
    (proposal: SetupProposal, verdict: 'accepted' | 'edited' | 'dismissed') => {
      setHistory((entries) =>
        entries.map((entry) =>
          entry.proposals?.some((p) => p.id === proposal.id)
            ? { ...entry, resolutions: { ...entry.resolutions, [proposal.id]: verdict } }
            : entry,
        ),
      );
      setProposals((current) => current.filter((p) => p.id !== proposal.id));
    },
    [],
  );

  const accept = useCallback(
    async (proposal: SetupProposal) => {
      if (!activeTwinId) return;
      try {
        if (proposal.kind === 'bio') {
          await updateTwinProfile(activeTwinId, { bio: proposal.value });
        } else if (proposal.kind === 'role') {
          await updateTwinProfile(activeTwinId, { role: proposal.value });
        } else {
          const channel = proposal.channel ?? 'generic';
          const row = tones.find((t) => t.channel === channel);
          await upsertTwinTone(
            activeTwinId,
            // INVARIANT: any BOUND channel type is a legal tone channel.
            // `twin_upsert_tone` stores the channel verbatim and does not
            // constrain it to `TwinChannelKind`; the union is the well-known
            // subset, not the allowed set. The value is either 'generic' or a
            // `twin_channels.channel_type` the user created.
            channel as TwinChannelKind,
            proposal.value,
            // A proposal offers VOICE DIRECTIVES. The row is written whole, so
            // the examples and constraints the user typed are carried over;
            // accepting an offer must not empty the parts it says nothing about.
            row?.examples_json ?? null,
            row?.constraints_json ?? null,
            proposal.lengthHint ?? row?.length_hint ?? null,
          );
        }
        resolveProposal(proposal, 'accepted');
      } catch (e) {
        toastCatch('features/plugins/twin/setup/useSetupSession:accept')(e);
      }
    },
    [activeTwinId, updateTwinProfile, upsertTwinTone, resolveProposal, tones],
  );

  const dismiss = useCallback(
    (proposal: SetupProposal) => {
      resolveProposal(proposal, 'dismissed');
    },
    [resolveProposal],
  );

  /**
   * The typed path. Same write commands as `accept`, no generator involved —
   * so every slot stays reachable while the guide is failing. Do not route
   * this through `answer`.
   */
  const edit = useCallback(
    async (change: SetupFieldEdit) => {
      if (!activeTwinId) return;
      try {
        switch (change.field) {
          case 'name':
            await updateTwinProfile(activeTwinId, { name: change.value });
            break;
          case 'role':
            await updateTwinProfile(activeTwinId, { role: change.value });
            break;
          case 'bio':
            await updateTwinProfile(activeTwinId, { bio: change.value });
            break;
          case 'obsidianSubpath':
            await updateTwinProfile(activeTwinId, { obsidianSubpath: change.value });
            break;
          case 'tone': {
            // A tone row is upserted WHOLE, so an edit to one part carries the
            // other three over from the stored row. Writing `null` for the
            // parts the user did not touch — which this did until the typed
            // surface exposed them — silently emptied the examples and the
            // constraints every time a voice directive was saved.
            const channel = change.channel ?? 'generic';
            const part = change.part ?? 'voice';
            const row = tones.find((t) => t.channel === channel);
            /** The edited part's own value, or the stored one for every other. */
            const partValue = (mine: SetupTonePart, stored: string | null | undefined) =>
              part === mine ? (change.value.trim() || null) : (stored ?? null);
            await upsertTwinTone(
              activeTwinId,
              // INVARIANT: as in `accept` — the channel comes from this twin's
              // own bound channels (or 'generic'), and the command stores it
              // verbatim without constraining it to the well-known union.
              channel as TwinChannelKind,
              part === 'voice' ? change.value : (row?.voice_directives ?? ''),
              partValue('examples', row?.examples_json),
              partValue('constraints', row?.constraints_json),
              part === 'lengthHint'
                ? (change.value.trim() || null)
                : (change.lengthHint ?? row?.length_hint ?? null),
            );
            break;
          }
        }
        // An edit answers whatever the guide had proposed for that slot, so any
        // live proposal of the same kind is marked edited rather than left
        // hanging as an unanswered offer. Only the VOICE part answers a tone
        // proposal — a proposal offers voice directives, and adding an example
        // leaves the offer open.
        for (const p of proposals) {
          const sameSlot =
            change.field === 'tone'
              ? p.kind === 'tone' &&
                (change.part ?? 'voice') === 'voice' &&
                (p.channel ?? 'generic') === (change.channel ?? 'generic')
              : p.kind === change.field;
          if (sameSlot) resolveProposal(p, 'edited');
        }
      } catch (e) {
        toastCatch('features/plugins/twin/setup/useSetupSession:edit')(e);
      }
    },
    [activeTwinId, updateTwinProfile, upsertTwinTone, proposals, resolveProposal, tones],
  );

  /**
   * Declining is a durable answer, not a no-op: the guide is told to move on
   * and never to re-ask. Nothing is written — a skipped question must not leave
   * a value behind, which is the whole difference between "no" and "blank".
   */
  const skip = useCallback(async () => {
    const { history: current, question: asked } = stateRef.current;
    if (!asked) return;
    setSuggestions([]);
    setProposals([]);
    await requestTurnRef.current(current, DECLINED_NOTE);
  }, []);

  /**
   * Move the guided flow to another slot — and ASK it something. Setting the
   * override alone (all this did until 2026-09-16) moved the readiness strip's
   * highlight over a question that still belonged to the previous slot, so the
   * strip read as a control and behaved as a label.
   */
  const focusOn = useCallback((next: SetupFocus) => {
    // A click on the slot already being worked is not a new instruction: while
    // a turn for it is in flight it would spend a second generator call on the
    // same slot, and once a question has arrived it would throw away the one
    // the user is reading.
    if (next === focusRef.current && (inFlightRef.current || stateRef.current.question !== null)) {
      return;
    }
    focusRef.current = next;
    setFocusOverride(next);
    // The cards belong to the question that is being replaced, so they go now
    // rather than when the reply lands — a suggestion for the slot the user
    // just left must not stay clickable while the next question is drafted.
    setSuggestions([]);
    setProposals([]);
    // The history is kept: the trail is how the switch stays legible.
    requestTurnRef.current(stateRef.current.history, undefined).catch(
      silentCatch('features/plugins/twin/setup/useSetupSession:focusOn'),
    );
  }, []);

  // A twin switch is a different subject: keep no transcript across it.
  useEffect(() => {
    setHistory([]);
    setQuestion(null);
    setSuggestions([]);
    setProposals([]);
    setGeneratorError(null);
    setFocusOverride(null);
  }, [activeTwinId]);

  // Open the conversation once a twin is in hand. Best-effort: a failure here
  // sets `generatorError` and the typed fields still work.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTwinId || openedFor.current === activeTwinId) return;
    openedFor.current = activeTwinId;
    // `requestTurn` reports its own failure into `generatorError`; the guard
    // here is only for a throw the try/catch could not have seen.
    requestTurnRef.current([], undefined).catch(
      silentCatch('features/plugins/twin/setup/useSetupSession:open'),
    );
  }, [activeTwinId]);

  return {
    stage,
    values,
    focus,
    checklist,
    score: readiness.score,
    question,
    suggestions,
    proposals,
    history,
    busy,
    generatorError,
    toneChannels,
    answer,
    accept,
    dismiss,
    edit,
    skip,
    focusOn,
    setStage,
    topic,
    setTopic,
  };
}
