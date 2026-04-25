/**
 * GlyphFullLayout — flagship build surface.
 *
 * Consolidates the strengths of every mode in one face:
 *   · Hero sigil (8 petals) as the primary navigation and progress map
 *   · Multi-capability row strip for personas with > 1 use case
 *   · Inline Q&A anchored to the affected petal during the build
 *   · Full test lifecycle in the core (Run Test → Approve / Refine / Reject)
 *   · "Flip to Edit" face for advanced users — surfaces BehaviorCoreEditor,
 *     CapabilityRow list, SharedResourcesPanel (capability view strengths)
 *   · Live activity strip showing the last CLI lines during the build
 *
 * All interactions live on one canvas: no layout swap, no modal takeovers.
 */
import { useMemo, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Play, CheckCircle2, Loader2, AlertCircle, ArrowRight,
  Rocket, Send, X, HelpCircle, Settings2, Pencil, Plus,
  ThumbsDown, RefreshCw, Terminal, ChevronDown,
} from "lucide-react";
import { DIM_META, PETAL_ANGLES, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { BuildQuestion, CellBuildStatus, BuildPhase } from "@/lib/types/buildTypes";
import { VaultConnectorPicker } from "@/features/shared/components/picker/VaultConnectorPicker";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { BehaviorCoreEditor } from "@/features/agents/components/matrix/BehaviorCoreEditor";
import { SharedResourcesPanel } from "@/features/agents/components/matrix/SharedResourcesPanel";
import {
  CapabilityRow,
  CapabilityAddModal,
} from "@/features/agents/components/newPersona/capabilityView";
import { type QuickConfigState } from "@/features/agents/components/matrix/DimensionQuickConfig";
import { CommandPanel } from "@/features/agents/components/matrix/commandPanel";

// ---------------------------------------------------------------------------
// Mapping — matrix cell keys ↔ glyph dimensions
// ---------------------------------------------------------------------------
const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  "use-cases": "task",
  connectors: "connector",
  triggers: "trigger",
  "human-review": "review",
  messages: "message",
  memory: "memory",
  "error-handling": "error",
  events: "event",
};
const DIM_TO_CELL_KEY: Record<GlyphDimension, string> = Object.fromEntries(
  Object.entries(CELL_KEY_TO_DIM).map(([k, v]) => [v, k]),
) as Record<GlyphDimension, string>;

const DIM_LABEL: Record<GlyphDimension, string> = {
  trigger: "When",
  task: "What",
  connector: "Apps",
  message: "Messages",
  review: "Review",
  memory: "Memory",
  event: "Events",
  error: "Errors",
};

type PetalState = "idle" | "filling" | "resolved" | "pending" | "error";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface GlyphFullLayoutProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  completeness: number; // 0..100
  cellStates: Record<string, CellBuildStatus>;
  pendingQuestions: BuildQuestion[] | null;
  onAnswer: (cellKey: string, answer: string) => void;
  agentName: string;
  onAgentNameChange: (v: string) => void;
  hasDesignResult: boolean;
  glyphRows: GlyphRow[];
  onStartTest: () => void | Promise<void>;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRejectTest?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onViewAgent: () => void;
  buildError: string | null;
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  cliOutputLines?: string[];
  onQuickConfigChange?: (c: QuickConfigState) => void;
}

// ---------------------------------------------------------------------------
// Petal state derivation
// ---------------------------------------------------------------------------
function derivePetalState(
  dim: GlyphDimension,
  cellStates: Record<string, CellBuildStatus>,
  pendingDims: Set<GlyphDimension>,
  activeRow: GlyphRow | null,
): PetalState {
  if (pendingDims.has(dim)) return "pending";
  const cellStatus = cellStates[DIM_TO_CELL_KEY[dim]];
  if (cellStatus === "error") return "error";
  // Prefer the active row's presence once the LLM has produced results —
  // that way a persona with multiple capabilities shows which leaves the
  // selected capability actually uses, not the global build union.
  if (activeRow) {
    if (activeRow.presence[dim] !== "none") return "resolved";
    if (cellStatus === "filling" || cellStatus === "pending") return "filling";
    return "idle";
  }
  if (cellStatus === "resolved" || cellStatus === "updated" || cellStatus === "highlighted") return "resolved";
  if (cellStatus === "filling" || cellStatus === "pending") return "filling";
  return "idle";
}

