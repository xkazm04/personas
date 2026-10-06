/** The question round's hub content, in the dial's idiom: drop-in
 *  replacements for Cinema's QuestionsSummary and AnswersList (same props),
 *  handed to the ActPanel through its `questionViews`. Each row is a sector
 *  reference: the dimension's numbered badge in its ink (breathing while it
 *  asks, inked once answered) and its engraved name in its own colour. */
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { DIM_META } from "@/features/shared/glyph";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import Button from "@/features/shared/components/buttons/Button";
import { LETTERING } from "../../blueprint";
import type { FlowStage } from "../../cinema/useQuestionFlow";
import { frameNumber } from "../../cinema/sheetModel";
import { COPY as CINEMA } from "../../cinema/copy";
import { InkBadge } from "../InkBadge";
import { THEME_INK } from "../tint";

function useSectorRef() {
  const dimText = useGlyphDimText();
  return (q: BuildQuestion) => {
    const dim = CELL_KEY_TO_DIM[q.cellKey];
    return dim
      ? { num: frameNumber(dim), name: dimText.label[dim], color: DIM_META[dim].color }
      : { num: "00", name: q.cellKey.replace(/-/g, " "), color: THEME_INK };
  };
}

/** Which sectors are asking, one engraved reference each. */
export function DialQuestionsSummary({ qs, note = true }: { qs: BuildQuestion[]; note?: boolean }) {
  const ref = useSectorRef();
  return (
    <>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0" aria-label={CINEMA.questionsFor(qs.length)}>
        {qs.map((q, i) => {
          const r = ref(q);
          return (
            <li key={`${q.cellKey}-${i}`} className="inline-flex items-center gap-1.5">
              <InkBadge num={r.num} ink="asking" color={r.color} populated size={18} />
              <span style={{ ...LETTERING, color: r.color }}>{r.name}</span>
            </li>
          );
        })}
      </ul>
      {note && <span className="typo-body text-foreground">{CINEMA.questionsNote}</span>}
    </>
  );
}

interface DialAnswersListProps {
  stage: FlowStage;
  qs: BuildQuestion[];
  draftOf: (q: BuildQuestion) => string;
  onOpen: (i: number) => void;
}

/** Every drafted answer, each a door back into its question. */
export function DialAnswersList({ stage, qs, draftOf, onOpen }: DialAnswersListProps) {
  const ref = useSectorRef();
  const sending = stage === "sending";
  return (
    <ul className="m-0 w-full flex list-none flex-col overflow-y-auto min-h-0 max-h-[220px] p-0">
      {qs.map((q, i) => {
        const r = ref(q);
        return (
          <li key={`${q.cellKey}-${i}`}>
            <Button
              variant="ghost"
              size="sm"
              disabled={sending}
              onClick={() => onOpen(i)}
              className="!justify-start !gap-2.5 w-full !px-1.5 !py-1.5 text-left"
              style={{ borderBottom: "1px dashed var(--ink-faint)" }}
            >
              <InkBadge num={r.num} ink="done" color={r.color} populated size={18} />
              <span className="w-[84px] shrink-0 truncate" style={{ ...LETTERING, color: r.color }}>{r.name}</span>
              <span className="typo-body text-foreground truncate">{draftOf(q)}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
