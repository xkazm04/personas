// DockActTicker: one line in the dock's resting row saying what the stewards
// just decided ("App Master · personas filed 3 reports as evidence"). A press
// opens the mandate drawer's
// act log at the newest act of the line.
//
// Push only: it follows `charter-act-recorded` and reads nothing on a clock.
// The one read it makes is the mandate's names (`mandate_get`), once per
// mandate, when that mandate's first act arrives. Quiet means absent: before
// the first act of the session it shows nothing, no placeholder, no lamp
// (only an empty, zero-width live region waits in the row).
// The coalescing law is `dockActLine.ts`.
//
// It speaks at the dock's own voice (design pass, 2026-10-15): the resting
// row's caption weight and muted colour, its icon at the row's icon size, and
// it YIELDS - the composer's placeholder never shrinks for it; the line takes
// what width is left, truncates, and leaves the row on a narrow dock.

import { useCallback, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';

import { getMandate } from '@/api/mandates';
import { useCharterActRecorded } from '@/features/decision-center/lanes/useLanesSnapshot';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import { silentCatch } from '@/lib/silentCatch';

import { coalesceAct, tickText, type TickLine, type TickNames } from './dockActLine';
import { requestActLogAt } from './prototype/entry-e/mandate/mandateDrawerRequest';

/** A mandate whose names could not be read: the line still speaks, with the unknown words. */
const UNREAD: TickNames = { steward: null, project: null };

export function useDockActTicker() {
  const [line, setLine] = useState<TickLine | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, TickNames>>(new Map());
  const asked = useRef(new Set<string>());

  const onAct = useCallback((act: CharterAct) => {
    setLine((prev) => coalesceAct(prev, act));
    if (asked.current.has(act.charterId)) return;
    asked.current.add(act.charterId);
    getMandate(act.charterId)
      .then((x): TickNames => ({ steward: x.stewardName, project: x.projectName }))
      .catch((err: unknown): TickNames => {
        silentCatch('fleet/dock:act-ticker-names')(err);
        return UNREAD;
      })
      .then((n) => setNames((prev) => new Map(prev).set(act.charterId, n)));
  }, []);
  useCharterActRecorded(onAct);

  return { line, names: line ? names.get(line.charterId) : undefined };
}

export function DockActTicker() {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { line, names } = useDockActTicker();
  // The live region is mounted empty (it is the row's spacer until it speaks)
  // so its first line is a CHANGE a screen reader announces; a
  // region born with its message is never read. Quiet until there is
  // something to say, and until it can say it with names.
  const text = line && names ? tickText(m, tx, line, names) : null;

  return (
    <span role="status" className="@container/tick typo-label pointer-events-auto flex min-w-0 flex-1 justify-end" data-testid="dock-act-ticker">
      {line && text && (
        <span className="hidden min-w-0 max-w-full @[9rem]/tick:flex">
          <Tooltip content={<>{text}<br />{m.ml_tick_open}</>} placement="top">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => requestActLogAt(line.latestActId)}
              icon={<ScrollText className="h-3.5 w-3.5 text-muted transition-colors group-hover/tick:text-foreground" aria-hidden />}
              aria-description={m.ml_tick_aria}
              data-testid="dock-act-ticker-open"
              data-act={line.latestActId}
              className="group/tick max-w-full [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
            >
              <span className="text-muted transition-colors group-hover/tick:text-foreground">{text}</span>
            </Button>
          </Tooltip>
        </span>
      )}
    </span>
  );
}
