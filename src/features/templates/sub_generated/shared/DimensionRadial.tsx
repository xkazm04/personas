import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { useTemplateMotion } from '@/features/templates/animationPresets';

/** The 9 design dimensions scored in reviews.rs `score_design_result()`. */
const DIMENSIONS = [
  'prompt',
  'tools',
  'triggers',
  'connectors',
  'flows',
  'events',
  'notifications',
  'summary',
  'service_flow',
] as const;

type DimensionKey = (typeof DIMENSIONS)[number];

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  prompt: 'Prompt',
  tools: 'Tools',
  triggers: 'Triggers',
  connectors: 'Connectors',
  flows: 'Flows',
  events: 'Events',
  notifications: 'Notifications',
  summary: 'Summary',
  service_flow: 'Service Flow',
};

/**
 * Evaluate which of the 9 design dimensions are filled, mirroring the Rust
 * `score_design_result()` logic in reviews.rs.
 */
export function evaluateDimensions(designResult: DesignAnalysisResult | null): Record<DimensionKey, boolean> {
  const result: Record<DimensionKey, boolean> = {
    prompt: false,
    tools: false,
    triggers: false,
    connectors: false,
    flows: false,
    events: false,
    notifications: false,
    summary: false,
    service_flow: false,
  };

  if (!designResult) return result;
  const raw = designResult as unknown as Record<string, unknown>;

  // 1. Prompt — structured_prompt with identity(>20), instructions(>50), and guidance
  const sp = raw.structured_prompt as Record<string, unknown> | undefined;
  if (sp) {
    const identity = typeof sp.identity === 'string' && sp.identity.length > 20;
    const instructions = typeof sp.instructions === 'string' && sp.instructions.length > 50;
    const guidance =
      (typeof sp.toolGuidance === 'string' && sp.toolGuidance.length > 0) ||
      (typeof sp.errorHandling === 'string' && sp.errorHandling.length > 0);
    result.prompt = identity && instructions && guidance;
  }

  // 2. Tools
  result.tools = Array.isArray(raw.suggested_tools) && raw.suggested_tools.length > 0;

  // 3. Triggers
  const triggers = Array.isArray(raw.suggested_triggers) ? raw.suggested_triggers : [];
  result.triggers = triggers.length > 0 && triggers.some(
    (t: unknown) => typeof t === 'object' && t !== null && 'trigger_type' in (t as Record<string, unknown>),
  );

  // 4. Connectors — need credential_fields + auth_type
  const connectors = Array.isArray(raw.suggested_connectors) ? raw.suggested_connectors : [];
  result.connectors = connectors.length > 0 && connectors.some((c: unknown) => {
    if (typeof c !== 'object' || c === null) return false;
    const obj = c as Record<string, unknown>;
    const hasCredFields = Array.isArray(obj.credential_fields) && obj.credential_fields.length > 0;
    const hasAuthType = typeof obj.auth_type === 'string';
    return hasCredFields && hasAuthType;
  });

  // 5. Flows — need start node, end node, ≥5 nodes
  const flows = Array.isArray(raw.use_case_flows) ? raw.use_case_flows : [];
  result.flows = flows.length > 0 && flows.some((flow: unknown) => {
    if (typeof flow !== 'object' || flow === null) return false;
    const nodes = (flow as Record<string, unknown>).nodes;
    if (!Array.isArray(nodes)) return false;
    const hasStart = nodes.some((n: unknown) => (n as Record<string, unknown>)?.type === 'start');
    const hasEnd = nodes.some((n: unknown) => (n as Record<string, unknown>)?.type === 'end');
    return hasStart && hasEnd && nodes.length >= 5;
  });

  // 6. Events
  result.events = Array.isArray(raw.suggested_event_subscriptions) && raw.suggested_event_subscriptions.length > 0;

  // 7. Notifications
  result.notifications = Array.isArray(raw.suggested_notification_channels) && raw.suggested_notification_channels.length > 0;

  // 8. Summary
  result.summary = typeof raw.summary === 'string' && raw.summary.length > 50;

  // 9. Service flow
  result.service_flow = Array.isArray(raw.service_flow) && raw.service_flow.length > 0;

  return result;
}

// ── SVG Arc Helpers ──────────────────────────────────────────────────────

const SEGMENT_COUNT = 9;
const GAP_DEG = 4; // gap between segments
const SEGMENT_DEG = (360 - GAP_DEG * SEGMENT_COUNT) / SEGMENT_COUNT;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

