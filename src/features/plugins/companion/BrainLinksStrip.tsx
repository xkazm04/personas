import { Link2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BrainKind } from '@/api/companion';
import { parseBrainLinks } from './parseBrainLinks';

/**
 * Renders a small "Linked memories" chip strip below a markdown body
 * that contains brain-id tokens. Used by:
 *   - BrainViewer DetailView (Cycle 7): under the detail markdown
 *   - Bubble (Cycle 9): under each assistant bubble whose text mentions
 *     one or more brain ids
 *
 * Returns null when content has no matches — caller doesn't need to
 * guard. Click on a chip calls `onOpen(kind, id)` which both call sites
 * route to `setBrainView({ open: true, kind, id })`.
 */
export function BrainLinksStrip({
  content,
  onOpen,
  variant = 'card',
}: {
  content: string;
  onOpen: (kind: BrainKind, id: string) => void;
  /**
   * Visual treatment. `card` matches the DetailView container (full-width
   * bordered card); `inline` is a tighter shape that sits below a chat
   * bubble without competing with it.
   */
  variant?: 'card' | 'inline';
}) {
  const { t } = useTranslation();
  const links = parseBrainLinks(content);
  if (links.length === 0) return null;

  const containerClass =
    variant === 'card'
      ? 'rounded-card border border-foreground/10 bg-secondary/40 px-3 py-2'
      : 'pt-1';

  return (
    <div
      className={containerClass}
      data-testid="companion-brain-links"
      data-variant={variant}
    >
      <div className="inline-flex items-baseline gap-1.5 typo-caption text-foreground mb-1.5">
        <Link2 className="w-3 h-3 self-center" />
        <span>{t.plugins.companion.brain_linked_label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {links.map((link) => (
          <button
            key={link.raw}
            type="button"
            onClick={() => onOpen(link.kind, link.id)}
            className="inline-flex items-baseline gap-1 rounded-interactive border border-foreground/15 bg-foreground/[0.04] hover:bg-foreground/[0.08] hover:border-primary/30 px-1.5 py-0.5 typo-caption text-foreground transition-colors focus-ring"
            data-testid="companion-brain-link"
            data-kind={link.kind}
            data-id={link.id}
          >
            <code className="font-mono">{link.raw}</code>
          </button>
        ))}
      </div>
    </div>
  );
}
