import { Children, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useModalStackPosition } from '@/lib/ui/ModalStackContext';

const Z_INDEX_BASE = 50;
const Z_INDEX_PORTAL_BASE = 10000;
const Z_INDEX_PER_DEPTH = 10;

const SIZE_CLASSES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
  full: 'max-w-5xl',
  '6xl': 'max-w-6xl',
} as const;

export type BaseModalSize = keyof typeof SIZE_CLASSES;

export type BaseModalPlacement = 'center' | 'right-drawer';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  size?: BaseModalSize;
  maxWidthClass?: string;
  panelClassName?: string;
  containerClassName?: string;
  embedded?: boolean;
  /** Render via createPortal to document.body — escapes parent transforms/stacking contexts */
  portal?: boolean;
  /** Centered overlay (default) or full-height right-edge drawer with slide-in animation. */
  placement?: BaseModalPlacement;
  children: React.ReactNode;
}

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

const FULL_BACKDROP: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12, ease: 'linear' } },
  exit: { opacity: 0, transition: { duration: 0.12, delay: 0.16, ease: 'linear' } },
};

const FULL_PANEL: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease: EASE_OUT_EXPO,
      delay: 0.12,
      staggerChildren: 0.04,
      delayChildren: 0.16,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.94,
    y: -6,
    transition: {
      duration: 0.16,
      ease: 'easeIn',
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

const FULL_PANEL_CHILD: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 600, damping: 40 },
  },
  exit: { opacity: 0, y: 4, transition: { duration: 0.1, ease: 'easeIn' } },
};

const REDUCED_BACKDROP: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const REDUCED_PANEL: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const REDUCED_PANEL_CHILD: Variants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

const DRAWER_PANEL: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.24, ease: EASE_OUT_EXPO },
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
};

const REDUCED_DRAWER_PANEL: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

function staggeredChildren(children: ReactNode, childVariants: Variants): ReactNode {
  const arr = Children.toArray(children);
  if (arr.length <= 1) return children;
  return arr.map((child, i) => (
    <motion.div key={i} variants={childVariants}>
      {child}
    </motion.div>
  ));
}

export function BaseModal({
  isOpen,
  onClose,
  titleId,
  size,
  maxWidthClass,
  panelClassName,
  containerClassName,
  embedded = false,
  portal = false,
  placement = 'center',
  children,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const stackPosition = useModalStackPosition(isOpen && !embedded);
  const isTopmost = stackPosition?.isTopmost ?? true;
  const depth = stackPosition?.depth ?? 0;
  const isDrawer = placement === 'right-drawer';

  const backdropVariants = reduceMotion ? REDUCED_BACKDROP : FULL_BACKDROP;
  const panelVariants = isDrawer
    ? (reduceMotion ? REDUCED_DRAWER_PANEL : DRAWER_PANEL)
    : (reduceMotion ? REDUCED_PANEL : FULL_PANEL);
  const childVariants = reduceMotion ? REDUCED_PANEL_CHILD : FULL_PANEL_CHILD;
  // Child stagger applies to centered modals only; drawer panels animate as
  // one slide-in unit, and stagger-wrapping disrupts the flex column layout
  // (header / body / footer) that drawers typically use.
  const renderedChildren = isDrawer ? children : staggeredChildren(children, childVariants);

  const resolvedMaxWidth = maxWidthClass ?? (size ? SIZE_CLASSES[size] : 'max-w-4xl');

  const baseZ = portal ? Z_INDEX_PORTAL_BASE : Z_INDEX_BASE;
  const overlayZIndex = baseZ + depth * Z_INDEX_PER_DEPTH;
  const backdropClass = isTopmost
    ? 'absolute inset-0 bg-black/60 surface-blur-modal'
    : 'absolute inset-0 bg-black/30 surface-blur-popover';

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement as HTMLElement;

    const focusFirst = () => {
      const focusable = modalRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    };

    const raf = requestAnimationFrame(focusFirst);
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  useAppKeyboard((event) => {
    if (event.key === 'Escape') {
      if (!isTopmost) return false;
      onClose();
      return true;
    }

    if (event.key !== 'Tab' || !modalRef.current) return false;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return false;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }

    return false;
  }, { enabled: isOpen, priority: 80 });

  useEffect(() => {
    if (isOpen) return;
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [isOpen]);

  if (embedded) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-labelledby={titleId}
            className="relative"
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {renderedChildren}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const defaultContainerClass = isDrawer
    ? 'fixed inset-0 flex items-start justify-end p-0'
    : `fixed inset-0 flex items-center justify-center ${IS_MOBILE ? 'p-0' : 'p-4'}`;

  const defaultPanelClass = isDrawer
    ? (IS_MOBILE
      ? 'relative h-full w-full bg-background/95 border-l border-primary/20 shadow-elevation-4 overflow-hidden flex flex-col'
      : 'relative h-full w-[480px] bg-background/95 border-l border-primary/20 shadow-elevation-4 overflow-hidden flex flex-col')
    : (IS_MOBILE
      ? 'h-full bg-background overflow-hidden'
      : 'max-h-[85vh] glass-md rounded-2xl shadow-elevation-4 overflow-hidden');

  const panelWidthPrefix = isDrawer
    ? ''
    : `relative w-full ${IS_MOBILE ? 'max-w-full' : resolvedMaxWidth} `;

  const overlay = isOpen ? (
    <motion.div
      key="modal-overlay"
      initial="initial"
      animate="animate"
      exit="exit"
      style={containerClassName ? undefined : { zIndex: overlayZIndex }}
      className={containerClassName ?? defaultContainerClass}
    >
      <motion.div
        variants={backdropVariants}
        onClick={onClose}
        className={backdropClass}
      />
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        variants={panelVariants}
        className={`${panelWidthPrefix}${panelClassName ?? defaultPanelClass}`}
      >
        {renderedChildren}
      </motion.div>
    </motion.div>
  ) : null;

  const animated = <AnimatePresence>{overlay}</AnimatePresence>;

  return portal ? createPortal(animated, document.body) : animated;
}
