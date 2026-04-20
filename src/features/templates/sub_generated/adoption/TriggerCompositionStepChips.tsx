/**
 * Variant A — "Chip Grid"
 *
 * One card per enabled use case. Preset chips along the bottom
 * (Daily / Weekly / Hourly / Event / Custom). Time-of-day + weekday
 * pickers appear inline when Daily or Weekly is chosen. Event-source
 * dropdown appears inline when Event is chosen.
 *
 * Dense layout: everything visible at once without scroll. Each UC
 * card is self-contained — no mode switching.
 */

import { useMemo, useState, type ElementType } from "react";
import { motion } from "framer-motion";
import { Clock, Calendar, Zap, Activity, Settings2 } from "lucide-react";

export interface UseCase {
  id: string;
  title: string;
  capability_summary: string;
  suggested_trigger: {
    trigger_type: "schedule" | "polling" | "manual" | "event_listener" | "webhook";
    config: { cron?: string; event_type?: string; timezone?: string };
    description: string;
  };
  emits?: { event_type: string; description: string }[];
}

export interface TriggerCompositionStepChipsProps {
  personaGoal?: string;
  personaName: string;
  useCases: UseCase[];
  /** Persona-level composition from the template. */
  triggerComposition: "shared" | "per_use_case";
  onChange?: (triggers: Record<string, TriggerSelection>) => void;
}

export interface TriggerSelection {
  preset: "daily" | "weekly" | "hourly" | "event" | "custom";
  hourOfDay?: number;
  weekday?: number;
  eventType?: string;
  customCron?: string;
}

type PresetKey = TriggerSelection["preset"];