// ── Component ────────────────────────────────────────────────────────────

interface DimensionRadialProps {
  designResult: DesignAnalysisResult | null;
  size?: number;
  className?: string;
}

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/** Compute best placement by checking available space on each side. */
function computePlacement(triggerRect: DOMRect): TooltipPlacement {
  const spaceAbove = triggerRect.top;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceLeft = triggerRect.left;
  const spaceRight = window.innerWidth - triggerRect.right;

  // Prefer top, then bottom, then right, then left
  const candidates: [TooltipPlacement, number][] = [
    ['top', spaceAbove],
    ['bottom', spaceBelow],
    ['right', spaceRight],
    ['left', spaceLeft],
  ];

  // Need at least 80px vertical or 160px horizontal for the tooltip to fit
  const minVertical = 80;
  const minHorizontal = 160;

  for (const [dir, space] of candidates) {
    if ((dir === 'top' || dir === 'bottom') && space >= minVertical) return dir;
    if ((dir === 'left' || dir === 'right') && space >= minHorizontal) return dir;
  }

  // Fallback: pick whichever side has the most space
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]?.[0] ?? 'top';
}

/** CSS classes for positioning the tooltip relative to the trigger. */
function placementClasses(placement: TooltipPlacement): string {
  switch (placement) {
    case 'top':
      return 'bottom-full left-1/2 -translate-x-1/2 mb-2';
    case 'bottom':
      return 'top-full left-1/2 -translate-x-1/2 mt-2';
    case 'left':
      return 'right-full top-1/2 -translate-y-1/2 mr-2';
    case 'right':
      return 'left-full top-1/2 -translate-y-1/2 ml-2';
  }
}

export function DimensionRadial({ designResult, size = 32, className = '' }: DimensionRadialProps) {
  const { motion: MOTION } = useTemplateMotion();
  const [hovered, setHovered] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement>('top');
  const triggerRef = useRef<HTMLDivElement>(null);

  const dimensions = useMemo(() => evaluateDimensions(designResult), [designResult]);
  const filled = DIMENSIONS.filter((d) => dimensions[d]);
  const missing = DIMENSIONS.filter((d) => !dimensions[d]);

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.14;
  const r = (size - strokeWidth) / 2 - 1;

  const handleMouseEnter = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPlacement(computePlacement(rect));
    }
    setHovered(true);
  }, []);

  const summaryLabel = `Design quality: ${filled.length} of ${SEGMENT_COUNT} dimensions met`;

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      data-testid="dimension-radial"
      data-filled={filled.length}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        tabIndex={0}
        aria-label={summaryLabel}
        onFocus={handleMouseEnter}
        onBlur={() => setHovered(false)}
      >
        <title>{summaryLabel}</title>
        {DIMENSIONS.map((dim, i) => {
          const startDeg = i * (SEGMENT_DEG + GAP_DEG);
          const endDeg = startDeg + SEGMENT_DEG;
          const isFilled = dimensions[dim];
          return (
            <path
              key={dim}
              d={arcPath(cx, cy, r, startDeg, endDeg)}
              fill="none"
              stroke={isFilled ? 'rgb(16 185 129 / 0.6)' : 'rgb(128 128 128 / 0.15)'}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          );
        })}
        {/* Center score text */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.28}
          fontWeight="600"
          fill="currentColor"
          className="text-foreground/70"
        >
          {filled.length}
        </text>
      </svg>

      <ul className="sr-only">
        {DIMENSIONS.map((dim) => (
          <li key={dim}>
            {DIMENSION_LABELS[dim]}: {dimensions[dim] ? 'passed' : 'failed'}
          </li>
        ))}
      </ul>

      {/* Tooltip — collision-aware placement with shared motion preset */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={MOTION.snappy.framer}
            className={`absolute ${placementClasses(placement)} z-50 px-3 py-2 rounded-xl bg-background border border-primary/20 shadow-xl text-sm whitespace-nowrap`}
            data-testid="dimension-radial-tooltip"
          >
            {filled.length > 0 && (
              <div className="text-emerald-400 mb-1">
                {filled.map((d) => DIMENSION_LABELS[d]).join(', ')}
              </div>
            )}
            {missing.length > 0 && (
              <div className="text-muted-foreground/50">
                Missing: {missing.map((d) => DIMENSION_LABELS[d]).join(', ')}
              </div>
            )}
            <div className="text-foreground/60 mt-1 font-medium">
              {filled.length}/{SEGMENT_COUNT} dimensions
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
