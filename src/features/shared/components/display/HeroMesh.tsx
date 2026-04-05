/**
 * Ambient gradient mesh background used for branded hero sections.
 * Provides named presets so every screen shares the same visual language.
 */

interface Orb {
  position: string;
  size: string;
  /** Radial gradient (GPU-friendly alternative to blur filter) */
  gradient: string;
}

interface PresetConfig {
  orbs: Orb[];
  grid?: string;
}

const PRESETS: Record<string, PresetConfig> = {
  welcome: {
    orbs: [
      { position: 'top-[-20%] left-[10%]', size: 'w-[500px] h-[500px]', gradient: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)' },
      { position: 'top-[10%] right-[-5%]', size: 'w-[400px] h-[400px]', gradient: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)' },
      { position: 'bottom-[-10%] left-[30%]', size: 'w-[350px] h-[350px]', gradient: 'radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 70%)' },
    ],
    grid: 'bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]',
  },
  dashboard: {
    orbs: [
      { position: 'top-[-10%] left-[-5%]', size: 'w-[40%] h-[40%]', gradient: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)' },
      { position: 'bottom-[5%] right-[-5%]', size: 'w-[30%] h-[30%]', gradient: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)' },
    ],
  },
  detail: {
    orbs: [
      { position: 'top-[-15%] left-[5%]', size: 'w-[35%] h-[35%]', gradient: 'radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%)' },
      { position: 'bottom-[-5%] right-[0%]', size: 'w-[25%] h-[25%]', gradient: 'radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 70%)' },
    ],
  },
};

export type HeroMeshPreset = keyof typeof PRESETS;

interface HeroMeshProps {
  preset?: HeroMeshPreset;
  className?: string;
}

export function HeroMesh({ preset = 'welcome', className }: HeroMeshProps) {
  const config = PRESETS[preset]!;
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className ?? ''}`}>
      {config.orbs.map((orb, i) => (
        <div key={i} className={`absolute ${orb.position} ${orb.size} rounded-full animate-hero-orb-drift`} style={{ background: orb.gradient }} />
      ))}
      {config.grid && <div className={`absolute inset-0 ${config.grid}`} />}
    </div>
  );
}
