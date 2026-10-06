// DrawerAutonomy — a persona's autonomy STANDING in the drawer header.
//
// WHAT THIS READS, AND WHY IT IS NOT DERIVED HERE
// ----------------------------------------------
// `fleet_autopilot_status` already answers both questions per persona
// (`src-tauri/.../autopilot.rs`): `eligible` = `enabled && attention_charters > 0`,
// and `appMaster` = at least one admitted charter binds a project or a
// workspace — the derived predicate `is_app_master(charters)` the attention
// loop itself uses to swap its last lane to `decide`. The drawer consumes that
// read rather than re-deriving from the charters it happens to hold, so the
// drawer and the loop cannot disagree about who runs on its own.
//
// WHY THIS DOES NOT WRITE  (the decision the brief asked for, stated here so
// the next reader does not have to find the report)
// ----------------------------------------------------------------------
// There is NO per-persona autonomy flag to flip. The switch is
// `cadence.attentionEnabled` and it lives on each CHARTER
// (`responsibility.rs`), so "turn this persona off" is N writes of
// `update_persona_responsibility` across N charters. That is:
//   * NOT ATOMIC — a partial failure leaves a half-autonomous persona and no
//     record of which charters were flipped;
//   * NOT REVERSIBLE by the same control — turning it back on cannot know
//     which charters were on before, so the "off" would quietly become
//     "all on" on the way back, or require new state to remember;
//   * A BLIND READ-MODIFY-WRITE — `update_persona_responsibility` takes the
//     whole charter, and this drawer's copy is a 5-minute warm cache
//     (`responsibilitiesCache`) racing the charter editor.
// A monitoring drawer is a place you LOOK. The two controls that already
// exist are the right ones: the global `autonomous_attention_loop` switch on
// the Activity board, and `CadenceFields` on each charter. So this reads, and
// links to the second one.
//
// NOTHING IS SHOWN for a persona that is not autonomy-capable. "Autonomy-capable"
// is `attentionCharters > 0`, not `eligible`: a persona with attention charters
// that is switched OFF still has autonomy to talk about, and saying so is the
// whole point of the row.

import { Crown, ExternalLink } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import type { AutopilotPersona } from '@/lib/bindings/AutopilotPersona';
import { useAutopilotStatus } from '../grid/board/useAutopilotStatus';
import { Lamp } from '../grid/prototype/entry-e/parts';
import type { Tone } from '../grid/prototype/entry-e/tone';
import '../grid/prototype/entry-e/entryE.css';

/** The charter editor for this persona — the one place autonomy is actually set. */
function openCharters(personaId: string): void {
  const system = useSystemStore.getState();
  system.setSidebarSection('personas');
  useAgentStore.getState().selectPersona(personaId);
  system.setEditorTab('design');
  system.setDesignSubTab('responsibilities');
}

function standing(row: AutopilotPersona, loopOn: boolean): { tone: Tone; lit: boolean } {
  if (!row.enabled) return { tone: 'off', lit: false };
  if (!loopOn) return { tone: 'warn', lit: false };
  return row.eligible ? { tone: 'run', lit: true } : { tone: 'warn', lit: false };
}

export function DrawerAutonomy({ personaId, onNavigate }: { personaId: string; onNavigate: () => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const { status } = useAutopilotStatus();

  const row = status?.personas.find((p) => p.personaId === personaId) ?? null;
  // Not autonomy-capable (or the roster could not be read): no control. The
  // operator's correction — "we cannot place the switch to all personas".
  if (!row || row.attentionCharters === 0) return null;

  const loopOn = status?.enabled ?? false;
  const lamp = standing(row, loopOn);
  const why = !row.enabled
    ? m.grid_persona_disabled
    : loopOn
      ? m.autopilot_aria
      : m.orch_autopilot_off;

  return (
    <div className="flex items-center gap-2" data-testid="drawer-autonomy">
      <Tooltip content={why}>
        <span className="flex items-center gap-1.5">
          <Lamp lamp={lamp} label={m.autopilot} />
          <span className="typo-label text-foreground">{m.autopilot}</span>
        </span>
      </Tooltip>

      {row.appMaster && (
        <Tooltip content={m.orch_app_master}>
          <span className="flex items-center gap-1 text-status-warning">
            <Crown className="h-3.5 w-3.5 flex-shrink-0" aria-label={m.orch_app_master} />
          </span>
        </Tooltip>
      )}

      <span className="typo-caption tabular-nums text-foreground">
        {row.attentionCharters} {m.orch_col_charters}
      </span>

      <Button
        variant="link"
        size="xs"
        iconRight={<ExternalLink className="h-3 w-3" />}
        onClick={() => {
          openCharters(personaId);
          onNavigate();
        }}
      >
        {m.quick_open_builder}
      </Button>
    </div>
  );
}
