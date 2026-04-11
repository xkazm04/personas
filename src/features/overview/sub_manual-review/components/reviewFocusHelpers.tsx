import type React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageReview {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
  context_data?: string | null;
  suggested_actions?: string | null;
  created_at: string;
  status: string;
}

export interface DecisionItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  image_url?: string;
  gallery_image_ref?: string;
  preview_url?: string;
}

export type DecisionVerdict = 'accept' | 'reject' | undefined;
export type ActionType = 'reject' | 'retry' | 'approve' | null;

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

export function parseDecisions(contextData: string | null | undefined): { decisions: DecisionItem[]; galleryImage: string | null; raw: Record<string, unknown> | null } {
  if (!contextData) return { decisions: [], galleryImage: null, raw: null };
  try {
    const parsed = JSON.parse(contextData);
    if (!parsed || typeof parsed !== 'object') return { decisions: [], galleryImage: null, raw: null };
    const decisions: DecisionItem[] = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const galleryImage = parsed.gallery_image_ref ?? parsed.image_url ?? null;
    return { decisions, galleryImage, raw: parsed };
  } catch {
    return { decisions: [], galleryImage: null, raw: null };
  }
}

export function getDecisionImage(d: DecisionItem): string | null {
  return d.image_url || d.gallery_image_ref || d.preview_url || null;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|ogv)(\?.*)?$/i;
export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

export interface SeverityConfig {
  gradient: string;
  icon: React.ReactNode;
  label: string;
  shadow: string;
  ring: string;
}

export const SEVERITY_CONFIG: Record<string, SeverityConfig> = {
  critical: {
    gradient: 'from-red-500 via-red-400 to-red-500',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Critical',
    shadow: '0 0 40px -12px rgba(239,68,68,0.20)',
    ring: 'ring-red-500/10',
  },
  warning: {
    gradient: 'from-amber-500 via-amber-400 to-amber-500',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: 'Warning',
    shadow: '0 0 40px -12px rgba(245,158,11,0.20)',
    ring: 'ring-amber-500/10',
  },
  info: {
    gradient: 'from-emerald-500 via-emerald-400 to-emerald-500',
    icon: <Info className="w-4 h-4" />,
    label: 'Info',
    shadow: '0 0 40px -12px rgba(16,185,129,0.20)',
    ring: 'ring-emerald-500/10',
  },
};

export function getSevCfg(severity: string): SeverityConfig {
  return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info!;
}

// ---------------------------------------------------------------------------
// Category border colors (for decision cards)
// ---------------------------------------------------------------------------

const CAT_STYLE: Record<string, string> = {
  security: 'border-l-red-500',
  performance: 'border-l-amber-500',
  architecture: 'border-l-blue-500',
  data: 'border-l-purple-500',
  ux: 'border-l-emerald-500',
  workflow: 'border-l-cyan-500',
  content: 'border-l-violet-500',
  default: 'border-l-primary/40',
};

export function catBorder(cat?: string): string {
  if (!cat) return CAT_STYLE.default!;
  return CAT_STYLE[cat.toLowerCase()] ?? CAT_STYLE.default!;
}

// ---------------------------------------------------------------------------
// Severity dot + badge colors (queue sidebar)
// ---------------------------------------------------------------------------

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  high: 'bg-amber-400',
  info: 'bg-blue-400',
  low: 'bg-foreground/40',
};

export function sevDot(severity: string): string {
  return SEV_DOT[severity] ?? SEV_DOT.info!;
}

export const SEV_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  info: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

export const cardVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0, scale: 0.96 }),
};

export const decisionVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 200 : -200, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -200 : 200, opacity: 0 }),
};
