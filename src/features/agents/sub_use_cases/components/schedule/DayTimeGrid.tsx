import { ChevronDown } from 'lucide-react';
import { DAYS, HOURS, formatHour } from '../../libs/scheduleHelpers';

interface DayTimeGridProps {
  selectedDays: Set<string>;
  hour: number;
  minute: number;
  onToggleDay: (day: string) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}

export function DayTimeGrid({
  selectedDays,
  hour,
  minute,
  onToggleDay,
  onHourChange,
  onMinuteChange,
}: DayTimeGridProps) {
  const allSelected = selectedDays.size === 7;
  const weekdaysSelected = selectedDays.size === 5 &&
    ['1', '2', '3', '4', '5'].every((d) => selectedDays.has(d));

  return (
    <div className="space-y-3">
      {/* Day selector */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider">Days</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                DAYS.forEach((d) => { if (!selectedDays.has(d.key)) onToggleDay(d.key); });
              }}
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${
                allSelected ? 'text-amber-400 bg-amber-500/10' : 'text-muted-foreground/50 hover:text-foreground/70'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                DAYS.forEach((d) => {
                  const isWeekday = ['1', '2', '3', '4', '5'].includes(d.key);
                  const has = selectedDays.has(d.key);
                  if (isWeekday && !has) onToggleDay(d.key);
                  if (!isWeekday && has) onToggleDay(d.key);
                });
              }}
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${
                weekdaysSelected ? 'text-amber-400 bg-amber-500/10' : 'text-muted-foreground/50 hover:text-foreground/70'
              }`}
            >
              Weekdays
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((day) => {
            const active = selectedDays.has(day.key);
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => onToggleDay(day.key)}
                className={`py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  active
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-secondary/20 text-muted-foreground/50 border-primary/10 hover:border-primary/20 hover:text-foreground/70'
                }`}
                title={day.label}
              >
                {day.short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time selector */}
      <div>
        <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider block mb-1.5">Time</label>
        <div className="flex items-center gap-2">
          {/* Hour picker */}
          <div className="relative flex-1">
            <select
              value={hour}
              onChange={(e) => onHourChange(parseInt(e.target.value))}
              className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg border border-primary/20 bg-secondary/25 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 cursor-pointer"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, '0')}:00 ({formatHour(h)})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          </div>

          <span className="text-muted-foreground/40 text-lg font-light">:</span>

          {/* Minute picker */}
          <div className="relative w-24">
            <select
              value={minute}
              onChange={(e) => onMinuteChange(parseInt(e.target.value))}
              className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg border border-primary/20 bg-secondary/25 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 cursor-pointer"
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>
                  :{m.toString().padStart(2, '0')}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Visual hour bar */}
      <div>
        <label className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wider block mb-1.5">
          Hour (click to set)
        </label>
        <div className="flex gap-px">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onHourChange(h)}
              className={`flex-1 h-5 rounded-sm transition-all ${
                h === hour
                  ? 'bg-amber-400 shadow-sm shadow-amber-400/30'
                  : h >= 9 && h <= 17
                    ? 'bg-amber-500/10 hover:bg-amber-500/20'
                    : 'bg-secondary/30 hover:bg-secondary/50'
              }`}
              title={`${h.toString().padStart(2, '0')}:00 (${formatHour(h)})`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-0.5 text-sm text-muted-foreground/60 font-mono px-0.5">
          <span>12a</span>
          <span>6a</span>
          <span>12p</span>
          <span>6p</span>
          <span>12a</span>
        </div>
      </div>
    </div>
  );
}
