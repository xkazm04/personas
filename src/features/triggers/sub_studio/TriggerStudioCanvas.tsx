/**
 * Chain Studio entry point — renders the unified ledger (`StudioPatchbay`,
 * the /prototype winner): one surface where the compose draft and the live
 * routing inventory (read + manage) coexist, superseding the separate
 * "Routes" view with zero capability loss. The compose-only Switchboard
 * baseline and the A/B tab switcher were removed at consolidation.
 * See docs/plans/studio-supersedes-builder.md.
 *
 * The export keeps its historical name so the lazy import in TriggersPage
 * stays stable.
 */
import { StudioPatchbay } from './StudioPatchbay';

export function TriggerStudioCanvas() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <StudioPatchbay />
    </div>
  );
}
