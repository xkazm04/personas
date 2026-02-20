import React, { useState, useMemo, useEffect } from 'react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import {
  FlaskConical,
  Play,
  RefreshCw,
  Trash2,
  Blocks,
  Upload,
  List,
} from 'lucide-react';
import { useDesignReviews } from '@/hooks/useDesignReviews';
import { usePersonaStore } from '@/stores/personaStore';
import DesignReviewRunner from '@/features/templates/sub_generated/DesignReviewRunner';
import GeneratedReviewsTab from '@/features/templates/sub_generated/GeneratedReviewsTab';
import BuiltinTemplatesTab from '@/features/templates/sub_builtin/BuiltinTemplatesTab';
import N8nImportTab from '@/features/templates/sub_n8n/N8nImportTab';

function PassRateGauge({ percentage }: { percentage: number }) {
  const size = 48;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color transitions: red (0%) → amber (50%) → green (100%)
  const getColor = (pct: number) => {
    if (pct < 40) return '#f87171';   // red-400
    if (pct < 70) return '#fbbf24';   // amber-400
    return '#34d399';                  // emerald-400
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
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
        style={{ color }}
      >
        {percentage}%
      </span>
    </div>
  );
}

function ReviewTimeline({ reviews }: { reviews: Array<{ status: string; reviewed_at: string }> }) {
  // Take last 10 reviews sorted by reviewed_at descending, then reverse for left-to-right chronological
  const recent = useMemo(() => {
    const sorted = [...reviews].sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at));
    return sorted.slice(0, 10).reverse();
  }, [reviews]);

  if (recent.length === 0) return null;

  const dotColor = (status: string) => {
    if (status === 'passed') return 'bg-emerald-400';
    if (status === 'failed' || status === 'errored') return 'bg-red-400';
    return 'bg-muted-foreground/30'; // in-progress or unknown
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground/40 mr-1">Recent:</span>
      {recent.map((r, i) => (
        <span
          key={i}
          title={`${r.status} — ${formatRelativeTime(r.reviewed_at)}`}
          className={`w-2.5 h-2.5 rounded-full ${dotColor(r.status)} transition-colors`}
        />
      ))}
    </div>
  );
}

type TemplateTab = 'builtin' | 'n8n' | 'generated';

const TABS: Array<{ id: TemplateTab; label: string; icon: typeof Blocks }> = [
  { id: 'builtin', label: 'Built-in Templates', icon: Blocks },
  { id: 'n8n', label: 'n8n Import', icon: Upload },
  { id: 'generated', label: 'Generated', icon: List },
];

export default function DesignReviewsPage() {
  const {
    reviews,
    isLoading,
    error,
    runLines,
    isRunning,
    runResult,
    runProgress,
    refresh,
    startNewReview,
    cancelReview,
    deleteReview,
  } = useDesignReviews();

  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);

  const [activeTab, setActiveTab] = useState<TemplateTab>('builtin');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showRunner, setShowRunner] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; reviewId: string } | null>(null);

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const passRate = useMemo(() => {
    if (reviews.length === 0) return null;
    const passed = reviews.filter((r) => r.status === 'passed').length;
    return Math.round((passed / reviews.length) * 100);
  }, [reviews]);

  const lastReviewDate = useMemo(() => {
    if (reviews.length === 0) return null;
    const dates = reviews.map((r) => r.reviewed_at).sort();
    return dates[dates.length - 1];
  }, [reviews]);

  const handleStartReview = () => {
    setShowRunner(true);
  };

  const handleRunnerStart = (options?: { customInstructions?: string[] }) => {
    const testCases = options?.customInstructions?.map((instruction, i) => ({
      id: `custom_${i}`,
      name: `Custom Case ${i + 1}`,
      instruction,
    }));
    startNewReview(selectedPersonaId ?? undefined, testCases);
  };

  const handleRunnerClose = () => {
    setShowRunner(false);
  };

  const handleContextMenu = (e: React.MouseEvent, reviewId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, reviewId });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-primary/10 bg-primary/5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {passRate !== null ? (
              <PassRateGauge percentage={passRate} />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <FlaskConical className="w-5 h-5 text-violet-400" />
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold text-foreground/90">Agentic Templates</h1>
              <p className="text-xs text-muted-foreground/50">
                {reviews.length} template{reviews.length !== 1 ? 's' : ''} available
                {lastReviewDate && ` \u00B7 Last run: ${formatRelativeTime(lastReviewDate)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="px-3 py-2 text-xs rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleStartReview}
              disabled={isRunning}
              className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              Generate Templates
            </button>
          </div>
        </div>
        {reviews.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            <ReviewTimeline reviews={reviews} />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="px-6 pt-3 pb-0 flex-shrink-0 border-b border-primary/10">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-t-xl border border-b-0 transition-colors ${
                  isActive
                    ? 'bg-primary/10 border-primary/15 text-foreground/85'
                    : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/30'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'builtin' && <BuiltinTemplatesTab />}
        {activeTab === 'n8n' && <N8nImportTab />}
        {activeTab === 'generated' && (
          <GeneratedReviewsTab
            reviews={reviews}
            isLoading={isLoading}
            isRunning={isRunning}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            selectedPersonaId={selectedPersonaId}
            startNewReview={startNewReview}
            onContextMenu={handleContextMenu}
            onDelete={async (id) => {
              try {
                await deleteReview(id);
              } catch (err) {
                console.error('Failed to delete template:', err);
              }
            }}
            handleStartReview={handleStartReview}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] py-1 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 60),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              const id = contextMenu.reviewId;
              setContextMenu(null);
              try {
                await deleteReview(id);
              } catch (err) {
                console.error('Failed to delete template:', err);
              }
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete template
          </button>
        </div>
      )}

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
    </div>
  );
}
