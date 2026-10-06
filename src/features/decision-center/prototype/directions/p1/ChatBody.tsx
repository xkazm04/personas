/**
 * chat — the thread's tail ending at the question asked of you, then a
 * composer. Space focuses it, Enter sends, Shift+Enter breaks the line.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem, DecisionThreadMessage } from '../../../model/decisionModel';
import { COPY } from './copy';
import { Kbd } from './Kbd';
import type { SheetFlow } from './useSheetFlow';

/** Within this many px of the end the thread counts as "at the bottom" (useChatScroll's value). */
const NEAR_BOTTOM_PX = 80;

function Message({ m, ask }: { m: DecisionThreadMessage; ask: boolean }) {
  const mine = m.author === 'user';
  return (
    <div className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      <span className={`p1-avatar typo-label text-foreground ${mine ? 'is-user' : m.author === 'athena' ? 'is-athena' : ''}`} aria-hidden>
        {m.name.slice(0, 1)}
      </span>
      <div className={`min-w-0 max-w-[85%] p1-bubble px-3.5 py-2 ${mine ? 'is-user' : ''} ${ask ? 'is-ask' : ''}`}>
        <div className="flex items-baseline gap-2">
          <span className="typo-label text-foreground">{m.name}</span>
          <RelativeTime timestamp={m.at} className="typo-caption" />
          {ask && <span className="ml-auto typo-label text-role-agent">{COPY.sheet.askedYou}</span>}
        </div>
        <MarkdownRenderer content={m.body} variant="card" />
      </div>
    </div>
  );
}

/** The thread tail, inside the sheet's scroll region (which opens scrolled to the question). */
export function ChatThread({ item }: { item: DecisionItem }) {
  const messages = item.thread?.messages ?? [];
  const lastOther = [...messages].reverse().find((m) => m.author !== 'user');
  const ref = useRef<HTMLDivElement>(null);
  // The thread ends at the question: open pinned to the bottom and stay there
  // while the sheet settles (markdown, fonts, the open morph) — but only while
  // the reader is still near the bottom; scrolling up to read history wins.
  useEffect(() => {
    const el = ref.current;
    const scroller = el?.parentElement;
    if (!el || !scroller || typeof ResizeObserver === 'undefined') return;
    const stuckToBottom = { current: true };
    const measure = () => {
      stuckToBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= NEAR_BOTTOM_PX;
    };
    const follow = () => {
      if (stuckToBottom.current) scroller.scrollTo({ top: scroller.scrollHeight });
    };
    follow();
    scroller.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(el);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [item.id]);
  return (
    <div ref={ref} className="space-y-3 px-6 pb-5">
      {messages.map((m) => <Message key={m.id} m={m} ask={m.id === lastOther?.id} />)}
    </div>
  );
}

/** The composer, pinned under the thread and above the footer — never scrolled away. */
export function ChatComposer({ item, flow, composerRef }: {
  item: DecisionItem;
  flow: SheetFlow;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const thread = item.thread;
  return (
    <div className="shrink-0 border-t p1-hair px-6 py-3">
      {thread?.canReply === false ? (
        <p className="typo-caption">{COPY.sheet.cannotReply}</p>
      ) : (
        <div className="space-y-1.5">
          <textarea
            ref={composerRef}
            rows={2}
            value={flow.reply}
            onChange={(e) => flow.setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flow.send(); }
            }}
            placeholder={`${COPY.sheet.composer} — ${item.source.label}`}
            aria-label={COPY.sheet.composer}
            className="p1-field typo-body"
          />
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 typo-caption"><Kbd>⏎</Kbd>{COPY.sheet.send}</span>
            <span className="inline-flex items-center gap-1 typo-caption"><Kbd>⇧</Kbd><Kbd>⏎</Kbd>{COPY.sheet.newline}</span>
            <Button
              variant="primary" size="sm" className="ml-auto"
              disabled={!flow.reply.trim()} onClick={() => flow.send()}
              icon={<Send className="h-3.5 w-3.5" aria-hidden />}
            >
              {COPY.sheet.send}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
