import { motion, AnimatePresence } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { BuildPhase, BuildQuestion, CellBuildStatus } from "@/lib/types/buildTypes";
import { GlyphSigilCanvas } from "./GlyphSigilCanvas";
import { GlyphLegend } from "./GlyphLegend";
import { GlyphActivityStrip } from "./GlyphActivityStrip";
import { GlyphCoreContent } from "./GlyphCoreContent";
import type { PetalState } from "./glyphLayoutTypes";

interface GlyphSigilFaceProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  onHoverDim: (d: GlyphDimension | null) => void;
  onClickDim: (d: GlyphDimension) => void;
  isCompose: boolean;
  isBuilding: boolean;
  isBuildingOnly: boolean;
  isRefining: boolean;
  buildPhase: BuildPhase | null;
  hasDesignResult: boolean;
  cellStates: Record<string, CellBuildStatus>;
  pendingQuestions: BuildQuestion[] | null;
  cliOutputLines?: string[];
  refining: boolean;
  setRefining: (v: boolean) => void;
  completenessPct: number;
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  onStartTest: () => void | Promise<void>;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRejectTest?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onViewAgent: () => void;
  onShowSimulate: () => void;
  buildSessionId: string | null;
  overlay: React.ReactNode;
}

/** The sigil column when the glyph face is shown (i.e. not Edit). Mounts
 *  only once compose is complete — wraps the canvas with phase-aware
 *  decorations: the hint strip during refine, the legend when no dim is
 *  active, and the live CLI strip during builds. */
export function GlyphSigilFace(props: GlyphSigilFaceProps) {
  const {
    size, petalStates, hoveredDim, activeDim, onHoverDim, onClickDim,
    isCompose, isBuilding, isBuildingOnly, isRefining,
    buildPhase, hasDesignResult, pendingQuestions, cliOutputLines,
    refining, setRefining, completenessPct,
    testOutputLines, testPassed, testError,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    onShowSimulate, buildSessionId, overlay,
  } = props;

  return (
    <AnimatePresence>
      {!isCompose && (
        <motion.div
          key="sigil"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-5"
        >
          <GlyphSigilCanvas
            size={size}
            petalStates={petalStates}
            hoveredDim={hoveredDim}
            activeDim={activeDim}
            onHoverDim={onHoverDim}
            onClickDim={onClickDim}
            dimmed={isBuildingOnly}
            showOrbit={isBuildingOnly}
            overlay={overlay}
          >
            <AnimatePresence mode="wait">
              <GlyphCoreContent
                isPreBuild={isCompose}
                isBuilding={isBuilding}
                buildPhase={buildPhase}
                hasDesignResult={hasDesignResult}
                refining={refining}
                setRefining={setRefining}
                completenessPct={completenessPct}
                pendingQuestions={pendingQuestions}
                testOutputLines={testOutputLines}
                testPassed={testPassed}
                testError={testError}
                onStartTest={onStartTest}
                onPromote={onPromote}
                onPromoteForce={onPromoteForce}
                onRejectTest={onRejectTest}
                onRefine={onRefine}
                onViewAgent={onViewAgent}
                onShowSimulate={onShowSimulate}
                buildSessionId={buildSessionId}
              />
            </AnimatePresence>
          </GlyphSigilCanvas>

          {isRefining && !activeDim && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="typo-caption text-foreground/55 italic"
            >
              Tap a glowing leaf to answer.
            </motion.span>
          )}

          {!activeDim && !isBuildingOnly && (
            <GlyphLegend
              petalStates={petalStates}
              onSelectDim={(d) => onClickDim(d)}
              onHoverDim={onHoverDim}
            />
          )}

          {isBuilding && cliOutputLines && cliOutputLines.length > 0 && (
            <GlyphActivityStrip lines={cliOutputLines} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
