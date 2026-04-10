import { useRef, useState, useCallback, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

type SectionCardSize = 'sm' | 'md' | 'lg';
export type SectionCardStatus = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const STATUS_BORDER: Record<SectionCardStatus, string> = {
  success: 'border-l-[3px] border-l-emerald-500',
  warning: 'border-l-[3px] border-l-amber-500',
  error:   'border-l-[3px] border-l-red-500',
  info:    'border-l-[3px] border-l-blue-500',
  neutral: 'border-l-[3px] border-l-slate-400',
};

interface SectionCardBaseProps {
  children: ReactNode;
  size?: SectionCardSize;
  blur?: boolean;
  className?: string;
  /** Optional status accent — adds a colored left border. */
  status?: SectionCardStatus;
}

interface SectionCardCollapsibleProps extends SectionCardBaseProps {
  collapsible: true;
  title: string;
  subtitle?: string;
  /** localStorage key to persist collapsed state. When omitted, state is ephemeral. */
  storageKey?: string;
  /** Initial collapsed state when no localStorage value exists. Defaults to false (expanded). */
  defaultCollapsed?: boolean;
}

interface SectionCardStaticProps extends SectionCardBaseProps {
  collapsible?: false;
  title?: string;
  subtitle?: string;
  storageKey?: never;
  defaultCollapsed?: never;
}

type SectionCardProps = SectionCardCollapsibleProps | SectionCardStaticProps;

const SIZE_CLASSES: Record<SectionCardSize, string> = {
  sm: 'rounded-lg p-2.5',
  md: 'rounded-xl p-3.5',
  lg: 'rounded-xl p-4',
};

const HEADER_PAD: Record<SectionCardSize, string> = {
  sm: 'px-2.5 py-2',
  md: 'px-3.5 py-2.5',
  lg: 'px-4 py-3',
};

const BODY_PAD: Record<SectionCardSize, string> = {
  sm: 'px-2.5 pb-2.5',
  md: 'px-3.5 pb-3.5',
  lg: 'px-4 pb-4',
};

function readStorage(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch { /* SSR / private browsing */ }
  return fallback;
}

function writeStorage(key: string | undefined, collapsed: boolean) {
  if (!key) return;
  try {
    localStorage.setItem(key, String(collapsed));
  } catch { /* ignore */ }
}

export function SectionCard(props: SectionCardProps) {
  const { children, size = 'md', blur = false, className = '', collapsible, title, subtitle, status } = props;
  const blurClass = blur ? 'backdrop-blur-sm' : '';
  const statusClass = status ? STATUS_BORDER[status] : '';
  const base = `bg-secondary/30 border border-primary/12 shadow-elevation-1 ${statusClass}`;

  // --- Static (non-collapsible) mode ---
  if (!collapsible) {
    return (
      <div className={`${base} ${SIZE_CLASSES[size]} ${blurClass} ${className}`.trim()}>
        {title && (
          <div className="mb-2">
            <h3 className="typo-heading text-foreground/90">{title}</h3>
            {subtitle && <p className="typo-body text-foreground">{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    );
  }

  // --- Collapsible mode ---
  return (
    <CollapsibleBody
      base={base}
      size={size}
      blur={blur}
      blurClass={blurClass}
      className={className}
      title={title}
      subtitle={subtitle}
      storageKey={props.storageKey}
      defaultCollapsed={props.defaultCollapsed ?? false}
    >
      {children}
    </CollapsibleBody>
  );
}

/* Extracted so hooks are always called (no conditional hooks). */
function CollapsibleBody({
  base,
  size,
  blurClass,
  className,
  title,
  subtitle,
  storageKey,
  defaultCollapsed,
  children,
}: {
  base: string;
  size: SectionCardSize;
  blur: boolean;
  blurClass: string;
  className: string;
  title: string;
  subtitle?: string;
  storageKey?: string;
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => readStorage(storageKey, defaultCollapsed));
  const contentRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const roundingClass = size === 'sm' ? 'rounded-lg' : 'rounded-xl';

  return (
    <div className={`${base} ${roundingClass} ${blurClass} ${className} overflow-hidden`.trim()}>
      <button
        type="button"
        onClick={toggle}
        className={`w-full flex items-center gap-2.5 ${HEADER_PAD[size]} text-left hover:bg-secondary/20 transition-colors select-none`}
      >
        <motion.span
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.15 }}
          className="flex-shrink-0"
        >
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        </motion.span>
        <div className="flex-1 min-w-0">
          <h3 className="typo-heading text-foreground/90 truncate">{title}</h3>
          {subtitle && (
            <p className="typo-body text-foreground truncate">{subtitle}</p>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            ref={contentRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
            onAnimationStart={() => {
              if (contentRef.current) contentRef.current.style.overflow = 'hidden';
            }}
            onAnimationComplete={() => {
              if (contentRef.current && !collapsed) contentRef.current.style.overflow = 'visible';
            }}
          >
            <div className={`border-t border-primary/8 ${BODY_PAD[size]} pt-3`}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