// ---------------------------------------------------------------------------
// Hero sigil (SVG petals)
// ---------------------------------------------------------------------------
interface HeroSigilProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  onHover: (d: GlyphDimension | null) => void;
  onClick: (d: GlyphDimension) => void;
}
function HeroSigil({ size, petalStates, hoveredDim, activeDim, onHover, onClick }: HeroSigilProps) {
  const center = size / 2;
  const petalOuter = size * 0.44;
  const petalInner = size * 0.13;
  const coreR = size * 0.19;
  const guideInner = size * 0.30;

  const petalPath =
    `M 0 -${petalInner} C ${size * 0.065} -${petalOuter * 0.49}, ${size * 0.065} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.065} -${petalOuter * 0.77}, -${size * 0.065} -${petalOuter * 0.49}, 0 -${petalInner} Z`;

  const glowId = "glyph-full-hero-glow";
  const coreGrad = "glyph-full-hero-core";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 pointer-events-none">
      <defs>
        <radialGradient id={coreGrad} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#60a5fa" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx={center} cy={center} r={petalOuter + 8} fill="none" stroke="currentColor" strokeOpacity="0.06" />
      <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity="0.10" />
      <circle cx={center} cy={center} r={guideInner} fill="none" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="2,6" />


      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const state = petalStates[dim];
        const isHovered = hoveredDim === dim;
        const isActive = activeDim === dim;
        const dimOther = activeDim !== null && !isActive;

        const fillOpacity =
          state === "resolved" ? (isHovered ? 0.9 : 0.75)
          : state === "pending" ? 0.8
          : state === "filling" ? 0.35
          : state === "error" ? 0.6
          : isHovered ? 0.12 : 0;
        const strokeOpacity =
          state === "resolved" || state === "pending" ? 0.95
          : state === "filling" ? 0.6
          : state === "error" ? 0.9
          : isHovered ? 0.7 : 0.25;
        const dash = state === "idle" ? "4,5" : state === "filling" ? "6,3" : undefined;
        const color = state === "error" ? "#fb923c" : meta.color;

        return (
          <motion.g
            key={dim}
            transform={`translate(${center} ${center}) rotate(${angle})`}
            style={{ cursor: "pointer", pointerEvents: "auto", opacity: dimOther ? 0.25 : 1 }}
            animate={
              state === "pending" ? { scale: [1, 1.08, 1] }
              : state === "filling" ? { scale: [1, 1.025, 1] }
              : { scale: 1 }
            }
            transition={
              state === "pending" ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              : state === "filling" ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.25 }
            }
            onMouseEnter={() => onHover(dim)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => { e.stopPropagation(); onClick(dim); }}
          >
            <path
              d={petalPath}
              fill={color}
              fillOpacity={fillOpacity}
              stroke={color}
              strokeWidth={state === "pending" ? 2 : state === "resolved" ? 1.6 : 1.3}
              strokeOpacity={strokeOpacity}
              strokeDasharray={dash}
              filter={state === "resolved" || state === "pending" ? `url(#${glowId})` : undefined}
            />
            {state === "resolved" && <circle cx={0} cy={-petalOuter + 8} r={3.5} fill="#fff" opacity="0.95" />}
            {state === "pending" && (
              <motion.circle cx={0} cy={-petalOuter + 8} r={4.5} fill="#fff"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.2, repeat: Infinity }} />
            )}
          </motion.g>
        );
      })}

      <circle cx={center} cy={center} r={coreR + 12} fill="none" stroke="currentColor" strokeOpacity="0.08" />
      <circle cx={center} cy={center} r={coreR + 2} fill={`url(#${coreGrad})`} />
      <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Petal icon overlay (HTML)
