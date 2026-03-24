import { Plus, Trash2 } from 'lucide-react';
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
        {sessions.map((s) => {
          const isActive = activeSessionId === s.sessionId;
          const title = isActive && sessionContext?.title
            ? sessionContext.title
            : `${new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          return (
            <div
              key={s.sessionId}
              className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md cursor-pointer text-xs transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
              }`}
              onClick={() => fetchMessages(personaId, s.sessionId)}
              title={title}
            >
              <span className="flex-1 truncate">{title}</span>
              <span className="text-[10px] text-muted-foreground/50">{s.messageCount}</span>
              <button
                onClick={(e) => { e.stopPropagation(); clearSession(personaId, s.sessionId); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
