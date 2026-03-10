import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
<<<<<<< HEAD
import { IS_MOBILE } from '@/lib/utils/platform';
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  maxWidthClass?: string;
  panelClassName?: string;
  children: React.ReactNode;
}

export function BaseModal({
  isOpen,
  onClose,
  titleId,
  maxWidthClass = 'max-w-4xl',
  panelClassName,
  children,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

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

  return (
<<<<<<< HEAD
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${IS_MOBILE ? 'p-0' : 'p-4'}`}>
=======
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
<<<<<<< HEAD
        className={`relative w-full ${IS_MOBILE ? 'max-w-full' : maxWidthClass} ${panelClassName ?? (IS_MOBILE ? 'h-full bg-background overflow-hidden' : 'max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden')}`}
=======
        className={`relative w-full ${maxWidthClass} ${panelClassName ?? 'max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden'}`}
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      >
        {children}
      </motion.div>
    </div>
  );
}
