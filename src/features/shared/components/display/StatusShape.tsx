import type { StatusKey } from '@/lib/design/statusTokens';

export type StatusShapeSize = 'xs' | 'sm';

interface StatusShapeProps {
  status: StatusKey;
  size?: StatusShapeSize;
  className?: string;
  /** Override the default color class. Pass empty string to inherit from parent. */
  colorClass?: string;
  title?: string;
  'aria-label'?: string;
  tabIndex?: number;
}

const SHAPE_COLOR: Record<StatusKey, string> = {
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
  info: 'text-blue-400',
  neutral: 'text-muted-foreground/50',
};

const SIZE_CLASS: Record<StatusShapeSize, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
};

function ShapeCircle() {
  return <circle cx="4" cy="4" r="3.5" fill="currentColor" />;
}

function ShapeDiamond() {
  return (
    <rect
      x="1.17"
      y="1.17"
      width="5.66"
      height="5.66"
      rx="0.5"
      transform="rotate(45 4 4)"
      fill="currentColor"
    />
  );
}

function ShapeTriangle() {
  return <polygon points="4,0.5 7.5,7.5 0.5,7.5" fill="currentColor" />;
}

function ShapeRing() {
  return (
    <circle
      cx="4"
      cy="4"
      r="2.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  );
}

const STATUS_SHAPES: Record<StatusKey, () => React.JSX.Element> = {
  success: ShapeCircle,
  warning: ShapeDiamond,
  error: ShapeTriangle,
  info: ShapeCircle,
  neutral: ShapeRing,
};

export function StatusShape({
  status,
  size = 'sm',
  className = '',
  colorClass,
  title,
  'aria-label': ariaLabel,
  tabIndex,
}: StatusShapeProps) {
  const color = colorClass ?? SHAPE_COLOR[status];
  const Shape = STATUS_SHAPES[status];

  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${SIZE_CLASS[size]} ${color} ${className}`}
      title={title}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      role={ariaLabel ? 'img' : undefined}
    >
      <svg viewBox="0 0 8 8" className="w-full h-full" aria-hidden="true">
        <Shape />
      </svg>
    </span>
  );
}

/** Maps common domain status strings to semantic StatusKey for shape resolution. */
export function mapToShapeStatus(rawStatus: string): StatusKey {
  switch (rawStatus) {
    case 'completed':
    case 'ok':
    case 'healthy':
    case 'ready':
    case 'success':
      return 'success';
    case 'warning':
    case 'warn':
    case 'degraded':
    case 'cancelled':
    case 'missing':
      return 'warning';
    case 'error':
    case 'failed':
    case 'failing':
      return 'error';
    case 'running':
    case 'info':
    case 'untested':
    case 'testing':
      return 'info';
    case 'inactive':
    case 'dormant':
    case 'unknown':
    case 'neutral':
    default:
      return 'neutral';
  }
}
