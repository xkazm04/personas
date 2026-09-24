/**
 * Halo · Spread — the right panel as a collection binder.
 *
 * Every project (Athena first) is a small card-shaped tile of the same family:
 * a thin ornate border, an art band (her portrait for Athena, a monogram band
 * for a project), a dense grid of 8px process dots in their NATIVE state
 * colour, and in the top-right corner a stack of decision card edges peeking
 * out, the count on the top edge. Words live in tooltips.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KIND_VAR } from '../../../tones';
import { NEXT_COPY as C } from '../../../nextCopy';
import { ATHENA_COLUMN, type ProcessMark, type ProjectColumn } from '../../../useProcessColumns';
import type { RightPanelProps } from '../../slots';
import { CORNERS, filigreeStyle, mix, monogram, projectHue, ringGradient } from './cardArt';
import { SPREAD_COPY as S } from './copy';

/** Where the spread's cards fly from and back to. */
export const BINDER_ATTR = 'data-spread-binder';
export const TILE_ATTR = 'data-spread-tile';

function ProcessDot({ p }: { p: ProcessMark }) {
  const letter = S.processKindLetter[p.kind];
  return (
    <Tooltip
      placement="left"
      content={
        <span className="inline-flex items-center gap-2">
          <span className="grid place-items-center w-5 h-5 rounded-full border border-foreground/25 typo-label text-foreground">{letter}</span>
          <span>
            {C.processKind[p.kind]} · {p.label} · {p.state}
          </span>
        </span>
      }
    >
      <button
        type="button"
        onClick={p.open}
        aria-label={`${C.processKind[p.kind]}: ${p.label}, ${p.state}`}
        className="grid place-items-center w-3.5 h-3.5 rounded-full focus-ring group"
      >
        <span
          className={`block w-2 h-2 rounded-full transition-transform group-hover:scale-150 ${p.dot} ${
            p.urgent ? 'ring-2 ring-status-warning/70 ring-offset-1 ring-offset-background' : ''
          }`}
          aria-hidden
        />
      </button>
    </Tooltip>
  );
}

/** The decision card edges peeking out of the tile's top-right corner. */
function EdgeStack({ col, onOpenItem }: { col: ProjectColumn; onOpenItem: (id: string) => void }) {
  const shown = col.decisions.slice(0, 4);
  const first = col.decisions[0];
  if (!first) return null;
  return (
    <Tooltip
      placement="left"
      content={
        <span className="flex flex-col gap-1">
          <span>{S.decisionsIn(col.label, col.decisions.length)}</span>
          {col.decisions.slice(0, 6).map((d) => (
            <span key={d.id} className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_VAR[d.kind] }} aria-hidden />
              {C.kind[d.kind]}: {d.title}
            </span>
          ))}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => onOpenItem(first.id)}
        aria-label={S.decisionsIn(col.label, col.decisions.length)}
        className="absolute z-10 -top-[26px] right-3 w-14 h-[26px] focus-ring rounded-interactive group"
      >
        {shown.map((d, i) => {
          // Back-most edge first: it peeks highest and carries the count.
          const depth = shown.length - 1 - i;
          return (
            <span
              key={d.id}
              className="absolute left-0 right-0 rounded-t-interactive border border-b-0 transition-transform group-hover:-translate-y-1"
              style={{
                top: 12 - depth * 4,
                height: 14 + depth * 4,
                transform: `translateX(${depth * -2}px)`,
                borderColor: KIND_VAR[d.kind],
                background: `linear-gradient(180deg, ${mix(KIND_VAR[d.kind], 55, 'var(--background)')}, var(--background) 90%)`,
                boxShadow: `0 -3px 10px -4px ${KIND_VAR[d.kind]}`,
              }}
              aria-hidden
            />
          );
        })}
        <span
          className="absolute left-1/2 -translate-x-1/2 grid place-items-center min-w-5 h-5 px-1 rounded-full border bg-background typo-caption text-foreground shadow-elevation-2 transition-transform group-hover:-translate-y-1"
          style={{ top: 12 - (shown.length - 1) * 4 - 10, borderColor: KIND_VAR[first.kind] }}
          aria-hidden
        >
          {col.decisions.length}
        </span>
      </button>
    </Tooltip>
  );
}

