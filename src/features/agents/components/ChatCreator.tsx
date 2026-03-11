import { motion } from 'framer-motion';
import {
  MessageCircle,
  Send,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { CompletenessRing } from './persona/CompletenessRing';
import { PreviewPanel } from './preview/PreviewPanel';
import { ChatThread } from './ChatThread';
import { useChatCreatorState } from './useChatCreatorState';

interface ChatCreatorProps {
  onCancel?: () => void;
  /** Called once when the draft persona is first created (for parent tracking). */
  onCreated?: (id: string) => void;
  /** Called after the agent is successfully activated. */
  onActivated?: () => void;
}

export function ChatCreator({ onCancel, onCreated, onActivated }: ChatCreatorProps) {
  const {
    design,
    messages,
    input,
    setInput,
    isActivating,
    previewExpanded,
    setPreviewExpanded,
    threadRef,
    inputRef,
    completeness,
    isThinking,
    handleSend,
    handleActivate,
    handleKeyDown,
  } = useChatCreatorState({ onCreated, onActivated });

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary/60" />
          <span className="text-sm font-medium text-foreground/90">Describe your agent</span>
        </div>
        {design.result && <CompletenessRing percent={completeness} />}
      </div>

      {/* Thread + Preview */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <ChatThread
            ref={threadRef}
            messages={messages}
            isThinking={isThinking}
            thinkingLabel={design.phase === 'refining' ? 'Refining design...' : 'Building configuration...'}
            error={design.error}
          />

          {/* Input */}
          <div className="px-4 py-3 border-t border-primary/10">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  messages.length === 0
                    ? 'Describe what your agent should do...'
                    : design.phase === 'awaiting-input'
                      ? 'Answer the question above...'
                      : 'Refine the design...'
                }
                disabled={isThinking}
                className="flex-1 min-h-[44px] max-h-[100px] bg-secondary/30 border border-primary/15 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-50"
                autoFocus
              />
              <Button
                variant="secondary"
                size="icon-md"
                icon={<Send className="w-3.5 h-3.5" />}
                onClick={handleSend}
                disabled={!input.trim() || isThinking}
              />
            </div>
            {!input.trim() && !isThinking && messages.length === 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="text-muted-foreground text-xs mt-1.5"
              >
                Describe what your agent should do to get started
              </motion.p>
            )}
          </div>
        </div>

        {/* Progressive Preview Panel */}
        {design.result && (
          <PreviewPanel
            design={design}
            completeness={completeness}
            isThinking={isThinking}
            isActivating={isActivating}
            previewExpanded={previewExpanded}
            setPreviewExpanded={setPreviewExpanded}
            onActivate={handleActivate}
          />
        )}
      </div>

      {/* Cancel */}
      {onCancel && (
        <div className="px-4 py-2 border-t border-primary/10">
          <Button variant="link" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
