/** SheetShell - one drawing sheet: the double frame on the construction grid,
 *  a header strip (caption badge, what the sheet draws, "Sheet n of 9"), and
 *  the two columns every sheet shares, the drawing (about 1.15fr) and the
 *  title block (1fr). Sheet 1 and each dimension's sheet use the same shell,
 *  which is what makes the nested sheet read as the same drawing one level
 *  down. */
import type { ReactNode, Ref } from "react";
import { LETTERING } from "../blueprint";
import { Badge } from "./sheetParts";
import { SHEET_TOTAL } from "./sheetGeometry";
import { COPY } from "./copy";

interface SheetShellProps {
  rootRef?: Ref<HTMLDivElement>;
  number: number;
  /** What the sheet draws, lettered beside its badge. */
  heading: ReactNode;
  /** Before the badge (the way back). */
  lead?: ReactNode;
  /** After the sheet count (turning to the neighbouring sheets). */
  trail?: ReactNode;
  testId: string;
  /** The drawing column, then the title block column. */
  children: ReactNode;
  /** Overlays positioned against the whole sheet (the pen). */
  overlay?: ReactNode;
}

export function SheetShell({ rootRef, number, heading, lead, trail, testId, children, overlay }: SheetShellProps) {
  return (
    <div ref={rootRef} className="dsh-sheet bp-grid absolute inset-0 flex flex-col gap-3 overflow-hidden px-7 pb-6 pt-4" data-testid={testId}>
      <header className="flex h-8 shrink-0 items-center gap-3">
        {lead}
        <Badge n={number} filled color="var(--ink)" />
        <div className="flex min-w-0 items-baseline gap-3">{heading}</div>
        <span className="ml-auto shrink-0" style={{ ...LETTERING, color: "var(--ink-dim)" }}>{COPY.sheetOf(number, SHEET_TOTAL)}</span>
        {trail}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-8">{children}</div>
      {overlay}
    </div>
  );
}
