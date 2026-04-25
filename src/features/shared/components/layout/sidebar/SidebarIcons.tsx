/**
 * Custom animated SVG sidebar icons for Personas.
 *
 * - Active: theme primary color, all animations running
 * - Inactive: foreground color (white in dark / black in light), static, lower opacity
 * - Icons maximise their viewBox coverage for visibility at small sizes
 */

import React from 'react';

// Styles for sidebar icon animations live in globals.css (pi-breathe, pi-flow, pi-pulse, pi-pulse-d).

function a(cls: string, active: boolean) { return active ? cls : ''; }

// -- Icon Props ----------------------------------------------------------

interface IconProps { active?: boolean; className?: string }

// -- Home: Hexagonal command hub -----------------------------------------

export function IconHome({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 1L22 6.5v11L12 23 2 17.5v-11z" stroke="currentColor" strokeWidth="1.5" opacity={active ? 0.4 : 0.25} />
      <path d="M12 3.5L20 8v8l-8 4.5L4 16V8z" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.7 : 0.5} />
      {/* Core node */}
      <circle cx="12" cy="12" r="3.5" fill="currentColor" opacity={active ? 0.12 : 0.06} />
      <circle cx="12" cy="12" r="2" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.6} />
      {/* Data conduits */}
      <line x1="12" y1="8" x2="12" y2="3.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.7 : 0.3} />
      <line x1="15.5" y1="12" x2="20" y2="12" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.7 : 0.3} />
      <line x1="12" y1="16" x2="12" y2="20.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.7 : 0.3} />
      <line x1="8.5" y1="12" x2="4" y2="12" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.7 : 0.3} />
      {/* Terminal nodes */}
      <circle cx="12" cy="3" r="1.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      <circle cx="20.5" cy="12" r="1.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
      <circle cx="12" cy="21" r="1.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      <circle cx="3.5" cy="12" r="1.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
    </svg>
  );
}

// -- Overview: HUD panels with live readouts -----------------------------

export function IconOverview({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Main panel */}
      <rect x="1" y="5" width="22" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" opacity={active ? 0.7 : 0.5} />
      <rect x="1" y="5" width="22" height="14" rx="2" fill="currentColor" opacity={active ? 0.06 : 0.03} />
      {/* Scan line */}
      <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="0.7" className={a('pi-scan', active)} opacity={active ? 0.5 : 0.15} />
      {/* Bar chart -- large, prominent */}
      <rect x="4" y="13" width="3" height="4" rx="0.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? 0.7 : 0.4} />
      <rect x="8.5" y="11" width="3" height="6" rx="0.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? 0.8 : 0.45} />
      <rect x="13" y="9" width="3" height="8" rx="0.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? 0.9 : 0.5} />
      <rect x="17.5" y="7.5" width="3" height="9.5" rx="0.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? 0.7 : 0.4} />
      {/* Top edge HUD detail */}
      <circle cx="4" cy="3" r="0.8" fill="currentColor" opacity={active ? 0.5 : 0.2} />
      <line x1="5.5" y1="3" x2="10" y2="3" stroke="currentColor" strokeWidth="0.8" className={a('pi-flow', active)} opacity={active ? 0.3 : 0.12} />
      <circle cx="20" cy="21" r="0.8" fill="currentColor" opacity={active ? 0.5 : 0.2} />
      <line x1="14" y1="21" x2="18.5" y2="21" stroke="currentColor" strokeWidth="0.8" className={a('pi-flow', active)} opacity={active ? 0.3 : 0.12} />
    </svg>
  );
}

// -- Agents: Neural face -- brain network inside head silhouette ----------

export function IconAgents({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Head silhouette */}
      <path d="M7 22v-2c0-2 -2-3.5 -2-6.5 0-4 3.2-7.5 7-7.5s7 3.5 7 7.5c0 3-2 4.5-2 6.5v2" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.35 : 0.2} strokeLinecap="round" />
      {/* Neural nodes -- large & visible */}
      <circle cx="12" cy="5" r="1.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      <circle cx="8" cy="9" r="1.6" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
      <circle cx="16" cy="9" r="1.6" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.4} />
      <circle cx="12" cy="12.5" r="2" fill="currentColor" opacity={active ? 0.85 : 0.6} />
      <circle cx="6.5" cy="14.5" r="1.4" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.35} />
      <circle cx="17.5" cy="14.5" r="1.4" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.35} />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.4} />
      {/* Neural connections */}
      <line x1="12" y1="5" x2="8" y2="9" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="12" y1="5" x2="16" y2="9" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="8" y1="9" x2="12" y2="12.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="16" y1="9" x2="12" y2="12.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="6.5" y1="14.5" x2="12" y2="12.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="17.5" y1="14.5" x2="12" y2="12.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="12" y1="18" x2="6.5" y2="14.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
      <line x1="12" y1="18" x2="17.5" y2="14.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.2} />
    </svg>
  );
}

