import { useCallback, useMemo, useState } from 'react';
import type { Persona } from '@/lib/bindings/Persona';
import type { DrawerSection, PersonaCardModel } from '../monitorModel';

export interface Selection {
  personaId: string;
  section: DrawerSection;
}

/**
 * The Activity board's two drawers: a persona's (a card press) and a remote
 * session's (a `remote:<jobId>` tile). One drawer at a time: opening either
 * closes the other.
 */
export function useMonitorSelection(cards: PersonaCardModel[], personas: Persona[]) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [remoteJobId, setRemoteJobId] = useState<string | null>(null);
  // Stable open handler (takes personaId) so the memoized grid squares don't
  // re-render just because an inline onSelect closure changed identity.
  const handleCardSelect = useCallback(
    (personaId: string, section: DrawerSection) => {
      setRemoteJobId(null);
      setSelection({ personaId, section });
    },
    [],
  );
  const openRemote = useCallback((jobId: string) => {
    setSelection(null);
    setRemoteJobId(jobId);
  }, []);
  const closeRemote = useCallback(() => setRemoteJobId(null), []);
  const closeDrawer = useCallback(() => setSelection(null), []);
  const selectedCard = useMemo(
    () => cards.find((c) => c.personaId === selection?.personaId) ?? null,
    [cards, selection],
  );
  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selection?.personaId) ?? null,
    [personas, selection],
  );
  /** Escape's inner rungs: close the drawer, else the remote drawer. False when
   *  neither was open, so the Monitor itself is next. The third rung was the
   *  Board's team zoom (`takeBoardBack()`) and went with the Board view on
   *  2026-10-06. */
  const back = (): boolean => {
    if (selection) setSelection(null);
    else if (remoteJobId) setRemoteJobId(null);
    else return false;
    return true;
  };

  return {
    selection, remoteJobId, selectedCard, selectedPersona,
    handleCardSelect, openRemote, closeRemote, closeDrawer, back,
  };
}

export type MonitorSelection = ReturnType<typeof useMonitorSelection>;
