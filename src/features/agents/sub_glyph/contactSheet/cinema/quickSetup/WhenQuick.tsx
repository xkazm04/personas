/** WhenQuick - the When page's inline setup: one-click run rhythms (manual,
 *  daily, weekdays, weekly, monthly) and, once a rhythm is set, its time and
 *  day right under it. Everything writes the same QuickConfigState fields the
 *  schedule picker writes (frequency / days / monthDay / time), so the build
 *  prompt serialises it and the frame develops identically. "Weekdays" is a
 *  weekly rhythm on Monday to Friday, not a new frequency. */
import { Minus, Plus } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { DIM_META } from "@/features/shared/glyph";
import { INPUT_CLS, type Frequency } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { ComposeQuickSetup } from "@/features/agents/sub_glyph/useComposeConfig";
import { DAY_OPTIONS } from "@/features/agents/sub_glyph/commandPanel/composer/ComposerScheduleDetailForm";
import { ChoicePill } from "./ChoicePill";
import { MoreButton } from "./MoreButton";
import { QS } from "./copy";

type Preset = "manual" | "daily" | "weekdays" | "weekly" | "monthly";
const PRESETS: Preset[] = ["manual", "daily", "weekdays", "weekly", "monthly"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

function presetOf(frequency: Frequency | null, days: string[]): Preset {
  if (!frequency) return "manual";
  if (frequency === "weekly") {
    const set = new Set(days);
    return set.size === 5 && WEEKDAYS.every((d) => set.has(d)) ? "weekdays" : "weekly";
  }
  return frequency;
}

export function WhenQuick({ quick, onMore }: { quick: ComposeQuickSetup; onMore: () => void }) {
  const color = DIM_META.trigger.color;
  const { frequency, days, monthDay, time } = quick.config;
  const preset = presetOf(frequency, days);
  const set = (patch: Partial<{ frequency: Frequency | null; days: string[]; monthDay: number; time: string }>) =>
    quick.setSchedule({ frequency, days, monthDay, time, ...patch });

  const pick = (p: Preset) => {
    if (p === "manual") set({ frequency: null });
    else if (p === "daily") set({ frequency: "daily" });
    else if (p === "weekdays") set({ frequency: "weekly", days: WEEKDAYS });
    else if (p === "weekly") set({ frequency: "weekly", days: preset === "weekly" ? days : ["mon"] });
    else set({ frequency: "monthly" });
  };

  const toggleDay = (d: string) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length > 0) set({ days: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={QS.when.presets} className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <ChoicePill key={p} on={preset === p} color={color} onClick={() => pick(p)}>{QS.when[p]}</ChoicePill>
        ))}
      </div>

      {preset === "manual" ? (
        <p className="typo-body text-foreground">{QS.when.manualNote}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 typo-body text-foreground">
            <span className="w-24 shrink-0">{QS.when.at}</span>
            <input type="time" value={time} onChange={(e) => e.target.value && set({ time: e.target.value })} className={`${INPUT_CLS} w-36`} />
          </label>
          {preset === "weekly" && (
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 typo-body text-foreground">{QS.when.on}</span>
              <div role="group" aria-label={QS.when.on} className="flex flex-wrap gap-1.5">
                {DAY_OPTIONS.map((d) => (
                  <ChoicePill key={d.id} on={days.includes(d.id)} color={color} onClick={() => toggleDay(d.id)} ariaLabel={d.long}>
                    {d.short}
                  </ChoicePill>
                ))}
              </div>
            </div>
          )}
          {preset === "monthly" && (
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 typo-body text-foreground">{QS.when.dayOfMonth}</span>
              <Button variant="secondary" size="icon-sm" aria-label={QS.when.earlier} disabled={monthDay <= 1} onClick={() => set({ monthDay: monthDay - 1 })}>
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <span className="typo-body text-foreground tabular-nums w-8 text-center" aria-live="polite">{monthDay}</span>
              <Button variant="secondary" size="icon-sm" aria-label={QS.when.later} disabled={monthDay >= 28} onClick={() => set({ monthDay: monthDay + 1 })}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
      <MoreButton label={QS.more} onClick={onMore} />
    </div>
  );
}
