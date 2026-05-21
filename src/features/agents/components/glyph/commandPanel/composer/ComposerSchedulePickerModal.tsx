/**
 * ComposerSchedulePickerModal — opens from the Composer's "When" row.
 *
 * Two-step flow:
 *   1. Rhythm cards — One-off / Daily / Weekly / Monthly. Big, visual,
 *      one click picks. "One-off" clears the schedule.
 *   2. Detail — time + days (weekly) / day-of-month (monthly). A live
 *      preview at the top spells the schedule in human English, so the
 *      user sees the result of each click instantly.
 *
 * Animates between steps with AnimatePresence (slide + fade). ⌘+Enter
 * applies; Esc closes (handled by ComposerPickerShell).
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Calendar, CalendarDays, CalendarRange, ChevronLeft } from "lucide-react";
import type { Frequency } from "@/features/agents/components/matrix/quickConfigTypes";
import { ComposerPickerShell } from "./ComposerPickerShell";
import { ComposerScheduleRhythmCard, type Rhythm } from "./ComposerScheduleRhythmCard";
import { ComposerScheduleDetailForm, DAY_OPTIONS } from "./ComposerScheduleDetailForm";
import { DebtText, debtText } from '@/i18n/DebtText';


interface ComposerSchedulePickerModalProps {
  open: boolean;
  onClose: () => void;
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
  onApply: (next: { frequency: Frequency | null; days: string[]; monthDay: number; time: string }) => void;
}

function buildPreview(rhythm: Rhythm, days: string[], monthDay: number, time: string): string {
  if (rhythm === "once") return "No schedule — run manually";
  if (rhythm === "daily") return `Every day at ${time}`;
  if (rhythm === "weekly") {
    const names = days
      .map((d) => DAY_OPTIONS.find((o) => o.id === d)?.long)
      .filter(Boolean)
      .join(", ");
    return names ? `Every ${names} at ${time}` : `Weekly — pick at least one day`;
  }
  const ord = (n: number) => {
    const suf = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${suf}`;
  };
  return `Every month on the ${ord(monthDay)} at ${time}`;
}

export function ComposerSchedulePickerModal({
  open, onClose, frequency, days, monthDay, time, onApply,
}: ComposerSchedulePickerModalProps) {
  const [draftRhythm, setDraftRhythm] = useState<Rhythm>(frequency ?? "once");
  const [draftDays, setDraftDays] = useState<string[]>(days);
  const [draftMonthDay, setDraftMonthDay] = useState(monthDay);
  const [draftTime, setDraftTime] = useState(time);
  const [step, setStep] = useState<"rhythm" | "detail">(frequency ? "detail" : "rhythm");

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

  const preview = buildPreview(draftRhythm, draftDays, draftMonthDay, draftTime);

  return (
    <ComposerPickerShell
      open={open}
      onClose={onClose}
      onApply={applyCurrent}
      title={debtText("auto_when_should_this_agent_run_f33725ba")}
      subtitle={preview}
      icon={<Clock className="w-5 h-5" />}
      footer={
        <>
          {step === "detail" && (
            <button
              type="button"
              onClick={() => setStep("rhythm")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive text-foreground hover:text-foreground hover:bg-foreground/5 typo-body transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <DebtText k="auto_change_rhythm_2697a991" />
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <kbd className="typo-caption text-foreground"><DebtText k="auto_enter_b0d98854" /></kbd>
            <button
              type="button"
              onClick={applyCurrent}
              className="px-4 py-1.5 rounded-interactive bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground typo-body font-medium transition-colors"
              style={{ boxShadow: "0 0 20px rgba(96,165,250,0.25)" }}
            >
              <DebtText k="auto_apply_schedule_c8f50c45" />
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
              <ComposerScheduleRhythmCard
                rhythm="once"
                icon={<Clock className="w-5 h-5" />}
                title={debtText("auto_one_off_33219738")}
                caption="Runs manually — no schedule"
                active={draftRhythm === "once"}
                onSelect={() => handleRhythmPick("once")}
              />
              <ComposerScheduleRhythmCard
                rhythm="daily"
                icon={<Calendar className="w-5 h-5" />}
                title="Daily"
                caption="Every day at a set time"
                active={draftRhythm === "daily"}
                onSelect={() => handleRhythmPick("daily")}
              />
              <ComposerScheduleRhythmCard
                rhythm="weekly"
                icon={<CalendarDays className="w-5 h-5" />}
                title="Weekly"
                caption="On selected days each week"
                active={draftRhythm === "weekly"}
                onSelect={() => handleRhythmPick("weekly")}
              />
              <ComposerScheduleRhythmCard
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
            >
              <ComposerScheduleDetailForm
                rhythm={draftRhythm}
                time={draftTime}
                onTimeChange={setDraftTime}
                days={draftDays}
                onToggleDay={toggleDraftDay}
                monthDay={draftMonthDay}
                onMonthDayChange={setDraftMonthDay}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ComposerPickerShell>
  );
}
