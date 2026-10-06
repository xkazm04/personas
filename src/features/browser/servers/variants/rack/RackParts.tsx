/**
 * The hardware of one rack unit: lamp, port display, tech badges, readout and
 * power switch. Presentation only; the unit decides what each one shows.
 */
import { Power } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { resolveTechIcon } from '@/features/shared/components/display/techIcons';
import type { DevServerState } from '@/lib/bindings/DevServerState';

import { SERVER_TONE } from '../../serverTone';

/** The `rk-t-*` class that sets `--rk-tone` for a state. */
export function toneClass(state: DevServerState): string {
  return `rk-t-${SERVER_TONE[state].tone}`;
}

/** A lamp is lit whenever the state carries a colour; off states stay dark glass. */
export function isLitState(state: DevServerState): boolean {
  return SERVER_TONE[state].tone !== 'off';
}

export function Lamp({ state }: { state: DevServerState }) {
  const lit = isLitState(state);
  const motion = state === 'scanning' ? 'is-scan' : SERVER_TONE[state].pulse ? 'is-breathe' : '';
  return <span aria-hidden className={`rk-lamp ${lit ? 'is-lit' : ''} ${motion}`.trim()} />;
}

export function PortWindow({ port, lit, label }: { port: number; lit: boolean; label: string }) {
  return (
    <span className={`rk-win rk-port rounded-input typo-heading-lg ${lit ? 'is-lit' : ''}`} aria-label={`${label} ${port}`}>
      {port}
    </span>
  );
}

const MAX_BADGES = 5;

/** One glass socket per stack element: the brand mark when one resolves, its name otherwise. */
export function TechBadges({ tokens }: { tokens: string[] }) {
  const shown = tokens.slice(0, MAX_BADGES);
  const rest = tokens.length - shown.length;
  return (
    <span className="rk-badges">
      {shown.map((label) => {
        const match = resolveTechIcon(label);
        return (
          <Tooltip key={label} content={label}>
            {match ? (
              <span className="rk-badge rounded-input" aria-label={label} role="img">
                <svg width={16} height={16} viewBox="0 0 24 24" fill={match.icon.color ?? 'currentColor'} aria-hidden>
                  <path d={match.icon.path} />
                </svg>
              </span>
            ) : (
              <span className="rk-badge rounded-input typo-code">{label}</span>
            )}
          </Tooltip>
        );
      })}
      {rest > 0 && <span className="rk-badge rounded-input typo-code rk-muted">+{rest}</span>}
    </span>
  );
}

/** The readout window: uptime for ours, the owning pid for an external listener. */
export function Readout({ text, lit }: { text: string | null; lit: boolean }) {
  return (
    <span className={`rk-win rk-readout rounded-input typo-data ${text ? '' : 'is-idle'} ${lit ? 'rk-ink' : 'rk-muted'}`}>
      {text}
    </span>
  );
}

interface PowerSwitchProps {
  on: boolean;
  label: string;
  /** Why the switch is inert, or null when it acts. */
  inertReason: string | null;
  onPress: () => void;
}

export function PowerSwitch({ on, label, inertReason, onPress }: PowerSwitchProps) {
  return (
    <Button
      variant="ghost"
      size="xs"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="rk-switch"
      data-testid="rack-power"
      disabled={inertReason != null}
      disabledReason={inertReason ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      <span className="rk-lever" aria-hidden>
        <Power className="w-3.5 h-3.5" strokeWidth={2.5} />
      </span>
    </Button>
  );
}
