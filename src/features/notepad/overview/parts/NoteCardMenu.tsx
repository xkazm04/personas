/* eslint-disable custom/enforce-base-modal --
 * `NoteAskQuickInput` is a one-field popover at the right-click point, not a
 * modal: no backdrop, outside-click and Escape dismiss it, and the card it is
 * about stays visible under it. */
// The desk card's right-click menu, and the quick-ask input it opens.
//
// Every item is gated by the SAME predicate the editor's dispatch bar uses for
// that verb, so the menu can never offer a move the bar would refuse:
//   Ask Athena  — `noteAskBlocked` (noteGuards), reason as the item's hint
//   Publish / Turn into goals / Link milestone — a draft with a project
//   Archive     — every open note (the server allows any → archived)
//   Delete permanently — every status, EXCEPT while a Fleet session still holds
//                 the note (`noteDeleteBlocked`), routed through the host's
//                 ConfirmDialog — never a one-click delete.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Archive, Link2, Maximize2, Rocket, Sparkles, Target, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Translations } from '@/i18n/generated/types';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { NOTEPAD_POPOVER_Z } from '../../notepadLayers';
import { askAthena } from '../../notepadActions';
import { noteAskBlockedReasonKey, noteDeleteBlocked } from '../../noteGuards';

export interface NoteCardMenuHandlers {
  onOpen: () => void;
  onAsk: () => void;
  onPublish: () => void;
  onToGoals: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** The menu's rows for one note. Pure — exported for tests. */
export function noteCardMenuItems(
  note: DevNote,
  fleetSessions: readonly FleetSession[],
  t: Translations,
  h: NoteCardMenuHandlers,
): ContextMenuItem[] {
  const askKey = noteAskBlockedReasonKey(note);
  const dispatchBlocked = !note.projectId || note.status !== 'draft';
  const dispatchHint = dispatchBlocked
    ? (note.projectId ? t.notepad.dispatch_needs_draft : t.notepad.dispatch_needs_project)
    : undefined;
  const deleteBlocked = noteDeleteBlocked(note, fleetSessions);
  return [
    { id: 'open', label: t.notepad.menu_open, icon: <Maximize2 className="w-3.5 h-3.5" />, testId: 'notepad-card-menu-open', onSelect: h.onOpen },
    {
      id: 'ask',
      label: t.notepad.menu_ask_athena,
      icon: <Sparkles className="w-3.5 h-3.5" />,
      disabled: askKey !== null,
      hint: askKey ? t.notepad[askKey] : undefined,
      separatorBefore: true,
      testId: 'notepad-card-menu-ask',
      onSelect: h.onAsk,
    },
    {
      id: 'publish',
      label: t.notepad.menu_publish_fleet,
      icon: <Rocket className="w-3.5 h-3.5" />,
      disabled: dispatchBlocked,
      hint: dispatchHint,
      testId: 'notepad-card-menu-publish',
      onSelect: h.onPublish,
    },
    {
      id: 'goals',
      label: t.notepad.menu_to_goals,
      icon: <Target className="w-3.5 h-3.5" />,
      disabled: dispatchBlocked,
      testId: 'notepad-card-menu-goals',
      onSelect: h.onToGoals,
    },
    {
      // The picker lives in the editor's dispatch bar; the menu opens the note
      // there rather than growing a second picker with a second fetch path.
      id: 'link',
      label: t.notepad.menu_link_milestone,
      icon: <Link2 className="w-3.5 h-3.5" />,
      disabled: dispatchBlocked,
      testId: 'notepad-card-menu-link',
      onSelect: h.onOpen,
    },
    {
      id: 'archive',
      label: t.notepad.menu_archive,
      icon: <Archive className="w-3.5 h-3.5" />,
      separatorBefore: true,
      testId: 'notepad-card-menu-archive',
      onSelect: h.onArchive,
    },
    {
      id: 'delete',
      label: t.notepad.menu_delete_permanently,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      separatorBefore: true,
      disabled: deleteBlocked,
      hint: deleteBlocked ? t.notepad.menu_delete_blocked_running : undefined,
      testId: 'notepad-card-menu-delete',
      onSelect: h.onDelete,
    },
  ];
}

export function NoteCardMenu({
  note,
  x,
  y,
  handlers,
  onClose,
}: {
  note: DevNote;
  x: number;
  y: number;
  handlers: NoteCardMenuHandlers;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The whole list, shallow-compared: the delete gate reads every session's
  // name and state, and the menu is open for seconds, not a render loop.
  const fleetSessions = useSystemStore(useShallow((s) => s.fleetSessions));
  // Portaled: the card sits in a framer `layout` wrapper, and a `position:
  // fixed` menu under a transformed ancestor is placed against that ancestor,
  // not the viewport — the click point would be wrong mid-animation.
  return createPortal(
    <ContextMenu
      x={x}
      y={y}
      items={noteCardMenuItems(note, fleetSessions, t, handlers)}
      onClose={onClose}
      ariaLabel={t.notepad.menu_label}
      widthClass="w-64"
      zIndex={NOTEPAD_POPOVER_Z}
    />,
    document.body,
  );
}

/**
 * "Ask Athena…" from the menu: one field at the right-click point. Enter sends
 * through `askAthena(note, focus)` — the same door as the dispatch bar's button,
 * which also opens the note's Athena wait, so the card's presence chip lights.
 */
export function NoteAskQuickInput({
  note,
  x,
  y,
  onClose,
}: {
  note: DevNote;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLFormElement>(null);
  const [focus, setFocus] = useState('');
  const sending = useRef(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const submit = async () => {
    if (sending.current) return;
    sending.current = true;
    const r = await askAthena(note, focus.trim() || undefined).finally(() => {
      sending.current = false;
    });
    if (r.ok) {
      useToastStore.getState().addToast(t.notepad.ask_athena_sent, 'success');
      onClose();
    }
  };

  const width = 320;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 64));

  return createPortal(
    <motion.form
      ref={ref}
      role="dialog"
      aria-label={t.notepad.menu_ask_athena}
      data-testid={`notepad-card-ask-${note.id}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 32 }}
      style={{ position: 'fixed', left, top, width, zIndex: NOTEPAD_POPOVER_Z }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex items-center gap-2 px-3 py-2 rounded-card border border-brand-purple/35 bg-background/95 backdrop-blur-md shadow-elevation-3"
    >
      <Sparkles className="w-4 h-4 shrink-0 text-brand-purple" aria-hidden />
      <input
        type="text"
        autoFocus
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Handled here: the pad's Escape ladder stops at a prevented event.
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder={t.notepad.menu_ask_placeholder}
        aria-label={t.notepad.menu_ask_placeholder}
        data-testid={`notepad-card-ask-input-${note.id}`}
        className="flex-1 min-w-0 bg-transparent typo-body text-foreground placeholder:text-foreground/60 outline-none"
      />
    </motion.form>,
    document.body,
  );
}
