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
import DesignReviewRunner from './DesignReviewRunner';
import GeneratedReviewsTab from './GeneratedReviewsTab';
import BuiltinTemplatesTab from './BuiltinTemplatesTab';
import N8nImportTab from './N8nImportTab';

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
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground/90">Agentic Templates</h1>
              <p className="text-xs text-muted-foreground/50">
                {reviews.length} template{reviews.length !== 1 ? 's' : ''} available
                {lastReviewDate && ` \u00B7 Last run: ${formatRelativeTime(lastReviewDate)}`}
                {passRate !== null && ` \u00B7 ${passRate}% pass rate`}
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
        onStart={handleRunnerStart}
        onCancel={cancelReview}
      />
    </div>
  );
}
