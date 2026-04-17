import { type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Tooltip } from '../display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

export interface CopyButtonProps {
  /** Text to copy — mutually exclusive with `copied`/`onCopy` (managed mode). */
  text?: string;
  /** Externally-managed copied state (for async copy flows). */
  copied?: boolean;
  /** Externally-managed copy handler (for async copy flows). */
  onCopy?: () => void;
  /** Label shown next to the icon (omit for icon-only). */
  label?: string;
  /** Label shown in copied state (default "Copied"). */
  copiedLabel?: string;
  /** Tooltip text (defaults to label or "Copy"). Shown on hover. */
  tooltip?: string;
  /** Icon size Tailwind class (default "w-3.5 h-3.5"). */
  iconSize?: string;
  /** Additional className for the outer button. */
  className?: string;
  /** Custom idle icon (defaults to Copy from lucide). */
  icon?: ReactNode;
  /** Custom copied icon (defaults to Check from lucide). */
  copiedIcon?: ReactNode;
  /** Disable the button. */
  disabled?: boolean;
}

const springTransition = { type: 'spring' as const, stiffness: 500, damping: 25 };

export function CopyButton({
  text,
  copied: externalCopied,
  onCopy: externalOnCopy,
  label,
  copiedLabel: copiedLabelProp,
  tooltip,
  iconSize = 'w-3.5 h-3.5',
  className = '',
  icon,
  copiedIcon,
  disabled,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const internal = useCopyToClipboard(2000);
  const isManaged = externalCopied !== undefined;
  const copied = isManaged ? externalCopied : internal.copied;
  const copiedLabel = copiedLabelProp ?? t.shared.copy_copied;

  const handleClick = () => {
    if (disabled) return;
    if (isManaged && externalOnCopy) {
      externalOnCopy();
    } else if (text !== undefined) {
      internal.copy(text);
    }
  };

  const hasLabel = !!label;
  const resolvedTooltip = tooltip ?? (hasLabel ? undefined : t.shared.copy_tooltip);

  const btn = (
    <button
      type="button"
      title={resolvedTooltip ?? undefined}
      onClick={handleClick}
      disabled={disabled}
      className={[
        'relative inline-flex items-center gap-1.5 transition-colors focus-ring',
        hasLabel
          ? 'px-2 py-0.5 rounded-lg text-sm'
          : 'p-1.5 rounded-lg',
        copied
          ? 'text-emerald-400'
          : 'text-foreground hover:text-foreground/80 hover:bg-secondary/50',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* Emerald flash background */}
      <AnimatePresence>
        {copied && (
          <motion.span
            className="absolute inset-0 rounded-[inherit] bg-emerald-500/15 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>

      {/* Icon with morph animation */}
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            className={`${iconSize} shrink-0 relative`}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={springTransition}
          >
            {copiedIcon ?? <Check className={`${iconSize} text-emerald-400`} />}
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className={`${iconSize} shrink-0 relative`}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={springTransition}
          >
            {icon ?? <Copy className={iconSize} />}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Optional label */}
      {hasLabel && (
        <span className="relative">{copied ? copiedLabel : label}</span>
      )}
    </button>
  );

  if (resolvedTooltip) {
    return (
      <Tooltip content={copied ? t.shared.copy_copied_bang : resolvedTooltip}>
        {btn}
      </Tooltip>
    );
  }

  return btn;
}
