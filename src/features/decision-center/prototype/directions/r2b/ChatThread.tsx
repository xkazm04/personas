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
import type { DecisionItem, DecisionThreadMessage } from '../../../model/decisionModel';

const AUTHOR_TONE: Record<DecisionThreadMessage['author'], string> = {
  user: 'border-primary/25 bg-primary/10',
  persona: 'border-primary/10 bg-secondary/40',
  athena: 'border-role-agent/30 bg-role-agent/10',
};

function Message({ m, ask }: { m: DecisionThreadMessage; ask: boolean }) {
  const mine = m.author === 'user';
  return (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      <span className="flex items-center gap-1.5 typo-caption">
        <span className="text-foreground">{m.name}</span>
        <RelativeTime timestamp={m.at} className="typo-caption" />
        {ask && <span className="rounded-pill bg-status-warning/15 px-2 typo-caption text-status-warning">the ask</span>}
      </span>
      <div className={`max-w-[80%] rounded-card border px-3.5 py-2.5 ${AUTHOR_TONE[m.author]} ${ask ? 'ring-2 ring-status-warning/40' : ''}`}>
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
      <div ref={scroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5" data-p2-scroll={item.id}>
        {messages.map((m, i) => <Message key={m.id} m={m} ask={i === messages.length - 1} />)}
      </div>
      <div className="flex items-end gap-2 border-t border-primary/10 px-6 py-3">
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
          placeholder={canReply ? `Reply to ${item.source.label}…  (Space to focus, ↵ to send)` : 'This channel only takes replies in its own view'}
          aria-label={`Reply to ${item.source.label}`}
          className="min-h-[64px] flex-1 resize-none rounded-input border border-primary/20 bg-background px-3 py-2 typo-body text-foreground focus:border-primary/50 focus:outline-none"
          data-testid="p2-composer"
        />
        <Button variant="primary" size="md" onClick={send} disabled={!draft.trim()} iconRight={<CornerDownLeft className="h-4 w-4" aria-hidden />}>
          Send
        </Button>
      </div>
    </div>
  );
}
