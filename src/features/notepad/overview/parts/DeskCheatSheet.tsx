import { Keyboard } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { BaseModal } from '@/features/shared/components/modals';

import { DESK_KEY, Keycap } from './Keycap';

const TITLE_ID = 'notepad-desk-cheat-title';

interface Row {
  keys: string[];
  /** Resolved against the live translations, never stored as text. */
  label: (t: Translations) => string;
}

const NAV: Row[] = [
  { keys: [DESK_KEY.up, DESK_KEY.down, DESK_KEY.left, DESK_KEY.right], label: (t) => t.notepad.desk_key_arrows },
  { keys: [DESK_KEY.h, DESK_KEY.l], label: (t) => t.notepad.desk_key_left_right },
  { keys: [DESK_KEY.j, DESK_KEY.k], label: (t) => t.notepad.desk_key_prev_next },
  { keys: [DESK_KEY.home], label: (t) => t.notepad.desk_key_first },
  { keys: [DESK_KEY.end], label: (t) => t.notepad.desk_key_last },
  { keys: [DESK_KEY.enter], label: (t) => t.notepad.desk_key_open },
];

const FILTER: Row[] = [
  { keys: [DESK_KEY.find], label: (t) => t.notepad.desk_search_placeholder },
  { keys: [DESK_KEY.escape], label: (t) => t.notepad.desk_key_escape },
  { keys: [DESK_KEY.rail1, DESK_KEY.rail2, DESK_KEY.rail3], label: (t) => t.notepad.desk_key_rails },
  { keys: [DESK_KEY.projectJump], label: (t) => t.notepad.desk_key_project },
  { keys: [DESK_KEY.bracketOpen, DESK_KEY.bracketClose], label: (t) => t.notepad.desk_key_cycle },
];

const ACT: Row[] = [
  { keys: [DESK_KEY.ask], label: (t) => t.notepad.ask_athena },
  { keys: [DESK_KEY.publish], label: (t) => t.notepad.menu_publish_fleet },
  { keys: [DESK_KEY.goals], label: (t) => t.notepad.menu_to_goals },
  { keys: [DESK_KEY.thread], label: (t) => t.notepad.thread_open },
  { keys: [DESK_KEY.reply], label: (t) => t.notepad.desk_key_reply },
  { keys: [DESK_KEY.approve], label: (t) => t.notepad.desk_key_approve },
  { keys: [DESK_KEY.reject], label: (t) => t.notepad.desk_key_reject },
  { keys: [DESK_KEY.del], label: (t) => t.notepad.menu_delete_permanently },
  { keys: [DESK_KEY.help], label: (t) => t.notepad.desk_key_help },
];

function Group({ title, rows, t }: { title: string; rows: Row[]; t: Translations }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="typo-title text-primary">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.keys.join(' ')} className="flex items-center gap-3">
            <span className="flex items-center gap-1 shrink-0 w-28">
              {row.keys.map((k) => (
                <Keycap key={k}>{k}</Keycap>
              ))}
            </span>
            <span className="typo-body text-foreground/85">{row.label(t)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The full key map, one `?` away — three groups, every verb the desk answers to. */
export function DeskCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId={TITLE_ID} size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="notepad-desk-cheat">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="w-8 h-8 rounded-card bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Keyboard className="w-4 h-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="typo-heading text-foreground">
              {t.notepad.desk_keys_title}
            </h2>
            <p className="typo-caption text-foreground/85">{t.notepad.desk_keys_subtitle}</p>
          </div>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 gap-5 sm:grid-cols-3 max-h-[60vh] overflow-y-auto">
          <Group title={t.notepad.desk_move} rows={NAV} t={t} />
          <Group title={t.notepad.desk_filter} rows={FILTER} t={t} />
          <Group title={t.notepad.desk_selected_note} rows={ACT} t={t} />
        </div>
      </div>
    </BaseModal>
  );
}
