// Preset first milestone — seeded when the passport wall's "Onboard with
// Fleet" dispatches. A fresh project's Ship tab should never open empty: its
// first deliverable IS the Personas onboarding itself, so we create one
// active milestone with the onboarding bound as its core objective (a
// dev_goal — it's a completion statement, not scanned work). Idempotent:
// skipped the moment the project has any milestone.
import { createGoal } from '@/api/devTools/devTools';
import { createMilestone, listMilestones, setMilestoneItem } from '@/api/devTools/milestones';

export async function seedOnboardingMilestone(projectId: string): Promise<void> {
  const existing = await listMilestones(projectId);
  if (existing.length > 0) return;
  const goal = await createGoal(
    projectId,
    'Passport created — Personas onboarding complete',
    'Seeded when "Onboard with Fleet" was dispatched. Done when the guided onboarding session has assessed the passport dimensions and bound the first sensors.',
  );
  const m = await createMilestone({
    projectId,
    name: 'Onboard to Personas',
    goal: 'The project is fully onboarded: passport assessed, first sensors bound, scaffolding ready for milestone-driven shipping.',
    status: 'active',
  });
  await setMilestoneItem(m.id, 'goal', goal.id, 'core');
}
