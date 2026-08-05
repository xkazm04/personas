// TriageCardBody — what the reviewer actually reads.
//
// Renders the UNIFIED model, never a domain: a persona review, a backlog idea,
// a harvested practice and a build question all come through this one path.
// The only branch is `answerSlot` — items that collect an answer replace the
// prose with their input, because there is nothing to argue about a question.
//
// LAYOUT. The card is 46rem wide but prose is capped at a ~68ch measure,
// because a 90-character line is exactly the width that makes people skim
// instead of read. Three bands, each with a job:
//
//   1. `TriageCardHeader` — chips, the source stamp in the corner, the
//      headline, and a rule under all of it so the prose starts against an edge.
//   2. The scroller — the case being judged, as MARKDOWN. Scanners emit lists,
//      backticks and bold; a card that prints those symbols verbatim is asking
//      the reviewer to parse markdown in their head.
//   3. `TriageFactRow` — the remaining facts on ONE line, docked outside the
//      scroller so nothing a verdict depends on scrolls away under the decision.
//
// Score facts (effort/impact/risk/confidence) are deliberately NOT repeated
// here — they already straddle the card's top edge as meters in MetricBadgeRow.
import type { ReactNode, Ref } from 'react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageItem } from '../triageTypes';
import { TriageCardHeader } from './TriageCardHeader';
import { TriageFactRow } from './TriageFactRow';

/** Prose measure. Centred, so a one-sentence body sits in the middle of the
 *  card rather than hugging its left edge. */
const MEASURE = 'mx-auto w-full max-w-[68ch]';

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-primary/12 bg-secondary/25 p-4">
      <h3 className="typo-label mb-2 text-primary">{label}</h3>
      {children}
    </section>
  );
}

export function TriageCardBody({
  item,
  isTop,
  answerSlot,
  scrollerRef,
}: {
  item: TriageItem;
  /**
   * Whether this is the card being decided.
   *
   * Load-bearing for the keyboard, not for paint: the deck keeps THREE cards
   * mounted for depth, and an unconditional `tabIndex={0}` made all three prose
   * scrollers tab stops. Two of them sit under `pointer-events-none`, which
   * removes the mouse but NOT the tab order — so tabbing through the deck
   * landed twice on scrollers the reviewer cannot see, cannot scroll to any
   * visible effect, and is not deciding.
   */
  isTop: boolean;
  answerSlot?: ReactNode;
  /** Set on the TOP card only — see `TriageCard`. */
  scrollerRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();

  return (
    <>
      <TriageCardHeader item={item} t={t} />

      {/* Focusable, and named. A scroller with no `tabIndex` and no focusable
          descendant is unreachable by keyboard, which on this surface meant a
          40-line description could only ever be read down to the fold — while
          `←`/`→` recorded a verdict on it. `useDeckDialog` also drives it from
          ↑/↓/PgUp/PgDn without needing the focus, and focuses it FIRST on open
          so the reviewer lands on the prose rather than on a filter chip.

          `-1` and not "no tabIndex" for the cards behind: they stay
          programmatically focusable (and keep `role="region"`), they just leave
          the tab ring, which only the card being decided belongs in. */}
      <div
        ref={scrollerRef}
        tabIndex={isTop ? 0 : -1}
        role="region"
        aria-label={t.monitor.triage_body_region}
        className="focus-ring mt-4 min-h-0 flex-1 overflow-y-auto"
      >
        <div className={`${MEASURE} space-y-4 pr-1`}>
          {answerSlot ??
            (item.body ? (
              <MarkdownRenderer content={item.body} className="typo-body text-foreground" />
            ) : null)}

          {item.reasoning ? (
            <Block label={t.monitor.triage_why_raised}>
              <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
            </Block>
          ) : null}

          {item.evidence ? (
            <Block label={t.monitor.triage_evidence}>
              <pre className="typo-code whitespace-pre-wrap break-words text-foreground">
                {item.evidence}
              </pre>
            </Block>
          ) : null}
        </div>
      </div>

      {/* Hidden while answering: a question card's job is the input. */}
      {answerSlot ? null : <TriageFactRow facts={item.facts} />}
    </>
  );
}
