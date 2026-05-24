import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  Bot,
  Infinity as InfinityIcon,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useCompanionStore } from './companionStore';
import { Bubble } from './Bubble';
import { Composer } from './Composer';
import { QuickReplies } from './QuickReplies';
import {
  extractAssistantText,
  extractAssistantTextDelta,
} from './extractAssistantText';
import { extractStreamPhase, phaseLabel } from './extractStreamPhase';
import { extractTodoWrite } from './operationalSteps';
import { OperationalThread } from './OperationalThread';
import {
  COMPANION_APPROVALS_EVENT,
  COMPANION_CHAT_CARDS_EVENT,
  COMPANION_COMPOSE_COCKPIT_EVENT,
  COMPANION_COMPOSE_DASHBOARD_EVENT,
  COMPANION_NAVIGATE_EVENT,
  type ChatCard,
  type CompanionChatCardsEvent,
  COMPANION_JOB_EVENT,
  COMPANION_OPEN_LAB_EVENT,
  COMPANION_PROACTIVE_EVENT,
  COMPANION_RECALL_PREVIEW_EVENT,
  COMPANION_STREAM_EVENT,
  COMPANION_TURN_SUMMARY_EVENT,
  companionListPendingApprovals,
  companionListProactiveMessages,
  companionListRecentMessages,
  companionBetaFlags,
  companionCancelAutonomy,
  companionInterruptTurn,
  companionReingestDoctrine,
  companionRequestImprovement,
  companionResetConversation,
  companionSendMessage,
  type BackgroundJob,
  type BrainKind,
  type CompanionRecallPreviewEvent,
  type CompanionStreamEvent,
  type CompanionTurnSummaryEvent,
  type CreatedApproval,
  type OpenLabEvent,
  type ProactiveDeliveryEvent,
} from '@/api/companion';
import type { SidebarSection } from '@/lib/types/types';
import { ApprovalCard } from './ApprovalCard';
import { McpRequestPanel } from './mcp/McpRequestPanel';
import { LiveOpsStrip } from './orchestration/LiveOpsStrip';
import { InlineChatCard } from './InlineChatCard';
import { CompanionAssignmentCards } from './CompanionAssignmentCards';
import { useCompanionAssignmentBridge } from './useCompanionAssignmentBridge';
import { ProactiveCard } from './ProactiveCard';
import { AthenaAvatar } from './AthenaAvatar';
import { BrainViewer } from './BrainViewer';
import { CompanionToolbar } from './CompanionToolbar';
import { ConnectorCallCard } from './ConnectorCallCard';
import { RecallStrip } from './RecallStrip';
import { RefineChips } from './RefineChips';
import { BubbleReadAloud } from './BubbleReadAloud';
import { TurnSummaryChip } from './TurnSummaryChip';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { play as playAudio, synthesize as synthesizeTts } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';
import { useAgentStore } from '@/stores/agentStore';

// Fallback follow-ups for the "What can Athena do?" toolbar preset —
// only used when the turn returns no QR chips, so this preset is never
// a dead-end. Each entry is the literal user message that will be sent
// on click (first-person voice, matching Athena's QR contract).
const CAPABILITY_FALLBACK_REPLIES: string[] = [
  'Show me what you know about my agents',
  'Walk me through recent execution failures',
  'List my pending Human Reviews',
  'Read back what you remember about me',
];

// Mirrors the backend `ALLOWED_ROUTES` allow-list in
// src-tauri/src/companion/dispatcher.rs. Defensive: backend already
// filtered, but a stale frontend or future-protocol mismatch shouldn't
// throw the sidebar into an unknown state.
const VALID_NAV_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
];

/**
 * Athena's chat panel — Phase 1: real chat over a long-lived Claude CLI
 * session. Composer + transcript + streaming bubble. Subscribes to
 * `companion://stream` Tauri events and accumulates assistant text live.
 */
