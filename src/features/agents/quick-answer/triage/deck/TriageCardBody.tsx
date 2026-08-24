// TriageCardBody — what the reviewer actually reads.
//
// Renders the UNIFIED model, never a domain: a persona review, a backlog idea,
// a harvested practice and a build question all come through this one path.
// The only branch is `answerSlot` — items that collect an answer replace the
// prose with their input, because there is nothing to argue about a question.
//
// LAYOUT. Two bands, each with a job:
//
//   1. `TriageCardHeader` — the headline, alone on its row at the card's full
//      width, with a rule under it so the prose starts against an edge. The
//      chips and the source stamp are not in the card at all any more; they
//      straddle its borders (`CardEdgeRails`).
//   2. The scroller — the case being judged, as MARKDOWN. Scanners emit lists,
//      backticks and bold; a card that prints those symbols verbatim is asking
//      the reviewer to parse markdown in their head.
//
// Score facts (effort/impact/risk/confidence) are deliberately NOT repeated
// here — they already straddle the card's top edge as meters in MetricBadgeRow.
//
// EVERY HORIZONTAL INSET BELONGS TO `TriageCard`. The body used to hold three
// of its own — a centred ~68ch measure, a scrollbar gutter, and `p-4` on each
// block — which together cost the prose about a third of a 46rem card while the
// reviewer scrolled markdown through the remainder. The card's `px-6` is the
// only horizontal padding left; the blocks keep a small `px-3` because their
// border would otherwise sit on their own text.
import { memo, type ReactNode, type Ref } from 'react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageItem } from '../triageTypes';
import { TriageCardHeader } from './TriageCardHeader';

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-primary/12 bg-secondary/25 px-3 py-3">
      <h3 className="typo-label mb-2 text-primary">{label}</h3>
      {children}
    </section>
  );
}

/**
 * The case being judged. Memoised on the item alone.
 *
 * `TriageCard`'s own `memo` cannot protect this on a QUESTION card: `answerSlot`
 * is a fresh element on every render of the deck, so the top card re-renders on
 * every keystroke in the answer box by construction. What must NOT follow is a
 * re-parse of prose nobody touched — `MarkdownRenderer` is react-markdown +
 * remark-gfm + rehype-highlight, and a question card can carry a `reasoning`
 * block and an `evidence` dump alongside its input.
 */
const CardProse = memo(function CardProse({ item }: { item: TriageItem }) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
});

/** The body markdown. Same reason, separate component: on a question card this
 *  is replaced by `answerSlot` and must not be built at all. */
const CardBody = memo(function CardBody({ item }: { item: TriageItem }) {
  if (!item.body) return null;
  return <MarkdownRenderer content={item.body} className="typo-body text-foreground" />;
});

export function TriageCardBody({
  item,
  isTop,
  answerSlot,
  deferBody = false,
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
  /**
   * Cold-first-deal gate — see `TriageCard`. Header and scroller frame render
   * regardless; only the markdown halves (`CardBody`/`CardProse`) wait, and
   * only for the single frame the deck holds this true. Never set on the top
   * card, so `answerSlot` (top-only) never meets it.
   */
  deferBody?: boolean;
  /** Set on the TOP card only — see `TriageCard`. */
  scrollerRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();

  return (
    <>
      <TriageCardHeader item={item} />

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
        <div className="w-full space-y-4">
          {deferBody ? null : (
            <>
              {answerSlot ?? <CardBody item={item} />}
              <CardProse item={item} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
