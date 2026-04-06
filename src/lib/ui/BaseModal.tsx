import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IS_MOBILE } from '@/lib/utils/platform/platform';

const SIZE_CLASSES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
  full: 'max-w-5xl',
  '6xl': 'max-w-6xl',
} as const;

export type BaseModalSize = keyof typeof SIZE_CLASSES;

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
  children: React.ReactNode;
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
  children,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const resolvedMaxWidth = maxWidthClass ?? (size ? SIZE_CLASSES[size] : 'max-w-4xl');

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

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) return;
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [isOpen]);

  if (!isOpen) return null;

  if (embedded) {
    return (
      <div ref={modalRef} role="dialog" aria-labelledby={titleId} className="relative">
        {children}
      </div>
    );
  }

  const content = (
    <div className={containerClassName ?? `fixed inset-0 ${portal ? 'z-[10000]' : 'z-50'} flex items-center justify-center ${IS_MOBILE ? 'p-0' : 'p-4'}`}>
      <div
        className="animate-fade-slide-in absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-fade-slide-in relative w-full ${IS_MOBILE ? 'max-w-full' : resolvedMaxWidth} ${panelClassName ?? (IS_MOBILE ? 'h-full bg-background overflow-hidden' : 'max-h-[85vh] glass-md rounded-2xl shadow-elevation-4 overflow-hidden')}`}
      >
        {children}
      </div>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}