// -- Events: Signal burst with lightning core ----------------------------

export function IconEvents({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="0.7" className={a('pi-pulse', active)} opacity={active ? 0.15 : 0.07} />
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="0.9" className={a('pi-pulse-d', active)} opacity={active ? 0.25 : 0.1} />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.1" className={a('pi-pulse', active)} opacity={active ? 0.35 : 0.15} />
      {/* Bold lightning bolt */}
      <path d="M13.5 2L7 13h4.5L10 22l7.5-12H13l.5-8z" fill="currentColor" opacity={active ? 0.7 : 0.45} />
      <path d="M13.5 2L7 13h4.5L10 22l7.5-12H13l.5-8z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity={active ? 0.9 : 0.6} />
      {/* Sparks */}
      <circle cx="4.5" cy="7" r="1" fill="currentColor" className={a('pi-flicker', active)} opacity={active ? undefined : 0.2} />
      <circle cx="19.5" cy="8" r="0.8" fill="currentColor" className={a('pi-flicker', active)} opacity={active ? undefined : 0.2} />
      <circle cx="5" cy="18" r="0.8" fill="currentColor" className={a('pi-flicker', active)} opacity={active ? undefined : 0.2} />
      <circle cx="19" cy="17" r="0.7" fill="currentColor" className={a('pi-flicker', active)} opacity={active ? undefined : 0.2} />
    </svg>
  );
}

// -- Keys: Shield with quantum lock --------------------------------------

export function IconKeys({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Orbiting rings */}
      <ellipse cx="12" cy="11" rx="10" ry="5" stroke="currentColor" strokeWidth="0.7" className={a('pi-spin', active)} opacity={active ? 0.18 : 0.08} />
      <ellipse cx="12" cy="11" rx="5" ry="10" stroke="currentColor" strokeWidth="0.7" className={a('pi-orbit-r', active)} opacity={active ? 0.18 : 0.08} />
      {/* Shield */}
      <path d="M12 1.5l8 4v5.5c0 5.5-3.5 10-8 12-4.5-2-8-6.5-8-12V5.5z" stroke="currentColor" strokeWidth="1.5" opacity={active ? 0.6 : 0.4} />
      <path d="M12 1.5l8 4v5.5c0 5.5-3.5 10-8 12-4.5-2-8-6.5-8-12V5.5z" fill="currentColor" opacity={active ? 0.07 : 0.03} />
      {/* Keyhole -- prominent */}
      <circle cx="12" cy="10" r="2.5" fill="currentColor" opacity={active ? 0.2 : 0.1} />
      <circle cx="12" cy="10" r="2" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.5} />
      <rect x="11" y="11.5" width="2" height="5" rx="1" fill="currentColor" opacity={active ? 0.5 : 0.3} />
      {/* Electrons */}
      {active && (
        <>
          <g className="pi-orbit"><circle cx="22" cy="11" r="1.2" fill="currentColor" opacity="0.8" /></g>
          <g className="pi-orbit-r"><circle cx="12" cy="1" r="1" fill="currentColor" opacity="0.6" /></g>
        </>
      )}
    </svg>
  );
}

// -- Templates: Blueprint layers with DNA helix --------------------------

