import { Lightbulb, ArrowRight } from 'lucide-react';
import { CARD_PADDING, LIST_ITEM_GAP } from '@/lib/utils/designTokens';

export interface GuideItem {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface DisabledGuideProps {
  items: GuideItem[];
}

/**
 * Actionable inline guidance card shown when a lab panel's run button is disabled.
 * Replaces terse tooltip text with warm, encouraging messages and optional navigation links.
 */
export function DisabledGuide({ items }: DisabledGuideProps) {
  if (items.length === 0) return null;

  return (
    <div className={`rounded-card border border-primary/15 bg-primary/[0.04] ${CARD_PADDING.compact} flex flex-col ${LIST_ITEM_GAP.dense}`}>
      {items.map((item, i) => (
        <div key={i} className={`flex items-start ${LIST_ITEM_GAP.cards}`}>
          <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0 opacity-70" />
          <div className={`flex flex-wrap items-baseline ${LIST_ITEM_GAP.dense}`}>
            <span className="typo-body text-foreground">{item.message}</span>
            {item.actionLabel && item.onAction && (
              <button
                onClick={item.onAction}
                className={`inline-flex items-center ${LIST_ITEM_GAP.dense} typo-body text-primary font-medium hover:underline underline-offset-2 transition-colors`}
              >
                {item.actionLabel}
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
