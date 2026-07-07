import { useState } from 'react';
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
import { useStudioStore } from './studioStore';
import StudioBuildSettings from './StudioBuildSettings';
import StudioMessages from './StudioMessages';
import StudioQuickActions from './StudioQuickActions';
import StudioChecklistStepper from './StudioChecklistStepper';
import { phaseProgress } from './studioBuildModel';

// The Studio dock — Athena's conversation + plan + input, docked bottom-center
// over the immersive preview. Collapsed by default (latest message + a compact
// plan strip) so the preview + orb stay the star; expand to a readable, scrollable
// panel with a Conversation | Plan tab switch. The response log + streaming live
// in StudioMessages; the plan reuses StudioChecklistStepper.
type DockView = null | 'chat' | 'plan';

export default function StudioChatInput() {
  const [input, setInput] = useState('');
  const [view, setView] = useState<DockView>(null);
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const startAutonomous = useStudioStore((s) => s.startAutonomous);
  const stopAutonomous = useStudioStore((s) => s.stopAutonomous);
  const stopTurn = useStudioStore((s) => s.stopTurn);

  if (!activeId || !rt) return null;
  const { busy, question, autonomous, name, phases } = rt;
  const working = busy || autonomous;
  const expanded = view !== null;
  const { done, total } = phaseProgress(phases ?? []);
  const activePhase = (phases ?? []).find((p) => p.status === 'active');
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
    <div
      className={`absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-2 ${
        expanded ? 'w-[min(46rem,calc(100%-5rem))]' : 'w-[min(38rem,calc(100%-7rem))]'
      }`}
    >
      {/* Expanded body — the full conversation or the full plan */}
      {expanded && (
        <div className="pointer-events-auto flex max-h-[56vh] flex-col overflow-hidden rounded-modal border border-border bg-background/95 shadow-elevation-4 backdrop-blur">
          <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
            <DockTab active={view === 'chat'} onClick={() => setView('chat')} icon={MessageSquare}>
              Conversation
            </DockTab>
            <DockTab active={view === 'plan'} onClick={() => setView('plan')} icon={ListChecks}>
              Plan{hasPlan ? ` · ${done}/${total}` : ''}
            </DockTab>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setView(null)}
              aria-label="Collapse"
              className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {view === 'plan' ? (
              hasPlan ? (
                <StudioChecklistStepper phases={phases ?? []} />
              ) : (
                <p className="typo-caption px-1 py-6 text-center text-foreground/50">
                  No plan yet — Athena will lay one out as you build.
                </p>
              )
            ) : (
              <StudioMessages expanded />
            )}
          </div>
        </div>
      )}

      {/* Collapsed — a compact plan strip + the latest message */}
      {!expanded && (
        <>
          {hasPlan && (
            <button
              type="button"
              onClick={() => setView('plan')}
              data-testid="studio-plan-strip"
              className="pointer-events-auto flex items-center gap-2 self-start rounded-full border border-border bg-background/85 py-1 pl-2.5 pr-3 shadow-elevation-2 backdrop-blur transition-colors hover:border-primary/40"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {busy && (
                  <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-primary/30" />
                )}
              </span>
              <span className="max-w-[16rem] truncate text-xs text-foreground/80">
                {activePhase?.title ?? (done === total ? 'Plan complete' : 'Build plan')}
              </span>
              <span className="font-mono text-[11px] text-foreground/50">
                {done}/{total}
              </span>
            </button>
          )}
          <StudioMessages />
        </>
      )}

      {!working && !question && !expanded && <StudioQuickActions id={activeId} />}

      {/* Input row */}
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-2 pr-1.5 shadow-elevation-3 backdrop-blur transition-shadow duration-300"
        style={stateShadow ? { boxShadow: stateShadow } : undefined}
      >
        <button
          type="button"
          onClick={() => setView((v) => (v ? null : 'chat'))}
          aria-label={expanded ? 'Collapse conversation' : 'Expand conversation'}
          aria-expanded={expanded}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-primary"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
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
  );
}

function DockTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof MessageSquare;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-secondary/70 text-foreground'
          : 'text-foreground/55 hover:bg-secondary/40 hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
