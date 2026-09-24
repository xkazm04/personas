/**
 * The training table: one question, a fan of flying cards, proposals, composer.
 *
 * Keyboard scope lives on the table element so the composer still takes typing.
 * That element is `tabIndex={-1}` — programmatically focusable, never a tab
 * stop — because a scroll container that swallows a Tab press is a trap for
 * every keyboard user and buys nothing the shortcuts do not already give.
 *
 * Only the middle band scrolls. The composer is pinned below it, so the hand
 * you play from does not slide off the bottom of the table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import type { SetupDeskProps } from '../../../setup/setupContract';
import { deriveDeskTrail } from '../../../setup/desk/trailModel';
import { DEALER_VARIANTS } from '../cardMotion';
import { DealerCard } from './DealerCard';
import { DecisionFan } from './DecisionFan';
import { ProposalFan } from './ProposalFan';
import { TableComposer } from './TableComposer';
import { TableTrail } from './TableTrail';

type Verdict = 'accepted' | 'skipped' | null;

const isTextTarget = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable === true;
};

export function CardTable({ session, voice }: SetupDeskProps) {
  const { t, tx, language } = useTranslation();
  const xg = t.twin.experience_grok;
  const [picked, setPicked] = useState(0);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<Verdict>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const exitVariants = useMotionVariants(DEALER_VARIANTS);

  const cards = session.suggestions.slice(0, 3);
  const trail = useMemo(
    () => deriveDeskTrail(session.history, session.question),
    [session.history, session.question],
  );
  // The open suits are joined the way the reader's language joins a list —
  // never with a hard-coded English comma.
  const open = session.checklist
    .filter((item) => item.status !== 'set')
    .map((item) => xg.slots[item.id].label);
  const greeting =
    trail.isOpening && open.length > 0
      ? tx(xg.table.greeting, {
          items: new Intl.ListFormat(language, { type: 'conjunction' }).format(open),
        })
      : null;

  const intoComposer = useCallback((value: string) => setDraft(value), []);

  useEffect(() => { setPicked(0); }, [session.question]);
  useEffect(() => { tableRef.current?.focus(); }, []);

  const submit = (text: string, next: Exclude<Verdict, null>) => {
    if (!text.trim()) return;
    setVerdict(next);
    setDraft('');
    void session.answer(text.trim()).catch(
      toastCatch('features/plugins/twin/experience/table/CardTable:answer'),
    );
  };

  const skip = () => {
    setVerdict('skipped');
    void session.skip().catch(toastCatch('features/plugins/twin/experience/table/CardTable:skip'));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTextTarget(e.target)) return;
    const digit = Number(e.key);
    if (digit >= 1 && digit <= cards.length) { setPicked(digit - 1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { setPicked((p) => Math.min(p + 1, Math.max(0, cards.length - 1))); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft') { setPicked((p) => Math.max(p - 1, 0)); e.preventDefault(); return; }
    if (e.key === 'Enter' && cards[picked]) { submit(cards[picked].text, 'accepted'); e.preventDefault(); return; }
    if (e.key.toLowerCase() === 'e' && cards[picked]) { setDraft(cards[picked].text); e.preventDefault(); return; }
    if (e.key.toLowerCase() === 's') { skip(); e.preventDefault(); }
  };

  const exitKey = verdict === 'accepted' ? 'exitAccept' : verdict === 'skipped' ? 'exitSkip' : 'exitNone';

  return (
    <div
      ref={tableRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="setup-desk"
      className="flex-1 min-h-0 flex flex-col outline-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-5">
        <TableTrail history={session.history} question={session.question} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={session.question ?? 'idle'}
            variants={exitVariants}
            initial="hidden"
            animate="show"
            exit={exitKey}
            onAnimationComplete={() => setVerdict(null)}
          >
            <DealerCard
              focus={session.focus}
              greeting={greeting}
              question={session.question ?? xg.table.noQuestion}
              busy={session.busy}
            />
            <DecisionFan
              cards={cards}
              picked={picked}
              busy={session.busy}
              focus={session.focus}
              onPick={setPicked}
              onCommit={(text) => submit(text, 'accepted')}
            />
          </motion.div>
        </AnimatePresence>
        <ProposalFan session={session} intoComposer={intoComposer} />
      </div>
      <div className="flex-shrink-0 border-t border-primary/15 bg-background/70 px-4 md:px-8 py-3">
        <TableComposer
          draft={draft}
          onDraft={setDraft}
          onSubmit={() => submit(draft, 'accepted')}
          onSkip={skip}
          busy={session.busy}
          voice={voice}
        />
      </div>
    </div>
  );
}

export default CardTable;
