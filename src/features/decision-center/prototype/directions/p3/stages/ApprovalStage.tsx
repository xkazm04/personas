/**
 * approval — the ask is the header title; the first thing under it is WHAT
 * APPROVING DOES (the alert promoted, or the kind's consequence), then the
 * options (1-9), the question fields, facts and the body.
 */
import { CornerDownRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { KeyValueGrid, KitHost } from '@/features/shared/components/kit';
import type { DecisionItem } from '../../../../model/decisionModel';
import { Kbd } from '../parts';
import type { DeskCtl } from '../useDesk';
import { QuestionFields } from './QuestionFields';

const CONSEQUENCE: Partial<Record<DecisionItem['kind'], string>> = {
  review: 'The held run resumes with this output.',
  approval: 'Athena carries out the action now.',
  policy: 'The routing policy changes for every future run.',
  evolution: 'The challenger replaces the incumbent genome.',
  goal: 'The goal closes as done and leaves the board.',
  question: 'The paused build resumes with your answers.',
  incident: 'The incident is marked resolved.',
};

export function ApprovalStage({ item, ctl }: { item: DecisionItem; ctl: DeskCtl }) {
  const alert = item.alert;
  return (
    <div className="flex flex-col gap-5 px-6 pb-6">
      <div className={`p3-ask flex flex-col gap-1 px-4 py-3 ${alert ? '' : 'is-calm'}`}>
        <span className={`typo-label ${alert ? 'text-status-warning' : 'text-primary'}`}>
          If you {item.verdictLabels.accept.toLowerCase()}
        </span>
        <span className="typo-body-lg text-foreground">{alert?.detail ?? CONSEQUENCE[item.kind] ?? item.body}</span>
        {alert && <span className="typo-caption">{alert.label}</span>}
      </div>

      {item.branches.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label text-foreground">Or choose another way</span>
          {item.branches.map((b, i) => (
            <Button key={b.id} variant="secondary" size="md" block onClick={() => ctl.branch(i)} className="justify-start text-left">
              <span className="flex w-full items-center gap-3">
                <Kbd>{i + 1}</Kbd>
                <span className="typo-body text-foreground">{b.label}</span>
                {b.hint && <span className="ml-auto inline-flex items-center gap-1 typo-caption"><CornerDownRight className="h-3 w-3" aria-hidden />{b.hint}</span>}
              </span>
            </Button>
          ))}
        </div>
      )}

      {item.input && <QuestionFields fields={item.input.fields} answers={ctl.answers} onAnswer={ctl.setAnswer} />}

      {item.facts.length > 0 && (
        <KitHost>
          <KeyValueGrid items={item.facts.map((f) => ({ k: f.label, v: f.value }))} min="9rem" />
        </KitHost>
      )}

      <div className="flex flex-col gap-2">
        <span className="typo-label text-foreground">Details</span>
        <MarkdownRenderer content={item.body} variant="card" />
        {item.reasoning && <p className="typo-caption">Why: {item.reasoning}</p>}
      </div>
    </div>
  );
}
