import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FlaskConical,
  Play,
  Trash2,
  Filter,
  ChevronDown,
  CheckCircle2,
  X,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useDesignReviews } from '@/hooks/design/useDesignReviews';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import DesignReviewRunner from '@/features/templates/sub_generated/DesignReviewRunner';
import GeneratedReviewsTab from '@/features/templates/sub_generated/GeneratedReviewsTab';
import BuiltinTemplatesTab from '@/features/templates/sub_builtin/BuiltinTemplatesTab';
import N8nImportTab from '@/features/templates/sub_n8n/N8nImportTab';
import { ErrorBoundary } from '@/features/shared/components/ErrorBoundary';
import ActivityDiagramModal from '@/features/triggers/components/ActivityDiagramModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

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
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
        style={{ color }}
      >
        {percentage}%
      </span>
    </div>
  );
}

function ConnectorDropdown({
  availableConnectors,
  connectorFilter,
  setConnectorFilter,
}: {
  availableConnectors: string[];
  connectorFilter: string[];
  setConnectorFilter: (connectors: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleConnector = (name: string) => {
    if (connectorFilter.includes(name)) {
      setConnectorFilter(connectorFilter.filter((c) => c !== name));
    } else {
      setConnectorFilter([...connectorFilter, name]);
    }
  };

  const sorted = useMemo(() => {
    return [...availableConnectors].sort((a, b) => {
      const la = getConnectorMeta(a).label;
      const lb = getConnectorMeta(b).label;
      return la.localeCompare(lb);
    });
  }, [availableConnectors]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-xs rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors flex items-center gap-1.5"
      >
        <Filter className="w-3.5 h-3.5" />
        Filter by connector
        {connectorFilter.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-medium">
            {connectorFilter.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl min-w-[220px] py-1.5 overflow-hidden">
          {sorted.map((name) => {
            const meta = getConnectorMeta(name);
            const isSelected = connectorFilter.includes(name);
            return (
              <button
                key={name}
                onClick={() => toggleConnector(name)}
                className="flex items-center gap-2.5 w-full px-3.5 py-2 text-left hover:bg-primary/5 transition-colors"
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${meta.color}20` }}
                >
                  <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                </div>
                <span className="text-sm text-foreground/70 flex-1">{meta.label}</span>
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-violet-500/30 border-violet-500/50'
                      : 'border-primary/20'
                  }`}
                >
                  {isSelected && <CheckCircle2 className="w-3 h-3 text-violet-300" />}
                </div>
              </button>
            );
          })}
          {connectorFilter.length > 0 && (
            <div className="border-t border-primary/10 mt-1 pt-1">
              <button
                onClick={() => {
                  setConnectorFilter([]);
                  setIsOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-xs text-muted-foreground/50 hover:text-foreground/60 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
          {sorted.length === 0 && (
            <div className="px-3.5 py-2 text-xs text-muted-foreground/30 italic">
              No connectors available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function DesignReviewsPage() {
  const {
    reviews,
    isLoading,
    error,
    runLines,
    isRunning,
    runResult,
    runProgress,
    connectorFilter,
    setConnectorFilter,
    availableConnectors,
    startNewReview,
    cancelReview,
    deleteReview,
  } = useDesignReviews();

  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const activeTab = usePersonaStore((s) => s.templateTab);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showRunner, setShowRunner] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; reviewId: string } | null>(null);
  const [diagramReview, setDiagramReview] = useState<PersonaDesignReview | null>(null);

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

  const handleStartReview = () => {
    setShowRunner(true);
  };

  const handleRunnerStart = (options?: { customInstructions?: string[]; testCases?: Array<{ id: string; name: string; instruction: string }> }) => {
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

  const handleContextMenu = (e: React.MouseEvent, reviewId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, reviewId });
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

      {/* Connector filter bar (visible on generated tab) */}
      {activeTab === 'generated' && availableConnectors.length > 0 && (
        <div className="px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0">
          <ConnectorDropdown
            availableConnectors={availableConnectors}
            connectorFilter={connectorFilter}
            setConnectorFilter={setConnectorFilter}
          />
          {connectorFilter.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2">
              {connectorFilter.map((name) => {
                const meta = getConnectorMeta(name);
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300"
                  >
                    <ConnectorIcon meta={meta} size="w-3 h-3" />
                    {meta.label}
                    <button
                      onClick={() => setConnectorFilter(connectorFilter.filter((c) => c !== name))}
                      className="ml-0.5 hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

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
            reviews={reviews}
            isLoading={isLoading}
            isRunning={isRunning}
            expandedRow={expandedRow}
            setExpandedRow={setExpandedRow}
            selectedPersonaId={selectedPersonaId}
            startNewReview={startNewReview}
            connectorFilter={connectorFilter}
            onContextMenu={handleContextMenu}
            onDelete={async (id) => {
              try {
                await deleteReview(id);
              } catch (err) {
                console.error('Failed to delete template:', err);
              }
            }}
            onViewFlows={setDiagramReview}
            handleStartReview={handleStartReview}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
          />
        )}
      </ContentBody>

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
