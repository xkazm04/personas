import CreateAthenaStage from './variants/CreateAthenaStage';
import { useCreateAthenaEngine } from './engine/useCreateAthenaEngine';

/**
 * Create Athena — the chat-driven onboarding wizard (Plugins → Companion →
 * Create Athena). One engine (`useCreateAthenaEngine`) drives the Stage
 * shell: a step rail with Athena's orb hero on the left, her line as a
 * caption above the step's card on the right.
 *
 * Stage was chosen 2026-09-18 over the Conversation and Scenes prototypes
 * (vault Spark/ideas/athena-onboarding.md); the switcher and the losing
 * shells were removed with that decision.
 */
export default function CreateAthenaPanel() {
  const engine = useCreateAthenaEngine();
  return (
    <div className="h-full min-h-0" data-testid="create-athena-panel">
      <CreateAthenaStage engine={engine} />
    </div>
  );
}
