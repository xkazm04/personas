/**
 * Chain Studio entry point. The React Flow canvas was retired in June 2026
 * in favour of the Switchboard — a patch-bay surface that routes trigger
 * signals and persona completions to target personas without spatial node
 * editing. The export keeps its historical name so the lazy import in
 * TriggersPage stays stable; a rename is a follow-up refactor.
 */
import { StudioSwitchboard } from './StudioSwitchboard';

export function TriggerStudioCanvas() {
  return <StudioSwitchboard />;
}
