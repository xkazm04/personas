import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, BarChart3, Bot, Zap, Key, FlaskConical, Users, Cloud, Settings,
} from 'lucide-react';

// ── Animated SVG Icon Styles (injected once) ────────────────────────────

const ICON_STYLES = `
  .pi-pulse { animation: pi-pulse 2.5s ease-in-out infinite; }
  .pi-pulse-delay { animation: pi-pulse 2.5s ease-in-out infinite 0.8s; }
  .pi-flow { stroke-dasharray: 3 3; animation: pi-flow 1.5s linear infinite; }
  .pi-flow-slow { stroke-dasharray: 4 4; animation: pi-flow 3s linear infinite; }
  .pi-orbit { animation: pi-orbit 8s linear infinite; transform-origin: 12px 12px; }
  .pi-orbit-r { animation: pi-orbit 6s linear infinite reverse; transform-origin: 12px 12px; }
  .pi-breathe { animation: pi-breathe 3s ease-in-out infinite; }
  .pi-scan { animation: pi-scan 2s ease-in-out infinite; }
  .pi-flicker { animation: pi-flicker 3s step-end infinite; }
  .pi-spin-slow { animation: pi-orbit 12s linear infinite; transform-origin: 12px 12px; }

  @keyframes pi-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
  @keyframes pi-flow {
    0% { stroke-dashoffset: 12; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes pi-orbit {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes pi-breathe {
    0%, 100% { r: 1.5; opacity: 0.4; }
    50% { r: 2.2; opacity: 0.8; }
  }
  @keyframes pi-scan {
    0%, 100% { transform: translateY(0); opacity: 0.3; }
    50% { transform: translateY(-2px); opacity: 0.7; }
  }
  @keyframes pi-flicker {
    0%, 100% { opacity: 0.8; }
    33% { opacity: 0.2; }
    66% { opacity: 0.6; }
  }
`;

// ── Custom Icons — Neural/Circuit AI Visual Language ────────────────────

/** Home: Command hub — central node with radiating data conduits to 4 quadrant rooms */
function CustomHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Hexagonal shell */}
      <path d="M12 2L21 7v10l-9 5-9-5V7z" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
      <path d="M12 4L19 8v8l-7 4-7-4V8z" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* Central core with breathing glow */}
      <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.08" />
      <circle cx="12" cy="12" className="pi-breathe" fill="currentColor" />
      {/* Data conduits — animated flow lines to corners */}
      <line x1="12" y1="9" x2="12" y2="4" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      <line x1="15" y1="12" x2="19" y2="12" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      <line x1="12" y1="15" x2="12" y2="20" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      <line x1="9" y1="12" x2="5" y2="12" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      {/* Terminal nodes */}
      <circle cx="12" cy="4" r="1" fill="currentColor" className="pi-pulse" />
      <circle cx="19" cy="12" r="1" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="12" cy="20" r="1" fill="currentColor" className="pi-pulse" />
      <circle cx="5" cy="12" r="1" fill="currentColor" className="pi-pulse-delay" />
    </svg>
  );
}

/** Overview: Holographic data panels — three floating HUD screens with live readouts */
function CustomOverview() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Back panel */}
      <rect x="2" y="3" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="3.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="0.6" className="pi-flow" opacity="0.4" />
      <line x1="3.5" y1="7" x2="6" y2="7" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      {/* Mid panel — main focus */}
      <rect x="6" y="7" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" opacity="0.7" />
      <rect x="6" y="7" width="12" height="8" rx="1" fill="currentColor" opacity="0.04" />
      {/* Scan line inside main panel */}
      <line x1="7.5" y1="10" x2="16.5" y2="10" stroke="currentColor" strokeWidth="0.5" className="pi-scan" />
      {/* Bar chart inside */}
      <rect x="8" y="12" width="1.5" height="2" fill="currentColor" opacity="0.5" className="pi-pulse" />
      <rect x="10.5" y="11" width="1.5" height="3" fill="currentColor" opacity="0.6" className="pi-pulse-delay" />
      <rect x="13" y="10" width="1.5" height="4" fill="currentColor" opacity="0.7" className="pi-pulse" />
      <rect x="15.5" y="9.5" width="1.5" height="4.5" fill="currentColor" opacity="0.5" className="pi-pulse-delay" />
      {/* Front panel */}
      <rect x="14" y="16" width="8" height="5" rx="1" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="15.5" y1="18" x2="20.5" y2="18" stroke="currentColor" strokeWidth="0.6" className="pi-flow" opacity="0.3" />
      {/* Connection lines between panels */}
      <path d="M6 6L8 8" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 1.5" opacity="0.2" />
      <path d="M18 15L16 16" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 1.5" opacity="0.2" />
    </svg>
  );
}

