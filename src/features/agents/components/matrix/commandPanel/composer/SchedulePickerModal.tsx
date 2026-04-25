/**
 * Schedule picker modal — opens from the Composer's "When" row.
 *
 * Two-step flow:
 *   1. Rhythm cards — One-off / Daily / Weekly / Monthly. Big, visual,
 *      one click picks. "One-off" clears the schedule.
 *   2. Detail — time + days (weekly) / day-of-month (monthly). A live
 *      preview at the top spells the schedule in human English, so the
 *      user sees the result of each click instantly.
 *
 * Animates between steps with AnimatePresence (slide + fade). ⌘+Enter
 * applies; Esc closes (handled by PickerShell).
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Calendar, CalendarDays, CalendarRange, ChevronLeft } from "lucide-react";
import type { Frequency } from "@/features/agents/components/matrix/quickConfigTypes";
import { PickerShell } from "./PickerShell";

const DAY_OPTIONS: Array<{ id: string; short: string; long: string }> = [
  { id: "mon", short: "Mon", long: "Monday" },
  { id: "tue", short: "Tue", long: "Tuesday" },
  { id: "wed", short: "Wed", long: "Wednesday" },
  { id: "thu", short: "Thu", long: "Thursday" },
  { id: "fri", short: "Fri", long: "Friday" },
  { id: "sat", short: "Sat", long: "Saturday" },
  { id: "sun", short: "Sun", long: "Sunday" },
];

type Rhythm = "once" | "daily" | "weekly" | "monthly";

interface RhythmCardProps {
  rhythm: Rhythm;
  icon: React.ReactNode;
  title: string;
  caption: string;
  active: boolean;
  onSelect: () => void;
}
function RhythmCard({ icon, title, caption, active, onSelect }: RhythmCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col items-start gap-2 p-4 rounded-card border transition-all text-left ${
        active
          ? "border-primary/60 bg-primary/10 shadow-elevation-2"
          : "border-border/30 bg-foreground/[0.02] hover:border-primary/40 hover:bg-primary/[0.04]"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-interactive flex items-center justify-center transition-colors ${
          active ? "bg-primary/25 text-primary" : "bg-foreground/5 text-foreground/70 group-hover:bg-primary/15 group-hover:text-primary"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="typo-body text-foreground font-semibold">{title}</div>
        <div className="typo-caption text-foreground/70 mt-0.5">{caption}</div>
      </div>
      {active && (
        <span
          className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"
          style={{ boxShadow: "0 0 10px rgba(96,165,250,0.8)" }}
        />
      )}
    </button>
  );
}

interface SchedulePickerModalProps {
  open: boolean;
  onClose: () => void;
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
  onApply: (next: { frequency: Frequency | null; days: string[]; monthDay: number; time: string }) => void;
}

export function SchedulePickerModal({
  open, onClose, frequency, days, monthDay, time, onApply,
}: SchedulePickerModalProps) {
  // Local draft state — applied only on Confirm.
  const [draftRhythm, setDraftRhythm] = useState<Rhythm>(frequency ?? "once");
  const [draftDays, setDraftDays] = useState<string[]>(days);
  const [draftMonthDay, setDraftMonthDay] = useState(monthDay);
  const [draftTime, setDraftTime] = useState(time);
  const [step, setStep] = useState<"rhythm" | "detail">(frequency ? "detail" : "rhythm");

  // Sync drafts from props on open.
  useEffect(() => {
    if (!open) return;
    setDraftRhythm(frequency ?? "once");
    setDraftDays(days);
    setDraftMonthDay(monthDay);
    setDraftTime(time);
    setStep(frequency ? "detail" : "rhythm");
  }, [open, frequency, days, monthDay, time]);

  const toggleDraftDay = (d: string) =>
    setDraftDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleRhythmPick = (r: Rhythm) => {
    setDraftRhythm(r);
    if (r === "once") {
      // Shortcut: committing "Once" immediately applies a null schedule.
      onApply({ frequency: null, days: draftDays, monthDay: draftMonthDay, time: draftTime });
      return;
    }
    setStep("detail");
  };

  const applyCurrent = () => {
    if (draftRhythm === "once") {
      onApply({ frequency: null, days: draftDays, monthDay: draftMonthDay, time: draftTime });
      return;
    }
    onApply({
      frequency: draftRhythm as Frequency,
      days: draftDays.length > 0 ? draftDays : ["mon"],
      monthDay: draftMonthDay,
      time: draftTime,
    });
  };

  // Live preview string
  const preview = (() => {
    if (draftRhythm === "once") return "No schedule — run manually";
    if (draftRhythm === "daily") return `Every day at ${draftTime}`;
    if (draftRhythm === "weekly") {
      const names = draftDays
        .map((d) => DAY_OPTIONS.find((o) => o.id === d)?.long)
        .filter(Boolean)
        .join(", ");
      return names ? `Every ${names} at ${draftTime}` : `Weekly — pick at least one day`;
    }
    const ord = (n: number) => {
      const suf = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
      return `${n}${suf}`;
    };
    return `Every month on the ${ord(draftMonthDay)} at ${draftTime}`;
  })();

  return (
    <PickerShell
      open={open}
      onClose={onClose}
      onApply={applyCurrent}
      title="When should this agent run?"
      subtitle={preview}
      icon={<Clock className="w-5 h-5" />}
      footer={
        <>
          {step === "detail" && (
            <button
              type="button"
              onClick={() => setStep("rhythm")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive text-foreground/80 hover:text-foreground hover:bg-foreground/5 typo-body transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Change rhythm
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <kbd className="typo-caption text-foreground/50">⌘ + Enter</kbd>
            <button
              type="button"
              onClick={applyCurrent}
              className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors"
              style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
            >
              Apply schedule
            </button>
          </div>
        </>
      }
    >
      <div className="p-5">
        <AnimatePresence mode="wait">
          {step === "rhythm" ? (
            <motion.div
              key="rhythm"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-2 gap-3"
            >
              <RhythmCard
                rhythm="once"
                icon={<Clock className="w-5 h-5" />}
                title="One-off"
                caption="Runs manually — no schedule"
                active={draftRhythm === "once"}
                onSelect={() => handleRhythmPick("once")}
              />
              <RhythmCard
                rhythm="daily"
                icon={<Calendar className="w-5 h-5" />}
                title="Daily"
                caption="Every day at a set time"
                active={draftRhythm === "daily"}
                onSelect={() => handleRhythmPick("daily")}
              />
              <RhythmCard
                rhythm="weekly"
                icon={<CalendarDays className="w-5 h-5" />}
                title="Weekly"
                caption="On selected days each week"
                active={draftRhythm === "weekly"}
                onSelect={() => handleRhythmPick("weekly")}
              />
              <RhythmCard
                rhythm="monthly"
                icon={<CalendarRange className="w-5 h-5" />}
                title="Monthly"
                caption="On a specific day each month"
                active={draftRhythm === "monthly"}
                onSelect={() => handleRhythmPick("monthly")}
              />
            </motion.div>
          ) : (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-5"
            >
              {/* Time input */}
              <div className="flex items-center gap-3">
                <label className="typo-label text-foreground/90 w-20">Time</label>
                <input
                  type="time"
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                  autoFocus
                  className="flex-1 max-w-[200px] px-3 py-2 rounded-interactive bg-foreground/5 border border-border/40 typo-body-lg text-foreground font-medium focus:outline-none focus:border-primary/50"
                />
              </div>

              {/* Weekly — day pills */}
              {draftRhythm === "weekly" && (
                <div className="flex flex-col gap-2">
                  <label className="typo-label text-foreground/90">Days</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAY_OPTIONS.map((d) => {
                      const active = draftDays.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleDraftDay(d.id)}
                          className={`px-3 py-2 rounded-interactive typo-body font-medium transition-colors ${
                            active
                              ? "bg-primary/30 text-foreground border border-primary/50"
                              : "bg-foreground/5 text-foreground/80 border border-border/30 hover:border-primary/30 hover:text-foreground"
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly — day of month */}
              {draftRhythm === "monthly" && (
                <div className="flex flex-col gap-2">
                  <label className="typo-label text-foreground/90">Day of month</label>
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => {
                      const active = draftMonthDay === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDraftMonthDay(n)}
                          className={`h-10 rounded-interactive typo-body font-medium transition-colors tabular-nums ${
                            active
                              ? "bg-primary/30 text-foreground border border-primary/50"
                              : "bg-foreground/5 text-foreground/80 border border-border/25 hover:border-primary/30 hover:text-foreground"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PickerShell>
  );
}
