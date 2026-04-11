import { useState } from 'react';
import { Send, Play, FlaskConical, Wand2, TrendingUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// ── Advisory Preset Cards ──────────────────────────────────────────────

interface AdvisoryPreset {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: string;
  color: string;
  options?: { key: string; label: string; placeholder: string; defaultValue?: string }[];
}

const ADVISORY_PRESETS: AdvisoryPreset[] = [
  {
    id: 'improve', icon: <Wand2 className="w-5 h-5" />, label: 'Improve',
    description: 'Describe what you want this agent to do better',
    prompt: 'I want to improve this agent. Look at the execution history, knowledge patterns, and current prompt to understand what it does well and where it falls short. Then propose concrete changes that would improve its performance for my use case. For each proposed change, explain the expected impact and how we could test it.',
    color: 'amber',
    options: [{ key: 'goal', label: 'What should improve?', placeholder: 'e.g., Response tone is too robotic, needs to handle edge cases better, output format should be more structured...' }],
  },
  {
    id: 'experiment', icon: <FlaskConical className="w-5 h-5" />, label: 'Experiment',
    description: 'Test two approaches side-by-side',
    prompt: 'I want to run an experiment to compare two approaches for this agent. Look at the current setup, then design a test that compares the current version against an improved variant. Use the Matrix test to generate the variant and run both against the same scenarios. Report which performs better and why.',
    color: 'violet',
    options: [{ key: 'hypothesis', label: 'What to test?', placeholder: 'e.g., Would adding examples improve output quality? Does a shorter prompt reduce hallucinations?' }],
  },
  {
    id: 'analyze', icon: <TrendingUp className="w-5 h-5" />, label: 'Analyze',
    description: 'Review performance trends and patterns',
    prompt: 'Analyze this agent\'s recent performance. Look at execution history for success/failure trends, cost patterns, and duration changes. Check the knowledge graph for recurring failure patterns. Review assertion pass rates. Give me a clear picture of how this agent is performing and what the biggest opportunities for improvement are.',
    color: 'emerald',
  },
  {
    id: 'execute', icon: <Play className="w-5 h-5" />, label: 'Test Run',
    description: 'Run the agent and evaluate the result',
    prompt: 'Execute this agent now, then evaluate the output quality. Check if assertions pass, whether the response matches the use case expectations, and flag any issues you notice. Suggest specific improvements based on what you observe in this run.',
    color: 'blue',
    options: [{ key: 'input', label: 'Test input (optional)', placeholder: 'Custom input data for this test run...' }],
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; hover: string }> = {
  amber:   { bg: 'bg-amber-500/8',   border: 'border-amber-500/20',   text: 'text-amber-400',   hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
  violet:  { bg: 'bg-violet-500/8',  border: 'border-violet-500/20',  text: 'text-violet-400',  hover: 'hover:bg-violet-500/15 hover:border-violet-500/30' },
  emerald: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
  blue:    { bg: 'bg-blue-500/8',    border: 'border-blue-500/20',    text: 'text-blue-400',    hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
};

export function AdvisoryLaunchpad({ personaName, onSend }: { personaName: string; onSend: (prompt: string) => void }) {
  const { t } = useTranslation();
  const [selectedPreset, setSelectedPreset] = useState<AdvisoryPreset | null>(null);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});

  const handleCardClick = (preset: AdvisoryPreset) => {
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

    if (selectedPreset.id === 'execute') {
      const input = optionValues['input']?.trim();
      if (input) {
        prompt = `Execute this agent with this test input: "${input}". Then evaluate the output — check assertions, quality, and alignment with the use case. Suggest improvements based on what you observe.`;
      }
    } else if (selectedPreset.id === 'improve') {
      const goal = optionValues['goal']?.trim();
      if (goal) {
        prompt += `\n\nMy specific goal: ${goal}`;
      }
    } else if (selectedPreset.id === 'experiment') {
      const hypothesis = optionValues['hypothesis']?.trim();
      if (hypothesis) {
        prompt += `\n\nWhat I want to test: ${hypothesis}`;
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
          <p className="text-xl font-semibold text-foreground/80" data-testid="chat-launchpad-title">
            <span className="text-primary">{personaName}</span>
          </p>
          <p className="text-sm text-muted-foreground/40 mt-1">{t.agents.advisory.how_can_improve}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-2xl mx-auto">
          {ADVISORY_PRESETS.map((preset) => {
            const c = COLOR_MAP[preset.color] || COLOR_MAP['blue']!;
            const isSelected = selectedPreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                data-testid={`chat-preset-${preset.id}`}
                onClick={() => handleCardClick(preset)}
                className={`group flex flex-col items-center gap-2.5 p-5 rounded-xl border transition-all duration-200 cursor-pointer text-center ${c.bg} ${c.border} ${c.hover} ${isSelected ? 'ring-2 ring-primary/30 scale-[1.03]' : 'hover:scale-[1.02]'}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.text} transition-transform duration-200 group-hover:scale-110`}>
                  {preset.icon}
                </div>
                <span className="text-sm font-semibold text-foreground/80 leading-tight">{preset.label}</span>
                <span className="text-xs text-muted-foreground/45 leading-snug line-clamp-2">{preset.description}</span>
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
                <span className="text-sm font-medium text-foreground/80">{selectedPreset.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSelectedPreset(null)}
                  data-testid="chat-preset-cancel"
                  className="px-2.5 py-1 text-sm text-muted-foreground/60 hover:text-muted-foreground/80 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleOptionSend}
                  data-testid="chat-preset-run"
                  className="flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer"
                >
                  <Send className="w-3 h-3" /> {t.agents.advisory.go}
                </button>
              </div>
            </div>
            {(selectedPreset.options ?? []).map((opt) => (
              <div key={opt.key} className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground/60">{opt.label}</label>
                <input
                  type="text"
                  data-testid={`chat-preset-option-${opt.key}`}
                  value={optionValues[opt.key] ?? ''}
                  onChange={(e) => setOptionValues((p) => ({ ...p, [opt.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOptionSend(); }}
                  placeholder={opt.placeholder}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-primary/15 bg-muted/30 text-foreground placeholder:text-muted-foreground/40 focus-ring"
                  autoFocus
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
