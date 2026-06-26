import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, History } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useStudioStore } from './studioStore';
import StudioDecision from './StudioDecision';

// Smooth letter-level reveal of a growing stream (1b). `count` chases
// target.length; the step scales with the backlog so a big CLI chunk catches up
// without lagging, while a trickle types at a readable pace. Resets to 0 when the
// stream clears at the start of a new turn.
function useTypewriter(target: string): string {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  countRef.current = count;
  useEffect(() => {
    if (target.length < countRef.current) setCount(target.length);
  }, [target]);
  useEffect(() => {
    if (count >= target.length) return;
    const step = Math.max(1, Math.round((target.length - count) / 18));
    const t = window.setTimeout(() => setCount((c) => Math.min(target.length, c + step)), 16);
    return () => window.clearTimeout(t);
  }, [count, target]);
  return target.slice(0, Math.min(count, target.length));
}

const BUBBLE =
  'pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur';

// Athena's responses as a chat log (1a): each completed turn is its own bubble.
// By default only the latest is shown; an icon button reveals the earlier ones.
// While a turn streams, the live reply types in letter-by-letter (1b).
export default function StudioMessages() {
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const [showAll, setShowAll] = useState(false);

  const streamRaw = rt
    ? (rt.stream.split('BUILD_PLAN:')[0]?.split('NEEDS_INPUT:')[0] ?? '').trimEnd()
    : '';
  const typed = useTypewriter(rt?.busy ? streamRaw : '');

  if (!activeId || !rt) return null;
  const { busy, question, options, messages, autonomous, name } = rt;
  if (!busy && messages.length === 0 && question === null) return null;

  const history = messages.slice(0, -1);
  const latest = messages[messages.length - 1];
  const canExpand = history.length > 0;

  const working = (
    <span className="flex items-center gap-1.5 text-md text-foreground/80">
      {autonomous ? `Building ${name} autonomously` : 'Athena is working'}
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
      </span>
    </span>
  );

  return (
    <div className="pointer-events-none flex flex-col items-start gap-1.5">
      {canExpand && (
        <button
          type="button"
          data-testid="studio-messages-toggle"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="pointer-events-auto inline-flex items-center gap-1 self-start rounded-full border border-border bg-background/85 px-2 py-0.5 typo-caption text-foreground/60 shadow-elevation-2 backdrop-blur transition-colors hover:text-foreground"
        >
          <History className="h-3 w-3" />
          {showAll ? 'Hide earlier' : `${history.length} earlier ${history.length === 1 ? 'message' : 'messages'}`}
        </button>
      )}

      <AnimatePresence initial={false}>
        {showAll && canExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="flex max-h-[42vh] w-full flex-col gap-1.5 overflow-y-auto"
          >
            {history.map((m) => (
              <div key={m.id} className={`${BUBBLE} opacity-80`}>
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0">
                  <MarkdownRenderer content={m.text} className="athena-chat-md" />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={busy ? 'busy' : (latest?.id ?? question ?? 'current')}
          data-testid="studio-chat-bubble"
          initial={{ y: 12, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 12, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 460, damping: 30 }}
          className={BUBBLE}
        >
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {busy ? (
            typed ? (
              <div className="max-h-48 min-w-0 overflow-y-auto">
                <MarkdownRenderer content={typed} className="athena-chat-md" />
              </div>
            ) : (
              working
            )
          ) : (
            <div className="min-w-0">
              {latest && (
                <MarkdownRenderer content={latest.text} className="athena-chat-md" codeBlockActions />
              )}
              {question && (
                <StudioDecision
                  question={question}
                  options={options}
                  onAnswer={(a) => void sendTurn(activeId, a)}
                />
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
