import { useMemo } from "react";
import { Plug, X } from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import { CommandPanelRow, CommandPanelAttachButton } from "./CommandPanelRow";
import { ComposerBrandIcon } from "./composer/ComposerBrandIcon";
import type { IntentRowDef } from "./commandPanelHelpers";

interface CommandPanelToolsRowProps {
  rowDef: IntentRowDef;
  draftValue: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  selectedConnectors: string[];
  setSelectedConnectors: React.Dispatch<React.SetStateAction<string[]>>;
  onOpenTools: () => void;
}

export function CommandPanelToolsRow({
  rowDef, draftValue, onChange, onKeyDown,
  selectedConnectors, setSelectedConnectors, onOpenTools,
}: CommandPanelToolsRowProps) {
  const healthyConnectors = useHealthyConnectors();
  const connectorChips = useMemo(
    () => selectedConnectors.map((name) => {
      const h = healthyConnectors.find((hc) => hc.name === name);
      return { name, label: h?.meta.label ?? name, color: h?.meta.color, iconUrl: h?.meta.iconUrl };
    }),
    [selectedConnectors, healthyConnectors],
  );

  return (
    <CommandPanelRow icon={rowDef.icon} label={rowDef.label} alignTop>
      <div className="flex flex-col gap-2">
        {connectorChips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {connectorChips.map((c) => (
              <span
                key={c.name}
                className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground"
                style={c.color ? { boxShadow: `0 0 10px ${c.color}26` } : undefined}
              >
                <span
                  className="inline-flex w-5 h-5 rounded-full items-center justify-center overflow-hidden shrink-0"
                  style={{ background: c.color ? `${c.color}26` : undefined }}
                >
                  {c.iconUrl && c.color ? (
                    <ComposerBrandIcon iconUrl={c.iconUrl} color={c.color} size={14} />
                  ) : (
                    <Plug className="w-3 h-3" style={{ color: c.color }} />
                  )}
                </span>
                {c.label}
                <button
                  type="button"
                  onClick={() => setSelectedConnectors((p) => p.filter((n) => n !== c.name))}
                  aria-label={`Remove ${c.label}`}
                  className="text-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftValue}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={rowDef.placeholder}
            data-testid="composer-row-tools"
            className="flex-1 min-w-0 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
          />
          <CommandPanelAttachButton icon={Plug} active={selectedConnectors.length > 0} onClick={onOpenTools}>
            {selectedConnectors.length === 0
              ? "Pick from vault"
              : `${selectedConnectors.length} attached`}
          </CommandPanelAttachButton>
        </div>
      </div>
    </CommandPanelRow>
  );
}
