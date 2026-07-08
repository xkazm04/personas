/** CoreCompass — spatial variant.
 *
 *  Mental model: a temperament compass. A 2-D pad maps Risk (x: cautious→bold)
 *  against Speed (y: thorough→fast). Every archetype is plotted at its own
 *  (risk, speed); click one to snap there, or drag the crosshair anywhere to set
 *  the temperament by hand — the nearest archetype lights up as you move. Model
 *  and Memory ride alongside as the two discrete choices the pad can't express.
 */
import { useRef, useState } from "react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Archetype } from "@/api/archetypes";
import { coreIcon, ModelSegment, MemoryPicker, ACCENT } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

function readCore(a: Archetype, key: string): number {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.[key];
  return typeof v === "number" ? v : 0.5;
}

export function CoreCompass({ core }: { core: PersonaCore }) {
  const padRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const setFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const risk = clamp((clientX - r.left) / r.width);
    const speed = clamp(1 - (clientY - r.top) / r.height); // invert: top = fast
    core.setRisk(risk);
    core.setSpeed(speed);
  };

  // Nearest archetype to the current point — highlighted, not auto-applied.
  const nearest = core.archetypes.reduce<{ a: Archetype; d: number } | null>((best, a) => {
    const d = Math.hypot(readCore(a, "riskTolerance") - core.state.risk, readCore(a, "speedVsQuality") - core.state.speed);
    return !best || d < best.d ? { a, d } : best;
  }, null);

  return (
    <div className="flex gap-5">
      {/* Pad */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center justify-between typo-label uppercase tracking-wider text-foreground">
          <span>Thorough ↑ Fast</span>
          <span>Cautious → Bold</span>
        </div>
        <div
          ref={padRef}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging(true); setFromPointer(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (dragging) setFromPointer(e.clientX, e.clientY); }}
          onPointerUp={() => setDragging(false)}
          className="relative aspect-square w-full rounded-card border border-card-border bg-secondary/20 overflow-hidden cursor-crosshair select-none"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "25% 25%" }}
        >
          {/* archetype points */}
          {core.archetypes.map((a) => {
            const x = readCore(a, "riskTolerance");
            const y = readCore(a, "speedVsQuality");
            const Icon = coreIcon(a.icon);
            const isNearest = nearest?.a.id === a.id;
            const isPicked = core.state.archetypeId === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => core.applyPreset(a)}
                title={a.name}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-transform cursor-pointer hover:scale-110"
                style={{
                  left: `${x * 100}%`, top: `${(1 - y) * 100}%`,
                  width: isNearest ? 30 : 24, height: isNearest ? 30 : 24,
                  background: colorWithAlpha(a.color, isPicked ? 0.9 : 0.18),
                  border: `1.5px solid ${colorWithAlpha(a.color, isNearest ? 0.9 : 0.5)}`,
                  boxShadow: isNearest ? `0 0 12px ${colorWithAlpha(a.color, 0.5)}` : undefined,
                }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: isPicked ? "#0b0b0f" : a.color }} />
              </button>
            );
          })}
          {/* crosshair */}
          <div
            className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 pointer-events-none"
            style={{ left: `${core.state.risk * 100}%`, top: `${(1 - core.state.speed) * 100}%`, borderColor: ACCENT, boxShadow: `0 0 0 3px ${colorWithAlpha(ACCENT, 0.2)}` }}
          />
        </div>
        <p className="typo-caption px-0.5">
          {nearest ? `Closest to ${nearest.a.name}${core.state.archetypeId === nearest.a.id ? "" : " — click to snap"}` : "Drag to set temperament"}
        </p>
      </div>

      {/* Discrete choices */}
      <div className="w-[240px] shrink-0 flex flex-col gap-4 pl-5 border-l border-card-border/50">
        <ModelSegment value={core.state.model} color={ACCENT} onChange={core.setModel} />
        <MemoryPicker strategies={core.memoryStrategies} value={core.state.memoryId} color="#c084fc" onChange={core.setMemory} />
      </div>
    </div>
  );
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
