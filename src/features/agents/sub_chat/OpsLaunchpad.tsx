import { useState } from 'react';
import { Send, Heart, Play, FlaskConical, Shield, Brain, Pencil, Wand2, ListChecks, History, Zap } from 'lucide-react';
import type { ChatMode } from '@/stores/slices/agents/chatSlice';

// ── Ops Preset Cards ────────────────────────────────────────────────────

interface OpsPreset {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: string;
  color: string;
  options?: { key: string; label: string; placeholder: string; defaultValue?: string }[];
}

const OPS_PRESETS: OpsPreset[] = [
  {
    id: 'health', icon: <Heart className="w-4 h-4" />, label: 'Health Check',
    description: 'Run diagnostics and find config issues',
    prompt: 'Run a health check on this agent and report any issues with suggested fixes.',
    color: 'emerald',
  },
  {
    id: 'execute', icon: <Play className="w-4 h-4" />, label: 'Execute',
    description: 'Run the agent with optional input',
    prompt: 'Execute this agent now.',
    color: 'blue',
    options: [{ key: 'input', label: 'Input (optional)', placeholder: 'Custom input data for this execution...' }],
  },
  {
    id: 'arena', icon: <FlaskConical className="w-4 h-4" />, label: 'Arena Test',
    description: 'Compare models head-to-head',
    prompt: 'Start an arena test comparing haiku and sonnet models on this agent.',
    color: 'violet',
    options: [{ key: 'models', label: 'Models', placeholder: 'haiku, sonnet', defaultValue: 'haiku, sonnet' }],
  },
  {
    id: 'improve', icon: <Wand2 className="w-4 h-4" />, label: 'Improve Prompt',
    description: 'AI-driven prompt refinement',
    prompt: 'Start a matrix improvement to make the prompt more specific and actionable.',
    color: 'amber',
    options: [{ key: 'instruction', label: 'Improvement focus', placeholder: 'e.g., Add error handling, improve output format...' }],
  },
  {
    id: 'assertions', icon: <Shield className="w-4 h-4" />, label: 'Assertions',
    description: 'Manage output validation rules',
    prompt: 'List all assertions for this agent and show their pass rates.',
    color: 'rose',
  },
  {
    id: 'history', icon: <History className="w-4 h-4" />, label: 'Executions',
    description: 'Review recent execution history',
    prompt: 'Show the last 5 executions with status, duration, and cost.',
    color: 'sky',
  },
  {
    id: 'knowledge', icon: <Brain className="w-4 h-4" />, label: 'Knowledge',
    description: 'View memories and learned patterns',
    prompt: 'Show this agent\'s memories and knowledge annotations.',
    color: 'purple',
  },
  {
    id: 'edit', icon: <Pencil className="w-4 h-4" />, label: 'Edit Prompt',
    description: 'Modify prompt sections directly',
    prompt: 'Show me the current prompt sections and suggest improvements.',
    color: 'orange',
    options: [{ key: 'section', label: 'Section', placeholder: 'instructions, identity, toolGuidance, examples, errorHandling', defaultValue: 'instructions' }],
  },
  {
    id: 'versions', icon: <ListChecks className="w-4 h-4" />, label: 'Versions',
    description: 'Prompt version history and rollback',
    prompt: 'List prompt versions and show which is tagged as production.',
    color: 'teal',
  },
  {
    id: 'diagnose', icon: <Zap className="w-4 h-4" />, label: 'Diagnose',
    description: 'Deep analysis of agent performance',
    prompt: 'Analyze this agent\'s recent performance. Check health, review last executions, and identify areas for improvement.',
    color: 'cyan',
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; hover: string }> = {
  emerald: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
  blue:    { bg: 'bg-blue-500/8',    border: 'border-blue-500/20',    text: 'text-blue-400',    hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
  violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/20',  text: 'text-violet-400',  hover: 'hover:bg-violet-500/15 hover:border-violet-500/30' },
  amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/20',   text: 'text-amber-400',   hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
  rose:    { bg: 'bg-rose-500/8',    border: 'border-rose-500/20',    text: 'text-rose-400',    hover: 'hover:bg-rose-500/15 hover:border-rose-500/30' },
  sky:     { bg: 'bg-sky-500/8',     border: 'border-sky-500/20',     text: 'text-sky-400',     hover: 'hover:bg-sky-500/15 hover:border-sky-500/30' },
  purple:  { bg: 'bg-purple-500/8',  border: 'border-purple-500/20',  text: 'text-purple-400',  hover: 'hover:bg-purple-500/15 hover:border-purple-500/30' },
  orange:  { bg: 'bg-orange-500/8',  border: 'border-orange-500/20',  text: 'text-orange-400',  hover: 'hover:bg-orange-500/15 hover:border-orange-500/30' },
  teal:    { bg: 'bg-teal-500/8',    border: 'border-teal-500/20',    text: 'text-teal-400',    hover: 'hover:bg-teal-500/15 hover:border-teal-500/30' },
  cyan:    { bg: 'bg-cyan-500/8',    border: 'border-cyan-500/20',    text: 'text-cyan-400',    hover: 'hover:bg-cyan-500/15 hover:border-cyan-500/30' },
};

export function OpsLaunchpad({ personaName, onSend }: { personaName: string; onSelect?: (prompt: string) => void; onSend: (prompt: string) => void }) {
  const [selectedPreset, setSelectedPreset] = useState<OpsPreset | null>(null);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});

  const handleCardClick = (preset: OpsPreset) => {
    if (preset.options && preset.options.length > 0) {
      setSelectedPreset(preset);
      const defaults: Record<string, string> = {};
      for (const opt of preset.options) {
        defaults[opt.key] = opt.defaultValue ?? '';
      }
      setOptionValues(defaults);
    } else {
      onSend(preset.prompt);
    }
  };

  const handleOptionSend = () => {
    if (!selectedPreset) return;
    let prompt = selectedPreset.prompt;
    for (const opt of selectedPreset.options ?? []) {
      const val = optionValues[opt.key]?.trim();
      if (val) {
        prompt += `\n${opt.label}: ${val}`;
      }
    }
    setSelectedPreset(null);
    onSend(prompt);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top half: Card grid */}
      <div className="flex-1 flex flex-col justify-center px-2">
        <div className="text-center mb-4">
          <p className="text-sm font-medium text-foreground/70">Operations for <span className="text-primary">{personaName}</span></p>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5">Select an action or type a command below</p>
        </div>
        <div className="grid grid-cols-5 gap-2 max-w-[640px] mx-auto">
          {OPS_PRESETS.map((preset) => {
            const c = COLOR_MAP[preset.color] || COLOR_MAP['blue']!;
            const isSelected = selectedPreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleCardClick(preset)}
                className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-150 cursor-pointer text-center ${c.bg} ${c.border} ${c.hover} ${isSelected ? 'ring-1 ring-primary/40 scale-[1.02]' : ''}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg} ${c.text} group-hover:scale-110 transition-transform`}>
                  {preset.icon}
                </div>
                <span className="text-[11px] font-medium text-foreground/80 leading-tight">{preset.label}</span>
                <span className="text-[9px] text-muted-foreground/50 leading-tight line-clamp-2">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom half: Options panel for selected preset */}
      <div className="border-t border-primary/10 px-4 py-3 min-h-[100px]">
        {selectedPreset ? (
          <div className="max-w-[640px] mx-auto space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`${COLOR_MAP[selectedPreset.color]?.text ?? 'text-primary'}`}>{selectedPreset.icon}</span>
                <span className="text-sm font-medium text-foreground/80">{selectedPreset.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSelectedPreset(null)}
                  className="px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground/80 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleOptionSend}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Run
                </button>
              </div>
            </div>
            {(selectedPreset.options ?? []).map((opt) => (
              <div key={opt.key} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground/60">{opt.label}</label>
                <input
                  type="text"
                  value={optionValues[opt.key] ?? ''}
                  onChange={(e) => setOptionValues((p) => ({ ...p, [opt.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOptionSend(); }}
                  placeholder={opt.placeholder}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-muted/30 text-foreground placeholder:text-muted-foreground/40 focus-ring"
                  autoFocus
                />
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/40 italic">{selectedPreset.prompt}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[11px] text-muted-foreground/40">Click a card above to configure and run, or type a command directly</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mode Toggle Button ──────────────────────────────────────────────────

export function ModeButton({ mode, current, onClick, icon, label }: {
  mode: ChatMode; current: ChatMode; onClick: (m: ChatMode) => void; icon: React.ReactNode; label: string;
}) {
  const active = mode === current;
  return (
    <button
      onClick={() => onClick(mode)}
      className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        active ? 'bg-primary/15 text-primary shadow-elevation-1' : 'text-muted-foreground/60 hover:text-muted-foreground/80'
      }`}
    >
      {icon} {label}
    </button>
  );
}
