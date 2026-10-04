// The persona card's verbs, one right-click away (or Shift+F10 / the Menu key
// on a focused line) - the sibling of `SessionMenu`, and built the same way:
// ONE host owns the menu and every persona line on every layout binds to it,
// so a roster of fifty mounts one menu.
//
// Four verbs, and three of them already had storage:
//   * QUICK CHAT is a seam only. The composer belongs to whoever renders the
//     bubble; this file never draws one.
//   * STAR FOR OVERSEER is `personas.starred` - the same column the Overseer's
//     coaching scope and the agents page's favourite already read. No new state.
//   * FLAG FOR ATHENA is BULK and therefore TRI-STATE: a persona is on when
//     every live session of its is flagged, off when none is, mixed when some
//     are. Mixed offers "flag all". Two different rows with two different
//     lifetimes are written: `fleet_set_athena_flag` per live session (the
//     grant itself) and `persona_set_athena_auto_flag` (the default that
//     stamps future sessions). Neither implies the other, which is why the
//     verb writes both.
//   * ENABLE / DISABLE is `personas.enabled`, the verb the retired
//     `PersonaTile` carried. An orphan card (`enabled === null`) has no switch.
//
// `athenaFlagged` arrives RESOLVED from the backend - true when the session was
// flagged explicitly OR its origin is Athena. Never recompute it here.

import { createContext, useCallback, useContext, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus, Power, PowerOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { setPersonaAthenaAutoFlag, setPersonaStarred } from '@/api/agents/personas';
import { setSessionAthenaFlag } from '@/api/fleet/fleet';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import type { PersonaCardModel } from '../../../monitorModel';
import { CompanionMark } from './CompanionMark';
import { mayBeLive } from './SessionMenu';

type Open = (card: PersonaCardModel, x: number, y: number) => void;
const MenuContext = createContext<Open | null>(null);

/** Every live session this persona owns: a flag applies to all of them at once. */
function useLiveSessions(personaId: string | null) {
  return useSystemStore(useShallow((s) => (personaId === null ? [] : s.fleetSessions.filter(
    (x) => x.personaId === personaId && mayBeLive(x),
  ))));
}

export function PersonaMenuProvider({ children, onQuickChat }: {
  children: ReactNode;
  /** The quick-chat seam. Absent until a composer is mounted; the item then hides. */
  onQuickChat?: (card: PersonaCardModel) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ card: PersonaCardModel; x: number; y: number } | null>(null);
  const open = useCallback<Open>((card, x, y) => setMenu({ card, x, y }), []);
  const close = useCallback(() => setMenu(null), []);
  const personaId = menu?.card.personaId ?? null;

  const persona = useAgentStore(useCallback(
    (s) => (personaId === null ? null : s.personas.find((p) => p.id === personaId) ?? null),
    [personaId],
  ));
  const setPersonaEnabled = useAgentStore((s) => s.setPersonaEnabled);
  const sessions = useLiveSessions(personaId);

  const starred = persona?.starred ?? false;
  const auto = persona?.athena_auto_flag ?? false;
  const flagged = sessions.filter((s) => s.athenaFlagged).length;
  // Tri-state. With no live session there is nothing to be partial about, so
  // the persona default alone decides.
  const athena: 'on' | 'off' | 'mixed' = sessions.length === 0
    ? (auto ? 'on' : 'off')
    : flagged === sessions.length ? 'on' : flagged === 0 ? 'off' : 'mixed';

  const toggleStar = useCallback((id: string, next: boolean) => {
    setPersonaStarred(id, next)
      .then(() => useAgentStore.getState().fetchPersonas())
      .catch(toastCatch('fleet/entry-e:persona-star'));
  }, []);

  const setAthena = useCallback((id: string, next: boolean) => {
    const live = useSystemStore.getState().fleetSessions.filter((x) => x.personaId === id && mayBeLive(x));
    Promise.all([
      ...live.map((x) => setSessionAthenaFlag(x.id, next)),
      setPersonaAthenaAutoFlag(id, next),
    ])
      .then(() => useAgentStore.getState().fetchPersonas())
      .catch(toastCatch('fleet/entry-e:persona-athena-flag'));
  }, []);

  const items: ContextMenuItem[] = menu ? [
    ...(onQuickChat ? [{
      id: 'quick-chat',
      label: t.monitor.persona_menu_quick_chat,
      icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
      testId: 'entry-e-persona-quick-chat',
      onSelect: () => onQuickChat(menu.card),
    }] : []),
    {
      id: 'overseer-star',
      label: starred ? t.monitor.persona_menu_unstar_overseer : t.monitor.persona_menu_star_overseer,
      icon: <CompanionMark companion="overseer" active={starred} />,
      testId: 'entry-e-persona-star',
      onSelect: () => toggleStar(menu.card.personaId, !starred),
    },
    {
      id: 'athena-flag',
      label: athena === 'on' ? t.monitor.persona_menu_unflag_athena
        : athena === 'mixed' ? t.monitor.persona_menu_flag_athena_mixed
          : t.monitor.persona_menu_flag_athena,
      icon: <CompanionMark companion="athena" active={athena === 'on'} />,
      hint: auto ? t.monitor.athena_flag_auto : undefined,
      testId: 'entry-e-persona-athena',
      onSelect: () => setAthena(menu.card.personaId, athena !== 'on'),
    },
    ...(menu.card.enabled !== null ? [{
      id: 'toggle-enabled',
      label: menu.card.enabled ? t.monitor.persona_menu_disable : t.monitor.persona_menu_enable,
      icon: menu.card.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />,
      separatorBefore: true,
      testId: 'entry-e-persona-enabled',
      onSelect: () => {
        setPersonaEnabled(menu.card.personaId, !menu.card.enabled)
          .catch(toastCatch('fleet/entry-e:persona-enabled', t.monitor.grid_menu_toggle_failed));
      },
    }] : []),
  ] : [];

  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={close}
          ariaLabel={t.monitor.persona_menu_aria}
          widthClass="w-56"
        />,
        document.body,
      )}
    </MenuContext.Provider>
  );
}

/** Spread onto a persona line: right-click, Shift+F10 and the Menu key. */
export function usePersonaMenu(card: PersonaCardModel) {
  const open = useContext(MenuContext);
  return useMemo(() => ({
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (!open) return;
      e.preventDefault();
      open(card, e.clientX, e.clientY);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!open || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      open(card, r.left + 12, r.top + r.height / 2);
    },
  }), [open, card]);
}
