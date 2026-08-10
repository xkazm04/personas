// SVG-side colour + glyph key for taxonomy AREAS.
//
// `practiceAreaTheme.ts` is the canonical accent map, but it speaks Tailwind
// class names — SVG gradients, glows and strokes need literal values. This is
// its deliberate mirror (same 15 areas, same hues: the hex values are the
// Tailwind palette's `*-400`/`*-500` stops the classes resolve to). Keep the
// two files in lock-step when an area is added.
import {
  AlertTriangle,
  Boxes,
  Braces,
  Coins,
  Database,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers,
  Lock,
  MonitorSmartphone,
  Plug,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface AreaGraphTheme {
  /** Node fill / stroke hue (Tailwind `*-400`). */
  hex: string;
  /** Deeper hue for gradients (`*-500`). */
  deep: string;
  icon: LucideIcon;
}

/** Canonical area order = stable graph geography. A reviewer learns "security
 *  is north-east" once; sorting by count would shuffle the sky every harvest. */
export const AREA_ORDER = [
  'security', 'auth', 'billing', 'llm', 'testing', 'observability',
  'performance', 'errors', 'concurrency', 'data', 'api', 'frontend',
  'integration', 'architecture', 'process',
] as const;

const THEMES: Record<string, AreaGraphTheme> = {
  security:      { hex: '#f87171', deep: '#ef4444', icon: ShieldCheck },
  auth:          { hex: '#fb923c', deep: '#f97316', icon: Lock },
  billing:       { hex: '#fbbf24', deep: '#f59e0b', icon: Coins },
  llm:           { hex: '#a78bfa', deep: '#8b5cf6', icon: Sparkles },
  testing:       { hex: '#34d399', deep: '#10b981', icon: FlaskConical },
  observability: { hex: '#38bdf8', deep: '#0ea5e9', icon: Gauge },
  performance:   { hex: '#a3e635', deep: '#84cc16', icon: Workflow },
  errors:        { hex: '#fb7185', deep: '#f43f5e', icon: AlertTriangle },
  concurrency:   { hex: '#22d3ee', deep: '#06b6d4', icon: GitBranch },
  data:          { hex: '#c084fc', deep: '#a855f7', icon: Database },
  api:           { hex: '#60a5fa', deep: '#3b82f6', icon: Braces },
  frontend:      { hex: '#2dd4bf', deep: '#14b8a6', icon: MonitorSmartphone },
  integration:   { hex: '#818cf8', deep: '#6366f1', icon: Plug },
  architecture:  { hex: '#e879f9', deep: '#d946ef', icon: Layers },
  process:       { hex: '#94a3b8', deep: '#64748b', icon: Boxes },
};

const FALLBACK: AreaGraphTheme = { hex: '#94a3b8', deep: '#64748b', icon: Boxes };

export function areaGraphTheme(area: string): AreaGraphTheme {
  return THEMES[area] ?? FALLBACK;
}
