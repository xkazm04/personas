/**
 * EmptyArt motifs, part 1: things the user makes and runs (agents, credentials,
 * launches, templates, triggers, runs, schedules, teams, chat).
 *
 * Drawing conventions for every motif (both files):
 * - 96x96 grid, subject inside roughly 22..74 so it sits on the plate.
 * - Drawn strokes carry `pathLength={1}` and `ea-draw`; their order is `--d`.
 * - Exactly one ambient loop per motif, on an accent, never on the line work.
 */
import type { CSSProperties } from 'react';

/** Stagger helper: the CSS reads `--d` as the element's delay. */
export const at = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export function AgentsMotif() {
  return (
    <g>
      <rect className="ea-fill" x="28" y="36" width="40" height="32" rx="10" />
      <rect className="ea-line ea-draw" pathLength={1} x="28" y="36" width="40" height="32" rx="10" />
      <path className="ea-line ea-draw" pathLength={1} style={at(250)} d="M48 36 V26" />
      <g className="ea-pop" style={at(650)}>
        <circle className="ea-dot ea-pulse" style={at(0)} cx="48" cy="23" r="3.5" />
      </g>
      <g className="ea-fade" style={at(500)}>
        <rect className="ea-dot ea-blink" style={at(400)} x="37" y="47" width="6" height="7" rx="2" />
        <rect className="ea-dot ea-blink" style={at(400)} x="53" y="47" width="6" height="7" rx="2" />
      </g>
      <path className="ea-line ea-draw" pathLength={1} style={at(450)} d="M41 60 H55" />
      <path className="ea-line ea-draw" pathLength={1} style={at(350)} d="M28 50 H23 M68 50 H73" />
    </g>
  );
}

export function VaultMotif() {
  return (
    <g>
      <circle className="ea-fill" cx="37" cy="52" r="11" />
      <circle className="ea-line ea-draw" pathLength={1} cx="37" cy="52" r="11" />
      <circle className="ea-dot-ink ea-fade" style={at(500)} cx="37" cy="52" r="3" />
      <path className="ea-line ea-draw" pathLength={1} style={at(250)} d="M48 52 H72 M64 52 V60 M71 52 V58" />
      <g className="ea-pop" style={at(800)}>
        <path className="ea-line-accent ea-pulse" d="M67 26 V36 M62 31 H72" />
      </g>
      <circle className="ea-dot ea-fade" style={at(900)} cx="57" cy="30" r="1.8" />
    </g>
  );
}

export function LaunchMotif() {
  return (
    <g className="ea-float" style={at(0)}>
      <path className="ea-fill" d="M48 20 C58 28 60 42 56 56 H40 C36 42 38 28 48 20 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M48 20 C58 28 60 42 56 56 H40 C36 42 38 28 48 20 Z" />
      <circle className="ea-line-accent ea-draw" pathLength={1} style={at(350)} cx="48" cy="38" r="4.5" />
      <path className="ea-line ea-draw" pathLength={1} style={at(450)} d="M40 49 L32 60 L40 58 M56 49 L64 60 L56 58" />
      <g className="ea-pop" style={at(800)}>
        <path className="ea-dot-warn ea-pulse" style={at(0)} d="M43 60 Q48 76 53 60 Z" />
      </g>
    </g>
  );
}

export function TemplatesMotif() {
  return (
    <g>
      <rect className="ea-line ea-draw" pathLength={1} x="26" y="32" width="30" height="38" rx="6" transform="rotate(-8 41 51)" />
      <rect className="ea-fill" x="38" y="26" width="32" height="40" rx="6" />
      <rect className="ea-line ea-draw" pathLength={1} style={at(200)} x="38" y="26" width="32" height="40" rx="6" />
      <path className="ea-line ea-draw" pathLength={1} style={at(450)} d="M45 38 H63 M45 46 H59 M45 54 H55" />
      <g className="ea-pop" style={at(850)}>
        <path className="ea-dot ea-pulse" d="M72 18 L74 23 L79 25 L74 27 L72 32 L70 27 L65 25 L70 23 Z" />
      </g>
    </g>
  );
}

