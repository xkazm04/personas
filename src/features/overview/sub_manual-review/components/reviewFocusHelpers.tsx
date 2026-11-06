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
  /**
   * Present on every row the queue actually renders — `ManualReviewList` casts
   * enriched `ManualReviewItem`s (which carry `persona_id`) to this type. Typed
   * optional because the field was absent from this interface until the queue
   * needed it to resolve a persona's workspace (the retired workspace tint).
   */
  persona_id?: string;
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

export function parseDecisions(contextData: string | null | undefined): {
  decisions: DecisionItem[];
  galleryImage: string | null;
  contextText: string | null;
  raw: Record<string, unknown> | null;
} {
  if (!contextData) return { decisions: [], galleryImage: null, contextText: null, raw: null };
  try {
    const parsed = JSON.parse(contextData);
    if (!parsed || typeof parsed !== 'object') return { decisions: [], galleryImage: null, contextText: null, raw: null };
    const decisions: DecisionItem[] = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const galleryImage = parsed.gallery_image_ref ?? parsed.image_url ?? null;
    // Backend dispatch preserves the original prose context under
    // `context_text` when decisions are present. Surface it so the user
    // sees the persona's narrative, not just bare decision labels.
    const contextText = typeof parsed.context_text === 'string' ? parsed.context_text : null;
    return { decisions, galleryImage, contextText, raw: parsed };
  } catch {
    return { decisions: [], galleryImage: null, contextText: null, raw: null };
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
    gradient: 'bg-status-error',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Critical',
    shadow: 'none',
    ring: 'ring-status-error/10',
  },
  warning: {
    gradient: 'bg-status-warning',
    icon: <AlertTriangle className="w-4 h-4" />,
    label: 'Warning',
    shadow: 'none',
    ring: 'ring-status-warning/10',
  },
  info: {
    gradient: 'bg-status-success',
    icon: <Info className="w-4 h-4" />,
    label: 'Info',
    shadow: 'none',
    ring: 'ring-status-success/10',
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
  critical: 'bg-status-error',
  warning: 'bg-status-warning',
  high: 'bg-status-warning',
  info: 'bg-status-info',
  low: 'bg-foreground/40',
};

export function sevDot(severity: string): string {
  return SEV_DOT[severity] ?? SEV_DOT.info!;
}

export const SEV_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-status-error/15 text-status-error border-status-error/20',
  warning: 'bg-status-warning/15 text-status-warning border-status-warning/20',
  info: 'bg-status-success/15 text-status-success border-status-success/20',
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
