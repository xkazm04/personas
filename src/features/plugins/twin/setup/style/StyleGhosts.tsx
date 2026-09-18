/**
 * Calm ghosts for the two in-flight regions (loading pattern v2): they sit
 * UNDER the panel's permanent chrome, fade in after a short delay so a fast
 * reply never paints them, and match the geometry of what replaces them.
 * Never a spinner for the surface; the pressed control carries the spinner.
 */

import { STYLE_GRID } from './PresetGallery';

function GhostLines({ lines, delay }: { lines: number; delay: number }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="block h-3 rounded-full bg-primary/[0.06] animate-fade-in"
          style={{ width: `${92 - i * 14}%`, animationDelay: `${delay + i * 35}ms` }}
        />
      ))}
    </>
  );
}

/** Three candidate-shaped blocks while a roll is in flight. */
export function CandidatesGhost({ label }: { label: string }) {
  return (
    <div className={STYLE_GRID} role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border border-primary/10 p-3 space-y-3 min-h-[16rem]" aria-hidden="true">
          <GhostLines lines={2} delay={150 + i * 60} />
          <span className="block h-16 rounded-input bg-primary/[0.04] animate-fade-in" style={{ animationDelay: `${220 + i * 60}ms` }} />
          <GhostLines lines={4} delay={260 + i * 60} />
        </div>
      ))}
    </div>
  );
}

/** One row per channel, shaped like the current-vs-proposed preview. */
export function PreviewGhost({ channels, label }: { channels: string[]; label: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {channels.map((channel, i) => (
        <div key={channel} className="grid gap-3 md:grid-cols-2 rounded-card border border-primary/10 p-3" aria-hidden="true">
          <div className="space-y-2"><GhostLines lines={3} delay={150 + i * 50} /></div>
          <div className="space-y-2"><GhostLines lines={5} delay={190 + i * 50} /></div>
        </div>
      ))}
    </div>
  );
}
