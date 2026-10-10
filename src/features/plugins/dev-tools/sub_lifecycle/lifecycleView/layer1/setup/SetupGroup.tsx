/**
 * One step's part of the first-run checklist (Gate, or Tests) as a kit
 * section: the step's key glyph and name, how many of its commands will run,
 * where they came from (the repo, or the practice) and the kinds it measures, then its commands as rows (`SetupRowView`). Tests
 * also carries the coverage suggestions when the list has no coverage command
 * (`SetupSuggestions`). While detection answers, its head is drawn and its rows
 * are the kit's ghost rows.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Meta, Rows, Section, type RowColumn } from '@/features/shared/components/kit';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { useKindLabel } from '../../presets/useKindLabel';
import { kindsForStep } from '../../system/rules';
import { GLYPH } from '../../system/scales';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import { stepOfKind, type SetupStepId } from './setupModel';
import { SetupRowView } from './SetupRowView';
import { SetupSuggestions } from './SetupSuggestions';
import type { SetupState } from './useSetup';

export function SetupGroup({ stepId, setup, problemId, loading }: { stepId: SetupStepId; setup: SetupState; problemId: string; loading: boolean }) {
  const { dl, tx, order } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const kind = useKindLabel();
  const node = order.find((n) => n.id === stepId);
  const rows = setup.rows.filter((r) => stepOfKind(rules, r.kind) === stepId);
  const on = rows.filter((r) => r.on).length;
  const Glyph = stepGlyph(stepId);
  const columns: RowColumn[] = [{ head: dl.lc2_field_budget, width: '9rem' }];
  return (
    <div data-testid={`lc10-setup-group-${stepId}`}>
      <Section
        level={2}
        title={(
          <span className="flex items-center gap-2">
            <Glyph className={`${GLYPH.sm} shrink-0`} aria-hidden />
            {stepLabel(dl, stepId, node?.label ?? null)}
          </span>
        )}
        count={rows.length > 0 ? <><span aria-hidden><Numeric value={on} />/<Numeric value={rows.length} /></span><span className="sr-only">{tx(dl.lcx10_setup_count, { on, total: rows.length })}</span></> : undefined}
        meta={<Meta parts={[rows.some((r) => r.origin === 'configured') ? dl.lcx10_setup_pinned : dl.lcx10_setup_detected, kindsForStep(rules, stepId).map(kind).join(', ')]} />}
      >
        <Rows
          loading={loading}
          count={rows.length}
          columns={columns}
          nameHead={dl.lc2_col_command}
          empty={{ title: dl.lcx10_setup_group_none }}
        >
          {rows.map((r) => <SetupRowView key={r.key} row={r} setup={setup} problemId={problemId} />)}
        </Rows>
        {stepId === 'tests' && !loading && <SetupSuggestions setup={setup} />}
      </Section>
    </div>
  );
}
