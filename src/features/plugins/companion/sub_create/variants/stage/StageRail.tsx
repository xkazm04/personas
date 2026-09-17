import { Check, RotateCcw } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  CreateAthenaEngine,
  CreateAthenaStep,
  CreateAthenaStepId,
} from '../../engine/createAthenaTypes';
import { StageHero } from './StageHero';

/**
 * Left rail: hero on top, the numbered step list (the wizard IS a sequence,
 * so the numbers carry information), progress caption + restart at the foot.
 * Only `done` / `skipped` rows are buttons — the contract's `goTo` is for
 * revisiting, never for jumping ahead.
 */
export interface StageRailProps {
  engine: CreateAthenaEngine;
}

const STEP_LABEL_KEYS = {
  intro: 'create_step_intro',
  footer_icon: 'create_step_footer_icon',
  orb: 'create_step_orb',
  orb_place: 'create_step_orb_place',
  chime: 'create_step_chime',
  voice_engine: 'create_step_voice_engine',
  voice_install: 'create_step_voice_install',
  voice_pick: 'create_step_voice_pick',
  stt: 'create_step_stt',
  handoff: 'create_step_handoff',
} as const satisfies Record<CreateAthenaStepId, string>;

export function useStepLabel(): (id: CreateAthenaStepId) => string {
  const { t } = useTranslation();
  return (id) => t.plugins.companion[STEP_LABEL_KEYS[id]];
}

function StepMarker({ index, status }: { index: number; status: CreateAthenaStep['status'] }) {
  const base = 'flex items-center justify-center w-6 h-6 rounded-pill typo-caption tabular-nums shrink-0';
  switch (status) {
    case 'done':
      return (
        <span className={`${base} bg-primary/15 text-primary`}>
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
      );
    case 'current':
      return <span className={`${base} bg-primary text-primary-foreground font-medium`}>{index}</span>;
    case 'skipped':
      return (
        <span className={`${base} border border-dashed border-foreground/30 text-foreground/85`}>
          {index}
        </span>
      );
    default:
      return <span className={`${base} border border-foreground/10 text-foreground/85`}>{index}</span>;
  }
}

function StepRow({
  step,
  index,
  label,
  onGoTo,
}: {
  step: CreateAthenaStep;
  index: number;
  label: string;
  onGoTo: (id: CreateAthenaStepId) => void;
}) {
  const revisitable = step.status === 'done' || step.status === 'skipped';
  // Hierarchy comes from weight + the marker, not from fading text below the
  // contrast floor: current is medium, done is regular, todo/skipped are
  // captions (skipped additionally struck).
  const labelClass =
    step.status === 'current'
      ? 'typo-body font-medium text-foreground'
      : step.status === 'done'
        ? 'typo-body text-foreground/85'
        : step.status === 'skipped'
          ? 'typo-caption line-through decoration-foreground/30'
          : 'typo-caption';
  const rowClass = 'flex items-center gap-3 w-full px-3 py-1.5 rounded-interactive text-left';
  const testId = `create-athena-rail-step-${step.id}`;

  if (revisitable) {
    return (
      <li>
        <button
          type="button"
          className={`${rowClass} hover:bg-secondary/40 focus-ring transition-colors duration-fast motion-reduce:transition-none`}
          onClick={() => onGoTo(step.id)}
          data-testid={testId}
          data-status={step.status}
        >
          <StepMarker index={index} status={step.status} />
          <span className={labelClass}>{label}</span>
        </button>
      </li>
    );
  }
  return (
    <li
      className={`${rowClass} ${step.status === 'current' ? 'bg-secondary/40' : ''}`}
      aria-current={step.status === 'current' ? 'step' : undefined}
      data-testid={testId}
      data-status={step.status}
    >
      <StepMarker index={index} status={step.status} />
      <span className={labelClass}>{label}</span>
    </li>
  );
}

export function StageRail({ engine }: StageRailProps) {
  const { t, tx } = useTranslation();
  const stepLabel = useStepLabel();
  const c = t.plugins.companion;

  return (
    <aside
      className="flex flex-col w-[280px] shrink-0 h-full min-h-0 border-r border-foreground/10 bg-secondary/20"
      data-testid="create-athena-stage-rail"
    >
      <StageHero speaking={engine.speaking} />
      <ol className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5" aria-label={c.create_tab_title}>
        {engine.steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i + 1}
            label={stepLabel(step.id)}
            onGoTo={engine.actions.goTo}
          />
        ))}
      </ol>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-foreground/10">
        <span className="typo-caption text-foreground/85 tabular-nums">
          {tx(c.create_progress, { current: engine.stepIndex + 1, total: engine.stepCount })}
        </span>
        <Button
          variant="ghost"
          size="xs"
          icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
          onClick={engine.actions.restart}
          data-testid="create-athena-restart"
        >
          {c.create_restart}
        </Button>
      </div>
    </aside>
  );
}