/** Agents: Neural face — abstract head silhouette made of connected nodes (brain-like network) */
function CustomAgents() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Head outline — stylized silhouette */}
      <path d="M8 20v-2a4 4 0 010-8h0a8 8 0 018 0h0a4 4 0 010 8v2" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      {/* Neural network inside the head shape */}
      <circle cx="9" cy="8" r="1.2" fill="currentColor" className="pi-pulse" />
      <circle cx="15" cy="8" r="1.2" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="12" cy="5" r="1" fill="currentColor" className="pi-pulse" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" opacity="0.7" />
      <circle cx="7" cy="13" r="1" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="17" cy="13" r="1" fill="currentColor" className="pi-pulse" />
      <circle cx="12" cy="16" r="1" fill="currentColor" className="pi-pulse-delay" />
      {/* Neural connections */}
      <line x1="9" y1="8" x2="12" y2="11" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="15" y1="8" x2="12" y2="11" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="12" y1="5" x2="9" y2="8" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="12" y1="5" x2="15" y2="8" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="7" y1="13" x2="12" y2="11" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="17" y1="13" x2="12" y2="11" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="12" y1="16" x2="7" y2="13" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      <line x1="12" y1="16" x2="17" y2="13" className="pi-flow" stroke="currentColor" strokeWidth="0.7" />
      {/* "Eyes" — two glowing dots */}
      <circle cx="10" cy="11" r="0.6" fill="currentColor" opacity="0.9" />
      <circle cx="14" cy="11" r="0.6" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** Events: Signal burst — expanding concentric rings with a lightning core */
function CustomEvents() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Expanding signal rings */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="0.5" opacity="0.1" className="pi-pulse" />
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="0.7" opacity="0.2" className="pi-pulse-delay" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="0.9" opacity="0.3" className="pi-pulse" />
      {/* Lightning bolt core */}
      <path d="M13 4l-4 7h3.5l-1 5.5 5-7h-4l.5-5.5z" fill="currentColor" opacity="0.6" />
      <path d="M13 4l-4 7h3.5l-1 5.5 5-7h-4l.5-5.5z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
      {/* Spark particles */}
      <circle cx="6" cy="8" r="0.7" fill="currentColor" className="pi-flicker" />
      <circle cx="18" cy="9" r="0.5" fill="currentColor" className="pi-flicker" />
      <circle cx="7" cy="17" r="0.6" fill="currentColor" className="pi-flicker" />
      <circle cx="17" cy="16" r="0.5" fill="currentColor" className="pi-flicker" />
    </svg>
  );
}

/** Keys: Quantum lock — orbiting electron ring around a keyhole core */
function CustomKeys() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Orbiting electron rings */}
      <ellipse cx="12" cy="10" rx="9" ry="4" stroke="currentColor" strokeWidth="0.6" opacity="0.15" className="pi-spin-slow" />
      <ellipse cx="12" cy="10" rx="4" ry="9" stroke="currentColor" strokeWidth="0.6" opacity="0.15" className="pi-orbit-r" />
      {/* Shield/lock body */}
      <path d="M12 3l6 3v4c0 4.5-2.5 8.5-6 10-3.5-1.5-6-5.5-6-10V6z" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <path d="M12 3l6 3v4c0 4.5-2.5 8.5-6 10-3.5-1.5-6-5.5-6-10V6z" fill="currentColor" opacity="0.05" />
      {/* Keyhole */}
      <circle cx="12" cy="10" r="2" fill="currentColor" opacity="0.15" />
      <circle cx="12" cy="10" className="pi-breathe" fill="currentColor" />
      <rect x="11.3" y="11" width="1.4" height="4" rx="0.7" fill="currentColor" opacity="0.4" />
      {/* Orbiting electrons */}
      <g className="pi-orbit">
        <circle cx="21" cy="10" r="0.8" fill="currentColor" opacity="0.7" />
      </g>
      <g className="pi-orbit-r">
        <circle cx="12" cy="1" r="0.8" fill="currentColor" opacity="0.5" />
      </g>
    </svg>
  );
}

