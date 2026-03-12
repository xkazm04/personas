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

const STARTER_PROMPTS = [
  'Monitor my GitHub PRs and notify me on Slack',
  'Summarize daily Slack channels into a digest',
  'Track competitor pricing and alert on changes',
];

function ChatIllustration() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80">
      <defs>
        <linearGradient id="chat-grad" x1="30" y1="20" x2="170" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="chat-grad-light" x1="30" y1="20" x2="170" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {/* Chat bubble */}
      <rect x="30" y="20" rx="16" ry="16" width="100" height="60" fill="url(#chat-grad-light)" stroke="url(#chat-grad)" strokeWidth="1.5" />
      <circle cx="60" cy="50" r="4" fill="url(#chat-grad)" opacity="0.6" />
      <circle cx="80" cy="50" r="4" fill="url(#chat-grad)" opacity="0.8" />
      <circle cx="100" cy="50" r="4" fill="url(#chat-grad)" opacity="1" />
      {/* Bubble tail */}
      <path d="M50 80 L40 95 L65 80" fill="url(#chat-grad-light)" stroke="url(#chat-grad)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Agent silhouette */}
      <circle cx="150" cy="60" r="22" fill="url(#chat-grad)" opacity="0.15" />
      <circle cx="150" cy="52" r="10" fill="url(#chat-grad)" opacity="0.4" />
      <path d="M132 78 C132 68 140 62 150 62 C160 62 168 68 168 78" fill="url(#chat-grad)" opacity="0.3" />
      {/* Connecting arc */}
      <path d="M120 50 Q135 35 145 42" stroke="url(#chat-grad)" strokeWidth="1.5" strokeDasharray="4 3" fill="none" opacity="0.5" />
      {/* Sparkle */}
      <path d="M160 30 L162 26 L164 30 L168 32 L164 34 L162 38 L160 34 L156 32 Z" fill="url(#chat-grad)" opacity="0.5" />
      {/* Bottom label line */}
      <rect x="55" y="115" rx="4" ry="4" width="90" height="8" fill="url(#chat-grad)" opacity="0.1" />
    </svg>
  );
}

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
                className="flex-1 min-h-[44px] max-h-[100px] bg-secondary/30 border border-primary/20 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-50"
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
            {!isThinking && messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col items-center gap-3 mt-3"
              >
                <ChatIllustration />
                <p className="text-muted-foreground text-xs">Describe what your agent should do to get started</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="px-2.5 py-1 text-xs rounded-full border border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/10 hover:border-primary/30 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </motion.div>
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
