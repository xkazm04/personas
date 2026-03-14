import { useState, useCallback, useRef, useEffect } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useToastStore } from '@/stores/toastStore';
import { useDesignAnalysis } from '@/hooks/design/core/useDesignAnalysis';
import { deriveName, calcCompleteness } from './designUtils';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface UseChatCreatorStateOptions {
  onCreated?: (id: string) => void;
  onActivated?: () => void;
}

export function useChatCreatorState({ onCreated, onActivated }: UseChatCreatorStateOptions) {
  const createPersona = useAgentStore((s) => s.createPersona);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  const design = useDesignAnalysis();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [draftPersonaId, setDraftPersonaId] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const accumulatedIntentRef = useRef('');
  const MAX_INTENT_LENGTH = 4000;
  const isCreatingRef = useRef(false);

  const completeness = calcCompleteness(design.result);
  const isThinking = design.phase === 'analyzing' || design.phase === 'refining';

  // Auto-scroll thread on new messages or thinking state change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isThinking, design.result]);

  // Release synchronous create lock once draft persona exists.
  useEffect(() => {
    if (draftPersonaId) {
      isCreatingRef.current = false;
    }
  }, [draftPersonaId]);

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
    if (isCreatingRef.current) return;
    const text = input.trim();
    if (!text || isThinking) return;

    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    setInput('');
    accumulatedIntentRef.current += (accumulatedIntentRef.current ? '\n' : '') + text;
    if (accumulatedIntentRef.current.length > MAX_INTENT_LENGTH) {
      accumulatedIntentRef.current = accumulatedIntentRef.current.slice(-MAX_INTENT_LENGTH);
    }

    if (design.phase === 'awaiting-input' && design.question) {
      design.answerQuestion(text);
      return;
    }

    if (!draftPersonaId) {
      isCreatingRef.current = true;
      try {
        const persona = await createPersona({
          name: deriveName(text),
          description: text.slice(0, 200),
          system_prompt: 'You are a helpful AI assistant.',
        });
        setDraftPersonaId(persona.id);
        onCreated?.(persona.id);

        // Move to Draft group (consistent with Build/Matrix flows)
        try {
          const { groups, createGroup, movePersonaToGroup } = usePipelineStore.getState();
          let draftGroup = groups.find((g) => g.name === 'Draft');
          if (!draftGroup) {
            draftGroup = await createGroup({ name: 'Draft', color: '#6B7280', description: 'Agents being designed' }) ?? undefined;
          }
          if (draftGroup) {
            await movePersonaToGroup(persona.id, draftGroup.id);
          }
        } catch {
          // intentional: non-critical -- best-effort group assignment
        }

        await design.startIntentCompilation(persona.id, text);
      } catch (err) {
        isCreatingRef.current = false;
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Failed to start: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: Date.now(),
        }]);
      }
    } else {
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
      onActivated?.();
    } catch (err) {
      console.error('Failed to activate agent:', err);
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to activate agent: ${msg}`, 'error');
      setIsActivating(false);
    }
  }, [draftPersonaId, design, isActivating, selectPersona, setSidebarSection, setEditorTab, onActivated]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return {
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
  };
}
