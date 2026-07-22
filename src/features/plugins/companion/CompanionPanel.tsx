import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  Bot,
  Infinity as InfinityIcon,
  Loader2,
  RotateCcw,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation, getActiveTranslations } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { DEFAULT_CONVERSATION_ID, useCompanionStore } from './companionStore';
import { Bubble } from './Bubble';
import { Composer } from './Composer';
import { QuickReplies } from './QuickReplies';
import {
  extractAssistantText,
  extractAssistantTextDelta,
} from './extractAssistantText';
import { extractStreamPhase, extractToolEvents, phaseLabel } from './extractStreamPhase';
import { extractTodoWrite } from './operationalSteps';
import { OperationalThread } from './OperationalThread';
import { NarrationLiveLog, NarrationTrail } from './NarrationThread';
import { buildPointAtWalkthrough, buildComposedWalkthrough } from './guidance/composeAdHoc';
import {
  COMPANION_APPROVALS_EVENT,
  COMPANION_CHAT_CARDS_EVENT,
  COMPANION_COMPOSE_COCKPIT_EVENT,
  COMPANION_COMPOSE_DASHBOARD_EVENT,
  COMPANION_EXPLAIN_COCKPIT_EVENT,
  type CompanionExplainCockpitEvent,
  type CompanionCockpitSpecBody,
  COMPANION_NAVIGATE_EVENT,
  COMPANION_GUIDE_EVENT,
  type CompanionGuideEvent,
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
  companionSetAutonomousMode,
  companionSetDevMode,
  companionInterruptTurn,
  companionResetConversation,
  companionSendMessage,
  companionAnalyzeFleet,
  companionDailyBrief,
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
import { COMPANION_NAV_ROUTES } from './companionRoutes';
import { ApprovalCard } from './ApprovalCard';
import { McpRequestPanel } from './mcp/McpRequestPanel';
import { LiveOpsStrip } from './orchestration/LiveOpsStrip';
import { InlineChatCard } from './InlineChatCard';
import { CompanionAssignmentCards } from './CompanionAssignmentCards';
import { useCompanionAssignmentBridge } from './useCompanionAssignmentBridge';
import { ProactiveCard } from './ProactiveCard';
import { AthenaAvatar } from './AthenaAvatar';
import { WakeCadence } from './WakeCadence';
import { FleetBoldnessDial } from './FleetBoldnessDial';
import { DevOpLedger } from './DevOpLedger';
import { BrainViewer } from './BrainViewer';
import { CompanionToolbar } from './CompanionToolbar';
import { ConnectorCallCard } from './ConnectorCallCard';
import { RecallStrip } from './RecallStrip';
import { ActivityTray } from './ActivityTray';
import { TaskTag } from './TaskTag';
import { QueuedMessages } from './QueuedMessages';
import { WelcomeHero } from './WelcomeHero';
import { ConversationSwitcher } from './ConversationSwitcher';
import { TypingDots } from './TypingDots';
import { useChatScroll } from './useChatScroll';
import { classifyMidTurnIntent } from './midTurnIntent';
import { RefineChips } from './RefineChips';
import { BubbleReadAloud } from './BubbleReadAloud';
import { useTtsVoiceSelection, type ResolvedTtsVoice } from './useTtsVoiceSelection';
import { TurnSummaryChip } from './TurnSummaryChip';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { play as playAudio, synthesize as synthesizeTts } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';
import { useAgentStore } from '@/stores/agentStore';

// Async-UX phase 4b — how long an in-turn tool call must run before it's
// surfaced as a task in the activity tray / orb. Below this it's just the
// transient streaming-phase chip; above it the work is slow enough to be
// worth a persistent, glanceable task.
const IN_TURN_TOOL_THRESHOLD_MS = 6000;

const ONE_DAY_MS = 86_400_000;

/** Flatten markdown to speakable plain text so TTS never reads `**` / `-` / `#`
 *  aloud. Lightweight (no parser) — strips the common inline/structural marks. */
function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')           // fenced code
    .replace(/`([^`]+)`/g, '$1')                 // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // links/images → text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // headings
    .replace(/^\s*[-*+]\s+/gm, '')               // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '')               // ordered markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold/italic
    .replace(/[*_~>]/g, '')                       // stray marks
    .replace(/\n{2,}/g, '. ')                     // paragraph breaks → pause
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same calendar day in local time. */
function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Label for a transcript day separator: "Today" / "Yesterday" for the recent
 * days (callers pass the localized strings), otherwise a locale-formatted
 * weekday + date. Matches how RelativeTime defers absolute dates to the
 * browser locale.
 */
function daySeparatorLabel(iso: string, todayLabel: string, yesterdayLabel: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameLocalDay(d, now)) return todayLabel;
  if (sameLocalDay(d, new Date(now.getTime() - ONE_DAY_MS))) return yesterdayLabel;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// See companionRoutes.ts — single source of truth shared with useDecisionQueue.

// After Athena navigates, briefly ring the destination's primary surface so the
// user's eye lands on what she brought them to (proactive "look here" glow).
// Only routes with a stable, always-present container testid are listed —
// others simply don't flash. `home` is omitted because its default tab varies;
// the compose-cockpit/dashboard handlers flash `cockpit-panel` explicitly.
const ROUTE_FLASH_ANCHORS: Partial<Record<SidebarSection, string>> = {
  overview: 'overview-page',
  credentials: 'credential-manager',
  settings: 'settings-page',
};

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
  const devModeAvailable = useCompanionStore((s) => s.devModeAvailable);
  // Speaking state: TTS audio synthesized AND not yet finished. Until
  // a `speaking` clip ships, the avatar falls back to the idle loop —
  // the `speaking` value is the signal carrier, not the visual.
  const isSpeaking = useCompanionStore(
    (s) => !!s.pendingPlayback?.audioUrl && !s.pendingPlayback.played,
  );

  const setMessages = useCompanionStore((s) => s.setMessages);
  const appendMessage = useCompanionStore((s) => s.appendMessage);
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
  const setDevModeAvailable = useCompanionStore((s) => s.setDevModeAvailable);
  const setPendingPlayback = useCompanionStore((s) => s.setPendingPlayback);
  const setPlaybackAudioUrl = useCompanionStore((s) => s.setPlaybackAudioUrl);
  const markPlaybackPlayed = useCompanionStore((s) => s.markPlaybackPlayed);

  // Always-mounted approval reconcile: when a turn finishes (streaming
  // true→false), refetch the pending-approval list. This guarantees approvals
  // Athena creates during a turn surface reliably — even if the live
  // `companion://approvals` event is missed, or the panel was closed during an
  // autonomous one-shot build. Because this lives in the always-mounted
  // CompanionPanel (not the open-only Body), the store is updated regardless of
  // panel state, so the cards are already present the moment the panel opens.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      companionListPendingApprovals()
        .then((list) => setApprovals(list))
        .catch(silentCatch('companion_list_pending_approvals'));
    }
    prevStreamingRef.current = streaming;
  }, [streaming, setApprovals]);

  // explain_in_cockpit auto-fire — the orb decision `0` flow. MUST live in
  // the always-mounted CompanionPanel (not the open-only Body): the user
  // presses `0` on the orb with the panel CLOSED, so a Body-scoped listener
  // would never hear the event (QA 2026-06-10 caught exactly that). The
  // spec rides IN the payload (deliberately never persisted): set it as the
  // contextual cockpit overlay, then navigate like compose_cockpit.
  // Dismissing the overlay restores the user's persistent board untouched.
  useTauriEvent<CompanionExplainCockpitEvent>(
    COMPANION_EXPLAIN_COCKPIT_EVENT,
    useCallback((event) => {
      const raw = event.payload?.spec;
      if (!raw) return;
      let body: CompanionCockpitSpecBody & { decision_id?: string };
      try {
        body = JSON.parse(raw) as CompanionCockpitSpecBody & { decision_id?: string };
      } catch (err) {
        silentCatch('companion_explain_cockpit_parse')(err);
        return;
      }
      if (!body || !Array.isArray(body.widgets) || body.widgets.length === 0) return;
      // The explanation landed — drop the orb's composing posture.
      useCompanionStore.getState().setExplainComposing(false);
      useCompanionStore.getState().setExplainComposeError(null);
      const sys = useSystemStore.getState();
      sys.setContextualCockpit({
        source: {
          kind: 'explain',
          decisionId: body.decision_id ?? '',
          decisionTitle: body.title ?? '',
        },
        spec: body,
      });
      sys.setSidebarSection('home');
      sys.setHomeTab('cockpit');
      sys.setCompanionPanelCompact(true);
      useCompanionStore.getState().flashHighlight('cockpit-panel', {
        label: getActiveTranslations().plugins.companion.guide_flash_composed,
      });
    }, []),
    'companion_explain_cockpit_listen',
  );

  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const voice = useTtsVoiceSelection();
  const voiceSettings = useTtsSettings();
  const recallSynthesisEnabled = useSystemStore((s) => s.companionRecallSynthesisEnabled);
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);
  const setAutonomousMode = useSystemStore((s) => s.setCompanionAutonomousMode);
  const devMode = useSystemStore((s) => s.companionDevMode);
  const setDevMode = useSystemStore((s) => s.setCompanionDevMode);
  const panelCompact = useSystemStore((s) => s.companionPanelCompact);
  const setPanelCompact = useSystemStore((s) => s.setCompanionPanelCompact);
  // While the Fleet grid overlay (z-200 portal) is open, the chat must float
  // ABOVE it — otherwise tapping the orb opens the panel behind the overlay
  // (reads as "orb disappears, no chat") and its decision/approval UI is
  // unreachable. Mirrors the orb's own z-[210] lift; panel goes one above.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const orbOpenOrigin = useCompanionStore((s) => s.orbOpenOrigin);
  const reduceMotion = useReducedMotion();

  const isOpen = state === 'open';

  // Fetch the beta flag once on first panel mount. Cheap, returns a
  // single bool. Decides whether the dev-mode wrench toggle is rendered.
  useEffect(() => {
    companionBetaFlags()
      .then((f) => setDevModeAvailable(f.devModeAvailable))
      .catch(silentCatch('companion_beta_flags'));
  }, [setDevModeAvailable]);

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
          className={`fixed bottom-12 left-4 ${fleetGridOpen ? 'z-[220]' : 'z-[60]'} ${
            panelCompact ? 'w-[350px]' : 'w-[760px]'
          } h-[900px] max-h-[calc(100vh-5rem)] flex flex-col rounded-card bg-secondary/95 backdrop-blur-md border border-foreground/10 shadow-elevation-4 overflow-hidden transition-[width] duration-200 ease-out ${
            autonomousMode ? 'companion-autonomous' : ''
          }`}
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
              useCompanionStore.getState().clearAllNarration();
              try {
                await companionResetConversation(true, useCompanionStore.getState().activeConversationId);
              } catch (err: unknown) {
                // Refetch so UI reflects whatever stuck on the backend.
                companionListRecentMessages(50, useCompanionStore.getState().activeConversationId)
                  .then((msgs) => setMessages(msgs))
                  .catch(silentCatch('companion_list_recent_messages'));
                silentCatch('companion_reset_conversation')(err);
              }
            }}
            autonomousMode={autonomousMode}
            onToggleAutonomousMode={() => {
              const next = !autonomousMode;
              setAutonomousMode(next);
              // Persist server-side so the backend proactive scheduler
              // knows whether to spawn self-initiated reasoning turns —
              // it can't see this Zustand flag.
              companionSetAutonomousMode(next).catch(
                silentCatch('companion_set_autonomous_mode'),
              );
              if (!next) {
                // Switching OFF: drop any scheduled continuation so a
                // tick that was about to fire doesn't sneak through
                // after the user explicitly opted out.
                companionCancelAutonomy().catch(
                  silentCatch('companion_cancel_autonomy'),
                );
              }
            }}
            devModeAvailable={devModeAvailable}
            devMode={devMode}
            onToggleDevMode={() => {
              const next = !devMode;
              setDevMode(next);
              // Persist server-side — the prompt assembler and the
              // dev_improve executor read the settings row, not Zustand.
              companionSetDevMode(next).catch(
                silentCatch('companion_set_dev_mode'),
              );
            }}
          />
          {autonomousMode && <WakeCadence />}
          {autonomousMode && <FleetBoldnessDial />}
          {devModeAvailable && devMode && <DevOpLedger />}
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
            voiceEnabled={voiceEnabled}
            voice={voice}
            voiceSettings={voiceSettings}
            recallSynthesisEnabled={recallSynthesisEnabled}
            autonomousMode={autonomousMode}
            setMessages={setMessages}
            appendMessage={appendMessage}
            setSendError={setSendError}
            setApprovals={setApprovals}
            removeApproval={removeApproval}
            setProactive={setProactive}
            appendProactive={appendProactive}
            removeProactive={removeProactive}
            setQuickReplies={setQuickReplies}
            setChatCards={setChatCards}
            setBrainView={setBrainView}
            setPendingPlayback={setPendingPlayback}
            setPlaybackAudioUrl={setPlaybackAudioUrl}
            markPlaybackPlayed={markPlaybackPlayed}
            compact={panelCompact}
            onToggleCompact={() => setPanelCompact(!panelCompact)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  onClose,
  onReset,
  autonomousMode,
  onToggleAutonomousMode,
  devModeAvailable,
  devMode,
  onToggleDevMode,
}: {
  onClose: () => void;
  onReset: () => void;
  autonomousMode: boolean;
  onToggleAutonomousMode: () => void;
  /** Debug build running from a source checkout — gates the wrench. */
  devModeAvailable: boolean;
  devMode: boolean;
  onToggleDevMode: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-foreground/10 bg-foreground/[0.02] shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {/*
          Header keeps a small static badge — the full Athena avatar now
          lives behind the chat as a watermark, so duplicating the video
          here would be visual noise.
        */}
        <span
          className={`inline-flex w-7 h-7 items-center justify-center rounded-full bg-primary/15 text-primary transition-shadow ${
            autonomousMode ? 'ring-1 ring-primary/40' : ''
          }`}
          aria-hidden
        >
          <Bot className="w-3.5 h-3.5" />
        </span>
        <ConversationSwitcher />
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
        {devModeAvailable && (
          <button
            onClick={onToggleDevMode}
            data-testid="companion-toggle-dev-mode"
            aria-pressed={devMode}
            className={`p-1.5 rounded-interactive transition-colors focus-ring ${
              devMode
                ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/20'
                // Amber hover even when OFF — distinguishes the wrench from
                // the visually identical infinity toggle next to it.
                : 'text-foreground hover:text-amber-400 hover:bg-amber-500/10'
            }`}
            aria-label={
              devMode
                ? t.plugins.companion.dev_toggle_off
                : t.plugins.companion.dev_toggle_on
            }
            title={
              devMode
                ? t.plugins.companion.dev_toggle_off
                : t.plugins.companion.dev_toggle_on
            }
          >
            <Wrench className="w-4 h-4" />
          </button>
        )}
        <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />
        <button
          onClick={onReset}
          data-testid="companion-reset"
          className="p-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.plugins.companion.reset}
          title={t.plugins.companion.reset}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />
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
  voiceEnabled: boolean;
  voice: ResolvedTtsVoice;
  voiceSettings: ReturnType<typeof useTtsSettings>;
  recallSynthesisEnabled: boolean;
  autonomousMode: boolean;
  setMessages: (m: BodyProps['messages']) => void;
  appendMessage: (m: BodyProps['messages'][number]) => void;
  setSendError: (e: string | null) => void;
  setApprovals: (a: BodyProps['approvals']) => void;
  removeApproval: (id: string) => void;
  setProactive: (a: BodyProps['proactive']) => void;
  appendProactive: (m: BodyProps['proactive'][number]) => void;
  removeProactive: (id: string) => void;
  setQuickReplies: (q: string[]) => void;
  setChatCards: (c: ChatCard[]) => void;
  setBrainView: (next: BodyProps['brainView']) => void;
  setPendingPlayback: (
    p: ReturnType<typeof useCompanionStore.getState>['pendingPlayback'],
  ) => void;
  setPlaybackAudioUrl: (audioUrl: string) => void;
  markPlaybackPlayed: () => void;
  /** Panel minimize (compact) state + toggle — forwarded to CompanionToolbar's edge handle. */
  compact: boolean;
  onToggleCompact: () => void;
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
    voiceEnabled,
    voice,
    voiceSettings,
    recallSynthesisEnabled,
    autonomousMode,
    setMessages,
    appendMessage,
    setSendError,
    setApprovals,
    removeApproval,
    setProactive,
    appendProactive,
    removeProactive,
    setQuickReplies,
    setChatCards,
    setBrainView,
    setPendingPlayback,
    setPlaybackAudioUrl,
    markPlaybackPlayed,
    compact,
    onToggleCompact,
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
  // Narration timeline (beats + tool calls). Live log under the streaming
  // bubble; collapsed trail under the completed one.
  const streamingNarration = useCompanionStore((s) => s.streamingNarration);
  const narrationByEpisodeId = useCompanionStore((s) => s.narrationByEpisodeId);

  // Transcript = the ACTIVE conversation's slice. Reload it whenever the
  // active thread changes (and once on init). Switching threads swaps the
  // message list; the brain/identity stay global.
  const activeConversationId = useCompanionStore((s) => s.activeConversationId);
  useEffect(() => {
    if (!initialized) return;
    companionListRecentMessages(50, activeConversationId)
      .then((msgs) => setMessages(msgs))
      .catch(silentCatch('companion_list_recent_messages'));
  }, [initialized, activeConversationId, setMessages]);

  // Initial pending-approvals + proactive fetch — once init is done. (The
  // transcript itself is loaded by the active-conversation effect above.)
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!initialized || fetchedRef.current) return;
    fetchedRef.current = true;
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

  // The live turn id lives in the store's per-conversation `liveTurns`
  // slice (captured from the `started` event) — the Stop button reads the
  // ACTIVE conversation's slice at click time.

  // Conversations whose in-flight turn THIS client didn't initiate — a
  // backend-initiated turn (proactive execution review, autonomous
  // continuation, another surface's send). The user-send path owns its own
  // conversation's lifecycle + refetch; for backend turns nothing else
  // does, so the stream listener takes over: it begins the live turn at
  // `started` and ends it (+ refetches the transcript when that thread is
  // focused) at `finished`. A Set because turns run concurrently across
  // threads.
  const backendTurnConversationsRef = useRef<Set<string>>(new Set());
  // Synchronous re-entrancy guard for `send`. The streaming flip updates the
  // store synchronously, but the `streaming` value captured in render closures
  // (e.g. sendOrQueue's gate) stays stale until React re-renders — so two sends
  // dispatched in the same tick can both pass `!streaming` and double-fire a
  // turn. This ref flips the instant a send starts, before any await.
  const sendingRef = useRef(false);

  // Token-level streaming bookkeeping (--include-partial-messages), keyed
  // by conversation id since turns stream concurrently across threads. A
  // conversation joins `sawDeltasRef` the moment a `text_delta` arrives for
  // its turn; once present, its trailing whole `assistant` message text is
  // ignored (it duplicates what the deltas already appended).
  // `deltaBuffersRef` + `deltaRafRef` coalesce a burst of tiny deltas into
  // one store write per conversation per animation frame so the
  // high-frequency `text_delta` stream can't thrash the Zustand store.
  // Reset per conversation on its `started`, flushed on its `finished`.
  const sawDeltasRef = useRef<Set<string>>(new Set());
  const deltaBuffersRef = useRef<Map<string, string>>(new Map());
  const deltaRafRef = useRef<number | null>(null);

  // Async-UX phase 4b — timers for in-turn tool calls. A `tool_use` block in
  // the CLI stream starts a timer; if the tool hasn't returned a
  // `tool_result` within IN_TURN_TOOL_THRESHOLD_MS it's promoted to a
  // visible task (tray + orb dot). Keyed by the CLI's tool_use id; cleared
  // on tool_result, turn end, and unmount. Fast tools never reach the
  // threshold, so they never flicker into the tray.
  const toolTimersRef = useRef<Map<string, number>>(new Map());
  const clearToolTimers = useCallback(() => {
    for (const h of toolTimersRef.current.values()) window.clearTimeout(h);
    toolTimersRef.current.clear();
  }, []);
  useEffect(() => () => clearToolTimers(), [clearToolTimers]);

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
  // Main spoken-reply clip — single-owner, like the progress channel, so two
  // back-to-back replies (non-blocking composer / autonomous beats) don't talk
  // over each other and the user can stop a long answer.
  const mainAudioRef = useRef<HTMLAudioElement | null>(null);
  const mainUrlRef = useRef<string | null>(null);
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

  // Flush buffered token deltas into their conversations' slices, one
  // store write per conversation. Stable (reads the store imperatively) so
  // the listener closure below stays stable across renders.
  const flushDeltaBuffer = useCallback(() => {
    if (deltaRafRef.current !== null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    if (deltaBuffersRef.current.size === 0) return;
    const { appendLiveText } = useCompanionStore.getState();
    for (const [conversationId, chunk] of deltaBuffersRef.current) {
      if (chunk) appendLiveText(conversationId, chunk);
    }
    deltaBuffersRef.current.clear();
  }, []);

  // Subscribe to streaming events from the backend.
  useTauriEvent<CompanionStreamEvent>(
    COMPANION_STREAM_EVENT,
    useCallback(
      (event) => {
        const ev = event.payload;
        // Which thread this event belongs to — the backend stamps the
        // conversation id (`sessionId` on the wire) on every stream event.
        // Old events without one target the migrated default thread.
        const evConversation = ev.sessionId ?? DEFAULT_CONVERSATION_ID;
        // Focus is read at EVENT time (not closure time): the user can
        // switch threads mid-turn, and only the focused thread may touch
        // flat/visible state (transcript, steps, narration, tool tags,
        // recall). Per-conversation live-turn writes below run for EVERY
        // thread — the store's mirror invariant keeps the flat fields in
        // sync when this event's thread is the focused one.
        const store = useCompanionStore.getState();
        const isActive = evConversation === store.activeConversationId;
        // Every focused-thread event resets the soft-progress clock —
        // silence (no events arriving) is what we surface as "still
        // working". Background threads have no visible bubble to reassure.
        if (isActive) lastStreamEventAtRef.current = Date.now();
        if (ev.kind === 'started') {
          // Backend-initiated turn? The user-send path flips its
          // conversation's slice streaming BEFORE the backend emits
          // `started`, so a `started` on a non-streaming conversation has
          // no client send in flight — it came from the proactive scheduler
          // or an autonomous continuation. The listener then owns that
          // turn's lifecycle (see `finished`).
          if (!store.liveTurns[evConversation]?.streaming) {
            backendTurnConversationsRef.current.add(evConversation);
          }
          // Begin the per-conversation live turn: streaming on, text/phase/
          // beat reset, turn id recorded (the Stop button reads it).
          store.beginLiveTurn(evConversation, ev.turnId);
          // New turn — reset this conversation's token-streaming
          // bookkeeping and drop its unflushed deltas from a prior turn.
          sawDeltasRef.current.delete(evConversation);
          deltaBuffersRef.current.delete(evConversation);
          if (!isActive) return;
          // Everything below is flat/visible state owned by the focused
          // thread — a background thread's turn must not clobber it.
          // New turn — drop any leftover in-flight recall strip; the
          // backend will re-emit `recall-preview` once the new prompt
          // is built.
          store.setStreamingRecall(null);
          // Drop the prior turn's operational checklist; the new turn
          // rebuilds it from its own TodoWrite calls.
          store.setStreamingSteps([]);
          // Reset Variant B beat bookkeeping for the new turn.
          beatFiredRef.current = false;
          progressFiredRef.current = 0;
          // Fresh narration timeline for this turn (D2).
          store.beginNarration();
          // Drop any in-turn tool tasks/timers from a prior turn.
          clearToolTimers();
          store.clearInTurnToolJobs();
        } else if (ev.kind === 'cli') {
          // In-turn tool tasks + the narration timeline are flat/visible
          // state — only the focused thread writes them (a background
          // thread's activity surfaces through its roster unread/notice
          // path instead). This block never returns — the line still flows
          // through the phase/text handling below.
          if (isActive) {
            // Time every tool_use; promote a slow one (> threshold, still
            // pending) to a visible task; complete it on its tool_result.
            const toolEvents = extractToolEvents(ev.payload);
            for (const ts of toolEvents.started) {
              // TodoWrite is instant + has its own checklist UI — never a
              // task and never a narration row (the checklist IS its surface).
              if (ts.name === 'TodoWrite') continue;
              // Narration timeline row (D2). The store dedupes by tool_use
              // id, so a re-emitted block can't double-log.
              useCompanionStore.getState().appendNarrationEntry({
                id: ts.id,
                kind: 'tool',
                toolName: ts.name,
                detail: ts.detail,
                at: Date.now(),
              });
              if (toolTimersRef.current.has(ts.id)) continue;
              const startedAt = new Date().toISOString();
              const handle = window.setTimeout(() => {
                toolTimersRef.current.delete(ts.id);
                if (!useCompanionStore.getState().streaming) return;
                useCompanionStore.getState().upsertInTurnToolJob({
                  id: ts.id,
                  kind: 'in_turn_tool',
                  status: 'running',
                  paramsJson: '{}',
                  resultText: null,
                  errorText: null,
                  projectId: null,
                  shortTitle: phaseLabel(t, tx, {
                    kind: 'tool_use',
                    toolName: ts.name,
                    detail: ts.detail,
                  }),
                  parentTurnId:
                    useCompanionStore.getState().liveTurns[evConversation]?.turnId ?? null,
                  progressText: null,
                  progressCurrent: null,
                  progressTotal: null,
                  createdAt: startedAt,
                  startedAt,
                  completedAt: null,
                });
              }, IN_TURN_TOOL_THRESHOLD_MS);
              toolTimersRef.current.set(ts.id, handle);
            }
            for (const doneId of toolEvents.finished) {
              const h = toolTimersRef.current.get(doneId);
              if (h != null) {
                window.clearTimeout(h);
                toolTimersRef.current.delete(doneId);
              }
              useCompanionStore.getState().completeInTurnToolJob(doneId);
              // Stamp the matching narration row's duration (no-op for ids
              // we never logged, e.g. TodoWrite).
              useCompanionStore.getState().completeNarrationTool(doneId);
            }
          }
          // Operational thread: a TodoWrite tool call republishes Athena's
          // full plan. Capture it (latest wins, focused thread only) so the
          // inline checklist tracks progress; the checklist itself is the
          // activity signal, so don't also surface a generic "Using
          // TodoWrite…" phase.
          const steps = extractTodoWrite(ev.payload);
          if (steps) {
            if (isActive) useCompanionStore.getState().setStreamingSteps(steps);
            return;
          }
          // Token-level path: a `stream_event` text_delta. Append it live
          // to the event's conversation (coalesced per frame) and remember
          // that conversation is streaming deltas so its trailing whole
          // `assistant` message doesn't double the text.
          const delta = extractAssistantTextDelta(ev.payload);
          if (delta) {
            // First token of the reply — flip the status to "Composing
            // reply…" once (we no longer render the raw token stream, so
            // without this the bubble would sit on "Thinking…" through the
            // whole answer generation). Set once, not per-token.
            if (!sawDeltasRef.current.has(evConversation)) {
              store.patchLiveTurn(evConversation, { streamingPhase: { kind: 'responding' } });
              sawDeltasRef.current.add(evConversation);
            }
            deltaBuffersRef.current.set(
              evConversation,
              (deltaBuffersRef.current.get(evConversation) ?? '') + delta,
            );
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
            store.patchLiveTurn(evConversation, { streamingPhase: { kind: 'responding' } });
            // If deltas already streamed this turn, this whole-message text
            // is a duplicate of what we appended token-by-token — skip it.
            if (!sawDeltasRef.current.has(evConversation)) {
              store.appendLiveText(evConversation, text);
            }
          } else if (phase) {
            store.patchLiveTurn(evConversation, { streamingPhase: phase });
          }
        } else if (ev.kind === 'finished') {
          // Land any deltas still buffered before the transcript refetch
          // swaps the streaming bubble for the persisted episode.
          flushDeltaBuffer();
          sawDeltasRef.current.delete(evConversation);
          if (isActive) {
            // Promote the streaming recall AND any pending connector_use
            // jobs onto the just-persisted assistant episode so they pin
            // under the now-completed bubble. Payload is the
            // assistant_episode_id. Focused thread only — these promotion
            // targets all live in flat/visible state.
            if (ev.payload) {
              store.attachRecallToEpisode(ev.payload);
              store.attachPendingJobsToEpisode(ev.payload);
              // Pin the operational checklist under the completed bubble.
              store.attachStepsToEpisode(ev.payload);
              // Pin the narration trail under the completed bubble (D2).
              // Trivial trails are dropped inside the attach.
              store.attachNarrationToEpisode(ev.payload);
            } else {
              store.setStreamingRecall(null);
              store.resetStreamingNarration();
            }
            // Clear any in-flight checklist not promoted to an episode.
            store.setStreamingSteps([]);
            // Turn done — drop any lingering in-turn tool tasks/timers.
            clearToolTimers();
            store.clearInTurnToolJobs();
          }
          store.patchLiveTurn(evConversation, { streamingPhase: null, turnId: null });
          // Backend-owned turn (this client never sent it): nothing else
          // ends it or refetches the transcript, so do both here. Client
          // sends end their own conversation's turn in `send()`'s finally —
          // AFTER the fresh transcript lands, so the streaming bubble never
          // gaps. A background thread's finished turn must NOT append into
          // the visible transcript — the roster unread/notice path surfaces
          // it instead.
          if (backendTurnConversationsRef.current.has(evConversation)) {
            backendTurnConversationsRef.current.delete(evConversation);
            store.endLiveTurn(evConversation);
            if (isActive) {
              companionListRecentMessages(50, evConversation)
                .then((msgs) => {
                  // Re-check focus — the user may have switched threads
                  // while the refetch was in flight.
                  if (useCompanionStore.getState().activeConversationId === evConversation) {
                    setMessages(msgs);
                  }
                })
                .catch(silentCatch('companion_list_recent_messages'));
            }
          }
        } else if (ev.kind === 'error') {
          flushDeltaBuffer();
          sawDeltasRef.current.delete(evConversation);
          if (isActive) {
            // Error chip + flat scratch state belong to the focused thread;
            // a background turn's failure stays in its own slice (its
            // thread shows it on focus / via the roster).
            setSendError(ev.payload);
            clearToolTimers();
            store.clearInTurnToolJobs();
            store.setStreamingRecall(null);
            store.setStreamingSteps([]);
            store.resetStreamingNarration();
          }
          store.patchLiveTurn(evConversation, { streamingPhase: null, turnId: null });
          // Backend-owned turn that errored: end it here so the panel
          // doesn't hang on a thinking bubble (no user-send `finally` runs
          // for these).
          if (backendTurnConversationsRef.current.has(evConversation)) {
            backendTurnConversationsRef.current.delete(evConversation);
            store.endLiveTurn(evConversation);
          }
        }
      },
      [
        setSendError,
        flushDeltaBuffer,
        clearToolTimers,
        setMessages,
        t,
        tx,
      ],
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
    // Interrupt targets the ACTIVE conversation's in-flight turn — the Stop
    // button visually belongs to the focused thread, so it must never kill
    // a background thread's stream.
    const s = useCompanionStore.getState();
    const conversationId = s.activeConversationId;
    const turnId = s.liveTurns[conversationId]?.turnId ?? null;
    if (!turnId) return;
    // Optimistically clear so a second click doesn't double-fire while
    // the backend is finalizing the partial reply.
    s.patchLiveTurn(conversationId, { turnId: null });
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
      if (!COMPANION_NAV_ROUTES.includes(route as SidebarSection)) return;
      useSystemStore.getState().setSidebarSection(route as SidebarSection);
      // Briefly ring the destination's primary surface (if one is mapped) so
      // the eye lands on what Athena navigated to. The flash tracker waits for
      // the element to mount, so firing immediately after the route switch is
      // fine; it self-clears and yields to any active walkthrough.
      const flashAnchor = ROUTE_FLASH_ANCHORS[route as SidebarSection];
      if (flashAnchor) useCompanionStore.getState().flashHighlight(flashAnchor);
    }, []),
    'companion_navigate_listen',
  );

  // `start_guided_walkthrough` / `point_at` — Athena guides in-app. A `topic`
  // launches a registry walkthrough (the runner in AthenaGuideLayer walks the
  // authored steps); a `pointAt` rings one allow-listed anchor and narrates as
  // a single-step ad-hoc walkthrough (non-scripted pointing). Both are already
  // validated server-side; the runner stops itself gracefully on anything bad.
  useTauriEvent<CompanionGuideEvent>(
    COMPANION_GUIDE_EVENT,
    useCallback((event) => {
      const topic = event.payload?.topic;
      if (topic) {
        useCompanionStore.getState().startGuidance(topic);
        return;
      }
      const pointAt = event.payload?.pointAt;
      if (pointAt?.anchor && pointAt.narration) {
        const wt = buildPointAtWalkthrough(pointAt.anchor, pointAt.narration);
        if (wt) useCompanionStore.getState().startAdHocGuidance(wt);
        return;
      }
      const composed = event.payload?.composeWalkthrough;
      if (composed?.steps?.length) {
        const wt = buildComposedWalkthrough(composed.steps, composed.title);
        if (wt) useCompanionStore.getState().startAdHocGuidance(wt);
      }
    }, []),
    'companion_guide_listen',
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
      useCompanionStore.getState().flashHighlight('cockpit-panel', {
        label: getActiveTranslations().plugins.companion.guide_flash_composed,
      });
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
      useCompanionStore.getState().flashHighlight('cockpit-panel', {
        label: getActiveTranslations().plugins.companion.guide_flash_composed,
      });
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

  // Bottom-aware autoscroll: pin to the bottom on new content only while the
  // user is already there; once they scroll up to read history, leave them be
  // and surface the jump-to-latest pill (gated on `atBottom`) instead.
  const { scrollRef, atBottom, scrollToBottom, maybeAutoScroll } = useChatScroll();
  useEffect(maybeAutoScroll, [messages, streamingText, streaming, maybeAutoScroll]);

  // Voice is "active" only when the chosen engine has everything it
  // needs: ElevenLabs requires a credential + voice id; Piper requires
  // only a voice id (the engine binary lookup happens at synthesis time
  // and surfaces a clear install hint if missing). The send pipeline
  // checks this before asking the backend to emit a TTS line — there's
  // no point generating a spoken summary we can't synthesize.
  const voiceActive = voiceEnabled && voice.configured;
  // Engine-specific identifiers for synthesis, resolved upstream by
  // `useTtsVoiceSelection` (credentialId is null for the local engines).
  const synthesisCredentialId = voice.credentialId;
  const synthesisVoiceId = voice.voiceId;

  // Stop + release any in-flight spoken-progress clip (ack / heartbeat).
  const stopProgressAudio = useCallback(() => {
    progressAudioRef.current?.pause();
    progressAudioRef.current = null;
    if (progressUrlRef.current) {
      URL.revokeObjectURL(progressUrlRef.current);
      progressUrlRef.current = null;
    }
  }, []);

  // Stop + release the in-flight main spoken reply (so a new reply, or closing
  // the panel mid-speech, never leaves two answers playing at once).
  const stopMainAudio = useCallback(() => {
    mainAudioRef.current?.pause();
    mainAudioRef.current = null;
    if (mainUrlRef.current) {
      URL.revokeObjectURL(mainUrlRef.current);
      mainUrlRef.current = null;
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
      synthesizeTts(text, synthesisCredentialId, synthesisVoiceId, voiceSettings, voice.engine)
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
    [voiceActive, synthesisVoiceId, synthesisCredentialId, voiceSettings, voice.engine, stopProgressAudio],
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
      // Log the beat into the narration timeline (D2) so it survives in
      // the live log + the post-turn trail instead of latest-wins only.
      useCompanionStore.getState().appendNarrationEntry({
        id: `beat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'beat',
        text,
        at: Date.now(),
      });
      playProgressClip(text);
    },
    [playProgressClip],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Re-entrancy guard: a turn is already starting/running. Without this,
      // two rapid sends both pass sendOrQueue's stale-closure gate and call
      // send() concurrently, producing duplicate turns. Cleared in finally.
      if (sendingRef.current) return;
      sendingRef.current = true;
      // Pin the turn to the conversation focused at send time — the user
      // can switch threads while the turn runs, and every lifecycle write
      // below must keep targeting THIS thread's slice, not whatever thread
      // happens to be focused when the promise settles.
      const conversationId = useCompanionStore.getState().activeConversationId;
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
      // Raise this conversation's streaming flag before the IPC round-trip
      // so the `started` handler can tell a client-owned turn from a
      // backend-initiated one. Text + beat reset with it.
      useCompanionStore.getState().patchLiveTurn(conversationId, {
        streaming: true,
        streamingText: '',
        streamingBeat: null,
      });
      // Fresh turn — reset spoken-progress tiers + beat bookkeeping and
      // silence any leftover progress clip.
      spokenTiersRef.current.clear();
      beatFiredRef.current = false;
      progressFiredRef.current = 0;
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
          undefined,
          conversationId,
        );
        // Refresh canonical transcript from backend (replaces the optimistic
        // user bubble with the persisted episode + adds the assistant turn).
        // Only when this thread is STILL the focused one — the visible
        // transcript and quick-reply chips belong to whatever thread the
        // user is looking at now.
        const fresh = await companionListRecentMessages(50, conversationId);
        if (useCompanionStore.getState().activeConversationId === conversationId) {
          setMessages(fresh);
          if (result.quickReplies && result.quickReplies.length > 0) {
            setQuickReplies(result.quickReplies);
          }
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
          // The real reply is committed — cut off any ack/heartbeat clip AND
          // any still-playing prior reply so they don't talk over this answer.
          stopProgressAudio();
          stopMainAudio();
          synthesizeTts(
            result.ttsText,
            synthesisCredentialId,
            synthesisVoiceId,
            voiceSettings,
            voice.engine,
          )
            .then((url) => {
              setPlaybackAudioUrl(url);
              // Single-owner: a reply that lands while this one is still playing
              // calls stopMainAudio() above first, so they never stack.
              mainUrlRef.current = url;
              const { audio, done } = playAudio(url);
              mainAudioRef.current = audio;
              done
                .then(() => markPlaybackPlayed())
                .catch(silentCatch('companion_tts_play'))
                .finally(() => {
                  if (mainUrlRef.current === url) {
                    URL.revokeObjectURL(url);
                    mainUrlRef.current = null;
                    mainAudioRef.current = null;
                  }
                });
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
        // exit: streaming:false first unmounts the bubble, then we clear
        // the in-flight scratch fields. If we wiped streamingText first
        // the bubble would briefly show an empty body mid-exit. Both
        // patches target the send-time conversation — never whatever
        // thread is focused now.
        useCompanionStore.getState().patchLiveTurn(conversationId, {
          streaming: false,
          turnId: null,
        });
        // streamingPhase is owned by the stream-event handler on the
        // `finished`/`error` paths, but the IPC rejection path skips the
        // stream-event channel entirely (the backend never got far enough
        // to emit one), so an explicit reset here is the safety net.
        useCompanionStore.getState().patchLiveTurn(conversationId, {
          streamingText: '',
          streamingPhase: null,
          streamingBeat: null,
        });
        // Same safety net for in-turn tool tasks/timers: an IPC rejection skips
        // the stream-event channel, so the `finished`/`error` handlers that
        // normally clear these never run — leaving ghost "running" tasks
        // stranded in the ActivityTray forever. No-op on the normal paths
        // (already cleared on `finished`/`error`).
        clearToolTimers();
        useCompanionStore.getState().clearInTurnToolJobs();
        sendingRef.current = false;
      }
    },
    [appendMessage, markPlaybackPlayed, setMessages, setPendingPlayback, setPlaybackAudioUrl, setQuickReplies, setChatCards, setSendError, stopProgressAudio, stopMainAudio, voiceActive, voice.engine, synthesisCredentialId, synthesisVoiceId, voiceSettings, recallSynthesisEnabled, autonomousMode, clearToolTimers],
  );

  // Async-UX phase 4 — non-blocking send. The composer is never disabled;
  // a message typed while a turn is still streaming is classified and
  // either interrupts the in-flight turn (redirect / "stop") or queues
  // behind it (additive / ambiguous). When idle it sends directly.
  const sendOrQueue = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Gate on the live store value (+ the in-flight ref), not the render
      // closure `streaming`: the closure lags a render behind the streaming
      // flip, so two sends in one tick would both fall into the direct-send
      // branch. The flat mirror IS the focused thread's streaming state.
      const s = useCompanionStore.getState();
      if (!s.streaming && !sendingRef.current) {
        void send(trimmed);
        return;
      }
      const mode = classifyMidTurnIntent(trimmed);
      // Queue on the focused thread — the drain effect shifts from this
      // same thread's queue when ITS turn completes.
      s.enqueueMessage(s.activeConversationId, trimmed, mode);
      // A redirect stops the current turn now; the drain effect fires the
      // queued message the instant `streaming` flips false.
      if (mode === 'interrupt') handleInterrupt();
    },
    [send, handleInterrupt],
  );

  // Drain the queue one message per turn completion. Watches the streaming
  // true→false edge on the flat mirror (= the ACTIVE conversation); if
  // anything is waiting in THAT conversation's queue it shifts the oldest
  // and sends it. `send` sets streaming back to true, so this fires at
  // most once per completed turn — preserving FIFO order without colliding
  // with the autonomous-continuation chain. Switching from a streaming
  // thread to an idle one also flips the mirror false, but that's a view
  // change, not a completed turn — the same-thread guard skips it.
  const prevStreamingForQueueRef = useRef(streaming);
  const prevActiveForQueueRef = useRef(activeConversationId);
  useEffect(() => {
    const was = prevStreamingForQueueRef.current;
    const wasConversation = prevActiveForQueueRef.current;
    prevStreamingForQueueRef.current = streaming;
    prevActiveForQueueRef.current = activeConversationId;
    if (was && !streaming && wasConversation === activeConversationId) {
      const next = useCompanionStore.getState().shiftQueuedMessage(activeConversationId);
      if (next) void send(next.text);
    }
  }, [streaming, activeConversationId, send]);

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
    // Claim atomically against the live store: StrictMode's dev double-invoke
    // reuses the same `voiceTurnRequest` closure, and `send()` flips `streaming`
    // asynchronously, so reading the closure value would fire `send` twice.
    // Reading fresh from the store and clearing makes the second invoke see
    // null and bail.
    const req = useCompanionStore.getState().voiceTurnRequest;
    if (!req) return;
    useCompanionStore.getState().setVoiceTurnRequest(null);
    void send(req);
  }, [voiceTurnRequest, streaming, send]);

  // App-initiated chat starters (e.g. the Add-KPI modal's "Ask Athena" action):
  // OPEN the panel and send the preset, beginning a guided conversation. Same
  // atomic claim-against-the-store pattern as the voice turn above.
  const pendingChatPrompt = useCompanionStore((s) => s.pendingChatPrompt);
  useEffect(() => {
    if (!pendingChatPrompt || streaming) return;
    const req = useCompanionStore.getState().pendingChatPrompt;
    if (!req) return;
    useCompanionStore.getState().setPendingChatPrompt(null);
    useCompanionStore.getState().setState('open');
    void send(req);
  }, [pendingChatPrompt, streaming, send]);

  // Slice 6 — speak the hands-free decision aloud ONLY on Explain/Recommend.
  // The decision text/description is NOT auto-read when the bubble surfaces
  // (it's on-screen to read); Athena speaks only when the user picks `0`
  // (explain), reading the `recommendation`. Markdown is stripped first so she
  // never reads `**` / `-` aloud. Best-effort via the one-shot progress channel
  // (`playProgressClip` no-ops when voice is off). Keyed on the decision id so
  // the recommendation speaks exactly once, never on every render.
  const decisionId = useCompanionStore((s) => s.pendingDecision?.id ?? null);
  const decisionExplained = useCompanionStore((s) => s.decisionExplained);
  const spokenRecommendationForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!decisionId) {
      spokenRecommendationForRef.current = null;
      return;
    }
    if (!decisionExplained) return;
    if (spokenRecommendationForRef.current === decisionId) return;
    spokenRecommendationForRef.current = decisionId;
    const rec = useCompanionStore.getState().pendingDecision?.recommendation;
    if (rec) playProgressClip(stripMarkdownForSpeech(rec));
  }, [decisionId, decisionExplained, playProgressClip]);

  return (
    <div className="flex flex-row flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-w-0">
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-3 scrollbar-thin companion-scroll">
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
            {/* message_attention rows are per-message decision-queue items (C1);
                they're already aggregated on the message_digest card, so they
                don't render as standalone panel cards here. */}
            {proactive.filter((m) => m.triggerKind !== 'message_attention').map((m) => (
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
            <WelcomeHero
              onPick={(text) => void send(text)}
              disabled={!initialized || streaming}
            />
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
              const next = i < messages.length - 1 ? messages[i + 1] : undefined;
              // Group consecutive same-role messages: only the first shows the
              // avatar, and the run is pulled tighter together. PROGRESS asides
              // are a distinct visual kind even though they're role=assistant —
              // treat them separately so a real reply after an aside still
              // shows its avatar (and asides cluster among themselves).
              const kindOf = (msg?: { role: string; content: string }) =>
                msg
                  ? msg.role === 'assistant' && msg.content.trimStart().startsWith('PROGRESS:')
                    ? 'assistant-aside'
                    : msg.role
                  : '';
              const myKind = kindOf(m);
              const groupStart = !prev || kindOf(prev) !== myKind;
              const groupEnd = !next || kindOf(next) !== myKind;
              // Day separator above the first message of each new calendar day.
              const daySep =
                m.createdAt &&
                (!prev?.createdAt ||
                  !sameLocalDay(new Date(prev.createdAt), new Date(m.createdAt)))
                  ? daySeparatorLabel(
                      m.createdAt,
                      t.plugins.companion.day_today,
                      t.plugins.companion.day_yesterday,
                    )
                  : null;
              const priorUser =
                isLastAssistant && prev?.role === 'user' ? prev.content : '';
              const connectorJobIds =
                m.role === 'assistant'
                  ? connectorJobIdsByEpisodeId[m.id] ?? []
                  : [];
              const steps =
                m.role === 'assistant' ? stepsByEpisodeId[m.id] : undefined;
              const narration =
                m.role === 'assistant' ? narrationByEpisodeId[m.id] : undefined;
              return (
                <div key={m.id} className="space-y-1 animate-fade-slide-in">
                  {daySep && (
                    <div
                      className="flex items-center gap-2 my-1"
                      data-testid="companion-day-separator"
                    >
                      <div className="flex-1 h-px bg-foreground/10" aria-hidden />
                      <span className="rounded-full bg-foreground/[0.06] border border-foreground/10 px-2.5 py-0.5 typo-caption text-foreground">
                        {daySep}
                      </span>
                      <div className="flex-1 h-px bg-foreground/10" aria-hidden />
                    </div>
                  )}
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
                    createdAt={m.createdAt}
                    groupStart={groupStart}
                    groupEnd={groupEnd}
                  >
                    {m.content}
                  </Bubble>
                  {steps && steps.length > 0 && (
                    <OperationalThread steps={steps} />
                  )}
                  {narration && <NarrationTrail narration={narration} />}
                  {connectorJobIds.map((jobId) => {
                    const job = jobsById[jobId];
                    if (!job) return null;
                    return job.kind === 'connector_use' ? (
                      <ConnectorCallCard key={jobId} job={job} />
                    ) : (
                      <TaskTag key={jobId} job={job} />
                    );
                  })}
                  {summary && (
                    <TurnSummaryChip
                      summary={summary}
                      onJump={handleTurnSummaryJump}
                    />
                  )}
                  {isLastAssistant && priorUser && !streaming && (
                    <RefineChips
                      priorUserMessage={priorUser}
                      onSend={send}
                      disabled={!initialized || streaming}
                    />
                  )}
                  {isLastAssistant && !streaming && m.content.trim() && (
                    <BubbleReadAloud
                      content={m.content}
                      voice={voice}
                      voiceSettings={voiceSettings}
                    />
                  )}
                </div>
              );
            });
          })()}
          {/*
            a11y — the chat bubbles are not inside a live region, so a
            screen reader never hears an assistant reply land. Mirror the
            latest *completed* assistant turn into a visually-hidden polite
            region; it updates (and is announced) once streaming finishes
            and the full reply is in `messages`.
          */}
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {!streaming
              ? (() => {
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'assistant') return messages[i]?.content ?? '';
                  }
                  return '';
                })()
              : ''}
          </span>
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
                        derived phase; fall back to phase, then "Thinking…".
                        Animated dots signal "in progress" alongside the label. */}
                    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
                      <span>
                        {streamingBeat ??
                          (streamingPhase
                            ? phaseLabel(t, tx, streamingPhase)
                            : t.plugins.companion.thinking)}
                      </span>
                      <TypingDots />
                    </span>
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
                  Live narration log (D2): the dimmed history of beats +
                  tool calls so far this turn. The bubble's status line
                  above is the bold "now"; this is how she got here.
                */}
                {streamingNarration.length > 0 && (
                  <NarrationLiveLog entries={streamingNarration} />
                )}
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
                      className={`flex items-center gap-2 rounded-card border px-3 py-1.5 typo-caption ${
                        slowLevel === 2
                          ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300'
                          : 'border-foreground/10 bg-foreground/[0.04] text-foreground'
                      }`}
                      data-testid="companion-slow-progress"
                      data-slow-level={slowLevel}
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>
                        {slowLevel === 2
                          ? t.plugins.companion.slow_progress_firm
                          : t.plugins.companion.slow_progress_soft}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
                {pendingConnectorJobIds.map((jobId) => {
                  const job = jobsById[jobId];
                  if (!job) return null;
                  return job.kind === 'connector_use' ? (
                    <ConnectorCallCard key={jobId} job={job} />
                  ) : (
                    <TaskTag key={jobId} job={job} />
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
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
                      companionListRecentMessages(50, useCompanionStore.getState().activeConversationId)
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
            <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400 flex items-start justify-between gap-3">
              {/* The store keeps the RAW error (retry/debug); render the
                  registry-translated message so the scariest moment of the
                  chat isn't hardcoded English on a non-English UI
                  (2026-07-16 UAT F-MAJOR-10). */}
              <span className="min-w-0 break-words">
                {resolveErrorTranslated(t, sendError).message}
              </span>
              {(() => {
                // On a failed turn the optimistic user bubble stays in
                // `messages`, so the last user message is what we re-send.
                const lastUser = [...messages]
                  .reverse()
                  .find((m) => m.role === 'user');
                if (!lastUser) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setSendError(null);
                      void send(lastUser.content);
                    }}
                    disabled={streaming}
                    className="shrink-0 inline-flex items-center gap-1 rounded-interactive border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 text-rose-400 font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="companion-retry-send"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t.common.retry}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
          {!atBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-secondary/95 border border-foreground/15 shadow-elevation-3 px-3 py-1.5 typo-caption font-medium text-foreground hover:bg-secondary backdrop-blur-sm transition-colors focus-ring animate-fade-slide-in"
              data-testid="companion-jump-to-latest"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {t.plugins.companion.jump_to_latest}
            </button>
          )}
        </div>
        <ActivityTray />
        <QueuedMessages />
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
          // Async-UX phase 4: the composer is intentionally NOT disabled
          // while streaming — mid-turn input is routed through sendOrQueue
          // (interrupt vs queue) instead of being blocked.
          disabled={!initialized || brainView.open}
          onSend={sendOrQueue}
          onAnalyzeFleet={() => {
            // Deterministic trigger — bypasses the chat turn so Athena can't
            // shortcut to an inline read; spawns the rubric-graded analysis turn
            // (which streams back into this panel) + writes the timeline note.
            void companionAnalyzeFleet().catch(silentCatch('companion_analyze_fleet'));
            useToastStore.getState().addToast(t.plugins.companion.analyze_fleet_started, 'success');
          }}
          onDailyBrief={() => {
            // Deterministic trigger — pre-gathers the three operational inboxes
            // (Messages / Human Review / Incidents) from the execution store and
            // spawns a proactive turn that summarizes them in this panel. Bypasses
            // chat so Athena can't shortcut past her wrong-DB connector.
            void companionDailyBrief().catch(silentCatch('companion_daily_brief'));
            useToastStore.getState().addToast(t.plugins.companion.daily_brief_started, 'success');
          }}
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
        onOpenBrain={() =>
          setBrainView({
            open: !brainView.open,
            kind: brainView.open ? null : null,
            id: null,
          })
        }
        brainOpen={brainView.open}
        disabled={!initialized || streaming}
        compact={compact}
        onToggleCompact={onToggleCompact}
      />
    </div>
  );
}
