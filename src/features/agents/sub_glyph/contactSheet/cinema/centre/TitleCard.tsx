/** TitleCard — the crowned persona as the draft's title card: its silhouette,
 *  its name (Enter to rename), its role and mission, and a film strip of the
 *  capabilities it was cast with. The verdict stamps across it. */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GlyphRow } from "@/features/shared/glyph";
import { CinemaSilhouette } from "@/features/agents/sub_glyph/cinemaShared";
import { useAgentStore } from "@/stores/agentStore";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Candidate } from "../cinemaMotion";
import { useTimedReveal } from "../cinemaMotion";
import { COPY } from "../copy";

interface TitleCardProps {
  winner: Candidate;
  agentName: string;
  onAgentNameChange: (v: string) => void;
  rows: GlyphRow[];
  stamp: "passed" | "failed" | null;
  /** Short centre cell: drop the portrait and the mission (the What frame holds it). */
  tight?: boolean;
  children?: React.ReactNode;
}

function NameField({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={COPY.agent}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim()) onChange(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(name); setEditing(false); }
        }}
        className="typo-title-lg text-center bg-transparent outline-none border-b border-dashed border-[color:var(--cinema-accent)] text-foreground max-w-[400px]"
      />
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(name); setEditing(true); }} className="typo-title-lg text-foreground rounded-interactive px-1.5 hover:bg-foreground/5 truncate max-w-[420px]">
      {name || COPY.yourAgent}
    </button>
  );
}

export function TitleCard({ winner, agentName, onAgentNameChange, rows, stamp, tight = false, children }: TitleCardProps) {
  const core = useAgentStore((s) => s.buildBehaviorCore);
  const titles = rows.map((r) => r.title);
  const shown = useTimedReveal(titles, 180);
  const accent = winner.color;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center gap-2 text-center">
      {!tight && <span className="grid place-items-center rounded-full w-10 h-10" style={{ background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.3)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(accent, 0.45)}` }}>
        <CinemaSilhouette form={winner.form} color={accent} size={28} />
      </span>}
      {core?.identity?.role && <span className="typo-caption font-mono uppercase tracking-[0.1em]" style={{ color: accent }}>{core.identity.role}</span>}
      <NameField name={agentName} onChange={onAgentNameChange} />
      {core?.mission && !tight && <p className="typo-body text-foreground max-w-[440px] line-clamp-2">{core.mission}</p>}

      {titles.length > 0 && (
        <div className="flex gap-2 justify-center px-2.5 py-1.5 rounded-[6px] max-w-full overflow-hidden" style={{ background: "color-mix(in srgb, #000 28%, transparent)", borderTop: "3px dotted color-mix(in srgb, var(--foreground) 16%, transparent)", borderBottom: "3px dotted color-mix(in srgb, var(--foreground) 16%, transparent)" }}>
          <AnimatePresence initial={false}>
            {shown.slice(0, 4).map((t, i) => (
              <motion.span
                key={t}
                initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className="w-[104px] flex flex-col gap-1 items-center"
              >
                <span className="w-full h-7 rounded-[3px] grid place-items-center font-mono typo-caption" style={{ border: `1px solid ${colorWithAlpha(accent, 0.5)}`, background: `linear-gradient(135deg, ${colorWithAlpha(accent, 0.2)}, transparent)` }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="typo-caption text-foreground line-clamp-1 w-full">{t}</span>
              </motion.span>
            ))}
          </AnimatePresence>
          {titles.length > 4 && <span className="self-center typo-caption text-foreground">+{titles.length - 4}</span>}
        </div>
      )}

      {children}

      <AnimatePresence>
        {stamp && (
          <motion.span
            key={stamp}
            aria-hidden
            className="absolute top-3 right-2 font-mono typo-label font-bold tracking-[0.14em] px-2 py-0.5 rounded-[3px] border-2 pointer-events-none"
            style={{ color: stamp === "passed" ? "#34d399" : "#f87171", borderColor: "currentColor" }}
            initial={{ opacity: 0, scale: 2, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            transition={{ type: "spring", stiffness: 420, damping: 16 }}
          >
            {stamp === "passed" ? COPY.passed : COPY.failed}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
