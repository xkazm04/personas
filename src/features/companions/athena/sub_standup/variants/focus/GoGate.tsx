import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { BusyAction } from '../../data/types';
import type { StandupView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { FOCUS_COPY as F } from './copy';
import type { Progress } from './model';

interface Props {
  view: StandupView;
  progress: Progress;
  selKey: string | undefined;
  busy: Partial<Record<BusyAction, boolean>>;
  onArm: () => void;
  onAmend: () => void;
  onEnd: () => void;
}

/**
 * The thin segmented bar: one segment per counted line, in queue order, so it
 * is also a map of the queue (the selected line's segment is ringed). Drawn,
 * not chrome: its order and position are the point; the words beside it
 * carry the count for a reader.
 */
function Bar({ progress, selKey }: { progress: Progress; selKey: string | undefined }) {
  return (
    <div className="sf-bar" aria-hidden="true">
      {progress.segs.map((s) => <i key={s.key} className={`sf-bar__seg is-${s.tone} ${s.key === selKey ? 'is-sel' : ''}`} />)}
    </div>
  );
}

/** Progress, the plan it adds up to, and the one press that commits it (Arm, or Amend/End once armed). */
export function GoGate({ view, progress, selKey, busy, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const decide = view.life === 'decide';
  const count = tx(decide ? F.progress_decide : F.progress_armed, { d: progress.done, n: progress.total });
  const plan = view.plannedRuns > 0 || view.plannedDirections > 0
    ? tx(F.plan, { d: view.plannedDirections, r: view.plannedRuns })
    : F.plan_none;
  const note = decide
    ? (progress.open > 0 ? tx(F.open_left, { n: progress.open }) : F.all_open_done)
    : (progress.running > 0 ? tx(F.progress_running, { n: progress.running }) : plan);
  return (
    <div className="sf-gate">
      <div className="sf-gate__progress">
        <div className="sf-gate__line">
          <span className="typo-body k-strong text-foreground">{count}</span>
          <span className="typo-caption sf-clip">{decide ? plan : note}</span>
        </div>
        {progress.total > 0 && <Bar progress={progress} selKey={selKey} />}
        {decide && <span className="typo-caption sf-clip sf-gate__note">{note}</span>}
      </div>
      {decide && (
        <Button variant="primary" size="md" loading={busy.arm} onClick={onArm} icon={<Kbd>G</Kbd>} data-testid="standup-arm">
          {tx(s.arm, { n: view.revision })}
        </Button>
      )}
      {(view.life === 'armed' || view.life === 'return') && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" loading={busy.end} onClick={onEnd}>{s.end}</Button>
          <Button variant="secondary" size="md" loading={busy.open} onClick={onAmend} icon={<Kbd>N</Kbd>}>
            {tx(s.amend, { n: view.revision + 1 })}
          </Button>
        </div>
      )}
    </div>
  );
}
