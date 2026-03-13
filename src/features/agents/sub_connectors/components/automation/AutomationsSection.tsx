import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVaultStore } from "@/stores/vaultStore";
import type { PersonaAutomation, AutomationDeploymentStatus } from '@/lib/bindings/PersonaAutomation';
import { AutomationCard } from './AutomationCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { TOOLS_BTN_COMPACT, TOOLS_INNER_SPACE } from '@/lib/utils/designTokens';

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

  const handleToggleStatus = (id: string, newStatus: 'active' | 'paused') => {
    void updateAutomation(id, { deploymentStatus: newStatus as AutomationDeploymentStatus });
  };

  const handleDelete = (id: string) => {
    void deleteAutomation(id);
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

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className={`${TOOLS_INNER_SPACE} pt-2`}>
              {automations.map((auto) => (
                <AutomationCard
                  key={auto.id}
                  automation={auto}
                  onTest={handleTest}
                  onEdit={onEdit}
                  onToggleStatus={handleToggleStatus}
                  onDelete={handleDelete}
                  isTesting={testingId === auto.id}
                  testResult={testResults[auto.id] ?? null}
                />
              ))}

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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
