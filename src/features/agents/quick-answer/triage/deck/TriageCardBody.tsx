// TriageCardBody — what the reviewer actually reads.
//
// Renders the UNIFIED model, never a domain: a persona review, a backlog idea,
// a harvested practice and a build question all come through this one path.
// The only branch is `answerSlot` — items that collect an answer replace the
// prose with their input, because there is nothing to argue about a question.
//
// LAYOUT (polish pass): the card is 42rem wide but prose is capped at a ~68ch
// measure, because a 90-character line is exactly the width that makes people
// skim instead of read. That cap used to be left-aligned, which left a dead
// strip down the right of every card — very visible on ideas and practices,
// whose bodies are often a single sentence. Two changes fix it:
//
//   1. The reading column is CENTRED (`mx-auto`), so a short body sits in the
//      middle of the card instead of hugging one edge.
//   2. The width the prose declines to use is spent on a fact ledger docked at
//      the card's foot — full-bleed, multi-column, and always visible because
//      it sits outside the scroller. Ideas and practices carry the most facts
//      and the least prose, so the case with the worst empty space gets the
//      most content back.
//
// Score facts (effort/impact/risk/confidence) are deliberately NOT repeated
// here — they already straddle the card's top edge as meters in MetricBadgeRow.
import type { ReactNode } from 'react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageFact, TriageItem } from '../triageTypes';
import { Chip, KIND_META, kindCopy } from './DeckChips';

/** Prose measure. Applied to the header too, so the whole card reads as one
 *  centred column rather than a centred body under a full-width header. */
const MEASURE = 'mx-auto w-full max-w-[68ch]';

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-primary/12 bg-secondary/25 p-4">
      <h3 className="typo-label mb-2 text-primary">{label}</h3>
      {children}
    </section>
  );
}

/** One cell of the docked ledger. */
function FactCell({ fact }: { fact: TriageFact }) {
  return (
    <div className="min-w-0">
      <dt className="typo-label uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
      <dd className="typo-caption truncate text-foreground" title={fact.value}>
        {/* Timestamps arrive as raw ISO strings; the ledger is the one place
            they're read as "how long has this been waiting". */}
        {fact.id === 'raised' ? <RelativeTime timestamp={fact.value} /> : fact.value}
      </dd>
    </div>
  );
}

export function TriageCardBody({ item, answerSlot }: { item: TriageItem; answerSlot?: ReactNode }) {
  const { t } = useTranslation();
  const kind = KIND_META[item.kind];
  const kindText = kindCopy(t, item.kind);
  // Scores are already meters on the top edge; repeating them as text is noise.
  const ledgerFacts = item.facts.filter((f) => !f.score);

  return (
    <>
      <header className={MEASURE}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label={kindText.one} tone={kind.tone} icon={kind.icon} />
          {item.tags.map((tag) => (
            <Chip key={tag.id} label={tag.label} tone={tag.tone} icon={tag.icon} />
          ))}
        </div>

        <h2 className="typo-heading-lg mt-3 text-balance text-foreground">{item.title}</h2>

        <div className="mt-1.5 flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${item.source.color ? '' : 'bg-primary'}`}
            style={item.source.color ? { backgroundColor: item.source.color } : undefined}
            aria-hidden
          />
          <span className="typo-caption text-foreground">{item.source.label}</span>
          {item.source.sublabel ? (
            <span className="typo-caption truncate">{`· ${item.source.sublabel}`}</span>
          ) : null}
        </div>
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
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

      {/* Docked ledger — the card's full width, outside the scroller so the
          facts a verdict depends on never scroll out from under the decision.
          Hidden while answering: a question card's job is the input. */}
      {!answerSlot && ledgerFacts.length > 0 ? (
        <footer className="mt-4 shrink-0 border-t border-primary/10 pt-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {ledgerFacts.map((fact) => (
              <FactCell key={fact.id} fact={fact} />
            ))}
          </dl>
        </footer>
      ) : null}
    </>
  );
}
