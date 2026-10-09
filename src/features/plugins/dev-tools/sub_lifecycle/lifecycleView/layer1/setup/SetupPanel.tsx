/**
 * THE FIRST-RUN SETUP: Layer 1's status slot for a project that has never been
 * measured (`setupModel.needsSetup`). It says what Lifecycle does ("measures
 * your pipeline by running its own commands"), lists the commands it would run
 * as a checklist grouped by step (Gate, Tests; `SetupGroup`), each with its kind
 * and an editable time budget, suggests a coverage command when none was found,
 * and offers two ways on:
 *
 * - Save and Measure: the checklist becomes the steps' commands (a new practice
 *   version), then a Measure starts;
 * - Measure with these: a Measure on what is in force now, saving nothing.
 *
 * When nothing was found at all it says so and offers the Gate editor. While
 * detection answers, the two groups are drawn with ghost rows under their real
 * heads. Once a Measure starts, the Measure panel takes the slot
 * (`layer1/Layer1`); once one has landed, the status plate does.
 */
import { useId } from 'react';
import { Gauge, Play, Settings2 } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import { useLifecycleViewModel } from '../../context';
import { draftProblem } from '../../presets/useCommandsEditor';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { SETUP_STEPS } from './setupModel';
import { SetupGroup } from './SetupGroup';
import { useSetup, type SetupState } from './useSetup';

function useNote(setup: SetupState): string {
  const { dl } = useLifecycleViewModel();
  if (setup.showProblems && setup.rows.some((r) => r.on && draftProblem(r))) return dl.lc2_field_budget_invalid;
  if (setup.result) return setup.result.text;
  if (setup.refusal?.kind === 'nothing') return dl.lcx4_nothing;
  if (setup.refusal) return `${dl.lc2_measure_failed}: ${setup.refusal.text}`;
  return '';
}

/** Save and Measure, and Measure on what is in force (renamed once the list is edited, since it ignores the edits). */
function SetupActions({ setup }: { setup: SetupState }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <AsyncButton
        variant="primary"
        size="sm"
        icon={<Gauge className={GLYPH.sm} />}
        onClick={setup.saveAndMeasure}
        disabled={setup.detect !== 'ready' || setup.rows.length === 0 || setup.running}
        data-testid="lc10-setup-save"
      >
        {dl.lcx10_setup_save_measure}
      </AsyncButton>
      <AsyncButton
        variant="secondary"
        size="sm"
        icon={<Play className={GLYPH.sm} />}
        onClick={setup.measureOnly}
        disabled={setup.saving || setup.running}
        data-testid="lc10-setup-measure"
      >
        {setup.edited ? dl.lcx10_setup_measure_unsaved : dl.lcx10_setup_measure}
      </AsyncButton>
    </div>
  );
}

export function SetupPanel() {
  const { dl, openStep } = useLifecycleViewModel();
  const { t } = useTranslation();
  const setup = useSetup();
  const titleId = useId();
  const problemId = useId();
  const note = useNote(setup);
  const nothing = setup.detect === 'ready' && setup.rows.length === 0 && setup.templates.length === 0;
  return (
    <section aria-labelledby={titleId} className={`@container/setup ${lcSurface('plate')}`} data-testid="lc10-setup" data-detect={setup.detect}>
      {/* The head carries the two ways on, so they are on screen at 1280x800 however long the list. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_24rem] items-start gap-3">
          <Gauge className={`${GLYPH.md} mt-0.5 shrink-0 text-primary`} aria-hidden />
          <div className="min-w-0">
            <h2 id={titleId} className={LT.title}>{dl.lcx10_setup_title}</h2>
            {/* With nothing found there is nothing to choose: the empty state below says what to do. */}
            {!nothing && <p className={LT.meta}>{dl.lcx10_setup_body}</p>}
          </div>
        </div>
        {!nothing && <SetupActions setup={setup} />}
      </div>
      {/* Always mounted, so a problem, a failed save or a refused Measure is announced when its text arrives. */}
      <p id={problemId} role="status" className={note ? `mt-2 ${LT.row} text-status-error` : 'sr-only'} data-testid="lc10-setup-note">{note}</p>
      {setup.detect === 'failed' && (
        <p className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 ${LT.row} text-status-error`} data-testid="lc10-setup-detect-failed">
          {`${dl.lcx10_setup_detect_failed}: ${setup.detectError ?? ''}`}
          <Button variant="link" size="xs" onClick={setup.retry}>{t.common.retry}</Button>
        </p>
      )}
      {nothing ? (
        <EmptyState
          icon={Settings2}
          title={dl.lcx10_setup_none_title}
          subtitle={dl.lcx10_setup_none_body}
          action={{ label: dl.lcx10_setup_add_command, icon: Settings2, onClick: () => openStep('gate', 'commands') }}
        />
      ) : setup.detect !== 'failed' && (
        <div className="mt-3 grid grid-cols-1 gap-x-8 @[80rem]/setup:grid-cols-2">
          {SETUP_STEPS.map((id) => <SetupGroup key={id} stepId={id} setup={setup} problemId={problemId} loading={setup.detect === 'loading'} />)}
        </div>
      )}
    </section>
  );
}
