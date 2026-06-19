import { useEffect, useRef } from 'react';
import { Bot, Check, Circle, Crosshair, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { BUBBLE_COPY, type BubbleViewProps } from './studioBuildModel';

// Variant B — "Cockpit": checklist-primary. The build phases are the spine
// (compact rows with status) at the top; the active phase's conversation lives
// below as a focused thread. Pick a phase ↑, talk about it ↓. Each completed/
// active phase carries the orb point-at affordance.
export default function StudioBubbleCockpit({
  projectName,
  messages,
  phases,
  input,
  setInput,
  busy,
  onSend,
  onClose,
  onPointAt,
}: BubbleViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const active = phases.find((p) => p.status === 'active');

  return (
    <div className="flex max-h-[32rem] flex-col overflow-hidden rounded-modal border border-border bg-background/95 shadow-elevation-4 backdrop-blur">
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

      {/* checklist spine */}
      <div className="shrink-0 border-b border-border px-2 py-2">
        {phases.map((p) => (
          <div
            key={p.id}
            className={`group flex items-center gap-2 rounded-interactive px-2 py-1 ${p.status === 'active' ? 'bg-primary/10' : ''}`}
          >
            {p.status === 'done' ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : p.status === 'active' ? (
              <Circle className="h-3.5 w-3.5 shrink-0 fill-primary/30 text-primary" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0 text-border" />
            )}
            <span
              className={`flex-1 truncate text-md ${p.status === 'pending' ? 'text-foreground/50' : 'text-foreground'}`}
            >
              {p.title}
            </span>
            {p.status !== 'pending' && onPointAt && (
              <button
                type="button"
                onClick={() => onPointAt(p.title)}
                aria-label={`Point at ${p.title}`}
                className="shrink-0 rounded-interactive p-0.5 text-foreground/40 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* active-phase thread */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="typo-caption shrink-0 px-3 pt-2 text-foreground/60">
          {active ? active.title : 'Conversation'}
        </div>
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
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
    </div>
  );
}