export default function CompanionPanel() {
  const { t } = useTranslation();
  // Phase C2 — global TEAM_ASSIGNMENT_PROGRESS listener that populates
  // the chat-side assignment cards above messages.
  useCompanionAssignmentBridge();
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const initialized = useCompanionStore((s) => s.initialized);
  const initError = useCompanionStore((s) => s.initError);

  const messages = useCompanionStore((s) => s.messages);
  const streaming = useCompanionStore((s) => s.streaming);
  const streamingText = useCompanionStore((s) => s.streamingText);
  const sendError = useCompanionStore((s) => s.sendError);
  const approvals = useCompanionStore((s) => s.approvals);
  const proactive = useCompanionStore((s) => s.proactive);
  const quickReplies = useCompanionStore((s) => s.quickReplies);
  const brainView = useCompanionStore((s) => s.brainView);
  const betaSelfImprove = useCompanionStore((s) => s.betaSelfImprove);
  const improving = useCompanionStore((s) => s.improving);
  // Speaking state: TTS audio synthesized AND not yet finished. Until
  // a `speaking` clip ships, the avatar falls back to the idle loop —
  // the `speaking` value is the signal carrier, not the visual.
  const isSpeaking = useCompanionStore(
    (s) => !!s.pendingPlayback?.audioUrl && !s.pendingPlayback.played,
  );

  const setMessages = useCompanionStore((s) => s.setMessages);
  const appendMessage = useCompanionStore((s) => s.appendMessage);
  const setStreaming = useCompanionStore((s) => s.setStreaming);
  const appendStreamingText = useCompanionStore((s) => s.appendStreamingText);
  const resetStreamingText = useCompanionStore((s) => s.resetStreamingText);
  const setSendError = useCompanionStore((s) => s.setSendError);
  const setApprovals = useCompanionStore((s) => s.setApprovals);
  const removeApproval = useCompanionStore((s) => s.removeApproval);
  const setProactive = useCompanionStore((s) => s.setProactive);
  const appendProactive = useCompanionStore((s) => s.appendProactive);
  const removeProactive = useCompanionStore((s) => s.removeProactive);
  const setQuickReplies = useCompanionStore((s) => s.setQuickReplies);
  const chatCards = useCompanionStore((s) => s.chatCards);
  const setChatCards = useCompanionStore((s) => s.setChatCards);
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const setBetaSelfImprove = useCompanionStore((s) => s.setBetaSelfImprove);
  const setImproving = useCompanionStore((s) => s.setImproving);
  const setPendingPlayback = useCompanionStore((s) => s.setPendingPlayback);
  const setPlaybackAudioUrl = useCompanionStore((s) => s.setPlaybackAudioUrl);
  const markPlaybackPlayed = useCompanionStore((s) => s.markPlaybackPlayed);

  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const voiceEngine = useSystemStore((s) => s.companionVoiceEngine);
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const voiceSettings = useTtsSettings();
  const recallSynthesisEnabled = useSystemStore((s) => s.companionRecallSynthesisEnabled);
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);
  const setAutonomousMode = useSystemStore((s) => s.setCompanionAutonomousMode);
  const panelCompact = useSystemStore((s) => s.companionPanelCompact);
  const setPanelCompact = useSystemStore((s) => s.setCompanionPanelCompact);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const orbOpenOrigin = useCompanionStore((s) => s.orbOpenOrigin);
  const reduceMotion = useReducedMotion();

  const isOpen = state === 'open';

  // Fetch the beta flag once on first panel mount. Cheap, returns a
  // single bool. Decides whether the wrench-send button is rendered.
  useEffect(() => {
    companionBetaFlags()
      .then((f) => setBetaSelfImprove(f.selfImproveEnabled))
      .catch(silentCatch('companion_beta_flags'));
  }, [setBetaSelfImprove]);

  // Orb → panel morph. The panel is anchored bottom-left (`left-4 bottom-12`),
  // so its bottom-left corner sits at screen (16, vh-48) regardless of the
  // panel's height. Pinning `transformOrigin` to that corner lets us fly +
  // scale the panel out of the orb's recorded center for an "orb expands
  // into chat" feel (and collapse back toward it on close). Falls back to a
  // plain fade/scale when there's no orb origin, or to opacity-only under
  // `prefers-reduced-motion`.
  const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];
  const morph = (() => {
    if (reduceMotion) {
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
        style: undefined,
      };
    }
    if (orbOpenOrigin) {
      const dx = orbOpenOrigin.x - 16;
      const dy = orbOpenOrigin.y - (window.innerHeight - 48);
      return {
        initial: { opacity: 0, scale: 0.18, x: dx, y: dy },
        animate: { opacity: 1, scale: 1, x: 0, y: 0 },
        exit: { opacity: 0, scale: 0.18, x: dx, y: dy },
        transition: { duration: 0.28, ease },
        style: { transformOrigin: 'bottom left' },
      };
    }
    return {
      initial: { opacity: 0, y: 12, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: 8, scale: 0.98 },
      transition: { duration: 0.18, ease },
      style: undefined,
    };
  })();

  return (
    <AnimatePresence
      onExitComplete={() => useCompanionStore.getState().setOrbOpenOrigin(null)}
    >
      {isOpen && (
        <motion.div
          key="companion-panel"
          initial={morph.initial}
          animate={morph.animate}
          exit={morph.exit}
          transition={morph.transition}
          style={morph.style}
          className={`fixed bottom-12 left-4 z-[60] ${
            panelCompact ? 'w-[380px]' : 'w-[760px]'
          } h-[900px] max-h-[calc(100vh-5rem)] flex flex-col rounded-card bg-secondary/95 backdrop-blur-md border border-foreground/10 shadow-elevation-4 overflow-hidden transition-[width] duration-200 ease-out`}
          role="region"
          aria-label={t.plugins.companion.panel_label}
          data-testid="companion-panel"
          data-companion-streaming={streaming ? 'true' : 'false'}
        >
          {/*
            Faint background portrait sits behind everything as a
            watermark — semi-transparent so it doesn't fight the
            messages. pointer-events-none so it never steals clicks.
            -z-10 keeps it below the static flex children but above the
            panel's bg-secondary/95 fill, so the image is visible
            through the tinted background.
          */}
          {/*
            Watermark layer: the avatar fills the panel at low opacity
            and behaves as a living wallpaper. Its first frame (poster)
            is athena_baseline.jpg, so the visual chain is continuous
            from "static still" → "idle loop" → "thinking loop".
          */}
          <AthenaAvatar
            fill
            state={isSpeaking ? 'speaking' : streaming ? 'thinking' : 'idle'}
            className="absolute inset-0 -z-10 opacity-[0.05]"
          />
          <Header
            onClose={() => setState(orbEnabled ? 'minimized' : 'collapsed')}
            onReset={async () => {
              // Clear UI state immediately so the wipe feels instant.
              // Backend wipes both the SQL transcript AND the CLI session
              // pointer (wipeTranscript=true), so when the user hits send
              // next, the prompt-builder sees an empty transcript and
              // (if identity.md is still placeholder-shaped) re-enters
              // onboarding mode.
              setMessages([]);
              setApprovals([]);
              setQuickReplies([]);
              setChatCards([]);
              setPendingPlayback(null);
              // Reset is the user's "make this go away" button — make
              // sure the prior turn's error chip vanishes too. Without
              // this, a timeout error from a stuck CLI lingers across
              // sessions.
              setSendError(null);
              useCompanionStore.getState().clearAllRecall();
              useCompanionStore.getState().clearAllTurnSummaries();
              useCompanionStore.getState().clearAllConnectorJobs();
              useCompanionStore.getState().clearAllSteps();
              try {
                await companionResetConversation(true);
              } catch (err: unknown) {
                // Refetch so UI reflects whatever stuck on the backend.
                companionListRecentMessages(50)
                  .then((msgs) => setMessages(msgs))
                  .catch(silentCatch('companion_list_recent_messages'));
                silentCatch('companion_reset_conversation')(err);
              }
            }}
            onRefreshDoctrine={async () => {
              const addToast = useToastStore.getState().addToast;
              try {
                const summary = await companionReingestDoctrine();
                const changed =
                  summary.chunksInserted +
                  summary.chunksUpdated +
                  summary.chunksDeleted;
                addToast(
                  changed === 0
                    ? t.plugins.companion.doctrine_up_to_date
                    : `${t.plugins.companion.doctrine_refreshed} (+${summary.chunksInserted} / ~${summary.chunksUpdated} / -${summary.chunksDeleted})`,
                  'success',
                );
              } catch (err: unknown) {
                addToast(
                  `${t.plugins.companion.doctrine_refresh_failed}: ${err instanceof Error ? err.message : String(err)}`,
                  'error',
                );
                silentCatch('companion_reingest_doctrine')(err);
              }
            }}
            compact={panelCompact}
            onToggleCompact={() => setPanelCompact(!panelCompact)}
            autonomousMode={autonomousMode}
            onToggleAutonomousMode={() => {
              const next = !autonomousMode;
              setAutonomousMode(next);
              if (!next) {
                // Switching OFF: drop any scheduled continuation so a
                // tick that was about to fire doesn't sneak through
                // after the user explicitly opted out.
                companionCancelAutonomy().catch(
                  silentCatch('companion_cancel_autonomy'),
                );
              }
            }}
          />
          <Body
            initialized={initialized}
            initError={initError}
            messages={messages}
            streaming={streaming}
            streamingText={streamingText}
            sendError={sendError}
            approvals={approvals}
            proactive={proactive}
            quickReplies={quickReplies}
            chatCards={chatCards}
            brainView={brainView}
            betaSelfImprove={betaSelfImprove}
            improving={improving}
            voiceEnabled={voiceEnabled}
            voiceEngine={voiceEngine}
            voiceCredentialId={voiceCredentialId}
            voiceId={voiceId}
            piperVoiceId={piperVoiceId}
            voiceSettings={voiceSettings}
            recallSynthesisEnabled={recallSynthesisEnabled}
            autonomousMode={autonomousMode}
            setMessages={setMessages}
            appendMessage={appendMessage}
            setStreaming={setStreaming}
            appendStreamingText={appendStreamingText}
            resetStreamingText={resetStreamingText}
            setSendError={setSendError}
            setApprovals={setApprovals}
            removeApproval={removeApproval}
            setProactive={setProactive}
            appendProactive={appendProactive}
            removeProactive={removeProactive}
            setQuickReplies={setQuickReplies}
            setChatCards={setChatCards}
            setBrainView={setBrainView}
            setImproving={setImproving}
            setPendingPlayback={setPendingPlayback}
            setPlaybackAudioUrl={setPlaybackAudioUrl}
            markPlaybackPlayed={markPlaybackPlayed}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  onClose,
  onReset,
  onRefreshDoctrine,
  compact,
  onToggleCompact,
  autonomousMode,
  onToggleAutonomousMode,
}: {
  onClose: () => void;
  onReset: () => void;
  onRefreshDoctrine: () => void;
  compact: boolean;
  onToggleCompact: () => void;
  autonomousMode: boolean;
  onToggleAutonomousMode: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-foreground/10 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {/*
          Header keeps a small static badge — the full Athena avatar now
          lives behind the chat as a watermark, so duplicating the video
          here would be visual noise.
        */}
        <span
          className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-primary/15 text-primary"
          aria-hidden
        >
          <Bot className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <div className="typo-body font-medium leading-tight truncate">
            {t.plugins.companion.name}
          </div>
          <div className="typo-caption text-foreground leading-tight truncate">
            {t.plugins.companion.role}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleAutonomousMode}
          data-testid="companion-toggle-autonomous"
          aria-pressed={autonomousMode}
          className={`p-1.5 rounded-interactive transition-colors focus-ring ${
            autonomousMode
              ? 'bg-primary/15 text-primary hover:bg-primary/20'
              : 'text-foreground hover:text-foreground hover:bg-foreground/5'
          }`}
          aria-label={
            autonomousMode
              ? t.plugins.companion.autonomous_toggle_off
              : t.plugins.companion.autonomous_toggle_on
          }
          title={
            autonomousMode
              ? t.plugins.companion.autonomous_toggle_off
              : t.plugins.companion.autonomous_toggle_on
          }
        >
          <InfinityIcon className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleCompact}
          data-testid="companion-toggle-compact"
          aria-pressed={compact}
          className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={
            compact
              ? t.plugins.companion.compact_toggle_expand
              : t.plugins.companion.compact_toggle_collapse
          }
          title={
            compact
              ? t.plugins.companion.compact_toggle_expand
              : t.plugins.companion.compact_toggle_collapse
          }
        >
          {compact ? (
            <PanelRightOpen className="w-4 h-4" />
          ) : (
            <PanelRightClose className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={onRefreshDoctrine}
          className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.plugins.companion.refresh_doctrine}
          title={t.plugins.companion.refresh_doctrine}
        >
          <BookOpen className="w-4 h-4" />
        </button>
        <button
          onClick={onReset}
          data-testid="companion-reset"
          className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.plugins.companion.reset}
          title={t.plugins.companion.reset}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          data-testid="companion-close"
          className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

interface BodyProps {
  initialized: boolean;
  initError: string | null;
  messages: ReturnType<typeof useCompanionStore.getState>['messages'];
  streaming: boolean;
  streamingText: string;
  sendError: string | null;
  approvals: ReturnType<typeof useCompanionStore.getState>['approvals'];
  proactive: ReturnType<typeof useCompanionStore.getState>['proactive'];
  quickReplies: string[];
  chatCards: ReturnType<typeof useCompanionStore.getState>['chatCards'];
  brainView: ReturnType<typeof useCompanionStore.getState>['brainView'];
  betaSelfImprove: boolean;
  improving: boolean;
  voiceEnabled: boolean;
  voiceEngine: 'elevenlabs' | 'piper';
  voiceCredentialId: string | null;
  voiceId: string | null;
  piperVoiceId: string | null;
  voiceSettings: ReturnType<typeof useTtsSettings>;
  recallSynthesisEnabled: boolean;
  autonomousMode: boolean;
  setMessages: (m: BodyProps['messages']) => void;
  appendMessage: (m: BodyProps['messages'][number]) => void;
  setStreaming: (v: boolean) => void;
  appendStreamingText: (s: string) => void;
  resetStreamingText: () => void;
  setSendError: (e: string | null) => void;
  setApprovals: (a: BodyProps['approvals']) => void;
  removeApproval: (id: string) => void;
  setProactive: (a: BodyProps['proactive']) => void;
  appendProactive: (m: BodyProps['proactive'][number]) => void;
  removeProactive: (id: string) => void;
  setQuickReplies: (q: string[]) => void;
  setChatCards: (c: ChatCard[]) => void;
  setBrainView: (next: BodyProps['brainView']) => void;
  setImproving: (v: boolean) => void;
  setPendingPlayback: (
    p: ReturnType<typeof useCompanionStore.getState>['pendingPlayback'],
  ) => void;
  setPlaybackAudioUrl: (audioUrl: string) => void;
  markPlaybackPlayed: () => void;
}

function Body(props: BodyProps) {
  const {
    initialized,
    initError,
    messages,
    streaming,
    streamingText,
    sendError,
    approvals,
    proactive,
    quickReplies,
    chatCards,
    brainView,
    betaSelfImprove,
    improving,
    voiceEnabled,
    voiceEngine,
    voiceCredentialId,
    voiceId,
    piperVoiceId,
    voiceSettings,
    recallSynthesisEnabled,
    autonomousMode,
    setMessages,
    appendMessage,
    setStreaming,
    appendStreamingText,
    resetStreamingText,
    setSendError,
    setApprovals,
    removeApproval,
    setProactive,
    appendProactive,
    removeProactive,
    setQuickReplies,
    setChatCards,
    setBrainView,
    setImproving,
    setPendingPlayback,
    setPlaybackAudioUrl,
    markPlaybackPlayed,
  } = props;
  const { t, tx } = useTranslation();
  // Recall preview state is read directly from the store (rather than
  // threaded through Body's props) — these are display-only fields with
  // no setter callbacks that the parent needs to coordinate.
  const streamingRecall = useCompanionStore((s) => s.streamingRecall);
  const recallByEpisodeId = useCompanionStore((s) => s.recallByEpisodeId);
  // Live progress phase for the streaming bubble — what Athena is
  // currently doing (thinking / using a tool / reviewing a result).
  // Replaces the dead "thinking…" placeholder so the user sees activity
  // even when prose text hasn't started arriving yet.
  const streamingPhase = useCompanionStore((s) => s.streamingPhase);
  const streamingBeat = useCompanionStore((s) => s.streamingBeat);
  const turnSummaryByEpisodeId = useCompanionStore(
    (s) => s.turnSummaryByEpisodeId,
  );
  const jobsById = useCompanionStore((s) => s.jobsById);
  const pendingConnectorJobIds = useCompanionStore(
    (s) => s.pendingConnectorJobIds,
  );
  const connectorJobIdsByEpisodeId = useCompanionStore(
    (s) => s.connectorJobIdsByEpisodeId,
  );
  // Operational thread (live TodoWrite plan). `streamingSteps` pins under
  // the in-flight bubble; `stepsByEpisodeId` under the completed one.
  const streamingSteps = useCompanionStore((s) => s.streamingSteps);
  const stepsByEpisodeId = useCompanionStore((s) => s.stepsByEpisodeId);

  // Initial transcript + pending approvals fetch — once init is done.
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!initialized || fetchedRef.current) return;
    fetchedRef.current = true;
    companionListRecentMessages(50)
      .then((msgs) => setMessages(msgs))
      .catch(silentCatch('companion_list_recent_messages'));
    companionListPendingApprovals()
      .then((list) => setApprovals(list))
      .catch(silentCatch('companion_list_pending_approvals'));
    // Phase E: hydrate any unresolved proactive nudges so the user
    // sees them immediately on panel mount (rather than only after
    // the next scheduler tick).
    companionListProactiveMessages(true, 20)
      .then((list) => setProactive(list))
      .catch(silentCatch('companion_list_proactive_messages'));
  }, [initialized, setMessages, setApprovals, setProactive]);

  // Track the turn id of the currently-streaming turn so the Stop
  // button knows what to interrupt. Captured from the `started`
  // stream event, cleared on `finished`/`error`. Ref (not state) so
  // the listener closure stays stable.
  const currentTurnIdRef = useRef<string | null>(null);

  // Token-level streaming bookkeeping (--include-partial-messages).
  // `sawDeltasRef` flips true the moment a `text_delta` arrives this turn;
  // once set, we ignore the trailing whole `assistant` message text (it
  // duplicates what the deltas already appended). `deltaBufferRef` +
  // `deltaRafRef` coalesce a burst of tiny deltas into one store write per
  // animation frame so the high-frequency `text_delta` stream can't thrash
  // the Zustand store. Reset/flushed on `started` and `finished`.
  const sawDeltasRef = useRef(false);
  const deltaBufferRef = useRef('');
  const deltaRafRef = useRef<number | null>(null);

  // TurnSummaryChip jump targets: refs to the in-panel approval and
  // chat-card containers so the chip can scroll the user there with
  // smooth `scrollIntoView`. Dashboard / cockpit jumps route through
  // useSystemStore directly (same setSidebarSection chain the
  // compose_* auto-fires use).
  const approvalsAnchorRef = useRef<HTMLDivElement>(null);
  const chatCardsAnchorRef = useRef<HTMLDivElement>(null);
  const handleTurnSummaryJump = useCallback(
    (target: 'approvals' | 'chatCards' | 'dashboard' | 'cockpit') => {
      if (target === 'approvals' || target === 'chatCards') {
        const el =
          target === 'approvals'
            ? approvalsAnchorRef.current
            : chatCardsAnchorRef.current;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // Both 'dashboard' and 'cockpit' route to Home → Cockpit. The
      // dedicated Dashboard tab was retired; Cockpit is the dynamic
      // dashboard surface, so a composed-dashboard summary lands there.
      const sys = useSystemStore.getState();
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
    },
    [],
  );

  /*
   * Soft progress timeout. If no CLI line arrives for ~30s mid-turn we
   * surface a gentle "still working" hint; at ~2min we sharpen the hint
   * to suggest the Stop button. The hard timeout is 15min server-side
   * (TURN_TIMEOUT in session.rs) — way too long to leave the user
   * staring at a static bubble.
   *
   * `lastStreamEventAtRef` updates on every CLI line, started, and
   * finished. `slowLevel` is checked every 5s while streaming.
   */
  const lastStreamEventAtRef = useRef<number>(0);
  const [slowLevel, setSlowLevel] = useState<0 | 1 | 2>(0);

  // Variant C — spoken "no dead air" progress. While a turn is in flight we
  // optionally speak a short ack (~2.5s in) and a heartbeat (~30s in), each
  // once per turn, gated on voice being active and cut off the moment the
  // real reply starts playing. Refs hold the in-flight progress clip so we
  // can stop it; `spokenTiersRef` de-dupes tiers within a turn.
  const progressAudioRef = useRef<HTMLAudioElement | null>(null);
  const progressUrlRef = useRef<string | null>(null);
  const spokenTiersRef = useRef<Set<number>>(new Set());
  // Variant B — model-authored progress beats. `progressFiredRef` counts the
  // `PROGRESS:` lines already surfaced this turn (streamingText only grows,
  // so we re-scan and fire the new tail); `beatFiredRef` records whether any
  // beat fired (so generic ack/heartbeat filler stands down).
  const progressFiredRef = useRef(0);
  const beatFiredRef = useRef(false);

  useEffect(() => {
    if (!streaming) {
      setSlowLevel(0);
      return;
    }
    // Poll every 5s — fine-grained enough that the chip appears within
    // a heartbeat of crossing each threshold, coarse enough that the
    // setInterval is cheap.
    const id = setInterval(() => {
      const since = Date.now() - lastStreamEventAtRef.current;
      if (since > 120_000) setSlowLevel(2);
      else if (since > 30_000) setSlowLevel(1);
      else setSlowLevel(0);
    }, 5000);
    return () => clearInterval(id);
  }, [streaming]);

  // Flush buffered token deltas into the store as one write. Stable
  // (depends only on appendStreamingText) so the listener closure below
  // stays stable across renders.
  const flushDeltaBuffer = useCallback(() => {
    if (deltaRafRef.current !== null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    if (deltaBufferRef.current) {
      const chunk = deltaBufferRef.current;
      deltaBufferRef.current = '';
      appendStreamingText(chunk);
    }
  }, [appendStreamingText]);

  // Subscribe to streaming events from the backend.
  useTauriEvent<CompanionStreamEvent>(
    COMPANION_STREAM_EVENT,
    useCallback(
      (event) => {
        const ev = event.payload;
        // Every event resets the soft-progress clock — silence (no
        // events arriving) is what we surface as "still working".
        lastStreamEventAtRef.current = Date.now();
        if (ev.kind === 'started') {
          currentTurnIdRef.current = ev.turnId;
          // New turn — reset token-streaming bookkeeping and drop any
          // unflushed deltas from a prior turn.
          sawDeltasRef.current = false;
          deltaBufferRef.current = '';
          if (deltaRafRef.current !== null) {
            cancelAnimationFrame(deltaRafRef.current);
            deltaRafRef.current = null;
          }
          // New turn — drop any leftover in-flight recall strip; the
          // backend will re-emit `recall-preview` once the new prompt
          // is built.
          useCompanionStore.getState().setStreamingRecall(null);
          // Clear any stale phase from a prior turn so the new turn
          // starts cleanly on the placeholder until the first CLI line
          // arrives.
          useCompanionStore.getState().setStreamingPhase(null);
          // Drop the prior turn's operational checklist; the new turn
          // rebuilds it from its own TodoWrite calls.
          useCompanionStore.getState().setStreamingSteps([]);
          // Reset Variant B beat bookkeeping for the new turn.
          useCompanionStore.getState().setStreamingBeat(null);
          beatFiredRef.current = false;
          progressFiredRef.current = 0;
        } else if (ev.kind === 'cli') {
          // Operational thread: a TodoWrite tool call republishes Athena's
          // full plan. Capture it (latest wins) so the inline checklist
          // tracks progress; the checklist itself is the activity signal,
          // so don't also surface a generic "Using TodoWrite…" phase.
          const steps = extractTodoWrite(ev.payload);
          if (steps) {
            useCompanionStore.getState().setStreamingSteps(steps);
            return;
          }
          // Token-level path: a `stream_event` text_delta. Append it live
          // (coalesced per frame) and remember we're streaming deltas so
          // the trailing whole `assistant` message doesn't double the text.
          const delta = extractAssistantTextDelta(ev.payload);
          if (delta) {
            // First token of the reply — flip the status to "Composing
            // reply…" once (we no longer render the raw token stream, so
            // without this the bubble would sit on "Thinking…" through the
            // whole answer generation). Set once, not per-token.
            if (!sawDeltasRef.current) {
              useCompanionStore.getState().setStreamingPhase({ kind: 'responding' });
            }
            sawDeltasRef.current = true;
            deltaBufferRef.current += delta;
            if (deltaRafRef.current === null) {
              deltaRafRef.current = requestAnimationFrame(flushDeltaBuffer);
            }
            return;
          }
          // Whole-message path (also the only path on CLIs that don't emit
          // partial messages). Extract assistant text + a progress phase
          // (thinking / tool_use / etc.) so the bubble reports what Athena
          // is doing instead of a dead "thinking…" placeholder.
          const text = extractAssistantText(ev.payload);
          const phase = extractStreamPhase(ev.payload);
          if (text) {
            // Prose is arriving — show "Composing reply…" (we no longer
            // render the partial text itself; the full reply lands whole).
            useCompanionStore.getState().setStreamingPhase({ kind: 'responding' });
            // If deltas already streamed this turn, this whole-message text
            // is a duplicate of what we appended token-by-token — skip it.
            if (!sawDeltasRef.current) appendStreamingText(text);
          } else if (phase) {
            useCompanionStore.getState().setStreamingPhase(phase);
          }
        } else if (ev.kind === 'finished') {
          // Land any deltas still buffered before the transcript refetch
          // swaps the streaming bubble for the persisted episode.
          flushDeltaBuffer();
          sawDeltasRef.current = false;
          // Promote the streaming recall AND any pending connector_use
          // jobs onto the just-persisted assistant episode so they pin
          // under the now-completed bubble. Payload is the
          // assistant_episode_id.
          if (ev.payload) {
            useCompanionStore.getState().attachRecallToEpisode(ev.payload);
            useCompanionStore
              .getState()
              .attachPendingJobsToEpisode(ev.payload);
            // Pin the operational checklist under the completed bubble.
            useCompanionStore.getState().attachStepsToEpisode(ev.payload);
          } else {
            useCompanionStore.getState().setStreamingRecall(null);
          }
          useCompanionStore.getState().setStreamingPhase(null);
          // Clear any in-flight checklist not promoted to an episode.
          useCompanionStore.getState().setStreamingSteps([]);
          currentTurnIdRef.current = null;
        } else if (ev.kind === 'error') {
          flushDeltaBuffer();
          sawDeltasRef.current = false;
          setSendError(ev.payload);
          useCompanionStore.getState().setStreamingRecall(null);
          useCompanionStore.getState().setStreamingPhase(null);
          useCompanionStore.getState().setStreamingSteps([]);
          currentTurnIdRef.current = null;
        }
      },
      [appendStreamingText, setSendError, flushDeltaBuffer],
    ),
    'companion_stream_listen',
  );

  // Recall-preview event: fires once per turn between `started` and the
  // first CLI delta, carrying what the brain pulled into the system
  // prompt. Stash it as the in-flight strip; it gets promoted to the
  // assistant episode at `finished` time.
  useTauriEvent<CompanionRecallPreviewEvent>(
    COMPANION_RECALL_PREVIEW_EVENT,
    useCallback((event) => {
      const ev = event.payload;
      if (!ev?.preview) return;
      useCompanionStore.getState().setStreamingRecall(ev.preview);
    }, []),
    'companion_recall_preview_listen',
  );

  // Turn-summary event: fires after the dispatcher block once per turn,
  // already keyed by the persisted assistant_episode_id. The chip below
  // the bubble reads from `turnSummaryByEpisodeId[m.id]`.
  useTauriEvent<CompanionTurnSummaryEvent>(
    COMPANION_TURN_SUMMARY_EVENT,
    useCallback((event) => {
      const ev = event.payload;
      if (!ev?.assistantEpisodeId) return;
      // Strip out the correlator fields the chip doesn't need.
      const {
        sessionId: _sid,
        turnId: _tid,
        assistantEpisodeId,
        ...summary
      } = ev;
      void _sid;
      void _tid;
      useCompanionStore.getState().setTurnSummary(assistantEpisodeId, summary);
    }, []),
    'companion_turn_summary_listen',
  );

  // Background-job event: every queued→running→completed/failed
  // transition for any job kind. We keep the full row in `jobsById` and
  // let `upsertJob` decide whether to add it to the pending list — only
  // `connector_use` jobs become inline cards; other kinds (scan_codebase,
  // curation_run) have their own UIs and shouldn't squat on the chat.
  useTauriEvent<BackgroundJob>(
    COMPANION_JOB_EVENT,
    useCallback((event) => {
      const job = event.payload;
      if (!job?.id) return;
      useCompanionStore.getState().upsertJob(job);
    }, []),
    'companion_job_listen',
  );

  const handleInterrupt = useCallback(() => {
    const turnId = currentTurnIdRef.current;
    if (!turnId) return;
    // Optimistically clear so a second click doesn't double-fire while
    // the backend is finalizing the partial reply.
    currentTurnIdRef.current = null;
    companionInterruptTurn(turnId).catch(silentCatch('companion_interrupt_turn'));
  }, []);

  // RecallStrip Stage 2: a click on a recall chip opens the Brain Viewer
  // pinned to that memory id. `setBrainView({ kind, id })` jumps straight
  // to DetailView; the overlay paints itself over the transcript.
  const handleOpenInBrain = useCallback(
    (kind: BrainKind, id: string) => {
      setBrainView({ open: true, kind, id });
    },
    [setBrainView],
  );

  // Subscribe to direct-navigation events fired by Athena's `open_route`
  // op. By design these bypass the approval flow — Athena just switches
  // the sidebar behind the chat. We deliberately do NOT collapse the
  // panel here so the user can keep talking while the destination loads
  // behind it (the explicit goal: "achieve using the chat and seeing
  // how it works with the app").
  useTauriEvent<string>(
    COMPANION_NAVIGATE_EVENT,
    useCallback((event) => {
      const route = event.payload;
      // "monitor" is a pseudo-route — it opens the full-screen Persona
      // Monitor overlay rather than switching a sidebar section.
      if (route === 'monitor') {
        useSystemStore.getState().setMonitorOpen(true);
        return;
      }
      if (!VALID_NAV_ROUTES.includes(route as SidebarSection)) return;
      useSystemStore.getState().setSidebarSection(route as SidebarSection);
    }, []),
    'companion_navigate_listen',
  );

  // Phase F: subscribe to `open_lab` events. Athena's op auto-fires
  // these (no approval card) — we route to the persona, switch the
  // editor to the lab tab, and stash the requested mode in
  // `companionLabJump` so the LabTab consumes it on mount.
  useTauriEvent<OpenLabEvent>(
    COMPANION_OPEN_LAB_EVENT,
    useCallback((event) => {
      const { personaId, mode } = event.payload;
      if (!personaId || !mode) return;
      // Pre-set the lab jump first; the LabTab effect below reads it
      // on mount/render. Then drive the navigation: select persona,
      // switch sidebar, switch editor tab. (Order matters: persona
      // selection must precede editorTab so the editor has data to
      // render against.)
      useSystemStore.getState().setCompanionLabJump({ personaId, mode });
      try {
        useAgentStore.getState().selectPersona(personaId);
      } catch (err) {
        // Best-effort: persona selection can fail (e.g. persona was
        // deleted between Athena's emit and this listener). Swallow
        // the navigation but leave a Sentry breadcrumb so the missed
        // selectPersona doesn't disappear silently.
        silentCatch('companion_open_lab_select_persona')(err);
      }
      useSystemStore.getState().setSidebarSection('personas');
      // Switch the editor tab via the store's custom setter (it
      // handles activity → lab handoff).
      const setEditorTab = useSystemStore.getState().setEditorTab;
      if (typeof setEditorTab === 'function') {
        setEditorTab('lab' as never);
      }
    }, []),
    'companion_open_lab_listen',
  );

  // Phase F: subscribe to `compose_dashboard` events (auto-fire path).
  // The dedicated Dashboard tab was retired (Cockpit is the dynamic
  // dashboard surface), so a composed dashboard now routes the user to
  // Home → Cockpit — same destination as `compose_cockpit`.
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_DASHBOARD_EVENT,
    useCallback(() => {
      const sys = useSystemStore.getState();
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
    }, []),
    'companion_compose_dashboard_listen',
  );

  // compose_cockpit auto-fire — same shape as compose_dashboard but
  // destinations are Home → Cockpit. Spec is already persisted server-side;
  // we just navigate the user there so they see what Athena built.
  //
  // Also: when Athena composes a cockpit she's signalling "look at the
  // thing I just built, not at me" — so we auto-shrink the panel to its
  // compact mode (380px → 760px is too dominant over the cockpit content
  // it's pointing at). The user can always expand back with the toggle
  // in the header. We don't auto-collapse, only auto-narrow; full-collapse
  // would hide the conversational thread that explains the cockpit.
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_COCKPIT_EVENT,
    useCallback(() => {
      const sys = useSystemStore.getState();
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
      sys.setCompanionPanelCompact(true);
    }, []),
    'companion_compose_cockpit_listen',
  );

  // Inline chat-cards (show_persona_overview / show_connected_services /
  // show_decisions). One-shot — companion emits them per turn when she
  // judges a UI snippet beats prose. Cleared on next send / reset above.
  useTauriEvent<CompanionChatCardsEvent>(
    COMPANION_CHAT_CARDS_EVENT,
    useCallback((event) => {
      const cards = event.payload?.cards;
      if (cards && cards.length > 0) {
        useCompanionStore.getState().setChatCards(cards);
      }
    }, []),
    'companion_chat_cards_listen',
  );

  // Phase E: subscribe to proactive deliveries from the scheduler.
  // Each event payload carries newly-delivered messages — we append
  // them to the store so the panel pops the "Athena reached out"
  // card without a refetch. Dedupe by id is enforced in the store.
  useTauriEvent<ProactiveDeliveryEvent>(
    COMPANION_PROACTIVE_EVENT,
    useCallback(
      (event) => {
        for (const m of event.payload.messages) {
          appendProactive(m);
        }
      },
      [appendProactive],
    ),
    'companion_proactive_listen',
  );

  // Subscribe to approval-creation events. Each event payload is the
  // array of approvals created in the just-finished turn — we refetch
  // canonical pending list to stay in sync (handles edge cases like an
  // approval that finalized in a different surface mid-stream).
  useTauriEvent<CreatedApproval[]>(
    COMPANION_APPROVALS_EVENT,
    useCallback(() => {
      companionListPendingApprovals()
        .then((list) => setApprovals(list))
        .catch(silentCatch('companion_list_pending_approvals'));
    }, [setApprovals]),
    'companion_approvals_listen',
  );

  // Auto-scroll on new content.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, streaming]);

  // Voice is "active" only when the chosen engine has everything it
  // needs: ElevenLabs requires a credential + voice id; Piper requires
  // only a voice id (the engine binary lookup happens at synthesis time
  // and surfaces a clear install hint if missing). The send pipeline
  // checks this before asking the backend to emit a TTS line — there's
  // no point generating a spoken summary we can't synthesize.
  const voiceActive =
    voiceEnabled &&
    (voiceEngine === 'piper'
      ? Boolean(piperVoiceId)
      : Boolean(voiceCredentialId && voiceId));
  // Resolve the engine-specific identifiers for synthesis. Piper passes
  // null credentialId; ElevenLabs passes null where Piper voice id would go.
  const synthesisCredentialId = voiceEngine === 'piper' ? null : voiceCredentialId;
  const synthesisVoiceId = voiceEngine === 'piper' ? piperVoiceId : voiceId;

  // Stop + release any in-flight spoken-progress clip (ack / heartbeat).
  const stopProgressAudio = useCallback(() => {
    progressAudioRef.current?.pause();
    progressAudioRef.current = null;
    if (progressUrlRef.current) {
      URL.revokeObjectURL(progressUrlRef.current);
      progressUrlRef.current = null;
    }
  }, []);

  // Synthesize + play one short progress clip on the exclusive progress
  // channel (latest beat/ack wins — we stop the prior so they never stack).
  // Bails when voice isn't active or the real reply is already queued.
  const playProgressClip = useCallback(
    (text: string) => {
      if (!voiceActive || !synthesisVoiceId) return;
      if (useCompanionStore.getState().pendingPlayback) return;
      stopProgressAudio();
      synthesizeTts(text, synthesisCredentialId, synthesisVoiceId, voiceSettings, voiceEngine)
        .then((url) => {
          // Re-check: the reply may have landed while we were synthesizing.
          if (useCompanionStore.getState().pendingPlayback) {
            URL.revokeObjectURL(url);
            return;
          }
          progressUrlRef.current = url;
          const { audio, done } = playAudio(url);
          progressAudioRef.current = audio;
          done.catch(silentCatch('companion_voice_progress_play')).finally(() => {
            if (progressUrlRef.current === url) {
              URL.revokeObjectURL(url);
              progressUrlRef.current = null;
              progressAudioRef.current = null;
            }
          });
        })
        .catch(silentCatch('companion_voice_progress_synthesize'));
    },
    [voiceActive, synthesisVoiceId, synthesisCredentialId, voiceSettings, voiceEngine, stopProgressAudio],
  );

  // Generic ack / heartbeat (Variant C). Each tier speaks at most once per
  // turn — and is suppressed entirely once Athena has emitted her own
  // progress beat (Variant B), since her words beat generic filler.
  const speakProgress = useCallback(
    (text: string, tier: number) => {
      if (beatFiredRef.current) return;
      if (spokenTiersRef.current.has(tier)) return;
      spokenTiersRef.current.add(tier);
      playProgressClip(text);
    },
    [playProgressClip],
  );

  // Fire a model-authored progress beat (Variant B): show Athena's own words
  // in the streaming bubble and speak them.
  const fireBeat = useCallback(
    (text: string) => {
      beatFiredRef.current = true;
      useCompanionStore.getState().setStreamingBeat(text);
      playProgressClip(text);
    },
    [playProgressClip],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSendError(null);
      // Quick-replies + inline chat-cards are one-shot — clear before the
      // new turn so they don't linger if Athena's reply doesn't offer fresh
      // ones.
      setQuickReplies([]);
      setChatCards([]);
      // Optimistic user bubble.
      const optimistic = {
        id: `optim_${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      appendMessage(optimistic);
      setStreaming(true);
      resetStreamingText();
      // Fresh turn — reset spoken-progress tiers + beat bookkeeping and
      // silence any leftover progress clip.
      spokenTiersRef.current.clear();
      beatFiredRef.current = false;
      progressFiredRef.current = 0;
      useCompanionStore.getState().setStreamingBeat(null);
      stopProgressAudio();
      // Seed the soft-progress clock so the chip-threshold effect
      // doesn't trip immediately based on a stale prior-turn timestamp.
      lastStreamEventAtRef.current = Date.now();
      try {
        const result = await companionSendMessage(
          trimmed,
          voiceActive,
          recallSynthesisEnabled,
          autonomousMode,
        );
        // Refresh canonical transcript from backend (replaces the optimistic
        // user bubble with the persisted episode + adds the assistant turn).
        const fresh = await companionListRecentMessages(50);
        setMessages(fresh);
        if (result.quickReplies && result.quickReplies.length > 0) {
          setQuickReplies(result.quickReplies);
        }
        // Voice playback wiring — only when voice is on AND backend gave
        // us a spoken summary. Stash it for the footer Play button, then
        // auto-play here so the user hears it without an extra click.
        // Failures are non-fatal: the text reply already landed.
        if (
          voiceActive &&
          result.ttsText &&
          synthesisVoiceId
        ) {
          const playback = {
            episodeId: result.assistantEpisodeId,
            ttsText: result.ttsText,
            played: false,
            audioUrl: null as string | null,
          };
          setPendingPlayback(playback);
          // The real reply is committed — cut off any ack/heartbeat clip
          // so it doesn't talk over Athena's answer.
          stopProgressAudio();
          synthesizeTts(
            result.ttsText,
            synthesisCredentialId,
            synthesisVoiceId,
            voiceSettings,
            voiceEngine,
          )
            .then((url) => {
              setPlaybackAudioUrl(url);
              const { done } = playAudio(url);
              done
                .then(() => markPlaybackPlayed())
                .catch(silentCatch('companion_tts_play'));
            })
            .catch(silentCatch('companion_tts_synthesize'));
        }
      } catch (err: unknown) {
        // extractMessage prevents "[object Object]" leaking into the
        // user-visible error chip when the IPC rejection is a Tauri
        // envelope rather than an Error instance.
        const msg = extractMessage(err);
        setSendError(msg);
        silentCatch('companion_send_message')(err);
      } finally {
        // Reset order matters for the streaming bubble's AnimatePresence
        // exit: setStreaming(false) first unmounts the bubble, then we
        // clear the in-flight scratch fields. If we wiped streamingText
        // first the bubble would briefly show an empty body mid-exit.
        setStreaming(false);
        resetStreamingText();
        // streamingPhase is owned by the store but cleaned up here too
        // — the stream-event handler clears it on `finished`/`error`
        // but the IPC rejection path skips the stream-event channel
        // entirely (the backend never got far enough to emit one), so
        // an explicit reset here is the safety net.
        useCompanionStore.getState().setStreamingPhase(null);
        useCompanionStore.getState().setStreamingBeat(null);
      }
    },
    [appendMessage, markPlaybackPlayed, resetStreamingText, setMessages, setPendingPlayback, setPlaybackAudioUrl, setQuickReplies, setChatCards, setSendError, setStreaming, stopProgressAudio, voiceActive, voiceEngine, synthesisCredentialId, synthesisVoiceId, voiceSettings, recallSynthesisEnabled, autonomousMode],
  );

  // Spoken ack: ~2.5s into a still-running turn, say a short "one moment"
  // so a slow turn isn't dead silent. Fast turns (< the delay) never
  // trigger it; the cleanup clears the timer when the turn ends.
  useEffect(() => {
    if (!streaming) {
      stopProgressAudio();
      return;
    }
    const id = window.setTimeout(() => {
      speakProgress(t.plugins.companion.voice_progress_ack, 0);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [streaming, speakProgress, stopProgressAudio, t]);

  // Spoken heartbeat: once the silence has crossed the first slow tier
  // (~30s), say "still working" — once per turn.
  useEffect(() => {
    if (streaming && slowLevel >= 1) {
      speakProgress(t.plugins.companion.voice_progress_working, 1);
    }
  }, [streaming, slowLevel, speakProgress, t]);

  // Variant B — detect model-authored `PROGRESS:` beats as their lines
  // complete in the streaming text and fire each once (show + speak). A
  // line is "complete" once a newline follows it, so we scan all but the
  // last split segment; `streamingText` only grows, so we fire the new
  // tail past `progressFiredRef`.
  useEffect(() => {
    if (!streaming) {
      progressFiredRef.current = 0;
      return;
    }
    const parts = streamingText.split('\n');
    const beats: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const m = /^\s*PROGRESS:\s*(.+)$/.exec(parts[i] ?? '');
      const body = m?.[1]?.trim();
      if (body) beats.push(body);
    }
    if (beats.length > progressFiredRef.current) {
      for (let i = progressFiredRef.current; i < beats.length; i++) {
        fireBeat(beats[i]!);
      }
      progressFiredRef.current = beats.length;
    }
  }, [streamingText, streaming, fireBeat]);

  // Voice turns fired from the footer's hold-to-talk affordance. This panel
  // component is always mounted (only its visible UI is gated on `isOpen`),
  // so consuming the request here lets a footer-initiated turn run the full
  // `send()` pipeline — streaming, transcript persistence, and TTS playback —
  // without the panel ever opening. The reply surfaces to the user through
  // the existing footer notice popover + Play button + auto-played TTS.
  const voiceTurnRequest = useCompanionStore((s) => s.voiceTurnRequest);
  useEffect(() => {
    if (!voiceTurnRequest || streaming) return;
    useCompanionStore.getState().setVoiceTurnRequest(null);
    void send(voiceTurnRequest);
  }, [voiceTurnRequest, streaming, send]);

  // Wrench-send: pipe the textarea content into the self-improve loop.
  // The improvement runs on a SEPARATE Claude CLI session at repo root
  // (not Athena's main session), writes to disk, and logs the outcome
  // as a system episode in Athena's transcript so she sees what
  // changed in future turns.
  const requestImprove = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setImproving(true);
      // Show an optimistic user-style bubble so it's clear what was
      // submitted, then refetch when the backend logs the outcome.
      appendMessage({
        id: `improve_user_${Date.now()}`,
        role: 'user',
        content: `🛠 ${trimmed}`,
        createdAt: new Date().toISOString(),
      });
      try {
        await companionRequestImprovement(trimmed);
        const fresh = await companionListRecentMessages(50);
        setMessages(fresh);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSendError(msg);
        silentCatch('companion_request_improvement')(err);
      } finally {
        setImproving(false);
      }
    },
    [appendMessage, setImproving, setMessages, setSendError],
  );

  // Quick-action seed for the help button on the right toolbar. Sent
  // verbatim through the same path as a typed user message, so it
  // produces a real episode + assistant reply (and respects the
  // turn-in-flight guard via `disabled`).
  //
  // After the turn lands, if Athena didn't emit her own QR chips, we
  // seed a deterministic follow-up set so this preset is never a
  // dead-end. The user kept hitting this button looking for "what
  // next" and getting only prose — the chips convert the abstract
  // capability list into a concrete next click.
  const askCapabilities = useCallback(async () => {
    await send(
      'What can you do? Walk me through your concrete capabilities — what data you see in the app right now, what actions you can propose for me to approve, and what you remember.',
    );
    if (useCompanionStore.getState().quickReplies.length === 0) {
      setQuickReplies(CAPABILITY_FALLBACK_REPLIES);
    }
  }, [send, setQuickReplies]);

  return (
    <div className="flex flex-row flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
          {!initialized && !initError && (
            <div className="flex items-center gap-3 text-foreground typo-body">
              <LoadingSpinner size="sm" />
              <span>{t.plugins.companion.initializing}</span>
            </div>
          )}
          {initError && (
            <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-body text-rose-400">
              {t.plugins.companion.init_failed}: {initError}
            </div>
          )}
          {/*
            D7 — live operative-memory digest strip. Pinned at the top
            of the panel so the user can see what Athena's working set
            looks like (same text she sees in her prompt every turn).
            Collapsed by default; hidden entirely when no ops are in
            flight.
          */}
          <LiveOpsStrip />
          {/* Phase C2 — Athena-dispatched team-assignment cards. Renders only
              when at least one assignment is in flight; click routes to the
              pipeline page so the user can drill into the full panel. */}
          <CompanionAssignmentCards />
          {/*
            MCP pending-request strip — pinned above proactive because
            the spawned claude session is *blocked* until it gets an
            answer here. Empty when no request is in flight; renders one
            inline card per pending guidance/approval request.
          */}
          <McpRequestPanel />
          {/*
            Proactive nudges land at the top of the transcript so they
            stay glanceable even when scroll-pinned at the bottom.
            "Engage" routes the message text through the normal send
            pipeline (creating an assistant turn that responds to it),
            "Dismiss" silently resolves and removes the card.
          */}
          <AnimatePresence initial={false}>
            {proactive.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <ProactiveCard
                  message={m}
                  onEngaged={(text) => {
                    removeProactive(m.id);
                    void send(text);
                  }}
                  onDismissed={() => removeProactive(m.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {initialized && messages.length === 0 && !streaming && proactive.length === 0 && (
            <p className="typo-body text-foreground">
              {t.plugins.companion.empty_transcript}
            </p>
          )}
          {(() => {
            // Find the last assistant index so RefineChips renders only
            // on the latest completed assistant bubble — refining mid-
            // scrollback is a different, higher-effort UI to model.
            let lastAssistantIdx = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i]?.role === 'assistant') {
                lastAssistantIdx = i;
                break;
              }
            }
            return messages.map((m, i) => {
              const recall =
                m.role === 'assistant' ? recallByEpisodeId[m.id] : undefined;
              const summary =
                m.role === 'assistant'
                  ? turnSummaryByEpisodeId[m.id]
                  : undefined;
              const isLastAssistant =
                m.role === 'assistant' && i === lastAssistantIdx;
              const prev = i > 0 ? messages[i - 1] : undefined;
              const priorUser =
                isLastAssistant && prev?.role === 'user' ? prev.content : '';
              const connectorJobIds =
                m.role === 'assistant'
                  ? connectorJobIdsByEpisodeId[m.id] ?? []
                  : [];
              const steps =
                m.role === 'assistant' ? stepsByEpisodeId[m.id] : undefined;
              return (
                <div key={m.id} className="space-y-1">
                  {recall && (
                    <RecallStrip
                      preview={recall}
                      onOpenInBrain={handleOpenInBrain}
                    />
                  )}
                  <Bubble
                    role={m.role}
                    index={i}
                    onOpenInBrain={handleOpenInBrain}
                  >
                    {m.content}
                  </Bubble>
                  {steps && steps.length > 0 && (
                    <OperationalThread steps={steps} />
                  )}
                  {connectorJobIds.map((jobId) => {
                    const job = jobsById[jobId];
                    return job ? (
                      <ConnectorCallCard key={jobId} job={job} />
                    ) : null;
                  })}
                  {summary && (
                    <TurnSummaryChip
                      summary={summary}
                      onJump={handleTurnSummaryJump}
                    />
                  )}
                  {isLastAssistant && priorUser && !streaming && !improving && (
                    <RefineChips
                      priorUserMessage={priorUser}
                      onSend={send}
                      disabled={!initialized || streaming || improving}
                    />
                  )}
                  {isLastAssistant && !streaming && !improving && m.content.trim() && (
                    <BubbleReadAloud
                      content={m.content}
                      voiceEngine={voiceEngine}
                      voiceCredentialId={voiceCredentialId}
                      voiceId={voiceId}
                      piperVoiceId={piperVoiceId}
                      voiceSettings={voiceSettings}
                    />
                  )}
                </div>
              );
            });
          })()}
          <AnimatePresence initial={false}>
            {streaming && (
              <motion.div
                key="companion-streaming-bubble"
                className="space-y-1"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {streamingRecall && (
                  <RecallStrip
                    preview={streamingRecall}
                    onOpenInBrain={handleOpenInBrain}
                  />
                )}
                <div className="relative group">
                  {/*
                    We intentionally do NOT render the live token stream
                    here — the token-by-token prose reflowed constantly and
                    leaked Athena's machine grammar (OP:/QR:/TTS: directives)
                    before the server-side strip. Instead the streaming
                    bubble shows a single status line: the current phase
                    ("Searching the web…", "Reading files…") when one has
                    landed, otherwise "Thinking…". Granular progress comes
                    from the OperationalThread below; the full prose reply
                    replaces this bubble in one piece when the turn finishes.
                    See docs/features/companion/conversation-orchestration.md.
                  */}
                  <Bubble role="assistant" streaming index={messages.length}>
                    {/* Athena's own progress beat (Variant B) wins over the
                        derived phase; fall back to phase, then "Thinking…". */}
                    {streamingBeat ??
                      (streamingPhase
                        ? phaseLabel(t, tx, streamingPhase)
                        : t.plugins.companion.thinking)}
                  </Bubble>
                  <button
                    type="button"
                    onClick={handleInterrupt}
                    className="absolute -top-2 -right-2 rounded-full bg-foreground/80 hover:bg-foreground text-background w-6 h-6 flex items-center justify-center shadow-elevation-2 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label={t.plugins.companion.stop_turn}
                    title={t.plugins.companion.stop_turn}
                    data-testid="companion-stop-turn"
                  >
                    <Square className="w-3 h-3" fill="currentColor" />
                  </button>
                </div>
                {streamingSteps.length > 0 && (
                  <OperationalThread steps={streamingSteps} />
                )}
                {/*
                  Slow-progress hint chip. Surfaces below the streaming
                  bubble when no CLI events have arrived in 30s (soft) /
                  120s (firm). The hard timeout server-side is 15min,
                  which is way too long to leave the user wondering if
                  things are stuck. AnimatePresence handles enter/exit
                  fade so the chip doesn't pop in abruptly.
                */}
                <AnimatePresence>
                  {slowLevel > 0 && (
                    <motion.div
                      key="companion-slow-progress"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className={`rounded-card border px-3 py-1.5 typo-caption ${
                        slowLevel === 2
                          ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300'
                          : 'border-foreground/10 bg-foreground/[0.04] text-foreground'
                      }`}
                      data-testid="companion-slow-progress"
                      data-slow-level={slowLevel}
                    >
                      {slowLevel === 2
                        ? t.plugins.companion.slow_progress_firm
                        : t.plugins.companion.slow_progress_soft}
                    </motion.div>
                  )}
                </AnimatePresence>
                {pendingConnectorJobIds.map((jobId) => {
                  const job = jobsById[jobId];
                  return job ? (
                    <ConnectorCallCard key={jobId} job={job} />
                  ) : null;
                })}
              </motion.div>
            )}
          </AnimatePresence>
          {improving && (
            <div className="rounded-card border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 typo-body text-amber-300/90 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.plugins.companion.improving}</span>
            </div>
          )}
          <div ref={approvalsAnchorRef} data-companion-section="approvals">
            <AnimatePresence initial={false}>
              {approvals.map((a) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ApprovalCard
                    approval={a}
                    onResolved={(id) => {
                      removeApproval(id);
                      // Pull the canonical transcript so the system episode the
                      // backend just logged (action outcome) shows up.
                      companionListRecentMessages(50)
                        .then((msgs) => setMessages(msgs))
                        .catch(silentCatch('companion_list_recent_messages'));
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div ref={chatCardsAnchorRef} data-companion-section="chat-cards">
            <AnimatePresence initial={false}>
              {chatCards.map((card, idx) => (
                <motion.div
                  key={`${card.kind}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <InlineChatCard card={card} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {sendError && (
            <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
              {sendError}
            </div>
          )}
        </div>
        <QuickReplies
          options={quickReplies}
          disabled={!initialized || streaming}
          onPick={(opt) => {
            // Keep the picked text visible to the user as their next
            // turn — the send pipeline handles persistence + assistant
            // reply + clearing the chip set.
            void send(opt);
          }}
        />
        <Composer
          disabled={!initialized || streaming || brainView.open || improving}
          onSend={send}
          onImprove={requestImprove}
          improveEnabled={betaSelfImprove}
          improving={improving}
        />
        {brainView.open && (
          <BrainViewer
            onClose={() =>
              setBrainView({ open: false, kind: null, id: null })
            }
          />
        )}
      </div>
      <CompanionToolbar
        onAskCapabilities={askCapabilities}
        onOpenBrain={() =>
          setBrainView({
            open: !brainView.open,
            kind: brainView.open ? null : null,
            id: null,
          })
        }
        brainOpen={brainView.open}
        disabled={!initialized || streaming}
      />
    </div>
  );
}
