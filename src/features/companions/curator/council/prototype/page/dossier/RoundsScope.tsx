// PROTOTYPE ROUND (spark council-readout). The Dossier's last two chapters:
// every round of this council as a line you can switch to, and the scope it
// judged - where its files sit, drawn as a bar per folder, then the raw facts.
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';

import { StateChip } from '../../../bench/chips';
import type { Rubric } from '../../../table/rubrics';
import { usePercent } from '../../../table/usePercent';
import type { CouncilRunView } from '../../../table/useCouncilRun';
import { useDate, useScore } from './format';
import { fill, S } from './strings';
import { Track } from './Track';

export function RoundsList({ run, rubric }: { run: CouncilRunView; rubric: Rubric }) {
  const score = useScore();
  const percent = usePercent();
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {[...run.chain].reverse().map((d) => {
        const on = d.run.id === run.detail?.run.id;
        return (
          <li
            key={d.run.id}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 rounded-card border px-4 py-3 ${
              on ? 'border-primary/40 bg-primary/[0.06]' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="typo-heading text-foreground">{fill(S.roundLabel, { round: d.run.roundNo })}</span>
              <span className="typo-body text-muted">{d.run.mode === 'lite' ? S.liteRound : S.fullRound}</span>
              <StateChip state={d.run.outcome} />
              {d.isLatest ? <span className="typo-label text-primary">{S.latest}</span> : null}
            </div>
            {on ? (
              <span className="typo-label text-primary">{S.onScreen}</span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => run.showRound(d.run.id)}>
                <span className="typo-body">{S.show}</span>
              </Button>
            )}
            <div className="col-span-full grid grid-cols-[4rem_minmax(0,1fr)_5rem] items-center gap-4">
              <span className="typo-data text-foreground">{d.run.overall == null ? '–' : score(d.run.overall)}</span>
              <Track size="sm" value={d.run.overall} threshold={rubric.threshold} label={S.overall} />
              <span className="text-right typo-body text-muted">{percent(d.run.coverage)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function foldersAt(paths: string[], depth: number): Array<{ dir: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split('/');
    const dir = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : '.';
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count);
}

/** Folders two deep, or three when two deep says too little (three bars for 195 files). */
function folders(paths: string[]): Array<{ dir: string; count: number }> {
  const two = foldersAt(paths, 2);
  return two.length >= 4 ? two : foldersAt(paths, 3);
}

/** Folders drawn as bars; the rest are in the full list below them. */
const TOP = 8;

export function ScopeFacts({ detail, paths }: { detail: CouncilRunDetail; paths: string[] }) {
  const date = useDate();
  const dirs = folders(paths);
  const max = Math.max(1, ...dirs.map((d) => d.count));
  const when = detail.run.finishedAt ?? detail.run.ingestedAt;
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 typo-heading-lg text-foreground">{fill(S.paths, { count: paths.length })}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {dirs.slice(0, TOP).map((d) => (
          <li key={d.dir} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_2.5rem] items-center gap-4">
            <code className="truncate typo-code text-foreground">{d.dir}/</code>
            <span className="h-3 rounded-pill bg-primary/60" style={{ width: `${(d.count / max) * 100}%` }} />
            <span className="text-right typo-data text-foreground">{d.count}</span>
          </li>
        ))}
      </ul>
      <details className="rounded-card border border-border px-4 py-3">
        <summary className="cursor-pointer typo-heading text-foreground">{S.allPaths}</summary>
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
          {paths.map((p) => (
            <li key={p} className="typo-code text-foreground">{p}</li>
          ))}
        </ul>
      </details>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3">
        <dt className="typo-label text-muted">{S.head}</dt>
        <dd className="m-0 typo-code text-foreground">{detail.run.headSha.slice(0, 12)}</dd>
        <dt className="typo-label text-muted">{detail.run.finishedAt ? S.finished : S.ingested}</dt>
        <dd className="m-0 typo-body text-foreground">{date(when)}</dd>
        <dt className="typo-label text-muted">{S.runDir}</dt>
        <dd className="m-0 flex items-start gap-2">
          <code className="min-w-0 break-all typo-code text-foreground">{detail.run.runDir}</code>
          <CopyButton text={detail.run.runDir} tooltip={S.copy} />
        </dd>
      </dl>
    </div>
  );
}
