// The one control beside a Next action, by kind:
// - a failing command: "Open the run" (its row, scrolled to, its error open);
// - a slow command with no item filed: "Edit budget" (the Commands editor);
// - no coverage command: "Add a coverage command" (the editor with a coverage row);
// - stale or never measured: "Measure now", the header's own Measure;
// - docs that need work: "Fix N docs", handed to Athena naming them;
// - below the done-rate target: "Ask Athena to adjust the practice".
// A slow command with its item filed carries the item's link in its sentence
// instead, and "too few changes" has nothing to press.
import { Gauge, Pencil, Plus, ScrollText, Sparkles } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { stepLabel } from '../../../journey/journeyLabels';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useMeasureNow } from '../../blocks/useMeasureNow';
import { useLifecycleViewModel } from '../../context';
import { fixDocsPrompt } from '../../presets/docs/docsAsk';
import { ReservedLabel } from '../../system/ReservedLabel';
import { GLYPH } from '../../system/scales';
import type { NextAction } from './nextModel';

function AskCta({ text, label, testId }: { text: string; label: string; testId: string }) {
  const ask = useAskAthena();
  return (
    <Button variant="accent" tone="agent" size="sm" icon={<Sparkles className={GLYPH.sm} />} onClick={() => ask('lifecycle', text)} data-testid={testId}>
      {label}
    </Button>
  );
}

function MeasureCta() {
  const { dl } = useLifecycleViewModel();
  const { measure, running } = useMeasureNow();
  return (
    <AsyncButton variant="secondary" size="sm" icon={<Gauge className={GLYPH.sm} />} onClick={measure} disabled={running} data-testid="lc2-next-measure">
      <ReservedLabel shown={running ? dl.lc2_measuring : dl.lcx5_next_measure_now} others={[running ? dl.lcx5_next_measure_now : dl.lc2_measuring]} />
    </AsyncButton>
  );
}

export function NextCta({ action: a, node }: { action: NextAction; node: JourneyNode }) {
  const { dl, tx, openStep, projectId, projectName } = useLifecycleViewModel();
  const stepId = node.id;
  const { language } = useTranslation();
  const name = projectName ?? '';
  const id = projectId ?? '';
  switch (a.kind) {
    case 'failing':
      return (
        <Button variant="secondary" size="sm" icon={<ScrollText className={GLYPH.sm} />} onClick={() => openStep(stepId, `run:${a.commandId}`)} data-testid={`lc2-next-run-${a.commandId}`}>
          {dl.lcx5_next_open_run}
        </Button>
      );
    case 'over_budget':
      return a.item ? null : (
        <Button variant="secondary" size="sm" icon={<Pencil className={GLYPH.sm} />} onClick={() => openStep(stepId, 'commands')} data-testid="lc2-next-budget">
          {dl.lcx5_next_edit_budget}
        </Button>
      );
    case 'add_coverage':
      return (
        <Button variant="accent" tone="info" size="sm" icon={<Plus className={GLYPH.sm} />} onClick={() => openStep(stepId, 'coverage')} data-testid="lc2-next-coverage">
          {dl.lc2_coverage_add}
        </Button>
      );
    case 'measure':
      return <MeasureCta />;
    case 'fix_docs': {
      const docs = [...a.broken, ...a.stale];
      return (
        <AskCta
          text={fixDocsPrompt({ dl, tx }, { name, id }, docs)}
          label={docs.length === 1 ? dl.lcx5_next_fix_docs_one : tx(dl.lcx5_next_fix_docs, { count: docs.length })}
          testId="lc2-next-docs"
        />
      );
    }
    case 'adjust_practice': {
      const step = stepLabel(dl, node.id, node.label);
      const pct = (v: number) => formatNumeric(v, 'percent', { precision: 0, language });
      const vars = { name, id, step, done: pct(a.donePct), target: pct(a.targetPct), reason: a.reason ?? '' };
      return (
        <AskCta
          text={tx(a.reason ? dl.lcx5_ask_practice_reason : dl.lcx5_ask_practice, vars)}
          label={dl.lcx5_next_adjust}
          testId="lc2-next-adjust"
        />
      );
    }
    case 'more_evidence':
      return null;
  }
}
