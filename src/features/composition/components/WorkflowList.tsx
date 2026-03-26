import { useState, useEffect } from 'react';
import { Plus, GitBranch, Trash2, ToggleLeft, ToggleRight, Sparkles, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { usePipelineStore } from '@/stores/pipelineStore';

export default function WorkflowList() {
  const workflows = usePipelineStore((s) => s.workflows);
  const fetchWorkflows = usePipelineStore((s) => s.fetchWorkflows);
  const createWorkflow = usePipelineStore((s) => s.createWorkflow);
  const deleteWorkflow = usePipelineStore((s) => s.deleteWorkflow);
  const updateWorkflow = usePipelineStore((s) => s.updateWorkflow);
  const selectWorkflow = usePipelineStore((s) => s.selectWorkflow);
  const compileWorkflow = usePipelineStore((s) => s.compileWorkflow);
  const isCompiling = usePipelineStore((s) => s.isCompiling);
  const error = usePipelineStore((s) => s.error);

  const [newName, setNewName] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDescription, setComposeDescription] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleCreate = () => {
    const name = newName.trim() || 'Untitled Workflow';
    createWorkflow(name);
    setNewName('');
  };

  const handleCompose = () => {
    if (!composeDescription.trim() || isCompiling) return;
    compileWorkflow(composeDescription.trim());
    setComposeDescription('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-foreground mb-1">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Compose personas into multi-step DAG workflows where each persona's output feeds into the next.
        </p>
      </div>

      {/* Natural Language Composer */}
      <div className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
        <button
          onClick={() => setComposeOpen(!composeOpen)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-violet-300 hover:bg-violet-500/10 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Describe a workflow in plain English
          {composeOpen ? <ChevronDown className="w-4 h-4 ml-auto" /> : <ChevronRight className="w-4 h-4 ml-auto" />}
        </button>

        {composeOpen && (
          <div className="px-4 pb-4">
            <textarea
              value={composeDescription}
              onChange={(e) => setComposeDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCompose();
              }}
              placeholder="e.g. When a PR is opened, have a security reviewer check for vulnerabilities, a code quality reviewer check style, and a technical writer draft changelog entries, then aggregate results and post a summary comment…"
              rows={4}
              disabled={isCompiling}
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-violet-500/40 transition-colors resize-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-muted-foreground/50">
                {isCompiling ? 'Composing pipeline topology…' : 'Ctrl+Enter to compose'}
              </span>
              <button
                onClick={handleCompose}
                disabled={!composeDescription.trim() || isCompiling}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCompiling ? (
                  <LoadingSpinner />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isCompiling ? 'Composing…' : 'Compose'}
              </button>
            </div>
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </div>
        )}
      </div>

      {/* Create (manual) */}
      <div className="flex items-center gap-2 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="New workflow name…"
          className="flex-1 px-3 py-2 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/30 transition-colors"
        />
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create
        </button>
      </div>

      {/* List */}
      {workflows.length === 0 ? (
        <div className="text-center py-16">
          <GitBranch className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No workflows yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Create your first workflow to orchestrate multiple personas.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/40 transition-colors cursor-pointer group"
              onClick={() => selectWorkflow(wf.id)}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-indigo-500/15 border border-indigo-500/25">
                <GitBranch className="w-4 h-4 text-indigo-400" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{wf.name}</div>
                <div className="text-xs text-muted-foreground/70">
                  {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''} · {wf.edges.length} edge{wf.edges.length !== 1 ? 's' : ''}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateWorkflow(wf.id, { enabled: !wf.enabled });
                }}
                className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
                title={wf.enabled ? 'Disable' : 'Enable'}
              >
                {wf.enabled ? (
                  <ToggleRight className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-muted-foreground/50" />
                )}
              </button>

              {pendingDeleteId === wf.id ? (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-amber-400/70 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                    Delete?
                  </span>
                  <button
                    onClick={() => {
                      deleteWorkflow(wf.id);
                      setPendingDeleteId(null);
                    }}
                    className="px-2 py-1 bg-red-500 hover:bg-red-600 text-foreground rounded-lg text-xs font-medium transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    className="px-2 py-1 bg-secondary/50 text-foreground/80 rounded-lg text-xs transition-colors hover:bg-secondary/70"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteId(wf.id);
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-500/15 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete workflow"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
