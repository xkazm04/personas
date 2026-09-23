/** ContactSheetPersonasLayout - V2 "Sheet · Personas".
 *
 *  The Contact Sheet build surface translated into the Personas design
 *  system: a 3 x 3 sheet with the prompt in the centre cell and eight
 *  dimension frames around it that develop from an unexposed state into a
 *  small picture of their value; a push-in into a frame's inner layer
 *  (settings, question, per-capability detail) and the pull back out; and a
 *  film-strip rail of the whole build with an honest clock. Runs entirely on
 *  real GlyphFullLayoutProps. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { ConfirmDialog } from "@/features/shared/components/feedback/ConfirmDialog";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";
import { useSheetDirector } from "./useSheetDirector";
import { SheetFrame } from "./SheetFrame";
import { SheetCentre } from "./SheetCentre";
import { PushPanel } from "./PushPanel";
import { QuestionPane } from "./QuestionPane";
import { FrameDetailPane, type DetailMode } from "./FrameDetailPane";
import { BuildRail } from "./BuildRail";
import { LogModal, RefineModal } from "./SheetModals";
import { GRID_AREA, SHEET_ORDER } from "./sheetModel";
import { COPY } from "./copy";

type Push = { dim: GlyphDimension; kind: "detail" } | { dim: GlyphDimension; kind: "question"; index: number };

const PULL_MS = 480;
const PREMIERE_AREA = (i: number) => `2 / ${i + 1}`;

export function ContactSheetPersonasLayout(props: GlyphFullLayoutProps) {
  const { t } = useTranslation();
  const director = useSheetDirector(props);
  const { act, round, frames, cfg, clock } = director;

  const [push, setPush] = useState<Push | null>(null);
  const [returning, setReturning] = useState<GlyphDimension | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const timer = useRef<number | null>(null);
  const roundRef = useRef(round);
  roundRef.current = round;
  const pushRef = useRef(push);
  pushRef.current = push;

  const later = useCallback((ms: number, fn: () => void) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; fn(); }, ms);
  }, []);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const pullOut = useCallback(() => {
    const p = pushRef.current;
    if (p) setReturning(p.dim);
    setPush(null);
  }, []);

  const ask = useCallback((index: number) => {
    const q = roundRef.current.questions[index];
    const dim = q ? CELL_KEY_TO_DIM[q.cellKey] ?? "task" : null;
    if (!dim) return;
    const cur = pushRef.current;
    if (cur && cur.dim !== dim) setReturning(cur.dim);
    roundRef.current.setIndex(index);
    setPush({ dim, kind: "question", index });
  }, []);

  /** Pull back into the frame so it develops, then push into the next one. */
  const advance = useCallback(() => {
    const r = roundRef.current;
    const next = r.nextUnanswered(r.index);
    pullOut();
    if (next >= 0) later(PULL_MS + 260, () => ask(next));
  }, [pullOut, ask, later]);

  const openFrame = (dim: GlyphDimension) => {
    if (pushRef.current) setReturning(pushRef.current.dim);
    if (act === "questions") {
      const i = round.indexOfDim(dim);
      if (i >= 0) { ask(i); return; }
    }
    setPush({ dim, kind: "detail" });
  };

  // Session / act changes close any open layer; a fresh round pushes into
  // its first question once the frames have had a beat to develop.
  useEffect(() => { setPush(null); setReturning(null); }, [director.buildSessionId]);
  const roundKey = round.questions.map((q) => q.cellKey).join(",");
  useEffect(() => {
    if (act !== "questions" || roundRef.current.answeredCount > 0) return;
    const id = window.setTimeout(() => ask(0), 1300);
    return () => window.clearTimeout(id);
  }, [act, roundKey, ask]);
  useEffect(() => {
    if (act !== "questions" && push?.kind === "question") pullOut();
  }, [act, push, pullOut]);

  // Escape pulls back out, unless a modal on top of the sheet owns the key.
  useEffect(() => {
    if (!push) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      e.preventDefault();
      pullOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, pullOut]);

  const premiere = act === "promoted";
  const detailMode: DetailMode = act === "compose" ? "compose" : act === "draft" || act === "testing" || act === "verdict" || act === "promoted" ? "draft" : "locked";
  const pushedFrame = push ? frames[push.dim] : null;
  const question = push?.kind === "question" ? round.questions[Math.min(push.index, round.questions.length - 1)] : undefined;
  const qIndex = push?.kind === "question" ? Math.min(push.index, Math.max(0, round.questions.length - 1)) : 0;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col pb-2" data-testid="build-layout-sheet-personas">
      <main
        className="relative flex-1 min-h-0 grid gap-3"
        aria-label={COPY.heroTitle}
        style={premiere
          ? { gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gridTemplateRows: "minmax(0, 1fr) 7rem" }
          : { gridTemplateColumns: "minmax(0, 1fr) minmax(420px, 1.5fr) minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)" }}
      >
        {SHEET_ORDER.map((dim, i) => (
          <SheetFrame
            key={dim}
            frame={frames[dim]}
            index={i}
            area={premiere ? PREMIERE_AREA(i) : GRID_AREA[dim]}
            compact={premiere}
            label={t.agents.glyph_dim_label[dim]}
            hint={t.agents.glyph_dim_desc[dim]}
            dimmed={!!push && push.dim !== dim}
            pushed={push?.dim === dim}
            returning={returning === dim}
            onOpen={openFrame}
          />
        ))}
        <section
          className="relative min-w-0 min-h-0 flex items-center justify-center px-2 py-2 transition-opacity duration-300"
          style={{ gridArea: premiere ? "1 / 1 / 2 / 9" : "2 / 2", opacity: push ? 0.12 : 1 }}
          inert={!!push}
        >
          <SheetCentre
            props={props}
            director={director}
            onOpenContext={() => setPush({ dim: "task", kind: "detail" })}
            onAsk={ask}
            onRefine={() => setRefineOpen(true)}
            onShowLog={() => setLogOpen(true)}
            onShowReport={() => setReportOpen(true)}
            onPromoteAnyway={props.onPromoteForce ? () => setConfirmForce(true) : undefined}
          />
        </section>

        {push && pushedFrame && (
          <PushPanel
            key={`${push.dim}-${push.kind}`}
            dim={push.dim}
            number={SHEET_ORDER.indexOf(push.dim) + 1}
            label={t.agents.glyph_dim_label[push.dim]}
            asking={push.kind === "question"}
            onClose={pullOut}
          >
            {push.kind === "question" && question ? (
              <QuestionPane
                question={question}
                index={qIndex}
                total={round.questions.length}
                draft={round.drafts[`${question.cellKey}|${question.question}`] ?? ""}
                isLast={round.nextUnanswered(qIndex) === -1 || round.nextUnanswered(qIndex) === qIndex}
                onDraft={(v) => round.setDraft(question, v)}
                onPick={(v) => { round.setDraft(question, v); later(240, advance); }}
                onNext={advance}
                onBack={qIndex > 0 ? () => ask(qIndex - 1) : undefined}
              />
            ) : (
              <FrameDetailPane
                frame={pushedFrame}
                mode={detailMode}
                item={cfg.items.find((it) => it.dim === push.dim)}
                rows={props.glyphRows}
                contextText={props.contextText}
                onContextChange={props.onContextChange}
              />
            )}
          </PushPanel>
        )}
      </main>

      <BuildRail clock={clock} showWindow={act === "exposure"} />

      {cfg.modals}
      <RefineModal open={refineOpen} onClose={() => setRefineOpen(false)} onSubmit={(v) => { void props.onRefine?.(v); }} />
      <LogModal open={logOpen} onClose={() => setLogOpen(false)} lines={props.cliOutputLines ?? []} />
      {reportOpen && (
        <TestReportModal
          results={props.toolTestResults ?? []}
          summary={props.testSummary ?? null}
          onClose={() => setReportOpen(false)}
          onCredentialAdded={() => { void useAgentStore.getState().fetchPersonas(); }}
        />
      )}
      {confirmForce && props.onPromoteForce && (
        <ConfirmDialog
          title={COPY.promoteAnywayTitle}
          body={COPY.promoteAnywayBody}
          danger
          confirmLabel={COPY.promoteAnyway}
          onConfirm={() => { setConfirmForce(false); props.onPromoteForce?.(); }}
          onCancel={() => setConfirmForce(false)}
        />
      )}
    </div>
  );
}
