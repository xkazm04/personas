import { Send, X, CornerDownLeft } from 'lucide-react';

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
                ? 'e.g. "Show me all users who signed up last week"'
                : 'Ask a follow-up question...'
            }
            disabled={generating}
            rows={1}
            className="w-full resize-none rounded-xl border border-primary/15 bg-background px-4 py-2.5 pr-10 text-sm text-foreground/85 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/30 disabled:opacity-50 transition-colors"
            style={{ minHeight: '42px', maxHeight: '120px' }}
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
            }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1 text-muted-foreground/30">
            <CornerDownLeft className="w-3 h-3" />
          </div>
        </div>
        <button
          onClick={generating ? onCancel : onSubmit}
          disabled={!generating && !input.trim()}
          className={`shrink-0 p-2.5 rounded-xl border transition-colors ${
            generating
              ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
              : 'bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
          title={generating ? 'Cancel' : 'Send'}
        >
          {generating ? <X className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