export function IconTemplates({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Back layer */}
      <rect x="3" y="1" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.2 : 0.12} transform="translate(0.8, -0.3)" />
      {/* Mid layer */}
      <rect x="3" y="1" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1" opacity={active ? 0.4 : 0.25} />
      {/* Grid inside */}
      <line x1="5" y1="4" x2="19" y2="4" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
      <line x1="5" y1="6.5" x2="19" y2="6.5" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
      <line x1="5" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="0.5" opacity="0.15" />
      {/* Front layer */}
      <rect x="1" y="12" width="22" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" opacity={active ? 0.7 : 0.45} />
      <rect x="1" y="12" width="22" height="11" rx="2" fill="currentColor" opacity={active ? 0.05 : 0.02} />
      {/* DNA helix */}
      <path d="M5 14.5c3 1.5 5-1.5 7 0s5-1.5 7 0" className={a('pi-flow-s', active)} stroke="currentColor" strokeWidth="1.1" opacity={active ? 0.6 : 0.3} />
      <path d="M5 18c3-1.5 5 1.5 7 0s5 1.5 7 0" className={a('pi-flow-s', active)} stroke="currentColor" strokeWidth="1.1" opacity={active ? 0.6 : 0.3} />
      {/* Cross-rungs */}
      <line x1="8" y1="14.8" x2="8" y2="17.7" stroke="currentColor" strokeWidth="0.7" opacity={active ? 0.35 : 0.2} />
      <line x1="12" y1="14.5" x2="12" y2="18" stroke="currentColor" strokeWidth="0.7" opacity={active ? 0.35 : 0.2} />
      <line x1="16" y1="14.8" x2="16" y2="17.7" stroke="currentColor" strokeWidth="0.7" opacity={active ? 0.35 : 0.2} />
      <circle cx="12" cy="21" r="1.2" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.3} />
    </svg>
  );
}

// -- Teams: Constellation cluster ----------------------------------------

export function IconTeams({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Central ring */}
      <circle cx="12" cy="13" r="4.5" stroke="currentColor" strokeWidth="0.9" strokeDasharray="2.5 2.5" className={a('pi-spin', active)} opacity={active ? 0.25 : 0.1} />
      {/* Three persona nodes */}
      <circle cx="12" cy="3" r="3" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.4} />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.45} />
      <circle cx="3.5" cy="19" r="3" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.4} />
      <circle cx="3.5" cy="19" r="1.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.45} />
      <circle cx="20.5" cy="19" r="3" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.4} />
      <circle cx="20.5" cy="19" r="1.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.45} />
      {/* Bridges */}
      <line x1="12" y1="6" x2="6" y2="16.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.6 : 0.2} />
      <line x1="12" y1="6" x2="18" y2="16.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.6 : 0.2} />
      <line x1="6.5" y1="19" x2="17.5" y2="19" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.6 : 0.2} />
      {/* Central merge */}
      <circle cx="12" cy="13" r="2" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.4} />
    </svg>
  );
}

// -- Cloud: Mesh network -------------------------------------------------

export function IconCloud({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Cloud shape */}
      <path d="M5.5 19a5 5 0 01-.5-9.97 7 7 0 0114 0A5 5 0 0118.5 19H5.5z" stroke="currentColor" strokeWidth="1" opacity={active ? 0.3 : 0.18} />
      {/* Mesh nodes */}
      <circle cx="7.5" cy="12.5" r="1.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.35} />
      <circle cx="12" cy="9" r="1.8" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.35} />
      <circle cx="16.5" cy="12.5" r="1.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.35} />
      <circle cx="9.5" cy="16" r="1.5" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.35} />
      <circle cx="14.5" cy="16" r="1.5" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.35} />
      {/* Mesh connections */}
      <line x1="7.5" y1="12.5" x2="12" y2="9" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.18} />
      <line x1="12" y1="9" x2="16.5" y2="12.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.18} />
      <line x1="7.5" y1="12.5" x2="9.5" y2="16" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.18} />
      <line x1="16.5" y1="12.5" x2="14.5" y2="16" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.18} />
      <line x1="9.5" y1="16" x2="14.5" y2="16" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="0.9" opacity={active ? 0.6 : 0.18} />
      <line x1="12" y1="9" x2="9.5" y2="16" stroke="currentColor" strokeWidth="0.5" opacity={active ? 0.2 : 0.08} />
      <line x1="12" y1="9" x2="14.5" y2="16" stroke="currentColor" strokeWidth="0.5" opacity={active ? 0.2 : 0.08} />
    </svg>
  );
}

// -- Settings: Quantum calibrator ----------------------------------------

