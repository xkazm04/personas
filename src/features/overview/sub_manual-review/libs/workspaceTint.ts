// The workspace tint — which colour a persona's NAME wears in the Approvals
// queue, so the eye learns "this decision came out of that organisation"
// before it reads a word.
//
// Asked for on 2026-10-04: "try to randomize palette of colors per workspace in
// which persona belongs". Randomize is taken as DETERMINISTIC-PER-WORKSPACE: a
// genuinely random palette would reshuffle on every render and carry no
// information at all. The same workspace must always produce the same colour.
//
// ## Where a persona's workspace lives
//
// `personas` carries no `workspace_id`. The authority is one level up:
// `persona_teams.workspace_id` (`src-tauri/db/src/workspace_team.rs` — "a dev
// workspace automatically owns exactly one cross-project group"), and a persona
// points at its team through `home_team_id`. So the chain is
// persona → home_team_id → team → workspace_id, and every link is nullable.
//
// **A persona with no workspace is the COMMON case** for a local fleet, not an
// error: `home_team_id` defaults to NULL. It resolves to `undefined` here, and
// the call site then leaves `typo-title`'s own primary tint in place — the
// theme's own hue, which says "a persona" and claims no membership. Absence of
// a workspace must not be painted as a workspace.
//
// ## Why these colours, and why mixed with the foreground
//
// The palette is `WORKSPACE_COLORS` — the app's OWN workspace swatches, the
// hues the operator already sees in the Workspaces atlas — not a new ramp. The
// token system has no identity ramp (doctrine section 4 has four ROLE colours,
// each of which already means something: agent / human / external / highlight),
// and inventing one is a `src/styles` change this module is not allowed to make.
//
// Those swatches are mid-lightness fills; as TEXT they are marginal. So the ink
// is mixed toward the canvas's own `--foreground`, using the recipe
// `.typo-title` itself uses (`color-mix(in srgb, <tint> 75%, var(--foreground))`
// dark, a steeper mix light). Measured with check-themes' own contrast maths
// over all 11 themes x all 8 swatches: at dark 75% / light 45% the worst cell is
// **5.29:1** (light-news amber), every other cell >= 5.3, i.e. AA with margin.
// 60% on light — `.typo-title`'s own light ratio — fails at 3.65:1, which is why
// the two ratios differ. The mix lives in `workspaceTint.css`; this file only
// decides WHICH swatch.

import { useCallback } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { WORKSPACE_COLORS } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';

/**
 * A stable bucket in `0..n-1` for a string (djb2).
 *
 * `fleet/monitor/grid/board/node/nodeHues.ts:swatchHue` is the sibling of this
 * — the same djb2, for the same reason ("the same team wears the same square on
 * every board"). It is not reused because it returns a HUE in `0..359`, and
 * `% n` over a hue is only unbiased when `n` divides 360; this returns the
 * bucket directly, so the palette can be any length.
 */
export function stableIndex(id: string, n: number): number {
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

/** The swatch a workspace id always wears. */
export function workspaceSwatch(workspaceId: string): string {
  return WORKSPACE_COLORS[stableIndex(workspaceId, WORKSPACE_COLORS.length)]!;
}

/**
 * `(personaId) => swatch | undefined` — the workspace swatch for a persona, or
 * `undefined` when the persona has no team, the team has no workspace, or the
 * teams have not landed yet.
 *
 * **Reads the stores, never fetches them.** `PersonasPage.runStartup` prewarms
 * both; a cold surface simply resolves `undefined` and every name keeps the
 * neutral tint until the prewarm lands (overview-loading law 1: nothing is
 * hidden or held waiting for this).
 */
export function usePersonaWorkspaceSwatch(): (personaId: string | null | undefined) => string | undefined {
  const personas = useAgentStore((s) => s.personas);
  const teams = usePipelineStore((s) => s.teams);

  return useCallback(
    (personaId) => {
      if (!personaId) return undefined;
      const homeTeamId = personas.find((p) => p.id === personaId)?.home_team_id;
      if (!homeTeamId) return undefined;
      const workspaceId = teams.find((team) => team.id === homeTeamId)?.workspace_id;
      if (!workspaceId) return undefined;
      return workspaceSwatch(workspaceId);
    },
    [personas, teams],
  );
}
