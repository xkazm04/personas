/**
 * Folio · the reading page: a head (her mark, the conversation switcher, the
 * real keys) over a reading column that opens at the LATEST words and stays
 * pinned there while she writes, unless you scroll up to read.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { ConversationSwitcher } from '../../../../../ConversationSwitcher';
import { QueuedMessages } from '../../../../../QueuedMessages';
import { QuickReplies } from '../../../../../QuickReplies';
import { useAthenaStore } from '../../../../../athenaStore';
import { useChatScroll } from '../../../../../useChatScroll';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { FOLIO_COPY as C } from './copy';
import { Key, OwlMark } from './parts';
import { StreamingPassage } from './StreamingPassage';
import { Transcript } from './Transcript';

export function ReadingPage({
  engine,
  onFold,
  onOpenWaiting,
  waiting,
}: {
  engine: AthenaChatEngine;
  /** How many items wait on you: the head names the folio by it. */
  waiting: number;
  onFold: () => void;
  onOpenWaiting: () => void;
}) {
  const { shouldAnimate } = useMotion();
  const streaming = useAthenaStore((s) => s.streaming);
  const streamingText = useAthenaStore((s) => s.streamingText);
  const quickReplies = useAthenaStore((s) => s.quickReplies);
  const { scrollRef, scrollToBottom, maybeAutoScroll } = useChatScroll(true);
  const columnRef = useRef<HTMLDivElement>(null);

  // Open on the latest words, and keep them in view as late content settles
  // (markdown, code blocks) unless the reader has scrolled away.
  useLayoutEffect(() => scrollToBottom('auto'), [scrollToBottom]);
  useEffect(maybeAutoScroll, [engine.messages, streaming, streamingText, maybeAutoScroll]);
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => maybeAutoScroll());
    ro.observe(el);
    return () => ro.disconnect();
  }, [maybeAutoScroll]);

  return (
    <>
      <header className="r5c-page-head">
        <OwlMark size={24} writing={streaming && shouldAnimate} />
        <ConversationSwitcher />
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="r5c-page-keys" onClick={onOpenWaiting} aria-keyshortcuts="Alt+W">
          <Key>{C.keyFolio}</Key>
          <span className="typo-caption">{waiting ? C.waitingCount(waiting) : C.noneWaiting}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onFold} aria-keyshortcuts="Escape" data-testid="companion-r5c-fold">
          {C.foldPage} <Key>{C.keyFold}</Key>
        </Button>
      </header>
      <motion.div ref={scrollRef} layoutScroll className="r5c-page-body scrollbar-thin" data-testid="companion-r5c-transcript">
        <div ref={columnRef} className="r5c-column athena-exchange">
          {engine.messages.length === 0 && !streaming && (
            <div className="r5c-clean">
              <OwlMark size={40} />
              <p className="typo-heading-lg italic text-foreground">{C.cleanPage}</p>
              <p className="typo-body italic">{C.cleanPageLine}</p>
            </div>
          )}
          <Transcript engine={engine} onOpenWaiting={onOpenWaiting} />
          <StreamingPassage onStop={engine.interrupt} />
          <div className="r5c-after">
            <QueuedMessages />
            {!streaming && <QuickReplies options={quickReplies} disabled={!engine.initialized} onPick={engine.send} />}
          </div>
        </div>
      </motion.div>
    </>
  );
}
