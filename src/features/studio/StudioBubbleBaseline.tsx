import { useEffect, useRef } from 'react';
import { Bot, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { BUBBLE_COPY, type BubbleViewProps } from './studioBuildModel';

// Baseline: plain chat — input + message bubbles, no checklist. The starting
// point we are prototyping away from (kept for A/B reference).
export default function StudioBubbleBaseline({
  projectName,
  messages,
  input,
  setInput,
  busy,
  onSend,
  onClose,
}: BubbleViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  return (
    <div className="flex max-h-[28rem] flex-col overflow-hidden rounded-modal border border-border bg-background/95 shadow-elevation-4 backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="typo-caption flex-1 truncate text-foreground">
          {BUBBLE_COPY.title} · {projectName}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Minimize"
          className="rounded-interactive p-1 text-foreground/60 hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && <p className="typo-caption">{BUBBLE_COPY.hint}</p>}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'you'
                ? 'ml-6 rounded-card bg-primary/15 px-3 py-1.5 text-md text-foreground'
                : 'mr-6 flex gap-2 rounded-card bg-secondary/50 px-3 py-1.5 text-md text-foreground'
            }
          >
            {m.role === 'athena' && <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
            <span className="whitespace-pre-wrap break-words">{m.text}</span>
          </div>
        ))}
        {busy && <p className="typo-caption">{BUBBLE_COPY.working}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={BUBBLE_COPY.placeholder}
          disabled={busy}
          className="min-w-0 flex-1 rounded-input border border-border bg-secondary/40 px-3 py-1.5 text-md outline-none focus:border-primary/50 disabled:opacity-60"
        />
        <Button
          variant="primary"
          size="sm"
          className="shrink-0"
          icon={<Send className="h-4 w-4" />}
          loading={busy}
          disabled={!input.trim() || busy}
          onClick={onSend}
        >
          {BUBBLE_COPY.send}
        </Button>
      </footer>
    </div>
  );
}
