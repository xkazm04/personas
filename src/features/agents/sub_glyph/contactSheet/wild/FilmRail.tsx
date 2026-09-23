/** FilmRail: the bottom progress bar as a strip of 35 mm film.
 *
 *  Top line is the edge print: the acts of the journey, the current one lit.
 *  The strip itself is the honest clock. Each frame is a slice of real running
 *  time, exposed only once that time has actually passed, and tinted by who
 *  held the reel (amber: the model, teal: you answering, violet: the test run).
 *  A bracket marks the usual 50 s to 2 min 35 s window of the first take, and
 *  the red playhead sits at "now". The strip rescales when the reel runs long;
 *  nothing moves unless a real second has passed. */
import { useMemo } from "react";
import { ACT_ORDER, timecode, type Act, type Who } from "./useReel";
import { COPY } from "./wildCopy";

const FRAMES = 40;
const WINDOW: [number, number] = [50, 155];

interface FilmRailProps {
  act: Act;
  spans: { who: Who; secs: number }[];
  total: number;
  running: boolean;
}

function whoAt(spans: FilmRailProps["spans"], t: number): Who | null {
  let acc = 0;
  for (const s of spans) { if (t < acc + s.secs) return s.who; acc += s.secs; }
  return null;
}

export function FilmRail({ act, spans, total, running }: FilmRailProps) {
  const axis = Math.max(180, Math.ceil((total + 15) / 60) * 60);
  const frames = useMemo(() => Array.from({ length: FRAMES }, (_, i) => {
    const mid = ((i + 0.5) * axis) / FRAMES;
    return mid <= total ? whoAt(spans, mid) : null;
  }), [axis, total, spans]);
  const actIdx = ACT_ORDER.indexOf(act === "fogged" ? "exposure" : act);
  const showWindow = act !== "compose" && spans.length > 0;

  return (
    <div className="csw-rail" role="group" aria-label={`${COPY.acts[act]}. ${timecode(total)}`}>
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div className="csw-acts" aria-hidden>
          {ACT_ORDER.map((a, i) => (
            <span key={a} data-on={a === act ? "true" : "false"} data-done={i < actIdx ? "true" : "false"}>
              {String(i + 1).padStart(2, "0")} {COPY.acts[a]}
            </span>
          ))}
          {act === "fogged" && <span data-on="true" style={{ color: "var(--cs-bad)" }}>{COPY.acts.fogged}</span>}
        </div>
        <div className="csw-strip">
          <div className="csw-frames" aria-hidden>
            {frames.map((k, i) => <i key={i} data-k={k ?? "none"} style={{ transition: "background .5s ease" }} />)}
          </div>
          {showWindow && (
            <span
              className="csw-window"
              style={{ left: `calc(4px + (100% - 8px) * ${WINDOW[0] / axis})`, width: `calc((100% - 8px) * ${(WINDOW[1] - WINDOW[0]) / axis})` }}
              aria-hidden
            />
          )}
          {spans.length > 0 && <span className="csw-head" style={{ left: `calc(4px + (100% - 8px) * ${Math.min(1, total / axis)})` }} aria-hidden />}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0" style={{ minWidth: 150 }}>
        <span className="csw-edge" style={{ color: running ? "var(--cs-safe)" : "var(--cs-faint)" }}>
          {running ? COPY.rail.rec : spans.length ? COPY.rail.hold : COPY.rail.idle}
        </span>
        <span className="font-mono tabular-nums" style={{ fontSize: 20, fontWeight: 600, color: "var(--cs-ink)" }} aria-live="off">
          TC {timecode(total)}
        </span>
        {showWindow && (
          <span className="csw-edge" style={{ color: "var(--cs-faint)", letterSpacing: ".06em" }}>
            <span style={{ color: "#f0b060" }}>■</span> {COPY.rail.model} <span style={{ color: "#6fd6c2" }}>■</span> {COPY.rail.you}
          </span>
        )}
      </div>
    </div>
  );
}
