/** Slate — the head of the centre's action panel: where the build stands, in
 *  words, and the honest build clock. It sits on the panel's own card
 *  surface with the app's type scale; the clapperboard survives only as a
 *  thin striped band along the top edge in the crowned accent. The state
 *  line is a polite live region, so a screen reader hears every change. */
import { timecode } from "../sheetModel";
import type { ClockKind } from "../useSheetClock";
import { COPY } from "../copy";

/** work: the machine is busy · wait: it needs you · good / bad: a verdict. */
export type SlateTone = "work" | "wait" | "good" | "bad";

export interface SlateProps {
  state: string;
  detail?: string | null;
  tone: SlateTone;
  elapsed: number;
  running: ClockKind | null;
  partial: boolean;
  /** The build is over (premiere / stopped): the clock is a total, not a pause. */
  final?: boolean;
}

const TONE_DOT: Record<SlateTone, string> = {
  work: "var(--cinema-accent)",
  wait: "var(--status-warning)",
  good: "var(--status-success)",
  bad: "var(--status-error)",
};

function clockLabel(running: ClockKind | null, final: boolean): string {
  if (running === "build") return COPY.clock.building;
  if (running === "test") return COPY.clock.screening;
  return final ? COPY.clock.total : COPY.clock.waiting;
}

export function Slate({ state, detail, tone, elapsed, running, partial, final = false }: SlateProps) {
  const time = partial && elapsed < 1 ? COPY.clock.unknown : timecode(elapsed);
  return (
    <header>
      <div
        aria-hidden
        className="h-1"
        style={{ background: "repeating-linear-gradient(-55deg, color-mix(in srgb, var(--cinema-accent) 60%, transparent) 0 8px, transparent 8px 16px)" }}
      />
      <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
        <span aria-hidden className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONE_DOT[tone] }} />
        <div className="min-w-0 flex-1 flex flex-col">
          <span className="typo-title-lg text-foreground truncate" role="status" aria-live="polite">{state}</span>
          {detail && <span className="typo-caption text-foreground truncate">{detail}</span>}
        </div>
        <div className="flex flex-col items-end flex-shrink-0">
          <span className="typo-data-lg text-foreground tabular-nums" aria-label={`${COPY.buildTime} ${time}`}>{time}</span>
          <span className="typo-caption text-foreground whitespace-nowrap">{partial ? COPY.clock.partial : clockLabel(running, final)}</span>
        </div>
      </div>
    </header>
  );
}
