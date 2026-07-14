import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  CircleStop,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Send,
  Square,
  Wand2,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useStudioStore } from './studioStore';
import StudioBuildSettings from './StudioBuildSettings';
import StudioMessages from './StudioMessages';
import StudioPlanDrawer from './StudioPlanDrawer';
import StudioQuickActions from './StudioQuickActions';
import { phaseProgress } from './studioBuildModel';

// The Studio dock — Athena's conversation + input, docked bottom-center over the
// immersive preview. Collapsed by default (latest message only) so the preview +
// orb stay the star; expand for a readable, scrollable conversation panel. The
// build plan is NOT in the dock: it opens as a right-edge drawer from the plan
// button in the input row, so you can read the plan while you keep steering. The
// dock re-centres itself into the space the drawer leaves.

export default function StudioChatInput() {
  const [input, setInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const { shouldAnimate } = useMotion();
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const startAutonomous = useStudioStore((s) => s.startAutonomous);
  const stopAutonomous = useStudioStore((s) => s.stopAutonomous);
  const stopTurn = useStudioStore((s) => s.stopTurn);

  if (!activeId || !rt) return null;
  const { busy, question, autonomous, name, phases } = rt;
  const working = busy || autonomous;
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
    if (!text || working) return;
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
      <StudioPlanDrawer
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        phases={phases ?? []}
        done={done}
        total={total}
        busy={busy}
      />

      {/* Dock — full-width row so the column stays centred in whatever space the
          plan drawer leaves behind (pure padding transition, no transform fight). */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-8 transition-[padding] duration-300 ease-out"
        style={planOpen ? { paddingRight: 'calc(min(22rem, 45%) + 2rem)' } : undefined}
      >
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
                  <span className="text-xs font-medium text-foreground/80">Conversation</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setChatOpen(false)}
                    aria-label="Collapse"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-foreground"
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

          {/* Collapsed — the latest message bubble (+ earlier-message reveal) */}
          {!chatOpen && <StudioMessages />}

          {!working && !question && !chatOpen && <StudioQuickActions id={activeId} />}

          {/* Input row */}
          <div
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-2 pr-1.5 shadow-elevation-3 backdrop-blur transition-shadow duration-300"
            style={stateShadow ? { boxShadow: stateShadow } : undefined}
          >
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              aria-label={chatOpen ? 'Collapse conversation' : 'Expand conversation'}
              aria-expanded={chatOpen}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-primary"
            >
              {chatOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            <input
              data-testid="studio-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                question
                  ? `Answer Athena · ${name}`
                  : autonomous
                    ? `Athena is building ${name} autonomously…`
                    : `Tell Athena what to build in ${name}…`
              }
              disabled={working}
              className="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void pickReference()}
              disabled={working}
              aria-label="Add a design reference image"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-primary disabled:opacity-40"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            {/* Build plan — the drawer's one entry point, sitting with the other
                input-row tools instead of floating above the dock. */}
            <button
              type="button"
              onClick={() => setPlanOpen((v) => !v)}
              data-testid="studio-plan-button"
              aria-label={hasPlan ? `Build plan · ${done} of ${total} done` : 'Build plan'}
              aria-expanded={planOpen}
              className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 transition-colors ${
                planOpen
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
            <StudioBuildSettings id={activeId} />
            {busy ? (
              <button
                type="button"
                onClick={() => stopTurn(activeId)}
                data-testid="studio-stop"
                aria-label="Stop Athena"
                className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-status-error/40 bg-status-error/10 px-2.5 text-xs font-medium text-status-error transition-colors hover:bg-status-error/20"
              >
                <CircleStop className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (autonomous ? stopAutonomous(activeId) : startAutonomous(activeId))}
                aria-label={autonomous ? 'Stop autonomous build' : 'Build autonomously'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                  autonomous
                    ? 'bg-primary/20 text-primary'
                    : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
                }`}
              >
                {autonomous ? <Square className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
              </button>
            )}
            <Button
              variant="primary"
              size="sm"
              className="shrink-0 rounded-full"
              icon={<Send className="h-4 w-4" />}
              loading={busy && !autonomous}
              disabled={!input.trim() || working}
              onClick={send}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
