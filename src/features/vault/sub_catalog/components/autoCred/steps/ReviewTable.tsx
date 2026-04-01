import { useState } from 'react';
import { CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import type { DiscoveredField } from '../helpers/types';

interface UniversalFieldRowProps {
  field: DiscoveredField;
  value: string;
  onChange: (val: string) => void;
}

export function UniversalFieldRow({ field, value, onChange }: UniversalFieldRowProps) {
  const [visible, setVisible] = useState(false);
  const isSecret = field.type === 'password';
  const isFilled = value.trim().length > 0;

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg border border-primary/8 bg-secondary/15">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground/90">{field.label}</span>
          {field.required && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/60 font-medium">REQ</span>
          )}
          {field.help_text && (
            <span className="text-xs text-muted-foreground/40">{field.help_text}</span>
          )}
        </div>
        <div className="relative">
          <input
            type={isSecret && !visible ? 'password' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            className="w-full px-2.5 py-1.5 bg-black/15 border border-primary/8 rounded-md text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/30 font-mono transition-colors"
          />
          {isSecret && value && (
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground/70"
            >
              {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
      <div className="pt-6">
        {isFilled ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <XCircle className="w-4 h-4 text-muted-foreground/20" />
        )}
      </div>
    </div>
  );
}
