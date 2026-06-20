import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, HelpCircle, Send, Square, Wand2 } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useStudioStore } from './studioStore';

// Project-scoped chat: reads the ACTIVE tab's runtime from the store, so the
// input + bubble always reflect the active project; switching tabs swaps them,
// and a background project keeps streaming into its own runtime. The project
// name is shown so it's clear which project you're talking to.
export default function StudioChatInput() {
  const [input, setInput] = useState('');
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const startAutonomous = useStudioStore((s) => s.startAutonomous);
  const stopAutonomous = useStudioStore((s) => s.stopAutonomous);

  if (!activeId || !rt) return null;
  const { busy, stream, reply, question, autonomous, name } = rt;

  const streamDisplay = (stream.split('BUILD_PLAN:')[0]?.split('NEEDS_INPUT:')[0] ?? '').trimEnd();
  const showBubble = busy || reply !== null || question !== null;
  const working = busy || autonomous;

  const send = () => {
    const text = input.trim();
    if (!text || working) return;
    setInput('');
    void sendTurn(activeId, text);
  };

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex w-[min(38rem,calc(100%-7rem))] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence mode="wait">
        {showBubble && (
          <motion.div
            key={`bubble-${activeId}`}
            initial={{ y: 12, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
            className="pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur"
          >
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {busy ? (
              streamDisplay ? (
                <div className="max-h-48 min-w-0 overflow-y-auto">
                  <MarkdownRenderer content={streamDisplay} className="athena-chat-md" />
                </div>
              ) : (
                <span className="flex items-center gap-1.5 text-md text-foreground/80">
                  {autonomous ? `Building ${name} autonomously` : 'Athena is working'}
                  <span className="flex gap-0.5">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
                  </span>
                </span>
              )
            ) : (
              <div className="min-w-0">
                {reply && (
                  <MarkdownRenderer content={reply} className="athena-chat-md" codeBlockActions />
                )}
                {question && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-card border-l-2 border-primary bg-primary/10 px-2.5 py-1.5">
                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-md text-foreground">{question}</span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-4 pr-1.5 shadow-elevation-3 backdrop-blur">
        <input
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
