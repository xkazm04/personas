import { useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';

import { generateScraperRules, type ScrapeRuleSet } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/**
 * The LLM pipeline builder (Phase 1b-2). Describe what to extract in plain
 * language; the Claude Code CLI reads the target page's HTML and writes the
 * field → rule mapping for you — the alternative to hand-authoring selectors.
 * Shared by every edit-modal variant.
 */
interface LlmRuleBuilderProps {
  urls: string[];
  hasFields: boolean;
  onRules: (rules: ScrapeRuleSet, mode: 'replace' | 'merge') => void;
  /** Compact single-line affordance vs full panel. */
  compact?: boolean;
}

export function LlmRuleBuilder({ urls, hasFields, onRules, compact }: LlmRuleBuilderProps) {
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);

  const generate = async () => {
    if (!description.trim()) return;
    setError(null);
    setLastCount(null);
    try {
      const rules = await generateScraperRules(description.trim(), urls[0]);
      const count = Object.keys(rules ?? {}).length;
      if (count === 0) {
        setError('No fields were generated — try describing the specific items to pull.');
        return;
      }
      onRules(rules, hasFields ? 'merge' : 'replace');
      setLastCount(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={
        compact
          ? 'flex flex-col gap-2'
          : 'rounded-interactive border border-status-info/20 bg-status-info/5 p-3'
      }
    >
      {!compact && (
        <div className="mb-2 flex items-center gap-1.5 typo-label text-status-info">
          <Sparkles className="size-3.5" /> Build with Claude
        </div>
      )}
      <textarea
        className={`${INPUT_FIELD} min-h-[60px] resize-y`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={
          urls.length
            ? 'e.g. the product title, the price, and the in-stock badge'
            : 'Add a URL above, then describe what to extract…'
        }
      />
      <div className="flex items-center justify-between gap-2">
        <span className="typo-caption text-muted-foreground">
          {urls.length
            ? 'Reads the first URL’s HTML to match real selectors.'
            : 'No URL yet — Claude will infer from your description.'}
        </span>
        <AsyncButton
          variant="secondary"
          size="sm"
          disabled={!description.trim()}
          loadingText="Asking Claude…"
          onClick={generate}
        >
          <Wand2 className="size-3.5" /> Generate fields
        </AsyncButton>
      </div>
      {lastCount !== null && (
        <span className="typo-caption text-status-success">
          Added {lastCount} field{lastCount === 1 ? '' : 's'} — review + tweak below.
        </span>
      )}
      {error && <span className="typo-caption text-status-error">{error}</span>}
    </div>
  );
}
