/** QuestionsCentre — what the action panel holds around the question round.
 *  intro / away: which frames are asking, as a short summary; review: every
 *  drafted answer, each one a door back into its frame. The panel's own
 *  actions carry the way in and the one explicit Send. */
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { DIM_META } from "@/features/shared/glyph";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import type { FlowStage } from "../useQuestionFlow";
import { frameNumber } from "../sheetModel";
import { COPY } from "../copy";
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

function useFrameName() {
  const dimText = useGlyphDimText();
  return (q: BuildQuestion) => {
    const dim = CELL_KEY_TO_DIM[q.cellKey];
    return { dim, name: dim ? `${frameNumber(dim)} ${dimText.label[dim]}` : q.cellKey };
  };
}

/** The pending questions at a glance: the frame each one belongs to. */
export function QuestionsSummary({ qs, note = true }: { qs: BuildQuestion[]; note?: boolean }) {
  const frameName = useFrameName();
  return (
    <>
      <ul className="flex flex-wrap gap-1.5" aria-label={COPY.questionsFor(qs.length)}>
        {qs.map((q, i) => {
          const { dim, name } = frameName(q);
          return (
            <li key={`${q.cellKey}-${i}`} className="inline-flex items-center gap-1.5 typo-caption text-ink-2">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: dim ? DIM_META[dim].color : "var(--status-warning)" }} />
              {name}
            </li>
          );
        })}
      </ul>
      {note && <span className="typo-body text-ink-1">{COPY.questionsNote}</span>}
    </>
  );
}

interface AnswersListProps {
  stage: FlowStage;
  qs: BuildQuestion[];
  draftOf: (q: BuildQuestion) => string;
  onOpen: (i: number) => void;
}

export function AnswersList({ stage, qs, draftOf, onOpen }: AnswersListProps) {
  const frameName = useFrameName();
  const sending = stage === "sending";
  return (
    <ul className="w-full flex flex-col gap-1.5 overflow-y-auto min-h-0 max-h-[220px]">
      {qs.map((q, i) => {
        const { dim, name } = frameName(q);
        return (
          <li key={`${q.cellKey}-${i}`}>
            <PressSurface
              disabled={sending}
              onPress={() => onOpen(i)}
              className="w-full flex items-baseline gap-3 px-3 py-2 rounded-input border border-hair"
            >
              <span className="typo-caption font-mono w-[92px] flex-shrink-0 truncate" style={{ color: dim ? DIM_META[dim].color : undefined }}>
                {name}
              </span>
              <span className="typo-body text-ink-1 truncate">{draftOf(q)}</span>
            </PressSurface>
          </li>
        );
      })}
    </ul>
  );
}
