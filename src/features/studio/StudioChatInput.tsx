import { useState } from 'react';
import { Image as ImageIcon, Send, Square, Wand2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import Button from '@/features/shared/components/buttons/Button';
import { useStudioStore } from './studioStore';
import StudioBuildSettings from './StudioBuildSettings';
import StudioMessages from './StudioMessages';
import StudioQuickActions from './StudioQuickActions';

// Project-scoped chat: reads the ACTIVE tab's runtime from the store, so the
// input + bubbles always reflect the active project; switching tabs swaps them,
// and a background project keeps streaming into its own runtime. The response log
// + streaming live in StudioMessages; this owns the input row.
export default function StudioChatInput() {
  const [input, setInput] = useState('');
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const startAutonomous = useStudioStore((s) => s.startAutonomous);
  const stopAutonomous = useStudioStore((s) => s.stopAutonomous);

  if (!activeId || !rt) return null;
  const { busy, question, autonomous, name } = rt;
  const working = busy || autonomous;

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
    <div className="absolute bottom-4 left-1/2 z-20 flex w-[min(38rem,calc(100%-7rem))] -translate-x-1/2 flex-col gap-2">
      <StudioMessages />

      {!working && !question && <StudioQuickActions id={activeId} />}

      <div
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-4 pr-1.5 shadow-elevation-3 backdrop-blur transition-shadow duration-300"
        style={stateShadow ? { boxShadow: stateShadow } : undefined}
      >
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
        <button
          type="button"
          onClick={() => (autonomous ? stopAutonomous(activeId) : startAutonomous(activeId))}
          disabled={!autonomous && busy}
          aria-label={autonomous ? 'Stop autonomous build' : 'Build autonomously'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            autonomous
              ? 'bg-primary/20 text-primary'
              : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary disabled:opacity-40'
          }`}
        >
          {autonomous ? <Square className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
        </button>
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
