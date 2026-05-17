import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';

// ---------------------------------------------------------------------------
// ContentLayoutContext -- shares scroll state between ContentBody and
// ContentHeader so the header can elevate on scroll. Threshold is 8px.
// ---------------------------------------------------------------------------

interface ContentLayoutContextValue {
  scrolled: boolean;
  setScrolled: (value: boolean) => void;
}

const ContentLayoutContext = createContext<ContentLayoutContextValue | null>(null);

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
  const [scrolled, setScrolled] = useState(false);
  const ctxValue = { scrolled, setScrolled };

  // Custom override -- used by TeamCanvas etc. to opt out of min-width
  if (minWidth !== undefined) {
    return (
      <ContentLayoutContext.Provider value={ctxValue}>
        <div
          className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
          style={minWidth > 0 ? { minWidth: `${minWidth}px` } : undefined}
          data-testid={testId}
        >
          {children}
        </div>
      </ContentLayoutContext.Provider>
    );
  }

  // Default: responsive min-width adjusted for 328px sidebar
  // xl 1280->952 available, 2xl 1536->1208, 3xl 1920->1592, 4xl 2560->2232
  return (
    <ContentLayoutContext.Provider value={ctxValue}>
      <div data-testid={testId} className={`flex-1 min-h-0 flex flex-col w-full overflow-hidden ${IS_MOBILE ? '' : 'min-w-[640px] md:min-w-[800px] xl:min-w-[920px] 2xl:min-w-[1180px] 3xl:min-w-[1560px] 4xl:min-w-[2200px]'}`}>
        {children}
      </div>
    </ContentLayoutContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ContentHeader -- standardized page header
// ---------------------------------------------------------------------------

interface ContentHeaderProps {
  /** Optional icon (left of title). Renders inside a small colored chip when
   *  `iconColor` is supplied; rendered raw otherwise. May be omitted entirely
   *  for headers that lead with text only. */
  icon?: ReactNode;
  iconColor?: IconColor;
  /** Small mono-uppercase label rendered above the title (Home/"Mission
   *  Control" pattern). Keep to 1–3 words; longer eyebrows degrade
   *  readability at this size. */
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Inline style applied to the header root — used to thread CSS custom
   *  properties (e.g. `--persona-accent`) into descendant components. */
  style?: CSSProperties;
}

export function ContentHeader({
  icon,
  iconColor,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  style,
}: ContentHeaderProps) {
  const iconElement = icon ? (
    iconColor ? (
      <div
        className={`${IS_MOBILE ? 'w-7 h-7' : 'w-9 h-9'} rounded-lg ${ICON_COLOR_MAP[iconColor].bg} border ${ICON_COLOR_MAP[iconColor].border} flex items-center justify-center flex-shrink-0`}
      >
        {icon}
      </div>
    ) : (
      icon
    )
  ) : null;

  const layoutCtx = useContext(ContentLayoutContext);
  const scrolled = layoutCtx?.scrolled ?? false;

  return (
    <div
      style={style}
      className={[
        IS_MOBILE ? 'px-3 py-2.5' : 'px-4 md:px-6 xl:px-8 py-4',
        // bg-card-bg maps to --color-card-bg via @theme; the previous
        // bg-primary/5 fallback (used pre-backdrop-filter) introduced a
        // brand-tinted variant that didn't match the theme's neutral
        // surface tokens. Single-token surface keeps the header coherent
        // across all themes and removes the discoloration on browsers
        // without backdrop-filter support.
        'border-b border-card-border bg-card-bg flex-shrink-0 min-w-[80vw]',
        'sticky top-0 z-10 backdrop-blur',
        'transition-shadow duration-150',
        scrolled ? 'shadow-elevation-2' : 'shadow-none',
      ].join(' ')}
    >
      <div className="flex items-center gap-3 pr-20">
        {iconElement}
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <div className="typo-caption uppercase tracking-[0.3em] text-foreground/50 font-mono mb-0.5">
              {eyebrow}
            </div>
          )}
          <h1 className="typo-heading-lg text-foreground/90">{title}</h1>
          {subtitle && (
            <p className="typo-body text-foreground">{subtitle}</p>
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
  /** Use flex-col on the scroll container (for empty-state centering). */
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
  const layoutCtx = useContext(ContentLayoutContext);

  useEffect(() => {
    const el = scrollRef.current;
    const setScrolled = layoutCtx?.setScrolled;
    if (!el || !setScrolled) return;
    const update = () => setScrolled(el.scrollTop > 8);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      el.removeEventListener('scroll', update);
      setScrolled(false);
    };
  }, [layoutCtx?.setScrolled]);

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