const PRESETS: { key: PresetKey; label: string; icon: ElementType }[] = [
  { key: "daily", label: "Daily", icon: Calendar },
  { key: "weekly", label: "Weekly", icon: Calendar },
  { key: "hourly", label: "Hourly", icon: Clock },
  { key: "event", label: "Event", icon: Zap },
  { key: "custom", label: "Custom", icon: Settings2 },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function inferInitial(uc: UseCase): TriggerSelection {
  const t = uc.suggested_trigger;
  if (t.trigger_type === "event_listener") {
    return { preset: "event", eventType: t.config.event_type };
  }
  if (t.trigger_type === "manual") {
    return { preset: "custom", customCron: "" };
  }
  const cron = t.config.cron ?? "0 9 * * *";
  const parts = cron.split(" ");
  if (parts.length === 5) {
    const [, hour, , , weekday] = parts;
    if (weekday !== "*") {
      return { preset: "weekly", hourOfDay: parseInt(hour, 10) || 9, weekday: parseInt(weekday, 10) || 1 };
    }
    if (hour === "*") return { preset: "hourly" };
    return { preset: "daily", hourOfDay: parseInt(hour, 10) || 9 };
  }
  return { preset: "custom", customCron: cron };
}

export default function TriggerCompositionStepChips({
  personaGoal,
  personaName,
  useCases,
  triggerComposition,
  onChange,
}: TriggerCompositionStepChipsProps) {
  const [selections, setSelections] = useState<Record<string, TriggerSelection>>(() => {
    const out: Record<string, TriggerSelection> = {};
    for (const uc of useCases) out[uc.id] = inferInitial(uc);
    return out;
  });

  const sharedFirst = useMemo(() => {
    if (triggerComposition !== "shared") return null;
    const first = useCases[0];
    return first ? selections[first.id] : null;
  }, [triggerComposition, useCases, selections]);

  // Emit event options — every UC's emit events become candidates for cross-UC triggering.
  const eventOptions = useMemo(() => {
    const out: string[] = [];
    for (const uc of useCases) {
      for (const e of uc.emits ?? []) out.push(e.event_type);
    }
    return out;
  }, [useCases]);

  const updateSelection = (ucId: string, patch: Partial<TriggerSelection>) => {
    setSelections((prev) => {
      const next = { ...prev };
      if (triggerComposition === "shared") {
        for (const uc of useCases) {
          next[uc.id] = { ...(prev[uc.id] ?? inferInitial(uc)), ...patch };
        }
      } else {
        next[ucId] = { ...(prev[ucId] ?? inferInitial(useCases.find((u) => u.id === ucId)!)), ...patch };
      }
      onChange?.(next);
      return next;
    });
  };

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col overflow-hidden">
      {/* Top bar — persona header with goal as subtitle + composition badge */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div className="flex flex-col">
          <div className="text-base font-semibold text-foreground flex items-center gap-2">
            {personaName}
            <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-dark">
              <Activity className="h-3 w-3" />
              {triggerComposition === "shared" ? "shared trigger" : "per-UC triggers"}
            </span>
          </div>
          {personaGoal ? (
            <div className="text-xs text-muted-dark mt-0.5 max-w-2xl">{personaGoal}</div>
          ) : null}
        </div>
        <div className="text-[10px] font-mono text-muted-dark">
          {useCases.length} capabilit{useCases.length === 1 ? "y" : "ies"}
        </div>
      </div>

      {/* Shared-mode notice */}
      {triggerComposition === "shared" && (
        <div className="px-6 py-2 bg-cyan-500/[0.03] border-b border-cyan-500/[0.08] text-[11px] text-cyan-400/80 font-mono">
          All capabilities fire on the same tick. Changing any card applies to all.
        </div>
      )}

      {/* Per-UC grid */}
      <div className="flex-1 overflow-auto p-4 grid gap-3 grid-cols-1 md:grid-cols-2 auto-rows-min">
        {useCases.map((uc, idx) => {
          const sel = triggerComposition === "shared" ? (sharedFirst ?? inferInitial(uc)) : (selections[uc.id] ?? inferInitial(uc));
          const isEventLock = uc.suggested_trigger.trigger_type === "event_listener";
          return (
            <motion.div
              key={uc.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-cyan-400/80">{uc.id}</span>
                  {isEventLock && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/[0.1] px-1.5 py-0.5 text-[9px] font-mono uppercase text-purple-400">
                      event-driven
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-foreground mt-0.5">{uc.title}</div>
                <div className="text-[11px] text-muted-dark mt-0.5 line-clamp-2">{uc.capability_summary}</div>
              </div>

              {/* Preset chips */}
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const Icon = p.icon;
                  const active = sel.preset === p.key;
                  const disabled = isEventLock && p.key !== "event";
                  return (
                    <button
                      key={p.key}
                      disabled={disabled}
                      onClick={() => updateSelection(uc.id, { preset: p.key })}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                        active
                          ? "bg-cyan-500/[0.15] text-cyan-300 ring-1 ring-cyan-500/[0.3]"
                          : disabled
                            ? "bg-white/[0.02] text-muted-dark/40 cursor-not-allowed"
                            : "bg-white/[0.04] text-muted-dark hover:bg-white/[0.08] hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Contextual picker */}
              {sel.preset === "daily" && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-dark">at</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={sel.hourOfDay ?? 9}
                    onChange={(e) => updateSelection(uc.id, { hourOfDay: parseInt(e.target.value, 10) || 0 })}
                    className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
                  />
                  <span className="text-muted-dark font-mono">:00</span>
                </div>
              )}
              {sel.preset === "weekly" && (
                <div className="flex items-center gap-2 text-[11px] flex-wrap">
                  <span className="text-muted-dark">on</span>
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => updateSelection(uc.id, { weekday: i })}
                      className={`rounded-md px-1.5 py-0.5 font-mono ${
                        sel.weekday === i ? "bg-cyan-500/[0.15] text-cyan-300" : "bg-white/[0.04] text-muted-dark hover:text-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                  <span className="text-muted-dark ml-1">at</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={sel.hourOfDay ?? 9}
                    onChange={(e) => updateSelection(uc.id, { hourOfDay: parseInt(e.target.value, 10) || 0 })}
                    className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
                  />
                  <span className="text-muted-dark font-mono">:00</span>
                </div>
              )}
              {sel.preset === "event" && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-dark">listen for</span>
                  <select
                    value={sel.eventType ?? eventOptions[0] ?? ""}
                    onChange={(e) => updateSelection(uc.id, { eventType: e.target.value })}
                    className="flex-1 min-w-0 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
                  >
                    {eventOptions.length === 0 && <option value="">(no events defined)</option>}
                    {eventOptions.map((ev) => (
                      <option key={ev} value={ev}>
                        {ev}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {sel.preset === "custom" && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-dark font-mono">cron</span>
                  <input
                    type="text"
                    value={sel.customCron ?? ""}
                    placeholder="0 9 * * 1"
                    onChange={(e) => updateSelection(uc.id, { customCron: e.target.value })}
                    className="flex-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
