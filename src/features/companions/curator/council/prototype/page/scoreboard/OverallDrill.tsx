// PROTOTYPE ROUND (spark council-readout). The anchor column, drilled: the
// council's own reading (its summary, broken at each member it walks
// through) and, beside it, the scope it judged.
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';

import type { HardFailure } from '../../protoModel';
import { splitSummary, useDate } from './format';
import { fill, S } from './strings';

function foldersAt(paths: string[], depth: number): Array<{ dir: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split('/');
    const dir = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : '.';
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count);
}

/** Folders two deep, or three when two deep says too little. */
function folders(paths: string[]): Array<{ dir: string; count: number }> {
  const two = foldersAt(paths, 2);
  return two.length >= 4 ? two : foldersAt(paths, 3);
}

const TOP_FOLDERS = 8;

export function OverallDrill({
  detail,
  members,
  hardFailures,
  paths,
}: {
  detail: CouncilRunDetail;
  members: string[];
  hardFailures: HardFailure[];
  paths: string[];
}) {
  const date = useDate();
  const parts = splitSummary(detail.run.summary, members);
  const dirs = folders(paths);
  const max = Math.max(1, ...dirs.map((d) => d.count));
  return (
    <div className="sb-drill">
      <div className="flex min-w-0 max-w-[86ch] flex-col gap-4">
        <h2 className="m-0 typo-section-title">{S.reading}</h2>
        {hardFailures.length ? (
          <div className="rounded-card border border-status-error/40 bg-status-error/[0.07] px-4 py-3">
            <p className="m-0 mb-1 typo-heading text-status-error">{S.hardFailures}</p>
            {hardFailures.map((h, i) => (
              <p key={`${h.code}-${i}`} className="m-0 typo-body text-foreground">
                <span className="typo-code">{h.code}</span> {h.detail}
              </p>
            ))}
          </div>
        ) : null}
        {detail.run.summaryIsSubjectFallback ? <p className="m-0 typo-body text-status-warning">{S.summaryFallback}</p> : null}
        {parts.map((part, i) => (
          <p key={i} className="m-0 typo-body-lg text-foreground">
            {part.member ? (
              <>
                <strong className="font-semibold text-primary">{part.text.slice(0, part.member.length)}</strong>
                {part.text.slice(part.member.length)}
              </>
            ) : (
              part.text
            )}
          </p>
        ))}
      </div>
      <aside className="sb-drill__aside flex flex-col gap-4" aria-labelledby="sb-scope-h">
        <h2 id="sb-scope-h" className="m-0 flex items-baseline gap-3 typo-section-title">
          {S.scope}
          <span className="typo-data text-muted">{fill(S.paths, { count: paths.length })}</span>
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dirs.slice(0, TOP_FOLDERS).map((d) => (
            <li key={d.dir} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2rem] items-center gap-3">
              <code className="truncate typo-code text-foreground">{d.dir}/</code>
              <span className="h-3 rounded-pill bg-primary/60" style={{ width: `${(d.count / max) * 100}%` }} />
              <span className="text-right typo-data text-foreground">{d.count}</span>
            </li>
          ))}
        </ul>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2.5">
          <dt className="typo-label text-muted">{S.head}</dt>
          <dd className="m-0 typo-code text-foreground">{detail.run.headSha.slice(0, 12)}</dd>
          <dt className="typo-label text-muted">{detail.run.finishedAt ? S.finished : S.ingested}</dt>
          <dd className="m-0 typo-body text-foreground">{date(detail.run.finishedAt ?? detail.run.ingestedAt)}</dd>
          <dt className="typo-label text-muted">{S.runDir}</dt>
          <dd className="m-0 flex items-start gap-2">
            <code className="min-w-0 break-all typo-code text-foreground">{detail.run.runDir}</code>
            <CopyButton text={detail.run.runDir} tooltip={S.copy} />
          </dd>
        </dl>
      </aside>
    </div>
  );
}
