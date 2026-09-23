/** BuildRail - the film-strip progress bar under the sheet.
 *
 *  72 sprocket holes, 5 s each (6 min, the top of the real 3 to 6 min build
 *  range); the scale widens only if a build runs longer. Each hole is painted
 *  by what the time was actually spent on: the model building, you answering,
 *  or the tests running. A thin mark shows the window the first pass usually
 *  lands in while that first turn is still running. Nothing is extrapolated. */
import type { BuildClock, ClockKind } from "./useBuildClock";
import { timecode } from "./useBuildClock";
import { COPY } from "./copy";

const HOLES = 72;
const WINDOW = { from: 50, to: 155 };

const FILL: Record<ClockKind, string> = {
  llm: "bg-status-warning/75",
  you: "bg-primary/60",
  test: "bg-status-info/70",
};

function holeKinds(clock: BuildClock, perHole: number): (ClockKind | null)[] {
  const spans: { kind: ClockKind; from: number; to: number }[] = [];
  let at = 0;
  for (const s of clock.segments) {
    const d = Math.max(0, ((s.end ?? clock.now) - s.start) / 1000);
    spans.push({ kind: s.kind, from: at, to: at + d });
    at += d;
  }
  return Array.from({ length: HOLES }, (_, i) => {
    const mid = (i + 0.5) * perHole;
    return spans.find((sp) => mid >= sp.from && mid < sp.to)?.kind ?? null;
  });
}

export function BuildRail({ clock, showWindow }: { clock: BuildClock; showWindow: boolean }) {
  const total = clock.totals.llm + clock.totals.you + clock.totals.test;
  const perHole = Math.max(5, Math.ceil(total / HOLES));
  const kinds = holeKinds(clock, perHole);
  const span = HOLES * perHole;
  const legend: { kind: ClockKind; label: string }[] = [
    { kind: "llm", label: COPY.railLlm },
    { kind: "you", label: COPY.railYou },
    { kind: "test", label: COPY.railTest },
  ];
  return (
    <footer className="flex-none flex items-center gap-4 px-1 pt-2 pb-1" aria-label={COPY.railLabel} data-testid="cs-personas-rail">
      <div className="hidden lg:flex items-center gap-3 flex-none">
        {legend.filter((l) => clock.totals[l.kind] > 0 || l.kind === "llm").map((l) => (
          <span key={l.kind} className="flex items-center gap-1.5 typo-caption">
            <span aria-hidden className={`w-2 h-2 rounded-full ${FILL[l.kind]}`} />
            {l.label}
            {l.kind !== "llm" && <span className="typo-data text-muted">{timecode(clock.totals[l.kind])}</span>}
          </span>
        ))}
      </div>
      <div className="relative flex-1 min-w-0 h-4 flex items-center gap-1" aria-hidden>
        {showWindow && (
          <span
            className="absolute -top-1 h-0.5 rounded-full bg-status-warning/40"
            style={{ left: `${(WINDOW.from / span) * 100}%`, width: `${((WINDOW.to - WINDOW.from) / span) * 100}%` }}
          />
        )}
        {kinds.map((k, i) => (
          <i key={i} className={`flex-1 h-2 rounded-interactive transition-colors duration-300 ${k ? FILL[k] : "bg-foreground/10"}`} />
        ))}
      </div>
      <span className="flex-none typo-data text-foreground min-w-[9.5rem] text-right" role="timer" aria-live="off">
        {COPY.railLabel} {timecode(clock.totals.llm)}
      </span>
    </footer>
  );
}
