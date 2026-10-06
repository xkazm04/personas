/**
 * "Why?" — answerable with one keystroke (a digit), skippable with one
 * (Enter). Council send-back is the exception: it needs a written reason of
 * at least 12 characters, so the field takes focus and Enter waits for it.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem } from '../../../model/decisionModel';
import { COPY } from './copy';
import { Kbd } from './Kbd';
import { EASE_OUT } from './meta';
import { COUNCIL_MIN_REASON, rejectPrompt, type SheetFlow } from './useSheetFlow';

export function ReasonPanel({ item, flow, reduce }: { item: DecisionItem; flow: SheetFlow; reduce: boolean }) {
  const prompt = rejectPrompt(item);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const required = item.kind === 'council';
  const short = required && flow.reason.trim().length < COUNCIL_MIN_REASON;

  useEffect(() => {
    if (required) fieldRef.current?.focus();
  }, [required]);

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="overflow-hidden border-b p1-hair"
    >
      <div className="space-y-2.5 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-status-error">{prompt?.title ?? COPY.sheet.armedReject}</span>
          {!required && (
            <span className="ml-auto inline-flex items-center gap-1 typo-caption">
              <Kbd>⏎</Kbd>{prompt?.skipLabel ?? COPY.sheet.noReason}
            </span>
          )}
        </div>
        {prompt && prompt.options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {prompt.options.map((o, i) => (
              <Button key={o.id} variant="secondary" size="sm" onClick={() => flow.pickReason(i)} className="[&>span]:inline-flex [&>span]:items-center [&>span]:gap-2">
                <Kbd>{i + 1}</Kbd>
                <span className="typo-label">{o.label}</span>
              </Button>
            ))}
          </div>
        )}
        {(prompt?.freeText ?? true) && (
          <textarea
            ref={fieldRef}
            rows={required ? 2 : 1}
            value={flow.reason}
            onChange={(e) => flow.setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flow.submitReason(); }
            }}
            placeholder={prompt?.placeholder ?? COPY.sheet.withReason}
            aria-label={prompt?.title ?? COPY.sheet.withReason}
            className="p1-field typo-body"
          />
        )}
        {required && (
          <div className="flex items-center gap-2">
            <span className={`typo-caption tabular-nums ${short ? '' : 'text-status-success'}`}>
              {COPY.sheet.reasonMin(flow.reason.trim().length)}
            </span>
            <span className="ml-auto" />
            <Button variant="accent" tone="error" size="sm" disabled={short} onClick={() => flow.submitReason()} className="[&>span]:inline-flex [&>span]:items-center [&>span]:gap-2">
              <span className="typo-label">{COPY.sheet.sendBack}</span>
              <Kbd>⏎</Kbd>
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
