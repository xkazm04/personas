import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Icon color palette
// ---------------------------------------------------------------------------

const ICON_COLOR_MAP = {
  violet:  { bg: 'bg-violet-500/15',  border: 'border-violet-500/25'  },
  blue:    { bg: 'bg-blue-500/15',    border: 'border-blue-500/25'    },
  emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  indigo:  { bg: 'bg-indigo-500/15',  border: 'border-indigo-500/25'  },
  amber:   { bg: 'bg-amber-500/15',   border: 'border-amber-500/25'   },
  cyan:    { bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25'    },
  red:     { bg: 'bg-red-500/15',     border: 'border-red-500/25'     },
} as const;

type IconColor = keyof typeof ICON_COLOR_MAP;

// ---------------------------------------------------------------------------
// ContentBox — outer page wrapper
// ---------------------------------------------------------------------------

interface ContentBoxProps {
  children: ReactNode;
  /** Desktop minimum width in px. Defaults to 960. Set to 0 to disable. */
  minWidth?: number;
}

export function ContentBox({ children, minWidth = 960 }: ContentBoxProps) {
  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
      style={minWidth > 0 ? { minWidth: `${minWidth}px` } : undefined}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentHeader — standardized page header
// ---------------------------------------------------------------------------

interface ContentHeaderProps {
  /** Icon element, e.g. <Brain className="w-5 h-5 text-violet-400" /> */
  icon: ReactNode;
  /** When provided, wraps icon in the standard 10×10 rounded-xl box.
   *  Omit for custom elements (e.g. PassRateGauge). */
  iconColor?: IconColor;
  title: string;
  subtitle?: ReactNode;
  /** Right-side actions (buttons, badges, toggles). */
  actions?: ReactNode;
  /** Content rendered below the title row inside the header boundary
   *  (e.g. inline filter bar). */
  children?: ReactNode;
}

export function ContentHeader({
  icon,
  iconColor,
  title,
  subtitle,
  actions,
  children,
}: ContentHeaderProps) {
  const iconElement = iconColor ? (
    <div
      className={`w-10 h-10 rounded-xl ${ICON_COLOR_MAP[iconColor].bg} border ${ICON_COLOR_MAP[iconColor].border} flex items-center justify-center`}
    >
      {icon}
    </div>
  ) : (
    icon
  );

  return (
    <div className="px-4 md:px-6 py-5 border-b border-primary/10 bg-primary/5 flex-shrink-0">
      <div className="flex items-center gap-3">
        {iconElement}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground/90">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground/50">{subtitle}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentBody — scrollable content area
// ---------------------------------------------------------------------------

interface ContentBodyProps {
  children: ReactNode;
  /** Apply max-w-6xl mx-auto centering. Default: false. */
  centered?: boolean;
  /** Skip default p-6 padding. */
  noPadding?: boolean;
  /** Use flex-col layout on the scroll container (for empty-state centering). */
  flex?: boolean;
}

export function ContentBody({
  children,
  centered = false,
  noPadding = false,
  flex = false,
}: ContentBodyProps) {
  if (flex) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={[
          'min-h-full',
          !noPadding && 'p-6',
          centered && 'max-w-6xl mx-auto w-full',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
