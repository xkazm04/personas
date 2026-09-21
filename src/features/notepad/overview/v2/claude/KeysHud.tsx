// The `?` cheat sheet — as a HUD, not a modal.
//
// It floats over the corner of the desk and keeps the keyboard live under it,
// so the operator can read a key and press it in the same breath instead of
// memorising, closing, and trying. Rows that do nothing for the selected note
// right now are dimmed, so the sheet also answers "what can I do HERE?".
import { motion } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { DeskAction } from './deskKeyModel';
import { COPY } from './copy';
import { Keycap } from './Keycap';

interface KeyRow {
  keys: readonly string[];
  label: string;
  /** Dim the row unless this action is available on the selected note. */
  action?: DeskAction;
}

export function KeysHud({
  available,
  onClose,
}: {
  /** The actions the selected note can take right now (empty with no selection). */
  available: ReadonlySet<DeskAction>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const groups: Array<{ title: string; rows: KeyRow[] }> = [
    {
      title: COPY.keys_group_move,
      rows: [
        { keys: ['←', '↑', '→', '↓'], label: COPY.key_move },
        { keys: ['j', 'k'], label: COPY.key_next_prev },
        { keys: [COPY.keycap_home, COPY.keycap_end], label: COPY.key_ends },
        { keys: ['↵', 'o'], label: COPY.key_open, action: 'open' },
      ],
    },
    {
      title: COPY.keys_group_filter,
      rows: [
        { keys: ['/'], label: COPY.key_find },
        { keys: ['c'], label: COPY.key_write },
        { keys: ['1', '2', '3'], label: COPY.key_status },
        { keys: ['[', ']'], label: COPY.key_project },
        { keys: ['0'], label: COPY.key_project_all },
        { keys: [COPY.keycap_esc], label: COPY.key_escape },
      ],
    },
    {
      title: COPY.keys_group_note,
      rows: [
        { keys: ['a'], label: COPY.key_ask, action: 'ask' },
        { keys: ['i'], label: COPY.key_edit, action: 'edit' },
        { keys: ['s'], label: COPY.key_step, action: 'step' },
        { keys: ['p'], label: COPY.key_publish, action: 'publish' },
        { keys: ['g'], label: COPY.key_goals, action: 'goals' },
        { keys: ['m'], label: COPY.key_menu, action: 'menu' },
        { keys: ['e'], label: COPY.key_archive, action: 'archive' },
        { keys: [COPY.keycap_del], label: COPY.key_delete, action: 'delete' },
      ],
    },
    {
      title: COPY.keys_group_review,
      rows: [
        { keys: ['t'], label: COPY.key_thread, action: 'thread' },
        { keys: ['r'], label: COPY.key_reply, action: 'reply' },
        { keys: ['y'], label: COPY.key_approve, action: 'approve' },
        { keys: ['n'], label: COPY.key_reject, action: 'reject' },
        { keys: ['?'], label: COPY.key_keys },
      ],
    },
  ];

  return (
    <motion.aside
      aria-label={COPY.keys_title}
      data-testid="notepad-v2c-keys"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
      style={{ transformOrigin: 'bottom right' }}
      className="absolute right-6 bottom-14 z-40 w-[34rem] max-w-[calc(100%-3rem)] rounded-modal border border-primary/20 bg-background/95 backdrop-blur-md shadow-elevation-4"
    >
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10">
        <Keyboard className="w-4 h-4 text-primary" aria-hidden />
        <h3 className="typo-heading text-foreground">{COPY.keys_title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          data-testid="notepad-v2c-keys-close"
          className="ml-auto w-7 h-7 rounded-input flex items-center justify-center text-foreground hover:bg-secondary/50 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-3.5">
        {groups.map((group, gi) => (
          <motion.section
            key={group.title}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { delay: 0.04 * gi, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-1.5"
          >
            <h4 className="typo-label text-primary">{group.title}</h4>
            <ul className="flex flex-col gap-1">
              {group.rows.map((row) => {
                const live = !row.action || available.has(row.action);
                return (
                  <li
                    key={row.label}
                    className={`flex items-center gap-2 transition-opacity duration-200 ${live ? 'opacity-100' : 'opacity-40'}`}
                  >
                    <span className="shrink-0 flex items-center gap-0.5 min-w-[4.5rem]">
                      {row.keys.map((k) => (
                        <Keycap key={k}>{k}</Keycap>
                      ))}
                    </span>
                    <span className="typo-caption text-foreground truncate">{row.label}</span>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        ))}
      </div>
    </motion.aside>
  );
}
