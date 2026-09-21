import { Keyboard } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';

import { grokCopy } from './copy';
import { Keycap } from './Keycap';

const TITLE_ID = 'grok-desk-cheat-title';

interface Row {
  keys: string[];
  label: string;
}

const NAV: Row[] = [
  { keys: ['↑', '↓', '←', '→'], label: grokCopy.navArrows },
  { keys: ['j', 'k'], label: grokCopy.navVim },
  { keys: ['h', 'l'], label: grokCopy.navArrows },
  { keys: ['Home'], label: grokCopy.navHome },
  { keys: ['End'], label: grokCopy.navEnd },
  { keys: ['Enter'], label: grokCopy.navOpen },
];

const FILTER: Row[] = [
  { keys: ['/'], label: grokCopy.filterFind },
  { keys: ['Esc'], label: grokCopy.filterEsc },
  { keys: ['1', '2', '3'], label: grokCopy.filterStatus },
  { keys: ['⇧1–9'], label: grokCopy.filterProject },
  { keys: ['[', ']'], label: grokCopy.filterCycle },
];

const ACT: Row[] = [
  { keys: ['a'], label: grokCopy.actAsk },
  { keys: ['p'], label: grokCopy.actPublish },
  { keys: ['g'], label: grokCopy.actGoals },
  { keys: ['t'], label: grokCopy.actThread },
  { keys: ['r'], label: grokCopy.actReply },
  { keys: ['y'], label: grokCopy.actApprove },
  { keys: ['n'], label: grokCopy.actReject },
  { keys: ['Del'], label: grokCopy.actDelete },
  { keys: ['?'], label: grokCopy.actHelp },
];

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="typo-title text-primary">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3">
            <span className="flex items-center gap-1 shrink-0 w-28">
              {row.keys.map((k) => (
                <Keycap key={k}>{k}</Keycap>
              ))}
            </span>
            <span className="typo-body text-foreground/85">{row.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DeskCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId={TITLE_ID} size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="grok-desk-cheat">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="w-8 h-8 rounded-card bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Keyboard className="w-4 h-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="typo-heading text-foreground">
              {grokCopy.cheatTitle}
            </h2>
            <p className="typo-caption text-foreground/85">{grokCopy.cheatSubtitle}</p>
          </div>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 gap-5 sm:grid-cols-3 max-h-[60vh] overflow-y-auto">
          <Group title={grokCopy.groupNav} rows={NAV} />
          <Group title={grokCopy.groupFilter} rows={FILTER} />
          <Group title={grokCopy.groupAct} rows={ACT} />
        </div>
      </div>
    </BaseModal>
  );
}
