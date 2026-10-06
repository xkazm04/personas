/** TitleRows - the two lists inside the title block. GoalGrid: the eight
 *  dimensions as numbered goals, each row appearing the beat its region is
 *  drawn (an undrawn row keeps its slot), its badge filling in the
 *  dimension's colour the beat it is inked; every row opens its sheet.
 *  NotesLog: the build's phase and the tail of its own output, marked as
 *  Studio's setup log is: done, in work, failed. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { BuildPhase } from "@/lib/types/buildTypes";
import { COPY as CINEMA } from "../cinema/copy";
import type { FrameValue } from "../cinema/useFrameValues";
import { dimNumber, type Ink } from "./sheetGeometry";
import type { DraftingSequence } from "./useDraftingSequence";
import { Badge, HitArea } from "./sheetParts";
import { COPY } from "./copy";

interface GoalGridProps {
  seq: DraftingSequence;
  inks: Record<GlyphDimension, Ink>;
  labels: Record<GlyphDimension, string>;
  values: Record<GlyphDimension, FrameValue | null>;
  refFor: (id: string) => (el: HTMLElement | null) => void;
  onOpen: (dim: GlyphDimension) => void;
}

function Mark({ ink, color }: { ink: Ink; color: string }) {
  if (ink === "done") return <span className="shrink-0 typo-caption" style={{ color }}>✓</span>;
  if (ink === "error") return <span className="shrink-0 typo-caption text-status-error">✕</span>;
  if (ink === "asking") return <span className="shrink-0 typo-caption text-status-warning">{COPY.ink.asking}</span>;
  if (ink === "drafting") return <span className="shrink-0 typo-caption" style={{ color: "var(--ink-strong)" }}>{COPY.ink.drafting}</span>;
  return null;
}

export function GoalGrid({ seq, inks, labels, values, refFor, onOpen }: GoalGridProps) {
  return (
    <ol className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 p-0">
      {GLYPH_DIMENSIONS.map((dim) => {
        if (!seq.drawn.has(dim)) return <li key={dim} aria-hidden className="invisible h-7" />;
        const ink = inks[dim];
        const color = DIM_META[dim].color;
        const done = ink === "done";
        return (
          <li key={dim} ref={refFor(`goal:${dim}`)} className="relative flex h-7 min-w-0 items-center gap-2 px-1">
            <Badge n={dimNumber(dim)} filled={done} color={done ? color : "var(--ink)"} dashed={ink === "pending"} />
            <span className="min-w-0 flex-1 truncate typo-body text-foreground">
              {labels[dim]}
              {done && values[dim]?.caption && <span className="typo-caption"> · {values[dim]!.caption}</span>}
            </span>
            <Mark ink={ink} color={color} />
            <HitArea label={COPY.nested.open(String(dimNumber(dim) + 1), labels[dim])} onPress={() => onOpen(dim)} />
          </li>
        );
      })}
    </ol>
  );
}

interface NotesLogProps {
  phase: BuildPhase | null;
  lines: string[];
  building: boolean;
  stopped: boolean;
}

const TAIL = 3;

export function NotesLog({ phase, lines, building, stopped }: NotesLogProps) {
  const tail = lines.slice(-TAIL);
  const label = phase ? CINEMA.phaseLabel[phase] ?? null : null;
  const mark = (latest: boolean) => (!latest ? "✓" : stopped ? "✕" : building ? "›" : "✓");
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-live="polite">
      {label && (
        <li className="truncate typo-body text-foreground">
          <span style={{ color: stopped ? "var(--status-error)" : "var(--ink-strong)" }}>{mark(true)}</span> {label}
        </li>
      )}
      {tail.map((l, i) => (
        <li key={`${lines.length - tail.length + i}`} className="truncate typo-code text-foreground">
          <span style={{ color: "var(--ink-strong)" }}>{mark(i === tail.length - 1)}</span> {l}
        </li>
      ))}
    </ul>
  );
}
