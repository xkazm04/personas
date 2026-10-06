/**
 * The chat card's body: the thread tail, oldest first, ending at the question
 * (the last message is marked as the ask), then the composer well. Space
 * focuses the composer (the deck's key); Enter sends, Shift+Enter breaks the line.
 */
import { useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem, DecisionThreadMessage } from '../../../model/decisionModel';
import { Key } from './Key';

function Message({ m, ask }: { m: DecisionThreadMessage; ask: boolean }) {
  const mine = m.author === 'user';
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? 'items-end' : 'items-start'}`}>
      <span className="flex items-center gap-2 typo-caption">
        <span className="text-foreground">{m.name}</span>
        <RelativeTime timestamp={m.at} className="typo-caption" />
        {ask && <span className="r2a-tag typo-eyebrow" data-r2a-say="warning">The ask</span>}
      </span>
      <div className="r2a-bubble" data-author={m.author} data-ask={ask || undefined}>
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
      <div ref={scroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-1" data-r2a-scroll={item.id}>
        {messages.map((m, i) => <Message key={m.id} m={m} ask={i === messages.length - 1} />)}
      </div>
      <div className="r2a-composer r2a-well">
        <textarea
          data-r2a-composer={item.id}
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
          className="min-h-[56px] flex-1 resize-none bg-transparent px-1 py-1 typo-body text-foreground focus:outline-none"
          data-testid="r2a-composer"
        />
        <Button variant="primary" size="md" onClick={send} disabled={!draft.trim()} className="r2a-cta r2a-btn self-end">
          Send <Key>↵</Key>
        </Button>
      </div>
    </div>
  );
}
