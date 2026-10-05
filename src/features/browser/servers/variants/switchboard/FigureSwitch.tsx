/**
 * The Switchboard's power switch: a drawn figure (kit doctrine 6c) hosted in a
 * `buttons/Button`, so it keeps the house control's focus, press and
 * disabled-reason tooltip. AccessibleToggle is not used because its "on" is
 * green, and a running server is the theme primary here, with its glow.
 *
 * The row is the keyboard's tab stop (roving focus), so the button itself is
 * `tabIndex={-1}`: Space on the row toggles, a click on the switch toggles.
 */
import { Lock } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';

import type { SwitchPosition } from './switchboardModel';
import type { ServerTone } from '../../serverTone';

export function FigureSwitch({
  position,
  tone,
  pulse,
  inert,
  host,
  label,
  disabledReason,
  onToggle,
}: {
  position: SwitchPosition;
  tone: ServerTone;
  /** Scanning: the track breathes (reduced-motion gated in CSS). */
  pulse: boolean;
  inert: boolean;
  /** This server serves Personas itself: the thumb carries a lock. */
  host: boolean;
  label: string;
  disabledReason?: string;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      role="switch"
      aria-checked={position === 'on'}
      aria-label={label}
      tabIndex={-1}
      disabled={inert}
      disabledReason={disabledReason}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="sb-switch-hit"
      data-testid="server-toggle"
    >
      <span
        aria-hidden
        className={`sb-switch is-${position} sbt-${tone}${pulse ? ' is-pulse' : ''}${inert ? ' is-inert' : ''}`}
      >
        <span className="sb-switch__thumb">{host && <Lock className="w-3 h-3" />}</span>
      </span>
    </Button>
  );
}
