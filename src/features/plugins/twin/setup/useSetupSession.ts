import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useSystemStore } from '@/stores/systemStore';
import { useI18nStore } from '@/stores/i18nStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch, extractMessage } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { createLatestWins } from '@/stores/util/latestWins';
import * as setupApi from '@/api/twin/twinSetup';
import type { SetupOffer } from '@/lib/bindings/SetupOffer';
import type { SetupReadiness } from '@/lib/bindings/SetupReadiness';
import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';
import type { SetupSteer } from '@/lib/bindings/SetupSteer';
import type { TwinChannelKind } from '@/api/enums';
import { deriveReadiness, type MilestoneStatus } from '../useTwinReadiness';
import { slotStatusOf } from '../shared/twinStatus';
import { TRAINING_TOPIC_PRESETS } from '../sub_training/topicPresets';
import { appendJsonItem } from './fields/toneParts';
import {
  SETUP_FOCUS_ORDER,
  type SetupChecklistItem,
  type SetupFieldEdit,
  type SetupFocus,
  type SetupHistoryEntry,
  type SetupOfferVerdict,
  type SetupOfferView,
  type SetupPlanView,
  type SetupProposal,
  type SetupSessionApi,
  type SetupStage,
  type SetupTonePart,
} from './setupContract';

/**
 * The Setup module's engine — a thin client over the PERSISTED setup session
 * (spark twin-setup-plan), plus the typed path that does the same work without
 * the guide.
 *
 * The backend owns the plan, the question queue and the reading of answers;
 * every command returns the whole `SetupSessionSnapshot`, and the background
 * engine announces its own progress with `twin-setup-updated`. This hook holds
 * that one snapshot and maps it onto `SetupSessionApi`, so every surface that
 * rendered the old client-side interview renders this one unchanged. Closing
 * the overlay or restarting the app loses nothing: reopening is one
 * `twin_setup_open`, which resumes, and never an LLM call.
 *
 * Three invariants this hook exists to hold, all of them the reason the
 * pre-v2 interview was untrustworthy:
 *
 * 1. **Readiness is the only completion authority.** The checklist, the score
 *    and the focus are derived from `deriveReadiness` over real store rows,
 *    and that reading is SENT with every mutation for the planner to plan
 *    against. Goal coverage in the plan is a steering signal only — it decides
 *    what is asked next, never whether a slot is complete.
 * 2. **A generator failure leaves the slot OPEN.** It sets `generatorError`
 *    and changes nothing else; the typed `edit()` path keeps working while the
 *    guide is down, which is why `edit` shares no code with `answer`.
 * 3. **Nothing is written until a human says so.** An offer is an offer; only
 *    `accept()` and `edit()` call a write command. The server records the
 *    verdict; the write itself stays here.
 */

/** Bio length that reads as a finished identity — mirrors `useTwinReadiness`. */
const BIO_TARGET_CHARS = 50;
/** Approved memories that read as a finished memories slot. */
const MEMORY_TARGET = 5;

const SCOPE = 'features/plugins/twin/setup/useSetupSession';

/** Stable empty list, so a missing snapshot does not re-render its readers. */
const NO_IDS: string[] = [];

/**
 * Checklist `detail` is a measured fact, and it is rendered verbatim by the
 * readiness strip and the desk buffer. It is written as `have/target` digits rather than prose so it needs
 * no translation and reads identically in all 14 locales — the alternative
 * ("62 words") would be untranslated English on a localized surface.
 */
function detailOf(have: number, target: number): string {
  return `${have}/${target}`;
}

// ---------------------------------------------------------------------------
// Narrowing the wire vocabulary. The bindings carry these as plain `string`
// (their allowed values live in doc comments), so each is narrowed once here
// rather than asserted past at every read.
// ---------------------------------------------------------------------------

function focusOf(slot: string | null | undefined): SetupFocus | null {
  return SETUP_FOCUS_ORDER.find((f) => f === slot) ?? null;
}

function stageOf(snapshot: SetupSessionSnapshot): SetupStage {
  return snapshot.stage === 'training' ? 'training' : 'setup';
}

function verdictOf(status: string): SetupOfferVerdict | null {
  return status === 'accepted' || status === 'edited' || status === 'dismissed' ? status : null;
}

