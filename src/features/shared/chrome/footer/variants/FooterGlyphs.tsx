import { useId, type ReactNode } from 'react';

// PROTOTYPE (footer variants, 2026-10-06): one drawn glyph per footer job.
//
// Lucide's generic marks (Palette, Keyboard, Laptop, NotepadText, Cpu) said
// "a thing of this kind"; these say what the control DOES here. The theme disc
// is painted in the live theme colour, the keycap carries the `;` that arms
// shortcut mode, the CPU die fills with the measured load, the sidebar frame
// points its chevron the way the click will move the rail.
//
// Two weights share one drawing: `duo` (stroke + 20% body tint) for a light
// bar, `solid` (filled body, details knocked out in the background colour) for
// a dominant one. Details are drawn ON bodies, so in solid they cut through.

export type GlyphWeight = 'duo' | 'solid';

interface GlyphProps {
  className?: string;
  weight?: GlyphWeight;
}

function ink(weight: GlyphWeight = 'duo') {
  return weight === 'solid'
    ? { body: { fill: 'currentColor', fillOpacity: 1 }, detail: 'var(--background)' }
    : { body: { fill: 'currentColor', fillOpacity: 0.32 }, detail: 'currentColor' };
}

function Svg({ className = 'w-6 h-6', children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

/** Window frame with the rail drawn in; the chevron points where a click moves it. */
export function SidebarGlyph({ collapsed, ...p }: GlyphProps & { collapsed: boolean }) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M9.5 4.5H6a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h3.5Z" {...k.body} stroke="none" />
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
      <path d={collapsed ? 'M14 9.25 16.75 12 14 14.75' : 'M16.5 9.25 13.75 12l2.75 2.75'} strokeWidth={2} />
    </Svg>
  );
}

/** Contrast disc: the left half is the active theme's primary, live. */
export function ThemeGlyph({ swatch, ...p }: GlyphProps & { swatch: string }) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill={swatch} stroke="none" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" {...k.body} stroke="none" />
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.6" fill="var(--background)" strokeWidth={1.5} />
    </Svg>
  );
}

/** A keycap wearing the `;` that arms shortcut mode. */
export function KeycapGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <rect x="5.5" y="5.25" width="13" height="11.5" rx="2" {...k.body} strokeWidth={1.25} />
      <circle cx="12" cy="8.3" r="1.45" fill={k.detail} stroke="none" />
      <circle cx="12" cy="12.4" r="1.45" fill={k.detail} stroke="none" />
      <path d="M13.3 12.6c.15 1.7-.55 2.8-2.1 3.4" stroke={k.detail} strokeWidth={1.6} />
    </Svg>
  );
}

/** A sheet mid-sentence: the last line ends in a text caret. */
export function NotepadGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M7 3.5h7.5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" {...k.body} />
      <path d="M14.5 3.5v3a1 1 0 0 0 1 1h3" stroke={k.detail} />
      <path d="M8.5 11h7M8.5 14h7M8.5 17h3.5" stroke={k.detail} />
      <path d="M14.25 15.5v3" stroke={k.detail} strokeWidth={1.5} />
    </Svg>
  );
}

/** Three peers and their links: the local mesh the network panel inspects. */
export function NetworkGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M10.9 7.6 6.7 15.4M13.1 7.6l4.2 7.8M7.9 17.5h8.2" />
      <circle cx="12" cy="5.5" r="2.4" {...k.body} />
      <circle cx="5.5" cy="17.5" r="2.4" {...k.body} />
      <circle cx="18.5" cy="17.5" r="2.4" {...k.body} />
    </Svg>
  );
}

/** A CPU die whose body fills from the bottom with the measured load (0..1). */
export function CpuGlyph({ load, ...p }: GlyphProps & { load: number }) {
  const clip = `g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const h = 12 * Math.min(1, Math.max(0, load));
  return (
    <Svg className={p.className}>
      <defs>
        <clipPath id={clip}><rect x="6" y="6" width="12" height="12" rx="2.5" /></clipPath>
      </defs>
      <rect x="6" y={18 - h} width="12" height={h} clipPath={`url(#${clip})`}
        fill="currentColor" fillOpacity={p.weight === 'solid' ? 0.9 : 0.45} stroke="none"
        style={{ transition: 'y 500ms ease-out, height 500ms ease-out' }} />
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 3.5V6M14.5 3.5V6M9.5 18v2.5M14.5 18v2.5M3.5 9.5H6M3.5 14.5H6M18 9.5h2.5M18 14.5h2.5" />
    </Svg>
  );
}

/** A route walked part-way to its flag. */
export function TourGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M5 19c3-1 3.5-4.5 7-5s4.5-2.5 5-4.5" strokeDasharray="0.1 3" strokeWidth={2.2} />
      <circle cx="5" cy="19" r="1.9" fill="currentColor" stroke="none" />
      <path d="M17 13V3.5" />
      <path d="M17 4h4.25l-1.4 2.25 1.4 2.25H17Z" {...k.body} />
    </Svg>
  );
}

/** Rewind loop around a spark: setup, from the top. */
export function ReplayGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <path d="M4.6 12.5a7.5 7.5 0 1 0 2.2-6.1" />
      <path d="M4.5 3.75v3.5H8" />
      <path d="m12 8.25 1 2.75 2.75 1-2.75 1-1 2.75-1-2.75L8.25 12 11 11Z" {...k.body} strokeWidth={1.25} />
    </Svg>
  );
}

/** Head-and-shoulders: who is signed in, or the door to signing in. */
export function AccountGlyph(p: GlyphProps) {
  const k = ink(p.weight);
  return (
    <Svg className={p.className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3.25" {...k.body} />
      <path d="M6.4 18.6c1.2-2.3 3.2-3.5 5.6-3.5s4.4 1.2 5.6 3.5" />
    </Svg>
  );
}

/** A memory stick whose chips fill left to right with used RAM (0..1). */
export function MemoryGlyph({ used, ...p }: GlyphProps & { used: number }) {
  const clip = `g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const w = 16 * Math.min(1, Math.max(0, used));
  return (
    <Svg className={p.className}>
      <defs>
        <clipPath id={clip}><rect x="4" y="7" width="16" height="8.5" rx="1" /></clipPath>
      </defs>
      <rect x="4" y="7" width={w} height="8.5" clipPath={`url(#${clip})`}
        fill="currentColor" fillOpacity={p.weight === 'solid' ? 0.9 : 0.45} stroke="none"
        style={{ transition: 'width 500ms ease-out' }} />
      <path d="M3 7h18v8.5h-7.5l-1.5 1.5-1.5-1.5H3Z" />
      <path d="M5.5 17.5V19M9 17.5V19M15 17.5V19M18.5 17.5V19" />
    </Svg>
  );
}
