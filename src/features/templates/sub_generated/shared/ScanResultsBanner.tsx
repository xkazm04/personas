/**
 * ScanResultsBanner — displays persona safety scan results in the adoption
 * wizard's CreateStep. Shows findings grouped by severity with expandable
 * detail views for each finding.
 */
import { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Info,
  Loader2,
} from 'lucide-react';
import type { ScanResult, ScanFinding } from '@/lib/templates/personaSafetyScanner';
import { SEVERITY_CONFIG, CATEGORY_LABELS } from '@/lib/templates/personaSafetyScanner';

// ── Props ────────────────────────────────────────────────────────────

interface ScanResultsBannerProps {
  result: ScanResult | null;
  scanning: boolean;
  className?: string;
}

// ── Finding row ──────────────────────────────────────────────────────

function FindingRow({ finding }: { finding: ScanFinding }) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[finding.severity];

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${config.dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${config.text}`}>{finding.title}</span>
            <span className="text-sm px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/50 uppercase tracking-wider">
              {CATEGORY_LABELS[finding.category]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground/60 mt-0.5 leading-relaxed">
            {finding.description}
          </p>
        </div>
        <ChevronRight
          className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 mt-1 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded && finding.context && (
        <div className="px-3 pb-2.5 pt-0">
          <div className="ml-4 pl-3 border-l-2 border-white/5">
            <p className="text-sm uppercase tracking-wider text-muted-foreground/60 mb-1">
              Source: <span className="text-muted-foreground/60">{finding.source}</span>
            </p>
            <pre className="text-sm text-muted-foreground/70 whitespace-pre-wrap font-mono bg-black/20 rounded-xl px-2.5 py-2 leading-relaxed">
              {finding.context}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Severity section ─────────────────────────────────────────────────

function SeveritySection({
  label,
  icon,
  findings,
  defaultOpen,
}: {
  label: string;
  icon: React.ReactNode;
  findings: ScanFinding[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (findings.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors mb-1.5 w-full"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {icon}
        <span className="font-medium uppercase tracking-wider">{label}</span>
        <span className="text-muted-foreground/60 ml-auto">{findings.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 ml-1">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function ScanResultsBanner({ result, scanning, className = '' }: ScanResultsBannerProps) {
  // Scanning in progress
  if (scanning) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-500/15 bg-blue-500/5 ${className}`}>
        <Loader2 className="w-4 h-4 text-blue-400/60 animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm text-blue-300/80 font-medium">Scanning persona draft...</p>
          <p className="text-sm text-blue-300/50">Checking for malicious instructions and unsafe patterns</p>
        </div>
      </div>
    );
  }

  // No result yet
  if (!result) return null;

  // All clear
  if (result.passed && result.info.length === 0) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 ${className}`}>
        <ShieldCheck className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
        <div>
          <p className="text-sm text-emerald-300/80 font-medium">Safety scan passed</p>
          <p className="text-sm text-emerald-300/50">No security concerns detected in this persona draft</p>
        </div>
      </div>
    );
  }

  // Passed with info only
  if (result.passed && result.info.length > 0) {
    return (
      <div className={`rounded-xl border border-emerald-500/15 bg-emerald-500/5 ${className}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <ShieldCheck className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-emerald-300/80 font-medium">Safety scan passed</p>
            <p className="text-sm text-emerald-300/50">
              {result.info.length} informational note{result.info.length !== 1 ? 's' : ''} for review
            </p>
          </div>
        </div>
        <div className="px-4 pb-3">
          <SeveritySection
            label="Informational"
            icon={<Info className="w-3 h-3 text-blue-400/50" />}
            findings={result.info}
            defaultOpen={false}
          />
        </div>
      </div>
    );
  }

  // Findings detected
  const hasCritical = result.critical.length > 0;
  const Icon = hasCritical ? ShieldX : ShieldAlert;
  const borderColor = hasCritical ? 'border-red-500/20' : 'border-amber-500/20';
  const bgColor = hasCritical ? 'bg-red-500/5' : 'bg-amber-500/5';
  const iconColor = hasCritical ? 'text-red-400' : 'text-amber-400';
  const titleColor = hasCritical ? 'text-red-300/80' : 'text-amber-300/80';
  const subtitleColor = hasCritical ? 'text-red-300/50' : 'text-amber-300/50';

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} ${className}`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon className={`w-4.5 h-4.5 ${iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${titleColor}`}>
            {hasCritical ? 'Critical security issues detected' : 'Security warnings detected'}
          </p>
          <p className={`text-sm ${subtitleColor} mt-0.5`}>
            {result.critical.length > 0 && `${result.critical.length} critical`}
            {result.critical.length > 0 && result.warnings.length > 0 && ', '}
            {result.warnings.length > 0 && `${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`}
            {result.info.length > 0 && `, ${result.info.length} info`}
            {' — review findings before creating this persona'}
          </p>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.critical.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-medium rounded bg-red-500/15 text-red-400 border border-red-500/20">
              {result.critical.length} critical
            </span>
          )}
          {result.warnings.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-medium rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
              {result.warnings.length} warn
            </span>
          )}
        </div>
      </div>

      {/* Findings */}
      <div className="px-4 pb-3 space-y-3">
        <SeveritySection
          label="Critical"
          icon={<ShieldX className="w-3 h-3 text-red-400/50" />}
          findings={result.critical}
          defaultOpen={true}
        />
        <SeveritySection
          label="Warnings"
          icon={<AlertTriangle className="w-3 h-3 text-amber-400/50" />}
          findings={result.warnings}
          defaultOpen={result.critical.length === 0}
        />
        <SeveritySection
          label="Informational"
          icon={<Info className="w-3 h-3 text-blue-400/50" />}
          findings={result.info}
          defaultOpen={false}
        />
      </div>
    </div>
  );
}
