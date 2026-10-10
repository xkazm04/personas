/**
 * Everything the Notepad's QuestRoom expects from its host, assembled outside
 * the pad. The pad loads these when it opens; Goals > Progress has no pad open,
 * so it asks for them itself - once per mount, and every read is idempotent.
 *
 * The signals are built exactly as `QuestLogOverview` builds them (one pass,
 * no per-card subscription), with the rail lens off: there is no desk filter
 * here to dim against.
 */
import { useEffect, useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import {
  useNotepadPlanLive,
  useNotepadPlanSummaries,
  useNotepadSaveStates,
} from '@/features/notepad/useNotepad';
import { useNotesWorkingMap } from '@/features/notepad/thread/useNoteWorking';
import { loadThreadUnread, useNoteUnreadMap } from '@/features/notepad/thread/noteThreadStore';
import { buildZones, isLate, lateDays, type QuestZone } from '@/features/notepad/overview/questlog/questlogModel';
import type { GoalSignals } from '@/features/notepad/overview/questlog/goalSignals';

import { useBriefNotes } from '../useLayers';

export function useRoomData() {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.projects);
  const { notes } = useBriefNotes();
  const saveStates = useNotepadSaveStates();
  const summaries = useNotepadPlanSummaries();
  const working = useNotesWorkingMap();
  const unread = useNoteUnreadMap();
  useNotepadPlanLive();

  useEffect(() => {
    void loadThreadUnread().catch(silentCatch('GoalsLayers.notes.loadThreadUnread'));
  }, []);

  const signals = useMemo(() => {
    const out: Record<string, GoalSignals> = {};
    for (const note of notes) {
      const target = summaries[note.id]?.targetDate ?? null;
      out[note.id] = {
        unread: unread[note.id] ?? 0,
        workingSince: working[note.id]?.since ?? null,
        lateDays: isLate(target, note.status) ? lateDays(target!) : 0,
        onRail: true,
      };
    }
    return out;
  }, [notes, unread, working, summaries]);

  const zones = useMemo(() => buildZones(notes, projects, t.notepad.project_none), [notes, projects, t]);

  /** A project with no notes still gets a room: its milestones are the point. */
  const zoneFor = (projectId: string, name: string): QuestZone =>
    zones.find((z) => z.id === projectId) ?? { id: projectId, name, none: false, goals: [] as DevNote[] };

  return { projects, notes, saveStates, summaries, working, signals, zoneFor };
}
