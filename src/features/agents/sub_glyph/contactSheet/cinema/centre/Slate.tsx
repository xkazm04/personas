/** Slate — the head of the centre's action panel: where the build stands, in
 *  words, and the honest build clock. It sits on the panel's own card
 *  surface with the app's type scale; the clapperboard survives only as a
 *  thin striped band along the top edge in the crowned accent. The state
 *  line is a polite live region, so a screen reader hears every change.
 *  In a drafting layout (usePanelLook) the band and the dot give way to the
 *  drawing's idiom: a ruled title row with a diamond state mark in the ink,
 *  the state one step down the type scale, the clock's label lettered. */
import { timecode } from "../sheetModel";
import { usePanelLook } from "./panelLook";
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

/** The drafting look's state mark: the work tone is the drawing's own ink. */
const DRAFT_TONE: Record<SlateTone, string> = { ...TONE_DOT, work: "var(--ink, var(--cinema-accent))" };

export function Slate({ state, detail, tone, elapsed, running, partial, final = false }: SlateProps) {
  const time = partial && elapsed < 1 ? COPY.clock.unknown : timecode(elapsed);
  const clockWord = partial ? COPY.clock.partial : clockLabel(running, final);
  const drafting = usePanelLook() === "drafting";
  if (drafting) {
    return (
      <header className="flex flex-col gap-0.5 px-3 pt-2 pb-1.5" style={{ borderBottom: "1px solid var(--ink-faint)" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden className="w-2 h-2 rotate-45 flex-shrink-0" style={{ background: DRAFT_TONE[tone] }} />
          <span className="min-w-0 flex-1 typo-heading text-foreground truncate" role="status" aria-live="polite">{state}</span>
          <span className="flex-shrink-0 typo-data text-foreground tabular-nums" aria-label={`${COPY.buildTime} ${time}`}>{time}</span>
        </div>
        <div className="flex items-start gap-2.5 min-w-0 pl-[18px]">
          <span className="min-w-0 flex-1 typo-caption text-foreground line-clamp-2">{detail ?? ""}</span>
          <span className="flex-shrink-0 typo-caption whitespace-nowrap" style={{ color: "var(--ink-dim)" }}>{clockWord}</span>
        </div>
      </header>
    );
  }
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
          <span className="typo-caption text-foreground whitespace-nowrap">{clockWord}</span>
        </div>
      </div>
    </header>
  );
}
