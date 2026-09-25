/**
 * The extra numbers a clause's own sentence carries.
 *
 * The CODE is the authority - it is typed, it comes from the registry's own
 * routing table, and a mark is built from it whether or not this parser
 * recognises the prose. The sentence is read only for the figures the typed
 * value does not carry: the deviation spread's ceiling, the design floor a
 * technique count is under, and the name of the single stack.
 *
 * The shapes are the nine the projection documents (see `CLAUSES` in
 * `src-tauri/src/commands/curator/projection.rs`). A sentence that does not
 * match loses its extras and keeps its points - never the other way round.
 */
import type { CuratorReason } from '@/lib/bindings/CuratorReason';

import { channelOfCode } from './channels';
import type { ChannelMark } from './types';

/** `14–28 ...` / `14-28 ...` / `14 ...` - any of the three dashes the scan uses. */
const SPREAD = /^(\d+)(?:\s*[–—-]\s*(\d+))?\b/;
const DESIGN_FLOOR = /techniques \(design floor is (\d+)\)/;
const SINGLE_STACK = /^single stack \((.+)\)$/;

export function markOfReason(reason: CuratorReason): ChannelMark | null {
  const spec = channelOfCode(reason.code);
  if (!spec) return null;

  const mark: ChannelMark = {
    channel: spec.id,
    code: reason.code,
    points: reason.weight,
    detail: reason.detail,
  };

  const spread = SPREAD.exec(reason.detail);
  if (spread) {
    const lo = Number(spread[1]);
    const hi = spread[2] === undefined ? lo : Number(spread[2]);
    mark.count = lo;
    if (spec.code === 'deviation' || spec.code === 'citation_gone') {
      mark.floor = lo;
      mark.ceil = hi;
    }
  }

  const floor = DESIGN_FLOOR.exec(reason.detail);
  if (floor) mark.designFloor = Number(floor[1]);

  const stack = SINGLE_STACK.exec(reason.detail.trim());
  if (stack) mark.stack = stack[1];

  return mark;
}