/** Templates: Blueprint hologram — layered transparent panels stacking into 3D */
function CustomTemplates() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Back layer */}
      <rect x="5" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="0.8" opacity="0.15" transform="translate(1, -0.5)" />
      {/* Mid layer */}
      <rect x="5" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      <rect x="5" y="2" width="14" height="10" rx="1.5" fill="currentColor" opacity="0.03" />
      {/* Blueprint grid inside */}
      <line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
      <line x1="7" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
      <line x1="7" y1="9" x2="13" y2="9" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
      <line x1="10" y1="3.5" x2="10" y2="10.5" stroke="currentColor" strokeWidth="0.4" opacity="0.15" />
      {/* Front layer — elevated, active */}
      <rect x="3" y="12" width="18" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <rect x="3" y="12" width="18" height="10" rx="1.5" fill="currentColor" opacity="0.04" />
      {/* DNA/template helix inside front panel */}
      <path d="M7 14c2 1 4-1 6 0s4-1 6 0" className="pi-flow-slow" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <path d="M7 17c2-1 4 1 6 0s4 1 6 0" className="pi-flow-slow" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      {/* Cross-rungs */}
      <line x1="9" y1="14.3" x2="9" y2="16.7" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      <line x1="12" y1="14" x2="12" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      <line x1="15" y1="14.3" x2="15" y2="16.7" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      {/* Active node */}
      <circle cx="12" cy="19" r="1" fill="currentColor" className="pi-pulse" />
    </svg>
  );
}

/** Teams: Constellation cluster — 3 connected persona nodes with a shared neural bridge */
function CustomTeams() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Central orchestration ring */}
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.2" className="pi-spin-slow" />
      {/* Three persona nodes */}
      <circle cx="12" cy="4" r="2.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="12" cy="4" r="1" fill="currentColor" className="pi-pulse" />
      <circle cx="5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="5" cy="18" r="1" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="19" cy="18" r="2.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="19" cy="18" r="1" fill="currentColor" className="pi-pulse" />
      {/* Neural bridges — animated data flow between nodes */}
      <line x1="12" y1="6.5" x2="7" y2="16" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      <line x1="12" y1="6.5" x2="17" y2="16" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      <line x1="7.5" y1="18" x2="16.5" y2="18" className="pi-flow" stroke="currentColor" strokeWidth="0.8" />
      {/* Central merge point */}
      <circle cx="12" cy="12" className="pi-breathe" fill="currentColor" />
      {/* Mini data packets along paths */}
      <circle cx="10" cy="10" r="0.5" fill="currentColor" className="pi-flicker" />
      <circle cx="14.5" cy="10.5" r="0.5" fill="currentColor" className="pi-flicker" />
      <circle cx="12" cy="18" r="0.5" fill="currentColor" className="pi-flicker" />
    </svg>
  );
}

/** Cloud: Distributed mesh — floating nodes connected in a cloud-shaped network topology */
function CustomCloud() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Cloud outline — subtle */}
      <path d="M6.5 18a4 4 0 01-.4-7.98 6 6 0 0111.8 0A4 4 0 0117.5 18H6.5z" stroke="currentColor" strokeWidth="0.8" opacity="0.2" />
      {/* Mesh nodes inside cloud shape */}
      <circle cx="8" cy="12" r="1.3" fill="currentColor" className="pi-pulse" />
      <circle cx="12" cy="9" r="1.3" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="16" cy="12" r="1.3" fill="currentColor" className="pi-pulse" />
      <circle cx="10" cy="15" r="1.1" fill="currentColor" className="pi-pulse-delay" />
      <circle cx="14" cy="15" r="1.1" fill="currentColor" className="pi-pulse" />
      {/* Mesh connections */}
      <line x1="8" y1="12" x2="12" y2="9" className="pi-flow" stroke="currentColor" strokeWidth="0.6" />
      <line x1="12" y1="9" x2="16" y2="12" className="pi-flow" stroke="currentColor" strokeWidth="0.6" />
      <line x1="8" y1="12" x2="10" y2="15" className="pi-flow" stroke="currentColor" strokeWidth="0.6" />
      <line x1="16" y1="12" x2="14" y2="15" className="pi-flow" stroke="currentColor" strokeWidth="0.6" />
      <line x1="10" y1="15" x2="14" y2="15" className="pi-flow" stroke="currentColor" strokeWidth="0.6" />
      <line x1="12" y1="9" x2="10" y2="15" stroke="currentColor" strokeWidth="0.4" opacity="0.15" />
      <line x1="12" y1="9" x2="14" y2="15" stroke="currentColor" strokeWidth="0.4" opacity="0.15" />
      {/* Upload/sync arrows below */}
      <path d="M9 19.5v1.5m3-1.5v1.5m3-1.5v1.5" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
      <path d="M8 21l1-1.5 1 1.5m2-1.5l1-1.5 1 1.5m2-1.5l1-1.5 1 1.5" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
    </svg>
  );
}

