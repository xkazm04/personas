/**
 * Folio · the running line: the book's running head, set at the foot of the
 * screen where it covers no route control. Her mark, the conversation in small
 * caps, then ONE whole sentence of her latest reply in italic (never a cut
 * sentence: a label stands in when the first sentence is long). While she
 * works, the sentence is her current step and a pen stroke draws under it.
 */

import { useMemo } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { FOLIO_COPY as C } from './copy';
import { condensedLine, latestReply } from './marks';
import { InkDrop, Key, OwlMark } from './parts';

/** The active conversation's name, with a distinct word for a dangling id. */
export function useConversationTitle(): string {
  const { t } = useTranslation();
  const conversations = useAthenaStore((s) => s.conversations);
  const activeId = useAthenaStore((s) => s.activeConversationId);
  const row = activeId ? (conversations.find((c) => c.id === activeId) ?? null) : null;
  if (row) return row.title ?? t.athena.name;
  return activeId ? t.athena.health_status_unknown : t.athena.name;
}

export function RunningLine({ engine, unread, onOpen }: { engine: AthenaChatEngine; unread: boolean; onOpen: () => void }) {
  const { shouldAnimate } = useMotion();
  const streaming = useAthenaStore((s) => s.streaming);
  const beat = useAthenaStore((s) => s.streamingBeat);
  const title = useConversationTitle();
  const last = useMemo(() => latestReply(engine.messages), [engine.messages]);
  const line = last ? condensedLine(last.content) : null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onOpen}
      className="r5c-line"
      aria-keyshortcuts="Alt+A"
      data-testid="companion-r5c-head"
    >
      <span className="sr-only">{C.openPage}. </span>
      <OwlMark size={22} writing={streaming && shouldAnimate} />
      {/* While she writes, her step takes the title's room: the mark is her. */}
      {!streaming && (
        <>
          <span className="r5c-sc typo-label r5c-line-title">{title}</span>
          <span className="r5c-line-sep" aria-hidden />
        </>
      )}
      {streaming ? (
        <span className="r5c-line-words">
          <span className="r5c-sc typo-label text-primary">{C.writing}</span>
          {/* Her step, whole or not at all: a long one stays on the page. */}
          {beat && beat.length <= 72 && <span className="typo-body italic text-foreground r5c-line-beat">{beat}</span>}
          <span className={`r5c-stroke${shouldAnimate ? ' r5c-loop' : ''}`} aria-hidden />
        </span>
      ) : last ? (
        <span className="r5c-line-words">
          <span className="typo-body italic text-foreground">{line ?? C.sheAnswered}</span>
          {!line && <RelativeTime timestamp={last.createdAt} className="typo-caption" />}
        </span>
      ) : (
        <span className="r5c-line-words typo-body italic text-foreground">{C.sayHello}</span>
      )}
      {unread && (
        <span className="r5c-line-unread">
          <InkDrop />
          <span className="sr-only">{C.unread}</span>
        </span>
      )}
      <Key>{C.keyOpen}</Key>
    </Button>
  );
}
