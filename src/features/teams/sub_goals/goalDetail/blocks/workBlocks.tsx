// The blocks you ACT in: the task table, the verification gate, the sub-goals,
// and handing the goal to the project's AI team.
import { Globe, ListChecks, Play, Plus, ShieldCheck, Target, Circle, CheckCircle2 } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';

import { isComplete } from '../../goalStatus';
import { GoalTaskTable } from '../../GoalTaskTable';
import { GoalHandoffPanel } from '../../GoalHandoffPanel';
import { useGoalDetailModel } from '../context';
import { Section } from '../parts';

/**
 * ONE table merging ad-hoc to-dos + team-assignment steps (de-duped by title;
 * team steps carry the responsible persona, status, output, and awaiting-review
 * intervention), plus the add-a-to-do row.
 */
export function Tasks() {
  const {
    dl, steps, todoItems, personaById, toggleItem, deleteItem, resolveStep,
    newItem, setNewItem, addItem,
  } = useGoalDetailModel();
  return (
    <Section icon={ListChecks} label={dl.goal_tasks_label} flush>
      <GoalTaskTable
        steps={steps}
        items={todoItems}
        personaById={personaById}
        onToggleItem={toggleItem}
        onDeleteItem={deleteItem}
        onResolveStep={resolveStep}
      />
      <div className="flex items-center gap-2 mt-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); }}
          placeholder={dl.goal_item_add_placeholder}
          className="flex-1 px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
        />
        <Button variant="ghost" size="icon-sm" disabled={!newItem.trim()} onClick={addItem} aria-label={dl.goal_item_add}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </Section>
  );
}

/**
 * The browser-UAT gate - web projects only. A verification item only a passing
 * live browser test ticks; while open it keeps the goal under 100%. Eligible to
 * run once the other to-dos are complete (it is the final acceptance step).
 */
export function UatGate() {
  const { dl, t, isWebProject, verifyItem, uat, todosComplete } = useGoalDetailModel();
  if (!isWebProject && !verifyItem) return null;
  return (
    <Section icon={Globe} label={dl.uat_section_title}>
      {verifyItem ? (
        <div className="rounded-card border border-status-info/25 bg-status-info/[0.04] px-3 py-2.5">
          <div className="flex items-center gap-2">
            {verifyItem.done
              ? <ShieldCheck className="w-4 h-4 text-status-success shrink-0" />
              : <Globe className="w-4 h-4 text-status-info shrink-0" />}
            <span className="flex-1 typo-body text-foreground">
              {verifyItem.done ? dl.uat_passed : dl.uat_pending}
            </span>
            {!verifyItem.done && (
              <Button
                variant="accent"
                tone="info"
                size="sm"
                icon={<Play className="w-3.5 h-3.5" />}
                disabled={uat.running || !todosComplete}
                onClick={uat.run}
              >
                {uat.running ? dl.uat_verifying : dl.uat_verify_now}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={uat.clear}>{dl.uat_remove}</Button>
          </div>
          {!verifyItem.done && !todosComplete && (
            <p className="typo-caption text-status-warning mt-1.5">{dl.uat_blocked_todos}</p>
          )}
          {!verifyItem.done && (
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="typo-caption text-foreground">{dl.uat_gate_hint}</p>
              {/* The override door. A kit link-button rather than the
                  hand-rolled underlined control it was in the drawer, so it
                  carries one focus ring like everything else here. */}
              <Button variant="link" size="xs" onClick={uat.markPassed} className="shrink-0">
                {dl.uat_mark_passed}
              </Button>
            </div>
          )}
        </div>
      ) : uat.showForm ? (
        <div className="rounded-card border border-primary/10 bg-card/30 px-3 py-2.5 space-y-2">
          <label className="block typo-caption text-foreground">{dl.uat_scenario_label}</label>
          <textarea
            value={uat.scenario}
            onChange={(e) => uat.setScenario(e.target.value)}
            placeholder={dl.uat_scenario_placeholder}
            rows={2}
            className="w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
          <input
            value={uat.url}
            onChange={(e) => uat.setUrl(e.target.value)}
            placeholder={dl.uat_url_label}
            className="w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
          <div className="flex items-center gap-2">
            <Button variant="accent" tone="info" size="sm" disabled={!uat.scenario.trim()} onClick={uat.save}>
              {dl.uat_save}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => uat.setShowForm(false)}>{t.common.cancel}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => uat.setShowForm(true)}>
          {dl.uat_add}
        </Button>
      )}
    </Section>
  );
}

export function Subgoals() {
  const { dl, subgoals } = useGoalDetailModel();
  if (subgoals.length === 0) return null;
  return (
    <Section icon={Target} label={dl.goal_detail_subgoals}>
      <ul className="space-y-1.5">
        {subgoals.map((sg) => (
          <li key={sg.id} className="flex items-center gap-2.5 typo-body">
            {isComplete(sg.status) || sg.progress >= 100
              ? <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />
              : <Circle className="w-4 h-4 text-foreground shrink-0" />}
            <span className="flex-1 text-foreground truncate">{sg.title}</span>
            <span className="typo-caption text-foreground tabular-nums">{sg.progress}%</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Hand this goal to the project's AI team - plain-language control with an
 * inline confirm. When the team is already on it, the same panel carries the
 * "Stop the team" (abort) control. The live team steps are rows in the Tasks
 * table, so awaiting-review intervention is never buried here.
 */
export function Handoff() {
  const { canHandOff, hasActiveAssignment, advancing, advance, abort, aborting } = useGoalDetailModel();
  if (!canHandOff) return null;
  return (
    <GoalHandoffPanel
      hasActiveAssignment={hasActiveAssignment}
      advancing={advancing}
      onAdvance={advance}
      onAbort={abort}
      aborting={aborting}
    />
  );
}