/** An offer as the table's `SetupProposal`, or null for a kind it cannot write. */
function proposalOf(offer: SetupOffer): SetupProposal | null {
  const kind = offer.kind === 'bio' || offer.kind === 'role' || offer.kind === 'tone' ? offer.kind : null;
  if (!kind) return null;
  const part =
    offer.part === 'voice' || offer.part === 'examples' || offer.part === 'constraints' ? offer.part : null;
  return {
    id: offer.id,
    kind,
    part,
    channel: offer.channel,
    value: offer.value,
    lengthHint: offer.lengthHint,
    reason: offer.reason,
  };
}

function offerViewsOf(snapshot: SetupSessionSnapshot): Array<SetupOfferView & { stepId: string }> {
  const out: Array<SetupOfferView & { stepId: string }> = [];
  for (const offer of snapshot.offers) {
    const proposal = proposalOf(offer);
    if (proposal) out.push({ proposal, resolution: verdictOf(offer.status), stepId: offer.stepId });
  }
  return out;
}

/**
 * The transcript as the trail reads it: an answered step is a guide line and a
 * user line; a declined one is a guide line with nothing after it (the trail
 * shows it as skipped); the live question is the LAST guide line, which the
 * trail drops because the dealer card is showing it. Each offer is stamped on
 * the guide line of the step it came from, wearing its verdict when it has
 * one; an offer whose step has scrolled out of the transcript rides on the
 * live line so it is never lost.
 */
function historyOf(snapshot: SetupSessionSnapshot, offers: Array<SetupOfferView & { stepId: string }>): SetupHistoryEntry[] {
  const byStep = new Map<string, Array<SetupOfferView>>();
  for (const view of offers) {
    const bucket = byStep.get(view.stepId);
    if (bucket) bucket.push(view);
    else byStep.set(view.stepId, [view]);
  }
  const stamp = (views: SetupOfferView[] | undefined): Partial<SetupHistoryEntry> => {
    if (!views || views.length === 0) return {};
    const resolutions: Record<string, SetupOfferVerdict> = {};
    for (const v of views) if (v.resolution) resolutions[v.proposal.id] = v.resolution;
    return {
      proposals: views.map((v) => v.proposal),
      ...(Object.keys(resolutions).length > 0 ? { resolutions } : {}),
    };
  };

  const entries: SetupHistoryEntry[] = [];
  for (const step of snapshot.transcript) {
    entries.push({ id: `g-${step.id}`, role: 'guide', text: step.question, ...stamp(byStep.get(step.id)) });
    byStep.delete(step.id);
    if (step.status === 'answered' && step.answer !== null) {
      entries.push({ id: `u-${step.id}`, role: 'user', text: step.answer });
    }
  }
  const live = snapshot.live;
  if (live) {
    const orphans = [...(byStep.get(live.id) ?? [])];
    byStep.delete(live.id);
    for (const rest of byStep.values()) orphans.push(...rest);
    entries.push({ id: `g-${live.id}`, role: 'guide', text: live.question, ...stamp(orphans) });
  }
  return entries;
}

function planOf(snapshot: SetupSessionSnapshot): SetupPlanView {
  const status = snapshot.planStatus === 'ready' || snapshot.planStatus === 'failed' ? snapshot.planStatus : 'building';
  return {
    status,
    version: snapshot.planVersion,
    error: snapshot.planError,
    changeNote: snapshot.changeNote,
    goals: snapshot.goals,
    upcoming: snapshot.upcoming,
    observations: snapshot.observations,
  };
}

interface MutateOptions {
  /** A failure here is the GUIDE failing: it sets `generatorError`. */
  guide: boolean;
  /** Re-checked when the call's turn in the queue comes; false skips it. */
  when?: () => boolean;
}