/** Settings: Quantum calibrator — concentric rotating rings with parameter nodes */
function CustomSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Outer ring with notches */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="0.6" opacity="0.12" />
      <g className="pi-spin-slow">
        <circle cx="12" cy="2" r="1" fill="currentColor" opacity="0.4" />
        <circle cx="22" cy="12" r="1" fill="currentColor" opacity="0.4" />
        <circle cx="12" cy="22" r="1" fill="currentColor" opacity="0.4" />
        <circle cx="2" cy="12" r="1" fill="currentColor" opacity="0.4" />
      </g>
      {/* Middle ring — counter-rotating */}
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
      <g className="pi-orbit-r">
        <circle cx="18.5" cy="12" r="0.8" fill="currentColor" opacity="0.6" />
        <circle cx="5.5" cy="12" r="0.8" fill="currentColor" opacity="0.6" />
      </g>
      {/* Inner ring */}
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* Core */}
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.08" />
      <circle cx="12" cy="12" className="pi-breathe" fill="currentColor" />
      {/* Cross-hairs */}
      <line x1="12" y1="5.5" x2="12" y2="8.5" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      <line x1="12" y1="15.5" x2="12" y2="18.5" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      <line x1="5.5" y1="12" x2="8.5" y2="12" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      <line x1="15.5" y1="12" x2="18.5" y2="12" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
    </svg>
  );
}

// ── Data ────────────────────────────────────────────────────────────────

interface IconEntry {
  id: string;
  label: string;
  desc: string;
  lucide: React.ReactNode;
  custom: React.ReactNode;
}

const ICONS: IconEntry[] = [
  { id: 'home', label: 'Home', desc: 'Command hub', lucide: <Home className="w-full h-full" />, custom: <CustomHome /> },
  { id: 'overview', label: 'Overview', desc: 'HUD panels', lucide: <BarChart3 className="w-full h-full" />, custom: <CustomOverview /> },
  { id: 'agents', label: 'Agents', desc: 'Neural face', lucide: <Bot className="w-full h-full" />, custom: <CustomAgents /> },
  { id: 'events', label: 'Events', desc: 'Signal burst', lucide: <Zap className="w-full h-full" />, custom: <CustomEvents /> },
  { id: 'keys', label: 'Keys', desc: 'Quantum lock', lucide: <Key className="w-full h-full" />, custom: <CustomKeys /> },
  { id: 'templates', label: 'Templates', desc: 'Blueprint', lucide: <FlaskConical className="w-full h-full" />, custom: <CustomTemplates /> },
  { id: 'teams', label: 'Teams', desc: 'Constellation', lucide: <Users className="w-full h-full" />, custom: <CustomTeams /> },
  { id: 'cloud', label: 'Cloud', desc: 'Mesh network', lucide: <Cloud className="w-full h-full" />, custom: <CustomCloud /> },
  { id: 'settings', label: 'Settings', desc: 'Calibrator', lucide: <Settings className="w-full h-full" />, custom: <CustomSettings /> },
];

type IconMode = 'lucide' | 'custom';

// ── Component ──────────────────────────────────────────────────────────

export default function IconShowcase() {
  const [mode, setMode] = useState<IconMode>('custom');
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);

  return (
    <div className="space-y-6 w-full max-w-xl mx-auto">
      {/* Inject animation styles */}
      <style>{ICON_STYLES}</style>

      {/* Switcher */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex bg-secondary/40 p-1 rounded-lg border border-border/50">
          <button
            onClick={() => setMode('lucide')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'lucide'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Lucide (Library)
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Personas (Animated)
          </button>
        </div>
      </div>

      {/* Icon grid */}
      <div className="grid grid-cols-9 gap-2">
        <AnimatePresence mode="wait">
          {ICONS.map((icon, i) => (
            <motion.div
              key={`${icon.id}-${mode}`}
              initial={{ scale: 0.7, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.7, opacity: 0, y: -8 }}
              transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-1.5"
              onMouseEnter={() => setHoveredIcon(icon.id)}
              onMouseLeave={() => setHoveredIcon(null)}
            >
              <div className={`relative w-11 h-11 p-2 rounded-xl border transition-all duration-300 cursor-default ${
                hoveredIcon === icon.id
                  ? 'border-primary/40 bg-primary/10 shadow-lg shadow-primary/10 scale-110'
                  : 'border-primary/10 bg-secondary/20'
              } ${mode === 'custom' ? 'text-primary' : 'text-muted-foreground'}`}>
                {mode === 'lucide' ? icon.lucide : icon.custom}
              </div>
              <span className="text-[9px] text-muted-foreground/60 font-medium leading-none">
                {icon.label}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Hover detail */}
      <div className="h-5 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {hoveredIcon && mode === 'custom' && (
            <motion.p
              key={hoveredIcon}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-[11px] text-primary/60 font-mono"
            >
              {ICONS.find((i) => i.id === hoveredIcon)?.desc} · animated SVG · currentColor
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <p className="text-[11px] text-muted-foreground/40 font-mono text-center">
        {mode === 'lucide'
          ? 'lucide-react · generic icon library · static'
          : '9 custom icons · neural/circuit motifs · CSS-animated · theme-adaptive'}
      </p>
    </div>
  );
}
