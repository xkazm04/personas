import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Check,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  User,
  Wrench,
  Zap,
  Clock,
  Bell,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useDesignAnalysis } from '@/hooks/design/useDesignAnalysis';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Derive a short agent name from the user's intent. */
function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return 'New Agent';
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? base + '...' : base;
}

/** Calculate persona completeness based on design result fields. */
function calcCompleteness(result: DesignAnalysisResult | null): number {
  if (!result) return 0;
  let filled = 0;
  const total = 6;
  if (result.structured_prompt?.identity) filled++;
  if (result.structured_prompt?.instructions) filled++;
  if (result.full_prompt_markdown) filled++;
  if (result.suggested_tools.length > 0) filled++;
  if (result.suggested_triggers.length > 0) filled++;
  if (result.summary) filled++;
  return Math.round((filled / total) * 100);
}

/** Completeness ring SVG. */
function CompletenessRing({ percent }: { percent: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 80 ? '#34d399' : percent >= 40 ? '#fbbf24' : '#94a3b8';

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22" cy="22" r={radius}
          fill="none" stroke="currentColor"
          className="text-secondary/30" strokeWidth="3"
        />
        <circle
          cx="22" cy="22" r={radius}
          fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="absolute text-[10px] font-bold tabular-nums" style={{ color }}>
        {percent}%
      </span>
    </div>
  );
}

interface ChatCreatorProps {
  onCancel?: () => void;
}

