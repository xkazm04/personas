import { useState } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';

// ── Session List Sidebar ────────────────────────────────────────────────

export function SessionSidebar({
  personaId,
  onNewSession,
}: {
  personaId: string;
  onNewSession: () => void;
}) {
  const sessions = useAgentStore((s) => s.chatSessions);
  const activeSessionId = useAgentStore((s) => s.activeChatSessionId);
  const sessionContext = useAgentStore((s) => s.chatSessionContext);
  const fetchMessages = useAgentStore((s) => s.fetchChatMessages);
  const clearSession = useAgentStore((s) => s.clearChatSession);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="w-[28rem] border-r border-primary/[0.08] flex flex-col h-full bg-secondary/[0.02]" data-testid="chat-sidebar">
      {/* New Chat button */}
      <div className="p-3 border-b border-primary/[0.06]">
        <button
          onClick={onNewSession}
          data-testid="chat-new-session-btn"
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          <Plus className="w-4 h-4" /> New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin" data-testid="chat-session-list">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
            <MessageSquare className="w-5 h-5 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">No conversations yet</p>
          </div>
        )}
        {sessions.map((s) => {
          const isActive = activeSessionId === s.sessionId;
          const title = isActive && sessionContext?.title
            ? sessionContext.title
            : `${new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          return (
            <div
              key={s.sessionId}
              data-testid={`chat-session-${s.sessionId}`}
              className={`group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                isActive
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground/70 hover:bg-primary/5 hover:text-foreground/80'
              }`}
              onClick={() => fetchMessages(personaId, s.sessionId)}
              title={title}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
              <span className="flex-1 truncate">{title}</span>
              {s.messageCount > 0 && (
                <span className="text-[11px] text-muted-foreground/40 flex-shrink-0">{s.messageCount}</span>
              )}
              {confirmDeleteId === s.sessionId ? (
                <button
                  data-testid={`chat-session-confirm-delete-${s.sessionId}`}
                  onClick={(e) => { e.stopPropagation(); clearSession(personaId, s.sessionId); setConfirmDeleteId(null); }}
                  onBlur={() => setConfirmDeleteId(null)}
                  className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-all flex-shrink-0"
                  aria-label="Confirm delete conversation"
                  autoFocus
                >
                  Delete?
                </button>
              ) : (
                <button
                  data-testid={`chat-session-delete-${s.sessionId}`}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.sessionId); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
