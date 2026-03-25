/**
 * Sub-panels for InlineCredentialPanel: MethodPicker, DesignQueryInput.
 * ManualForm is in ManualCredentialForm.tsx.
 */
import { Sparkles, PenTool } from 'lucide-react';
import { MOTION } from '@/features/templates/animationPresets';

// Re-export ManualForm from its own file for convenience
export { ManualForm } from './ManualCredentialForm';

// -- Method Card --------------------------------------------------------

function MethodCard({
  icon,
  label,
  description,
  onClick,
  disabled,
  disabledHint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  accent?: 'violet';
}) {
  const border = disabled
    ? 'border-primary/8'
    : accent === 'violet'
      ? 'border-violet-500/20 hover:border-violet-500/35'
      : 'border-primary/15 hover:border-primary/25';
  const bg = disabled
    ? 'bg-secondary/10'
    : accent === 'violet'
      ? 'hover:bg-violet-500/5'
      : 'hover:bg-secondary/30';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-3 rounded-lg border ${border} ${bg} text-left transition-all ${MOTION.snappy.css} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={disabledHint}
    >
      <div className="mb-1.5">{icon}</div>
      <p className="text-sm font-medium text-foreground/85">{label}</p>
      <p className="text-sm text-muted-foreground/50 mt-0.5 leading-relaxed">{description}</p>
    </button>
  );
}

// -- Method Picker ------------------------------------------------------

export function MethodPicker({
  hasKnownFields,
  onManual,
  onDesign,
}: {
  hasKnownFields: boolean;
  onManual: () => void;
  onDesign: () => void;
}) {
  return (
    <div
      className="animate-fade-slide-in grid grid-cols-2 gap-2"
    >
      <MethodCard
        icon={<PenTool className="w-4 h-4 text-foreground/60" />}
        label="Manual Input"
        description={hasKnownFields ? 'Fill in credential fields' : 'No fields -- use Design'}
        onClick={onManual}
        disabled={!hasKnownFields}
        disabledHint={!hasKnownFields ? 'No fields defined -- use Design with AI' : undefined}
      />
      <MethodCard
        icon={<Sparkles className="w-4 h-4 text-violet-400" />}
        label="Design with AI"
        description="AI discovers fields, optionally auto-fills"
        onClick={onDesign}
        accent="violet"
      />
    </div>
  );
}

// -- Design Query Input -------------------------------------------------

export function DesignQueryInput({
  query,
  onQueryChange,
  onStartDesign,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onStartDesign: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onStartDesign();
    }
  };

  return (
    <div
      className="animate-fade-slide-in space-y-3"
    >
      <p className="text-sm text-muted-foreground/70">
        Describe the service or connector you need. AI will identify
        credential requirements and offer auto-setup when possible.
      </p>
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Zendesk API, Intercom, Freshdesk..."
        rows={2}
        autoFocus
        className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus-ring resize-none"
      />
      <div className="flex justify-end">
        <button
          onClick={onStartDesign}
          disabled={!query.trim()}
          className={`flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-xl text-sm font-medium transition-all ${MOTION.snappy.css}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Design Credential
        </button>
      </div>
    </div>
  );
}
