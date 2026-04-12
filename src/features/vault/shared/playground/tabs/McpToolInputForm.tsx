import { useTranslation } from '@/i18n/useTranslation';
import type { McpTool } from '@/api/agents/mcpTools';

// -- Tool input form ----------------------------------------------

interface ToolInputFormProps {
  tool: McpTool;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function ToolInputForm({
  tool,
  values,
  onChange,
}: ToolInputFormProps) {
  const schema = tool.input_schema as Record<string, unknown> | null;
  if (!schema) {
    return (
      <p className="text-sm text-muted-foreground/60">This tool takes no input parameters.</p>
    );
  }

  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = ((schema.required || []) as string[]);
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/60">This tool takes no input parameters.</p>
    );
  }

  return (
    <div className="space-y-2">
      {keys.map((key) => {
        const prop = properties[key]!;
        const isRequired = required.includes(key);
        const propType = (prop.type as string) || 'string';
        const description = prop.description as string | undefined;
        const isComplex = ['object', 'array'].includes(propType);

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-sm font-mono text-foreground/70">{key}</label>
              {isRequired && <span className="text-sm text-amber-400/60">required</span>}
              <span className="text-sm text-violet-400/50">{propType}</span>
            </div>
            {description && (
              <p className="text-sm text-muted-foreground/60">{description}</p>
            )}
            {isComplex ? (
              <textarea
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                placeholder={`Enter JSON ${propType}...`}
                rows={3}
                className="w-full px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 resize-none focus-visible:outline-none focus-visible:border-primary/25"
              />
            ) : propType === 'boolean' ? (
              <select
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                className="px-2 py-1.5 rounded text-sm bg-secondary/20 border border-primary/10 text-foreground/70 focus-visible:outline-none focus-visible:border-primary/25"
              >
                <option value="">-- select --</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={propType === 'number' || propType === 'integer' ? 'number' : 'text'}
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                placeholder={`Enter ${propType}...`}
                className="w-full px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus-visible:outline-none focus-visible:border-primary/25"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