// ---------------------------------------------------------------------------
interface PetalIconsProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
}
function PetalIcons({ size, petalStates, hoveredDim, activeDim }: PetalIconsProps) {
  const center = size / 2;
  const iconR = size * 0.34;
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ width: size, height: size }}>
      {GLYPH_DIMENSIONS.map((dim) => {
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const angle = PETAL_ANGLES[dim];
        const state = petalStates[dim];
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + iconR * Math.cos(rad);
        const y = center + iconR * Math.sin(rad);
        const isHovered = hoveredDim === dim;
        const isActive = activeDim === dim;
        const dimOther = activeDim !== null && !isActive;
        // +50% vs prior: 108 resolved/pending, 84 idle.
        const boxSize = state === "resolved" || state === "pending" ? 108 : 84;
        const CustomArt = meta.customArt;

        // Glow tiers — always on, escalating with interest.
        //   base:  idle (subtle ambient halo so the petal reads as "lit")
        //   mid:   filling, resolved, or idle+hover, or error
        //   strong: resolved+hover, pending, active, error+hover
        const tier: "base" | "mid" | "strong" =
          state === "pending" || isActive
            ? "strong"
            : (state === "resolved" && isHovered) || (state === "error" && isHovered)
              ? "strong"
              : state === "resolved" || state === "error" || state === "filling" || isHovered
                ? "mid"
                : "base";
        const glowCfg = tier === "strong"
          ? { bg: "55", shadow: "cc", blur: 32 }
          : tier === "mid"
            ? { bg: "33", shadow: "88", blur: 20 }
            : { bg: "14", shadow: "44", blur: 10 };

        // Icon opacity progression — base state is still visible (no more
        // near-invisible idle icons), hover/active bump to full.
        const iconOpacity = state === "idle"
          ? isHovered ? 0.95 : 0.7
          : state === "filling"
            ? 0.9
            : 1;

        return (
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center transition-all duration-300"
            style={{
              left: x - boxSize / 2, top: y - boxSize / 2,
              width: boxSize, height: boxSize,
              opacity: dimOther ? 0.25 : 1,
              // `currentColor` → custom art SVG strokes + lucide stroke/fill.
              color: state === "resolved" || state === "pending" ? "#fff" : meta.color,
            }}
          >
            <span
              className="absolute inset-0 rounded-full transition-all duration-300 pointer-events-none"
              style={{
                background: `${meta.color}${glowCfg.bg}`,
                boxShadow: `0 0 ${glowCfg.blur}px ${meta.color}${glowCfg.shadow}`,
              }}
            />
            {CustomArt ? (
              <div
                className="relative"
                style={{
                  opacity: iconOpacity,
                  filter: tier === "strong"
                    ? `drop-shadow(0 0 8px ${meta.color})`
                    : tier === "mid"
                      ? `drop-shadow(0 0 5px ${meta.color}aa)`
                      : undefined,
                }}
              >
                <CustomArt size={boxSize - 6} />
              </div>
            ) : (
              <Icon
                className="relative"
                style={{
                  width: boxSize - 30, height: boxSize - 30,
                  opacity: iconOpacity,
                  filter: tier !== "base" ? `drop-shadow(0 0 6px ${meta.color})` : undefined,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-row mini-sigil strip
// ---------------------------------------------------------------------------
interface MiniSigilProps {
  row: GlyphRow;
  active: boolean;
  hovered?: boolean;
  onClick: () => void;
}
function MiniSigil({ row, active, hovered, onClick }: MiniSigilProps) {
  const size = 60;
  const center = size / 2;
  const petalOuter = size * 0.42;
  const petalInner = size * 0.15;
  const linkedCount = Object.values(row.presence).filter((p) => p === "linked").length;
  const petalPath =
    `M 0 -${petalInner} C ${size * 0.06} -${petalOuter * 0.49}, ${size * 0.06} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.06} -${petalOuter * 0.77}, -${size * 0.06} -${petalOuter * 0.49}, 0 -${petalInner} Z`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={row.title}
      className={`relative shrink-0 rounded-full transition-all ${active ? "ring-2 ring-primary/60" : hovered ? "ring-1 ring-foreground/30" : "hover:ring-1 hover:ring-foreground/20"}`}
      style={{ width: size + 8, height: size + 8, padding: 4 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity={active ? 0.15 : 0.08} />
        {GLYPH_DIMENSIONS.map((dim) => {
          const angle = PETAL_ANGLES[dim];
          const meta = DIM_META[dim];
          const presence = row.presence[dim];
          return (
            <g key={dim} transform={`translate(${center} ${center}) rotate(${angle})`}>
              <path
                d={petalPath}
                fill={presence !== "none" ? meta.color : "transparent"}
                fillOpacity={presence === "linked" ? (active ? 0.9 : 0.7) : presence === "shared" ? 0.3 : 0}
                stroke={meta.color}
                strokeWidth="0.9"
                strokeOpacity={presence !== "none" ? 0.8 : 0.2}
                strokeDasharray={presence === "none" ? "2,3" : undefined}
              />
            </g>
          );
        })}
        <circle cx={center} cy={center} r={size * 0.14} fill="currentColor" fillOpacity={active ? 0.2 : 0.1} />
        <text x={center} y={center + 2} textAnchor="middle" dominantBaseline="middle" className="fill-current"
          style={{ fontSize: `${size * 0.22}px`, fontWeight: 700 }}>
          {linkedCount}
        </text>
      </svg>
    </button>
  );
}

interface RowStripProps {
  rows: GlyphRow[];
  activeIndex: number;
  hoveredIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
  onAdd: () => void;
  canAdd: boolean;
}
/** Labels removed from each mini — the full title renders in the shared
 *  header row beneath the strip so it never truncates and doesn't pile up. */
function RowStrip({ rows, activeIndex, hoveredIndex, onSelect, onHover, onAdd, canAdd }: RowStripProps) {
  if (rows.length <= 1 && !canAdd) return null;
  return (
    <div className="flex items-center gap-3 flex-wrap justify-center">
      {rows.map((row, i) => (
        <div
          key={row.id}
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
        >
          <MiniSigil
            row={row}
            active={i === activeIndex}
            hovered={i === hoveredIndex && i !== activeIndex}
            onClick={() => onSelect(i)}
          />
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="w-[68px] h-[68px] shrink-0 rounded-full border border-dashed border-border/40 hover:border-primary/40 flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors"
          title="Add capability"
        >
          <Plus className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline answer card (anchored below the sigil)
// ---------------------------------------------------------------------------
interface AnswerCardProps {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
  onClose: () => void;
}
function AnswerCard({ question, onAnswer, onClose }: AnswerCardProps) {
  const [text, setText] = useState("");
  const dim = CELL_KEY_TO_DIM[question.cellKey];
  const color = dim ? DIM_META[dim].color : "#60a5fa";
  const options = question.options ?? [];
  const category = question.connectorCategory ?? null;
  const submit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return;
    onAnswer(question.cellKey, trimmed);
    setText("");
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ duration: 0.25 }}
      className="relative rounded-modal bg-card-bg border border-card-border p-4 shadow-elevation-3 flex flex-col gap-3"
      style={{ boxShadow: `0 0 28px ${color}33, 0 4px 16px rgba(0,0,0,0.3)` }}
    >
      <div className="absolute top-0 left-0 w-full h-1 rounded-t-modal" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: `${color}33`, boxShadow: `0 0 10px ${color}66` }}>
          <HelpCircle className="w-4 h-4 text-foreground" />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/70 flex-1">
          {dim ? DIM_LABEL[dim] : question.cellKey.replace(/-/g, " ")}
        </span>
        <button type="button" onClick={onClose} className="text-foreground/40 hover:text-foreground/80" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="typo-body-lg text-foreground leading-snug">{question.question}</p>
      {category ? (
        <VaultConnectorPicker
          category={category}
          value=""
          onChange={(serviceType) => submit(serviceType)}
          onAddFromCatalog={() => useSystemStore.getState().setSidebarSection("credentials")}
        />
      ) : (
        <>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(opt)}
                  className="px-2.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 border border-card-border hover:border-primary/40 typo-body text-foreground transition-colors cursor-pointer"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(text); }}
              placeholder="Answer in your own words…"
              className="flex-1 px-3 py-2 rounded-modal bg-primary/5 border border-card-border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
              autoFocus
            />
            <button
              type="button"
              onClick={() => submit(text)}
              disabled={!text.trim()}
              className="px-3 py-2 rounded-modal bg-primary/20 hover:bg-primary/30 border border-primary/30 typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Refine composer (inline textarea used from the core actions)
// ---------------------------------------------------------------------------
interface RefineComposerProps {
  onSubmit: (v: string) => void;
  onCancel: () => void;
}
function RefineComposer({ onSubmit, onCancel }: RefineComposerProps) {
  const [text, setText] = useState("");
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="w-full flex flex-col gap-2 pointer-events-auto"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell the agent what to change…"
        rows={3}
        autoFocus
        className="w-full px-3 py-2 rounded-modal bg-primary/5 border border-primary/30 typo-body text-foreground placeholder:text-foreground/40 resize-none focus:outline-none focus:border-primary/60"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { const v = text.trim(); if (v) onSubmit(v); }}
          disabled={!text.trim()}
          className="flex-1 px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refine
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full border border-border/40 hover:border-foreground/30 typo-body text-foreground/70"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Activity strip — collapsible CLI output
// ---------------------------------------------------------------------------
function ActivityStrip({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (lines.length === 0) return null;
  const latest = lines[lines.length - 1];
  return (
    <div className="w-full max-w-xl">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-modal bg-foreground/[0.03] border border-border/20 hover:border-border/40 text-left transition-colors"
      >
        <Terminal className="w-3.5 h-3.5 text-foreground/45 shrink-0" />
        <span className="flex-1 truncate typo-caption text-foreground/55 font-mono">
          {latest}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-foreground/45 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 rounded-modal bg-black/20 border border-border/20 max-h-48 overflow-y-auto">
              {lines.slice(-100).map((line, i) => (
                <div key={i} className="typo-caption font-mono text-foreground/65 leading-snug whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit face — capability view content
// ---------------------------------------------------------------------------
function EditFace({ onAddCapability }: { onAddCapability: () => void }) {
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const hasBehaviorCore = useAgentStore((s) => s.buildBehaviorCore !== null);
  return (
    <div className="w-full max-w-3xl flex flex-col gap-5">
      {hasBehaviorCore && <BehaviorCoreEditor />}
      <section className="flex flex-col gap-3 rounded-2xl border border-border/30 bg-secondary/10 p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="typo-heading-sm text-foreground">Capabilities</h3>
            <p className="typo-body-sm text-foreground/50">Tune each capability's dimensions manually.</p>
          </div>
          <button
            type="button"
            onClick={onAddCapability}
            className="rounded-xl bg-primary/20 px-3 py-1.5 typo-body-sm font-medium text-primary hover:bg-primary/30 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </header>
        {capabilityOrder.length === 0 ? (
          <p className="typo-body-sm text-foreground/40 py-4">
            No capabilities yet. Start a build via the Glyph face — they'll appear here for manual adjustment.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {capabilityOrder.map((id) => (
              <CapabilityRow key={id} capabilityId={id} />
            ))}
          </div>
        )}
      </section>
      <SharedResourcesPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable agent name — click-to-edit
// ---------------------------------------------------------------------------
interface EditableNameProps {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
}
function EditableName({ value, onChange, editable }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  if (!editable) {
    return (
      <span className="typo-label font-bold uppercase tracking-[0.3em] text-foreground/50">
        {value || "Describe Your Agent"}
      </span>
    );
  }
  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft.trim() || value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onChange(draft.trim() || value); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className="typo-heading-sm font-bold text-foreground bg-transparent border-b border-primary/40 focus:outline-none text-center min-w-[160px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 typo-heading-sm font-bold text-foreground hover:text-primary transition-colors"
      title="Rename agent"
    >
      <span>{value || "Untitled agent"}</span>
      <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function GlyphFullLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, completeness, cellStates,
    pendingQuestions, onAnswer, agentName, onAgentNameChange,
    hasDesignResult, glyphRows,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, cliOutputLines,
    onQuickConfigChange,
  } = props;

  const [face, setFace] = useState<"glyph" | "edit">("glyph");
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refining, setRefining] = useState(false);

  const SIZE = 640;
  const isPreBuild = !isBuilding && !hasDesignResult;

  // Clamp active row when rows change
  useEffect(() => {
    if (activeRowIndex >= glyphRows.length) setActiveRowIndex(0);
  }, [glyphRows.length, activeRowIndex]);

  const activeRow = glyphRows[activeRowIndex] ?? null;

  // Pending-dim set
  const pendingDims = useMemo(() => {
    const s = new Set<GlyphDimension>();
    for (const q of pendingQuestions ?? []) {
      const d = CELL_KEY_TO_DIM[q.cellKey];
      if (d) s.add(d);
    }
    return s;
  }, [pendingQuestions]);

  // Derive all 8 petal states once per render
  const petalStates = useMemo(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = derivePetalState(dim, cellStates, pendingDims, activeRow);
    }
    return out;
  }, [cellStates, pendingDims, activeRow]);

  // Auto-focus the affected petal when a question arrives
  useEffect(() => {
    const first = pendingQuestions?.[0];
    if (first) {
      const dim = CELL_KEY_TO_DIM[first.cellKey];
      if (dim) setActiveDim(dim);
    }
  }, [pendingQuestions]);

  // Resolve the active pending question (if the active dim has one)
  const activeQuestion = useMemo(() => {
    if (!activeDim || !pendingQuestions) return null;
    return pendingQuestions.find((q) => CELL_KEY_TO_DIM[q.cellKey] === activeDim) ?? null;
  }, [activeDim, pendingQuestions]);

  // Per-dim content summary from active row
  const activeDimSummary = useMemo(() => {
    if (!activeDim || !activeRow) return [] as string[];
    const lines: string[] = [];
    const r = activeRow;
    switch (activeDim) {
      case "trigger": lines.push(...r.triggers.map((t) => t.description || t.trigger_type)); break;
      case "connector": lines.push(...r.connectors.map((c) => c.label || c.name)); break;
      case "task": if (r.summary) lines.push(r.summary); else lines.push(r.title); break;
      case "event": lines.push(...r.events.map((e) => e.description || e.event_type)); break;
      case "message": if (r.messageSummary) lines.push(r.messageSummary); break;
      case "review": if (r.reviewSummary) lines.push(r.reviewSummary); break;
      case "memory": if (r.memorySummary) lines.push(r.memorySummary); break;
      case "error": if (r.errorSummary) lines.push(r.errorSummary); break;
    }
    return lines;
  }, [activeDim, activeRow]);

  // Enter submits; Shift+Enter inserts a newline. Mirrors standard chat-input
  // conventions so users don't have to hunt for a keyboard shortcut.
  const handleLaunchKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) onLaunch();
    }
  }, [launchDisabled, onLaunch]);

  const completenessPct = Math.round(completeness);

  // --- Render ---

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-glyph-full">
      <div className="flex flex-col items-center gap-5 pb-14 pt-4">
        {/* Top bar: face toggle + phase/name */}
        <div className="w-full max-w-6xl flex items-center gap-3">
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-0.5 flex-[2]">
            <EditableName
              value={agentName}
              onChange={onAgentNameChange}
              editable={!isPreBuild}
            />
            {isBuilding && buildPhase && (
              <span className="typo-caption text-foreground/40 italic">
                {buildPhase.replace(/_/g, " ")}…
              </span>
            )}
            {isPreBuild && (
              <span className="typo-caption text-foreground/40">
                Describe what you want — the sigil reveals your agent
              </span>
            )}
          </div>
          <div className="flex-1 flex justify-end">
            {!isPreBuild && (
              <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
                <button
                  type="button"
                  onClick={() => setFace("glyph")}
                  className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
                    face === "glyph" ? "bg-primary/20 text-primary" : "text-foreground/60 hover:text-foreground"
                  }`}
                  title="Glyph face"
                >
                  <Sparkles className="w-3 h-3" /> Glyph
                </button>
                <button
                  type="button"
                  onClick={() => setFace("edit")}
                  className={`rounded-full px-3 py-1 typo-caption flex items-center gap-1.5 transition ${
                    face === "edit" ? "bg-primary/20 text-primary" : "text-foreground/60 hover:text-foreground"
                  }`}
                  title="Advanced edit"
                  data-testid="glyph-full-edit-face"
                >
                  <Settings2 className="w-3 h-3" /> Edit
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pre-build command panel — variant-switched (Workbench | Composer).
            See src/features/agents/components/matrix/commandPanel/ for the
            prototype variants. Props/callbacks are identical across variants. */}
        {/* Show panel during pre-build AND during the active build so the
            Refine step can host follow-up Q&A inline. Hide once the agent
            is in test/promote phases (panel's job is done). */}
        {(isPreBuild || isBuilding || (pendingQuestions && pendingQuestions.length > 0)) && (
          <CommandPanel
            intentText={intentText}
            onIntentChange={onIntentChange}
            onLaunch={onLaunch}
            launchDisabled={launchDisabled}
            onKeyDown={handleLaunchKey}
            onQuickConfigChange={onQuickConfigChange}
            pendingQuestions={pendingQuestions}
            onAnswer={onAnswer}
          />
        )}

        {/* Multi-capability strip */}
        {face === "glyph" && glyphRows.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <RowStrip
              rows={glyphRows}
              activeIndex={activeRowIndex}
              hoveredIndex={hoveredRowIndex}
              onSelect={setActiveRowIndex}
              onHover={setHoveredRowIndex}
              onAdd={() => setShowAdd(true)}
              canAdd={!isPreBuild && !isBuilding}
            />
            {/* Shared active-capability title — replaces per-mini truncated
                labels so the full name is legible and never piles up. */}
            <div className="min-h-[1.75rem] flex items-center justify-center">
              <AnimatePresence mode="wait">
                {(() => {
                  const shownIndex = hoveredRowIndex ?? activeRowIndex;
                  const row = glyphRows[shownIndex];
                  if (!row) return null;
                  const isHoverPreview = hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex;
                  return (
                    <motion.span
                      key={`${row.id}-${isHoverPreview}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className={`typo-heading-sm font-semibold text-center ${
                        isHoverPreview ? "text-foreground/65 italic" : "text-foreground"
                      }`}
                    >
                      {row.title}
                    </motion.span>
                  );
                })()}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Main surface */}
        {face === "edit" ? (
          <EditFace onAddCapability={() => setShowAdd(true)} />
        ) : (
          <>
            {/* Hero sigil */}
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <HeroSigil
                size={SIZE}
                petalStates={petalStates}
                hoveredDim={hoveredDim}
                activeDim={activeDim}
                onHover={setHoveredDim}
                onClick={(d) => setActiveDim((prev) => (prev === d ? null : d))}
              />
              <PetalIcons
                size={SIZE}
                petalStates={petalStates}
                hoveredDim={hoveredDim}
                activeDim={activeDim}
              />

              {/* Core content */}
              <div
                className="absolute flex flex-col items-center justify-center text-center"
                style={{ left: SIZE * 0.22, top: SIZE * 0.22, width: SIZE * 0.56, height: SIZE * 0.56 }}
              >
                <AnimatePresence mode="wait">
                  {isPreBuild ? (
                    <motion.div
                      key="pre"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex flex-col items-center gap-2 px-6"
                    >
                      <motion.div
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <Sparkles className="w-8 h-8 text-primary/60" />
                      </motion.div>
                      <span className="typo-label uppercase tracking-[0.22em] text-foreground/45">
                        Awaiting Intent
                      </span>
                      <span className="typo-caption text-foreground/35 max-w-[220px] leading-snug">
                        Describe your agent above — its sigil will form here.
                      </span>
                    </motion.div>
                  ) : refining ? (
                    <motion.div
                      key="refine"
                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-2 w-full px-6"
                    >
                      <RefineComposer
                        onSubmit={(v) => { setRefining(false); void onRefine?.(v); }}
                        onCancel={() => setRefining(false)}
                      />
                    </motion.div>
                  ) : isBuilding ? (
                    <motion.div
                      key="building"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-1 pointer-events-auto"
                    >
                      <div className="typo-hero font-bold text-foreground tabular-nums tracking-tight">
                        {completenessPct}
                        <span className="typo-heading-sm text-foreground/40 ml-0.5">%</span>
                      </div>
                      <div className="flex items-center gap-1.5 typo-caption text-foreground/60 uppercase tracking-[0.18em]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {pendingQuestions && pendingQuestions.length > 0 ? "Needs your input" : "Weaving"}
                      </div>
                    </motion.div>
                  ) : buildPhase === "testing" ? (
                    <motion.div
                      key="testing"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-2 w-full px-6"
                    >
                      <Loader2 className="w-6 h-6 text-primary/70 animate-spin" />
                      <span className="typo-label uppercase tracking-[0.2em] text-foreground/60">Running Tests</span>
                      {testOutputLines && testOutputLines.length > 0 && (
                        <div className="mt-1 w-full max-h-20 overflow-y-auto typo-caption font-mono text-foreground/50 text-left">
                          {testOutputLines.slice(-4).map((l, i) => (
                            <div key={i} className="truncate">{l}</div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ) : buildPhase === "test_complete" ? (
                    <motion.div
                      key="test-complete"
                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center gap-2 pointer-events-auto"
                    >
                      {testPassed ? (
                        <>
                          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                          <span className="typo-label uppercase tracking-[0.2em] text-emerald-400">Tests Passed</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-8 h-8 text-orange-400" />
                          <span className="typo-label uppercase tracking-[0.2em] text-orange-400">Tests Failed</span>
                          {testError && (
                            <p className="typo-caption text-foreground/60 max-w-[240px] line-clamp-2">{testError}</p>
                          )}
                        </>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap justify-center">
                        <button
                          type="button"
                          onClick={testPassed ? onPromote : () => onPromoteForce?.()}
                          className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
                        >
                          <Rocket className="w-3.5 h-3.5" />
                          {testPassed ? "Promote" : "Promote Anyway"}
                        </button>
                        {onRefine && (
                          <button
                            type="button"
                            onClick={() => setRefining(true)}
                            className="px-3 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-body text-foreground/80 cursor-pointer flex items-center gap-1.5"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Refine
                          </button>
                        )}
                        {onRejectTest && (
                          <button
                            type="button"
                            onClick={onRejectTest}
                            className="px-2.5 py-1.5 rounded-full text-foreground/55 hover:text-foreground typo-caption cursor-pointer flex items-center gap-1"
                          >
                            <ThumbsDown className="w-3 h-3" />
                            Reject
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ) : buildPhase === "promoted" ? (
                    <motion.div
                      key="promoted"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center gap-2 pointer-events-auto"
                    >
                      <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                      <span className="typo-heading-sm text-foreground">Agent Promoted</span>
                      <button
                        type="button"
                        onClick={onViewAgent}
                        className="px-3 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
                      >
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </motion.div>
                  ) : hasDesignResult ? (
                    <motion.div
                      key="draft"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center gap-2 pointer-events-auto"
                    >
                      <span className="typo-label uppercase tracking-[0.2em] text-foreground/60">Draft Ready</span>
                      <span className="typo-heading-sm text-foreground">{completenessPct}% complete</span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-center">
                        <button
                          type="button"
                          onClick={() => void onStartTest()}
                          className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Run Test
                        </button>
                        {onRefine && (
                          <button
                            type="button"
                            onClick={() => setRefining(true)}
                            className="px-2.5 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/75 cursor-pointer flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Refine
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              {/* Hovered dim label */}
              <AnimatePresence>
                {hoveredDim && !activeDim && (
                  <motion.span
                    key={hoveredDim}
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute left-1/2 -translate-x-1/2 px-3 py-1 rounded-full typo-label font-bold uppercase tracking-[0.18em] pointer-events-none"
                    style={{
                      top: -14,
                      background: `${DIM_META[hoveredDim].color}1f`,
                      border: `1px solid ${DIM_META[hoveredDim].color}55`,
                      color: DIM_META[hoveredDim].color,
                      boxShadow: `0 0 12px ${DIM_META[hoveredDim].color}44`,
                    }}
                  >
                    {DIM_LABEL[hoveredDim]}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Active-dim panel: Q&A card OR summary */}
            <AnimatePresence>
              {activeDim && (
                <motion.div
                  key={activeDim}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.25 }}
                  className="w-full max-w-xl"
                >
                  {activeQuestion ? (
                    <AnswerCard
                      question={activeQuestion}
                      onAnswer={onAnswer}
                      onClose={() => setActiveDim(null)}
                    />
                  ) : (
                    <div
                      className="rounded-modal bg-card-bg border border-card-border p-4 shadow-elevation-2 flex flex-col gap-2"
                      style={{ boxShadow: `0 0 18px ${DIM_META[activeDim].color}22` }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md flex items-center justify-center"
                          style={{ background: `${DIM_META[activeDim].color}33` }}>
                          {(() => { const Ic = DIM_META[activeDim].icon; return <Ic className="w-3.5 h-3.5" style={{ color: "#fff" }} />; })()}
                        </span>
                        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/70 flex-1">
                          {DIM_LABEL[activeDim]}
                        </span>
                        <button type="button" onClick={() => setActiveDim(null)} className="text-foreground/40 hover:text-foreground/80" aria-label="Close">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {activeDimSummary.length > 0 ? (
                        <ul className="flex flex-col gap-1">
                          {activeDimSummary.map((line, i) => (
                            <li key={i} className="typo-body text-foreground/85 leading-snug">· {line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="typo-body text-foreground/45 italic">
                          {isPreBuild
                            ? "This leaf will fill in once you describe what you want to build."
                            : "Not yet populated. Use Edit face to set it manually."}
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Legend */}
            {!activeDim && (
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 max-w-2xl">
                {GLYPH_DIMENSIONS.map((dim) => {
                  const meta = DIM_META[dim];
                  const state = petalStates[dim];
                  return (
                    <button
                      key={dim}
                      type="button"
                      onClick={() => setActiveDim(dim)}
                      onMouseEnter={() => setHoveredDim(dim)}
                      onMouseLeave={() => setHoveredDim(null)}
                      className="flex items-center gap-1.5 typo-caption text-foreground/55 hover:text-foreground cursor-pointer transition-colors"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: meta.color,
                          opacity: state === "idle" ? 0.25 : state === "filling" ? 0.5 : 1,
                          boxShadow: state === "pending" ? `0 0 8px ${meta.color}` : undefined,
                        }}
                      />
                      {DIM_LABEL[dim]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Activity strip */}
            {isBuilding && cliOutputLines && cliOutputLines.length > 0 && (
              <ActivityStrip lines={cliOutputLines} />
            )}
          </>
        )}

        {buildError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
            <AlertCircle className="w-4 h-4" />
            <span>{buildError}</span>
          </div>
        )}
      </div>

      <CapabilityAddModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
