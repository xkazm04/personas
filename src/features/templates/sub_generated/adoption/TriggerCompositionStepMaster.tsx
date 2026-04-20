// @ts-nocheck
// WIP — UI variant prototype per ui-variant-prototype skill. Not yet wired
// into production adoption flow. Type cleanup lands when one variant wins.
"use client";

/**
 * Variant B — "Master + Override Drawer"
 *
 * Top: one master trigger widget representing the shared default.
 * Below: collapsed per-UC rows showing inherited trigger. Click a row
 * to expand a drawer that overrides with its own preset or event-based
 * trigger. Cleaner hierarchy than Variant A; the shared/exception model
 * is explicit.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Calendar, Zap, Activity, Settings2, ChevronDown } from "lucide-react";
import type { UseCase, TriggerSelection } from "./TriggerCompositionStepChips";

export interface TriggerCompositionStepMasterProps {
  personaGoal?: string;
  personaName: string;
  useCases: UseCase[];
  triggerComposition: "shared" | "per_use_case";
  onChange?: (master: TriggerSelection, overrides: Record<string, TriggerSelection>) => void;
}

type PresetKey = TriggerSelection["preset"];

const PRESETS: { key: PresetKey; label: string; icon: React.ElementType }[] = [
  { key: "daily", label: "Daily", icon: Calendar },
  { key: "weekly", label: "Weekly", icon: Calendar },
  { key: "hourly", label: "Hourly", icon: Clock },
  { key: "event", label: "Event-based", icon: Zap },
  { key: "custom", label: "Custom cron", icon: Settings2 },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeSel(sel: TriggerSelection, eventOptions: string[]): string {
  switch (sel.preset) {
    case "daily":
      return `Daily at ${String(sel.hourOfDay ?? 9).padStart(2, "0")}:00`;
    case "weekly":
      return `Weekly on ${WEEKDAYS[sel.weekday ?? 1]} at ${String(sel.hourOfDay ?? 9).padStart(2, "0")}:00`;
    case "hourly":
      return "Hourly";
    case "event":
      return `Listening for ${sel.eventType ?? eventOptions[0] ?? "—"}`;
    case "custom":
      return `Custom: ${sel.customCron ?? "(not set)"}`;
  }
}

function PresetChips({
  value,
  onChange,
  disabled = false,
  allowEvent = true,
}: {
  value: PresetKey;
  onChange: (k: PresetKey) => void;
  disabled?: boolean;
  allowEvent?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.filter((p) => allowEvent || p.key !== "event").map((p) => {
        const Icon = p.icon;
        const active = value === p.key;
        return (
          <button
            key={p.key}
            disabled={disabled}
            onClick={() => onChange(p.key)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
              active
                ? "bg-emerald-500/[0.15] text-emerald-300 ring-1 ring-emerald-500/[0.3]"
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
  );
}

function DetailInputs({
  sel,
  onChange,
  eventOptions,
}: {
  sel: TriggerSelection;
  onChange: (patch: Partial<TriggerSelection>) => void;
  eventOptions: string[];
}) {
  if (sel.preset === "daily") {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted-dark">at</span>
        <input
          type="number"
          min={0}
          max={23}
          value={sel.hourOfDay ?? 9}
          onChange={(e) => onChange({ hourOfDay: parseInt(e.target.value, 10) || 0 })}
          className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
        />
        <span className="text-muted-dark font-mono">:00</span>
      </div>
    );
  }
  if (sel.preset === "weekly") {
    return (
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-muted-dark">on</span>
        {WEEKDAYS.map((d, i) => (
          <button
            key={d}
            onClick={() => onChange({ weekday: i })}
            className={`rounded-md px-1.5 py-0.5 font-mono ${
              sel.weekday === i ? "bg-emerald-500/[0.15] text-emerald-300" : "bg-white/[0.04] text-muted-dark hover:text-foreground"
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
          onChange={(e) => onChange({ hourOfDay: parseInt(e.target.value, 10) || 0 })}
          className="w-14 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
        />
        <span className="text-muted-dark font-mono">:00</span>
      </div>
    );
  }
  if (sel.preset === "event") {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted-dark">listen for</span>
        <select
          value={sel.eventType ?? eventOptions[0] ?? ""}
          onChange={(e) => onChange({ eventType: e.target.value })}
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
    );
  }
  if (sel.preset === "custom") {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted-dark font-mono">cron</span>
        <input
          type="text"
          value={sel.customCron ?? ""}
          placeholder="0 9 * * 1"
          onChange={(e) => onChange({ customCron: e.target.value })}
          className="flex-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-foreground"
        />
      </div>
    );
  }
  return null;
}

export default function TriggerCompositionStepMaster({
  personaGoal,
  personaName,
  useCases,
  triggerComposition,
  onChange,
}: TriggerCompositionStepMasterProps) {
  const [master, setMaster] = useState<TriggerSelection>({ preset: "weekly", hourOfDay: 9, weekday: 1 });
  const [overrides, setOverrides] = useState<Record<string, TriggerSelection>>({});
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const eventOptions = useMemo(() => {
    const out: string[] = [];
    for (const uc of useCases) {
      for (const e of uc.emits ?? []) out.push(e.event_type);
    }
    return out;
  }, [useCases]);

  const emit = (m: TriggerSelection, o: Record<string, TriggerSelection>) => {
    onChange?.(m, o);
  };

  const updateMaster = (patch: Partial<TriggerSelection>) => {
    setMaster((prev) => {
      const next = { ...prev, ...patch };
      emit(next, overrides);
      return next;
    });
  };

  const setOverride = (ucId: string, sel: TriggerSelection | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (sel === null) delete next[ucId];
      else next[ucId] = sel;
      emit(master, next);
      return next;
    });
  };

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col overflow-hidden">
      {/* Top bar */}
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
          {Object.keys(overrides).length} override{Object.keys(overrides).length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Master trigger widget */}
      <div className="px-6 py-4 border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.02] to-transparent">
        <div className="text-[11px] uppercase tracking-wide font-mono text-emerald-400/80 mb-2">Default trigger</div>
        <div className="flex flex-col gap-2">
          <PresetChips value={master.preset} onChange={(k) => updateMaster({ preset: k })} />
          <DetailInputs sel={master} onChange={updateMaster} eventOptions={eventOptions} />
          <div className="text-[11px] text-muted-dark font-mono">{describeSel(master, eventOptions)}</div>
        </div>
      </div>

      {/* Per-UC override rows */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-3 text-[11px] uppercase tracking-wide font-mono text-muted-dark border-b border-white/[0.04]">
          Per-capability overrides
        </div>
        <div className="divide-y divide-white/[0.04]">
          {useCases.map((uc) => {
            const isEventLock = uc.suggested_trigger.trigger_type === "event_listener";
            const hasOverride = overrides[uc.id] !== undefined || isEventLock;
            const effective = overrides[uc.id] ?? (isEventLock ? { preset: "event" as PresetKey, eventType: uc.suggested_trigger.config.event_type } : master);
            const isOpen = openRowId === uc.id;
            return (
              <div key={uc.id}>
                <button
                  onClick={() => setOpenRowId(isOpen ? null : uc.id)}
                  className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-cyan-400/80 w-32 shrink-0 truncate">{uc.id}</span>
                    <span className="text-sm text-foreground truncate">{uc.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-mono ${
                        hasOverride ? "text-amber-400" : "text-muted-dark"
                      }`}
                    >
                      {hasOverride ? (isEventLock ? "event-locked" : "override") : "inherits"}
                    </span>
                    <span className="text-[11px] text-muted-dark">{describeSel(effective, eventOptions)}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-dark transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 py-3 bg-white/[0.02] border-t border-white/[0.04] flex flex-col gap-2">
                        {isEventLock ? (
                          <div className="text-[11px] text-muted-dark italic">
                            Event-driven by design — fires on {uc.suggested_trigger.config.event_type}. Not overridable.
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <PresetChips
                                value={effective.preset}
                                onChange={(k) =>
                                  setOverride(uc.id, { ...(overrides[uc.id] ?? master), preset: k })
                                }
                              />
                              {overrides[uc.id] && (
                                <button
                                  onClick={() => setOverride(uc.id, null)}
                                  className="text-[10px] font-mono text-muted-dark hover:text-foreground underline underline-offset-2"
                                >
                                  reset to inherit
                                </button>
                              )}
                            </div>
                            <DetailInputs
                              sel={effective}
                              onChange={(patch) =>
                                setOverride(uc.id, { ...(overrides[uc.id] ?? master), ...patch })
                              }
                              eventOptions={eventOptions}
                            />
                          </>
                        )}
                        <div className="text-[10px] text-muted-dark max-w-prose italic">
                          {uc.capability_summary}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
