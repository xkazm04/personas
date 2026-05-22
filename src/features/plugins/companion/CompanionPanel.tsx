import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
import { extractAssistantText } from './extractAssistantText';
import { extractStreamPhase, phaseLabel } from './extractStreamPhase';
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
import { ProactiveCard } from './ProactiveCard';
import { stripModelDirectives } from './athenaLabels';
import { AthenaAvatar } from './AthenaAvatar';
import { BrainViewer } from './BrainViewer';
import { CompanionToolbar } from './CompanionToolbar';
import { ConnectorCallCard } from './ConnectorCallCard';
import { RecallStrip } from './RecallStrip';
import { RefineChips } from './RefineChips';
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

  const isOpen = state === 'open';

  // Fetch the beta flag once on first panel mount. Cheap, returns a
  // single bool. Decides whether the wrench-send button is rendered.
  useEffect(() => {
    companionBetaFlags()
      .then((f) => setBetaSelfImprove(f.selfImproveEnabled))
      .catch(silentCatch('companion_beta_flags'));
  }, [setBetaSelfImprove]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="companion-panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
            onClose={() => setState('collapsed')}
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
      const sys = useSystemStore.getState();
      if (target === 'dashboard') {
        sys.setSidebarSection('plugins');
        sys.setPluginTab('companion');
        sys.setCompanionPluginTab('dashboard');
      } else {
        sys.setSidebarSection('home');
        sys.setHomeTab('cockpit');
      }
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
          // New turn — drop any leftover in-flight recall strip; the
          // backend will re-emit `recall-preview` once the new prompt
          // is built.
          useCompanionStore.getState().setStreamingRecall(null);
          // Clear any stale phase from a prior turn so the new turn
          // starts cleanly on the placeholder until the first CLI line
          // arrives.
          useCompanionStore.getState().setStreamingPhase(null);
        } else if (ev.kind === 'cli') {
          // Try to extract assistant text deltas from stream-json.
          const text = extractAssistantText(ev.payload);
          // Also extract a progress phase (thinking / tool_use / etc.)
          // so the streaming bubble can report what Athena is currently
          // doing instead of a dead "thinking…" placeholder. Returns
          // null on text blocks (the visible text is the signal then).
          const phase = extractStreamPhase(ev.payload);
          if (text) {
            // Prose is arriving — clear phase so it doesn't shadow the
            // streaming text below.
            useCompanionStore.getState().setStreamingPhase(null);
            appendStreamingText(text);
          } else if (phase) {
            useCompanionStore.getState().setStreamingPhase(phase);
          }
        } else if (ev.kind === 'finished') {
          // Promote the streaming recall AND any pending connector_use
          // jobs onto the just-persisted assistant episode so they pin
          // under the now-completed bubble. Payload is the
          // assistant_episode_id.
          if (ev.payload) {
            useCompanionStore.getState().attachRecallToEpisode(ev.payload);
            useCompanionStore
              .getState()
              .attachPendingJobsToEpisode(ev.payload);
          } else {
            useCompanionStore.getState().setStreamingRecall(null);
          }
          useCompanionStore.getState().setStreamingPhase(null);
          currentTurnIdRef.current = null;
        } else if (ev.kind === 'error') {
          setSendError(ev.payload);
          useCompanionStore.getState().setStreamingRecall(null);
          useCompanionStore.getState().setStreamingPhase(null);
          currentTurnIdRef.current = null;
        }
      },
      [appendStreamingText, setSendError],
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
  // The spec is already saved server-side — we just navigate the user
  // to the dashboard tab so they see what Athena built. Same three-
  // store-call pattern as the OpenCompanionTab client action; kept
  // inline because this listener fires *without* an approval card.
  useTauriEvent<unknown>(
    COMPANION_COMPOSE_DASHBOARD_EVENT,
    useCallback(() => {
      const sys = useSystemStore.getState();
      sys.setSidebarSection('plugins');
      sys.setPluginTab('companion');
      sys.setCompanionPluginTab('dashboard');
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
      }
    },
    [appendMessage, markPlaybackPlayed, resetStreamingText, setMessages, setPendingPlayback, setPlaybackAudioUrl, setQuickReplies, setChatCards, setSendError, setStreaming, voiceActive, voiceEngine, synthesisCredentialId, synthesisVoiceId, voiceSettings, recallSynthesisEnabled, autonomousMode],
  );

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
              return (
                <div key={m.id} className="space-y-1">
                  {recall && (
                    <RecallStrip
                      preview={recall}
                      onOpenInBrain={handleOpenInBrain}
                    />
                  )}
                  <Bubble role={m.role} index={i}>
                    {m.content}
                  </Bubble>
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
                  <Bubble role="assistant" streaming index={messages.length}>
                    {/*
                      Strip OP:/QR:/TTS:/raw {"op": directive lines from
                      the streaming view so the user never sees Athena's
                      machine grammar flash. The backend dispatcher does
                      the same strip server-side when persisting the
                      episode; the persisted bubble that replaces this
                      one is already clean.

                      When prose text hasn't arrived yet, fall through
                      to the streamingPhase placeholder ("Searching the
                      web…", "Reading files…", etc.) — surfaces what
                      Athena is currently doing instead of a dead
                      "Thinking…" string. Final fallback when no phase
                      has landed either (very first ms of a turn).
                    */}
                    {stripModelDirectives(streamingText) ||
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
