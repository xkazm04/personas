/** WildLoupe: routes the camera's focus to the right inner layer. */
import { DIM_META, GLYPH_DIMENSIONS, type GlyphDimension } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import type { Translations } from "@/i18n/en";
import type { ComposeConfigItem } from "../../useComposeConfig";
import { Loupe, LoupeNotes, LoupePrints, LoupeRefine } from "./Loupe";
import { LoupeDimension } from "./LoupeDimension";
import { LoupeQuestion } from "./LoupeQuestion";
import type { FrameModel } from "./frameModel";
import { focusKey, type Focus } from "./useWildFocus";
import { COPY } from "./wildCopy";

interface WildLoupeProps {
  focus: Focus;
  origin: string;
  props: GlyphFullLayoutProps;
  t: Translations;
  frames: Record<GlyphDimension, FrameModel>;
  labelOf: (d: GlyphDimension) => string;
  composeItems: ComposeConfigItem[] | null;
  question: BuildQuestion | null;
  answeredCount: number;
  refinePrefill: string | null;
  onAnswer: (cellKey: string, question: string, answer: string) => boolean;
  onClose: () => void;
  onRefined: () => void;
  onSplit: (prompt: string) => void;
}

export function WildLoupe(w: WildLoupeProps) {
  const { focus, props: p } = w;
  const pendingCount = p.pendingQuestions?.length ?? 0;
  const total = w.answeredCount + pendingCount;

  const questionBody = w.question ? (
    <LoupeQuestion
      key={`${w.question.cellKey}::${w.question.question}`}
      question={w.question}
      index={w.answeredCount + 1}
      total={total}
      onSubmit={(a) => w.onAnswer(w.question!.cellKey, w.question!.question, a)}
    />
  ) : null;

  if (focus.kind === "dim") {
    const d = focus.dim;
    const i = GLYPH_DIMENSIONS.indexOf(d);
    return (
      <Loupe
        key={focusKey(focus)}
        origin={w.origin}
        edge={`▸ ${String(i + 1).padStart(2, "0")}A`}
        title={w.labelOf(d)}
        accent={DIM_META[d].color}
        onClose={w.onClose}
      >
        {questionBody ?? (
          <LoupeDimension
            t={w.t}
            dim={d}
            model={w.frames[d]}
            compose={w.composeItems !== null}
            composeItem={w.composeItems?.find((it) => it.dim === d) ?? null}
            rows={p.glyphRows}
          />
        )}
      </Loupe>
    );
  }

  const title = focus.kind === "notes" ? COPY.loupe.notesTitle
    : focus.kind === "refine" ? COPY.loupe.refineTitle
      : focus.kind === "prints" ? COPY.loupe.printsTitle
        : COPY.questions.eyebrow;

  return (
    <Loupe key={focusKey(focus)} origin={w.origin} edge="▸ 00A" title={title} onClose={w.onClose}>
      {focus.kind === "notes" && <LoupeNotes value={p.contextText ?? ""} onChange={p.onContextChange} />}
      {focus.kind === "refine" && (
        <LoupeRefine
          prefill={w.refinePrefill}
          onSubmit={(v) => { w.onRefined(); void p.onRefine?.(v); }}
          onCancel={w.onClose}
        />
      )}
      {focus.kind === "prints" && <LoupePrints onRequestSplit={(_title, prompt) => w.onSplit(prompt)} />}
      {focus.kind === "ask" && (questionBody ?? <p className="csw-body m-0">{COPY.questions.sent}</p>)}
    </Loupe>
  );
}
