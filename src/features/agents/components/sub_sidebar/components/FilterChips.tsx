import type { SmartTag } from '../libs/filterHelpers';

// ── Chip Component ───────────────────────────────────────────────────

export function FilterChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        active
          ? 'bg-primary/15 text-primary border border-primary/30'
          : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60 hover:text-muted-foreground'
      }`}
      style={
        active && color
          ? { backgroundColor: `${color}20`, color, borderColor: `${color}40` }
          : undefined
      }
    >
      {label}
    </button>
  );
}

// ── Tag Group Row ───────────────────────────────────────────────────

export function TagGroupRow({
  label,
  tags,
  activeTags,
  onToggle,
}: {
  label: string;
  tags: SmartTag[];
  activeTags: Set<string>;
  onToggle: (tagId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-sm text-muted-foreground/60 font-medium mr-0.5 min-w-[52px]">{label}</span>
      {tags.map((tag) => (
        <FilterChip
          key={tag.id}
          label={tag.label}
          active={activeTags.has(tag.id)}
          onClick={() => onToggle(tag.id)}
          color={tag.color}
        />
      ))}
    </div>
  );
}
