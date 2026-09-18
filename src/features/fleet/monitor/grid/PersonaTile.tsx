// PersonaTile — a persona on the Activity board: the behaviour around a node.
//
// Was `PersonaSquare` (38px, initials), then a 152×38 single-line tile with the
// name on it. It is now a THIN WRAPPER over `board/node/FleetNode`, which
// paints the two-row node every kind on the board shares. What lives here is
// what a persona DOES on the board, and none of it changed:
//   • the state→colour decision (`squareState` + `SQUARE_VISUAL`) is read by
//     the node, so a tile's colour still agrees with every other Monitor surface;
//   • the click contract — select the persona, open the drawer on its most
//     relevant section;
//   • `data-testid="fleet-grid-square"` on the clickable body, which the
//     tour-anchor manifest and the onboarding flows address;
//   • the RIGHT-CLICK Active/Off switch (2026-09-15) — the same
//     `personas.enabled` the editor header toggles, through
//     `set_persona_enabled`. The menu is PORTALLED: the body is a `<button>`
//     inside a clipped, transformed column, where a `position: fixed` menu
//     would be positioned against the column. Orphan cards have no switch.
//   • the speech bubble and the unseen-chat mark (`useChannelBubbles`), which
//     the node draws and this wrapper feeds.

import { memo, useCallback, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { PanelRightOpen, Power, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { toastCatch } from '@/lib/silentCatch';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../monitorModel';
import { squareState, cleanName, actionBadges, type ActionKind } from './fleetGridModel';
import type { ChatBubble } from './channelBubbleModel';
import { FleetNode } from './board/node/FleetNode';

/** Human phrase for one pending-operation kind, for the tooltip. */
function badgeLine(
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
  kind: ActionKind,
  count: number,
): string {
  switch (kind) {
    case 'failed': return t.monitor.grid_badge_failed;
    case 'review': return tx(t.monitor.grid_badge_review, { count });
    case 'input': return tx(t.monitor.grid_badge_input, { count });
    case 'draft': return tx(t.monitor.grid_badge_draft, { count });
    case 'message': return tx(t.monitor.grid_badge_message, { count });
  }
}

export const PersonaTile = memo(function PersonaTile({
  card, selected, onSelect, width, height, flash = false, bubble = null, unseenChat = 0, teamName = null,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  width: number;
  height: number;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
  /** The persona's latest channel line, while its bubble is up. */
  bubble?: ChatBubble | null;
  /** Channel lines posted since the operator last opened this persona. */
  unseenChat?: number;
  /** The column's team, for the node's meta row; `null` in the tray. */
  teamName?: string | null;
}) {
  const { t, tx } = useTranslation();
  const reducedMotion = useReducedMotion() ?? false;
  const setPersonaEnabled = useAgentStore((s) => s.setPersonaEnabled);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const st = squareState(card);
  // A switched-off project overrules the persona's own switch: the tile reads
  // as off and its own toggle is held until the project is back on.
  const offProject = useOffProjectForPersona(card.personaId);
  const personaOff = card.enabled === false;
  const off = personaOff || offProject !== null;

  const badges = actionBadges(card);
  const dominant = badges[0] ?? null;
  const name = cleanName(card.personaName);
  const lines = [
    ...(offProject
      ? [`• ${tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })}`]
      : personaOff ? [`• ${t.monitor.grid_persona_disabled}`] : []),
    ...badges.map((b) => `• ${badgeLine(t, tx, b.key, b.count)}`),
    ...(unseenChat > 0 ? [`• ${tx(t.monitor.grid_chat_unseen, { count: unseenChat })}`] : []),
  ];
  const title = [
    bubble ? tx(t.monitor.grid_chat_bubble_aria, { name, text: bubble.text }) : name,
    ...lines,
  ].join('\n');
  const ariaLabel = lines.length > 0
    ? `${card.personaName} — ${lines.map((l) => l.slice(2)).join(', ')}`
    : card.personaName;

  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    if (card.enabled === null) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const activate = useCallback(
    () => onSelect(card.personaId, primaryDrawerSection(card)),
    [onSelect, card],
  );

  const menuItems: ContextMenuItem[] = [
    {
      id: 'toggle-enabled',
      label: offProject
        ? tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })
        : personaOff ? t.monitor.grid_menu_enable : t.monitor.grid_menu_disable,
      icon: personaOff || offProject ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />,
      disabled: offProject !== null,
      onSelect: () => {
        setPersonaEnabled(card.personaId, personaOff).catch(
          toastCatch('fleet/PersonaTile:toggleEnabled', t.monitor.grid_menu_toggle_failed),
        );
      },
    },
    {
      id: 'open',
      label: t.monitor.grid_menu_open,
      icon: <PanelRightOpen className="h-3.5 w-3.5" />,
      onSelect: activate,
    },
  ];

  return (
    <>
      <FleetNode
        kind="persona"
        card={card}
        teamName={teamName}
        bubble={bubble}
        unseenChat={unseenChat}
        off={off}
        width={width}
        height={height}
        flash={flash}
        selected={selected}
        reducedMotion={reducedMotion}
        onActivate={activate}
        onContextMenu={onContextMenu}
        ariaLabel={ariaLabel}
        tooltip={<span className="whitespace-pre-line">{title}</span>}
        bodyTestId="fleet-grid-square"
        data={{
          state: st,
          enabled: card.enabled === null ? undefined : !off,
          'project-off': offProject ? true : undefined,
          action: dominant?.key ?? 'none',
          'persona-id': card.personaId,
        }}
      />
      {menu && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={closeMenu}
          ariaLabel={card.personaName}
          widthClass="w-52"
        />,
        document.body,
      )}
    </>
  );
});

export default PersonaTile;
