/**
 * TestReportModal — split-pane test result viewer extracted from MatrixCommandCenterParts.
 * Shows per-tool scope on the left, LLM-generated analysis on the right.
 */
import { useState, useRef } from 'react';
import {
  X, CheckCircle2, XCircle, AlertTriangle, FileText,
  Zap, Clock, Shield, Key, Copy, Check,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { ToolTestResult } from '@/lib/types/buildTypes';
import { useAgentStore } from '@/stores/agentStore';

// ---------------------------------------------------------------------------
// TestReportModal
// ---------------------------------------------------------------------------

export function TestReportModal({ results, summary, onClose }: { results: ToolTestResult[]; summary?: string | null; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, true, onClose);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const testConnectors = useAgentStore((s) => s.buildTestConnectors);

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed' || r.status === 'credential_missing').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const allPassed = failedCount === 0 && passedCount > 0;

  const sections = summary ? parseReportSections(summary) : null;
  const selectedResult = selectedTool ? results.find((r) => r.tool_name === selectedTool) : null;

  return (
    // z-[10001] so the report overlays BaseModal portals (which use z-[10000])
    // when opened from inside the Adoption Wizard — without this bump the
    // report renders DOM-later but visually-below the wizard frame.
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="flex flex-col rounded-2xl border border-primary/15 bg-background shadow-elevation-4 shadow-black/30 overflow-hidden"
        style={{ width: '70vw', height: '80vh', maxWidth: '1200px', maxHeight: '900px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/[0.03]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-modal flex items-center justify-center border ${
              allPassed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              {allPassed ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground/90">Test Report</h2>
              <div className="flex items-center gap-3 mt-1">
                {passedCount > 0 && <span className="inline-flex items-center gap-1 text-xs text-emerald-400/90 font-medium"><CheckCircle2 className="w-3 h-3" />{passedCount} passed</span>}
                {failedCount > 0 && <span className="inline-flex items-center gap-1 text-xs text-red-400/90 font-medium"><XCircle className="w-3 h-3" />{failedCount} failed</span>}
                {skippedCount > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/50"><AlertTriangle className="w-3 h-3" />{skippedCount} skipped</span>}
              </div>
              {results.length > 0 && (
                <div className="flex gap-0.5 mt-2 h-1.5 w-48 rounded-full overflow-hidden bg-secondary/30">
                  {passedCount > 0 && <div className="bg-emerald-400/70 rounded-full" style={{ flex: passedCount }} />}
                  {failedCount > 0 && <div className="bg-red-400/70 rounded-full" style={{ flex: failedCount }} />}
                  {skippedCount > 0 && <div className="bg-muted-foreground/20 rounded-full" style={{ flex: skippedCount }} />}
                </div>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-card hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground/60" />
          </button>
        </div>

        {/* Split content */}
        <div className="flex-1 min-h-0 flex">
          {/* Left pane: Test Scope */}
          <div className="w-[280px] flex-shrink-0 border-r border-primary/10 flex flex-col min-h-0">
            <div className="px-4 py-2.5 border-b border-primary/5 bg-secondary/10">
              <h3 className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">Test Scope</h3>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => setSelectedTool(null)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                  selectedTool === null ? 'bg-primary/8 border-r-2 border-primary' : 'hover:bg-secondary/30'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
                <span className="text-[13px] font-medium text-foreground/80">Overview</span>
              </button>
              {results.map((r) => (
                <ToolTab key={r.tool_name} result={r} isActive={selectedTool === r.tool_name} onClick={() => setSelectedTool(r.tool_name)} />
              ))}
            </div>
          </div>

          {/* Right pane: Analysis */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-5 py-2.5 border-b border-primary/5 bg-secondary/10">
              <h3 className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wider">
                {selectedTool ? selectedTool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Analysis'}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {selectedTool && selectedResult ? (
                <ToolDetailView result={selectedResult} sections={sections} />
              ) : (
                <ReportOverview sections={sections} summary={summary} results={results} connectors={testConnectors} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolTab — single tool entry in the left sidebar
// ---------------------------------------------------------------------------

function ToolTab({ result: r, isActive, onClick }: { result: ToolTestResult; isActive: boolean; onClick: () => void }) {
  const statusIcon = r.status === 'passed'
    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
    : r.status === 'skipped'
    ? <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground/35 flex-shrink-0" />
    : r.status === 'credential_missing'
    ? <Key className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
    : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
  const label = r.tool_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const latencyLabel = r.latency_ms != null && r.latency_ms > 0
    ? r.latency_ms < 500 ? 'Fast' : r.latency_ms < 2000 ? 'OK' : 'Slow'
    : null;
  const latencyColor = r.latency_ms != null
    ? r.latency_ms < 500 ? 'text-emerald-400/50' : r.latency_ms < 2000 ? 'text-amber-400/50' : 'text-red-400/50'
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
        isActive ? 'bg-primary/8 border-r-2 border-primary' : 'hover:bg-secondary/30'
      }`}
    >
      {statusIcon}
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] truncate block ${isActive ? 'font-medium text-foreground/90' : 'text-foreground/60'}`}>{label}</span>
        {r.connector && <span className="text-[10px] text-muted-foreground/40 truncate block">{r.connector}</span>}
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        {r.http_status && (
          <span className={`text-[10px] font-mono ${r.http_status >= 200 && r.http_status < 300 ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
            {r.http_status}
          </span>
        )}
        {latencyLabel && <span className={`text-[9px] ${latencyColor}`}>{latencyLabel}</span>}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Report parsing
// ---------------------------------------------------------------------------

function parseReportSections(md: string): { overview: string; results: string; nextSteps: string } {
  const sections = { overview: '', results: '', nextSteps: '' };
  let currentSection: 'overview' | 'results' | 'nextSteps' | null = null;

  for (const line of md.split('\n')) {
    const trimmed = line.trim();
    if (/^###?\s+overview/i.test(trimmed)) { currentSection = 'overview'; continue; }
    if (/^###?\s+results/i.test(trimmed)) { currentSection = 'results'; continue; }
    if (/^###?\s+next\s*steps/i.test(trimmed)) { currentSection = 'nextSteps'; continue; }
    if (/^###?\s+/.test(trimmed)) { currentSection = null; continue; }
    if (currentSection) sections[currentSection] += line + '\n';
  }

  if (!sections.overview && !sections.results && !sections.nextSteps) sections.overview = md;
  return sections;
}

// ---------------------------------------------------------------------------
// ConnectorHandshakeCard
// ---------------------------------------------------------------------------

function ConnectorHandshakeCard({ connectors }: { connectors: Array<{ name: string; has_credential: boolean }> }) {
  if (connectors.length === 0) return null;
  const matched = connectors.filter((c) => c.has_credential);
  const missing = connectors.filter((c) => !c.has_credential);
  return (
    <div className="rounded-modal border border-primary/10 bg-primary/[0.02] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Key className="w-4 h-4 text-primary/50" />
        <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Connector Credentials</h4>
      </div>
      <div className="space-y-1.5">
        {matched.map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-foreground/70">{c.name}</span>
            <span className="text-emerald-400/60 text-xs">matched</span>
          </div>
        ))}
        {missing.map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-sm">
            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="text-foreground/70">{c.name}</span>
            <span className="text-red-400/60 text-xs">not found</span>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="text-[11px] text-amber-400/60 mt-2">Add missing API keys in the Keys section before approving this agent.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportOverview
// ---------------------------------------------------------------------------

function ReportOverview({ sections, summary, results, connectors = [] }: { sections: ReturnType<typeof parseReportSections> | null; summary?: string | null; results: ToolTestResult[]; connectors?: Array<{ name: string; has_credential: boolean }> }) {
  if (!sections && !summary) {
    const passed = results.filter((r) => r.status === 'passed');
    const failed = results.filter((r) => r.status === 'failed');
    const credentialMissing = results.filter((r) => r.status === 'credential_missing');
    const skipped = results.filter((r) => r.status === 'skipped');
    return (
      <div className="space-y-5">
        <ConnectorHandshakeCard connectors={connectors} />
        <p className="text-sm text-foreground/70 leading-relaxed">
          {failed.length === 0 && credentialMissing.length === 0 && passed.length > 0
            ? `Your agent successfully connected to ${passed.length === 1 ? 'its service' : `all ${passed.length} services`}.${skipped.length > 0 ? ` ${skipped.length} tool${skipped.length > 1 ? 's use' : ' uses'} built-in capabilities and didn't need testing.` : ''}`
            : (failed.length > 0 || credentialMissing.length > 0)
            ? `${failed.length + credentialMissing.length} connection${(failed.length + credentialMissing.length) > 1 ? 's' : ''} need attention.${passed.length > 0 ? ` ${passed.length} verified OK.` : ''}${skipped.length > 0 ? ` ${skipped.length} skipped.` : ''}`
            : `${skipped.length} tool${skipped.length > 1 ? 's use' : ' uses'} built-in capabilities and didn't need external testing.`}
        </p>
        <ResultCards passed={passed} failed={failed} credentialMissing={credentialMissing} skipped={skipped} />
      </div>
    );
  }

  if (!sections) {
    return (
      <div className="space-y-5">
        <ConnectorHandshakeCard connectors={connectors} />
        <div className="space-y-1.5">{summary!.split('\n').filter(Boolean).map((line, i) => <MarkdownLine key={i} text={line} />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConnectorHandshakeCard connectors={connectors} />
      {sections.overview && (
        <SectionBlock icon={<Shield className="w-4 h-4 text-primary/50" />} label="Overview">
          {sections.overview.trim().split('\n').filter(Boolean).map((line, i) => <MarkdownLine key={i} text={line} />)}
        </SectionBlock>
      )}
      {sections.results && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-foreground/40" />
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Results</h4>
          </div>
          <div className="space-y-1.5">{sections.results.trim().split('\n').filter(Boolean).map((line, i) => <MarkdownLine key={i} text={line} />)}</div>
        </div>
      )}
      {sections.nextSteps && (
        <SectionBlock icon={<Clock className="w-4 h-4 text-primary/50" />} label="Next Steps">
          {sections.nextSteps.trim().split('\n').filter(Boolean).map((line, i) => <MarkdownLine key={i} text={line} />)}
        </SectionBlock>
      )}
    </div>
  );
}

function SectionBlock({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-modal border border-primary/10 bg-primary/[0.02] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">{label}</h4>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ResultCards({ passed, failed, credentialMissing, skipped }: { passed: ToolTestResult[]; failed: ToolTestResult[]; credentialMissing: ToolTestResult[]; skipped: ToolTestResult[] }) {
  const toolLabel = (r: ToolTestResult) => r.tool_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="space-y-3">
      {passed.length > 0 && (
        <div className="rounded-modal border border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /><h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Connected Successfully</h4></div>
          <div className="space-y-1">{passed.map((r) => (
            <div key={r.tool_name} className="flex items-center justify-between text-sm">
              <span className="text-foreground/70">{toolLabel(r)}{r.connector ? <span className="text-muted-foreground/40 ml-1.5">via {r.connector}</span> : null}</span>
              {r.latency_ms != null && r.latency_ms > 0 && <span className="text-[10px] text-muted-foreground/40 font-mono">{r.latency_ms}ms</span>}
            </div>
          ))}</div>
        </div>
      )}
      {credentialMissing.length > 0 && (
        <div className="rounded-modal border border-amber-500/15 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><Key className="w-4 h-4 text-amber-400" /><h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Needs Credentials</h4></div>
          <div className="space-y-1">{credentialMissing.map((r) => <div key={r.tool_name} className="text-sm text-foreground/70">{toolLabel(r)}{r.connector ? <span className="text-muted-foreground/40 ml-1.5">({r.connector})</span> : null}</div>)}</div>
          <p className="text-[11px] text-amber-400/60 mt-2">Add the required API keys in the Keys section to enable these tools.</p>
        </div>
      )}
      {failed.length > 0 && (
        <div className="rounded-modal border border-red-500/15 bg-red-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><XCircle className="w-4 h-4 text-red-400" /><h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider">Connection Failed</h4></div>
          <div className="space-y-1">{failed.map((r) => {
            const hint = r.http_status ? httpStatusHint(r.http_status) : null;
            return <div key={r.tool_name} className="text-sm"><span className="text-foreground/70">{toolLabel(r)}</span>{hint && <span className="text-red-400/50 ml-1.5 text-xs">{hint}</span>}</div>;
          })}</div>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="rounded-modal border border-primary/10 bg-secondary/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-muted-foreground/40" /><h4 className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">Built-in (No Test Needed)</h4></div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">{skipped.map((r) => <span key={r.tool_name} className="text-sm text-muted-foreground/50">{toolLabel(r)}</span>)}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarkdownLine — inline markdown renderer
// ---------------------------------------------------------------------------

function MarkdownLine({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^####\s+/.test(trimmed)) return <h5 className="text-xs font-semibold text-primary/70 uppercase tracking-wider mt-3 mb-1">{trimmed.replace(/^####\s+/, '')}</h5>;
  if (/^###\s+/.test(trimmed)) return <h4 className="text-sm font-semibold text-primary/80 mt-3 mb-1">{trimmed.replace(/^###\s+/, '')}</h4>;
  if (/^##\s+/.test(trimmed)) return <h3 className="text-base font-bold text-foreground/90 mt-4 mb-1.5">{trimmed.replace(/^##\s+/, '')}</h3>;
  if (/^---+$/.test(trimmed)) return <hr className="border-primary/10 my-3" />;

  const isBullet = /^[-*]\s/.test(trimmed);
  const numberedMatch = trimmed.match(/^(\d+)[.)]\s/);
  const isNumbered = !!numberedMatch;
  const content = isBullet ? trimmed.slice(2) : isNumbered ? trimmed.slice(numberedMatch![0].length) : trimmed;

  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="text-foreground/90 font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="px-1 py-0.5 rounded bg-primary/8 text-primary/80 font-mono text-[11px]">{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) return <span key={i} className="text-primary/70 underline underline-offset-2">{linkMatch[1]}</span>;
    return <span key={i}>{part}</span>;
  });

  return (
    <div className="flex gap-2 text-sm text-foreground/60 leading-relaxed">
      {isBullet && <span className="text-primary/40 mt-0.5 flex-shrink-0">&bull;</span>}
      {isNumbered && <span className="text-primary/40 mt-0.5 flex-shrink-0 font-medium text-xs min-w-[1rem] text-right">{numberedMatch![1]}.</span>}
      <span>{parts}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolDetailView
// ---------------------------------------------------------------------------

function ToolDetailView({ result, sections }: { result: ToolTestResult; sections: ReturnType<typeof parseReportSections> | null }) {
  const isPassed = result.status === 'passed';
  const isSkipped = result.status === 'skipped';
  const toolLabel = result.tool_name.replace(/_/g, ' ');

  const toolSummaryLine = sections?.results.split('\n').find((line) => line.toLowerCase().includes(toolLabel.toLowerCase())) ?? null;
  const fallbackDescription = isPassed
    ? result.output_preview || 'Connection verified successfully.'
    : isSkipped
    ? result.error || 'This tool uses built-in capabilities and does not require an external API connection to test.'
    : result.status === 'credential_missing'
    ? `This tool needs credentials for ${result.connector || 'its service'}. Go to the **Keys** section to add or refresh the required credentials.`
    : result.error ? formatErrorForUser(result.error, result.http_status) : 'Could not connect to the service.';

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-modal border ${
        isPassed ? 'bg-emerald-500/5 border-emerald-500/15' : isSkipped ? 'bg-secondary/30 border-primary/10' : result.status === 'credential_missing' ? 'bg-amber-500/5 border-amber-500/15' : 'bg-red-500/5 border-red-500/15'
      }`}>
        {isPassed ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> : isSkipped ? <Zap className="w-5 h-5 text-muted-foreground/40 flex-shrink-0" /> : result.status === 'credential_missing' ? <Key className="w-5 h-5 text-amber-400 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}
        <div className="flex-1">
          <span className={`text-sm font-semibold ${isPassed ? 'text-emerald-400' : isSkipped ? 'text-muted-foreground/60' : result.status === 'credential_missing' ? 'text-amber-400' : 'text-red-400'}`}>
            {isPassed ? 'Passed' : isSkipped ? 'Skipped (Built-in)' : result.status === 'credential_missing' ? 'Needs Credential' : 'Failed'}
          </span>
          {result.http_status && (
            <span className={`text-[10px] font-mono ml-2 px-1.5 py-0.5 rounded ${result.http_status >= 200 && result.http_status < 300 ? 'bg-emerald-500/10 text-emerald-400/70' : 'bg-red-500/10 text-red-400/70'}`}>
              HTTP {result.http_status}
            </span>
          )}
        </div>
        {result.latency_ms != null && result.latency_ms > 0 && (
          <div className="flex items-center gap-1 text-muted-foreground/40"><Clock className="w-3 h-3" /><span className="text-xs font-mono">{result.latency_ms}ms</span></div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">What happened</h4>
        {toolSummaryLine ? <MarkdownLine text={toolSummaryLine} /> : (
          <div className="text-sm text-foreground/60 leading-relaxed space-y-1">{fallbackDescription.split('\n').map((line, i) => <MarkdownLine key={i} text={line} />)}</div>
        )}
      </div>

      {result.connector && <div><h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-1">Service</h4><p className="text-sm text-foreground/60">{result.connector}</p></div>}

      {result.output_preview && isPassed && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Response Preview</h4>
            <InlineCopyButton text={result.output_preview} />
          </div>
          <div className="rounded-card bg-black/20 border border-primary/10 px-3 py-2.5 font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto">
            <FormattedPreview text={result.output_preview} />
          </div>
        </div>
      )}

      {!isPassed && !isSkipped && result.error && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider">Error Detail</h4>
            <InlineCopyButton text={result.error} />
          </div>
          <div className="rounded-card bg-red-500/5 border border-red-500/10 px-3 py-2.5 font-mono text-[11px] text-red-400/70 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
            {result.error}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility components
// ---------------------------------------------------------------------------

function InlineCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return (
    <button type="button" onClick={handleCopy} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-secondary/30 transition-colors">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function FormattedPreview({ text }: { text: string }) {
  const truncated = text.slice(0, 5000);
  try {
    const parsed = JSON.parse(truncated);
    const formatted = JSON.stringify(parsed, null, 2);
    return (
      <pre className="whitespace-pre-wrap">
        {formatted.split('\n').map((line, i) => {
          const keyMatch = line.match(/^(\s*)"([^"]+)":/);
          if (keyMatch) {
            return <div key={i}><span className="text-muted-foreground/30">{keyMatch[1]}</span><span className="text-primary/70">&quot;{keyMatch[2]}&quot;</span><span className="text-muted-foreground/40">:</span><span className="text-emerald-400/60">{line.slice(keyMatch[0].length)}</span></div>;
          }
          return <div key={i} className="text-muted-foreground/50">{line}</div>;
        })}
      </pre>
    );
  } catch {
    return <span className="text-muted-foreground/50 whitespace-pre-wrap">{truncated}</span>;
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function httpStatusHint(status: number): string | null {
  if (status === 401 || status === 403) return 'Authentication issue';
  if (status === 404) return 'Endpoint not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500) return 'Service error';
  return null;
}

function formatErrorForUser(error: string, httpStatus?: number): string {
  if (httpStatus === 401 || httpStatus === 403) return 'Authentication failed. Your credentials may have expired. Go to **Keys** to refresh them.';
  if (httpStatus === 404) return 'The API endpoint could not be found. The service configuration may need updating.';
  if (httpStatus === 429) return 'The service rate-limited the request. This is temporary — try again in a few minutes.';
  if (httpStatus && httpStatus >= 500) return 'The service is currently experiencing issues. This is not a problem with your agent — try again later.';
  if (error.includes('timed out')) return 'The connection timed out. The service may be slow or unavailable right now.';
  if (error.includes('credential') || error.includes('Credential')) return 'Missing credentials. Go to **Keys** to add the required service credentials.';
  if (error.length > 200) return error.slice(0, 200) + '...';
  return error;
}
