// One folder of the doc estate: a raised card on the estate's tray, as wide as
// its doc count asks (it grows with its share of the docs and starts from a
// width that lays its cells in a near-square block), headed by the folder's
// name and what is wrong in it, with one cell per doc, worst first. The cells
// are the options of the estate's one listbox (`EstateMap`); this file only
// draws them and reports a pointer on one.
import type { PointerEvent } from 'react';
import { Folder } from 'lucide-react';

import { Meta } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../../context';
import { Count } from '../../system/Count';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { asDocStatus } from '../docsModel';
import { DOC_HEAD } from './docLooks';
import { useDocStatusLabel } from './docWords';
import { matchesFilter, type DirTile, type DocsFilter } from './estateModel';

/** The width a folder starts from: its cells in a near-square block, plus the card's padding. */
export function tileBasisRem(count: number, cell: number): number {
  const columns = Math.min(16, Math.max(5, Math.ceil(Math.sqrt(count * 1.6))));
  return Math.max(12, columns * cell * 1.32 + 1.5);
}

/** A folder by what tells it apart: the shared prefix dropped, any parent left quiet, its own name strong. */
export function DirName({ dir, prefix = '' }: { dir: string; prefix?: string }) {
  const { dl } = useLifecycleViewModel();
  if (!dir) return <span className={`truncate ${LT.title}`}>{dl.lcx7_root_dir}</span>;
  const own = dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
  const cut = own.lastIndexOf('/');
  return (
    <span className="flex min-w-0 items-baseline">
      {cut >= 0 && <span className={`shrink truncate ${LT.meta}`}>{own.slice(0, cut + 1)}</span>}
      <span className={`min-w-0 truncate ${LT.title}`}>{own.slice(cut + 1)}</span>
    </span>
  );
}

/** "2 broken · 1 stale" in each status's ink, or "All clean". */
function Tally({ tile }: { tile: DirTile }) {
  const { dl, tx } = useLifecycleViewModel();
  const words = { broken: dl.lcx7_n_broken, stale: dl.lcx7_n_stale, unverifiable: dl.lcx7_n_unverifiable };
  const parts = (['broken', 'stale', 'unverifiable'] as const)
    .filter((s) => tile.counts[s] > 0)
    .map((s) => <span key={s} className={DOC_HEAD[s].ink}>{tx(words[s], { count: tile.counts[s] })}</span>);
  return (
    <p className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 ${LT.meta}`}>
      {parts.length > 0 ? <Meta parts={parts} /> : <span className="text-status-success">{dl.lcx7_all_clean}</span>}
    </p>
  );
}

interface EstateTileProps {
  tile: DirTile;
  /** The folder path every folder shares (`estateModel.sharedDirPrefix`), left out of the name. */
  prefix: string;
  /** The flat index of this folder's first doc in the listbox. */
  start: number;
  cell: number;
  filter: DocsFilter;
  selected: string | null;
  /** The keyboard cursor's flat index, or -1 while the pointer drives. */
  cursor: number;
  idOf: (i: number) => string;
  onHover: (i: number, e: PointerEvent<HTMLElement>) => void;
  onLeave: () => void;
  onPick: (i: number) => void;
}

export function EstateTile({ tile, prefix, start, cell, filter, selected, cursor, idOf, onHover, onLeave, onPick }: EstateTileProps) {
  const { dl } = useLifecycleViewModel();
  const label = useDocStatusLabel();
  return (
    <div
      role="group"
      aria-label={tile.dir || dl.lcx7_root_dir}
      className={`flex min-w-0 flex-col gap-2 ${lcSurface('card')}`}
      style={{ flex: `${tile.docs.length} 1 ${tileBasisRem(tile.docs.length, cell)}rem` }}
      data-testid={`lcx7-dir-${tile.dir || 'root'}`}
      data-worst={tile.worst}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Folder className={`${GLYPH.sm} shrink-0 ${DOC_HEAD[tile.worst].ink}`} aria-hidden />
        <DirName dir={tile.dir} prefix={prefix} />
        <span className="ml-auto shrink-0"><Count value={tile.docs.length} /></span>
      </div>
      <Tally tile={tile} />
      <div className="lcx7-cells">
        {tile.docs.map((d, k) => {
          const i = start + k;
          const status = asDocStatus(d.status);
          return (
            <span
              key={d.docPath}
              id={idOf(i)}
              role="option"
              aria-selected={selected === d.docPath}
              aria-label={`${d.docPath}, ${label(status)}`}
              className="lcx7-cell"
              data-status={status}
              data-out={!matchesFilter(d, filter) || undefined}
              data-selected={selected === d.docPath || undefined}
              data-cursor={cursor === i || undefined}
              data-testid={`lcx7-cell-${d.docPath}`}
              onClick={() => onPick(i)}
              onPointerEnter={(e) => onHover(i, e)}
              onPointerLeave={onLeave}
            />
          );
        })}
      </div>
    </div>
  );
}
