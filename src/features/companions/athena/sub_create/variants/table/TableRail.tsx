import { RotateCcw } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine, CreateAthenaStep } from '../../engine/createAthenaTypes';
import { useStepLabel } from '../stage/StageRail';
import { deriveBeats, pathProgress, type TableBeatId, type TableBeatView } from './tableBeats';

/**
 * Left rail: the path. Five beats on a line that fills as the person moves;
 * the current beat opens into its steps. A done beat or step is a way back
 * (`goTo` revisits, it never jumps ahead).
 */
const BEAT_KEYS = {
  hello: 'table_beat_hello',
  home: 'table_beat_home',
  voice: 'table_beat_voice',
  hear: 'table_beat_hear',
  ready: 'table_beat_ready',
} as const satisfies Record<TableBeatId, string>;

const MARK: Record<CreateAthenaStep['status'], string> = { done: '✓', current: '›', skipped: '–', todo: '·' };

function Beat({ beat, onGoTo }: { beat: TableBeatView; onGoTo: CreateAthenaEngine['actions']['goTo'] }) {
  const { t } = useTranslation();
  const stepLabel = useStepLabel();
  const label = t.athena[BEAT_KEYS[beat.id]];
  const first = beat.steps.find((s) => s.status === 'done' || s.status === 'skipped');
  const showSubs = beat.status === 'now' && beat.steps.length > 1;
  return (
    <li className={`tb-beat ${beat.status}`} data-testid={`create-athena-table-beat-${beat.id}`} data-status={beat.status}>
      <span className="tb-beat-dot" aria-hidden="true" />
      {beat.status === 'done' && first ? (
        <Button variant="ghost" className="tb-beat-label" onClick={() => onGoTo(first.id)}>
          <span className="typo-heading">{label}</span>
        </Button>
      ) : (
        <span className="tb-beat-label typo-heading" aria-current={beat.status === 'now' ? 'step' : undefined}>
          {label}
        </span>
      )}
      {showSubs && (
        <ul className="tb-sub">
          {beat.steps.map((s) => (
            <li key={s.id} className={`${s.status} typo-body`} data-testid={`create-athena-table-step-${s.id}`}>
              <span className="m" aria-hidden="true">{MARK[s.status]}</span>
              {s.status === 'done' || s.status === 'skipped' ? (
                <Button variant="ghost" className="tb-link" onClick={() => onGoTo(s.id)}>
                  {stepLabel(s.id)}
                </Button>
              ) : (
                <span>{stepLabel(s.id)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function TableRail({ engine, onOpenKeys }: { engine: CreateAthenaEngine; onOpenKeys: () => void }) {
  const { t } = useTranslation();
  const c = t.athena;
  const beats = deriveBeats(engine.steps);
  const progress = pathProgress(beats);

  return (
    <aside className="tb-rail" aria-label={c.table_rail_label} data-testid="create-athena-table-rail">
      <div className="tb-eyebrow typo-label">{c.table_rail_label}</div>
      <ol className="tb-path">
        <li className="tb-path-fill" role="presentation" aria-hidden="true" style={{ height: `calc((100% - 24px) * ${progress})` }} />
        {beats.map((b) => (
          <Beat key={b.id} beat={b} onGoTo={engine.actions.goTo} />
        ))}
      </ol>
      <div className="tb-rail-foot typo-body">
        <Button variant="ghost" className="tb-link" onClick={onOpenKeys} data-testid="create-athena-table-keys">
          <kbd>?</kbd> {c.table_keys_open}
        </Button>
        <Button variant="ghost" className="tb-link" onClick={engine.actions.restart} data-testid="create-athena-restart">
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> {c.create_restart}
        </Button>
      </div>
    </aside>
  );
}
