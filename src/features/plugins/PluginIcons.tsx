/**
 * Custom animated SVG icons for the plugins, in the same visual language as the
 * 1st-level sidebar icons (`SidebarIcons.tsx`): single-color `currentColor`
 * strokes, maximal viewBox coverage, and the shared `pi-*` animation classes
 * (defined in globals.css) that run only when `active`.
 *
 * Concepts were generated with the `/leonardo` skill (see
 * `.claude/skills/leonardo/out/plugin-*.png`) and recreated here as theme-
 * adaptive stroke icons — the same workflow used for `IconTeamsFormation`.
 *
 * Each is unique to its plugin's metaphor and deliberately distinct from the
 * section icons it sits near:
 *  - dev-tools     → developer terminal console + prompt
 *  - obsidian-brain→ faceted obsidian crystal holding a neural network
 *  - drive         → stacked storage platters with an orbiting data ring
 *  - twin          → two mirrored android heads across a reflection seam
 *  - companion     → a glowing companion orb with a halo + spark
 */
import React from 'react';
import type { PluginTab } from '@/lib/types/types';

function a(cls: string, active: boolean) { return active ? cls : ''; }

interface IconProps { active?: boolean; className?: string }

// -- Dev Tools: terminal console with a command prompt --------------------
export function IconDevTools({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" opacity={active ? 0.7 : 0.5} />
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" opacity={active ? 0.05 : 0.02} />
      {/* Title bar */}
      <line x1="2" y1="8" x2="22" y2="8" stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.5 : 0.3} />
      <circle cx="4.5" cy="6" r="0.7" fill="currentColor" opacity={active ? 0.6 : 0.35} />
      <circle cx="6.7" cy="6" r="0.7" fill="currentColor" opacity={active ? 0.6 : 0.35} />
      <circle cx="8.9" cy="6" r="0.7" fill="currentColor" opacity={active ? 0.6 : 0.35} />
      {/* Prompt chevron */}
      <path d="M5.5 11.5l3 2.4-3 2.4" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity={active ? 0.85 : 0.55} />
      {/* Cursor line */}
      <line x1="10.5" y1="16.3" x2="16" y2="16.3" className={a('pi-pulse', active)} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={active ? 0.8 : 0.5} />
    </svg>
  );
}

// -- Obsidian Brain: faceted crystal holding a neural network -------------
export function IconObsidianBrain({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Crystal */}
      <path d="M12 2l8 6.5-8 13.5-8-13.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity={active ? 0.65 : 0.45} />
      <path d="M12 2l8 6.5-8 13.5-8-13.5z" fill="currentColor" opacity={active ? 0.05 : 0.02} />
      <line x1="4" y1="8.5" x2="20" y2="8.5" stroke="currentColor" strokeWidth="0.8" opacity={active ? 0.4 : 0.22} />
      <line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" strokeWidth="0.6" opacity={active ? 0.25 : 0.12} />
      {/* Neural nodes */}
      <circle cx="9" cy="11" r="1.1" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      <circle cx="15" cy="11" r="1.1" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" opacity={active ? 0.8 : 0.55} />
      <line x1="9" y1="11" x2="12" y2="15" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.55 : 0.2} />
      <line x1="15" y1="11" x2="12" y2="15" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.55 : 0.2} />
      <line x1="9" y1="11" x2="15" y2="11" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.55 : 0.2} />
    </svg>
  );
}

// -- Drive: stacked storage platters with an orbiting data ring -----------
export function IconDrive({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Orbiting data ring */}
      <ellipse cx="12" cy="12" rx="10.5" ry="4.2" stroke="currentColor" strokeWidth="0.7" strokeDasharray="2.5 3" className={a('pi-spin', active)} opacity={active ? 0.2 : 0.08} />
      {/* Storage cylinder */}
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.7 : 0.5} />
      <path d="M5.5 6.5v8.5c0 1.38 2.91 2.5 6.5 2.5s6.5-1.12 6.5-2.5V6.5" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.7 : 0.5} />
      <path d="M5.5 10.75c0 1.38 2.91 2.5 6.5 2.5s6.5-1.12 6.5-2.5" stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.4 : 0.22} />
      {/* Spindle activity */}
      <circle cx="12" cy="6.5" r="1" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
    </svg>
  );
}

// -- Twin: two mirrored android heads across a reflection seam ------------
export function IconTwin({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Reflection seam */}
      <line x1="12" y1="2.5" x2="12" y2="21.5" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.5 2" className={a('pi-pulse', active)} opacity={active ? 0.45 : 0.2} />
      {/* Left head */}
      <circle cx="9.5" cy="7.5" r="2.4" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.42} />
      <path d="M4.7 19c0-3 2-5 4.8-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity={active ? 0.6 : 0.42} />
      <circle cx="9.5" cy="7.5" r="0.9" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      {/* Right head (mirror) */}
      <circle cx="14.5" cy="7.5" r="2.4" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.42} />
      <path d="M19.3 19c0-3-2-5-4.8-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity={active ? 0.6 : 0.42} />
      <circle cx="14.5" cy="7.5" r="0.9" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
    </svg>
  );
}

// -- Companion: a glowing companion orb with a halo + spark ---------------
export function IconCompanion({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Halo */}
      <circle cx="11" cy="13" r="8.5" stroke="currentColor" strokeWidth="0.8" className={a('pi-pulse', active)} opacity={active ? 0.18 : 0.08} />
      <circle cx="11" cy="13" r="5.5" stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.5 : 0.32} />
      {/* Orb core */}
      <circle cx="11" cy="13" r="3" fill="currentColor" opacity={active ? 0.12 : 0.05} />
      <circle cx="11" cy="13" r="2" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.55} />
      {/* Spark */}
      <path d="M19 5l0.7 2.3L22 8l-2.3 0.7L19 11l-0.7-2.3L16 8l2.3-0.7z" fill="currentColor" className={a('pi-flicker', active)} opacity={active ? 0.85 : 0.5} />
    </svg>
  );
}

/** Map plugin id → custom illustrated icon. Plugins not listed fall back to
 *  their lucide icon at the call site. */
export const PLUGIN_ICONS: Partial<Record<PluginTab, (props: IconProps) => React.JSX.Element>> = {
  'dev-tools': IconDevTools,
  'obsidian-brain': IconObsidianBrain,
  drive: IconDrive,
  twin: IconTwin,
  companion: IconCompanion,
};
