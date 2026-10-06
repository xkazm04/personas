/**
 * approval — reviews, questions, approvals, policies, evolutions, goals,
 * incidents. Reading order is the 5-second order: what approving does, what
 * you must answer (questions), the case, why it was raised, the facts, and
 * the other ways to answer (digit branches).
 */
import { ExternalLink } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { DecisionItem } from '../../../model/decisionModel';
import { Block, Consequence, Facts } from './BodyParts';
import { COPY } from './copy';
import { Kbd } from './Kbd';
import { QuestionFields } from './QuestionFields';
import type { SheetFlow } from './useSheetFlow';

export function ApprovalBody({ item, flow }: { item: DecisionItem; flow: SheetFlow }) {
  return (
    <div className="space-y-5 px-6 pb-6">
      <Consequence item={item} />
      {item.input && (
        <Block label={COPY.sheet.questions}>
          <QuestionFields fields={item.input.fields} answers={flow.answers} onAnswer={flow.setAnswer} />
        </Block>
      )}
      <Block label={COPY.sheet.case}>
        <MarkdownRenderer content={item.body} variant="document" />
      </Block>
      {item.reasoning && (
        <Block label={COPY.sheet.why}>
          <p className="typo-body text-foreground">{item.reasoning}</p>
        </Block>
      )}
      {item.facts.length > 0 && (
        <Block label={COPY.sheet.facts}>
          <Facts facts={item.facts} />
        </Block>
      )}
      {item.branches.length > 0 && (
        <Block label={COPY.sheet.options}>
          <div className="space-y-1.5">
            {item.branches.map((b, i) => (
              <Button key={b.id} variant="secondary" size="md" onClick={() => flow.branch(i)} className="w-full text-left [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-2.5">
                <Kbd>{i + 1}</Kbd>
                <span className="typo-body text-foreground">{b.label}</span>
                {b.hint && <span className="ml-auto typo-caption">{b.hint}</span>}
              </Button>
            ))}
          </div>
        </Block>
      )}
      {item.links && item.links.length > 0 && (
        <Block label={COPY.sheet.links}>
          <div className="flex flex-wrap gap-2">
            {item.links.map((l) => (
              <Button key={l.id} variant="link" size="sm" iconRight={<ExternalLink className="h-3.5 w-3.5" aria-hidden />}>
                {l.label}
              </Button>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}
