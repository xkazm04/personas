/** TitleBlock - the right of sheet 1, Studio's drafting title block rebuilt
 *  on the Cinema stage: PROJECT (the name, click to rename) and STATUS (the
 *  scene and the honest clock); the BRIEF (role, and the mission lettered in
 *  the beat it is drawn); the DIMENSIONS as numbered goals that fill as each
 *  is inked; the NOTES (the build's own log, setup-log style); the stamp; and
 *  the act's action panel docked as the block's last cell. A cell with
 *  nothing to say is not drawn. */
import { motion } from "framer-motion";
import { useAgentStore } from "@/stores/agentStore";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import { COPY as CINEMA } from "../cinema/copy";
import { timecode } from "../cinema/sheetModel";
import { LETTERING } from "../blueprint";
import type { Ink } from "./sheetGeometry";
import type { DraftingSequence } from "./useDraftingSequence";
import { Cell, Lettered, Stamp } from "./sheetParts";
import { NameField } from "./NameField";
import { GoalGrid, NotesLog } from "./TitleRows";
import { COPY } from "./copy";

interface TitleBlockProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  seq: DraftingSequence;
  scene: string;
  inks: Record<GlyphDimension, Ink>;
  labels: Record<GlyphDimension, string>;
  refFor: (id: string) => (el: HTMLElement | null) => void;
  onOpen: (dim: GlyphDimension) => void;
  stamp: { text: string; tone: string } | null;
  /** The act's action panel (null in compose, where the composer acts). */
  dock: React.ReactNode;
}

function clockLabel(s: SheetState): string {
  const { running, partial } = s.clock;
  if (partial) return CINEMA.clock.partial;
  if (running === "build") return CINEMA.clock.building;
  if (running === "test") return CINEMA.clock.screening;
  return s.act === "premiere" || s.act === "stopped" ? CINEMA.clock.total : CINEMA.clock.waiting;
}

export function TitleBlock({ p, s, seq, scene, inks, labels, refFor, onOpen, stamp, dock }: TitleBlockProps) {
  const { shouldAnimate } = useMotion();
  const core = useAgentStore((st) => st.buildBehaviorCore);
  const role = core?.identity?.role ?? null;
  const mission = core?.mission ?? null;
  const lines = p.cliOutputLines ?? [];
  const notes = !s.isCompose && (lines.length > 0 || !!p.buildPhase);
  const time = s.clock.partial && s.clock.elapsed < 1 ? CINEMA.clock.unknown : timecode(s.clock.elapsed);

  return (
    <motion.div
      initial={shouldAnimate ? { clipPath: "inset(0 0 100% 0)", opacity: 0.4 } : false}
      animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative flex min-h-0 min-w-0 flex-col self-stretch"
      style={{ border: "1px solid var(--ink)", background: "color-mix(in srgb, var(--background) 82%, transparent)" }}
      data-testid="drafting-title-block"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Cell label={COPY.cell.project}>
            <NameField name={p.agentName} onChange={p.onAgentNameChange} />
          </Cell>
          <Cell label={COPY.cell.status}>
            <p className="truncate typo-body text-foreground">{scene}</p>
            {!s.isCompose && (
              <p className="flex items-baseline gap-2 whitespace-nowrap">
                <span className="typo-data-lg tabular-nums text-foreground" aria-label={`${CINEMA.buildTime} ${time}`}>{time}</span>
                <span className="truncate typo-caption">{clockLabel(s)}</span>
              </p>
            )}
          </Cell>
        </div>
        {seq.briefShown && (role || mission) && (
          <Cell label={COPY.cell.brief} className="shrink-0" cellRef={refFor("brief")}>
            {role && <span className="truncate" style={{ ...LETTERING, color: "var(--bp-accent)" }}>{role}</span>}
            {mission && <p className="line-clamp-3 typo-body text-foreground"><Lettered text={mission} /></p>}
          </Cell>
        )}
        <Cell label={COPY.cell.dimensions} className="shrink-0">
          <GoalGrid seq={seq} inks={inks} labels={labels} values={s.frameValues} refFor={refFor} onOpen={onOpen} />
        </Cell>
        {notes && (
          <Cell label={COPY.cell.notes} className="shrink-0" cellRef={refFor("notes")}>
            <NotesLog phase={p.buildPhase} lines={lines} building={p.isBuilding} stopped={s.act === "stopped"} />
          </Cell>
        )}
      </div>
      {dock && <div className="dsh-dock shrink-0">{dock}</div>}
      <Stamp text={stamp?.text ?? null} tone={stamp?.tone ?? "var(--ink-strong)"} />
    </motion.div>
  );
}
