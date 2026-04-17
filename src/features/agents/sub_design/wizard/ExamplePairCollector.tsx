import { useState, useCallback } from 'react';
import { Plus, Trash2, ArrowRight, FileInput, FileOutput } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
export interface ExamplePair {
  id: string;
  input: string;
  output: string;
}

interface ExamplePairCollectorProps {
  pairs: ExamplePair[];
  onPairsChange: (pairs: ExamplePair[]) => void;
  disabled?: boolean;
}

export function ExamplePairCollector({
  pairs,
  onPairsChange,
  disabled = false,
}: ExamplePairCollectorProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const addPair = useCallback(() => {
    onPairsChange([...pairs, { id: crypto.randomUUID(), input: '', output: '' }]);
  }, [pairs, onPairsChange]);

  const removePair = useCallback((id: string) => {
    onPairsChange(pairs.filter((p) => p.id !== id));
  }, [pairs, onPairsChange]);

  const updatePair = useCallback((id: string, field: 'input' | 'output', value: string) => {
    onPairsChange(pairs.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }, [pairs, onPairsChange]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { t, tx } = useTranslation();

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-foreground leading-relaxed max-w-[80%]">
          {t.agents.design.example_instructions}
        </p>
        <button
          onClick={addPair}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 rounded-card text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t.common.add}
        </button>
      </div>

      {pairs.map((pair, index) => {
          const isCollapsed = collapsed.has(pair.id);
          const hasContent = pair.input.trim() || pair.output.trim();
          const preview = hasContent
            ? (pair.input.trim().slice(0, 40) || '(no input)') + ' -> ' + (pair.output.trim().slice(0, 40) || '(no output)')
            : null;

          return (
            <div
              key={pair.id}
              className="animate-fade-slide-in rounded-modal border border-emerald-500/15 bg-emerald-500/[0.02] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => toggleCollapse(pair.id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                >
                  <span className="text-xs font-semibold text-emerald-400/80 uppercase tracking-wider">
                    {tx(t.agents.design.example_n, { index: index + 1 })}
                  </span>
                  {isCollapsed && preview && (
                    <span className="text-xs text-foreground truncate ml-1">
                      {preview}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => removePair(pair.id)}
                  disabled={disabled}
                  className="p-0.5 text-foreground hover:text-red-400 transition-colors"
                  title={t.agents.design.remove_example}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Expanded content */}
              {!isCollapsed && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Input */}
                  <div className="space-y-1">
                    <label className="flex items-center gap-1 text-xs font-medium text-foreground">
                      <FileInput className="w-3 h-3" />
                      {t.agents.design.input_label}
                    </label>
                    <textarea
                      value={pair.input}
                      onChange={(e) => updatePair(pair.id, 'input', e.target.value)}
                      disabled={disabled}
                      placeholder={t.agents.design.input_placeholder}
                      rows={4}
                      className="w-full bg-background/50 border border-emerald-500/10 rounded-card px-3 py-2 text-sm text-foreground font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
                    />
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <ArrowRight className="w-4 h-4 text-emerald-500/40 rotate-90" />
                  </div>

                  {/* Output */}
                  <div className="space-y-1">
                    <label className="flex items-center gap-1 text-xs font-medium text-foreground">
                      <FileOutput className="w-3 h-3" />
                      {t.agents.design.output_label}
                    </label>
                    <textarea
                      value={pair.output}
                      onChange={(e) => updatePair(pair.id, 'output', e.target.value)}
                      disabled={disabled}
                      placeholder={t.agents.design.output_placeholder}
                      rows={4}
                      className="w-full bg-background/50 border border-emerald-500/10 rounded-card px-3 py-2 text-sm text-foreground font-mono resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

      {pairs.length === 0 && (
        <button
          onClick={addPair}
          disabled={disabled}
          className="w-full flex flex-col items-center gap-2 py-6 rounded-modal border border-dashed border-emerald-500/20 hover:border-emerald-500/35 bg-emerald-500/[0.02] hover:bg-emerald-500/[0.04] transition-all group"
        >
          <div className="flex items-center gap-2 text-emerald-400/60 group-hover:text-emerald-400/80 transition-colors">
            <FileInput className="w-4 h-4" />
            <ArrowRight className="w-3.5 h-3.5" />
            <FileOutput className="w-4 h-4" />
          </div>
          <span className="text-sm text-foreground group-hover:text-muted-foreground/80 transition-colors">
            {t.agents.design.add_first_example}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Format example pairs into a structured intent string for the compiler.
 * This becomes the `intent` parameter passed to `compileFromIntent`.
 */
export function formatExamplePairsAsIntent(pairs: ExamplePair[], supplementaryNote?: string): string {
  const validPairs = pairs.filter((p) => p.input.trim() || p.output.trim());
  if (validPairs.length === 0) return supplementaryNote?.trim() ?? '';

  const parts: string[] = [];

  parts.push(
    'Design this agent based on the following concrete input/output examples. ' +
    'Reverse-engineer the full configuration (prompt, tools, triggers, connectors, use cases) ' +
    'from these examples. Each example shows a real input the agent would receive and the ' +
    'desired output it should produce.\n',
  );

  for (let i = 0; i < validPairs.length; i++) {
    const pair = validPairs[i]!;
    parts.push(`### Example ${i + 1}`);
    parts.push('**Input:**');
    parts.push('```');
    parts.push(pair.input.trim() || '(empty)');
    parts.push('```');
    parts.push('**Desired Output:**');
    parts.push('```');
    parts.push(pair.output.trim() || '(empty)');
    parts.push('```');
    parts.push('');
  }

  if (supplementaryNote?.trim()) {
    parts.push('### Additional Context');
    parts.push(supplementaryNote.trim());
  }

  return parts.join('\n');
}
