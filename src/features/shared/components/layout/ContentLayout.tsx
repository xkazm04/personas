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
// Icon colour. The Console header spends no colour on the icon: it sits in ink-2 at 16px.
// The names stay so call sites keep typechecking; a tint is no longer painted.
// ---------------------------------------------------------------------------

type IconColor =
  | 'violet' | 'blue' | 'emerald' | 'indigo' | 'amber' | 'cyan' | 'orange' | 'sky' | 'red' | 'primary';

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
  /** Optional icon (left of title), drawn at 16px in ink. May be omitted for text-only headers. */
  icon?: ReactNode;
  /** Accepted for compatibility; the header no longer tints its icon. */
  iconColor?: IconColor;
  /** The page name, rendered as the bar's title (`typo-heading-lg`, ink). Keep to 1-4 words. */
  title: string;
  /** The one quiet line beside the title (`typo-caption`): a count, a status phrase, a greeting. */
  subtitle?: ReactNode;
  /** A mono meta slot after the title (`typo-code`, ink-3): a count, a timestamp, a key. */
  meta?: ReactNode;
  /** Right-aligned controls on the SAME row as the title. Use for one or two compact actions;
   *  when the controls are many prefer `toolbar`, which drops them to their own row. */
  actions?: ReactNode;
  /** Controls rendered as a thin bar on the row BELOW the title, separated by a hairline. */
  toolbar?: ReactNode;
  /** Constrain the header to its container width (`w-full`) instead of the default
   *  `min-w-[80vw]` floor, so right-aligned actions never spill past the page's right edge. */
  fitWidth?: boolean;
  /** Dense tool pages: the subtitle stacks under the title as a second line of the same bar. */
  compact?: boolean;
  children?: ReactNode;
  /** Inline style applied to the header root, used to thread CSS custom properties into descendants. */
  style?: CSSProperties;
}

/**
 * ContentHeader: ONE instrument bar. Icon, title, quiet summary line, mono meta, actions right,
 * `--head-h` tall, a hairline under it. No tinted band, no uppercase tracked caption.
 * @catalog ContentHeader - the page's one-line instrument bar (icon, title, quiet subtitle, mono meta, actions, optional toolbar row). Layout.
 */
export function ContentHeader({
  icon,
  title,
  subtitle,
  meta,
  actions,
  toolbar,
  fitWidth = false,
  compact = false,
  children,
  style,
}: ContentHeaderProps) {
  const iconElement = icon ? (
    <span className="flex-shrink-0 flex items-center text-ink-2 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
  ) : null;

  const layoutCtx = useContext(ContentLayoutContext);
  const scrolled = layoutCtx?.scrolled ?? false;

  const titleBlock = compact ? (
    <div className="flex-1 min-w-0">
      <h1 className="typo-heading-lg truncate">{title}</h1>
      {subtitle && <p className="typo-caption truncate">{subtitle}</p>}
    </div>
  ) : (
    <>
      <h1 className="typo-heading-lg truncate min-w-0 max-w-[60%] flex-shrink-0">{title}</h1>
      {meta && <span className="typo-code text-ink-3 flex-shrink-0 whitespace-nowrap">{meta}</span>}
      <div className="flex-1 min-w-0">
        {subtitle && <p className="typo-caption truncate">{subtitle}</p>}
      </div>
    </>
  );

  return (
    <div
      style={style}
      data-testid={compact ? 'content-header-compact' : undefined}
      data-scrolled={scrolled || undefined}
      className={[
        'flex-shrink-0 border-b border-hair bg-background sticky top-0 z-10',
        // `fitWidth` clamps the header to its container; the default keeps the app-wide 80vw floor.
        fitWidth ? 'w-full min-w-0 overflow-x-clip' : 'w-full min-w-[80vw]',
      ].join(' ')}
    >
      {/* No backdrop-blur: it flickers as a white band in WebView2 (see PersonasPage). */}
      <div
        className={`flex items-center gap-3 min-w-0 ${IS_MOBILE ? 'px-3 py-2' : 'px-[var(--gutter-page)]'} ${actions && !fitWidth ? 'pr-20' : ''}`}
        style={{ minHeight: 'var(--head-h)' }}
      >
        {iconElement}
        {titleBlock}
        {compact && meta && <span className="typo-code text-ink-3 flex-shrink-0 whitespace-nowrap">{meta}</span>}
        {actions && (fitWidth
          ? <div className="shrink min-w-0 flex items-center gap-2 justify-end">{actions}</div>
          : <div className="shrink-0 flex items-center gap-2 ml-auto">{actions}</div>)}
      </div>
      {/* Toolbar: a thin controls bar on its own row below the title. */}
      {toolbar && (
        <div className="px-[var(--gutter-page)] py-2 border-t border-hair flex items-center flex-wrap gap-2">
          {toolbar}
        </div>
      )}
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
            // Horizontal padding is the page gutter (the density axis owns it); 1rem top and bottom.
            !noPadding &&
              (IS_MOBILE ? 'p-2.5' : 'py-4 px-[var(--gutter-page)]'),
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
