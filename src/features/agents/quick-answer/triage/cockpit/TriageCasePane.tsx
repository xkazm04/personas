/**
 * TriageCasePane — the centre pane, and the reason this variant exists.
 *
 * Everything else in the Cockpit is chrome around one claim: that some queues
 * are twelve items that each deserve to be READ, not forty that deserve to be
 * flicked. So this pane is typeset, not laid out — one headline at hero size, a
 * ~68ch measure on every block of prose, a real rule between the identifying
 * matter and the argument, and body copy at full foreground contrast because
 * muted long-form text is the fastest way to make a reading surface unreadable.
 *
 * The vertical rhythm is deliberate: WHAT it is (chips) → WHAT it says
 * (headline) → WHO says it (attribution) → the case (body) → why it was raised
 * (reasoning) → the receipts (evidence). Reasoning is set behind a rule and one
 * step down the type scale so it reads as commentary on the case, not more case.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import type { RefObject } from 'react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';

import type { TriageItem } from '../triageTypes';
import { KIND_META, TONE_CHIP } from './cockpitKinds';
import { TriageAnswerPanel } from './TriageAnswerPanel';

export function TriageCasePane({
  item,
  answer,
  onAnswerChange,
  onAnswerSubmit,
  busy,
  answerRef,
}: {
  item: TriageItem;
  answer: string;
  onAnswerChange: (next: string) => void;
  onAnswerSubmit: () => void;
  busy: boolean;
  answerRef: RefObject<HTMLInputElement | null>;
}) {
  const meta = KIND_META[item.kind];
  const KindIcon = meta.icon;
  const body = item.body.trim();
  const reasoning = item.reasoning?.trim();
  const evidence = item.evidence?.trim();

  return (
    <section
      className="flex-1 min-w-0 overflow-y-auto bg-background"
      aria-label="Case detail"
      // Scroll the reading column back to the top whenever the case changes.
      key={item.id}
    >
      <article className="mx-auto w-full max-w-[736px] px-10 py-9 flex flex-col gap-6">
        {/* WHAT it is */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border border-primary/25 bg-primary/10 typo-label text-primary">
            <KindIcon className="w-3 h-3" aria-hidden="true" />
            {meta.label}
          </span>
          {item.tags.map((tag) => (
            <span
              key={tag.id}
              className={`px-2 py-1 rounded-interactive border typo-label ${TONE_CHIP[tag.tone]}`}
            >
              {tag.label}
            </span>
          ))}
        </div>

        {/* WHAT it says */}
        <h1 className="typo-hero text-foreground text-balance">{item.title}</h1>

        {/* WHO says it */}
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${item.source.color ? '' : 'bg-primary/60'}`}
            style={item.source.color ? { backgroundColor: item.source.color } : undefined}
            aria-hidden="true"
          />
          <span className="typo-caption text-foreground">{item.source.label}</span>
          {item.source.sublabel && (
            <>
              <span className="w-1 h-1 rounded-full bg-foreground/40" aria-hidden="true" />
              <span className="typo-caption text-foreground">{item.source.sublabel}</span>
            </>
          )}
          <span className="w-1 h-1 rounded-full bg-foreground/40" aria-hidden="true" />
          <RelativeTime timestamp={item.createdAt} className="typo-caption text-foreground" />
        </div>

        <hr className="border-0 h-px bg-primary/15" />

        {/* THE CASE */}
        {body && (
          <MarkdownRenderer
            content={body}
            className="typo-body-lg text-foreground max-w-[68ch] leading-relaxed"
          />
        )}

        {item.input && (
          <TriageAnswerPanel
            input={item.input}
            value={answer}
            onChange={onAnswerChange}
            onSubmit={onAnswerSubmit}
            submitLabel={item.verdictLabels.accept}
            disabled={busy}
            inputRef={answerRef}
          />
        )}

        {reasoning && (
          <section className="max-w-[68ch]">
            <SectionLabel className="text-muted-foreground">Why this was raised</SectionLabel>
            <div className="border-l-2 border-primary/25 pl-4">
              <MarkdownRenderer
                content={reasoning}
                className="typo-body text-foreground/90 leading-relaxed"
              />
            </div>
          </section>
        )}

        {evidence && (
          <section className="max-w-[68ch]">
            <SectionLabel className="text-muted-foreground">Evidence</SectionLabel>
            <pre className="typo-code text-foreground/90 bg-secondary/30 border border-primary/12 rounded-card px-4 py-3.5 whitespace-pre-wrap break-words">
              {evidence}
            </pre>
          </section>
        )}
      </article>
    </section>
  );
}
