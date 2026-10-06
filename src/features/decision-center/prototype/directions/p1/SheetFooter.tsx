/**
 * The decision footer — the same anatomy on all four types: key legend left,
 * verdicts right, each verdict button wearing its key. An armed verdict
 * replaces the row with a one-line confirmation; a reason prompt opens above
 * it. Always reachable: it sits outside the sheet's one scroll region.
 */
import type { ComponentProps } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { COPY } from './copy';
import { Kbd, KeyHint } from './Kbd';
import { EASE_OUT } from './meta';
import { ReasonPanel } from './ReasonPanel';
import type { SheetFlow } from './useSheetFlow';

const SPAN_ROW = '[&>span]:inline-flex [&>span]:items-center [&>span]:gap-2';

function Act({ k, label, ...rest }: { k: string; label: string } & ComponentProps<typeof Button>) {
  return (
    <Button size="sm" {...rest} className={SPAN_ROW}>
      <span className="typo-label whitespace-nowrap">{label}</span>
      <Kbd>{k}</Kbd>
    </Button>
  );
}

function Legend({ item }: { item: DecisionItem }) {
  const type = modalTypeOf(item.kind);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <KeyHint keys={['←', '→']} label={COPY.keys.walk} />
      <KeyHint keys={['↑', '↓']} label={COPY.keys.scroll} />
      {type === 'chat' && <KeyHint keys={['Space']} label={COPY.keys.reply} />}
      {item.kind === 'report' && <KeyHint keys={['⇧', '1-5']} label={COPY.keys.rate} />}
      <KeyHint keys={['Esc']} label={COPY.keys.back} />
    </div>
  );
}

function Rating({ value, onRate }: { value: number; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center" role="radiogroup" aria-label={COPY.sheet.rate}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Button key={n} variant="ghost" size="icon-sm" role="radio" aria-checked={value === n} aria-label={`${COPY.sheet.rate} ${n}`} onClick={() => onRate(n)}>
          <Star className={`h-4 w-4 ${n <= value ? 'fill-current text-status-warning' : 'text-foreground'}`} />
        </Button>
      ))}
    </div>
  );
}

function Actions({ item, flow }: { item: DecisionItem; flow: SheetFlow }) {
  const type = modalTypeOf(item.kind);
  const L = item.verdictLabels;
  const later = <Act k="S" label={L.skip} variant="ghost" onClick={flow.skip} />;
  if (type === 'chat') {
    return <>{later}<Act k="D" label={L.reject} variant="secondary" onClick={flow.done} /></>;
  }
  if (item.kind === 'report') {
    return (
      <>
        <Rating value={flow.rating} onRate={flow.setRating} />
        {later}
        {item.branches.map((b, i) => <Act key={b.id} k={String(i + 1)} label={b.label} variant="secondary" onClick={() => flow.branch(i)} />)}
        <Act k="D" label={L.accept} variant="primary" onClick={flow.done} />
      </>
    );
  }
  return (
    <>
      <Act k="R" label={L.reject} variant="accent" tone="error" onClick={flow.reject} />
      {later}
      {type === 'backlog' && item.branches.map((b, i) => (
        <Act key={b.id} k={String(i + 1)} label={b.label} variant="secondary" onClick={() => flow.branch(i)} />
      ))}
      <Act k="A" label={L.accept} variant="primary" onClick={flow.accept} />
    </>
  );
}

export function SheetFooter({ item, flow, reduce }: { item: DecisionItem; flow: SheetFlow; reduce: boolean }) {
  const armedReject = flow.armed === 'reject' && !flow.reasonOpen;
  const armedAccept = flow.armed === 'accept';
  const swap = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };
  return (
    <div className="shrink-0 border-t p1-hair p1-band">
      <AnimatePresence initial={false}>
        {flow.reasonOpen && <ReasonPanel key="reason" item={item} flow={flow} reduce={reduce} />}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {armedReject || armedAccept ? (
          <motion.div key="armed" {...swap} transition={{ duration: 0.14, ease: EASE_OUT }}
            className={`flex items-center gap-3 px-5 py-3 ${armedReject ? 'bg-status-error/10' : 'bg-status-success/10'}`}>
            <span className={`typo-heading ${armedReject ? 'text-status-error' : 'text-status-success'}`}>
              {armedReject ? COPY.sheet.armedReject : COPY.sheet.armedAccept}
            </span>
            <span className="typo-caption">{COPY.sheet.cancel}</span>
            <span className="ml-auto" />
            <Button variant="ghost" size="sm" onClick={flow.cancel}>{COPY.sheet.cancel}</Button>
            <Act k="⏎" label={armedReject ? item.verdictLabels.reject : item.verdictLabels.accept}
              variant="accent" tone={armedReject ? 'error' : 'success'} onClick={() => flow.confirm()} />
          </motion.div>
        ) : (
          <motion.div key="idle" {...swap} transition={{ duration: 0.14, ease: EASE_OUT }} className="flex items-center gap-3 px-5 py-3">
            <Legend item={item} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Actions item={item} flow={flow} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
