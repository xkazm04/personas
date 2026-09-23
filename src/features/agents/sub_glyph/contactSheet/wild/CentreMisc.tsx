/** CentreQuestions and CentreFogged: the two small centre states.
 *  Questions shows what is waiting while you are pulled back to the sheet;
 *  Fogged is the build failure, with the real error and the only real way on. */
import { motion } from "framer-motion";
import { CornerDownRight, RefreshCw } from "lucide-react";
import { COPY } from "./wildCopy";
import { WildButton } from "./WildButton";

export function CentreQuestions({ waiting, labels, onResume }: { waiting: number; labels: string[]; onResume: () => void }) {
  return (
    <motion.div key="questions" className="flex flex-col items-center gap-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <span className="csw-edge">{COPY.questions.eyebrow}</span>
      <h2 className="csw-display m-0" style={{ fontSize: 30, textTransform: "uppercase" }}>{COPY.questions.title}</h2>
      <p className="csw-body m-0">{labels.join(" · ")} ({waiting})</p>
      <WildButton onClick={onResume} icon={<CornerDownRight className="w-4 h-4" />} kbd="↵">{COPY.questions.resume}</WildButton>
    </motion.div>
  );
}

export function CentreFogged({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  return (
    <motion.div key="fogged" className="flex flex-col items-center gap-3 max-w-[520px]" initial={{ opacity: 0, filter: "blur(8px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.8 }}>
      <span className="csw-edge" style={{ color: "var(--cs-bad)" }}>{COPY.fogged.eyebrow}</span>
      <h2 className="csw-display m-0" style={{ fontSize: 34, textTransform: "uppercase" }}>{COPY.fogged.title}</h2>
      <p className="csw-body m-0">{COPY.fogged.body}</p>
      {error && (
        <p className="m-0 font-mono text-left w-full px-3 py-2 rounded line-clamp-4" style={{ fontSize: 14, color: "var(--cs-bad)", border: "1px solid color-mix(in srgb, var(--cs-bad) 40%, transparent)" }}>
          {error}
        </p>
      )}
      {onRetry ? (
        <WildButton onClick={onRetry} icon={<RefreshCw className="w-4 h-4" />}>{COPY.fogged.retry}</WildButton>
      ) : (
        <p className="csw-body m-0" style={{ fontSize: 14 }}>{COPY.fogged.noRetry}</p>
      )}
    </motion.div>
  );
}
