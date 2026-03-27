import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Zap, Trash2 } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import type { PersonaAutomation, AutomationDeploymentStatus } from '@/lib/bindings/PersonaAutomation';
import { AutomationCard } from './AutomationCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { TOOLS_BTN_COMPACT, TOOLS_INNER_SPACE } from '@/lib/utils/designTokens';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';
import { BaseModal } from '@/lib/ui/BaseModal';
import { BlastRadiusPanel, useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
import { getAutomationBlastRadius } from '@/api/agents/automations';

interface AutomationsSectionProps {
  automations: PersonaAutomation[];
  onAdd: () => void;
  onEdit: (id: string) => void;
}

export function AutomationsSection({ automations, onAdd, onEdit }: AutomationsSectionProps) {
  const [expanded, setExpanded] = useState(automations.length > 0);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const testAutomation = useVaultStore((s) => s.testAutomation);
  const updateAutomation = useVaultStore((s) => s.updateAutomation);
  const deleteAutomation = useVaultStore((s) => s.deleteAutomation);

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const run = await testAutomation(id);
      if (run) {
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            success: run.status === 'completed',
            message: run.status === 'completed'
              ? `Webhook responded in ${run.durationMs ?? 0}ms`
              : run.errorMessage ?? 'Webhook call failed',
          },
        }));
      }
    } finally {
      setTestingId(null);
    }
  };

  const [transitioningIds, setTransitioningIds] = useState<Set<string>>(new Set());

  const handleToggleStatus = async (id: string, newStatus: 'active' | 'paused') => {
    setTransitioningIds((prev) => new Set(prev).add(id));
    try {
      await updateAutomation(id, { deploymentStatus: newStatus as AutomationDeploymentStatus });
    } finally {
      setTransitioningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<PersonaAutomation | null>(null);
  const { items: blastItems, loading: blastLoading } = useBlastRadius(
    () => getAutomationBlastRadius(deleteTarget!.id),
    !!deleteTarget,
  );

  const handleDelete = (id: string) => {
    const target = automations.find((a) => a.id === id) ?? null;
    setDeleteTarget(target);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      void deleteAutomation(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const preview = automations.length > 0
    ? automations.slice(0, 3).map((a) => a.name).join(', ') +
      (automations.length > 3 ? ` +${automations.length - 3}` : '')
    : null;

  const activeCount = automations.filter((a) => a.deploymentStatus === 'active').length;

  const sectionLabel = automations.length === 0
    ? 'Automations'
    : `${automations.length} automation${automations.length !== 1 ? 's' : ''}`;

  return (
    <div>
      <div className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <SectionHeader
          icon={
            <span className="flex items-center gap-1.5">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Zap className="w-3.5 h-3.5 text-accent/60" />
            </span>
          }
          label={sectionLabel}
          badge={
            <>
              {activeCount > 0 && (
                <span className="text-sm font-normal text-brand-emerald/70">
                  {activeCount} active
                </span>
              )}
              {!expanded && preview && (
                <span className="text-sm font-normal text-muted-foreground/50 truncate max-w-48">
                  {preview}
                </span>
              )}
            </>
          }
          trailing={
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className={`flex items-center gap-1 ${TOOLS_BTN_COMPACT} text-sm font-medium rounded-lg border border-accent/20 text-foreground/80 bg-accent/10 hover:bg-accent/20 transition-colors`}
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          }
        />
      </div>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className={`${TOOLS_INNER_SPACE} pt-2`}>
              {automations.length > 0 ? (
                <AnimatedList
                  className="space-y-2"
                  keys={automations.map((a) => a.id)}
                >
                  {automations.map((auto) => (
                    <AutomationCard
                      key={auto.id}
                      automation={auto}
                      onTest={handleTest}
                      onEdit={onEdit}
                      onToggleStatus={handleToggleStatus}
                      onDelete={handleDelete}
                      isTesting={testingId === auto.id}
                      isTransitioning={transitioningIds.has(auto.id)}
                      testResult={testResults[auto.id] ?? null}
                    />
                  ))}
                </AnimatedList>
              ) : null}

              {automations.length === 0 && (
                <button
                  onClick={onAdd}
                  className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-accent/30 hover:text-foreground/80 transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  <span>Add automation from n8n, Zapier, or GitHub Actions</span>
                </button>
              )}
            </div>
          </div>
        )}

      <BaseModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        titleId="delete-automation-dialog"
        maxWidthClass="max-w-sm"
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
      >
        {deleteTarget && (
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 id="delete-automation-dialog" className="text-sm font-semibold text-foreground/90">Delete Automation</h3>
                <p className="text-sm text-muted-foreground/90 mt-1">
                  Permanently delete <span className="font-medium">{deleteTarget.name}</span>.
                </p>
              </div>
            </div>

            <BlastRadiusPanel items={blastItems} loading={blastLoading} />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-muted-foreground/80 hover:text-foreground/95 rounded-xl hover:bg-secondary/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </BaseModal>
    </div>
  );
}