export function BoltMotif() {
  return (
    <g>
      <path className="ea-fill" d="M52 20 L32 52 H46 L42 76 L64 42 H50 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M52 20 L32 52 H46 L42 76 L64 42 H50 Z" />
      <circle className="ea-line-accent ea-ring" style={at(0)} cx="48" cy="48" r="20" />
      <circle className="ea-dot ea-pop" style={at(800)} cx="70" cy="28" r="2.5" />
      <circle className="ea-dot ea-pop" style={at(900)} cx="26" cy="66" r="2" />
    </g>
  );
}

export function RunsMotif() {
  return (
    <g>
      <circle className="ea-line ea-draw" pathLength={1} cx="48" cy="48" r="23" />
      <g className="ea-spin" style={at(0)}>
        <circle cx="48" cy="48" r="23" fill="none" stroke="transparent" />
        <circle className="ea-dot" cx="48" cy="25" r="3.5" />
      </g>
      <g className="ea-pop" style={at(450)}>
        <path className="ea-fill-strong" d="M43 37 L60 48 L43 59 Z" />
        <path className="ea-line-accent" d="M43 37 L60 48 L43 59 Z" />
      </g>
    </g>
  );
}

export function ScheduleMotif() {
  return (
    <g>
      <circle className="ea-fill" cx="48" cy="50" r="22" />
      <circle className="ea-line ea-draw" pathLength={1} cx="48" cy="50" r="22" />
      <path className="ea-line ea-draw" pathLength={1} style={at(300)} d="M48 31 V34 M48 66 V69 M29 50 H32 M64 50 H67" />
      <path className="ea-line ea-draw" pathLength={1} style={at(500)} d="M48 50 H58" />
      <g className="ea-fade" style={at(600)}>
        <path className="ea-line-accent ea-spin-base" style={at(0)} d="M48 50 V36" />
      </g>
      <circle className="ea-dot ea-pop" style={at(700)} cx="48" cy="50" r="2.5" />
      <path className="ea-line ea-draw" pathLength={1} style={at(200)} d="M35 26 L30 22 M61 26 L66 22" />
    </g>
  );
}

export function TeamMotif() {
  return (
    <g>
      <path className="ea-line ea-draw" pathLength={1} style={at(350)} d="M48 30 L30 62 H66 Z" />
      <circle className="ea-fill" cx="48" cy="30" r="8" />
      <circle className="ea-line ea-draw" pathLength={1} cx="48" cy="30" r="8" />
      <circle className="ea-fill" cx="30" cy="62" r="8" />
      <circle className="ea-line ea-draw" pathLength={1} style={at(150)} cx="30" cy="62" r="8" />
      <circle className="ea-fill" cx="66" cy="62" r="8" />
      <circle className="ea-line ea-draw" pathLength={1} style={at(250)} cx="66" cy="62" r="8" />
      <circle className="ea-dot ea-pop" style={at(800)} cx="48" cy="51" r="3" />
      <circle className="ea-line-accent ea-ring" style={at(200)} cx="48" cy="51" r="6" />
    </g>
  );
}

export function ChatMotif() {
  return (
    <g>
      <path className="ea-fill" d="M24 30 H72 V60 H44 L34 70 V60 H24 Z" />
      <path className="ea-line ea-draw" pathLength={1} d="M30 30 H66 Q72 30 72 36 V54 Q72 60 66 60 H44 L34 70 V60 H30 Q24 60 24 54 V36 Q24 30 30 30 Z" />
      <g className="ea-fade" style={at(600)}>
        <circle className="ea-dot ea-pulse" style={at(0)} cx="38" cy="45" r="3" />
        <circle className="ea-dot ea-pulse" style={at(250)} cx="48" cy="45" r="3" />
        <circle className="ea-dot ea-pulse" style={at(500)} cx="58" cy="45" r="3" />
      </g>
    </g>
  );
}