function ArtBand({ col }: { col: ProjectColumn }) {
  const athena = col.key === ATHENA_COLUMN;
  const hue = athena ? 'var(--primary)' : projectHue(col.label);
  return (
    <div
      className="relative h-11 rounded-interactive overflow-hidden border"
      style={{
        borderColor: mix(hue, 45),
        background: `linear-gradient(100deg, ${mix(hue, 40, 'var(--background)')}, ${mix(hue, 10, 'var(--background)')} 75%)`,
      }}
    >
      {athena ? (
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          className="absolute right-0 top-0 h-full w-3/5 object-cover"
          style={{ objectPosition: '50% 20%', maskImage: 'linear-gradient(90deg, transparent, black 55%)' }}
        />
      ) : (
        <span
          className="absolute -right-1 -bottom-3 typo-hero select-none"
          style={{ fontSize: 44, lineHeight: 1, color: mix(hue, 30) }}
          aria-hidden
        >
          {monogram(col.label)}
        </span>
      )}
      <div className="relative h-full flex items-center gap-2 px-2 min-w-0">
        <span
          className="shrink-0 grid place-items-center w-6 h-6 rounded-full border typo-label text-foreground"
          style={{ borderColor: mix(hue, 75), background: mix(hue, 30, 'var(--background)') }}
          aria-hidden
        >
          {athena ? 'A' : monogram(col.label)}
        </span>
        <span className="typo-body text-foreground truncate">{col.label}</span>
      </div>
    </div>
  );
}

/** One card-shaped tile: the same family for Athena and for every project. */
export function ProjectTile({ col, onOpenItem }: { col: ProjectColumn; onOpenItem: (id: string) => void }) {
  const athena = col.key === ATHENA_COLUMN;
  const edge = col.decisions.length ? KIND_VAR[col.decisions[0]!.kind] : athena ? 'var(--primary)' : mix('var(--foreground)', 35);
  return (
    <div className={`relative ${col.decisions.length ? 'mt-7' : ''}`} {...{ [TILE_ATTR]: col.key }}>
      <EdgeStack col={col} onOpenItem={onOpenItem} />
      <div className="relative rounded-card p-px" style={{ background: ringGradient(edge) }}>
        <div className="relative rounded-card bg-background p-1.5 flex flex-col gap-1.5">
          <div className="absolute inset-[3px] rounded-card border pointer-events-none" style={{ borderColor: mix(edge, 25) }} aria-hidden />
          <div className="absolute inset-[4px] pointer-events-none" aria-hidden>
            {CORNERS.map((c) => (
              <span key={c.key} className={`absolute ${c.className}`} style={{ ...filigreeStyle(edge, 12), transform: c.transform }} />
            ))}
          </div>
          <ArtBand col={col} />
          {col.processes.length ? (
            <div className="relative px-0.5 pb-0.5">
              <div className="flex flex-wrap gap-0.5">
                {col.processes.map((p) => (
                  <ProcessDot key={p.id} p={p} />
                ))}
              </div>
              <p className="typo-caption text-foreground/85 mt-0.5">{S.running(col.processes.length)}</p>
            </div>
          ) : (
            <p className="relative px-1 pb-0.5 typo-caption text-foreground/85">{S.noProcesses}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function BinderPanel({ columns, waiting, onOpenItem, onOpenWaiting }: RightPanelProps) {
  return (
    <section
      aria-label={S.binder}
      className="pointer-events-auto w-[212px] h-full min-h-0 flex flex-col rounded-modal border border-primary/20 bg-background/92 backdrop-blur-md shadow-elevation-3"
      {...{ [BINDER_ATTR]: '' }}
    >
      <button
        type="button"
        onClick={onOpenWaiting}
        className="mx-2 mt-2 mb-1 flex items-center gap-2 rounded-interactive px-2 py-1.5 hover:bg-foreground/[0.06] focus-ring"
        aria-label={S.openSpread}
      >
        <span className="relative w-4 h-5 shrink-0" aria-hidden>
          <span className="absolute inset-0 rounded-interactive border border-status-warning/60 translate-x-1 -translate-y-0.5" />
          <span className="absolute inset-0 rounded-interactive border border-status-warning bg-status-warning/15" />
        </span>
        <span className="typo-body text-foreground truncate">{S.waiting(waiting)}</span>
        <kbd className="ml-auto rounded-interactive border border-foreground/15 bg-foreground/[0.05] px-1 typo-caption text-foreground/85">{S.altW}</kbd>
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2.5 pt-3 pb-3 flex flex-col gap-2.5">
        {columns.map((c) => (
          <ProjectTile key={c.key} col={c} onOpenItem={onOpenItem} />
        ))}
      </div>
    </section>
  );
}
