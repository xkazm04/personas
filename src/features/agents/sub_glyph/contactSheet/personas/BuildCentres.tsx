/** BuildCentres - the middle cell while the model works and while it waits
 *  on you: the clapper slate with an honest clock, the question hub, and the
 *  stop card when a build fails. */
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Pencil, ScrollText, Send } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";
import { useTranslation } from "@/i18n/useTranslation";
import { qKey } from "./useQuestionRound";
import { spokenSecs, timecode } from "./useBuildClock";
import { COPY } from "./copy";

const EASE = [0.2, 0.7, 0.2, 1] as const;

interface SlateProps {
  agentName: string;
  phase: string;
  seconds: number;
  note: string;
  ghostPrints: number;
}

export function SlateCentre({ agentName, phase, seconds, note, ghostPrints }: SlateProps) {
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="w-full max-w-[460px] overflow-hidden rounded-card border border-card-border bg-card-bg shadow-elevation-4 text-left" role="group" aria-label={COPY.slateAgent}>
        <motion.div
          aria-hidden
          className="h-6 origin-bottom-left"
          style={{ background: "repeating-linear-gradient(-55deg, var(--foreground) 0 16px, var(--background) 16px 32px)" }}
          initial={{ rotate: -12 }}
          animate={{ rotate: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.5, 0, 0.3, 1.6] }}
        />
        <dl className="grid grid-cols-[5rem_1fr] items-baseline gap-x-3 gap-y-1.5 px-4 pt-3 pb-3.5">
          <dt className="typo-code text-muted">{COPY.slateAgent}</dt>
          <dd className="typo-body-lg text-foreground truncate">{agentName}</dd>
          <dt className="typo-code text-muted">{COPY.slatePhase}</dt>
          <dd className="typo-body text-foreground truncate">{phase}</dd>
          <dt className="typo-code text-muted">{COPY.slateTime}</dt>
          <dd className="typo-data-lg text-foreground" role="timer">{timecode(seconds)}</dd>
        </dl>
      </div>
      {ghostPrints > 0 && (
        <div className="flex gap-2" aria-hidden>
          {Array.from({ length: Math.min(6, ghostPrints) }, (_, i) => (
            <span key={i} className="w-16 h-9 rounded-interactive bg-primary/10 border border-primary/20" />
          ))}
        </div>
      )}
      <p className="typo-caption text-center max-w-[440px]">{note}</p>
    </div>
  );
}

interface QuestionsProps {
  questions: BuildQuestion[];
  drafts: Record<string, string>;
  answeredCount: number;
  allAnswered: boolean;
  sending: boolean;
  firstPassSecs: number | null;
  onResume: () => void;
  onEdit: (i: number) => void;
  onSend: () => void;
}

export function QuestionsCentre({ questions, drafts, answeredCount, allAnswered, sending, firstPassSecs, onResume, onEdit, onSend }: QuestionsProps) {
  const { t } = useTranslation();
  if (!allAnswered) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        {firstPassSecs != null && <span className="typo-label text-muted">{COPY.questionsLanded(spokenSecs(firstPassSecs))}</span>}
        <h2 className="typo-heading-lg text-foreground">{COPY.questionsCount(questions.length)}</h2>
        <p className="typo-body text-foreground max-w-[420px]">{COPY.questionsNote}</p>
        <Button variant="primary" size="md" iconRight={<ArrowRight className="w-4 h-4" />} onClick={onResume}>
          {COPY.questionsResume}
        </Button>
        {answeredCount > 0 && <span className="typo-caption">{COPY.questionsLeft(questions.length - answeredCount)}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 w-full min-h-0">
      <span className="typo-label text-muted">{COPY.questionsReady(questions.length)}</span>
      <ul className="w-full max-w-[480px] flex flex-col gap-1.5 min-h-0 overflow-y-auto">
        {questions.map((q, i) => {
          const dim = CELL_KEY_TO_DIM[q.cellKey];
          return (
            <li key={qKey(q)}>
              <button
                type="button"
                onClick={() => onEdit(i)}
                disabled={sending}
                className="group w-full flex items-baseline gap-3 px-3 py-2 rounded-input border border-card-border text-left hover:border-primary/40 focus-ring disabled:is-disabled"
              >
                <span className="typo-code text-muted w-24 flex-none truncate">{dim ? t.agents.glyph_dim_label[dim] : q.cellKey}</span>
                <span className="typo-body text-foreground min-w-0 truncate flex-1">{drafts[qKey(q)]}</span>
                <Pencil className="w-3.5 h-3.5 text-muted opacity-0 group-hover:opacity-100 flex-none" />
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="primary" size="md" icon={<Send className="w-4 h-4" />} onClick={onSend} loading={sending} loadingLabel={COPY.questionsSending} data-testid="cs-personas-send">
        {COPY.questionsSend}
      </Button>
      <span className="typo-caption">{COPY.questionsNothingSent}</span>
    </div>
  );
}

export function FailedCentre({ error, seconds, onShowLog, onRefine }: { error: string | null; seconds: number; onShowLog: () => void; onRefine?: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-status-error" />
      <h2 className="typo-heading-lg text-foreground">{seconds > 0 ? COPY.failedAt(spokenSecs(seconds)) : COPY.failedTitle}</h2>
      {error && <p className="typo-body text-foreground max-w-[460px] line-clamp-3">{error}</p>}
      <div className="flex items-center gap-2">
        {onRefine && <Button variant="primary" size="md" onClick={onRefine}>{t.agents.glyph_refine}</Button>}
        <Button variant="secondary" size="md" icon={<ScrollText className="w-4 h-4" />} onClick={onShowLog}>{COPY.cliLog}</Button>
      </div>
      <p className="typo-caption max-w-[420px]">{COPY.failedNote}</p>
    </motion.div>
  );
}
