import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildSessionSend } from '@/api/webbuild';

// Compact, Studio-scoped comms "bubble" for talking to Athena about the build —
// distinct from the large general CompanionPanel. P2 of the web-dev companion.
// v1 is a floating bubble docked over the preview; the full orb-anchored flyout
// (springing from the live AthenaOrb) is the next polish. Copy is local (i18n
// deferred while the surface is in flux).
const COPY = {
  title: 'Build with Athena',
  hint: 'Tell Athena what to change — e.g. "make the hero heading purple" or "add a contact section". She edits the code; the preview updates live.',
  placeholder: 'Tell Athena what to build…',
  working: 'Athena is working… watch the preview.',
  failed: 'Something went wrong with that change.',
  send: 'Send',
};

interface Msg {
  role: 'you' | 'athena';
  text: string;
}

export default function StudioBubble({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'you', text }]);
    setBusy(true);
    try {
      const reply = await webbuildSessionSend(projectId, text);
      setMessages((m) => [...m, { role: 'athena', text: reply.trim() || 'Done.' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'athena', text: COPY.failed }]);
      toastCatch('build instruction')(e);
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={COPY.title}
        className="absolute bottom-4 right-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-elevation-3 backdrop-blur transition-colors hover:bg-primary/25"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="absolute bottom-4 right-4 flex max-h-[min(28rem,calc(100%-2rem))] w-80 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-modal border border-border bg-background/95 shadow-elevation-4 backdrop-blur">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="typo-caption flex-1 truncate text-foreground">
          {COPY.title} · {projectName}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimize"
          className="rounded-interactive p-1 text-foreground/60 hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && <p className="typo-caption">{COPY.hint}</p>}
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
        {busy && <p className="typo-caption">{COPY.working}</p>}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={COPY.placeholder}
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
          onClick={() => void send()}
        >
          {COPY.send}
        </Button>
      </footer>
    </div>
  );
}
