/**
 * The time spine: Athena's and the fleet's run threads as lanes on the last
 * hour, now at the top. Slim, it is a narrow instrument on the right edge whose
 * head reads how many gates wait on you; pulled wide (click, or Alt+W) it is
 * the timeline board - the SAME body, lanes and axis, with columns, labels and
 * a key per gate. A gate opens its decision from either size.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BoardHeader } from './BoardHeader';
import { R5B_COPY as C } from './copy';
import { SpineGates } from './SpineGates';
import { SpineLanes, SpineScale } from './SpineLanes';
import { EDGE, clusters, type Geometry } from './spineGeometry';
import type { Lane, Mark, TimeModel } from './timeModel';

function legend(model: TimeModel): string {
  const lines = clusters(model.lanes.filter((l) => l.project !== null)).map((c) => {
    const lanes = model.lanes.filter((l) => l.project === c.project);
    return C.lanesOf(c.project ?? '', lanes.length, lanes.reduce((n, l) => n + l.marks.filter((m) => m.gate).length, 0));
  });
  return [model.gates.length ? C.gates(model.gates.length) : C.noGates, ...lines].join(' · ');
}

function SlimHead({ gates }: { gates: number }) {
  return (
    <div className={`flex h-full items-center justify-center gap-1.5 ${gates ? 'text-status-warning' : 'text-muted'}`}>
      <span className="r5b-glyph" aria-hidden />
      <span className="typo-data-lg tabular-nums">{gates}</span>
    </div>
  );
}

export function TimeSpine({
  model,
  geom,
  focusId,
  live,
  athenaWord,
  onToggle,
  onOpenGate,
}: {
  model: TimeModel;
  geom: Geometry;
  focusId: string | null;
  live: boolean;
  athenaWord: string;
  onToggle: () => void;
  onOpenGate: (mark: Mark, lane: Lane) => void;
}) {
  const board = geom.mode === 'board';
  const label = `${C.spine}. ${legend(model)}`;
  return (
    <section
      className="r5b-body rounded-card shadow-elevation-3 pointer-events-auto"
      style={{ right: EDGE.right, bottom: EDGE.bottom, width: geom.width, height: geom.height }}
      aria-label={label}
      data-testid={board ? 'companion-r5b-board' : 'companion-r5b-spine'}
      data-r5b-piece="spine"
    >
      {/* Slim: the whole instrument is the key that pulls it wide. */}
      {!board && (
        <Tooltip content={`${legend(model)} · Alt+W`} placement="left" triggerClassName="absolute inset-0 flex">
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggle}
            aria-label={`${C.openBoard}. ${label}`}
            aria-keyshortcuts="Alt+W"
            data-testid="companion-r5b-spine-toggle"
            className="!absolute inset-0 !p-0 !rounded-card !bg-transparent active:!scale-100"
          >
            <span className="sr-only">{C.openBoard}</span>
          </Button>
        </Tooltip>
      )}

      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: geom.head }}>
        {board ? <BoardHeader geom={geom} now={model.now} athenaWord={athenaWord} /> : <SlimHead gates={model.gates.length} />}
      </div>

      <div className="r5b-axis inset-x-0 pointer-events-none" style={{ top: geom.head, height: geom.axis }}>
        <SpineScale board={board} width={geom.width} labelFor={C.scale} />
        <SpineLanes lanes={geom.shown} xs={geom.xs} now={model.now} live={live} />
        <div className="pointer-events-auto">
          <SpineGates geom={geom} now={model.now} focusId={focusId} onOpen={onOpenGate} />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 pointer-events-none" style={{ height: geom.foot }}>
        {board ? (
          <>
            {geom.hidden > 0 && <span className="typo-caption">{C.moreLanesLong(geom.hidden)}</span>}
            <span className="flex-1" />
            <Button variant="ghost" size="xs" onClick={onToggle} aria-keyshortcuts="Alt+W Escape" data-testid="companion-r5b-board-fold" className="pointer-events-auto">
              <span className="typo-label">{C.closeBoard}</span>
              <kbd className="r5b-cap rounded-interactive px-1.5 typo-code text-foreground">Esc</kbd>
            </Button>
          </>
        ) : (
          <span className="typo-code text-muted pointer-events-none">
            {C.hour}
            {geom.hidden > 0 && <span className="text-foreground"> {C.moreLanes(geom.hidden)}</span>}
          </span>
        )}
      </div>
    </section>
  );
}
