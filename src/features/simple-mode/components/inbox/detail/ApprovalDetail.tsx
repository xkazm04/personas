/**
 * ApprovalDetail — detail pane for `kind: 'approval'` items in Phase 09 Inbox.
 *
 * Renders:
 *   1. Detail header — illustration wash + kind badge + title + relative time
 *   2. "The ask" accent card with the item body (the human-readable prompt)
 *   3. Context pairs (parsed from `item.data.contextData`, if present + valid JSON)
 *   4. Numbered suggested-action buttons (parsed from `item.data.suggestedActions`)
 *   5. Notes textarea (state owned by InboxVariant, threaded through props)
 *
 * All JSON parsing is wrapped in try/catch — raw strings might be malformed
 * or plain text. On parse failure we silently omit the section instead of
 * crashing or showing a scary error.
 *
 * Actions (Approve / Reject / Defer) are NOT rendered here — the variant's
 * bottom ActionZone owns those buttons, reading them from `useInboxActions`.
 * This keeps action logic in one place and lets keyboard Enter fire the
 * primary action regardless of whether the detail pane's notes field is
 * focused (the variant suppresses Enter while the textarea has focus, so
 * users can still add multi-line notes).
 */
import { ShieldCheck } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { UnifiedInboxItem } from '../../../types';
import { DetailHeader } from './DetailHeader';

export interface ApprovalDetailProps {
  item: Extract<UnifiedInboxItem, { kind: 'approval' }>;
  notes: string;
  onNotesChange: (next: string) => void;
}

/** Context pairs are rendered as label/value rows. Accepts any JSON-ish shape
 *  but defensively narrows to `Record<string, unknown>`. */
interface ContextPair {
  key: string;
  value: string;
}

/** Suggested actions are short pre-written notes the user can click to
 *  populate the textarea. Parse tolerates either an array of strings or an
 *  array of `{ label | text }` objects. */
function parseSuggestedActions(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        out.push(entry);
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const label = obj.label ?? obj.text ?? obj.action ?? obj.title;
        if (typeof label === 'string') out.push(label);
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function parseContextPairs(raw: string | null): ContextPair[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const pairs: ContextPair[] = [];
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      pairs.push({
        key,
        value:
          typeof value === 'string'
            ? value
            : value === null || value === undefined
              ? '—'
              : JSON.stringify(value),
      });
    }
    return pairs.length > 0 ? pairs : null;
  } catch {
    return null;
  }
}

export function ApprovalDetail({ item, notes, onNotesChange }: ApprovalDetailProps) {
  const { t, tx } = useTranslation();
  const s = t.simple_mode;
  const inb = s.inbox;

  const contextPairs = parseContextPairs(item.data.contextData);
  const suggestions = parseSuggestedActions(item.data.suggestedActions);

  return (
    <div className="flex flex-col min-h-0 overflow-auto">
      <DetailHeader
        item={item}
        kindIcon={<ShieldCheck className="w-3.5 h-3.5" />}
        kindTone="amber"
      />

      <div className="px-6 pb-6 flex flex-col gap-5">
        {/* The ask */}
        <section>
          <div className="typo-label uppercase tracking-wider text-foreground/40 mb-2">
            {inb.the_ask_label}
          </div>
          <div className="rounded-2xl border simple-accent-amber-border simple-accent-amber-soft px-4 py-3">
            <p className="typo-body-lg text-foreground">{item.body}</p>
          </div>
        </section>

        {/* Context */}
        {contextPairs && contextPairs.length > 0 ? (
          <section>
            <div className="typo-label uppercase tracking-wider text-foreground/40 mb-2">
              {inb.details_label}
            </div>
            <dl className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] divide-y divide-foreground/5">
              {contextPairs.map((pair) => (
                <div key={pair.key} className="px-4 py-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                  <dt className="typo-caption italic text-foreground/55 truncate">{pair.key}</dt>
                  <dd className="typo-body text-foreground/80 truncate">{pair.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {/* Suggested actions */}
        {suggestions && suggestions.length > 0 ? (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="typo-label uppercase tracking-wider text-foreground/40">
                {inb.suggested_label}
              </span>
              <span className="typo-caption italic text-foreground/40">
                {tx(inb.suggested_hint, { n: Math.min(suggestions.length, 9) })}
              </span>
            </div>
            <ol className="flex flex-col gap-2">
              {suggestions.slice(0, 9).map((suggestion, idx) => (
                <li key={`${idx}-${suggestion}`}>
                  <button
                    type="button"
                    onClick={() => onNotesChange(suggestion)}
                    className="w-full text-left flex items-start gap-3 rounded-2xl border border-foreground/10 bg-foreground/[0.02] px-3 py-2 hover:border-foreground/20 hover:bg-foreground/[0.04] transition-colors"
                  >
                    <span className="typo-caption simple-accent-amber-text shrink-0 w-5 text-right">
                      {idx + 1}.
                    </span>
                    <span className="typo-body text-foreground/80">{suggestion}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Notes */}
        <section>
          <label className="block">
            <span className="typo-label uppercase tracking-wider text-foreground/40 block mb-2">
              {inb.notes_placeholder}
            </span>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={inb.notes_placeholder}
              rows={3}
              className="w-full rounded-2xl border border-foreground/10 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30 resize-none"
            />
          </label>
          <div className="mt-1 flex items-center justify-between typo-caption text-foreground/50">
            <span className="italic">{inb.notes_hint}</span>
            <span className="italic">{inb.notes_send_hint}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
