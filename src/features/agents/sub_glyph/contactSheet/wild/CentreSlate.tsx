/** CentreSlate: the waiting scenes (exposure, wiring, screening).
 *
 *  A clapperboard claps once when the scene begins and then holds still. It
 *  carries only real facts: the agent name, the scene, the take count (how
 *  many model passes this reel has had), and the real running time. The
 *  persona's role and mission appear the moment the engine streams them in;
 *  until then the slate says nothing about them. Screening shows the test
 *  run's own last lines as subtitles. */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAgentStore } from "@/stores/agentStore";
import { timecode } from "./useReel";
import { COPY } from "./wildCopy";

interface CentreSlateProps {
  mode: "exposure" | "wiring" | "screening";
  agentName: string;
  total: number;
  firstTake: number;
  takes: number;
  cliOutputLines?: string[];
  testOutputLines?: string[];
}

export function CentreSlate({ mode, agentName, total, firstTake, takes, cliOutputLines, testOutputLines }: CentreSlateProps) {
  const reduce = useReducedMotion();
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const activity = useAgentStore((s) => s.buildActivity);
  const role = behaviorCore?.identity?.role ?? null;
  const mission = behaviorCore?.mission ?? null;
  const eyebrow = mode === "exposure" ? COPY.wait.eyebrow : mode === "wiring" ? COPY.wait.wiringEyebrow : COPY.screening.eyebrow;
  const title = mode === "exposure" ? COPY.wait.title : mode === "wiring" ? COPY.wait.wiringTitle : COPY.screening.title;
  const lastCli = (cliOutputLines ?? []).filter((l) => l.trim()).slice(-1)[0] ?? null;
  const subs = (testOutputLines ?? []).filter((l) => l.trim()).slice(-3);
  const over = mode === "exposure" && firstTake > 155;

  return (
    <motion.div
      key={`slate-${mode}`}
      className="flex flex-col items-center gap-3 w-full"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.45 }}
    >
      <span className="csw-edge">{eyebrow}</span>
      <div className="csw-slate">
        <motion.div
          className="csw-clap"
          initial={reduce ? false : { rotate: -16 }}
          animate={{ rotate: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: [0.5, 0, 0.3, 1.6] }}
        />
        <dl>
          <dt>{COPY.wait.slateAgent}</dt>
          <dd className="csw-display truncate" style={{ fontSize: 20 }}>{agentName.trim() || COPY.wait.untitled}</dd>
          <dt>{COPY.wait.slateTake}</dt>
          <dd className="font-mono">{String(Math.max(1, takes)).padStart(2, "0")}</dd>
          <dt>{COPY.wait.slateScene}</dt>
          <dd>{title}</dd>
          <dt>{COPY.wait.slateTime}</dt>
          <dd className="csw-tc" aria-live="off">{timecode(total)}</dd>
        </dl>
      </div>

      <AnimatePresence>
        {(role || mission) && mode !== "screening" && (
          <motion.div key="identity" initial={{ opacity: 0, y: 6, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9 }} className="max-w-[480px]">
            {role && <div className="csw-display" style={{ fontSize: 18, textTransform: "uppercase", color: "var(--cs-amber)" }}>{role}</div>}
            {mission && <p className="csw-serif m-0 line-clamp-2" style={{ fontSize: 16, lineHeight: 1.45, color: "var(--cs-ink)" }}>{mission}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === "screening" ? (
        <div className="w-full max-w-[520px] flex flex-col gap-1 font-mono text-left" style={{ fontSize: 14, color: "var(--cs-ink)" }} aria-live="polite">
          {subs.length === 0 ? <span style={{ color: "var(--cs-dim)" }}>{COPY.screening.waiting}</span> : subs.map((l, i) => (
            <span key={`${subs.length}-${i}`} className="truncate" style={{ opacity: 0.55 + (i / Math.max(1, subs.length - 1)) * 0.45 }}>{l}</span>
          ))}
        </div>
      ) : (
        <>
          {activity && <span className="csw-body truncate max-w-[520px]" style={{ color: "var(--cs-ink)" }}>{activity}</span>}
          <p className="csw-body m-0 max-w-[480px]" style={{ fontSize: 14 }}>
            {over ? COPY.wait.over : mode === "exposure" ? COPY.wait.honest : COPY.wait.background}
          </p>
          {lastCli && !(role || mission) && (
            <span className="font-mono truncate max-w-[520px]" style={{ fontSize: 14, color: "var(--cs-faint)" }}>
              {COPY.wait.lastLine}: {lastCli}
            </span>
          )}
        </>
      )}
    </motion.div>
  );
}
