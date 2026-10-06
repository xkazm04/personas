/**
 * chat — the thread tail ending at the question asked of you, and a composer.
 * Space focuses it; Enter sends, Shift+Enter is a newline.
 */
import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../../model/decisionModel';
import { Kbd } from '../parts';
import type { DeskCtl } from '../useDesk';

const AUTHOR_INK = { user: 'text-role-human', persona: 'text-role-agent', athena: 'text-role-highlight' } as const;

export function ChatThread({ item }: { item: DecisionItem }) {
  const messages = item.thread?.messages ?? [];
  return (
    <ol className="flex flex-col gap-3 px-6 pb-4" aria-label="Thread">
      {messages.map((m, i) => {
        const last = i === messages.length - 1;
        const you = m.author === 'user';
        return (
          <li key={m.id} className={`flex flex-col gap-1 ${you ? 'items-end' : 'items-start'}`}>
            <span className="flex items-center gap-2 typo-caption">
              <span className={`typo-label ${AUTHOR_INK[m.author]}`}>{m.name}</span>
              <RelativeTime timestamp={m.at} />
              {last && !you && <span className="typo-label text-status-warning">Asked of you</span>}
            </span>
            <div className={`p3-bubble max-w-[80%] px-3.5 py-2.5 ${you ? 'is-you' : ''} ${last && !you ? 'is-ask' : ''}`}>
              <MarkdownRenderer content={m.body} variant="card" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ChatComposer({ item, ctl }: { item: DecisionItem; ctl: DeskCtl }) {
  const [text, setText] = useState('');
  if (!item.thread?.canReply) {
    return <p className="typo-caption px-6 py-3">This channel cannot take a reply from here — open it in its own view.</p>;
  }
  const send = () => { ctl.reply(text); setText(''); };
  return (
    <div className="flex items-end gap-2 border-t border-border px-6 py-3">
      <textarea
        ref={ctl.composerRef}
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
        placeholder={`Reply to ${item.source.label}…  (Space to focus · Enter sends · Shift+Enter newline)`}
        aria-label="Reply"
        className="typo-body min-h-[44px] flex-1 resize-none rounded-input border border-border bg-background px-3 py-2 text-foreground"
        data-testid="p3-composer"
      />
      <Button variant="primary" size="md" onClick={send} disabled={!text.trim()} icon={<SendHorizontal className="h-4 w-4" aria-hidden />}>
        <span className="inline-flex items-center gap-2">Send <Kbd>↵</Kbd></span>
      </Button>
    </div>
  );
}
