import { Send, X, CornerDownLeft } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface ChatInputProps {
  input: string;
  generating: boolean;
  hasMessages: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function ChatInput({
  input,
  generating,
  hasMessages,
  inputRef,
  onInputChange,
  onKeyDown,
  onSubmit,
  onCancel,
}: ChatInputProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="shrink-0 border-t border-primary/10 px-4 py-3 bg-secondary/10">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              !hasMessages
                ? db.placeholder_initial
                : db.placeholder_followup
            }
            // Deliberately NOT disabled while generating. A generation runs for
            // up to NL_QUERY_POLL_TIMEOUT_MS (60s), and disabling the textarea
            // dropped focus to <body> and threw away every keystroke of the
            // follow-up the user was drafting. The double-submit guard lives in
            // ChatTab's handleSubmit (`if (!question || generating) return`), so
            // Enter during generation is simply ignored — the draft survives and
            // sends once the answer lands. The button beside it already renders
            // Cancel rather than Send for the whole window.
            rows={1}
            className="w-full resize-none rounded-modal border border-primary/15 bg-background px-4 py-2.5 pr-10 typo-body text-foreground/85 placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/30 transition-colors"
            style={{ minHeight: '42px', maxHeight: '120px' }}
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
            }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1 text-foreground">
            <CornerDownLeft className="w-3 h-3" />
          </div>
        </div>
        <Tooltip content={generating ? t.common.cancel : t.common.send}>
          <button
            type="button"
            onClick={generating ? onCancel : onSubmit}
            disabled={!generating && !input.trim()}
            className={`shrink-0 p-2.5 rounded-modal border transition-colors ${
              generating
                ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                : 'bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
            aria-label={generating ? t.common.cancel : t.common.send}
          >
            {generating ? <X className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
