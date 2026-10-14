// A peer agent's on/off switch, run on THAT device through the `mesh_verb`
// job (`persona_set_enabled`, the same door the peer's own switch uses). The
// busy state is the AsyncButton's; what came back is the row's outcome line.
//
// It is off while the device is not reporting: a switch drawn from a snapshot
// nobody can vouch for would flip a state we cannot see. A persona whose
// project is switched off on its device cannot be turned on from here either
// (the peer refuses with `project_off`), and the tooltip says so up front.

import { memo } from 'react';
import { Power, PowerOff } from 'lucide-react';
import type { DeviceAgent } from '@/lib/bindings/DeviceAgent';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';

export const PeerAgentToggle = memo(function PeerAgentToggle({
  peerId, device, agent, stale,
}: {
  peerId: string;
  device: string;
  agent: DeviceAgent;
  stale: boolean;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const toggle = useSystemStore((s) => s.toggleRemoteAgent);
  const projectOff = agent.projectEnabled === false;
  const blocked = stale || (projectOff && !agent.enabled);
  const label = tx(agent.enabled ? m.mesh_agent_turn_off : m.mesh_agent_turn_on, { name: agent.name, device });
  const hint = stale ? tx(m.mesh_agent_stale, { device })
    : projectOff ? tx(m.mesh_agent_project_off, { device })
      : label;

  return (
    <Tooltip content={hint} delay={300} triggerFocusable={blocked}>
      <AsyncButton
        variant={agent.enabled ? 'accent' : 'ghost'}
        tone={agent.enabled ? 'success' : undefined}
        size="icon-sm"
        disabled={blocked}
        className={blocked ? 'pointer-events-none' : undefined}
        aria-label={blocked ? hint : label}
        aria-pressed={agent.enabled}
        onClick={(e) => {
          e.stopPropagation();
          return toggle(peerId, agent.personaId, !agent.enabled);
        }}
        data-testid="mesh-agent-toggle"
        data-project-off={projectOff || undefined}
        icon={agent.enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
      />
    </Tooltip>
  );
});
