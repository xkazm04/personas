import { HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';

/** Plain-language definitions for technical terms that cannot be fully avoided in the UI. */
const GLOSSARY: Record<string, string> = {
  webhook: 'A URL that receives automatic notifications when something happens — like a mailbox for your app.',
  schema: 'The expected shape of incoming data — which fields are required and what type they should be.',
  payload: 'The actual data sent along with a request or event.',
  endpoint: 'A specific address where your agent can be reached or send data.',
  json: 'A common text format for structured data, using curly braces and key-value pairs.',
  api: 'A way for two programs to talk to each other automatically.',
  credential: 'A saved login or access key that lets the agent connect to an external service.',
  oauth: 'A secure way to grant access without sharing your password.',
};

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
  const text = definition ?? GLOSSARY[term.toLowerCase()];
  if (!text) return null;

  return (
    <Tooltip content={text} placement="top" delay={200}>
      <span className="inline-flex items-center ml-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-help">
        <HelpCircle className="w-3 h-3" />
      </span>
    </Tooltip>
  );
}