export function ChatCreator({ onCancel }: ChatCreatorProps) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const design = useDesignAnalysis();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [draftPersonaId, setDraftPersonaId] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const accumulatedIntentRef = useRef('');

  const completeness = calcCompleteness(design.result);
  const isThinking = design.phase === 'analyzing' || design.phase === 'refining';

  // Auto-scroll thread on new messages or thinking state change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isThinking, design.result]);

  // When design result arrives, add an assistant message summarizing it
  useEffect(() => {
    if (design.phase === 'preview' && design.result) {
      const summary = design.result.summary || 'Configuration ready.';
      const toolCount = design.result.suggested_tools.length;
      const triggerCount = design.result.suggested_triggers.length;

      let msg = summary;
      if (toolCount > 0 || triggerCount > 0) {
        const parts: string[] = [];
        if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`);
        if (triggerCount > 0) parts.push(`${triggerCount} trigger${triggerCount > 1 ? 's' : ''}`);
        msg += `\n\nI've configured ${parts.join(' and ')} for this agent. You can refine the design by sending more messages, or activate when you're ready.`;
      }

      setMessages((prev) => {
        // Don't add duplicate assistant messages for the same result
        const lastAssistant = [...prev].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant && lastAssistant.content === msg) return prev;
        return [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: msg,
          timestamp: Date.now(),
        }];
      });
    }
  }, [design.phase, design.result]);

  // Handle design question
  useEffect(() => {
    if (design.phase === 'awaiting-input' && design.question) {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: design.question!.question,
        timestamp: Date.now(),
      }]);
    }
  }, [design.phase, design.question]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    // Add user message
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    setInput('');
    accumulatedIntentRef.current += (accumulatedIntentRef.current ? '\n' : '') + text;

    // If answering a question from the design system
    if (design.phase === 'awaiting-input' && design.question) {
      design.answerQuestion(text);
      return;
    }

    if (!draftPersonaId) {
      // First message: create draft persona then start intent compilation
      try {
        const persona = await createPersona({
          name: deriveName(text),
          description: text.slice(0, 200),
          system_prompt: 'You are a helpful AI assistant.',
        });
        setDraftPersonaId(persona.id);
        await design.startIntentCompilation(persona.id, text);
      } catch (err) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to start: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: Date.now(),
        }]);
      }
    } else {
      // Subsequent messages: refine the design
      design.refineAnalysis(text);
    }
  }, [input, isThinking, draftPersonaId, design, createPersona]);

  const handleActivate = useCallback(async () => {
    if (!draftPersonaId || !design.result || isActivating) return;
    setIsActivating(true);

    try {
      await design.applyResult({
        selectedTools: new Set(design.result.suggested_tools),
        selectedTriggerIndices: new Set(design.result.suggested_triggers.map((_, i) => i)),
        selectedChannelIndices: new Set((design.result.suggested_notification_channels ?? []).map((_, i) => i)),
        selectedSubscriptionIndices: new Set((design.result.suggested_event_subscriptions ?? []).map((_, i) => i)),
      });

      setSidebarSection('personas');
      selectPersona(draftPersonaId);
      setEditorTab('use-cases');
    } catch {
      setIsActivating(false);
    }
  }, [draftPersonaId, design, isActivating, selectPersona, setSidebarSection, setEditorTab]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary/60" />
          <span className="text-sm font-medium text-foreground/90">Describe your agent</span>
        </div>
        {design.result && (
          <CompletenessRing percent={completeness} />
        )}
      </div>

      {/* Thread + Preview */}
      <div className="flex-1 flex overflow-hidden">
        {/* Message thread */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            ref={threadRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary/60" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm text-foreground/80">
                    Tell me what you need this agent to do. I'll build the full configuration — prompt, tools, triggers — from your description.
                  </p>
                  <p className="text-xs text-muted-foreground/50">
                    Example: "Watch my GitHub PRs and post a summary to Slack every morning"
                  </p>
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-start gap-3"
              >
                {msg.role === 'user' ? (
                  <div className="w-7 h-7 rounded-lg bg-secondary/50 border border-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground/60" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-primary/60" />
                  </div>
                )}
                <p className="text-sm text-foreground/80 whitespace-pre-wrap pt-1 min-w-0">
                  {msg.content}
                </p>
              </motion.div>
            ))}

            {/* Thinking indicator */}
            {isThinking && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary/60" />
                </div>
                <div className="flex items-center gap-2 pt-1.5">
                  <Loader2 className="w-3.5 h-3.5 text-primary/50 animate-spin" />
                  <span className="text-sm text-muted-foreground/60">
                    {design.phase === 'refining' ? 'Refining design...' : 'Building configuration...'}
                  </span>
                </div>
              </motion.div>
            )}

            {/* Error */}
            {design.error && (
              <p className="text-sm text-red-400 px-10">{design.error}</p>
            )}
          </div>

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
              <button
                onClick={handleSend}
                disabled={!input.trim() || isThinking}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  !input.trim() || isThinking
                    ? 'bg-secondary/30 text-muted-foreground/50 cursor-not-allowed'
                    : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Progressive Preview Panel */}
        <AnimatePresence>
          {design.result && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="border-l border-primary/10 overflow-y-auto overflow-x-hidden"
            >
              <div className="p-3 space-y-3 w-[260px]">
                {/* Preview header */}
                <button
                  onClick={() => setPreviewExpanded(!previewExpanded)}
                  className="flex items-center gap-1.5 w-full text-left"
                >
                  {previewExpanded
                    ? <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
                    : <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                  }
                  <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Preview</span>
                </button>

                {previewExpanded && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-2.5"
                  >
                    {/* Identity */}
                    <PreviewSection icon={Bot} label="Identity">
                      <p className="text-xs text-foreground/70 truncate">
                        {design.result.structured_prompt?.identity
                          ? design.result.structured_prompt.identity.slice(0, 80) + (design.result.structured_prompt.identity.length > 80 ? '...' : '')
                          : '—'}
                      </p>
                    </PreviewSection>

                    {/* Prompt */}
                    <PreviewSection icon={FileText} label="Prompt">
                      <p className="text-xs text-foreground/70">
                        {design.result.full_prompt_markdown
                          ? `${design.result.full_prompt_markdown.split('\n').length} lines`
                          : '—'}
                      </p>
                    </PreviewSection>

                    {/* Tools */}
                    <PreviewSection icon={Wrench} label="Tools" count={design.result.suggested_tools.length}>
                      {design.result.suggested_tools.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {design.result.suggested_tools.slice(0, 5).map((t) => (
                            <span key={t} className="px-1.5 py-0.5 text-[10px] bg-primary/8 border border-primary/12 rounded text-foreground/60 truncate max-w-[100px]">
                              {t}
                            </span>
                          ))}
                          {design.result.suggested_tools.length > 5 && (
                            <span className="text-[10px] text-muted-foreground/50">
                              +{design.result.suggested_tools.length - 5}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/40">None yet</p>
                      )}
                    </PreviewSection>

                    {/* Triggers */}
                    <PreviewSection icon={Zap} label="Triggers" count={design.result.suggested_triggers.length}>
                      {design.result.suggested_triggers.length > 0 ? (
                        <div className="space-y-0.5">
                          {design.result.suggested_triggers.map((t, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Clock className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                              <span className="text-[10px] text-foreground/60 truncate">
                                {t.description || t.trigger_type}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/40">None yet</p>
                      )}
                    </PreviewSection>

                    {/* Subscriptions */}
                    {(design.result.suggested_event_subscriptions ?? []).length > 0 && (
                      <PreviewSection icon={Bell} label="Subscriptions" count={design.result.suggested_event_subscriptions!.length}>
                        <div className="space-y-0.5">
                          {design.result.suggested_event_subscriptions!.map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Bell className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" />
                              <span className="text-[10px] text-foreground/60 truncate">
                                {s.event_type}
                              </span>
                            </div>
                          ))}
                        </div>
                      </PreviewSection>
                    )}

                    {/* Summary */}
                    {design.result.summary && (
                      <div className="px-2 py-1.5 bg-secondary/20 rounded-lg">
                        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                          {design.result.summary}
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Activate button */}
                <button
                  onClick={handleActivate}
                  disabled={isActivating || isThinking || completeness < 40}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActivating || isThinking || completeness < 40
                      ? 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
                      : completeness >= 80
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]'
                        : 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                  }`}
                >
                  {isActivating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : completeness >= 80 ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {isActivating ? 'Activating...' : completeness >= 80 ? 'Activate Agent' : 'Create Agent'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cancel */}
      {onCancel && !draftPersonaId && (
        <div className="px-4 py-2 border-t border-primary/10">
          <button
            onClick={onCancel}
            className="text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Reusable preview section with icon, label, and optional count badge. */
function PreviewSection({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{label}</span>
        {count != null && count > 0 && (
          <span className="ml-auto text-[10px] tabular-nums font-medium text-primary/60 bg-primary/8 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
