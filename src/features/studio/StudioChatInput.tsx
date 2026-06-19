import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Send, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildSessionSend } from '@/api/webbuild';

// Minimal Studio chat: a send-only input with a single response bubble above it
// that (1) sticks to the input, (2) shows an in-progress indicator while Athena
// works, and (3) shows her FULL reply after — no truncation. Athena-styled (Bot
// avatar) but Studio-owned, so it behaves reliably (the orb FooterNotice reuse
// truncated + didn't attach).
export default function StudioChatInput({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setReply(null);
    setBusy(true);
    try {
      const r = await webbuildSessionSend(projectId, text);
      setReply(r.trim() || 'Done.');
    } catch (e) {
      setReply('Something went wrong with that change.');
      toastCatch('build instruction')(e);
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId]);

  const showBubble = busy || reply !== null;

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex w-[min(38rem,calc(100%-7rem))] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence>
        {showBubble && (
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur"
          >
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {busy ? (
              <span className="flex items-center gap-1.5 text-md text-foreground/80">
                Athena is working
                <span className="flex gap-0.5">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
                </span>
              </span>
            ) : (
              <span className="min-w-0 whitespace-pre-wrap break-words text-md text-foreground">
                {reply}
              </span>
            )}
            {!busy && reply !== null && (
              <button
                type="button"
                onClick={() => setReply(null)}
                aria-label="Dismiss"
                className="ml-1 shrink-0 rounded-interactive p-0.5 text-foreground/40 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
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
              void send();
            }
          }}
          placeholder={`Tell Athena what to build in ${projectName}…`}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60"
        />
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 rounded-full"
          icon={<Send className="h-4 w-4" />}
          loading={busy}
          disabled={!input.trim() || busy}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