export function IconSettings({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="0.7" opacity={active ? 0.15 : 0.08} />
      <g className={a('pi-spin', active)} style={active ? undefined : { transform: 'none' }}>
        <circle cx="12" cy="1" r="1.5" fill="currentColor" opacity={active ? 0.5 : 0.3} />
        <circle cx="23" cy="12" r="1.5" fill="currentColor" opacity={active ? 0.5 : 0.3} />
        <circle cx="12" cy="23" r="1.5" fill="currentColor" opacity={active ? 0.5 : 0.3} />
        <circle cx="1" cy="12" r="1.5" fill="currentColor" opacity={active ? 0.5 : 0.3} />
      </g>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" opacity={active ? 0.3 : 0.18} />
      <g className={a('pi-orbit-r', active)} style={active ? undefined : { transform: 'none' }}>
        <circle cx="19" cy="12" r="1.2" fill="currentColor" opacity={active ? 0.7 : 0.4} />
        <circle cx="5" cy="12" r="1.2" fill="currentColor" opacity={active ? 0.7 : 0.4} />
      </g>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.2" opacity={active ? 0.45 : 0.25} />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" opacity={active ? 0.12 : 0.05} />
      <circle cx="12" cy="12" r="2" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.5} />
      {/* Cross-hairs */}
      <line x1="12" y1="5" x2="12" y2="8" stroke="currentColor" strokeWidth="0.8" opacity={active ? 0.4 : 0.2} />
      <line x1="12" y1="16" x2="12" y2="19" stroke="currentColor" strokeWidth="0.8" opacity={active ? 0.4 : 0.2} />
      <line x1="5" y1="12" x2="8" y2="12" stroke="currentColor" strokeWidth="0.8" opacity={active ? 0.4 : 0.2} />
      <line x1="16" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="0.8" opacity={active ? 0.4 : 0.2} />
    </svg>
  );
}

// -- Plugins: Circuit chip with connector pins ----------------------------

export function IconPlugins({ active = false, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Chip body */}
      <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" opacity={active ? 0.6 : 0.4} />
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" opacity={active ? 0.07 : 0.03} />
      {/* Core node */}
      <circle cx="12" cy="12" r="2.2" fill="currentColor" opacity={active ? 0.12 : 0.06} />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" className={a('pi-breathe', active)} opacity={active ? undefined : 0.5} />
      {/* Top pins */}
      <line x1="9.5" y1="7" x2="9.5" y2="3" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="12" y1="7" x2="12" y2="2" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="14.5" y1="7" x2="14.5" y2="3" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      {/* Bottom pins */}
      <line x1="9.5" y1="17" x2="9.5" y2="21" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="12" y1="17" x2="12" y2="22" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="14.5" y1="17" x2="14.5" y2="21" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      {/* Left pins */}
      <line x1="7" y1="9.5" x2="3" y2="9.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="7" y1="12" x2="2" y2="12" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="7" y1="14.5" x2="3" y2="14.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      {/* Right pins */}
      <line x1="17" y1="9.5" x2="21" y2="9.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="17" y1="12" x2="22" y2="12" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      <line x1="17" y1="14.5" x2="21" y2="14.5" className={a('pi-flow', active)} stroke="currentColor" strokeWidth="1" opacity={active ? 0.7 : 0.3} />
      {/* Pin tips */}
      <circle cx="9.5" cy="2.5" r="0.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.3} />
      <circle cx="14.5" cy="2.5" r="0.8" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.3} />
      <circle cx="9.5" cy="21.5" r="0.8" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.3} />
      <circle cx="14.5" cy="21.5" r="0.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.3} />
      <circle cx="2.5" cy="9.5" r="0.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.3} />
      <circle cx="2.5" cy="14.5" r="0.8" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.3} />
      <circle cx="21.5" cy="9.5" r="0.8" fill="currentColor" className={a('pi-pulse-d', active)} opacity={active ? undefined : 0.3} />
      <circle cx="21.5" cy="14.5" r="0.8" fill="currentColor" className={a('pi-pulse', active)} opacity={active ? undefined : 0.3} />
    </svg>
  );
}

/** Map section ID -> custom icon */
export const SIDEBAR_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  home: IconHome,
  overview: IconOverview,
  personas: IconAgents,
  events: IconEvents,
  credentials: IconKeys,
  'design-reviews': IconTemplates,
  plugins: IconPlugins,
  team: IconTeams,
  cloud: IconCloud,
  settings: IconSettings,
};
