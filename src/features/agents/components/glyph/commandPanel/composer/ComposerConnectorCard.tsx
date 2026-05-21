import { Plug, Check } from "lucide-react";
import type { HealthyConnector } from "@/features/agents/components/matrix/useHealthyConnectors";
import { ComposerBrandIcon } from "./ComposerBrandIcon";

export function humanizeCategory(slug: string): string {
  return slug
    .split(/[_-]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

interface ComposerConnectorCardProps {
  connector: HealthyConnector;
  selected: boolean;
  onToggle: () => void;
}

export function ComposerConnectorCard({ connector, selected, onToggle }: ComposerConnectorCardProps) {
  const meta = connector.meta;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group relative flex items-center gap-3 p-3 rounded-card border transition-all text-left ${
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-border/25 bg-foreground/[0.02] hover:border-primary/35 hover:bg-primary/[0.04]"
      }`}
      style={selected ? { boxShadow: `0 0 18px ${meta.color}33` } : undefined}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-interactive flex items-center justify-center overflow-hidden"
        style={{ background: `${meta.color}26` }}
      >
        {meta.iconUrl ? (
          <ComposerBrandIcon iconUrl={meta.iconUrl} color={meta.color} size={22} />
        ) : (
          <Plug className="w-5 h-5" style={{ color: meta.color }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="typo-body text-foreground font-medium truncate">{meta.label}</div>
        <div className="typo-caption text-foreground truncate">
          {humanizeCategory(connector.category)}
        </div>
      </div>
      {selected && (
        <span
          className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
          style={{ boxShadow: "0 0 10px rgba(96,165,250,0.8)" }}
        >
          <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
