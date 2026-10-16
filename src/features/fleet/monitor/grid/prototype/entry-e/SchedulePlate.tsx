// The SCHEDULES plate: the operator's scheduled tasks (the `\Personas\` Task Scheduler folder),
// so a nightly job that is switched on is never forgotten. Two rows per task - lamp and title,
// then the next start in Prague time and a switch - and the detail (window, last run, its
// result) on the title's tooltip. Renders nothing until something is scheduled, and nothing off Windows.

import { Activity, CalendarClock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';
import { Engraved, Lamp } from './parts';
import { TOK_ICON, TOK_TYPE } from './LineParts';
import { pragueTime, scheduleLamp, taskLamp } from './scheduleModel';
import { useScheduledTasks } from './useScheduledTasks';

function TaskTip({ task }: { task: ScheduledTaskView }) {
  const { t, tx, language } = useTranslation();
  const m = t.monitor;
  const last = task.lastRunMs != null
    ? `${tx(m.schedule_last_run, { when: pragueTime(task.lastRunMs, language) })} · ${
      task.lastResult === 0 ? m.schedule_last_ok : tx(m.schedule_last_failed, { code: task.lastResult ?? '?' })}`
    : m.schedule_never_ran;
  return (
    <div className="flex flex-col gap-1 typo-caption">
      <span className="typo-body text-foreground">{task.title}</span>
      {task.window && <span>{tx(m.schedule_window, { window: task.window })}</span>}
      <span>{last}</span>
      <span>{m.schedule_time_zone}</span>
    </div>
  );
}

/**
 * One task, two rows (polish P2, 2026-10-16: "items are unreadable" on one line
 * at the rail's width). Row 1 is the name, whole width, truncated with the full
 * detail in the tooltip; row 2, under the name, is the next start as the
 * Monitor's clock token (the persona line's `CalendarClock` + 24h time, here in
 * Prague time) and the switch at the right edge.
 */
function TaskLine({
  task, saving, onToggle,
}: { task: ScheduledTaskView; saving: boolean; onToggle: () => void }) {
  const { t, tx, language } = useTranslation();
  const m = t.monitor;
  const running = task.state === 'Running';
  const clock = !running && task.enabled && task.nextRunMs != null ? pragueTime(task.nextRunMs, language) : null;
  const when = running ? m.schedule_running : clock ?? m.schedule_off;
  return (
    <div className="ae-plan is-stack" data-testid="entry-e-schedule-line" data-enabled={task.enabled || undefined}>
      <Tooltip placement="right" delay={400} content={<TaskTip task={task} />}>
        <span className="flex min-w-0 items-center gap-2">
          <Lamp lamp={taskLamp(task)} />
          <span className="min-w-0 flex-1 truncate typo-caption text-foreground" data-testid="entry-e-schedule-name">{task.title}</span>
        </span>
      </Tooltip>
      <span className="flex min-w-0 items-center gap-2 pl-[18px]">
        <span
          className={`inline-flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap ${TOK_TYPE} ${running ? 'ae-t-warn' : ''}`}
          aria-label={clock !== null ? tx(m.schedule_next, { when: clock }) : undefined}
          data-testid="entry-e-schedule-when"
        >
          {running
            ? <Activity className={`${TOK_ICON} ae-tone-text`} aria-hidden />
            : <CalendarClock className={TOK_ICON} aria-hidden />}
          <span className="truncate">{when}</span>
        </span>
        <AccessibleToggle
          size="sm"
          checked={task.enabled}
          disabled={saving}
          onChange={onToggle}
          label={tx(m.schedule_toggle_aria, { title: task.title })}
          data-testid="entry-e-schedule-toggle"
        />
      </span>
    </div>
  );
}

export function SchedulePlate() {
  const { t } = useTranslation();
  const m = t.monitor;
  const { tasks, saving, setEnabled } = useScheduledTasks();
  if (!tasks || tasks.length === 0) return null;

  return (
    <section className="ae-plate flex flex-col gap-1.5 rounded-card p-3" data-testid="entry-e-schedules" aria-label={m.schedules_aria}>
      <header className="flex items-center gap-2">
        <Lamp lamp={scheduleLamp(tasks)} />
        <Engraved>{m.schedules}</Engraved>
        <CalendarClock className="ml-auto h-3.5 w-3.5 text-foreground" aria-hidden />
      </header>
      {tasks.map((task) => (
        <TaskLine
          key={task.name}
          task={task}
          saving={saving === task.name}
          onToggle={() => {
            setEnabled(task.name, !task.enabled).catch(toastCatch('fleet/entry-e:schedule', m.schedule_toggle_failed));
          }}
        />
      ))}
    </section>
  );
}
