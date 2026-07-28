// Preset first milestone — seeded when the passport wall's "Onboard with
// Fleet" dispatches. A fresh project's Ship tab should never open empty: its
// first deliverable IS the Personas onboarding itself, so we create one
// active milestone with the onboarding bound as its core objective (a
// dev_goal — it's a completion statement, not scanned work). Idempotent:
// skipped the moment the project has any milestone.
import { createGoal } from '@/api/devTools/devTools';
import { createMilestone, listMilestones, setMilestoneItem } from '@/api/devTools/milestones';
import { getActiveTranslations } from '@/i18n/useTranslation';

export async function seedOnboardingMilestone(projectId: string): Promise<void> {
  const existing = await listMilestones(projectId);
  if (existing.length > 0) return;
  // Seeded content is persisted DATA — resolve it in the user's active
  // language at creation time (non-React module → getActiveTranslations).
  const t = getActiveTranslations();
  const goal = await createGoal(projectId, t.ship.seed_goal_title, t.ship.seed_goal_description);
  const m = await createMilestone({
    projectId,
    name: t.ship.seed_milestone_name,
    goal: t.ship.seed_milestone_goal,
    status: 'active',
  });
  await setMilestoneItem(m.id, 'goal', goal.id, 'core');
}
