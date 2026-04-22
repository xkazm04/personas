// Time card — dispatches to one of three visual variants based on the
// TriggerSelection's mode. Event and Manual variants live here inline;
// the larger Clock variant is in its own file.

import { motion } from 'framer-motion';
import type { TriggerSelection } from '../useCasePickerShared';
import { ClockVariant } from './ucClockVariant';
import { Panel } from './ucPanel';
import type { TriggerDisplay } from './ucPickerTypes';

interface Props {
  display: TriggerDisplay;
  trigger: TriggerSelection;
  firing: boolean;
}

export function TimeCard({ display, trigger, firing }: Props) {
  if (display.mode === 'manual') {
    return (
      <Panel ariaLabel="Manual only" square>
        <ManualVariant />
      </Panel>
    );
  }
  if (display.mode === 'event') {
    return (
      <Panel ariaLabel="Event trigger" square>
        <EventVariant eventType={trigger.event?.eventType ?? ''} firing={firing} />
      </Panel>
    );
  }
  return (
    <Panel ariaLabel="Time trigger" square>
      <ClockVariant display={display} firing={firing} />
    </Panel>
  );
}

// ─── EventVariant — no clock; lightning bolt + event name ────────────────

function EventVariant({ eventType, firing }: { eventType: string; firing: boolean }) {
  const tail = (eventType.split('.').pop() ?? '—').toUpperCase();
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="relative flex items-center justify-center">
        <motion.span
          aria-hidden
          className="absolute w-28 h-28 rounded-full bg-status-info/10"
          animate={firing ? { scale: [0.85, 1.15, 0.85], opacity: [0.5, 0.15, 0.5] } : { scale: 1, opacity: 0.4 }}
          transition={firing ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        />
        <motion.span
          aria-hidden
          className="absolute w-20 h-20 rounded-full ring-2 ring-status-info/40"
          animate={firing ? { scale: [1, 1.25, 1], opacity: [1, 0, 1] } : {}}
          transition={firing ? { duration: 1.2, repeat: Infinity, ease: 'easeOut' } : undefined}
        />
        <svg viewBox="0 0 24 24" className="relative w-20 h-20" fill="none">
          <defs>
            <linearGradient id="uc-bolt-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--color-status-warning)" />
              <stop offset="100%" stopColor="var(--color-status-info)" />
            </linearGradient>
          </defs>
          <path
            d="M 13 2 L 5 13 L 11 13 L 9 22 L 19 9 L 13 9 Z"
            fill="url(#uc-bolt-grad)"
            stroke="var(--color-status-info)"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="mt-4 flex flex-col items-center gap-1">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-status-info font-semibold">
          On event
        </span>
        <span className="font-mono text-base font-bold text-foreground/90 truncate max-w-[180px]">
          {tail}
        </span>
        <span className="text-xs text-foreground/55 truncate max-w-[180px]">
          {eventType || 'pick an event to listen for'}
        </span>
      </div>
    </div>
  );
}

// ─── ManualVariant — empty state for no trigger ──────────────────────────

function ManualVariant() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="relative flex items-center justify-center">
        <span
          aria-hidden
          className="absolute w-24 h-24 rounded-full border-2 border-dashed border-foreground/15"
        />
        <svg viewBox="0 0 24 24" className="relative w-14 h-14 text-foreground/35" fill="none" stroke="currentColor">
          <path
            d="M 6 3 L 18 3 L 18 5 C 18 8 14 10 14 12 C 14 14 18 16 18 19 L 18 21 L 6 21 L 6 19 C 6 16 10 14 10 12 C 10 10 6 8 6 5 L 6 3 Z"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          <line x1="6" y1="3" x2="18" y2="3" strokeWidth={2} strokeLinecap="round" />
          <line x1="6" y1="21" x2="18" y2="21" strokeWidth={2} strokeLinecap="round" />
          <line x1="12" y1="10" x2="12" y2="14" strokeWidth={1} strokeOpacity={0.6} strokeLinecap="round" />
        </svg>
      </div>
      <div className="mt-4 flex flex-col items-center gap-1">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/50 font-semibold">
          Manual only
        </span>
        <span className="font-mono text-base font-bold text-foreground/70">—:—</span>
        <span className="text-xs text-foreground/45">run on demand</span>
      </div>
    </div>
  );
}
