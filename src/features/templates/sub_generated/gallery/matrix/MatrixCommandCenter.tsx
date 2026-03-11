/**
 * MatrixCommandCenter — 9th cell centerpiece for PersonaMatrix.
 *
 * Edit mode: prompt input + capability toggles + radial launch orb.
 * View mode: expandable prompt section chips.
 */
import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, FileText, Play, X, User, Wrench, BookOpen, Shield, ChevronUp, ChevronDown, Globe, Search, Loader2 } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import type { AgentIR } from '@/lib/types/designTypes';

interface PromptSection { key: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; content: string; }

function PromptModal({ section, onClose }: { section: PromptSection; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);
  const Icon = section.icon;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5"><Icon className={`w-4.5 h-4.5 ${section.color}`} /><h3 className="text-base font-semibold text-foreground/90">{section.label}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-foreground/[0.04] transition-colors"><X className="w-4 h-4 text-muted-foreground/60" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans leading-relaxed">{section.content}</pre></div>
      </div>
    </div>,
    document.body,
  );
}

function MiniTerminalStrip({ isRunning, lastLine, lines }: { isRunning: boolean; lastLine: string; lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className="rounded-lg border border-primary/10 bg-card-bg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-foreground/[0.04] transition-colors" onClick={() => setExpanded(!expanded)}>
        {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
        <Terminal className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className="flex-1 font-mono text-sm text-muted-foreground/50 truncate">{lastLine || 'Ready'}</span>
        {lines.length > 0 && (expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/30 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/30 shrink-0" />)}
      </div>
      {expanded && lines.length > 0 && (
        <div ref={scrollRef} className="max-h-28 overflow-y-auto px-3 pb-2 font-mono text-sm leading-4 space-y-px border-t border-primary/5">
          {lines.map((line, i) => (<div key={i} className={`whitespace-pre-wrap break-words ${TERMINAL_STYLE_MAP[classifyLine(line)]}`}>{line}</div>))}
          {isRunning && <div className="text-primary/40 animate-pulse">{'>'} _</div>}
        </div>
      )}
    </div>
  );
}

function CapabilityToggle({ icon: Icon, label, active, onToggle }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={[
      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
      active
        ? 'border-primary/30 bg-primary/15 text-primary'
        : 'border-primary/10 bg-transparent text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-primary/20',
    ].join(' ')}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
  );
}

/** Radial launch orb — the visual centerpiece of the matrix. */
function LaunchOrb({ onClick, disabled, isRunning, label }: { onClick?: () => void; disabled: boolean; isRunning: boolean; label: string }) {
  const blocked = disabled && !isRunning;
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isRunning}
        className="group relative w-16 h-16 rounded-full flex items-center justify-center disabled:cursor-not-allowed transition-all duration-300"
      >
        {/* Outer glow ring — amber when blocked, primary when ready */}
        <span className={`absolute inset-0 rounded-full border-2 transition-colors ${
          blocked
            ? 'border-amber-500/25 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
            : 'border-primary/25 group-hover:border-primary/50 group-disabled:border-primary/10 shadow-[0_0_16px_var(--glass-bg)]'
        }`} />
        {/* Pulsing halo when running */}
        {isRunning && <span className="absolute inset-[-4px] rounded-full border border-primary/20 animate-ping" />}
        {/* Inner fill */}
        <span className={`absolute inset-[3px] rounded-full transition-colors ${
          blocked
            ? 'bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-orange-500/10'
            : 'bg-gradient-to-br from-primary/20 via-primary/10 to-accent/15 group-hover:from-primary/30 group-hover:via-primary/15 group-hover:to-accent/25'
        }`} />
        {/* Icon */}
        {isRunning
          ? <Loader2 className="w-6 h-6 text-primary animate-spin relative z-10" />
          : <Play className={`w-6 h-6 relative z-10 transition-colors ${
              blocked ? 'text-amber-500/50' : 'text-primary/80 group-hover:text-primary'
            }`} />}
      </button>
      <span className={`text-[11px] font-medium tracking-wide uppercase ${
        blocked ? 'text-amber-500/60' : 'text-muted-foreground/50'
      }`}>
        {isRunning ? 'Building...' : label}
      </span>
    </div>
  );
}

