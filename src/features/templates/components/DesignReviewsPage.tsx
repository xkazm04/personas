import { useState, useMemo } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useDesignReviews } from '@/hooks/design/useDesignReviews';
import { usePersonaStore } from '@/stores/personaStore';
import DesignReviewRunner from '@/features/templates/sub_generated/DesignReviewRunner';
import GeneratedReviewsTab from '@/features/templates/sub_generated/GeneratedReviewsTab';
import BuiltinTemplatesTab from '@/features/templates/sub_builtin/BuiltinTemplatesTab';
import N8nImportTab from '@/features/templates/sub_n8n/N8nImportTab';
import { ErrorBoundary } from '@/features/shared/components/ErrorBoundary';
import ActivityDiagramModal from '@/features/triggers/components/ActivityDiagramModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';

// ============================================================================
// Sub-Components
// ============================================================================

function PassRateGauge({ percentage }: { percentage: number }) {
  const size = 48;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = (pct: number) => {
    if (pct < 40) return '#f87171';
    if (pct < 70) return '#fbbf24';
    return '#34d399';
  };

  const color = getColor(percentage);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-primary/10"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-sm font-semibold"
        style={{ color }}
      >
        {percentage}%
      </span>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function DesignReviewsPage() {
  const {
    reviews,
    error,
    runLines,
    isRunning,
    runResult,
    runProgress,
    refresh,
    startNewReview,
    cancelReview,
  } = useDesignReviews();

  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const activeTab = usePersonaStore((s) => s.templateTab);
  const [showRunner, setShowRunner] = useState(false);
  const [diagramReview, setDiagramReview] = useState<PersonaDesignReview | null>(null);

  const passRate = useMemo(() => {
    if (reviews.length === 0) return null;
    const passed = reviews.filter((r) => r.status === 'passed').length;
    return Math.round((passed / reviews.length) * 100);
  }, [reviews]);

  const handleStartReview = () => {
    setShowRunner(true);
  };

  const handleRunnerStart = (options?: { customInstructions?: string[]; testCases?: Array<{ id: string; name: string; instruction: string; tools?: string; trigger?: string; category?: string }> }) => {
    const testCases = options?.testCases
      ?? options?.customInstructions?.map((instruction, i) => ({
        id: `custom_${i}`,
        name: `Custom Case ${i + 1}`,
        instruction,
      }));
    startNewReview(selectedPersonaId ?? undefined, testCases);
  };

  const handleRunnerClose = () => {
    setShowRunner(false);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={passRate !== null ? (
          <PassRateGauge percentage={passRate} />
        ) : (
          <FlaskConical className="w-5 h-5 text-violet-400" />
        )}
        iconColor={passRate !== null ? undefined : 'violet'}
        title="Agentic Templates"
        subtitle={`${reviews.length} template${reviews.length !== 1 ? 's' : ''} available`}
        actions={
          <button
            onClick={handleStartReview}
            disabled={isRunning}
            className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            Generate Templates
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tab content */}
      <ContentBody noPadding>
        {activeTab === 'builtin' && <BuiltinTemplatesTab />}
        {activeTab === 'n8n' && (
          <ErrorBoundary name="n8n Import">
            <N8nImportTab />
          </ErrorBoundary>
        )}
        {activeTab === 'generated' && (
          <GeneratedReviewsTab
            isRunning={isRunning}
            handleStartReview={handleStartReview}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            onPersonaCreated={refresh}
            onViewFlows={setDiagramReview}
          />
        )}
      </ContentBody>

      {/* Runner modal */}
      <DesignReviewRunner
        isOpen={showRunner}
        onClose={handleRunnerClose}
        lines={runLines}
        isRunning={isRunning}
        result={runResult}
        runProgress={runProgress}
        onStart={handleRunnerStart}
        onCancel={cancelReview}
      />

      {/* Activity diagram modal */}
      {diagramReview && (
        <ActivityDiagramModal
          isOpen={!!diagramReview}
          onClose={() => setDiagramReview(null)}
          templateName={diagramReview.test_case_name}
          flows={parseJsonSafe<UseCaseFlow[]>(diagramReview.use_case_flows, [])}
        />
      )}
    </ContentBox>
  );
}
