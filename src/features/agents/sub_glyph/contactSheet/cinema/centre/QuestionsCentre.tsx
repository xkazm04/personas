/** QuestionsCentre — what the centre cell says around the question round.
 *  intro / away: the count and a way back in; review: every drafted answer,
 *  each one a door back into its frame, and the one explicit Send. */
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import type { FlowStage } from "../useQuestionFlow";
import { frameNumber } from "../sheetModel";
import { EASE } from "../cinemaMotion";
import { COPY } from "../copy";

interface QuestionsCentreProps {
  stage: FlowStage;
  qs: BuildQuestion[];
  draftOf: (q: BuildQuestion) => string;
  onOpen: (i: number) => void;
  onSend: () => void;
}

export function QuestionsFooter({ stage, count, onContinue }: { stage: FlowStage; count: number; onContinue: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4, ease: EASE }} className="flex flex-col items-center gap-1.5">
      <span className="typo-body-lg font-semibold text-foreground">{COPY.questionsFor(count)}</span>
      <span className="typo-body text-foreground max-w-[380px]">{COPY.questionsNote}</span>
      {stage === "away" && (
        <Button variant="primary" size="sm" onClick={onContinue}>
          {COPY.continueQuestions} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
        </Button>
      )}
    </motion.div>
  );
}

export function AnswersReview({ stage, qs, draftOf, onOpen, onSend }: QuestionsCentreProps) {
  const dimText = useGlyphDimText();
  const sending = stage === "sending";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="w-full h-full flex flex-col items-center justify-center gap-2.5">
      <span className="typo-caption font-semibold uppercase tracking-[0.12em] text-foreground">{COPY.answersReady(qs.length)}</span>
      <ul className="w-full max-w-[460px] flex flex-col gap-1.5 overflow-y-auto min-h-0">
        {qs.map((q, i) => {
          const dim = CELL_KEY_TO_DIM[q.cellKey];
          return (
            <li key={`${q.cellKey}-${i}`}>
              <button
                type="button"
                disabled={sending}
                onClick={() => onOpen(i)}
                className="w-full flex items-baseline gap-3 px-3 py-2 rounded-input border border-card-border text-left hover:bg-foreground/[0.04] disabled:opacity-60"
              >
                <span className="typo-caption font-mono w-[92px] flex-shrink-0 truncate" style={{ color: dim ? DIM_META[dim].color : undefined }}>
                  {dim ? `${frameNumber(dim)} ${dimText.label[dim]}` : q.cellKey}
                </span>
                <span className="typo-body text-foreground truncate">{draftOf(q)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="primary" size="md" icon={<Send className="w-3.5 h-3.5" />} onClick={onSend} loading={sending} loadingLabel={COPY.sending} autoFocus>
        {COPY.send} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
      </Button>
      <span className="typo-caption text-foreground">{COPY.sendNote}</span>
    </motion.div>
  );
}
