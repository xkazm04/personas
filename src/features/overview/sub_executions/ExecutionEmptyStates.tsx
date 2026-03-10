import { Loader2, Bot, Inbox } from 'lucide-react';

interface LoadingStateProps {
  type: 'loading';
}

interface NoAgentsStateProps {
  type: 'no-agents';
}

interface NoExecutionsStateProps {
  type: 'no-executions';
}

type EmptyStateProps = LoadingStateProps | NoAgentsStateProps | NoExecutionsStateProps;

export function ExecutionEmptyState(props: EmptyStateProps) {
  if (props.type === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-primary/70 animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground/90">Loading executions...</p>
        </div>
      </div>
    );
  }

  if (props.type === 'no-agents') {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
            <Bot className="w-5 h-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground/90">No agents created yet</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Create your first agent to see execution activity here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-6">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
          <Inbox className="w-5 h-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/90">No executions yet</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Run an agent to see execution activity here</p>
      </div>
    </div>
  );
}