export function useSetupSession(): SetupSessionApi {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const twinTones = useSystemStore((s) => s.twinTones);
  const twinChannels = useSystemStore((s) => s.twinChannels);
  const twinReadinessApproved = useSystemStore((s) => s.twinReadinessApproved);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const upsertTwinTone = useSystemStore((s) => s.upsertTwinTone);
  const pendingTrainingQuestions = useSystemStore((s) => s.pendingTrainingQuestions);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);
  const { t } = useTranslation();
  // The guide asks in the app's language; the answers it offers stay in the
  // twin's own. Read through a ref, so a language switch does not rebuild
  // every callback that depends on it.
  const locale = useI18nStore((s) => s.language);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const openersRef = useRef(t.twin.experience.openers);
  openersRef.current = t.twin.experience.openers;
  const activeTwinRef = useRef(activeTwinId);
  activeTwinRef.current = activeTwinId;

  /** The ONE piece of server state. Replaced whole, never merged. */
  const [snapshot, setSnapshot] = useState<SetupSessionSnapshot | null>(null);
  const snapshotRef = useRef<SetupSessionSnapshot | null>(null);
  /** The last mutation's failure, resolved to a friendly message. */
  const [mutationError, setMutationError] = useState<string | null>(null);
  /**
   * The stage an entry point asked for before the snapshot existed. It picks
   * the opener (none for a training round) and is steered to once the open
   * returns, so "Start a training round" lands on training even though the
   * stored stage is only known after the first reply.
   */
  const [stageIntent, setStageIntent] = useState<SetupStage | null>(null);
  const stageIntentRef = useRef<SetupStage | null>(null);

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
    // A register with a tone row and no bound channel behind it: one the
    // person named in conversation ("I mostly write email") and accepted.
    // Leaving it out would hide a row they own from the surface that edits it.
    for (const t of tones) {
      const channel = t.channel?.trim();
      if (channel) seen.add(channel);
    }
    return [...seen];
  }, [channels, tones]);

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

  /** The readiness reading every mutation carries to the planner. */
  const wireReadiness = useMemo<SetupReadiness>(() => {
    const of = (slot: SetupFocus) => checklist.find((c) => c.id === slot)?.status ?? 'empty';
    return { identity: of('identity'), tone: of('tone'), channels: of('channels'), memories: of('memories') };
  }, [checklist]);
  const readinessRef = useRef(wireReadiness);
  readinessRef.current = wireReadiness;

  /**
   * The first slot readiness still calls incomplete. The plan may point the
   * table somewhere else (`focusSlot`, set by the person or the planner), but
   * with no plan yet this is where the opener asks.
   */
  const derivedFocus = useMemo<SetupFocus>(() => {
    const incomplete = checklist.find((item) => item.status !== 'set');
    return incomplete?.id ?? 'memories';
  }, [checklist]);
  const focus = focusOf(snapshot?.focusSlot) ?? derivedFocus;
  const focusRef = useRef<SetupFocus>(focus);
  focusRef.current = focus;

  // -------------------------------------------------------------------------
  // Talking to the backend.
  //
  // Mutations are SERIALISED on one promise chain, so an answer, a steer and a
  // verdict reach the engine in the order the person made them, and the
  // chain for a twin starts behind that twin's open (the gate). Background
  // updates arrive as `twin-setup-updated` and are refetched through a
  // latest-wins guard; a refetch that overlaps a mutation is dropped and owed
  // until the mutation lands, because a read that raced a write can be older
  // than the write's own reply.
  // -------------------------------------------------------------------------

  const getWins = useRef(createLatestWins()).current;
  const getInFlightRef = useRef(0);
  const mutatingRef = useRef(0);
  const refetchOwedRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const gateRef = useRef<{ twinId: string; release: () => void } | null>(null);

  const apply = useCallback((next: SetupSessionSnapshot) => {
    if (next.twinId !== activeTwinRef.current) return;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const refetch = useCallback(async () => {
    const twinId = activeTwinRef.current;
    if (!twinId) return;
    if (mutatingRef.current > 0) {
      refetchOwedRef.current = true;
      return;
    }
    const token = getWins.next();
    getInFlightRef.current = token;
    try {
      const next = await setupApi.setupGet(twinId);
      if (getWins.isCurrent(token)) apply(next);
    } catch (e) {
      if (getWins.isCurrent(token)) silentCatch(`${SCOPE}:refetch`)(e);
    } finally {
      if (getInFlightRef.current === token) getInFlightRef.current = 0;
    }
  }, [apply, getWins]);

  /** One mutation, unqueued. Every snapshot-returning command goes through it. */
  const runMutation = useCallback(
    async (
      twinId: string,
      scope: string,
      call: (twinId: string) => Promise<SetupSessionSnapshot>,
      opts: MutateOptions,
    ) => {
      if (activeTwinRef.current !== twinId) return;
      if (opts.when && !opts.when()) return;
      mutatingRef.current += 1;
      // A read already in flight may predate this write: drop it, owe a fresh one.
      if (getInFlightRef.current !== 0) {
        refetchOwedRef.current = true;
        getInFlightRef.current = 0;
      }
      getWins.next();
      try {
        apply(await call(twinId));
        if (opts.guide && activeTwinRef.current === twinId) setMutationError(null);
      } catch (e) {
        // Reported, never absorbed: the slot stays exactly as incomplete as it
        // was, and the typed form remains the way forward.
        toastCatch(`${SCOPE}:${scope}`)(e);
        if (opts.guide && activeTwinRef.current === twinId) {
          setMutationError(resolveError(extractMessage(e)).message);
        }
      } finally {
        mutatingRef.current -= 1;
        if (mutatingRef.current === 0 && refetchOwedRef.current) {
          refetchOwedRef.current = false;
          void refetch();
        }
      }
    },
    [apply, getWins, refetch],
  );

  /** Queue a mutation for the active twin, behind its open and every earlier one. */
  const mutate = useCallback(
    (
      scope: string,
      call: (twinId: string) => Promise<SetupSessionSnapshot>,
      opts: MutateOptions = { guide: true },
    ): Promise<void> => {
      const twinId = activeTwinRef.current;
      if (!twinId) return Promise.resolve();
      const run = chainRef.current.then(() => runMutation(twinId, scope, call, opts));
      chainRef.current = run;
      return run;
    },
    [runMutation],
  );

  const steerWith = useCallback(
    (scope: string, steer: SetupSteer, opts?: MutateOptions) =>
      mutate(scope, (id) => setupApi.setupSteer(id, steer, readinessRef.current, localeRef.current), opts),
    [mutate],
  );

  /** Open (or resume) the session. Costs no generation when a session exists. */
  const openSession = useCallback(
    async (twinId: string) => {
      await runMutation(
        twinId,
        'open',
        (id) => {
          // A training round opens on the queue; only setup has an opener.
          const slot = focusRef.current;
          const opener =
            (stageIntentRef.current ?? 'setup') === 'setup'
              ? { slot, question: openersRef.current[slot] }
              : null;
          return setupApi.setupOpen(id, readinessRef.current, localeRef.current, opener);
        },
        { guide: true },
      );
      const intent = stageIntentRef.current;
      await runMutation(
        twinId,
        'openStage',
        (id) =>
          setupApi.setupSteer(
            id,
            { action: 'setStage', stage: intent ?? 'setup' },
            readinessRef.current,
            localeRef.current,
          ),
        { guide: true, when: () => intent !== null && snapshotRef.current !== null && stageOf(snapshotRef.current) !== intent },
      );
    },
    [runMutation],
  );
  const openRef = useRef(openSession);
  openRef.current = openSession;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Subscribe FIRST, then open: anything the engine announces after the
  // listener is live triggers a refetch, and anything before it is already in
  // the snapshot the open returns — there is no window between the two.
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    // A twin switch is a different subject: keep nothing across it.
    snapshotRef.current = null;
    setSnapshot(null);
    setMutationError(null);
    if (gateRef.current && gateRef.current.twinId !== activeTwinId) {
      // Let the old twin's queue drain; every link skips on the twin check.
      gateRef.current.release();
      gateRef.current = null;
      stageIntentRef.current = null;
      setStageIntent(null);
    }
    if (!activeTwinId) return;
    const twinId = activeTwinId;
    if (!gateRef.current) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      gateRef.current = { twinId, release };
      chainRef.current = gate;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    typedListen(EventName.TWIN_SETUP_UPDATED, (payload) => {
      if (cancelled || payload.twinId !== twinId) return;
      void refetchRef.current();
    })
      .catch((e: unknown) => {
        // No live updates is a degraded table, not a dead one: open anyway.
        silentCatch(`${SCOPE}:listen`)(e);
        return undefined;
      })
      .then((fn) => {
        if (cancelled) {
          fn?.();
          return;
        }
        unlisten = fn;
        if (openedForRef.current === twinId) {
          void refetchRef.current();
          return;
        }
        openedForRef.current = twinId;
        void openRef.current(twinId).finally(() => {
          if (gateRef.current?.twinId === twinId) gateRef.current.release();
        });
      })
      .catch(silentCatch(`${SCOPE}:open`));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeTwinId]);

  // Consume the Hub's dig-deeper handoff: the questions join the plan's queue,
  // asked verbatim. Cleared immediately so returning to the tab does not
  // replay the same prefill.
  useEffect(() => {
    if (!pendingTrainingQuestions || pendingTrainingQuestions.length === 0) return;
    const questions = pendingTrainingQuestions.slice(0, 5);
    setPendingTrainingQuestions(null);
    void steerWith('handoff', { action: 'enqueueHandoff', questions });
  }, [pendingTrainingQuestions, setPendingTrainingQuestions, steerWith]);

  // -------------------------------------------------------------------------
  // The snapshot, as the table reads it.
  // -------------------------------------------------------------------------

  const live = snapshot?.live ?? null;
  const write = live?.answerMode === 'write';
  const offerViews = useMemo(() => (snapshot ? offerViewsOf(snapshot) : []), [snapshot]);
  const offerRecord = useMemo<SetupOfferView[]>(
    () => offerViews.map(({ proposal, resolution }) => ({ proposal, resolution })),
    [offerViews],
  );
  const proposals = useMemo(
    () => offerViews.filter((v) => v.resolution === null).map((v) => v.proposal),
    [offerViews],
  );
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const history = useMemo(() => (snapshot ? historyOf(snapshot, offerViews) : []), [snapshot, offerViews]);
  const plan = useMemo(() => (snapshot ? planOf(snapshot) : null), [snapshot]);
  const planning = snapshot?.planning ?? false;
  const reconciling = snapshot?.reconciling ?? false;
  const stage: SetupStage = snapshot ? stageOf(snapshot) : (stageIntent ?? 'setup');
  const topicPreset = snapshot?.topicPreset ?? null;
  const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === topicPreset);
  const topic = preset ? t.twin.training[preset.promptKey] : null;
  // The first open is a load like any other: the card ghosts until it lands.
  const awaitingFirst = activeTwinId !== null && snapshot === null && mutationError === null;
  const busy = !live && (planning || reconciling || awaitingFirst);

  const planFailure = snapshot && snapshot.planStatus === 'failed' && !live ? (snapshot.planError ?? '') : null;
  const planFailureMessage = useMemo(
    () => (planFailure === null ? null : resolveError(planFailure || null).message),
    [planFailure],
  );
  const generatorError = mutationError ?? planFailureMessage;

  // -------------------------------------------------------------------------
  // Actions.
  // -------------------------------------------------------------------------

  const answer = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      // The step the person is looking at. The server accepts an answer only
      // for the LIVE step id, so a stale second press is a no-op there too.
      const step = snapshotRef.current?.live;
      if (!trimmed || !step) return;
      await mutate('answer', (id) =>
        setupApi.setupAnswer(id, step.id, trimmed, readinessRef.current, localeRef.current),
      );
    },
    [mutate],
  );

  /**
   * Declining is a durable answer, not a no-op: the step is recorded as
   * skipped and never asked again. Nothing is written — a skipped question
   * must not leave a value behind, which is the whole difference between "no"
   * and "blank".
   */
  const skip = useCallback(async () => {
    const step = snapshotRef.current?.live;
    if (!step) return;
    await mutate('skip', (id) => setupApi.setupAnswer(id, step.id, null, readinessRef.current, localeRef.current));
  }, [mutate]);

  /** Record a verdict. A failure is a toast, not a guide outage. */
  const verdict = useCallback(
    (proposal: SetupProposal, value: SetupOfferVerdict) =>
      mutate('verdict', (id) => setupApi.setupOfferVerdict(id, proposal.id, value), { guide: false }),
    [mutate],
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
          const part = proposal.part ?? 'voice';
          if (part === 'voice') {
            await upsertTwinTone(
              activeTwinId,
              // INVARIANT: any BOUND channel type is a legal tone channel.
              // `twin_upsert_tone` stores the channel verbatim and does not
              // constrain it to `TwinChannelKind`; the union is the well-known
              // subset, not the allowed set. The value is either 'generic', a
              // `twin_channels.channel_type` the user created, or a register
              // the guide named from their own answer ("email").
              channel as TwinChannelKind,
              proposal.value,
              // A voice proposal offers VOICE DIRECTIVES. The row is written
              // whole, so the examples and constraints the user typed are
              // carried over; accepting an offer must not empty the parts it
              // says nothing about.
              row?.examples_json ?? null,
              row?.constraints_json ?? null,
              proposal.lengthHint ?? row?.length_hint ?? null,
            );
          } else {
            // A sample or a rule is ONE more item on its list, never a
            // replacement for the list; the other three parts travel over.
            const examples =
              part === 'examples'
                ? appendJsonItem(row?.examples_json, proposal.value)
                : (row?.examples_json ?? null);
            const constraints =
              part === 'constraints'
                ? appendJsonItem(row?.constraints_json, proposal.value)
                : (row?.constraints_json ?? null);
            await upsertTwinTone(
              activeTwinId,
              // INVARIANT: as above — a legal tone channel, stored verbatim.
              channel as TwinChannelKind,
              row?.voice_directives ?? '',
              examples,
              constraints,
              row?.length_hint ?? null,
            );
          }
        }
      } catch (e) {
        toastCatch(`${SCOPE}:accept`)(e);
        return;
      }
      await verdict(proposal, 'accepted');
    },
    [activeTwinId, updateTwinProfile, upsertTwinTone, tones, verdict],
  );

  const dismiss = useCallback(
    (proposal: SetupProposal) => {
      void verdict(proposal, 'dismissed');
    },
    [verdict],
  );

  const editOffer = useCallback((proposal: SetupProposal) => verdict(proposal, 'edited'), [verdict]);

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
      } catch (e) {
        toastCatch(`${SCOPE}:edit`)(e);
        return;
      }
      // An edit answers whatever the guide had offered for that slot, so any
      // open offer of the same kind is marked edited rather than left hanging
      // as an unanswered offer. A tone edit answers only an offer for the SAME
      // part of the same channel: typing a voice directive leaves an offered
      // rule open, and adding an example leaves an offered voice open.
      for (const p of proposalsRef.current) {
        const sameSlot =
          change.field === 'tone'
            ? p.kind === 'tone' &&
              (change.part ?? 'voice') === (p.part ?? 'voice') &&
              (p.channel ?? 'generic') === (change.channel ?? 'generic')
            : p.kind === change.field;
        if (sameSlot) await verdict(p, 'edited');
      }
    },
    [activeTwinId, updateTwinProfile, upsertTwinTone, tones, verdict],
  );

  /**
   * A fresh set of questions on whatever is being worked now, replacing the
   * live one. With no snapshot at all (the open itself failed) the only thing
   * worth retrying is the open.
   */
  const redeal = useCallback(() => {
    const twinId = activeTwinRef.current;
    if (twinId && snapshotRef.current === null) {
      void mutate('reopen', (id) =>
        setupApi.setupOpen(id, readinessRef.current, localeRef.current, null),
      );
      return;
    }
    void steerWith('redeal', { action: 'redeal' });
  }, [mutate, steerWith]);

  /**
   * Point the table at another slot. A click on the slot already being worked
   * while it has a question on the table is not a new instruction — it would
   * throw away the question the person is reading.
   */
  const focusOn = useCallback(
    (next: SetupFocus) => {
      if (next === focusRef.current && snapshotRef.current?.live) return;
      void steerWith('focusOn', { action: 'focusSlot', slot: next });
    },
    [steerWith],
  );

  /**
   * Move to another stage. The comparison is made against the STORED stage
   * when the call's turn comes, not against whatever this render shows — so a
   * request made before the first snapshot is kept as the intent and applied
   * by the open instead of being dropped as "already there".
   */
  const setStage = useCallback(
    (next: SetupStage) => {
      stageIntentRef.current = next;
      setStageIntent(next);
      void steerWith(
        'setStage',
        { action: 'setStage', stage: next },
        { guide: true, when: () => snapshotRef.current !== null && stageOf(snapshotRef.current) !== next },
      );
    },
    [steerWith],
  );

  const setTopic = useCallback(
    (prompt: string | null, presetId?: string | null) => {
      void steerWith('setTopic', { action: 'setTopic', presetId: presetId ?? null, prompt });
    },
    [steerWith],
  );

  const steer = useCallback((s: SetupSteer) => steerWith('steer', s), [steerWith]);

  const rebuild = useCallback(
    () => mutate('rebuild', (id) => setupApi.setupRebuild(id, readinessRef.current, localeRef.current)),
    [mutate],
  );

  return {
    stage,
    values,
    focus,
    checklist,
    score: readiness.score,
    question: live?.question ?? null,
    answerMode: write ? 'write' : 'pick',
    incoming: write ? (live?.incoming ?? null) : null,
    toneChannel: live?.toneChannel ?? null,
    // A `write` step deals no cards by contract: its answer is a sample.
    suggestions: live && !write ? live.suggestions : [],
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
    redeal,
    focusOn,
    setStage,
    topic,
    topicPreset,
    setTopic,
    plan,
    planning,
    reconciling,
    lastAnswerOfferIds: snapshot?.lastAnswerOfferIds ?? NO_IDS,
    offerRecord,
    editOffer,
    steer,
    rebuild,
  };
}