interface MatrixCommandCenterProps {
  designResult: AgentIR | null;
  isEditMode: boolean;
  isRunning?: boolean;
  lastLine?: string;
  cliLines?: string[];
  onLaunch?: () => void;
  launchDisabled?: boolean;
  launchLabel?: string;
}

export function MatrixCommandCenter({ designResult, isEditMode, isRunning = false, lastLine = '', cliLines = [], onLaunch, launchDisabled = false, launchLabel = 'Build Persona' }: MatrixCommandCenterProps) {
  const [openSection, setOpenSection] = useState<PromptSection | null>(null);
  const [promptText, setPromptText] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webBrowseEnabled, setWebBrowseEnabled] = useState(false);

  const sections = useMemo<PromptSection[]>(() => {
    if (!designResult?.structured_prompt) return [];
    const sp = designResult.structured_prompt;
    const r: PromptSection[] = [];
    if (sp.identity) r.push({ key: 'identity', label: 'Identity', icon: User, color: 'text-primary', content: sp.identity });
    if (sp.instructions) r.push({ key: 'instructions', label: 'Instructions', icon: FileText, color: 'text-accent', content: sp.instructions });
    if (sp.toolGuidance) r.push({ key: 'tools', label: 'Tool Guidance', icon: Wrench, color: 'text-brand-amber', content: sp.toolGuidance });
    if (sp.examples) r.push({ key: 'examples', label: 'Examples', icon: BookOpen, color: 'text-brand-emerald', content: sp.examples });
    if (sp.errorHandling) r.push({ key: 'errors', label: 'Error Handling', icon: Shield, color: 'text-brand-rose', content: sp.errorHandling });
    return r;
  }, [designResult]);

  if (isEditMode) {
    return (
      <div className="flex flex-col gap-3 w-full h-full items-center">
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="Additional instructions..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 resize-none focus:outline-none focus:border-primary/30 transition-colors"
        />

        <div className="flex items-center gap-2 flex-wrap justify-center">
          <CapabilityToggle icon={Search} label="Web Search" active={webSearchEnabled} onToggle={() => setWebSearchEnabled(!webSearchEnabled)} />
          <CapabilityToggle icon={Globe} label="Web Browse" active={webBrowseEnabled} onToggle={() => setWebBrowseEnabled(!webBrowseEnabled)} />
        </div>

        <div className="flex-1 flex items-center justify-center">
          {onLaunch && (
            <LaunchOrb onClick={onLaunch} disabled={launchDisabled} isRunning={isRunning} label={launchLabel} />
          )}
        </div>

        {(isRunning || cliLines.length > 0) && (
          <div className="w-full">
            <MiniTerminalStrip isRunning={isRunning} lastLine={lastLine} lines={cliLines} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full">
      <div className="flex flex-wrap gap-1.5">
        {sections.map((section) => { const Icon = section.icon; return (
          <button key={section.key} type="button" onClick={() => setOpenSection(section)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/10 bg-primary/5 hover:bg-primary/10 hover:border-primary/20 transition-colors cursor-pointer px-2 py-1">
            <Icon className={`w-3 h-3 ${section.color} flex-shrink-0`} />
            <span className="text-[13px] text-foreground/70 truncate">{section.label}</span>
          </button>
        ); })}
      </div>
      {sections.length > 0 && <p className="text-sm text-muted-foreground/50 leading-relaxed line-clamp-3">{sections[0]!.content.slice(0, 120)}...</p>}
      {openSection && <PromptModal section={openSection} onClose={() => setOpenSection(null)} />}
    </div>
  );
}
