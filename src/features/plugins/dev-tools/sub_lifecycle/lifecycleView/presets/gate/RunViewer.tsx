/**
 * One run, opened (a press on a bar of its command's chart, a row's "Open
 * the run", or the Next panel's ask): the command and how it came out, its
 * time against its budget, when, on which commit and with which exit code,
 * its first error, and its output (`RunOutput`, read on open). Older / Newer
 * walk the same command's runs without closing.
 */
import { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button, CopyButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KitHost } from '@/features/shared/components/kit';
import { MODAL_SECTION_HEAD, ModalShell } from '@/features/shared/components/modals/ModalShell';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { useLifecycleViewModel } from '../../context';
import { shortSha } from '../../history/parts/Axis';
import { KIND_GLYPH } from '../../measure/kindGlyph';
import { LT } from '../../system/lcType';
import { RunPill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { useKindLabel } from '../useKindLabel';
import type { InstrumentRow } from './gateView';
import { RunOutput } from './RunOutput';
import { runTimeLine } from './RunPeek';

export interface OpenRun {
  row: InstrumentRow;
  run: LifecycleRun;
}

/** The run's facts on one line under the command: outcome, time against budget, when, commit, exit code. */
function FactLine({ row, run }: OpenRun) {
  const vm = useLifecycleViewModel();
  const over = run.outcome === 'passed' && row.budgetMs != null && run.durationMs > row.budgetMs;
  return (
    <>
      <RunPill outcome={run.outcome} />
      <span className={`${LT.row} ${over ? 'text-status-warning' : ''}`} data-testid="lc6-viewer-took">{runTimeLine(vm, run, row.budgetMs)}</span>
      <span className={LT.meta}><RelativeTime timestamp={run.finishedAt} /></span>
      <span className="inline-flex items-center gap-1">
        <span className={LT.code}>{shortSha(run.headSha)}</span>
        <CopyButton text={run.headSha} />
      </span>
      {run.exitCode != null && <span className={LT.metaNum}>{vm.tx(vm.dl.lcx6_peek_exit, { code: run.exitCode })}</span>}
    </>
  );
}

export function RunViewer({ open, onWalk, onClose }: { open: OpenRun | null; onWalk: (run: LifecycleRun) => void; onClose: () => void }) {
  const { dl, tx, projectId } = useLifecycleViewModel();
  const kind = useKindLabel();
  const titleId = useId();
  if (!open) return null;
  const { row, run } = open;
  const Glyph = KIND_GLYPH[row.kind];
  // Newest first, so "older" is the next index.
  const at = row.runs.findIndex((r) => r.id === run.id);
  const older = at >= 0 ? row.runs[at + 1] ?? null : null;
  const newer = at > 0 ? row.runs[at - 1] ?? null : null;
  const actions = (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={dl.lcx6_viewer_older} disabled={!older} onClick={() => older && onWalk(older)} data-testid="lc6-viewer-older">
        <ChevronLeft className={GLYPH.sm} />
      </Button>
      <span className={LT.metaNum}>{tx(dl.lcx6_viewer_position, { at: row.runs.length - at, count: row.runs.length })}</span>
      <Button variant="ghost" size="icon-sm" aria-label={dl.lcx6_viewer_newer} disabled={!newer} onClick={() => newer && onWalk(newer)} data-testid="lc6-viewer-newer">
        <ChevronRight className={GLYPH.sm} />
      </Button>
    </>
  );
  return (
    <ModalShell
      isOpen
      onClose={onClose}
      titleId={titleId}
      width="lg"
      icon={<Glyph className={GLYPH.md} />}
      title={<span className={LT.code} data-testid="lc6-viewer-command">{row.command}</span>}
      subtitle={kind(row.kind)}
      status={<FactLine row={row} run={run} />}
      actions={actions}
    >
      <KitHost testId="lc6-viewer">
        <div className="flex flex-col gap-4" data-run={run.id} data-outcome={run.outcome}>
          <section className="flex flex-col gap-2" aria-labelledby={`${titleId}-output`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 id={`${titleId}-output`} className={MODAL_SECTION_HEAD}>{dl.lcx6_viewer_output}</h3>
              <span className={LT.meta}>{dl.lcx6_viewer_tail}</span>
            </div>
            <RunOutput key={run.id} projectId={projectId} run={run} />
          </section>
        </div>
      </KitHost>
    </ModalShell>
  );
}
