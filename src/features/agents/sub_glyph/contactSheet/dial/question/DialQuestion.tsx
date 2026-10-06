/** DialQuestion - one question of the round, drawn as the exploded view's
 *  right-hand column: the same bus line and lettered zones the dimension's
 *  controls hang off, in the asked dimension's colour. Zone A carries the
 *  question and the round's progress (one mark per question, in ITS
 *  dimension's colour, inked once drafted); zone B the answer, each option a
 *  numbered row whose badge inks when picked, or the vault picker for a
 *  connector question, with "own words" on a drafting line under it. Keys
 *  and drafting behave exactly as Cinema's QuestionLayer (useQuestionKeys):
 *  nothing reaches the build until the review's Send. */
import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DIM_META } from "@/features/shared/glyph";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { VaultConnectorPicker } from "@/features/vault/components/VaultConnectorPicker";
import Button from "@/features/shared/components/buttons/Button";
import { useQuestionKeys } from "../../cinema/useQuestionKeys";
import { COPY as CINEMA } from "../../cinema/copy";
import { LetteredSection, SectionBus } from "../explode/LetteredSection";
import { InkBadge } from "../InkBadge";
import { THEME_INK, tint } from "../tint";
import { COPY } from "../copy";

interface DialQuestionProps {
  qs: BuildQuestion[];
  index: number;
  color: string;
  draftOf: (q: BuildQuestion) => string;
  onDraft: (v: string) => void;
  onPick: (v: string) => void;
  onNext: () => void;
  onPrev: () => void;
  busRef: (el: HTMLDivElement | null) => void;
}

/** The round at a glance: a mark per question, coloured by its dimension. */
function RoundMarks({ qs, index, draftOf }: Pick<DialQuestionProps, "qs" | "index" | "draftOf">) {
  return (
    <span className="ml-2 flex items-center gap-1" aria-hidden>
      {qs.map((q, i) => {
        const dim = CELL_KEY_TO_DIM[q.cellKey];
        const c = dim ? DIM_META[dim].color : THEME_INK;
        const drafted = !!draftOf(q).trim();
        return (
          <span
            key={`${q.cellKey}-${i}`}
            className="h-2.5 w-1 rounded-full transition-colors duration-300"
            style={{
              background: drafted || i === index ? c : "transparent",
              border: `1px ${drafted || i === index ? "solid" : "dashed"} ${drafted || i === index ? c : tint(c, 0.5)}`,
              transform: i === index ? "scaleY(1.5)" : undefined,
            }}
          />
        );
      })}
    </span>
  );
}

export function DialQuestion({ qs, index, color, draftOf, onDraft, onPick, onNext, onPrev, busRef }: DialQuestionProps) {
  const question = qs[index]!;
  const draft = draftOf(question);
  const options = useMemo(() => question.options ?? [], [question.options]);
  const freeText = options.includes(draft) ? "" : draft;
  const isLast = index >= qs.length - 1;
  const firstOpt = useQuestionKeys({ question, options, index, draft, onPick, onNext, onPrev });

  return (
    <div className="min-h-0 h-full overflow-y-auto pr-1 flex flex-col" data-testid="dial-question">
      <SectionBus color={color} busRef={busRef}>
        <LetteredSection
          i={0} letter="A" color={color} title={CINEMA.loupe.questionOf(index + 1, qs.length)}
          aside={<RoundMarks qs={qs} index={index} draftOf={draftOf} />}
        >
          <motion.h2
            key={question.question}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.3 }}
            className="m-0 typo-heading-lg text-foreground leading-snug"
          >
            {question.question}
          </motion.h2>
        </LetteredSection>

        <LetteredSection i={1} letter="B" color={color} title={COPY.question.answer}>
          {question.connectorCategory ? (
            <VaultConnectorPicker category={question.connectorCategory} value={draft} onChange={onPick} suggested={question.suggested} />
          ) : (
            <div className="flex flex-col" role="radiogroup" aria-label={question.question}>
              {options.map((opt, i) => {
                const on = draft === opt;
                return (
                  <Button
                    key={opt}
                    ref={i === 0 ? firstOpt : undefined}
                    variant="ghost"
                    size="sm"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onPick(opt)}
                    className="w-full !px-1.5 !py-2 text-left [&>span]:w-full [&>span]:min-w-0"
                    style={{ borderBottom: `1px ${on ? "solid" : "dashed"} ${on ? color : "var(--ink-faint)"}`, background: on ? tint(color, 0.1) : undefined }}
                  >
                    <span className="flex w-full min-w-0 items-center gap-3">
                      <InkBadge num={String(i + 1)} ink={on ? "done" : "pending"} color={color} populated size={22} />
                      <span className="min-w-0 typo-body text-foreground">{opt}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
          {!question.connectorCategory && (
            <input
              type="text"
              value={freeText}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onNext(); } }}
              placeholder={CINEMA.ownWords}
              aria-label={CINEMA.ownWords}
              className="h-10 px-1.5 bg-transparent typo-body text-foreground outline-none border-0 border-b border-dashed"
              style={{ borderColor: freeText ? color : "var(--ink-dim)" }}
            />
          )}
          <div className="flex items-center justify-between pt-2">
            {index > 0 ? (
              <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onPrev}>{CINEMA.prev}</Button>
            ) : <span />}
            <Button variant="primary" size="md" iconRight={<ArrowRight className="w-3.5 h-3.5" />} disabled={!draft.trim()} onClick={onNext}>
              {isLast ? CINEMA.reviewAnswers : CINEMA.next}
            </Button>
          </div>
        </LetteredSection>
      </SectionBus>
    </div>
  );
}
