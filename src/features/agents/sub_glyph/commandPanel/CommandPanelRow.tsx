interface CommandPanelRowProps {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  iconColor?: string;
  children: React.ReactNode;
  alignTop?: boolean;
}

export function CommandPanelRow({ icon: Icon, label, iconColor, children, alignTop }: CommandPanelRowProps) {
  return (
    <div className={`flex gap-4 py-3.5 border-b border-border/15 last:border-0 ${alignTop ? "items-start" : "items-center"}`}>
      <div className={`shrink-0 w-24 flex items-center gap-1.5 typo-label text-foreground ${alignTop ? "pt-2" : ""}`}>
        <Icon className="w-3.5 h-3.5" style={{ color: iconColor ?? "var(--color-primary)" }} />
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

interface CommandPanelAttachButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function CommandPanelAttachButton({
  icon: Icon, active, onClick, children,
}: CommandPanelAttachButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border transition-all ${
        active
          ? "bg-primary/20 border-primary/50 text-foreground"
          : "bg-foreground/5 border-border/30 text-foreground/85 hover:border-primary/40 hover:text-foreground hover:bg-primary/10"
      }`}
      style={active ? { boxShadow: "0 0 12px rgba(96,165,250,0.25)" } : undefined}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="typo-caption font-medium">{children}</span>
    </button>
  );
}
