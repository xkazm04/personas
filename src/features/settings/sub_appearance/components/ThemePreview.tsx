// ---------------------------------------------------------------------------
// Mini preview — shows derived colors in a miniature app
// ---------------------------------------------------------------------------

export function ThemePreview({ vars }: { vars: Record<string, string> }) {
  const bg = vars['--background'];
  const fg = vars['--foreground'];
  const primary = vars['--primary'];
  const accent = vars['--accent'];
  const secondary = vars['--secondary'];
  const border = vars['--border'];
  const muted = vars['--muted-foreground'];
  const cardBg = vars['--card-bg'];
  const cardBorder = vars['--card-border'];
  const btnPrimary = vars['--btn-primary'];
  const gradient = vars['--background-gradient'];

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: border, color: fg }}
    >
      <div
        className="flex"
        style={{
          minHeight: 120,
          backgroundColor: bg,
          backgroundImage: gradient ?? 'none',
        }}
      >
        {/* Sidebar mock */}
        <div
          className="w-12 flex-shrink-0 flex flex-col items-center gap-2 py-3 border-r"
          style={{ backgroundColor: secondary, borderColor: border }}
        >
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: primary, opacity: 0.9 }} />
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: fg, opacity: 0.08 }} />
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: fg, opacity: 0.08 }} />
        </div>

        {/* Main area */}
        <div className="flex-1 p-3 space-y-2.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: primary }} />
              <span className="text-xs font-semibold" style={{ color: fg }}>Dashboard</span>
            </div>
            <div
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{ backgroundColor: btnPrimary, color: '#fff' }}
            >
              Action
            </div>
          </div>

          {/* Card mock */}
          <div
            className="rounded-lg p-2.5 space-y-1.5 border"
            style={{ backgroundColor: cardBg, borderColor: cardBorder }}
          >
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
              <span className="text-[10px] font-medium" style={{ color: fg }}>Card Title</span>
            </div>
            <div className="h-px" style={{ backgroundColor: border }} />
            <span className="text-[9px] block" style={{ color: muted }}>
              Muted description text with secondary content
            </span>
          </div>

          {/* Status dots */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-success'] }} />
              <span className="text-[8px]" style={{ color: muted }}>OK</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-warning'] }} />
              <span className="text-[8px]" style={{ color: muted }}>Warn</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-error'] }} />
              <span className="text-[8px]" style={{ color: muted }}>Err</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
