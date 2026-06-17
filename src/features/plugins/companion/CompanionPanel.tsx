import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  BookOpen,
  Bot,
  Infinity as InfinityIcon,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Square,
  X,
} from 'lucide-react';
import { useTranslation, getActiveTranslations } from '@/i18n/useTranslation';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { useCompanionStore } from './companionStore';
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
  companionInterruptTurn,
  companionReingestDoctrine,
  companionRequestImprovement,
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
import { ApprovalCard } from './ApprovalCard';
import { McpRequestPanel } from './mcp/McpRequestPanel';
import { LiveOpsStrip } from './orchestration/LiveOpsStrip';
import { InlineChatCard } from './InlineChatCard';
import { CompanionAssignmentCards } from './CompanionAssignmentCards';
import { useCompanionAssignmentBridge } from './useCompanionAssignmentBridge';
import { ProactiveCard } from './ProactiveCard';
import { AthenaAvatar } from './AthenaAvatar';
import { WakeCadence } from './WakeCadence';
import { BrainViewer } from './BrainViewer';
import { CompanionToolbar } from './CompanionToolbar';
import { ConnectorCallCard } from './ConnectorCallCard';
import { RecallStrip } from './RecallStrip';
import { ActivityTray } from './ActivityTray';
import { TaskTag } from './TaskTag';
import { QueuedMessages } from './QueuedMessages';
import { WelcomeHero } from './WelcomeHero';
import { TypingDots } from './TypingDots';
import { useChatScroll } from './useChatScroll';
import { ChatSearch } from './ChatSearch';
import { classifyMidTurnIntent } from './midTurnIntent';
import { RefineChips } from './RefineChips';
import { BubbleReadAloud } from './BubbleReadAloud';
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

/**
 * Serialize the visible conversation to role-labeled markdown for the "copy
 * conversation" header action. System markers are dropped; turns are separated
 * by a horizontal rule so the result pastes cleanly into notes or an issue.
 */
