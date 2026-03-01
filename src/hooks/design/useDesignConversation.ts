import { useState, useCallback, useRef, useEffect } from 'react';
import {
  listDesignConversations,
  getActiveDesignConversation,
  createDesignConversation,
  appendDesignConversationMessage,
  updateDesignConversationStatus,
  deleteDesignConversation,
} from '@/api/design';
import type {
  DesignConversation,
  DesignConversationMessage,
  DesignAnalysisResult,
  DesignQuestion,
} from '@/lib/types/designTypes';
import { parseConversationMessages } from '@/lib/types/designTypes';

/**
 * Manages persistent design conversations alongside the design analysis flow.
 * Each analysis/refinement round appends messages to the active conversation.
 * Conversations are persisted in the DB so users can resume across app restarts.
 */
export function useDesignConversation(personaId: string | null) {
  const [conversations, setConversations] = useState<DesignConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<DesignConversation | null>(null);
  const activeConvRef = useRef<DesignConversation | null>(null);

  // Promise chain serializes all message appends to prevent read-modify-write
  // races (e.g., AI question arriving while user answer is being written).
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Keep ref in sync
  useEffect(() => {
    activeConvRef.current = activeConversation;
  }, [activeConversation]);

  // Load conversations when persona changes
  const loadConversations = useCallback(async () => {
    if (!personaId) {
      setConversations([]);
      setActiveConversation(null);
      return;
    }
    try {
      const [list, active] = await Promise.all([
        listDesignConversations(personaId),
        getActiveDesignConversation(personaId),
      ]);
      setConversations(list);
      setActiveConversation(active);
    } catch {
      // Non-critical — conversation persistence is best-effort
    }
  }, [personaId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  /** Create a new conversation when the user starts a design analysis. */
  const startConversation = useCallback(async (instruction: string) => {
    if (!personaId) return null;

    // Auto-generate title from instruction
    const title = instruction.length > 60
      ? instruction.slice(0, 57) + '...'
      : instruction;

    const initialMessages: DesignConversationMessage[] = [
      {
        role: 'user',
        content: instruction,
        messageType: 'instruction',
        timestamp: new Date().toISOString(),
      },
    ];

    try {
      const conv = await createDesignConversation(
        personaId,
        title,
        JSON.stringify(initialMessages),
      );
      setActiveConversation(conv);
      setConversations((prev) => [conv, ...prev]);
      return conv;
    } catch {
      return null;
    }
  }, [personaId]);

  /**
   * Serialize a message append through the queue. Reads the LATEST conversation
   * state at write time (not at call time) to prevent read-modify-write races.
   */
  const enqueueAppend = useCallback((
    buildMessage: (conv: DesignConversation) => {
      message: DesignConversationMessage;
      lastResult?: string;
    },
  ): void => {
    const doAppend = async () => {
      const conv = activeConvRef.current;
      if (!conv) return;

      const { message, lastResult } = buildMessage(conv);
      const messages = parseConversationMessages(conv.messages);
      messages.push(message);

      try {
        const updated = await appendDesignConversationMessage(
          conv.id,
          JSON.stringify(messages),
          lastResult ?? null,
        );
        setActiveConversation(updated);
        setConversations((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c))
        );
      } catch {
        // Best-effort
      }
    };
    appendQueueRef.current = appendQueueRef.current.then(doAppend, doAppend);
  }, []);

  /** Append a user message (feedback/answer) to the active conversation. */
  const addUserMessage = useCallback((content: string, messageType: 'feedback' | 'answer') => {
    enqueueAppend(() => ({
      message: {
        role: 'user',
        content,
        messageType,
        timestamp: new Date().toISOString(),
      },
    }));
  }, [enqueueAppend]);

  /** Record an AI question in the conversation. */
  const addQuestionMessage = useCallback((question: DesignQuestion) => {
    enqueueAppend(() => {
      const questionText = question.options
        ? `${question.question}\n\nOptions: ${question.options.join(', ')}`
        : question.question;
      return {
        message: {
          role: 'assistant' as const,
          content: questionText,
          messageType: 'question' as const,
          timestamp: new Date().toISOString(),
        },
      };
    });
  }, [enqueueAppend]);

  /** Record an AI result in the conversation. */
  const addResultMessage = useCallback((result: DesignAnalysisResult) => {
    enqueueAppend(() => ({
      message: {
        role: 'assistant',
        content: result.summary || 'Design generated',
        messageType: 'result',
        timestamp: new Date().toISOString(),
      },
      lastResult: JSON.stringify(result),
    }));
  }, [enqueueAppend]);

  /** Record an error in the conversation. */
  const addErrorMessage = useCallback((errorText: string) => {
    enqueueAppend(() => ({
      message: {
        role: 'assistant',
        content: errorText,
        messageType: 'error',
        timestamp: new Date().toISOString(),
      },
    }));
  }, [enqueueAppend]);

  /** Mark the active conversation as completed (after applying design). */
  const completeConversation = useCallback(async () => {
    const conv = activeConvRef.current;
    if (!conv) return;

    try {
      await updateDesignConversationStatus(conv.id, 'completed');
      const updated = { ...conv, status: 'completed' as const };
      setActiveConversation(null);
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch {
      // Best-effort
    }
  }, []);

  /** Resume a previous conversation. */
  const resumeConversation = useCallback(async (conversation: DesignConversation) => {
    // Mark existing active conversation as abandoned if different
    const current = activeConvRef.current;
    if (current && current.id !== conversation.id) {
      try {
        await updateDesignConversationStatus(current.id, 'abandoned');
      } catch {
        // Best-effort
      }
    }

    // Re-activate the target conversation
    try {
      await updateDesignConversationStatus(conversation.id, 'active');
      const updated = { ...conversation, status: 'active' as const };
      setActiveConversation(updated);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === updated.id) return updated;
          if (c.id === current?.id) return { ...c, status: 'abandoned' as const };
          return c;
        })
      );
      return updated;
    } catch {
      return null;
    }
  }, []);

  /** Delete a conversation. */
  const removeConversation = useCallback(async (id: string) => {
    try {
      await deleteDesignConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvRef.current?.id === id) {
        setActiveConversation(null);
      }
    } catch {
      // Best-effort
    }
  }, []);

  /** Clear the active conversation (for new session). */
  const clearActive = useCallback(() => {
    setActiveConversation(null);
  }, []);

  return {
    conversations,
    activeConversation,
    activeConversationId: activeConversation?.id ?? null,
    startConversation,
    addUserMessage,
    addQuestionMessage,
    addResultMessage,
    addErrorMessage,
    completeConversation,
    resumeConversation,
    removeConversation,
    clearActive,
    loadConversations,
  };
}
