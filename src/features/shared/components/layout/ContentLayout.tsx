import { useRef, type ReactNode } from 'react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';

// ---------------------------------------------------------------------------
// Icon color palette
// ---------------------------------------------------------------------------

const ICON_COLOR_MAP = {
  violet: { bg: 'bg-violet-500/15', border: 'border-violet-500/25' },
  blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/25' },
  emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  indigo: { bg: 'bg-indigo-500/15', border: 'border-indigo-500/25' },
  amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/25' },
  cyan: { bg: 'bg-cyan-500/15', border: 'border-cyan-500/25' },
  red: { bg: 'bg-red-500/15', border: 'border-red-500/25' },
  primary: { bg: 'bg-primary/10', border: 'border-primary/20' },
} as const;

type IconColor = keyof typeof ICON_COLOR_MAP;

// ---------------------------------------------------------------------------
// ContentBox -- outer page wrapper
//
// w-full fills 100% of the parent (content area = viewport − sidebar).
// Responsive min-widths account for the 328px sidebar (L1 88px + L2 240px)
// so they never exceed the content area at their breakpoint.
// ---------------------------------------------------------------------------

interface ContentBoxProps {
  children: ReactNode;
  /** Override the default min-width. Set to 0 to disable. */
  minWidth?: number;
  'data-testid'?: string;
}

export function ContentBox({ children, minWidth, 'data-testid': testId }: ContentBoxProps) {
  // Custom override -- used by TeamCanvas etc. to opt out of min-width
  if (minWidth !== undefined) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
        style={minWidth > 0 ? { minWidth: `${minWidth}px` } : undefined}
        data-testid={testId}
      >
        {children}
      </div>
    );
  }

  // Default: responsive min-width adjusted for 328px sidebar
  // xl 1280->952 available, 2xl 1536->1208, 3xl 1920->1592, 4xl 2560->2232
  return (
    <div data-testid={testId} className={`flex-1 min-h-0 flex flex-col w-full overflow-hidden ${IS_MOBILE ? '' : 'min-w-[800px] xl:min-w-[920px] 2xl:min-w-[1180px] 3xl:min-w-[1560px] 4xl:min-w-[2200px]'}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentHeader -- standardized page header
// ---------------------------------------------------------------------------

interface ContentHeaderProps {
  icon: ReactNode;
  iconColor?: IconColor;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
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
      className={`${IS_MOBILE ? 'w-8 h-8' : 'w-10 h-10'} rounded-xl ${ICON_COLOR_MAP[iconColor].bg} border ${ICON_COLOR_MAP[iconColor].border} flex items-center justify-center`}
    >
      {icon}
    </div>
  ) : (
    icon
  );

  return (
    <div className={`${IS_MOBILE ? 'px-3 py-3' : 'px-4 md:px-6 xl:px-8 py-6'} border-b border-primary/10 bg-primary/5 flex-shrink-0 min-w-[80vw]`}>
      <div className="flex items-center gap-3 pr-20">
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
// ContentBody -- scrollable content area
//
// `centered` caps the inner width with responsive max-width breakpoints
// so content stays readable and centered with symmetric margins.
// Without `centered`, content fills the full ContentBox width.
// ---------------------------------------------------------------------------

interface ContentBodyProps {
  children: ReactNode;
  /** Center content with responsive max-width caps. */
  centered?: boolean;
  /** Skip default padding. */
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const { canScrollUp, canScrollDown } = useScrollShadow(scrollRef);

  const shadowTop = (
    <div
      className={`absolute top-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'linear-gradient(to bottom, var(--background), transparent)' }}
    />
  );
  const shadowBottom = (
    <div
      className={`absolute bottom-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'linear-gradient(to top, var(--background), transparent)' }}
    />
  );

  if (flex) {
    return (
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} className="h-full overflow-y-auto flex flex-col w-full">
          {children}
        </div>
        {shadowTop}
        {shadowBottom}
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div
          className={[
            'min-h-full w-full',
            !noPadding && (IS_MOBILE ? 'p-2.5' : 'p-4 md:p-6 xl:p-8'),
            centered && 'mx-auto',
          ]
            .filter(Boolean)
            .join(' ')}
          style={centered ? { maxWidth: 'clamp(1200px, 90%, 2600px)' } : undefined}
        >
          {children}
        </div>
      </div>
      {shadowTop}
      {shadowBottom}
    </div>
  );
}
