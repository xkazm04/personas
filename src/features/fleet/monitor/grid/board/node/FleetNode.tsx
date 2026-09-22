// FleetNode — the one visual every node on the Activity board is painted with.
//
// `NODE_W` wide (or the lane's full width, `fill`), TWO ROWS split by a
// hairline divider — the title pinned to the top, the symbols to the bottom —
// and the rows are strict about what they hold:
//
//   • the TITLE ROW is the title and NOTHING ELSE — the whole width, one
//     line, `typo-body`, no glyph, no chip, no control beside it. It truncates
//     only past ~24 characters, and the full title is always in the row's
//     tooltip. (The first two-row node still shared this row with a glyph and
//     a chip, and handed the shell `leading` / `trailing` columns that sat
//     beside the body for its full height; at 172 px the title was left about
//     100. Rejected 2026-09-18; this is the fix.)
//   • the SYMBOL ROW is symbols and NOTHING ELSE — an 18 px strip of
//     icon-sized indicators, each a lucide glyph or a pure-CSS mark with an
//     `aria-label` and a `Tooltip`, never a word. The map — which symbols, in
//     which order, in which hue — is `nodeSymbols.ts`, so every board agrees.
//
// The node is the VISUAL and the shell. Behaviour stays in the thin wrappers
// (`PersonaTile`, `SessionTile`, `QueueTile`): they decide the menus, the
// confirms and the aria text, and hand this component the body's activation,
// its tooltip, and the AFFORDANCES (`symbols`: a drag grip, a lock, recap,
// ↑/↓, cancel, start now, the ⋯ menu) that ride the symbol row's right end and
// appear on hover or focus-within. Those are SIBLINGS of the body, never its
// children: the body is a `<button>` when it activates something, and a
// control inside a control is invalid.
//
// ONE treatment (`nodeSymbols.ts`): the body washed in the state hue with a
// soft elevation and no border, every symbol a solid hue circle, and the
// elapsed fill a labelled bar along the bottom edge.
//
// The files: `nodeTypes` (props, the per-kind view, the fill arithmetic),
// `personaNodeView` / `sessionNodeView` (what each kind paints),
// `NodeSymbolParts` (the symbol pieces), `NodeRows` (the body's rows and the
// elapsed bar). This file is the shell that composes them.

import { memo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { SESSION_TILE_H, TILE_H, NODE_W } from '../../gridGeometry';
import { useNodeContext } from './nodeContext';
import { ElapsedBar, NodeRows } from './NodeRows';
import { personaNodeView } from './personaNodeView';
import { sessionNodeView } from './sessionNodeView';
import type { FleetNodeProps } from './nodeTypes';

// The surface other files import from here — kept stable across the split.
export { liveMeterFill, queuedMeterFill } from './nodeTypes';
export type { FleetNodeProps, FleetNodeShellProps } from './nodeTypes';
export { AFFORDANCE_BTN } from './NodeSymbolParts';

export const FleetNode = memo(function FleetNode(props: FleetNodeProps) {
  const {
    width = NODE_W, fill = false, flash = false, selected = false,
    symbols, onActivate, onContextMenu, ariaLabel, tooltip, bodyTestId, testId, data,
  } = props;
  const height = props.height ?? (props.kind === 'persona' ? TILE_H : SESSION_TILE_H);
  const i18n = useTranslation();
  const { meanDurationMs, queueLength } = useNodeContext();
  const reducedMotion = (useReducedMotion() ?? false) || (props.reducedMotion ?? false);

  // Hooks first — the ETA is a date the queued row's tooltip names.
  const queue = props.kind === 'session' ? props.queue ?? null : null;
  const eta = useFormattedDate(queue?.estimatedStartMs ?? null, { timeStyle: 'short' });
  const notBefore = useFormattedDate(queue?.notBeforeMs ?? null, { timeStyle: 'short' });

  // The two kinds decide their own title, hue, frame and symbol list;
  // everything below is shared.
  const view = props.kind === 'persona'
    ? personaNodeView(props, i18n, reducedMotion)
    : sessionNodeView(props, i18n, { meanDurationMs, queueLength, eta, notBefore, reducedMotion });

  // The elapsed fill is a bar along the bottom edge, across the full node
  // width — never a symbol in the row.
  const barElapsed = view.ids.includes('elapsed');
  const rowIds = view.ids.filter((id) => id !== 'elapsed');

  // Fixed: `flex-shrink-0` at `width`. Fill: `w-full` in a block parent and
  // `flex-1 min-w-0` in a flex row (the Queued lane's accent bar beside it).
  const sizing = fill ? 'w-full min-w-0 flex-1' : 'flex-shrink-0';
  const shell = `group relative flex ${sizing} overflow-hidden rounded-input transition-colors ${view.frame} ${
    selected ? 'ring-1 ring-primary/40' : ''
  } ${flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`;

  const rows = <NodeRows view={view} rowIds={rowIds} tooltip={tooltip} reducedMotion={reducedMotion} />;

  // Title at the top, the divider between, the symbol row at the bottom.
  const bodyClass = 'relative flex h-full w-full min-w-0 flex-col justify-between px-1 py-0.5 text-left';
  const dataAttrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v === undefined ? undefined : String(v)]),
  );

  const body = onActivate ? (
    <button
      type="button"
      onClick={onActivate}
      onContextMenu={onContextMenu}
      aria-label={ariaLabel}
      aria-pressed={props.kind === 'persona' ? selected : undefined}
      data-testid={bodyTestId}
      {...dataAttrs}
      className={`${bodyClass} focus-ring rounded-interactive transition-[filter] hover:brightness-110`}
    >
      {rows}
    </button>
  ) : (
    <span role="img" aria-label={ariaLabel} data-testid={bodyTestId} {...dataAttrs} className={bodyClass}>
      {rows}
    </span>
  );

  return (
    // `fill` (the Lanes board): no fixed pixel width — the shell spans its
    // parent, and the affordances and the elapsed bar still anchor to its
    // right / bottom edge because they are positioned against the shell.
    <div className={shell} style={fill ? { height } : { width, height }} data-testid={testId} data-kind={props.kind} data-width={fill ? 'fill' : 'fixed'}>
      {body}
      {barElapsed && <ElapsedBar fill={view.elapsedFill} label={view.elapsedLabel} hue={view.hue} />}
      {/* The affordances: siblings of the body, over the symbol row's right
          end, revealed on hover or when anything inside the node has focus
          (a tap on the body focuses within, so touch reaches them too). */}
      {symbols && (
        <span
          data-testid="fleet-node-affordances"
          className="absolute bottom-[3px] right-1 z-10 flex h-4 items-center gap-0.5 rounded-full bg-background/90 px-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
        >
          {symbols}
        </span>
      )}
    </div>
  );
});

export default FleetNode;
