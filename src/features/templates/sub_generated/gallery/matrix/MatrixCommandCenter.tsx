/**
 * MatrixCommandCenter — 9th cell centerpiece for PersonaMatrix.
 *
 * Edit mode: prompt input + web search/browse toggles + Build Persona action.
 * View mode: expandable prompt sections + stats summary.
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"><X className="w-4 h-4 text-muted-foreground/60" /></button>
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
    <div className="rounded-lg border border-primary/10 dark:bg-black/30 bg-white/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] transition-colors" onClick={() => setExpanded(!expanded)}>
        {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
        <Terminal className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className="flex-1 font-mono text-sm text-muted-foreground/50 truncate">{lastLine || 'Ready'}</span>
        {lines.length > 0 && (expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/30 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/30 shrink-0" />)}
      </div>
      {expanded && lines.length > 0 && (
        <div ref={scrollRef} className="max-h-28 overflow-y-auto px-3 pb-2 font-mono text-sm leading-4 space-y-px border-t border-primary/5">
          {lines.map((line, i) => (<div key={i} className={`whitespace-pre-wrap break-words ${TERMINAL_STYLE_MAP[classifyLine(line)]}`}>{line}</div>))}
          {isRunning && <div className="text-blue-400/40 animate-pulse">{'>'} _</div>}
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
        ? 'border-violet-500/30 bg-violet-500/15 text-violet-400 dark:text-violet-300'
        : 'border-primary/10 bg-transparent text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-primary/20',
    ].join(' ')}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
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
    if (sp.identity) r.push({ key: 'identity', label: 'Identity', icon: User, color: 'text-violet-400', content: sp.identity });
    if (sp.instructions) r.push({ key: 'instructions', label: 'Instructions', icon: FileText, color: 'text-cyan-400', content: sp.instructions });
    if (sp.toolGuidance) r.push({ key: 'tools', label: 'Tool Guidance', icon: Wrench, color: 'text-amber-400', content: sp.toolGuidance });
    if (sp.examples) r.push({ key: 'examples', label: 'Examples', icon: BookOpen, color: 'text-emerald-400', content: sp.examples });
    if (sp.errorHandling) r.push({ key: 'errors', label: 'Error Handling', icon: Shield, color: 'text-orange-400', content: sp.errorHandling });
    return r;
  }, [designResult]);

  const stats = useMemo(() => {
    if (!designResult) return null;
    return { tools: designResult.suggested_tools?.length ?? 0, connectors: designResult.suggested_connectors?.length ?? 0, triggers: designResult.suggested_triggers?.length ?? 0 };
  }, [designResult]);

  if (isEditMode) {
    return (
      <div className="flex flex-col gap-3 w-full h-full">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-violet-400/70" />
          <span className="text-[13px] font-semibold text-foreground/70">Command Hub</span>
        </div>

        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="Additional instructions for this persona..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 dark:bg-black/30 bg-white/50 text-sm text-foreground/80 placeholder-muted-foreground/30 resize-none focus:outline-none focus:border-violet-500/30 transition-colors"
        />

        <div className="flex items-center gap-2 flex-wrap">
          <CapabilityToggle icon={Search} label="Web Search" active={webSearchEnabled} onToggle={() => setWebSearchEnabled(!webSearchEnabled)} />
          <CapabilityToggle icon={Globe} label="Web Browse" active={webBrowseEnabled} onToggle={() => setWebBrowseEnabled(!webBrowseEnabled)} />
        </div>

        {stats && (
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground/50">
            <span>{stats.tools} tools</span>
            <span className="w-0.5 h-0.5 rounded-full bg-current opacity-40" />
            <span>{stats.connectors} connectors</span>
            <span className="w-0.5 h-0.5 rounded-full bg-current opacity-40" />
            <span>{stats.triggers} triggers</span>
          </div>
        )}

        <div className="mt-auto space-y-2">
          {(isRunning || cliLines.length > 0) && <MiniTerminalStrip isRunning={isRunning} lastLine={lastLine} lines={cliLines} />}
          {onLaunch && (
            <button type="button" onClick={onLaunch} disabled={launchDisabled || isRunning}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-400 dark:text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'Building...' : launchLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-violet-400/70" />
        <span className="text-[13px] font-semibold text-foreground/70">Command Hub</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sections.map((section) => { const Icon = section.icon; return (
          <button key={section.key} type="button" onClick={() => setOpenSection(section)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/10 bg-primary/5 hover:bg-primary/10 hover:border-primary/20 transition-colors cursor-pointer px-2 py-1">
            <Icon className={`w-3 h-3 ${section.color} flex-shrink-0`} />
            <span className="text-[13px] text-foreground/70 truncate">{section.label}</span>
          </button>
        ); })}
      </div>
      {stats && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
          <span>{stats.tools} tools</span><span className="w-0.5 h-0.5 rounded-full bg-current opacity-40" />
          <span>{stats.connectors} connectors</span><span className="w-0.5 h-0.5 rounded-full bg-current opacity-40" />
          <span>{stats.triggers} triggers</span>
        </div>
      )}
      {sections.length > 0 && <p className="text-sm text-muted-foreground/50 leading-relaxed line-clamp-3">{sections[0]!.content.slice(0, 120)}...</p>}
      {openSection && <PromptModal section={openSection} onClose={() => setOpenSection(null)} />}
    </div>
  );
}
