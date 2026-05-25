import type { ThemeDefinition } from '@/stores/themeStore';

/* Hover-expand popover — renders a larger fidelity app-surface sample of
   the theme: titlebar, sidebar with nav items, header card, status row,
   chart sparkline, button row. Same data-theme cascade trick as the
   swatch tile, so all child Tailwind utility classes paint with the
   previewed theme. Positioned below the tile; pointer-events-none so the
   hover target stays the tile itself. */
export function AppearanceThemeHoverPreview({ theme }: { theme: ThemeDefinition }) {
  return (
    <div
      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 pointer-events-none animate-expand-in"
      style={{ zIndex: 9999 }}
      aria-hidden="true"
    >
      <div
        data-theme={theme.id}
        className="w-[280px] rounded-modal overflow-hidden shadow-elevation-4 border border-card-border bg-background text-foreground"
      >
        {/* Faux titlebar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-card-border">
          <span className="w-2 h-2 rounded-full bg-status-error" />
          <span className="w-2 h-2 rounded-full bg-status-warning" />
          <span className="w-2 h-2 rounded-full bg-status-success" />
          <span className="ml-auto text-[10px] font-semibold tracking-wide text-foreground">
            {theme.label}
          </span>
        </div>
        {/* Body: faux sidebar + main column */}
        <div className="flex">
          <div className="flex flex-col gap-1.5 px-2 py-2.5 border-r border-card-border bg-secondary/40">
            <span className="w-5 h-5 rounded-interactive bg-primary/80" />
            <span className="w-5 h-5 rounded-interactive bg-foreground/10" />
            <span className="w-5 h-5 rounded-interactive bg-foreground/10" />
            <span className="w-5 h-5 rounded-interactive bg-foreground/10" />
          </div>
          <div className="flex-1 px-3 py-2.5 flex flex-col gap-2">
            {/* Card */}
            <div className="rounded-card bg-card-bg border border-card-border p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="h-1.5 w-12 rounded-full bg-foreground/30" />
                <span className="px-1.5 py-0.5 rounded-pill text-[8px] font-semibold bg-status-success/20 text-status-success">OK</span>
              </div>
              <span className="block h-1 w-full rounded-full bg-foreground/10" />
              <span className="block h-1 w-3/4 rounded-full bg-foreground/10" />
            </div>
            {/* Status row */}
            <div className="flex items-center gap-1">
              <span className="px-1.5 py-0.5 rounded-pill text-[8px] font-semibold bg-status-info/20 text-status-info">INFO</span>
              <span className="px-1.5 py-0.5 rounded-pill text-[8px] font-semibold bg-status-warning/25 text-status-warning">WARN</span>
              <span className="px-1.5 py-0.5 rounded-pill text-[8px] font-semibold bg-status-error/20 text-status-error">ERR</span>
            </div>
            {/* Sparkline */}
            <svg viewBox="0 0 100 24" className="w-full h-6" preserveAspectRatio="none">
              <polyline
                points="0,18 12,14 24,16 36,8 48,11 60,5 72,9 84,3 100,7"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="0,21 12,19 24,20 36,17 48,19 60,16 72,18 84,15 100,16"
                fill="none"
                stroke="var(--accent)"
                strokeOpacity="0.55"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {/* Button row */}
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-1 rounded-interactive text-[10px] font-semibold bg-primary text-btn-primary-fg">Run</span>
              <span className="px-2 py-1 rounded-interactive text-[10px] font-medium border border-card-border text-foreground/85">Skip</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
