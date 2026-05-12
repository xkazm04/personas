import { HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

function useGlossary(): Record<string, string> {
  const { t } = useTranslation();
  return {
    webhook: t.shared.glossary_webhook,
    schema: t.shared.glossary_schema,
    payload: t.shared.glossary_payload,
    endpoint: t.shared.glossary_endpoint,
    json: t.shared.glossary_json,
    api: t.shared.glossary_api,
    credential: t.shared.glossary_credential,
    oauth: t.shared.glossary_oauth,
  };
}

interface GlossaryTooltipProps {
  /** The technical term to look up (case-insensitive). */
  term: string;
  /** Optional override for the tooltip text. */
  definition?: string;
}

/**
 * Renders a small help icon that shows a plain-language definition
 * when the user hovers over it. Use this next to technical terms
 * that cannot be fully replaced in the UI.
 */
export function GlossaryTooltip({ term, definition }: GlossaryTooltipProps) {
  const glossary = useGlossary();
  const text = definition ?? glossary[term.toLowerCase()];
  if (!text) return null;

  return (
    <Tooltip content={text} placement="top" delay={200}>
      <span className="inline-flex items-center ml-0.5 text-foreground/90 hover:text-foreground transition-colors cursor-help">
        <HelpCircle className="w-3 h-3" />
      </span>
    </Tooltip>
  );
}
