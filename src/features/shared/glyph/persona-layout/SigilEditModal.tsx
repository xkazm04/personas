import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X, Power, ChevronRight } from 'lucide-react';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import { DIM_LABEL } from '@/features/shared/glyph/persona-sigil';
import type { GlyphDimension } from '@/features/shared/glyph';

export interface SigilEditModalProps {
  /** Which dim's editor is open. The modal renders nothing when null. */
  dim: GlyphDimension | null;

  /** Whether this dim is currently active for the capability the modal
   *  is editing. Boolean-shaped dims (memory/review/event/error) treat
   *  this as the toggle state and show an explicit Enable / Disable
   *  control. List-shaped dims (connector/trigger/message/task) use
   *  it as a "this capability declares this dim" signal — the toggle
   *  effectively detaches/attaches the dim from the capability. */
  isActive: boolean;

  /** Caller-rendered body content for this dim — the per-dim editor.
   *  Modal owns chrome (header band, footer); caller owns the editor
   *  shape. Falls back to a placeholder when null. */
  body?: ReactNode;

  /** Optional caller-rendered footer slot — used by editors that want
   *  a custom primary action (Save, Apply) alongside the standard
   *  toggle. Renders to the LEFT of the standard footer controls. */
  footerExtra?: ReactNode;

  /** Toggle the active state. Boolean-shaped dims use this as the
   *  primary control; list-shaped dims use it to detach/reattach the
   *  dim. The parent owns the persistence (View → persona update,
   *  Adoption → adoption answer, Build → disabled_dims). */
  onToggleActive: (next: boolean) => void;

  /** Close the modal. Parent clears `dim` to null. */
  onClose: () => void;
}

/**
 * The petal-click edit modal — opened when the user clicks a sigil
 * petal on the active capability's hero glyph. Each petal becomes
 * the entry-point for editing that dim of the capability.
 *
 * Modal shell is mode-agnostic: it provides the dim-colored header,
 * the active/inactive toggle, and the close button. The actual
 * editor content (schedule picker, channel picker, memory toggle,
 * etc.) is caller-provided via the `body` slot — so View / Adoption /
 * Build can each compose the right editor without forking the shell.
 *
 * Renders as a wide overlay positioned absolute over the sigil stage,
 * the same affordance the adoption answer card uses. Click-through
 * works the same way: empty regions of the overlay stay click-through
 * so the sigil stays interactive; the modal body opts in via its own
 * pointer-events.
 */
export function SigilEditModal({
  dim,
  isActive,
  body,
  footerExtra,
  onToggleActive,
  onClose,
}: SigilEditModalProps) {
  if (!dim) return null;

  const meta = DIM_META[dim];
  const Icon = meta.icon;
  const dimLabel = DIM_LABEL[dim];

  return (
    <motion.div
      key={`sigil-edit-${dim}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto relative rounded-modal border bg-background/95 backdrop-blur-md shadow-elevation-3 w-full max-w-[560px] flex flex-col"
      style={{
        borderColor: `${meta.color}66`,
        boxShadow: `0 0 24px ${meta.color}33, 0 8px 32px rgba(0,0,0,0.35)`,
      }}
    >
      {/* Header — dim-colored band with icon + label + close. */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b"
        style={{
          borderColor: `${meta.color}33`,
          background: `linear-gradient(90deg, ${meta.color}1a 0%, transparent 100%)`,
        }}
      >
        <Icon className={`w-5 h-5 ${meta.colorClass}`} />
        <div className="flex-1 min-w-0">
          <span className={`typo-label uppercase tracking-[0.18em] ${meta.colorClass}`}>
            {dimLabel}
          </span>
          <p className="typo-caption text-foreground/60 mt-0.5">
            {isActive ? 'Active for this capability' : 'Inactive — toggle on to enable'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-foreground/55 hover:text-foreground hover:bg-foreground/5 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body — caller-provided editor. Scrolls if it overflows. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {body ?? (
          <div className="flex items-center gap-2 typo-caption text-foreground/55 italic">
            <ChevronRight className="w-3.5 h-3.5" />
            No editor wired for this dim yet — toggle below adjusts its
            active state on this capability.
          </div>
        )}
      </div>

      {/* Footer — toggle (always present) + caller-extra (optional). */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-card-border bg-foreground/[0.02] rounded-b-modal">
        {footerExtra}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onToggleActive(!isActive)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full typo-caption transition-colors cursor-pointer ${
            isActive
              ? 'bg-foreground/5 hover:bg-foreground/10 text-foreground/75'
              : 'bg-primary/15 hover:bg-primary/30 text-primary border border-primary/40'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          {isActive ? 'Disable for this capability' : 'Enable for this capability'}
        </button>
      </div>
    </motion.div>
  );
}
