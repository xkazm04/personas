/**
 * The chat card's body: the thread tail, oldest first, ending at the question
 * (the last message is marked as the ask by a warning rule and the word
 * "ask"), then the composer. Space focuses the composer (the deck's key);
 * Enter sends, Shift+Enter breaks the line. `ThreadPeople` is the rail's type
 * section: who is in the thread, as monograms.
 */
import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem, DecisionThreadMessage } from '../../../model/decisionModel';
import { Mono } from './Mono';

function Message({ m, ask }: { m: DecisionThreadMessage; ask: boolean }) {
  const mine = m.author === 'user';
  return (
    <div className="r2b-msg" data-mine={mine || undefined} data-ask={ask || undefined}>
      <span className="r2b-msg-head typo-caption">
        {!mine && <Mono label={m.name} />}
        <span className="text-foreground">{m.name}</span>
        <RelativeTime timestamp={m.at} format="elapsed" className="typo-caption r2b-num" />
        {ask && <span className="r2b-ask typo-label r2b-caps">· the ask</span>}
      </span>
      <div className="r2b-msg-body">
        <MarkdownRenderer content={m.body} variant="card" className="typo-body text-foreground" />
      </div>
    </div>
  );
}

export function ThreadPeople({ item }: { item: DecisionItem }) {
  const names = [...new Set(item.thread?.messages.map((m) => m.name) ?? [])];
  return (
    <div className="flex flex-col gap-2.5">
      <span className="typo-eyebrow r2b-unit">In this thread</span>
      <div className="flex items-center gap-3">
        <span className="r2b-mono-stack">
          {names.map((n) => <Mono key={n} label={n} size="lg" tip />)}
        </span>
        <span className="typo-data r2b-num text-foreground">{names.length}</span>
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
      <div ref={scroll} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6" data-r2b-scroll={item.id}>
        {messages.map((m, i) => <Message key={m.id} m={m} ask={i === messages.length - 1} />)}
      </div>
      <div className="r2b-composer">
        <textarea
          data-r2b-composer={item.id}
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
          className="r2b-field min-h-[64px] flex-1 typo-body"
          data-testid="r2b-composer"
        />
        <Button variant="primary" size="md" onClick={send} disabled={!draft.trim()} iconRight={<CornerDownLeft className="h-4 w-4" aria-hidden />}>
          Send
        </Button>
      </div>
    </div>
  );
}
