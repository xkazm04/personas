import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AppWindow,
  ChevronDown,
  ChevronUp,
  DraftingCompass,
  CircleStop,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Square,
  Wand2,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guide/guideCopy';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { QUEUED_NOTES_MAX, useStudioStore } from './studioStore';
import StudioBuildSettings from './StudioBuildSettings';
import StudioMessages from './StudioMessages';
import { phaseProgress } from './studioBuildModel';
import { classifyMidTurnIntent } from '@/features/companions/athena/midTurnIntent';
import { isStopOnly } from './studioSeed';

// The Studio dock — a thin toolbar over the input row, docked bottom-center
// over the frame. Every control lives on the toolbar so the input row is the
// field and Send alone. Guide draws the latest message, the question and the
// next moves itself; the chevron expands the full conversation above. A note
// typed while Athena works is queued for her next step instead of refused. The
// goals button shows or hides the goals rail beside the frame.

export type StudioFrameView = 'plan' | 'app';

export default function StudioChatInput({
  goals,
  view,
}: {
  /** The goals rail beside the frame: whether it shows, and the toggle. */
  goals?: { open: boolean; onToggle: () => void };
  /** What the main frame shows, the plan sheet or the running app. The App
   *  side waits for a live preview; without one there is nothing to show. */
  view?: { showing: StudioFrameView; appReady: boolean; onChange: (v: StudioFrameView) => void };
} = {}) {
  const { t, tx } = useTranslation();
  const [input, setInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  // The step (by its start time) whose queue refused a note; the notice is
  // about that step only and is gone once the next one starts.
  const [queueFullTurn, setQueueFullTurn] = useState<number | null>(null);
  const { shouldAnimate } = useMotion();
  const activeId = useStudioStore((s) => s.activeId);
  // Perf: select only the fields the dock renders (shallow-compared) instead of
  // the whole runtime — the runtime object is replaced on every CLI stream
  // delta, which would re-render the dock tens of times per second mid-build.
  // `phases` stays reference-stable across stream patches, so shallow holds.
  const rt = useStudioStore(
    useShallow((s) => {
      const r = s.activeId ? s.runtimes[s.activeId] : undefined;
      if (!r) return undefined;
      return {
        busy: r.busy,
        question: r.question,
        autonomous: r.autonomous,
        name: r.name,
        phases: r.phases,
        stopNoop: r.stopNoop,
        turnStartedAt: r.turnStartedAt,
      };
    }),
  );
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const startAutonomous = useStudioStore((s) => s.startAutonomous);
  const stopAutonomous = useStudioStore((s) => s.stopAutonomous);
  const stopTurn = useStudioStore((s) => s.stopTurn);
  const queueNote = useStudioStore((s) => s.queueNote);

  if (!activeId || !rt) return null;
  const { busy, question, autonomous, name, phases, stopNoop, turnStartedAt } = rt;
  const working = busy || autonomous;
  const queueFull = working && queueFullTurn !== null && queueFullTurn === (turnStartedAt ?? 0);
  const { done, total } = phaseProgress(phases ?? []);
  const hasPlan = total > 0;

  // 2a — subtle inner glow that reads the input's state at a glance: purple when
  // Athena needs a decision, blue while she's working, plain otherwise.
  const stateShadow = question
    ? 'inset 0 0 0 1px rgba(168,85,247,0.55), inset 0 1px 14px rgba(168,85,247,0.22), 0 8px 24px -8px rgba(0,0,0,0.45)'
    : working
      ? 'inset 0 0 0 1px rgba(96,165,250,0.50), inset 0 1px 14px rgba(96,165,250,0.18), 0 8px 24px -8px rgba(0,0,0,0.45)'
      : undefined;

  const send = () => {
    const text = input.trim();
    if (!text) return;
    if (working) {
      // A bare stop word only stops: queued, it became the sole note of a new
      // turn told to carry on.
      if (isStopOnly(text)) {
        setInput('');
        if (busy) stopTurn(activeId);
        return;
      }
      // A full queue refuses the note and says so; the text stays in the box.
      if (!queueNote(activeId, text)) {
        setQueueFullTurn(turnStartedAt ?? 0);
        return;
      }
      setInput('');
      setQueueFullTurn(null);
      // Athena's mid-turn rule: a clear redirect ("actually,", "instead,")
      // interrupts the running step and its note goes with the next one (the
      // queue pump sends it); anything else waits for the step to end.
      if (classifyMidTurnIntent(text) === 'interrupt' && busy) stopTurn(activeId, { pumpNotes: true });
      return;
    }
    setInput('');
    void sendTurn(activeId, text);
  };

  // C5 — design-reference image: pick a file and pass its PATH to the build turn
  // (Claude Code reads the image). File path, not clipboard — Windows paste is broken.
  const pickReference = async () => {
    if (working) return;
    const path = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (typeof path === 'string') {
      void sendTurn(
        activeId,
        `Use the design reference image at "${path}" as inspiration — read the image first, then match its visual style (layout, colour, typography, mood) while keeping the real content we already have.`,
      );
    }
  };

  return (
    <>
      {/* Dock — a full-width row so the column stays centred over the frame. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-8">
        <div
          className={`flex w-full flex-col gap-2 transition-[max-width] duration-200 ${
            chatOpen ? 'max-w-[46rem]' : 'max-w-[38rem]'
          }`}
        >
          {/* Expanded body — the full conversation */}
          <AnimatePresence initial={false}>
            {chatOpen && (
              <motion.div
                key="studio-conversation"
                initial={shouldAnimate ? { opacity: 0, y: 8, scale: 0.985 } : { opacity: 0 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldAnimate ? { opacity: 0, y: 8, scale: 0.985 } : { opacity: 0 }}
                transition={{ duration: shouldAnimate ? 0.2 : 0.12, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformOrigin: 'bottom center' }}
                className="pointer-events-auto flex max-h-[56vh] flex-col overflow-hidden rounded-modal border border-border bg-background shadow-elevation-4"
              >
                <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-primary/70" />
                  <span className="typo-label text-foreground/90">
                    {t.studio.conversation}
                  </span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setChatOpen(false)}
                    aria-label={t.studio.collapse}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                  <StudioMessages expanded />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stop found nothing to interrupt. Saying so is the whole point: the
              dock has just been released early, and without a line here that
              reads as the build having finished. */}
          {/* The live region is ALWAYS mounted and starts empty — a region born
              with its message is never announced (census:
              live-region-born-with-its-message); the chrome appears with the text. */}
          <p
            role="status"
            data-testid={stopNoop && !working ? 'studio-stop-noop' : undefined}
            className={stopNoop && !working
              ? 'pointer-events-auto self-center rounded-full border border-border bg-background/80 px-3 py-1 typo-caption shadow-elevation-1'
              : 'sr-only'}
          >
            {stopNoop && !working ? t.studio.stop_nothing_running : null}
          </p>
          <p
            role="status"
            data-testid={queueFull ? 'studio-queue-full' : undefined}
            className={queueFull
              ? 'pointer-events-auto self-center rounded-full border border-status-warning/60 bg-background/80 px-3 py-1 typo-caption text-status-warning shadow-elevation-1'
              : 'sr-only'}
          >
            {queueFull ? tx(guideStrings(t).notes_full, { max: QUEUED_NOTES_MAX }) : null}
          </p>

          {/* Toolbar — every control on one thin row above the field, so the
              field takes the whole input row and Send sits right beside it.
              Left: what you look at (conversation, frame, goals); right: what
              the next step gets (a reference, settings) and stop / autonomous. */}
          <div
            data-testid="studio-dock-toolbar"
            className="pointer-events-auto flex h-9 items-center gap-0.5 rounded-full border border-border bg-background/85 px-1 shadow-elevation-2 backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              aria-label={chatOpen ? t.studio.collapse_conversation : t.studio.expand_conversation}
              aria-expanded={chatOpen}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-secondary/60 hover:text-primary"
            >
              {chatOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            {view && (
              <>
                <ToolbarDivider />
                <FrameViewSwitch view={view} />
              </>
            )}
            {goals && (
              <>
                <ToolbarDivider />
                <button
                  type="button"
                  onClick={goals.onToggle}
                  data-testid="studio-plan-button"
                  aria-label={
                    hasPlan
                      ? `${guideStrings(t).goals} · ${tx(guideStrings(t).goals_progress, { done, total })}`
                      : guideStrings(t).goals
                  }
                  aria-expanded={goals.open}
                  className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 transition-colors ${
                    goals.open
                      ? 'bg-secondary/70 text-primary'
                      : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
                  }`}
                >
                  <ListChecks className="h-4 w-4" />
                  {hasPlan && (
                    <span className="font-mono text-[11px] leading-none tabular-nums">
                      {done}/{total}
                    </span>
                  )}
                  {busy && (
                    <span className="absolute -right-0 -top-0 flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                  )}
                </button>
              </>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void pickReference()}
              disabled={working}
              aria-label={t.studio.add_reference_image}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-secondary/60 hover:text-primary disabled:opacity-40"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <StudioBuildSettings id={activeId} />
            <ToolbarDivider />
            {busy ? (
              <button
                type="button"
                onClick={() => stopTurn(activeId)}
                data-testid="studio-stop"
                aria-label={t.studio.stop_athena}
                className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-status-error/40 bg-status-error/10 px-2.5 typo-label text-status-error transition-colors hover:bg-status-error/20"
              >
                <CircleStop className="h-4 w-4" />
                {t.studio.stop}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (autonomous ? stopAutonomous(activeId) : startAutonomous(activeId))}
                aria-label={autonomous ? t.studio.stop_autonomous : t.studio.build_autonomously}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                  autonomous
                    ? 'bg-primary/20 text-primary'
                    : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
                }`}
              >
                {autonomous ? <Square className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
              </button>
            )}
          </div>

          {/* Input row: the field and Send, nothing between them. */}
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSubmit={send}
            placeholder={
              working
                ? guideStrings(t).placeholder_queue
                : question
                ? tx(t.studio.answer_athena, { name })
                : autonomous
                  ? tx(t.studio.building_autonomously, { name })
                  : tx(t.studio.tell_athena, { name })
            }
            boxShadow={stateShadow}
            inputTestId="studio-chat-input"
            sendLabel={t.common.send}
          />
        </div>
      </div>
    </>
  );
}

/** A hairline between the toolbar's groups. */
function ToolbarDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

// Plan | App, the same choice the B key makes: the blueprint sheet or the
// running app. App is held back until the preview is live; its tooltip says
// why instead of leaving a dead button.
function FrameViewSwitch({
  view,
}: {
  view: { showing: StudioFrameView; appReady: boolean; onChange: (v: StudioFrameView) => void };
}) {
  const { t } = useTranslation();
  const g = guideStrings(t);
  const option = (v: StudioFrameView) => {
    const on = view.showing === v;
    const blocked = v === 'app' && !view.appReady;
    const label = v === 'plan' ? g.view_plan : g.view_app;
    return (
      <Tooltip content={blocked ? g.tool_needs_live : label} placement="top" {...(blocked ? { triggerFocusable: true, triggerClassName: 'flex rounded-full' } : {})}>
        <Button
          variant={on ? 'accent' : 'ghost'}
          tone={on ? 'highlight' : undefined}
          size="icon-sm"
          aria-pressed={on}
          aria-label={label}
          disabled={blocked}
          onClick={() => view.onChange(v)}
          data-testid={`studio-view-${v}`}
          className={`rounded-full ${blocked ? 'pointer-events-none' : ''}`}
        >
          {v === 'plan' ? <DraftingCompass className="h-4 w-4" /> : <AppWindow className="h-4 w-4" />}
        </Button>
      </Tooltip>
    );
  };
  return (
    <div role="group" aria-label={g.view_switch} className="flex shrink-0 items-center gap-0.5">
      {option('plan')}
      {option('app')}
    </div>
  );
}
