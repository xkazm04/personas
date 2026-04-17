import { useState } from 'react';
import { Send, Play, FlaskConical, Brain, Wand2, History, Zap, ListChecks, ClipboardCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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
    id: 'diagnose', icon: <Zap className="w-5 h-5" />, label: 'Diagnose',
    description: 'Analyze health, performance and find issues',
    prompt: 'Run a full diagnosis on this agent. First use the health_check operation, then list_executions to review recent runs. Analyze the results and tell me: what\'s working well, what\'s failing, and what should I fix. Be specific with actionable recommendations.',
    color: 'emerald',
  },
  {
    id: 'execute', icon: <Play className="w-5 h-5" />, label: 'Execute',
    description: 'Run the agent with optional input',
    prompt: 'Execute this agent now using the execute operation. After starting it, briefly explain what the agent will do based on its current configuration.',
    color: 'blue',
    options: [{ key: 'input', label: 'Input (optional)', placeholder: 'Custom input data for this execution...' }],
  },
  {
    id: 'arena', icon: <FlaskConical className="w-5 h-5" />, label: 'Arena Test',
    description: 'Compare models head-to-head',
    prompt: 'Start an arena test for this agent using the start_arena operation. Explain what will be compared and what to look for in the results.',
    color: 'violet',
    options: [{ key: 'models', label: 'Models', placeholder: 'haiku, sonnet', defaultValue: 'haiku, sonnet' }],
  },
  {
    id: 'improve', icon: <Wand2 className="w-5 h-5" />, label: 'Improve',
    description: 'AI-driven persona refinement',
    prompt: 'Review this agent\'s current prompt sections, tools, and design. Identify the top 3 weaknesses and for each one, show me the exact edit_prompt operation to fix it. Focus on making the agent more reliable and its output more useful.',
    color: 'amber',
    options: [{ key: 'instruction', label: 'Focus area', placeholder: 'e.g., Better error handling, improve output format, add web search fallback...' }],
  },
  {
    id: 'history', icon: <History className="w-5 h-5" />, label: 'Executions',
    description: 'Review recent execution history',
    prompt: 'Use the list_executions operation to show the last 5 runs. Analyze the results: which succeeded, which failed, average duration, and any patterns in failures.',
    color: 'sky',
  },
  {
    id: 'knowledge', icon: <Brain className="w-5 h-5" />, label: 'Knowledge',
    description: 'View memories and learned patterns',
    prompt: 'Use the list_memories operation to show what this agent has learned. Summarize the key patterns: what categories dominate, which are high-importance, and whether the memories are helping the agent improve.',
    color: 'purple',
  },
  {
    id: 'reviews', icon: <ClipboardCheck className="w-5 h-5" />, label: 'Reviews',
    description: 'Pending approvals and decisions',
    prompt: 'Use the list_reviews operation to show all pending manual reviews for this agent. For each review, show the title, severity, description, and context. Then ask me which ones I want to approve or reject.',
    color: 'rose',
  },
  {
    id: 'versions', icon: <ListChecks className="w-5 h-5" />, label: 'Versions',
    description: 'Prompt version history and rollback',
    prompt: 'Use the list_versions operation to show the prompt version history. Tell me which version is in production, what changed between versions, and whether a rollback might be warranted.',
    color: 'teal',
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; hover: string }> = {
  emerald: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
  blue:    { bg: 'bg-blue-500/8',    border: 'border-blue-500/20',    text: 'text-blue-400',    hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
  violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/20',  text: 'text-violet-400',  hover: 'hover:bg-violet-500/15 hover:border-violet-500/30' },
  amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/20',   text: 'text-amber-400',   hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
  sky:     { bg: 'bg-sky-500/8',     border: 'border-sky-500/20',     text: 'text-sky-400',     hover: 'hover:bg-sky-500/15 hover:border-sky-500/30' },
  purple:  { bg: 'bg-purple-500/8',  border: 'border-purple-500/20',  text: 'text-purple-400',  hover: 'hover:bg-purple-500/15 hover:border-purple-500/30' },
  teal:    { bg: 'bg-teal-500/8',    border: 'border-teal-500/20',    text: 'text-teal-400',    hover: 'hover:bg-teal-500/15 hover:border-teal-500/30' },
  rose:    { bg: 'bg-rose-500/8',    border: 'border-rose-500/20',    text: 'text-rose-400',    hover: 'hover:bg-rose-500/15 hover:border-rose-500/30' },
};

export function OpsLaunchpad({ personaName, onSend }: { personaName: string; onSelect?: (prompt: string) => void; onSend: (prompt: string) => void }) {
  const { t } = useTranslation();
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

    // For execute preset, embed input directly in the operation instruction
    if (selectedPreset.id === 'execute') {
      const input = optionValues['input']?.trim();
      if (input) {
        prompt = `Execute this agent now with this input: "${input}". Use the execute operation with the input field set to exactly that value.`;
      }
    } else if (selectedPreset.id === 'improve') {
      const instruction = optionValues['instruction']?.trim();
      if (instruction) {
        prompt += `\n\nFocus specifically on: ${instruction}. Show edit_prompt operations for improvements in this area.`;
      }
    } else {
      for (const opt of selectedPreset.options ?? []) {
        const val = optionValues[opt.key]?.trim();
        if (val) {
          prompt += `\n${opt.label}: ${val}`;
        }
      }
    }
    setSelectedPreset(null);
    onSend(prompt);
  };

  return (
    <div className="flex flex-col h-full" data-testid="chat-launchpad">
      {/* Card grid */}
      <div className="flex-1 flex flex-col justify-center px-4 py-4">
        <div className="text-center mb-5">
          <p className="text-xl font-semibold text-foreground" data-testid="chat-launchpad-title">
            <span className="text-primary">{personaName}</span>
          </p>
          <p className="text-sm text-foreground mt-1">{t.agents.ops.choose_action}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-3xl mx-auto">
          {OPS_PRESETS.map((preset) => {
            const c = COLOR_MAP[preset.color] || COLOR_MAP['blue']!;
            const isSelected = selectedPreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                data-testid={`chat-preset-${preset.id}`}
                onClick={() => handleCardClick(preset)}
                className={`group flex flex-col items-center gap-2.5 p-4 rounded-modal border transition-all duration-200 cursor-pointer text-center ${c.bg} ${c.border} ${c.hover} ${isSelected ? 'ring-2 ring-primary/30 scale-[1.03]' : 'hover:scale-[1.02]'}`}
              >
                <div className={`w-10 h-10 rounded-modal flex items-center justify-center ${c.text} transition-transform duration-200 group-hover:scale-110`}>
                  {preset.icon}
                </div>
                <span className="text-sm font-semibold text-foreground leading-tight">{preset.label}</span>
                <span className="text-xs text-foreground leading-snug line-clamp-2">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Options panel for selected preset */}
      {selectedPreset && (
        <div className="border-t border-primary/10 px-4 py-3" data-testid="chat-preset-options">
          <div className="max-w-[680px] mx-auto space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`${COLOR_MAP[selectedPreset.color]?.text ?? 'text-primary'}`}>{selectedPreset.icon}</span>
                <span className="text-sm font-medium text-foreground">{selectedPreset.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSelectedPreset(null)}
                  data-testid="chat-preset-cancel"
                  className="px-2.5 py-1 text-sm text-foreground hover:text-muted-foreground/80 rounded-card hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleOptionSend}
                  data-testid="chat-preset-run"
                  className="flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-card bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  <Send className="w-3 h-3" /> {t.agents.ops.run}
                </button>
              </div>
            </div>
            {(selectedPreset.options ?? []).map((opt) => (
              <div key={opt.key} className="space-y-1">
                <label className="text-sm font-medium text-foreground">{opt.label}</label>
                <input
                  type="text"
                  data-testid={`chat-preset-option-${opt.key}`}
                  value={optionValues[opt.key] ?? ''}
                  onChange={(e) => setOptionValues((p) => ({ ...p, [opt.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOptionSend(); }}
                  placeholder={opt.placeholder}
                  className="w-full px-3 py-2 text-sm rounded-card border border-primary/15 bg-muted/30 text-foreground placeholder:text-foreground focus-ring"
                  autoFocus
                />
              </div>
            ))}
            <p className="text-xs text-foreground italic">{selectedPreset.prompt}</p>
          </div>
        </div>
      )}
    </div>
  );
}
