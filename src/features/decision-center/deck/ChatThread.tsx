/**
 * The chat card's body: the thread tail, oldest first, ending at the question
 * (the last message is marked as the ask), then the composer. Space focuses
 * the composer (the deck's key); Enter sends, Shift+Enter breaks the line.
 */
import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem, DecisionThreadMessage } from '../model/decisionModel';
import { Keycap } from './parts';

const AUTHOR_TONE: Record<DecisionThreadMessage['author'], string> = {
  user: 'au-bubble au-t-accent',
  persona: 'au-bubble au-t-neutral',
  athena: 'au-bubble au-t-agent',
};

function Message({ m, ask }: { m: DecisionThreadMessage; ask: boolean }) {
  const mine = m.author === 'user';
  return (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      <span className="flex items-center gap-1.5 typo-caption">
        <span className="text-foreground">{m.name}</span>
        <RelativeTime timestamp={m.at} className="typo-caption" />
        {ask && <span className="flex items-center gap-1.5 typo-eyebrow text-status-warning"><span className="au-lamp au-l-warning au-lamp-breathe" aria-hidden />the ask</span>}
      </span>
      <div className={`max-w-[80%] rounded-card px-4 py-2.5 ${ask ? 'au-bubble au-t-warning au-bubble-ask' : AUTHOR_TONE[m.author]}`}>
        <MarkdownRenderer content={m.body} variant="card" className="typo-body text-foreground" />
      </div>
    </div>
  );
}

export function ChatThread({ item, onSend }: { item: DecisionItem; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const messages = item.thread?.messages ?? [];
  const canReply = item.thread?.canReply ?? false;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [item.id]);

  const send = () => {
    const text = draft.trim();
    if (text) onSend(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-5 pl-[5.75rem] pr-8" data-p2-scroll={item.id}>
        {messages.map((m, i) => <Message key={m.id} m={m} ask={i === messages.length - 1} />)}
      </div>
      <div className="flex items-end gap-2 py-3 pl-[5.75rem] pr-8">
        <textarea
          data-p2-composer={item.id}
          rows={2}
          value={draft}
          disabled={!canReply}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
          }}
          placeholder={canReply ? `Reply to ${item.source.label}…` : 'This channel only takes replies in its own view'}
          aria-label={`Reply to ${item.source.label}`}
          className="au-well min-h-[64px] flex-1 resize-none rounded-input px-3.5 py-2.5 typo-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          data-testid="p2-composer"
        />
        <Button variant="primary" size="md" onClick={send} disabled={!draft.trim()} iconRight={<Keycap><CornerDownLeft className="h-3.5 w-3.5" aria-hidden /></Keycap>} className="au-lift au-sheen">
          Send
        </Button>
      </div>
    </div>
  );
}
