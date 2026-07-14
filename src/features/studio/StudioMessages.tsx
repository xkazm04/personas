import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, History } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useStudioStore } from './studioStore';
import StudioDecision from './StudioDecision';

// Smooth reveal of a growing stream (1b). `count` chases target.length; the step
// scales with the backlog so a big CLI chunk catches up without lagging, while a
// trickle types at a readable pace. Resets when the stream clears at the start of
// a new turn.
//
// Perf: every commit re-parses the partial text through ReactMarkdown (remark +
// rehype-highlight), which is by far the most expensive thing in a streaming turn.
// So the chase is (a) driven by rAF — no work while the window is hidden, and it
// yields to paint instead of racing a 16ms timer — (b) budgeted to ~COMMIT_MS so a
// long reply re-parses ~20×/s rather than 60×/s, and (c) snapped back to the last
// word boundary, so we never re-parse a half-typed token.
const COMMIT_MS = 45;
const CATCHUP = 14; // backlog divisor — bigger backlog ⇒ bigger step

function useTypewriter(target: string): string {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  countRef.current = count;

  useEffect(() => {
    if (target.length < countRef.current) setCount(target.length);
  }, [target]);

  useEffect(() => {
    if (count >= target.length) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      if (t - start < COMMIT_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const step = Math.max(2, Math.round((target.length - count) / CATCHUP));
      let next = Math.min(target.length, count + step);
      if (next < target.length) {
        const ws = target.lastIndexOf(' ', next);
        if (ws > count) next = ws; // land on a word boundary, never mid-token
      }
      setCount(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count, target]);

  return target.slice(0, Math.min(count, target.length));
}

// Past turns are static, but the parent re-renders on every stream commit — without
// this memo each commit re-parsed the markdown of *every* earlier message too.
const MessageBody = memo(function MessageBody({
  text,
  codeBlockActions = false,
}: {
  text: string;
  codeBlockActions?: boolean;
}) {
  return <MarkdownRenderer content={text} className="athena-chat-md" codeBlockActions={codeBlockActions} />;
});

const BUBBLE =
  'pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur';

// Earlier messages are a *reading* surface, not a floating hint — so they get a
// fully opaque background (no /95, no element opacity). The translucent version
// let the preview and the latest bubble bleed through the text underneath it.
const HISTORY_BUBBLE =
  'pointer-events-auto flex max-w-full items-start gap-2 self-start rounded-modal border border-border bg-background px-3 py-2 shadow-elevation-4';

// The pre-stream wait: a travelling dot wave (a *direction*, not three dots
// blinking in place) over shimmer skeleton lines standing in for the reply that's
// about to land — so the bubble never sits empty, and its final size doesn't jump.
const Working = ({ autonomous, name }: { autonomous: boolean; name: string }) => {
  const { shouldAnimate } = useMotion();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-md text-foreground/80">
        {autonomous ? `Building ${name} autonomously` : 'Athena is working'}
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1 w-1 rounded-full bg-primary/70"
              animate={
                shouldAnimate ? { opacity: [0.3, 1, 0.3], y: [0, -2, 0] } : { opacity: 0.7 }
              }
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
            />
          ))}
        </span>
      </span>
      <span className="flex flex-col gap-1.5" aria-hidden>
        <span className="h-1.5 w-48 animate-pulse rounded-full bg-primary/10" />
        <span className="h-1.5 w-32 animate-pulse rounded-full bg-primary/10 [animation-delay:200ms]" />
      </span>
    </div>
  );
};

// Athena's responses. Two modes:
// - default (dock, collapsed): only the latest turn as a floating bubble, with an
//   icon button to reveal earlier ones — keeps the preview immersive.
// - expanded: a full, readable conversation column (all turns + live stream +
//   decision), meant to fill the dock's scrollable panel body.
export default function StudioMessages({ expanded = false }: { expanded?: boolean }) {
  const activeId = useStudioStore((s) => s.activeId);
  const rt = useStudioStore((s) => (s.activeId ? s.runtimes[s.activeId] : undefined));
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const [showAll, setShowAll] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const streamRaw = rt
    ? (rt.stream.split('BUILD_PLAN:')[0]?.split('NEEDS_INPUT:')[0] ?? '').trimEnd()
    : '';
  const typed = useTypewriter(rt?.busy ? streamRaw : '');

  // Keep the expanded conversation pinned to the newest content as it streams.
  useEffect(() => {
    if (expanded) endRef.current?.scrollIntoView({ block: 'end' });
  }, [expanded, typed, rt?.messages.length, rt?.question]);

  if (!activeId || !rt) return null;
  const { busy, question, options, messages, autonomous, name } = rt;
  if (!busy && messages.length === 0 && question === null) return null;

  const decision = question ? (
    <StudioDecision
      question={question}
      options={options}
      onAnswer={(a) => void sendTurn(activeId, a)}
    />
  ) : null;

  // ── Expanded: the full conversation as a readable column ──────────────────
  if (expanded) {
    return (
      <div className="flex flex-col gap-2.5">
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1.5 typo-caption text-foreground/40">
                <span className="font-medium text-foreground/65">Athena</span>
                <span>·</span>
                <RelativeTime timestamp={m.ts} />
              </div>
              <MessageBody text={m.text} codeBlockActions />
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {typed ? (
              <div className="min-w-0 flex-1">
                <MessageBody text={typed} />
              </div>
            ) : (
              <Working autonomous={autonomous} name={name} />
            )}
          </div>
        )}
        {decision && <div className="pl-6">{decision}</div>}
        <div ref={endRef} />
      </div>
    );
  }

  // ── Collapsed: latest bubble only, with a reveal-earlier affordance ───────
  const history = messages.slice(0, -1);
  const latest = messages[messages.length - 1];
  const canExpand = history.length > 0;

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
              <div key={m.id} className={HISTORY_BUBBLE}>
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0">
                  <MessageBody text={m.text} />
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
                <MessageBody text={typed} />
              </div>
            ) : (
              <Working autonomous={autonomous} name={name} />
            )
          ) : (
            <div className="min-w-0">
              {latest && (
                // Scroll long completed replies instead of overflowing the bubble;
                // the decision (below) stays pinned + visible.
                <div className="max-h-[40vh] overflow-y-auto overscroll-contain">
                  <MessageBody text={latest.text} codeBlockActions />
                </div>
              )}
              {decision}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
