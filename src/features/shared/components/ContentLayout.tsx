import type { ReactNode } from 'react';
<<<<<<< HEAD
import { IS_MOBILE } from '@/lib/utils/platform';
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
  primary: { bg: 'bg-primary/10',     border: 'border-primary/20'     },
} as const;

type IconColor = keyof typeof ICON_COLOR_MAP;

// ---------------------------------------------------------------------------
// ContentBox — outer page wrapper
<<<<<<< HEAD
//
// w-full fills 100% of the parent (content area = viewport − sidebar).
// Responsive min-widths account for the 328px sidebar (L1 88px + L2 240px)
// so they never exceed the content area at their breakpoint.
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
// ---------------------------------------------------------------------------

interface ContentBoxProps {
  children: ReactNode;
<<<<<<< HEAD
  /** Override the default min-width. Set to 0 to disable. */
  minWidth?: number;
}

export function ContentBox({ children, minWidth }: ContentBoxProps) {
  // Custom override — used by TeamCanvas etc. to opt out of min-width
  if (minWidth !== undefined) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
        style={minWidth > 0 ? { minWidth: `${minWidth}px` } : undefined}
      >
        {children}
      </div>
    );
  }

  // Default: responsive min-width adjusted for 328px sidebar
  // xl 1280→952 available, 2xl 1536→1208, 3xl 1920→1592, 4xl 2560→2232
  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full overflow-hidden ${IS_MOBILE ? '' : 'min-w-[800px] xl:min-w-[920px] 2xl:min-w-[1180px] 3xl:min-w-[1560px] 4xl:min-w-[2200px]'}`}>
=======
  /** Desktop minimum width in px. Defaults to 960. Set to 0 to disable. */
  minWidth?: number;
}

export function ContentBox({ children, minWidth = 960 }: ContentBoxProps) {
  // Use responsive min-width classes for the default 960, inline style for custom overrides
  const isDefault = minWidth === 960;
  
  return (
    <div
      className={`flex-1 min-h-0 flex flex-col w-full overflow-hidden ${isDefault ? 'min-w-[960px] 2xl:min-w-[1200px]' : ''}`}
      style={!isDefault && minWidth > 0 ? { minWidth: `${minWidth}px` } : undefined}
    >
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentHeader — standardized page header
// ---------------------------------------------------------------------------

interface ContentHeaderProps {
<<<<<<< HEAD
  icon: ReactNode;
  iconColor?: IconColor;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
=======
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
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
      className={`${IS_MOBILE ? 'w-8 h-8' : 'w-10 h-10'} rounded-xl ${ICON_COLOR_MAP[iconColor].bg} border ${ICON_COLOR_MAP[iconColor].border} flex items-center justify-center`}
=======
      className={`w-10 h-10 rounded-xl ${ICON_COLOR_MAP[iconColor].bg} border ${ICON_COLOR_MAP[iconColor].border} flex items-center justify-center`}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    >
      {icon}
    </div>
  ) : (
    icon
  );

  return (
<<<<<<< HEAD
    <div className={`${IS_MOBILE ? 'px-3 py-3' : 'px-4 md:px-6 xl:px-8 py-6'} border-b border-primary/10 bg-primary/5 flex-shrink-0`}>
=======
    <div className="px-4 md:px-6 py-6 border-b border-primary/10 bg-primary/5 flex-shrink-0">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      <div className="flex items-center gap-3">
        {iconElement}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground/90">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground/90">{subtitle}</p>
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
<<<<<<< HEAD
//
// `centered` caps the inner width with responsive max-width breakpoints
// so content stays readable and centered with symmetric margins.
// Without `centered`, content fills the full ContentBox width.
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
// ---------------------------------------------------------------------------

interface ContentBodyProps {
  children: ReactNode;
<<<<<<< HEAD
  /** Center content with responsive max-width caps. */
  centered?: boolean;
  /** Skip default padding. */
=======
  /** Apply max-w-6xl mx-auto centering. Default: false. */
  centered?: boolean;
  /** Skip default p-6 padding. */
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
      <div className="flex-1 overflow-y-auto flex flex-col w-full">
=======
      <div className="flex-1 overflow-y-auto flex flex-col">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        {children}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={[
<<<<<<< HEAD
          'min-h-full w-full',
          !noPadding && (IS_MOBILE ? 'p-2.5' : 'p-4 md:p-6 xl:p-8'),
          centered && 'mx-auto',
        ]
          .filter(Boolean)
          .join(' ')}
        style={centered ? { maxWidth: 'clamp(1200px, 90%, 2600px)' } : undefined}
=======
          'min-h-full',
          !noPadding && 'p-6',
          centered && 'max-w-6xl mx-auto w-full',
        ]
          .filter(Boolean)
          .join(' ')}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      >
        {children}
      </div>
    </div>
  );
}
