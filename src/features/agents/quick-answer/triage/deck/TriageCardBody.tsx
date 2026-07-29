// TriageCardBody — what the reviewer actually reads.
//
// Renders the UNIFIED model, never a domain: a persona review, a backlog idea,
// a harvested practice and a build question all come through this one path.
// The only branch is `answerSlot` — items that collect an answer replace the
// prose with their input, because there is nothing to argue about a question.
//
// Prose is capped at ~68ch. A 42rem card would otherwise run ~90 characters a
// line, which is exactly the measure that makes people skim instead of read —
// the failure mode a triage surface can least afford.
import type { ReactNode } from 'react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

import type { TriageItem } from '../triageTypes';
import { Chip, KIND_META } from './DeckChips';

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-primary/12 bg-secondary/25 p-4">
      <h3 className="typo-label mb-2 text-primary">{label}</h3>
      {children}
    </section>
  );
}

export function TriageCardBody({ item, answerSlot }: { item: TriageItem; answerSlot?: ReactNode }) {
  const kind = KIND_META[item.kind];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip label={kind.one} tone={kind.tone} icon={kind.icon} />
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

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="max-w-[68ch] space-y-4">
          {answerSlot ??
            (item.body ? (
              <MarkdownRenderer content={item.body} className="typo-body text-foreground" />
            ) : null)}

          {item.reasoning ? (
            <Block label="Why this was raised">
              <MarkdownRenderer content={item.reasoning} className="typo-body text-foreground" />
            </Block>
          ) : null}

          {item.evidence ? (
            <Block label="Evidence">
              <pre className="typo-code overflow-x-auto whitespace-pre-wrap break-words text-foreground">
                {item.evidence}
              </pre>
            </Block>
          ) : null}
        </div>
      </div>
    </>
  );
}
