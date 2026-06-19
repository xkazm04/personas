import { useEffect, useRef } from 'react';
import { Bot, Check, ChevronRight, Crosshair, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { BUBBLE_COPY, phaseProgress, type BubbleViewProps } from './studioBuildModel';

// Variant A — "Thread": chat-primary. The build CHECKLIST is woven into the
// conversation as milestone events (✓ completed phase, ▸ active phase), so there
// is ONE scrolling stream of progress + conversation rather than two panels. A
// segmented progress bar in the header keeps the whole plan glanceable.
export default function StudioBubbleThread({
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

  const { done, total, active } = phaseProgress(phases);
  const milestones = phases.filter((p) => p.status !== 'pending');
  const upNext = phases.find((p) => p.status === 'pending');

  return (
    <div className="flex max-h-[30rem] flex-col overflow-hidden rounded-modal border border-border bg-background/95 shadow-elevation-4 backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="typo-caption truncate text-foreground">
            {active ? active.title : BUBBLE_COPY.title} · {projectName}
          </div>
          <div className="mt-1 flex items-center gap-1">
            {phases.map((p) => (
              <span
                key={p.id}
                className={`h-1 flex-1 rounded-full ${p.status === 'done' ? 'bg-primary' : p.status === 'active' ? 'bg-primary/50' : 'bg-border'}`}
              />
            ))}
            <span className="typo-caption ml-1 shrink-0 text-foreground/60">
              {done}/{total}
            </span>
          </div>
        </div>
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
        {/* phases as milestone events in the stream */}
        {milestones.map((p) => (
          <div
            key={p.id}
            className={`flex items-start gap-2 rounded-card px-2 py-1 ${p.status === 'active' ? 'bg-primary/10 ring-1 ring-primary/25' : ''}`}
          >
            {p.status === 'done' ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <div className="text-md text-foreground">{p.title}</div>
              {p.note && <div className="typo-caption truncate">{p.note}</div>}
            </div>
          </div>
        ))}
        {/* conversation */}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'you'
                ? 'ml-6 rounded-card bg-primary/15 px-3 py-1.5 text-md text-foreground'
                : 'group mr-6 flex items-start gap-2 rounded-card bg-secondary/50 px-3 py-1.5 text-md text-foreground'
            }
          >
            {m.role === 'athena' && <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
            <span className="min-w-0 whitespace-pre-wrap break-words">{m.text}</span>
            {m.role === 'athena' && onPointAt && (
              <button
                type="button"
                onClick={() => onPointAt('this change')}
                aria-label="Point at it in the preview"
                className="ml-auto shrink-0 rounded-interactive p-0.5 text-foreground/40 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {busy && <p className="typo-caption">{BUBBLE_COPY.working}</p>}
        {upNext && !busy && <p className="typo-caption">Up next · {upNext.title}</p>}
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
