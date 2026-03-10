import { Monitor, ExternalLink, Wifi } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';

/**
 * Mobile-only card that links to Claude Code Remote Control (claude.ai/code).
 * Shown on the dashboard to guide users to connect their desktop CLI session.
 */
export default function RemoteControlCard() {
  const handleOpen = async () => {
    try {
      await open('https://claude.ai/code');
    } catch {
      // Fallback: open in default browser via window
      window.open('https://claude.ai/code', '_blank');
    }
  };

  return (
    <button
      onClick={handleOpen}
      className="w-full text-left p-5 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-violet-500/5 hover:from-cyan-500/10 hover:via-blue-500/10 hover:to-violet-500/10 hover:border-cyan-500/30 transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 flex-shrink-0">
          <Monitor className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground">Connect to Desktop</h3>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-cyan-400 transition-colors" />
          </div>
          <p className="text-sm text-muted-foreground/70 leading-relaxed">
            Run agents using your desktop CLI via Remote Control. Start <code className="px-1 py-0.5 rounded bg-primary/10 text-primary/80 text-xs font-mono">claude remote-control</code> on your computer, then connect here.
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-cyan-400/70">
            <Wifi className="w-3 h-3" />
            <span>Requires Claude Pro or Max subscription</span>
          </div>
        </div>
      </div>
    </button>
  );
}
