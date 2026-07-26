// In-progress personas popover — opened from the island's persona badge.
//
// The badge answers "how many"; the popover answers "who, for how long, and
// where do I go to watch it". Each row carries the persona's live process
// status and elapsed time, and clicking navigates to the surface the process
// declared — the SAME `navigateTo` switch the Monitor's activity rows use, so
// the destination never depends on which surface the click came from. A row
// whose process declares no destination (or a demo island's) stays inert.
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';

import { elapsedStr, processStatusLabel, processStatusMeta } from '@/features/fleet/monitor/monitorModel';
import { useTranslation } from '@/i18n/useTranslation';

import { ListPopover } from './ListPopover';

/** One running persona as the popover renders it. Built by the page from the
 *  active-process map so this component stays free of the store. */
export interface PersonaRow {
  personaId: string;
  name: string;
  /** ActiveProcessStatus — drives the dot colour and the trailing label. */
  status: string;
  /** Epoch ms; null on demo islands (no real process behind the name). */
  startedAt: number | null;
  /** False when the process declares no destination — the row stays inert. */
  navigable: boolean;
}

export function PersonaListPopover({ rows, x, y, onOpen, onClose }: {
  rows: PersonaRow[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  /** Navigable row clicked — the page routes it and closes the popover. */
  onOpen: (personaId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // One tick per second so the elapsed column stays honest while it's open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <ListPopover
      title={t.mastermind.personas_title}
      icon={Bot}
      ink="var(--status-processing)"
      trailing={rows.length}
      x={x}
      y={y}
      width={268}
      maxListHeight={240}
      testId="mm-persona-list"
      onClose={onClose}
    >
      {rows.map((row) => {
        const meta = processStatusMeta(row.status);
        const trailing = row.startedAt != null
          ? elapsedStr(row.startedAt, now)
          : processStatusLabel(t, row.status);
        const body = (
          <>
            {/* the Monitor's own status dot — same vocabulary, same colours */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`} aria-hidden />
            <span className="truncate flex-1">{row.name}</span>
            <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{trailing}</span>
          </>
        );
        const layout = 'w-full flex items-center gap-2 px-3 py-2 text-left typo-body text-foreground/70';
        return (
          <li key={row.personaId}>
            {row.navigable ? (
              <button
                type="button"
                className={`${layout} rounded-md transition-colors hover:bg-secondary/40 hover:text-foreground focus-ring`}
                onClick={() => { onOpen(row.personaId); onClose(); }}
                title={t.mastermind.persona_open}
                data-testid={`mm-persona-row-${row.personaId}`}
              >
                {body}
              </button>
            ) : (
              <div className={`${layout} cursor-default`} data-testid={`mm-persona-row-${row.personaId}`}>{body}</div>
            )}
          </li>
        );
      })}
    </ListPopover>
  );
}
