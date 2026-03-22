import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Plus, Trash2, Bot, User, Wrench, Heart, Play, FlaskConical, Shield, Brain, Pencil, Wand2, ListChecks, History, Zap } from 'lucide-react';
import type { ChatMode } from '@/stores/slices/agents/chatSlice';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import type { ChatMessage } from '@/lib/bindings/ChatMessage';
import { classifyLine } from '@/lib/utils/terminalColors';

// ── Chat Bubble ──────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary/15 text-primary' : 'bg-violet-500/15 text-violet-400'
      }`}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-br-md'
          : 'bg-muted/60 text-foreground border border-primary/10 rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <span className={`block text-[10px] mt-1 ${
          isUser ? 'text-primary-foreground/60' : 'text-muted-foreground/60'
        }`}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ── Streaming Bubble ────────────────────────────────────────────────────

function StreamingBubble({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  // Filter out non-text lines (system init, tool calls, etc.)
  const textLines = lines.filter((l) => {
    const cls = classifyLine(l);
    return cls === 'text';
  });
  if (textLines.length === 0) {
    return (
      <div className="flex gap-2.5">
        <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <div className="bg-muted/60 border border-primary/10 rounded-2xl rounded-bl-md px-3.5 py-2.5">
          <LoadingSpinner className="text-muted-foreground" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400">
        <Bot className="w-3.5 h-3.5" />
      </div>
      <div className="max-w-[75%] bg-muted/60 text-foreground border border-primary/10 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap break-words">{textLines.join('\n')}</p>
      </div>
    </div>
  );
}

// ── Session List Sidebar ────────────────────────────────────────────────

function SessionSidebar({
  personaId,
  onNewSession,
}: {
  personaId: string;
  onNewSession: () => void;
}) {
  const sessions = useAgentStore((s) => s.chatSessions);
  const activeSessionId = useAgentStore((s) => s.activeChatSessionId);
  const fetchMessages = useAgentStore((s) => s.fetchChatMessages);
  const clearSession = useAgentStore((s) => s.clearChatSession);

  return (
    <div className="w-48 border-r border-primary/10 flex flex-col h-full">
      <div className="p-2 border-b border-primary/10">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground/60 text-center py-4 px-2">
            No conversations yet
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md cursor-pointer text-xs transition-colors ${
              activeSessionId === s.sessionId
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
            }`}
            onClick={() => fetchMessages(personaId, s.sessionId)}
          >
            <span className="flex-1 truncate">
              {new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              {' '}
              {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-[10px] text-muted-foreground/50">{s.messageCount}</span>
            <button
              onClick={(e) => { e.stopPropagation(); clearSession(personaId, s.sessionId); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ops Preset Cards ────────────────────────────────────────────────────

interface OpsPreset {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: string;
  color: string;
  options?: { key: string; label: string; placeholder: string; defaultValue?: string }[];
}

const OPS_PRESETS: OpsPreset[] = [
  {
    id: 'health', icon: <Heart className="w-4 h-4" />, label: 'Health Check',
    description: 'Run diagnostics and find config issues',
    prompt: 'Run a health check on this agent and report any issues with suggested fixes.',
    color: 'emerald',
  },
  {
    id: 'execute', icon: <Play className="w-4 h-4" />, label: 'Execute',
    description: 'Run the agent with optional input',
    prompt: 'Execute this agent now.',
    color: 'blue',
    options: [{ key: 'input', label: 'Input (optional)', placeholder: 'Custom input data for this execution...' }],
  },
  {
    id: 'arena', icon: <FlaskConical className="w-4 h-4" />, label: 'Arena Test',
    description: 'Compare models head-to-head',
    prompt: 'Start an arena test comparing haiku and sonnet models on this agent.',
    color: 'violet',
    options: [{ key: 'models', label: 'Models', placeholder: 'haiku, sonnet', defaultValue: 'haiku, sonnet' }],
  },
  {
    id: 'improve', icon: <Wand2 className="w-4 h-4" />, label: 'Improve Prompt',
    description: 'AI-driven prompt refinement',
    prompt: 'Start a matrix improvement to make the prompt more specific and actionable.',
    color: 'amber',
    options: [{ key: 'instruction', label: 'Improvement focus', placeholder: 'e.g., Add error handling, improve output format...' }],
  },
  {
    id: 'assertions', icon: <Shield className="w-4 h-4" />, label: 'Assertions',
    description: 'Manage output validation rules',
    prompt: 'List all assertions for this agent and show their pass rates.',
    color: 'rose',
  },
  {
    id: 'history', icon: <History className="w-4 h-4" />, label: 'Executions',
    description: 'Review recent execution history',
    prompt: 'Show the last 5 executions with status, duration, and cost.',
    color: 'sky',
  },
  {
    id: 'knowledge', icon: <Brain className="w-4 h-4" />, label: 'Knowledge',
    description: 'View memories and learned patterns',
    prompt: 'Show this agent\'s memories and knowledge annotations.',
    color: 'purple',
  },
  {
    id: 'edit', icon: <Pencil className="w-4 h-4" />, label: 'Edit Prompt',
    description: 'Modify prompt sections directly',
    prompt: 'Show me the current prompt sections and suggest improvements.',
    color: 'orange',
    options: [{ key: 'section', label: 'Section', placeholder: 'instructions, identity, toolGuidance, examples, errorHandling', defaultValue: 'instructions' }],
  },
  {
    id: 'versions', icon: <ListChecks className="w-4 h-4" />, label: 'Versions',
    description: 'Prompt version history and rollback',
    prompt: 'List prompt versions and show which is tagged as production.',
    color: 'teal',
  },
  {
    id: 'diagnose', icon: <Zap className="w-4 h-4" />, label: 'Diagnose',
    description: 'Deep analysis of agent performance',
    prompt: 'Analyze this agent\'s recent performance. Check health, review last executions, and identify areas for improvement.',
    color: 'cyan',
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; hover: string }> = {
  emerald: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
  blue:    { bg: 'bg-blue-500/8',    border: 'border-blue-500/20',    text: 'text-blue-400',    hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
  violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/20',  text: 'text-violet-400',  hover: 'hover:bg-violet-500/15 hover:border-violet-500/30' },
  amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/20',   text: 'text-amber-400',   hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
  rose:    { bg: 'bg-rose-500/8',    border: 'border-rose-500/20',    text: 'text-rose-400',    hover: 'hover:bg-rose-500/15 hover:border-rose-500/30' },
  sky:     { bg: 'bg-sky-500/8',     border: 'border-sky-500/20',     text: 'text-sky-400',     hover: 'hover:bg-sky-500/15 hover:border-sky-500/30' },
  purple:  { bg: 'bg-purple-500/8',  border: 'border-purple-500/20',  text: 'text-purple-400',  hover: 'hover:bg-purple-500/15 hover:border-purple-500/30' },
  orange:  { bg: 'bg-orange-500/8',  border: 'border-orange-500/20',  text: 'text-orange-400',  hover: 'hover:bg-orange-500/15 hover:border-orange-500/30' },
  teal:    { bg: 'bg-teal-500/8',    border: 'border-teal-500/20',    text: 'text-teal-400',    hover: 'hover:bg-teal-500/15 hover:border-teal-500/30' },
  cyan:    { bg: 'bg-cyan-500/8',    border: 'border-cyan-500/20',    text: 'text-cyan-400',    hover: 'hover:bg-cyan-500/15 hover:border-cyan-500/30' },
};

function OpsLaunchpad({ personaName, onSend }: { personaName: string; onSelect?: (prompt: string) => void; onSend: (prompt: string) => void }) {
  const [selectedPreset, setSelectedPreset] = useState<OpsPreset | null>(null);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});

  const handleCardClick = (preset: OpsPreset) => {
    if (preset.options && preset.options.length > 0) {
      setSelectedPreset(preset);
      const defaults: Record<string, string> = {};
      for (const opt of preset.options) {
        defaults[opt.key] = opt.defaultValue ?? '';
      }
      setOptionValues(defaults);
    } else {
      onSend(preset.prompt);
    }
  };

  const handleOptionSend = () => {
    if (!selectedPreset) return;
    let prompt = selectedPreset.prompt;
    for (const opt of selectedPreset.options ?? []) {
      const val = optionValues[opt.key]?.trim();
      if (val) {
        prompt += `\n${opt.label}: ${val}`;
      }
    }
    setSelectedPreset(null);
    onSend(prompt);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top half: Card grid */}
      <div className="flex-1 flex flex-col justify-center px-2">
        <div className="text-center mb-4">
          <p className="text-sm font-medium text-foreground/70">Operations for <span className="text-primary">{personaName}</span></p>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5">Select an action or type a command below</p>
        </div>
        <div className="grid grid-cols-5 gap-2 max-w-[640px] mx-auto">
          {OPS_PRESETS.map((preset) => {
            const c = COLOR_MAP[preset.color] || COLOR_MAP['blue']!;
            const isSelected = selectedPreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleCardClick(preset)}
                className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-150 cursor-pointer text-center ${c.bg} ${c.border} ${c.hover} ${isSelected ? 'ring-1 ring-primary/40 scale-[1.02]' : ''}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg} ${c.text} group-hover:scale-110 transition-transform`}>
                  {preset.icon}
                </div>
                <span className="text-[11px] font-medium text-foreground/80 leading-tight">{preset.label}</span>
                <span className="text-[9px] text-muted-foreground/50 leading-tight line-clamp-2">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom half: Options panel for selected preset */}
      <div className="border-t border-primary/10 px-4 py-3 min-h-[100px]">
        {selectedPreset ? (
          <div className="max-w-[640px] mx-auto space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`${COLOR_MAP[selectedPreset.color]?.text ?? 'text-primary'}`}>{selectedPreset.icon}</span>
                <span className="text-sm font-medium text-foreground/80">{selectedPreset.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSelectedPreset(null)}
                  className="px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground/80 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleOptionSend}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Run
                </button>
              </div>
            </div>
            {(selectedPreset.options ?? []).map((opt) => (
              <div key={opt.key} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground/60">{opt.label}</label>
                <input
                  type="text"
                  value={optionValues[opt.key] ?? ''}
                  onChange={(e) => setOptionValues((p) => ({ ...p, [opt.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOptionSend(); }}
                  placeholder={opt.placeholder}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-muted/30 text-foreground placeholder:text-muted-foreground/40 focus-ring"
                  autoFocus
                />
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/40 italic">{selectedPreset.prompt}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[11px] text-muted-foreground/40">Click a card above to configure and run, or type a command directly</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mode Toggle Button ──────────────────────────────────────────────────

function ModeButton({ mode, current, onClick, icon, label }: {
  mode: ChatMode; current: ChatMode; onClick: (m: ChatMode) => void; icon: React.ReactNode; label: string;
}) {
  const active = mode === current;
  return (
    <button
      onClick={() => onClick(mode)}
      className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        active ? 'bg-primary/15 text-primary shadow-sm' : 'text-muted-foreground/60 hover:text-muted-foreground/80'
      }`}
    >
      {icon} {label}
    </button>
  );
}

// ── Main Chat Tab ───────────────────────────────────────────────────────

export function ChatTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const messages = useAgentStore((s) => s.chatMessages);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const chatStreaming = useAgentStore((s) => s.chatStreaming);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const chatMode = useAgentStore((s) => s.chatMode);
  const setChatMode = useAgentStore((s) => s.setChatMode);
  const fetchSessions = useAgentStore((s) => s.fetchChatSessions);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);

  const [inputValue, setInputValue] = useState('');
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStreamingRef = useRef(false);

  const personaId = selectedPersona?.id ?? '';

  // Fetch sessions on mount
  useEffect(() => {
    if (personaId) fetchSessions(personaId);
  }, [personaId, fetchSessions]);

  // Auto-create a session if none active
  const handleNewSession = useCallback(async () => {
    if (personaId) await startNewSession(personaId);
    setStreamLines([]);
  }, [personaId, startNewSession]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamLines]);

  // Collect streaming output from execution while chatStreaming is active
  useEffect(() => {
    if (!chatStreaming || executionPersonaId !== personaId) return;
    setStreamLines(executionOutput);
  }, [chatStreaming, executionOutput, executionPersonaId, personaId]);

  // Clear local stream lines when chatStreaming ends.
  // The store's finishExecution/cancelExecution handle calling finishChatStream
  // so this works even if ChatTab was unmounted during the execution.
  useEffect(() => {
    if (prevStreamingRef.current && !chatStreaming) {
      setStreamLines([]);
    }
    prevStreamingRef.current = chatStreaming;
  }, [chatStreaming]);

  const handleSend = useCallback(async (directPrompt?: string) => {
    const text = (directPrompt ?? inputValue).trim();
    if (!text || chatStreaming || isExecuting) return;
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(personaId);
      if (!sessionId) return;
    }
    setInputValue('');
    setStreamLines([]);
    sendMessage(personaId, sessionId, text);
  }, [inputValue, chatStreaming, isExecuting, activeChatSessionId, personaId, startNewSession, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!selectedPersona) return null;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[400px] rounded-lg border border-primary/10 overflow-hidden bg-background">
      {/* Session sidebar */}
      <SessionSidebar personaId={personaId} onNewSession={handleNewSession} />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10">
          <div className="flex gap-0.5 p-0.5 bg-secondary/50 rounded-lg">
            <ModeButton mode="ops" current={chatMode} onClick={setChatMode} icon={<Wrench className="w-3 h-3" />} label="Ops" />
            <ModeButton mode="agent" current={chatMode} onClick={setChatMode} icon={<Bot className="w-3 h-3" />} label="Agent" />
          </div>
          <span className="text-[11px] text-muted-foreground/50">
            {chatMode === 'ops' ? 'Manage, test & improve this agent' : `Chat directly with ${selectedPersona.name}`}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !chatStreaming && (
            chatMode === 'ops'
              ? <OpsLaunchpad
                  personaName={selectedPersona.name}
                  onSelect={(prompt) => { setInputValue(prompt); inputRef.current?.focus(); }}
                  onSend={(prompt) => { void handleSend(prompt); }}
                />
              : <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-6 h-6 text-primary/60" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/80">Chat with {selectedPersona.name}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Send a message to start a conversation with this agent.</p>
                  </div>
                </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          {chatStreaming && <StreamingBubble lines={streamLines} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-primary/10 p-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={chatStreaming ? 'Waiting for response...' : chatMode === 'ops' ? 'Ask about health, run tests, edit prompts...' : 'Type a message...'}
              disabled={chatStreaming || isExecuting}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-primary/15 bg-muted/30 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-ring disabled:opacity-50 min-h-[40px] max-h-[120px]"
              style={{ height: 'auto', overflow: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!inputValue.trim() || chatStreaming || isExecuting}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {chatStreaming ? (
                <LoadingSpinner />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