function buildTranscriptMarkdown(
  messages: ReturnType<typeof useCompanionStore.getState>['messages'],
  youLabel: string,
  athenaLabel: string,
): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const label = m.role === 'user' ? youLabel : athenaLabel;
      return `**${label}:**\n\n${m.content.trim()}`;
    })
    .join('\n\n---\n\n');
}

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
  const conversationMarkdown = useMemo(
    () =>
      buildTranscriptMarkdown(
        messages,
        t.plugins.companion.you_label,
        t.plugins.companion.name,
      ),
    [messages, t.plugins.companion.you_label, t.plugins.companion.name],
  );
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
            transcript={conversationMarkdown}
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
          />
          {autonomousMode && <WakeCadence />}
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
  transcript,
  onClose,
  onReset,
  onRefreshDoctrine,
  compact,
  onToggleCompact,
  autonomousMode,
  onToggleAutonomousMode,
}: {
  transcript: string;
  onClose: () => void;
  onReset: () => void;
  onRefreshDoctrine: () => void;
  compact: boolean;
  onToggleCompact: () => void;
  autonomousMode: boolean;
  onToggleAutonomousMode: () => void;
}) {
  const { t } = useTranslation();
  const searchOpen = useCompanionStore((s) => s.chatSearchOpen);
  const setSearchOpen = useCompanionStore((s) => s.setChatSearchOpen);
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
          onClick={() => setSearchOpen(!searchOpen)}
          data-testid="companion-toggle-search"
          aria-pressed={searchOpen}
          className={`p-1.5 rounded-interactive transition-colors focus-ring ${
            searchOpen
              ? 'bg-primary/15 text-primary hover:bg-primary/20'
              : 'text-foreground hover:text-foreground hover:bg-foreground/5'
          }`}
          aria-label={t.plugins.companion.search_toggle}
          title={t.plugins.companion.search_toggle}
        >
          <Search className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />
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
        <div className="w-px h-5 bg-foreground/15 mx-0.5" aria-hidden />
        {transcript && (
          <CopyButton
            text={transcript}
            tooltip={t.plugins.companion.copy_conversation}
            iconSize="w-4 h-4"
          />
        )}
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
  // Narration timeline (beats + tool calls). Live log under the streaming
  // bubble; collapsed trail under the completed one.
  const streamingNarration = useCompanionStore((s) => s.streamingNarration);
  const narrationByEpisodeId = useCompanionStore((s) => s.narrationByEpisodeId);

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

  // True while a turn THIS client didn't initiate is streaming — a
  // backend-initiated turn (proactive execution review, autonomous
  // continuation). The user-send path owns its own streaming + refetch;
  // for backend turns nothing else does, so the stream listener takes
  // over: it flips `streaming` on at `started` and refetches the
  // transcript at `finished` so the new assistant bubble actually
  // appears in the panel instead of only landing in the brain.
  const backendTurnActiveRef = useRef(false);
  // Synchronous re-entrancy guard for `send`. `setStreaming(true)` updates the
  // store synchronously, but the `streaming` value captured in render closures
  // (e.g. sendOrQueue's gate) stays stale until React re-renders — so two sends
  // dispatched in the same tick can both pass `!streaming` and double-fire a
  // turn. This ref flips the instant a send starts, before any await.
  const sendingRef = useRef(false);

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
          // Backend-initiated turn? The user-send path sets `streaming`
          // true synchronously BEFORE the backend emits `started`, so if
          // we see `started` while not streaming, no client send is in
          // flight — this turn came from the proactive scheduler or an
          // autonomous continuation. Flip streaming on so the thinking
          // bubble shows; the `finished` handler refetches the transcript.
          if (!useCompanionStore.getState().streaming) {
            backendTurnActiveRef.current = true;
            setStreaming(true);
          }
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
          // Fresh narration timeline for this turn (D2).
          useCompanionStore.getState().beginNarration();
          // Drop any in-turn tool tasks/timers from a prior turn.
          clearToolTimers();
          useCompanionStore.getState().clearInTurnToolJobs();
        } else if (ev.kind === 'cli') {
          // In-turn tool tasks: time every tool_use; promote a slow one
          // (> threshold, still pending) to a visible task; complete it on
          // its tool_result. This runs first and never returns — the line
          // still flows through the phase/text handling below.
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
                parentTurnId: currentTurnIdRef.current,
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
            // Pin the narration trail under the completed bubble (D2).
            // Trivial trails are dropped inside the attach.
            useCompanionStore.getState().attachNarrationToEpisode(ev.payload);
          } else {
            useCompanionStore.getState().setStreamingRecall(null);
            useCompanionStore.getState().resetStreamingNarration();
          }
          useCompanionStore.getState().setStreamingPhase(null);
          // Clear any in-flight checklist not promoted to an episode.
          useCompanionStore.getState().setStreamingSteps([]);
          // Turn done — drop any lingering in-turn tool tasks/timers.
          clearToolTimers();
          useCompanionStore.getState().clearInTurnToolJobs();
          currentTurnIdRef.current = null;
          // Backend-initiated turn: nothing else will refetch the
          // transcript (the user-send path isn't involved), so do it
          // here and drop the streaming flag we raised at `started`.
          if (backendTurnActiveRef.current) {
            backendTurnActiveRef.current = false;
            setStreaming(false);
            companionListRecentMessages(50)
              .then((msgs) => setMessages(msgs))
              .catch(silentCatch('companion_list_recent_messages'));
          }
        } else if (ev.kind === 'error') {
          flushDeltaBuffer();
          sawDeltasRef.current = false;
          setSendError(ev.payload);
          clearToolTimers();
          useCompanionStore.getState().clearInTurnToolJobs();
          useCompanionStore.getState().setStreamingRecall(null);
          useCompanionStore.getState().setStreamingPhase(null);
          useCompanionStore.getState().setStreamingSteps([]);
          useCompanionStore.getState().resetStreamingNarration();
          currentTurnIdRef.current = null;
          // Backend-initiated turn that errored: clear the streaming flag
          // we raised at `started` so the panel doesn't hang on a thinking
          // bubble (no user-send `finally` runs for these).
          if (backendTurnActiveRef.current) {
            backendTurnActiveRef.current = false;
            setStreaming(false);
          }
        }
      },
      [
        appendStreamingText,
        setSendError,
        flushDeltaBuffer,
        clearToolTimers,
        setMessages,
        setStreaming,
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
          // The real reply is committed — cut off any ack/heartbeat clip AND
          // any still-playing prior reply so they don't talk over this answer.
          stopProgressAudio();
          stopMainAudio();
          synthesizeTts(
            result.ttsText,
            synthesisCredentialId,
            synthesisVoiceId,
            voiceSettings,
            voiceEngine,
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
    [appendMessage, markPlaybackPlayed, resetStreamingText, setMessages, setPendingPlayback, setPlaybackAudioUrl, setQuickReplies, setChatCards, setSendError, setStreaming, stopProgressAudio, stopMainAudio, voiceActive, voiceEngine, synthesisCredentialId, synthesisVoiceId, voiceSettings, recallSynthesisEnabled, autonomousMode, clearToolTimers],
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
      // closure `streaming`: the closure lags a render behind setStreaming(true),
      // so two sends in one tick would both fall into the direct-send branch.
      if (!useCompanionStore.getState().streaming && !sendingRef.current) {
        void send(trimmed);
        return;
      }
      const mode = classifyMidTurnIntent(trimmed);
      useCompanionStore.getState().enqueueMessage(trimmed, mode);
      // A redirect stops the current turn now; the drain effect fires the
      // queued message the instant `streaming` flips false.
      if (mode === 'interrupt') handleInterrupt();
    },
    [send, handleInterrupt],
  );

  // Drain the queue one message per turn completion. Watches the streaming
  // true→false edge; if anything is waiting (and we're not mid self-
  // improve) it shifts the oldest and sends it. `send` sets streaming back
  // to true, so this fires at most once per completed turn — preserving
  // FIFO order without colliding with the autonomous-continuation chain.
  const prevStreamingForQueueRef = useRef(streaming);
  useEffect(() => {
    const was = prevStreamingForQueueRef.current;
    prevStreamingForQueueRef.current = streaming;
    if (was && !streaming && !improving) {
      const next = useCompanionStore.getState().shiftQueuedMessage();
      if (next) void send(next.text);
    }
  }, [streaming, improving, send]);

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
        <div className="relative flex-1 min-h-0 flex flex-col">
        <ChatSearch messages={messages} onOpenInBrain={handleOpenInBrain} />
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
            <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400 flex items-start justify-between gap-3">
              <span className="min-w-0 break-words">{sendError}</span>
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
          disabled={!initialized || brainView.open || improving}
          onSend={sendOrQueue}
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
